"""The archive: the one part of the bucket that nothing ever prunes.

Everything else the pipeline writes is a cache of the newest run. A superseded
run's objects are deleted the moment its replacement is published, and the
bucket sweep collects whatever no pointer references. That is right for serving
a forecast and fatal for judging one: last Tuesday's forecast is exactly what has
to be set against what the wind did last Tuesday, and by Wednesday it is gone.
So what we forecast and what was observed are copied here first.

The archive lives under its own top-level prefix, `archive/`, beside the data
roots rather than inside one. No registered manifest may live under it (prune.py
refuses to import if one does), so it is never a data root and neither the local
prune, the bucket sweep nor the publisher's superseded delete ever lists or
names anything in it. Each of those also refuses an `archive/` path by name
(`prune.is_archived`), and `prune.delete_keys` refuses to send one to the store
at all, so a future change to any one of them cannot quietly start deleting it.

Locally the archive is `<work>/public/archive/`, the same keys the bucket uses,
so a local deployment and the one-shot containers write the same layout:

    archive/forecasts/<model>/<run>.json   one model run, sampled where we observe
    archive/observations/YYYY-MM-DD.json   one UTC day of wind observations
    archive/verify/sums/YYYY-MM-DD.json    one UTC day's verification sums

Forecast files are written once and never changed. Observation days are merged
hourly and idempotently: a reading is keyed by station and time, so merging the
same observations twice changes nothing.
"""
import gzip
import json
import os
from pathlib import Path, PurePosixPath

from prune import ARCHIVE_ROOT, decode_body, is_archived

# A merge is read-modify-write. Two archive jobs never run at once by schedule, but
# a retried container could overlap its predecessor, so the bucket write is
# conditional on the ETag it read and retried from a fresh read when it loses.
MERGE_ATTEMPTS = 4
# Archive objects change daily at most, and nothing reads them in a hurry.
ARCHIVE_CACHE = "public, max-age=300"


def archive_key(key):
    """A relative key under archive/, or ValueError. Every store method checks it."""
    path = PurePosixPath(key)
    if path.is_absolute() or ".." in path.parts or not is_archived(key) or len(path.parts) < 2:
        raise ValueError(f"Not an archive key: {key!r}")
    return str(path)


def forecast_key(model, run):
    return f"{ARCHIVE_ROOT}/forecasts/{model}/{run}.json"


def observation_key(day):
    return f"{ARCHIVE_ROOT}/observations/{day}.json"


def sums_key(day):
    return f"{ARCHIVE_ROOT}/verify/sums/{day}.json"


class LocalArchive:
    """The archive under a work directory's public/, written atomically."""

    def __init__(self, public):
        self.public = Path(public).resolve()

    def path(self, key):
        target = (self.public / archive_key(key)).resolve()
        if self.public not in target.parents:
            raise ValueError(f"Archive key escapes the work directory: {key!r}")
        return target

    def exists(self, key):
        return self.path(key).is_file()

    def read(self, key):
        path = self.path(key)
        return json.loads(path.read_text()) if path.is_file() else None

    def write(self, key, value):
        path = self.path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(value, separators=(",", ":"), allow_nan=False))
        os.replace(temporary, path)

    def create(self, key, value):
        """Write once. False, and nothing written, when the key already exists."""
        if self.exists(key):
            return False
        self.write(key, value)
        return True

    def merge(self, key, combine):
        """Replace the value with `combine(current or None)`; return the new value.

        `combine` returns None to say "nothing to change", and nothing is written.
        """
        current = self.read(key)
        value = combine(current)
        if value is None:
            return current
        self.write(key, value)
        return value

    def keys(self, prefix):
        base = self.path(prefix.rstrip("/") + "/_")
        directory = base.parent
        if not directory.is_dir():
            return []
        found = []
        for path in sorted(directory.rglob("*.json")):
            found.append(str(PurePosixPath(prefix.rstrip("/")) /
                             path.relative_to(directory).as_posix()))
        return found


class BucketArchive:
    """The archive in the bucket: gzip-encoded JSON, as every JSON object there is.

    The bucket helpers come from publish_s3, so retries, the R2 conditional-write
    fallback and the collision check behave exactly as they do for a forecast.
    """

    def __init__(self, s3, bucket, prefix=""):
        from publish_s3 import object_prefix
        self.s3, self.bucket, self.prefix = s3, bucket, object_prefix(prefix)

    def full(self, key):
        return self.prefix + archive_key(key)

    def exists(self, key):
        from publish_s3 import MISSING_CODES, error_code
        try:
            self.s3.head_object(Bucket=self.bucket, Key=self.full(key))
            return True
        except Exception as error:
            if error_code(error) in MISSING_CODES:
                return False
            raise

    def read_with_tag(self, key):
        from publish_s3 import MISSING_CODES, error_code
        try:
            response = self.s3.get_object(Bucket=self.bucket, Key=self.full(key))
        except Exception as error:
            if error_code(error) in MISSING_CODES:
                return None, None
            raise
        body = decode_body(response["Body"].read(), response.get("ContentEncoding"))
        return json.loads(body), response.get("ETag")

    def read(self, key):
        return self.read_with_tag(key)[0]

    def create(self, key, value):
        """Write once, refusing to replace different bytes. False if already there."""
        from publish_s3 import put_immutable
        if self.exists(key):
            return False
        body = json.dumps(value, separators=(",", ":"), allow_nan=False).encode()
        put_immutable(self.s3, self.bucket, self.full(key), body)
        return True

    def merge(self, key, combine):
        """Read, combine and write back, conditional on the version that was read."""
        from publish_s3 import (PRECONDITION_CODES, UNSUPPORTED_CONDITION_CODES,
                                error_code, log_event)
        for _ in range(MERGE_ATTEMPTS):
            current, etag = self.read_with_tag(key)
            value = combine(current)
            if value is None:
                return current  # Nothing new: leave the object exactly as it is.
            body = gzip.compress(json.dumps(value, separators=(",", ":"),
                                            allow_nan=False).encode(), mtime=0)
            args = {"Bucket": self.bucket, "Key": self.full(key), "Body": body,
                    "ContentType": "application/json", "ContentEncoding": "gzip",
                    "CacheControl": ARCHIVE_CACHE}
            condition = {"IfMatch": etag} if etag else {"IfNoneMatch": "*"}
            try:
                self.s3.put_object(**args, **condition)
                return value
            except Exception as error:
                code = error_code(error)
                if code in PRECONDITION_CODES:
                    continue  # Someone else wrote it since we read: merge again.
                if code not in UNSUPPORTED_CONDITION_CODES:
                    raise
                log_event("conditional_put_unsupported", key=self.full(key), code=code)
                self.s3.put_object(**args)
                return value
        raise RuntimeError(f"{key} kept changing while it was being merged; retry the job")

    def keys(self, prefix):
        start = self.prefix + archive_key(prefix.rstrip("/") + "/_")[:-1]
        found, token = [], None
        while True:
            page = self.s3.list_objects_v2(Bucket=self.bucket, Prefix=start, MaxKeys=1000,
                                           **({"ContinuationToken": token} if token else {}))
            for item in page.get("Contents") or []:
                found.append(item["Key"][len(self.prefix):])
            token = page.get("NextContinuationToken")
            if not token or not page.get("IsTruncated"):
                break
        return sorted(key for key in found if key.endswith(".json"))


def open_archive(public=None, s3=None, bucket=None, prefix=""):
    """The bucket's archive when a bucket is given, else the work directory's."""
    if bucket:
        return BucketArchive(s3, bucket, prefix)
    return LocalArchive(public)
