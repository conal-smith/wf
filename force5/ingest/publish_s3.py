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
             "gfs": "gfs.json", "harmonie-eps": "harmonie-eps.json"}


def error_code(error):
    return getattr(error, "response", {}).get("Error", {}).get("Code", "")


def finite(value, field):
    return (isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
            and abs(value) <= 150 and (field != "gust" or value >= 0))


def validate_ensemble(manifest, run):
    """Check the optional ensemble keys; returns the member series hours, or None.

    An ensemble may publish member series without frames, so this also supplies
    the valid-time axis that a frameless bundle's freshness check needs.
    """
    ensemble, series = manifest.get("ensemble"), manifest.get("spotMembers")
    if ensemble is None and series is None:
        return None
    if not isinstance(ensemble, dict) or not isinstance(series, dict) or not series:
        raise ValueError("Ensemble metadata and spotMembers must be published together")
    members, control = ensemble.get("members"), ensemble.get("control")
    if not isinstance(members, int) or isinstance(members, bool) or not 2 <= members <= 200:
        raise ValueError("Invalid ensemble member count")
    if control is not None and not (isinstance(control, int) and not isinstance(control, bool)
                                    and 0 <= control < members):
        raise ValueError("The ensemble control must be a member index or null")
    runs = ensemble.get("memberRuns", [])
    if not isinstance(runs, list) or (runs and len(runs) != members) or any(
            not isinstance(t, str) or datetime.fromisoformat(t.replace("Z", "+00:00")) > run for t in runs):
        raise ValueError("Member run times must be one per member, none later than the published run")
    step, hours = manifest["stepHours"], None
    for spot, entries in series.items():
        if spot not in (manifest.get("spotForecasts") or {}) or not isinstance(entries, list) or not entries:
            raise ValueError("Member series must accompany the published spot forecasts")
        axis = tuple(range(0, len(entries) * step, step))
        if hours not in (None, axis):
            raise ValueError("Member series lengths differ between spots")
        for hour, entry in zip(axis, entries):
            valid = (run + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
            if (entry.get("hour"), entry.get("validTime")) != (hour, valid):
                raise ValueError("Member series is not on the published valid-time axis")
            for field in ("u", "v", "gust"):
                values = entry.get(field)
                if not isinstance(values, list) or len(values) != members or not all(
                        (value is None and field == "gust") or finite(value, field) for value in values):
                    raise ValueError(f"Invalid member {field} series")
        hours = axis
    return hours


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
    instantaneous = manifest.get("gustKind") == "instantaneous"
    if instantaneous and missing_gust_hours:
        raise ValueError("Instantaneous gusts exist at every forecast time")
    hours = expected_hours(manifest)
    series_hours = validate_ensemble(manifest, run)
    if len(frames) != len(hours) or not (frames or series_hours):
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
            # An instantaneous gust is valid at the forecast time itself: [hour, hour],
            # hour 0 included. A period maximum must span a real interval instead.
            if (not isinstance(interval, list) or len(interval) != 2
                    or not all(isinstance(x, int) and not isinstance(x, bool) for x in interval)
                    or interval[0] < 0 or interval[0] > interval[1] or interval[1] != hour
                    or (interval[0] == interval[1]) != (hour == 0 or instantaneous)
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
                    finite(v, field) for v in values):
                raise ValueError(f"Invalid {field} field")
        objects.append((str(path), data))
    horizon = frames[-1]["hour"] if frames else series_hours[-1]
    if run + timedelta(hours=horizon) <= now:
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
