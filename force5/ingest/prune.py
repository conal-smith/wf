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

`--bucket` runs the same sweep against the object store instead of a work
directory, for the one-shot deployment where the disk is empty at the start of
every job and the bucket is the only state there is. There is no workspace lock
to take, because the importers are on other machines, so three other things stand
in for it: an unreferenced object is deleted only once it is older than
`--min-age-hours` (default 6, longer than any job timeout), the pointer manifests
are read again after the listing and an object must be unreferenced in both
reads, and a model whose pointer manifest is absent altogether has everything
named for it kept, because "unreferenced" tells us nothing about a model that has
published nothing. Failed or interrupted uploads are what the bucket sweep is
for; the ordinary superseded run is deleted by the publisher itself, which needs
no listing. `--bucket` is never defaulted from the environment: it must be asked
for, or a scheduled local retention job could silently become a bucket sweep.
"""
import argparse
from datetime import datetime, timedelta, timezone
import gzip
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sys

from registry import MANIFESTS, MODELS
from workspace import workspace_lock

DATA_ROOTS = sorted({PurePosixPath(path).parts[0] for path in MANIFESTS.values()})
ARCHIVE_DIRECTORY = "manifests"  # Archived manifests, never a prunable run.
KEEP_CACHE_NAMES = {"worker.lock"}
DEFAULT_MAX_AGE_HOURS = 0.0
DEFAULT_CACHE_DAYS = 3.0
# The bucket guard. A job may run for 45 minutes and its container may be retried,
# so six hours is comfortably longer than any upload that could still be in flight
# for a run whose pointer manifest has not been written yet.
DEFAULT_BUCKET_MIN_AGE_HOURS = 6.0
DELETE_BATCH = 1000  # S3 and R2 both cap one DeleteObjects request here.
LIST_PAGE = 1000
MANIFEST_KEYS = ("frames", "stations", "spots", "spotForecasts")
# An observation bundle is one small self-contained file: it carries its readings
# inline and points at nothing, so having no object URLs is correct, not a fault.
# So is the blend, every riding place's wind consensus in one file. Each manifest
# is protected from deletion by being a registered pointer path.
SELF_CONTAINED_KINDS = {"observation", "blend"}


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


def model_owns(model, name):
    """Does this run directory or station file belong to `model`, and to no other?

    Every adapter names its immutable objects for its own model id —
    `weather/ecmwf-RUN-360h-v2/…`, `marine/tides-STATION-…json` — and model ids
    nest, so "harmonie" must not claim "harmonie-eps-…" nor "gfs" claim
    "gfs-wave-…". Both the publisher's superseded delete and the bucket sweep's
    protection of a model that has published no pointer yet turn on this.
    """
    rivals = tuple(f"{other}-" for other in MODELS if other.startswith(f"{model}-"))
    return name.startswith(f"{model}-") and not name.startswith(rivals)


def manifest_shaped(value):
    """A pointer for a model the registry has not adopted yet is still a pointer."""
    return isinstance(value, dict) and isinstance(value.get("model"), str) \
        and isinstance(value.get("run"), str) and any(key in value for key in MANIFEST_KEYS)


def looks_like_a_manifest(path):
    if path.suffix != ".json":
        return False
    try:
        return manifest_shaped(json.loads(path.read_text()))
    except (OSError, ValueError):
        return False


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


def absent(error):
    """A get/head that means "no such object", rather than a fault worth aborting on."""
    return getattr(error, "response", {}).get("Error", {}).get("Code", "") in (
        "NoSuchKey", "NotFound", "404")


def delete_keys(s3, bucket, keys):
    """Delete exactly these keys in batches. The publisher uses this too."""
    deleted = 0
    for start in range(0, len(keys), DELETE_BATCH):
        batch = keys[start:start + DELETE_BATCH]
        response = s3.delete_objects(
            Bucket=bucket, Delete={"Objects": [{"Key": key} for key in batch], "Quiet": True})
        failed = (response or {}).get("Errors")
        if failed:
            raise RuntimeError(f"{len(failed)} object(s) not deleted, first: {failed[0]}")
        deleted += len(batch)
    return deleted


def read_object(s3, bucket, key):
    """Body bytes, decompressed when the object was stored gzip-encoded."""
    response = s3.get_object(Bucket=bucket, Key=key)
    body = response["Body"].read()
    return gzip.decompress(body) if response.get("ContentEncoding") == "gzip" else body


def bucket_manifests(s3, bucket, prefix):
    """Every registry pointer manifest the bucket holds, and the models missing one.

    A manifest that is present but unreadable aborts the sweep: everything it
    references would look unreferenced, and that is precisely the live forecast.
    A manifest that is *absent* is just as dangerous in the other direction —
    every object that model has ever written would look unreferenced — so instead
    of ignoring it we report the model, and the sweep keeps everything named for
    it. That covers a first run, a model being onboarded, and a pointer that was
    deleted by hand.
    """
    manifests, missing = {}, set()
    for model, path in MANIFESTS.items():
        try:
            body = read_object(s3, bucket, prefix + path)
        except Exception as error:
            if absent(error):
                missing.add(model)
                continue
            raise ValueError(f"Cannot read manifest {path}: {error}") from error
        try:
            manifests[path] = json.loads(body)
        except ValueError as error:
            raise ValueError(f"Unreadable manifest {path}: {error}") from error
    return manifests, missing


def keep_sets(s3, bucket, prefix):
    """What the bucket's pointer manifests say must survive, right now."""
    manifests, missing = bucket_manifests(s3, bucket, prefix)
    files, directories = referenced(manifests)
    return files, directories, missing


def bucket_objects(s3, bucket, prefix):
    """Every object under each data root, one page at a time."""
    for root in DATA_ROOTS:
        token = None
        while True:
            page = s3.list_objects_v2(Bucket=bucket, Prefix=f"{prefix}{root}/",
                                      MaxKeys=LIST_PAGE,
                                      **({"ContinuationToken": token} if token else {}))
            for item in page.get("Contents") or []:
                yield item["Key"], item["LastModified"], item.get("Size", 0)
            token = page.get("NextContinuationToken")
            if not token or not page.get("IsTruncated"):
                break


def bucket_manifest_shaped(s3, bucket, key):
    """Is this unreferenced top-level .json a pointer for a model we do not know?

    Anything that cannot be read is treated as one. A sweep never deletes on a guess.
    """
    try:
        return manifest_shaped(json.loads(read_object(s3, bucket, key)))
    except Exception:
        return True


def bucket_prune(s3, bucket, prefix="", min_age_hours=DEFAULT_BUCKET_MIN_AGE_HOURS,
                 now=None, dry_run=False):
    """Delete bucket objects no pointer manifest references and nothing can still be writing.

    The publisher already deletes the run each publish supersedes, so what is left
    here is the wreckage of failed or interrupted uploads. Jobs for different models
    run on different machines at the same time, and a run's frames go up before its
    manifest does, so age is the only signal that an unreferenced object is not
    simply a run in progress: nothing younger than the guard is touched.

    The pointer manifests are read **twice**, before and after the listing, and an
    object must be unreferenced in both to be deleted. The listing is slow and
    paginated, and the age guard cannot cover everything a publish in flight might
    claim: `put_immutable` leaves an object that is already there untouched, so a
    stable key a new run re-references (a tide station file, whose name only changes
    with the day) keeps its old LastModified and would look both unreferenced and
    long past the guard. Both reads abort on an unreadable manifest and both
    contribute the models with no pointer at all.
    """
    if prefix and (prefix.startswith("/") or ".." in PurePosixPath(prefix).parts):
        raise ValueError("S3 prefix must be a relative object prefix")
    prefix = prefix.rstrip("/") + "/" if prefix else ""
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(hours=min_age_hours)
    files, directories, missing = keep_sets(s3, bucket, prefix)
    pointers = set(MANIFESTS.values())
    candidates, kept, waiting = [], 0, 0
    for key, modified, size in bucket_objects(s3, bucket, prefix):
        published = key[len(prefix):]
        parts = PurePosixPath(published).parts
        if len(parts) < 2 or parts[0] not in DATA_ROOTS or published in pointers \
                or parts[1] == ARCHIVE_DIRECTORY \
                or published in files or "/".join(parts[:2]) in directories:
            kept += 1
            continue
        if modified > cutoff:
            waiting += 1  # Another machine may be mid-upload of a run with no manifest yet.
            continue
        if len(parts) == 2 and published.endswith(".json") \
                and bucket_manifest_shaped(s3, bucket, key):
            kept += 1  # A pointer for a model this registry has not adopted yet.
            continue
        candidates.append((published, parts, size))
    # Second read: anything a publish referenced while we were listing is now safe.
    later_files, later_directories, later_missing = keep_sets(s3, bucket, prefix)
    files, directories = files | later_files, directories | later_directories
    missing |= later_missing
    removed, protected, freed = [], [], 0
    for published, parts, size in candidates:
        if published in files or "/".join(parts[:2]) in directories:
            kept += 1
            continue
        owner = next((model for model in missing if model_owns(model, parts[1])), None)
        if owner is not None:
            # That model has published no pointer at all, so "unreferenced" tells us
            # nothing about this object. Keep it and say whose it is.
            protected.append(owner)
            continue
        removed.append(published)
        freed += size
    if removed and not dry_run:
        delete_keys(s3, bucket, [prefix + published for published in removed])
    return {"removed": removed, "keptObjects": kept, "withinGuard": waiting,
            "protectedObjects": len(protected), "protectedModels": sorted(set(protected)),
            "noPointer": sorted(missing), "freedBytes": freed}


def sweep(args):
    """The --bucket mode of this command: no work directory, no lock, no raw cache."""
    # Imported here so the local sweep needs neither boto3 nor the publisher.
    from publish_s3 import make_client
    try:
        result = bucket_prune(make_client(args.endpoint_url, args.region), args.bucket,
                              args.prefix, args.min_age_hours, dry_run=args.dry_run)
    except Exception as error:
        print(json.dumps({"event": "sweep_failed", "bucket": args.bucket, "error": str(error)}),
              file=sys.stderr, flush=True)
        return 1
    print(json.dumps({"event": "sweep_complete", "bucket": args.bucket,
                      "dryRun": args.dry_run, "minAgeHours": args.min_age_hours,
                      "removed": result["removed"], "keptObjects": result["keptObjects"],
                      "withinGuard": result["withinGuard"],
                      "protectedObjects": result["protectedObjects"],
                      "protectedModels": result["protectedModels"],
                      "noPointer": result["noPointer"], "freedBytes": result["freedBytes"],
                      "time": datetime.now(timezone.utc).isoformat()}), flush=True)
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    # The three local-only options default to None so that combining one with
    # --bucket is detectable and can be refused rather than silently ignored.
    parser.add_argument("--root", help="Work directory holding public/ and .cache"
                        " (default: FORCE5_WORK_DIR, else the repository root)")
    parser.add_argument("--max-age-hours", type=float,
                        help="Keep unreferenced objects this long"
                             " (default FORCE5_RETAIN_HOURS, else 0: delete at once)")
    parser.add_argument("--cache-days", type=float,
                        help="Keep raw downloads this many days"
                             " (default FORCE5_CACHE_DAYS, else 3)")
    parser.add_argument("--dry-run", action="store_true", help="Report without deleting")
    # Deliberately NOT defaulted from S3_BUCKET: the worker's environment carries it,
    # and picking it up here would silently turn the scheduled local retention job
    # into a bucket sweep, leaving the disk to fill. The bucket sweep is opt-in.
    parser.add_argument("--bucket", help="Sweep this bucket instead of the local work"
                                         " directory. Must be given explicitly.")
    parser.add_argument("--prefix", default=os.environ.get("S3_PREFIX", ""))
    parser.add_argument("--endpoint-url", default=os.environ.get("S3_ENDPOINT_URL"),
                        help="S3-compatible endpoint (Cloudflare R2); omit for AWS S3")
    parser.add_argument("--region", default=os.environ.get("AWS_REGION"),
                        help="Defaults to 'auto' when an endpoint URL is given, as R2 wants")
    parser.add_argument("--min-age-hours", type=float, default=float(
        os.environ.get("FORCE5_SWEEP_MIN_AGE_HOURS") or DEFAULT_BUCKET_MIN_AGE_HOURS),
        help="Bucket sweep only: keep an unreferenced object this long, because another"
             " machine may still be uploading the run it belongs to (default 6)")
    args = parser.parse_args(argv)
    local_only = [name for name, value in (("--root", args.root),
                                           ("--max-age-hours", args.max_age_hours),
                                           ("--cache-days", args.cache_days))
                  if value is not None]
    if args.bucket and local_only:
        parser.error(f"--bucket sweeps the object store; {', '.join(local_only)} "
                     "applies to the local work directory only")
    if args.root is None:
        args.root = os.environ.get("FORCE5_WORK_DIR", str(Path(__file__).resolve().parents[2]))
    if args.max_age_hours is None:
        args.max_age_hours = float(os.environ.get("FORCE5_RETAIN_HOURS") or DEFAULT_MAX_AGE_HOURS)
    if args.cache_days is None:
        args.cache_days = float(os.environ.get("FORCE5_CACHE_DAYS") or DEFAULT_CACHE_DAYS)
    if args.max_age_hours < 0 or args.cache_days < 0 or args.min_age_hours < 0:
        parser.error("Retention windows cannot be negative")
    if args.bucket:
        return sweep(args)
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
