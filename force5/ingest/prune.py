"""Delete published objects no current manifest references, and aged raw cache.

Only the newest run of a model is ever served, so a run directory or station
file is junk as soon as no pointer manifest references it. The worker calls
`prune_published` itself the moment a new run is published; this script is the
scheduled backstop that also ages out the raw cache. It takes the workspace lock
and skips the sweep while an import holds it, because a run that is still being
written is unreferenced too. `--max-age-hours` can keep unreferenced objects for
a while longer; the default is not to. Anything that reads like a pointer
manifest is never deleted, even for a model the registry does not know yet, and
an unreadable registry manifest aborts the whole sweep rather than risking
objects that are still in use.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sys

from registry import MANIFESTS
from workspace import workspace_lock

DATA_ROOTS = sorted({PurePosixPath(path).parts[0] for path in MANIFESTS.values()})
ARCHIVE_DIRECTORY = "manifests"  # Archived manifests, never a prunable run.
KEEP_CACHE_NAMES = {"worker.lock"}
DEFAULT_MAX_AGE_HOURS = 0.0
DEFAULT_CACHE_DAYS = 3.0
MANIFEST_KEYS = ("frames", "stations", "spots", "spotForecasts")
# An observation bundle is one small self-contained file: it carries its readings
# inline and points at nothing, so having no object URLs is correct, not a fault.
# Its manifest is protected from deletion by being a registered pointer path.
SELF_CONTAINED_KINDS = {"observation"}


def read_manifests(public):
    """Every registered pointer manifest that exists, by its published path."""
    manifests = {}
    for path in MANIFESTS.values():
        source = public / path
        if not source.is_file():
            continue
        try:
            manifests[path] = json.loads(source.read_text())
        except (OSError, ValueError) as error:
            raise ValueError(f"Unreadable manifest {path}: {error}") from error
    return manifests


def manifest_urls(value):
    """Every object path a manifest points at, whatever its kind declares."""
    urls = set()
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "url" and isinstance(item, str):
                urls.add(item)
            else:
                urls |= manifest_urls(item)
    elif isinstance(value, list):
        for item in value:
            urls |= manifest_urls(item)
    return urls


def referenced(manifests):
    """Published paths, and the run directories holding them, that must survive."""
    files, directories = set(), set()
    for path, manifest in manifests.items():
        urls = manifest_urls(manifest)
        if not urls and manifest.get("kind") not in SELF_CONTAINED_KINDS:
            raise ValueError(f"Manifest {path} references no published objects")
        for url in urls:
            parts = PurePosixPath(url).parts
            if not 2 <= len(parts) <= 3 or parts[0] not in DATA_ROOTS or ".." in parts:
                raise ValueError(f"Manifest {path} has an unusable object path {url!r}")
            files.add("/".join(parts))
            if len(parts) == 3:
                directories.add("/".join(parts[:2]))
    return files, directories


def looks_like_a_manifest(path):
    """A pointer for a model the registry has not adopted yet is still a pointer."""
    if path.suffix != ".json":
        return False
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        return False
    return isinstance(value, dict) and isinstance(value.get("model"), str) \
        and isinstance(value.get("run"), str) and any(key in value for key in MANIFEST_KEYS)


def newest_mtime(path):
    newest = path.stat().st_mtime
    for base, _, files in os.walk(path):
        for name in files:
            try:
                newest = max(newest, Path(base, name).stat().st_mtime)
            except OSError:
                continue
    return newest


def size_of(path):
    if path.is_file():
        return path.stat().st_size
    total = 0
    for base, _, files in os.walk(path):
        for name in files:
            try:
                total += Path(base, name).stat().st_size
            except OSError:
                continue
    return total


def prune_published(public, max_age_hours, now=None, dry_run=False):
    """Remove unreferenced runs and station files older than the retention window."""
    cutoff = (now or datetime.now(timezone.utc)).timestamp() - max_age_hours * 3600
    keep_files, keep_directories = referenced(read_manifests(public))
    removed, kept, freed = [], [], 0
    for root in DATA_ROOTS:
        directory = public / root
        if not directory.is_dir():
            continue
        for entry in sorted(directory.iterdir()):
            published = f"{root}/{entry.name}"
            if entry.name == ARCHIVE_DIRECTORY or published in MANIFESTS.values():
                continue
            if published in keep_files or published in keep_directories:
                kept.append({"path": published, "reason": "referenced"})
                continue
            if entry.is_file() and looks_like_a_manifest(entry):
                kept.append({"path": published, "reason": "manifest"})
                continue
            if newest_mtime(entry) > cutoff:
                kept.append({"path": published, "reason": "within-window"})
                continue
            freed += size_of(entry)
            removed.append(published)
            if dry_run:
                continue
            if entry.is_dir():
                shutil.rmtree(entry)
            else:
                entry.unlink()
    return {"removed": removed, "kept": kept, "freedBytes": freed}


def prune_cache(cache, cache_days, now=None, dry_run=False):
    """Remove raw downloads older than the window; keep locks, drop empty directories."""
    if not cache.is_dir():
        return {"removedCacheFiles": 0, "freedCacheBytes": 0}
    cutoff = (now or datetime.now(timezone.utc)).timestamp() - cache_days * 86400
    files, freed = 0, 0
    for base, _, names in os.walk(cache):
        for name in names:
            path = Path(base, name)
            if name in KEEP_CACHE_NAMES or path.suffix == ".lock":
                continue
            try:
                info = path.stat()
            except OSError:
                continue
            if info.st_mtime > cutoff:
                continue
            files, freed = files + 1, freed + info.st_size
            if not dry_run:
                path.unlink(missing_ok=True)
    if not dry_run:
        for base, directories, _ in os.walk(cache, topdown=False):
            for name in directories:
                try:
                    Path(base, name).rmdir()
                except OSError:
                    pass  # Still holds retained files.
    return {"removedCacheFiles": files, "freedCacheBytes": freed}


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", default=os.environ.get(
        "FORCE5_WORK_DIR", str(Path(__file__).resolve().parents[2])),
        help="Work directory holding public/ and .cache")
    parser.add_argument("--max-age-hours", type=float, default=float(
        os.environ.get("FORCE5_RETAIN_HOURS") or DEFAULT_MAX_AGE_HOURS),
        help="Keep unreferenced objects this long (default 0: delete at once)")
    parser.add_argument("--cache-days", type=float, default=float(
        os.environ.get("FORCE5_CACHE_DAYS") or DEFAULT_CACHE_DAYS),
        help="Keep raw downloads this many days (default 3)")
    parser.add_argument("--dry-run", action="store_true", help="Report without deleting")
    args = parser.parse_args(argv)
    if args.max_age_hours < 0 or args.cache_days < 0:
        parser.error("Retention windows cannot be negative")
    public = Path(args.root) / "public"
    if not any((public / root).is_dir() for root in DATA_ROOTS):
        print(json.dumps({"event": "prune_failed",
                          "error": f"No published output below {public}"}),
              file=sys.stderr, flush=True)
        return 1
    try:
        with workspace_lock(Path(args.root)):
            result = prune_published(public, args.max_age_hours, dry_run=args.dry_run)
            result.update(prune_cache(Path(args.root) / ".cache", args.cache_days,
                                      dry_run=args.dry_run))
    except BlockingIOError:
        # An import is writing a run no manifest points at yet; it prunes when it is done.
        print(json.dumps({"event": "prune_skipped", "reason": "An import is running",
                          "time": datetime.now(timezone.utc).isoformat()}), flush=True)
        return 0
    except (OSError, ValueError) as error:
        print(json.dumps({"event": "prune_failed", "error": str(error)}),
              file=sys.stderr, flush=True)
        return 1
    print(json.dumps({"event": "prune_complete", "dryRun": args.dry_run,
                      "maxAgeHours": args.max_age_hours, "cacheDays": args.cache_days,
                      "removed": result["removed"], "kept": len(result["kept"]),
                      "removedCacheFiles": result["removedCacheFiles"],
                      "freedBytes": result["freedBytes"] + result["freedCacheBytes"],
                      "time": datetime.now(timezone.utc).isoformat()}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
