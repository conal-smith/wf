"""Validate a local snapshot; publish immutable objects before its S3 pointer.

No bucket creation, ACL changes, deletion or credentials stored in this module.
"""
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
from cadence import expected_hours

MANIFESTS = {"harmonie": "harmonie.json", "icon-eu": "latest.json", "ecmwf": "ecmwf.json",
             "ecmwf-ens": "ecmwf-ens.json"}


def error_code(error):
    return getattr(error, "response", {}).get("Error", {}).get("Code", "")


def validate_ensemble(manifest, hours, run):
    """Check optional ensemble metadata and per-spot member series, when present."""
    ensemble, series = manifest.get("ensemble"), manifest.get("spotMembers")
    if ensemble is None and series is None:
        return
    count = ensemble.get("members") if isinstance(ensemble, dict) else None
    if (not isinstance(count, int) or isinstance(count, bool) or not 2 <= count <= 100
            or ensemble.get("control") is not None):
        raise ValueError("Invalid ensemble metadata")
    if not isinstance(series, dict) or set(series) != set(manifest["spotForecasts"]):
        raise ValueError("Ensemble member series must cover exactly the published spots")
    missing_gust_hours = manifest.get("gustMissingHours", [])
    for spot, entries in series.items():
        if not isinstance(entries, list) or len(entries) != len(hours):
            raise ValueError(f"Incomplete ensemble series for {spot}")
        for entry, hour, mean in zip(entries, hours, manifest["spotForecasts"][spot]):
            valid = (run + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
            if entry.get("hour") != hour or entry.get("validTime") != valid:
                raise ValueError(f"Misaligned ensemble series for {spot}")
            gust_missing = manifest.get("gustAvailable") is False or hour in missing_gust_hours
            for field in ("u", "v", "gust"):
                values = entry.get(field)
                if not isinstance(values, list) or len(values) != count:
                    raise ValueError(f"Expected {count} ensemble {field} values for {spot}")
                # A member value may only be null where the mean is null too: an
                # unavailable gust hour, or a spot outside the published grid.
                if (gust_missing and field == "gust") or mean.get(field) is None:
                    if any(value is not None for value in values):
                        raise ValueError(f"Unexpected ensemble {field} for {spot} at +{hour}h")
                elif any(not isinstance(value, (int, float)) or isinstance(value, bool)
                         or not math.isfinite(value) or abs(value) > 150
                         or (field == "gust" and value < 0) for value in values):
                    raise ValueError(f"Invalid ensemble {field} values for {spot} at +{hour}h")


def validate_bundle(public, model, max_age_hours=12, now=None):
    public = Path(public).resolve()
    body = (public / "weather" / MANIFESTS[model]).read_bytes()
    manifest = json.loads(body)
    if manifest.get("model") != model or not re.fullmatch(r"\d{10}", manifest.get("run", "")):
        raise ValueError("Wrong model or invalid forecast run")
    run = datetime.strptime(manifest["run"], "%Y%m%d%H").replace(tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    if not -1 <= (now - run).total_seconds() / 3600 <= max_age_hours:
        raise ValueError("Refusing to publish a stale or future-dated run")
    if datetime.fromisoformat(manifest["runTime"].replace("Z", "+00:00")) != run:
        raise ValueError("Run time does not match run identity")
    frames, grid = manifest["frames"], manifest["grid"]
    missing_gust_hours = manifest.get("gustMissingHours", [])
    if missing_gust_hours not in ([], [0]):
        raise ValueError("Only initialization gusts may be explicitly missing")
    hours = expected_hours(manifest)
    if not frames or len(frames) != len(hours):
        raise ValueError("Empty forecast or unsupported cadence")
    count = grid["width"] * grid["height"]
    if not isinstance(count, int) or not 4 <= count <= 10_000_000:
        raise ValueError("Invalid grid dimensions")
    objects = []
    for index, info in enumerate(frames):
        path = PurePosixPath(info["url"])
        if path.is_absolute() or ".." in path.parts or len(path.parts) != 3 or path.parts[0] != "weather":
            raise ValueError("Unsafe frame path")
        source = (public / str(path)).resolve()
        if public not in source.parents:
            raise ValueError("Frame path escapes output directory")
        data = source.read_bytes()
        frame = json.loads(data)
        hour = hours[index]
        valid = (run + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
        if (info["hour"], info["validTime"]) != (hour, valid):
            raise ValueError("Incomplete or misordered forecast")
        if any(frame.get(k) != v for k, v in {"model": model, "run": manifest["run"],
               "grid": grid, "hour": hour, "validTime": valid}.items()):
            raise ValueError("Mixed model/run/frame metadata")
        gust_missing = manifest.get("gustAvailable") is False or hour in missing_gust_hours
        interval = info.get("gustIntervalHours")
        if not gust_missing:
            if (not isinstance(interval, list) or len(interval) != 2
                    or not all(isinstance(x, int) and not isinstance(x, bool) for x in interval)
                    or interval[0] < 0 or interval[0] > interval[1] or interval[1] != hour
                    or (hour > 0 and interval[0] == interval[1])
                    or frame.get("gustIntervalHours") != interval):
                raise ValueError("Invalid or mismatched gust interval")
        elif interval is not None or frame.get("gustIntervalHours") is not None:
            raise ValueError("Unavailable gusts cannot declare a period")
        for field in ("u", "v", "gust"):
            values = frame.get(field)
            if field == "gust" and gust_missing:
                if values is not None:
                    raise ValueError("Unexpected gust data")
                continue
            if not isinstance(values, list) or len(values) != count or not all(
                isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
                and abs(v) <= 150 and (field != "gust" or v >= 0) for v in values
            ):
                raise ValueError(f"Invalid {field} field")
        objects.append((str(path), data))
    validate_ensemble(manifest, hours, run)
    if datetime.fromisoformat(frames[-1]["validTime"].replace("Z", "+00:00")) <= now:
        raise ValueError("Forecast horizon has already expired")
    return manifest, body, objects


def put_immutable(s3, bucket, key, body):
    digest = hashlib.sha256(body).hexdigest()
    try:
        s3.put_object(Bucket=bucket, Key=key, Body=gzip.compress(body, mtime=0),
                      ContentType="application/json", ContentEncoding="gzip",
                      CacheControl="public, max-age=31536000, immutable",
                      Metadata={"sha256": digest}, IfNoneMatch="*")
    except Exception as error:
        if error_code(error) not in ("PreconditionFailed", "412"):
            raise
        existing = s3.head_object(Bucket=bucket, Key=key)
        if existing.get("Metadata", {}).get("sha256") != digest:
            raise ValueError(f"Immutable object collision: {key}") from error


def read_current(s3, bucket, key):
    try:
        response = s3.get_object(Bucket=bucket, Key=key)
    except Exception as error:
        if error_code(error) in ("NoSuchKey", "404"):
            return None, None
        raise
    body = response["Body"].read()
    if response.get("ContentEncoding") == "gzip":
        body = gzip.decompress(body)
    return json.loads(body), response["ETag"]


def already_current(current, incoming):
    if not current:
        return False
    if current.get("model") != incoming["model"]:
        raise ValueError("S3 pointer contains the wrong model")
    if current["run"] > incoming["run"]:
        return True
    if current["run"] == incoming["run"]:
        if current.get("gustAvailable", True) and incoming.get("gustAvailable") is False:
            return True  # An older wind-only worker must not remove published gusts.
        # A slower/coarser job must not downgrade an hourly run.
        if current["stepHours"] < incoming["stepHours"]:
            return True
        # A diagnostic run with fewer members must not replace a fuller ensemble.
        if (current.get("ensemble") or {}).get("members", 0) > (incoming.get("ensemble") or {}).get("members", 0):
            return True
        return {k: v for k, v in current.items() if k != "generatedAt"} == {
            k: v for k, v in incoming.items() if k != "generatedAt"}
    return False


def publish(s3, public, model, bucket, prefix="", max_age_hours=12, now=None):
    if prefix and (prefix.startswith("/") or ".." in PurePosixPath(prefix).parts):
        raise ValueError("S3 prefix must be a relative object prefix")
    prefix = prefix.rstrip("/") + "/" if prefix else ""
    manifest, body, objects = validate_bundle(public, model, max_age_hours, now)
    pointer = prefix + "weather/" + MANIFESTS[model]
    current, _ = read_current(s3, bucket, pointer)
    if already_current(current, manifest):
        return "unchanged-or-newer"
    for path, data in objects:
        put_immutable(s3, bucket, prefix + path, data)
    archive = f"weather/manifests/{model}/{manifest['run']}-{hashlib.sha256(body).hexdigest()[:16]}.json"
    put_immutable(s3, bucket, prefix + archive, body)
    for _ in range(4):
        current, etag = read_current(s3, bucket, pointer)
        if already_current(current, manifest):
            return "unchanged-or-newer"
        condition = {"IfMatch": etag} if etag else {"IfNoneMatch": "*"}
        try:
            # The only mutable object. Publish LAST using compare-and-swap.
            s3.put_object(Bucket=bucket, Key=pointer, Body=body,
                          ContentType="application/json",
                          CacheControl="public, max-age=0, s-maxage=60, must-revalidate",
                          **condition)
            return "published"
        except Exception as error:
            if error_code(error) not in ("PreconditionFailed", "412", "ConditionalRequestConflict", "409"):
                raise
    raise RuntimeError("Manifest changed repeatedly during publish; retry the job")
