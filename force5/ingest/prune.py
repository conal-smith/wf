"""Delete forecast runs no current manifest references, and aged raw cache.

Retention is deliberately conservative: a run directory is removed only when no
pointer manifest references any file inside it AND nothing in it was written
within the retention window, so an already-open browser session keeps working
while it finishes reading the run it loaded. Pointer manifests themselves, the
archived-manifest directory and lock files are never deleted. An unreadable
manifest aborts the whole prune rather than risking a referenced run.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sys

ARCHIVE_DIRECTORY = "manifests"  # Archived manifests, never a prunable run.
KEEP_CACHE_NAMES = {"worker.lock"}
DEFAULT_MAX_AGE_HOURS = 48.0
DEFAULT_CACHE_DAYS = 3.0


def read_manifests(weather):
    """Pointer manifests are the JSON files directly inside weather/."""
    manifests = {}
    for path in sorted(weather.glob("*.json")):
        try:
            manifests[path] = json.loads(path.read_text())
        except (OSError, ValueError) as error:
            raise ValueError(f"Unreadable manifest {path.name}: {error}") from error
    return manifests


def referenced_runs(manifests):
    """Run directory names the current manifests depend on."""
    names = set()
    for path, manifest in manifests.items():
        frames = manifest.get("frames") if isinstance(manifest, dict) else None
        if not isinstance(frames, list) or not frames:
            raise ValueError(f"Manifest {path.name} lists no frames")
        for frame in frames:
            url = frame.get("url") if isinstance(frame, dict) else None
            parts = PurePosixPath(url).parts if isinstance(url, str) else ()
            if len(parts) != 3 or parts[0] != "weather" or ".." in parts:
                raise ValueError(f"Manifest {path.name} has an unusable frame path {url!r}")
            names.add(parts[1])
    return names


def newest_mtime(directory):
    newest = directory.stat().st_mtime
    for base, _, files in os.walk(directory):
        for name in files:
            try:
                newest = max(newest, Path(base, name).stat().st_mtime)
            except OSError:
                continue
    return newest


def directory_size(directory):
    total = 0
    for base, _, files in os.walk(directory):
        for name in files:
            try:
                total += Path(base, name).stat().st_size
            except OSError:
                continue
    return total


def prune_runs(weather, max_age_hours, now=None, dry_run=False):
    """Remove unreferenced run directories older than the retention window."""
    cutoff = (now or datetime.now(timezone.utc)).timestamp() - max_age_hours * 3600
    keep = referenced_runs(read_manifests(weather))
    removed, kept, freed = [], [], 0
    for directory in sorted(path for path in weather.iterdir() if path.is_dir()):
        if directory.name == ARCHIVE_DIRECTORY:
            continue
        if directory.name in keep:
            kept.append({"run": directory.name, "reason": "referenced"})
            continue
        if newest_mtime(directory) > cutoff:
            kept.append({"run": directory.name, "reason": "within-window"})
            continue
        freed += directory_size(directory)
        removed.append(directory.name)
        if not dry_run:
            shutil.rmtree(directory)
    return {"removedRuns": removed, "keptRuns": kept, "freedBytes": freed}


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
        help="Work directory holding public/weather and .cache")
    parser.add_argument("--max-age-hours", type=float, default=float(
        os.environ.get("FORCE5_RETAIN_HOURS") or DEFAULT_MAX_AGE_HOURS),
        help="Keep unreferenced runs this long (default 48)")
    parser.add_argument("--cache-days", type=float, default=float(
        os.environ.get("FORCE5_CACHE_DAYS") or DEFAULT_CACHE_DAYS),
        help="Keep raw downloads this many days (default 3)")
    parser.add_argument("--dry-run", action="store_true", help="Report without deleting")
    args = parser.parse_args(argv)
    if args.max_age_hours < 0 or args.cache_days < 0:
        parser.error("Retention windows cannot be negative")
    weather = Path(args.root) / "public" / "weather"
    if not weather.is_dir():
        print(json.dumps({"event": "prune_failed",
                          "error": f"No weather directory below {args.root}"}),
              file=sys.stderr, flush=True)
        return 1
    try:
        result = prune_runs(weather, args.max_age_hours, dry_run=args.dry_run)
        result.update(prune_cache(Path(args.root) / ".cache", args.cache_days,
                                  dry_run=args.dry_run))
    except (OSError, ValueError) as error:
        print(json.dumps({"event": "prune_failed", "error": str(error)}),
              file=sys.stderr, flush=True)
        return 1
    print(json.dumps({"event": "prune_complete", "dryRun": args.dry_run,
                      "maxAgeHours": args.max_age_hours, "cacheDays": args.cache_days,
                      "removedRuns": result["removedRuns"], "keptRuns": len(result["keptRuns"]),
                      "removedCacheFiles": result["removedCacheFiles"],
                      "freedBytes": result["freedBytes"] + result["freedCacheBytes"],
                      "time": datetime.now(timezone.utc).isoformat()}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
