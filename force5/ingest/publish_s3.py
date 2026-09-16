"""Validate a local snapshot; publish immutable objects before its S3 pointer.

No bucket creation, ACL changes, deletion or credentials stored in this module.

Bundle kinds (`kind`, default "wind" when absent, all at schemaVersion 1):

- wind  frames of u/v/gust grids plus `spotForecasts`. Optional `gustKind`
        ("interval", the default, or "instantaneous") and `ensemble`/`spotMembers`.
- wave  frames of one array per declared variable plus `spotSeries`.
- tide  a station manifest plus immutable per-station prediction files.
"""
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
from cadence import expected_hours
from registry import MANIFESTS, MODELS, object_root

MAX_HEIGHT_METRES = 8.0  # Tidal range above LAT; no Irish station approaches this.
MIN_HEIGHT_METRES = -1.0


def error_code(error):
    return getattr(error, "response", {}).get("Error", {}).get("Code", "")


def number(value, limit, minimum=None):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and abs(value) <= limit
            and (minimum is None or value >= minimum))


def whole(value):
    return isinstance(value, int) and not isinstance(value, bool)


def valid_time(run, hour):
    return (run + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")


def referenced(public, url, root, depth):
    """Read an immutable object the manifest points at, refusing unsafe paths."""
    path = PurePosixPath(url)
    if path.is_absolute() or ".." in path.parts or len(path.parts) != depth or path.parts[0] != root:
        raise ValueError("Unsafe object path")
    source = (public / str(path)).resolve()
    if public not in source.parents:
        raise ValueError("Object path escapes output directory")
    return str(path), source.read_bytes()


def grid_count(grid):
    count = grid["width"] * grid["height"]
    if not isinstance(count, int) or not 4 <= count <= 10_000_000:
        raise ValueError("Invalid grid dimensions")
    return count


def validate_bundle(public, model, max_age_hours=12, now=None):
    public = Path(public).resolve()
    body = (public / MANIFESTS[model]).read_bytes()
    manifest = json.loads(body)
    kind = manifest.get("kind", "wind")
    if kind != MODELS[model]["kind"]:
        raise ValueError("Manifest kind does not match the model registry")
    if manifest.get("model") != model or not re.fullmatch(r"\d{10}", manifest.get("run", "")):
        raise ValueError("Wrong model or invalid forecast run")
    run = datetime.strptime(manifest["run"], "%Y%m%d%H").replace(tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    if not -1 <= (now - run).total_seconds() / 3600 <= max_age_hours:
        raise ValueError("Refusing to publish a stale or future-dated run")
    if datetime.fromisoformat(manifest["runTime"].replace("Z", "+00:00")) != run:
        raise ValueError("Run time does not match run identity")
    validator = {"wind": validate_wind_bundle, "wave": validate_wave_bundle,
                 "tide": validate_tide_bundle}[kind]
    return manifest, body, validator(public, model, manifest, run, now)


def validate_wind_bundle(public, model, manifest, run, now):
    frames, grid = manifest["frames"], manifest.get("grid")
    ensemble = manifest.get("ensemble")
    last = validate_ensemble(manifest, ensemble, run) if ensemble is not None else None
    gust_kind = manifest.get("gustKind", "interval")
    if gust_kind not in ("interval", "instantaneous"):
        raise ValueError("Unknown gust kind")
    missing_gust_hours = manifest.get("gustMissingHours", [])
    if missing_gust_hours not in ([], [0]):
        raise ValueError("Only initialization gusts may be explicitly missing")
    if not frames:
        # Only an ensemble may publish spot series without map frames.
        if ensemble is None:
            raise ValueError("Empty forecast or unsupported cadence")
        if last <= now:
            raise ValueError("Forecast horizon has already expired")
        return []
    hours = expected_hours(manifest)
    if len(frames) != len(hours):
        raise ValueError("Empty forecast or unsupported cadence")
    count = grid_count(grid)
    objects = []
    for index, info in enumerate(frames):
        path, data = referenced(public, info["url"], object_root(model), 3)
        frame = json.loads(data)
        hour = hours[index]
        valid = valid_time(run, hour)
        if (info["hour"], info["validTime"]) != (hour, valid):
            raise ValueError("Incomplete or misordered forecast")
        if any(frame.get(k) != v for k, v in {"model": model, "run": manifest["run"],
               "grid": grid, "hour": hour, "validTime": valid}.items()):
            raise ValueError("Mixed model/run/frame metadata")
        gust_missing = manifest.get("gustAvailable") is False or hour in missing_gust_hours
        interval = info.get("gustIntervalHours")
        if not gust_missing:
            if (not isinstance(interval, list) or len(interval) != 2
                    or not all(whole(x) for x in interval)
                    or interval[0] < 0 or interval[0] > interval[1] or interval[1] != hour
                    or frame.get("gustIntervalHours") != interval):
                raise ValueError("Invalid or mismatched gust interval")
            if gust_kind == "instantaneous":
                # A surface gust read at the valid time, not a period maximum.
                if interval[0] != hour:
                    raise ValueError("Instantaneous gusts declare a zero-length interval")
            elif hour > 0 and interval[0] == interval[1]:
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
                    number(v, 150, 0 if field == "gust" else None) for v in values):
                raise ValueError(f"Invalid {field} field")
        objects.append((path, data))
    if datetime.fromisoformat(frames[-1]["validTime"].replace("Z", "+00:00")) <= now:
        raise ValueError("Forecast horizon has already expired")
    return objects


def validate_ensemble(manifest, ensemble, run):
    """`spotForecasts` holds the ensemble mean; `spotMembers` holds every member."""
    members, control = ensemble.get("members"), ensemble.get("control")
    if not whole(members) or not 2 <= members <= 200:
        raise ValueError("Invalid ensemble member count")
    if control is not None and (not whole(control) or not 0 <= control < members):
        raise ValueError("Ensemble control member is out of range")
    if not isinstance(ensemble.get("description"), str) or not ensemble["description"].strip():
        raise ValueError("Ensemble membership must be described")
    series, means = manifest.get("spotMembers"), manifest.get("spotForecasts")
    if not isinstance(series, dict) or not series or not isinstance(means, dict):
        raise ValueError("Ensemble manifests need spotMembers and mean spotForecasts")
    last = None
    for spot, steps in series.items():
        mean = means.get(spot)
        if not isinstance(steps, list) or not steps or not isinstance(mean, list) or len(mean) != len(steps):
            raise ValueError(f"Member series for {spot} does not match its mean series")
        previous = None
        for step in steps:
            hour = step.get("hour")
            if not whole(hour) or hour < 0 or (previous is not None and hour <= previous):
                raise ValueError(f"Misordered member hours for {spot}")
            if step.get("validTime") != valid_time(run, hour):
                raise ValueError(f"Member valid time does not match the run for {spot}")
            previous = hour
            for field in ("u", "v", "gust"):
                values = step.get(field)
                if not isinstance(values, list) or len(values) != members:
                    raise ValueError(f"Expected {members} {field} members for {spot}")
                if not all((field == "gust" and value is None)
                           or number(value, 150, 0 if field == "gust" else None) for value in values):
                    raise ValueError(f"Invalid {field} member value for {spot}")
        horizon = datetime.fromisoformat(steps[-1]["validTime"].replace("Z", "+00:00"))
        last = horizon if last is None else min(last, horizon)
    return last


def validate_wave_bundle(public, model, manifest, run, now):
    variables = manifest.get("variables")
    if not isinstance(variables, dict) or not variables:
        raise ValueError("Wave manifests must declare their variables")
    for name, meta in variables.items():
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,31}", name) or not isinstance(meta, dict):
            raise ValueError(f"Invalid wave variable {name!r}")
        if any(not isinstance(meta.get(key), str) or not meta[key].strip()
               for key in ("units", "label", "description")):
            raise ValueError(f"Wave variable {name} needs units, label and description")
    frames, grid = manifest["frames"], manifest["grid"]
    hours = expected_hours(manifest)
    if not frames or len(frames) != len(hours):
        raise ValueError("Empty wave forecast or unsupported cadence")
    count = grid_count(grid)
    objects = []
    for index, info in enumerate(frames):
        path, data = referenced(public, info["url"], object_root(model), 3)
        frame = json.loads(data)
        hour = hours[index]
        valid = valid_time(run, hour)
        if (info["hour"], info["validTime"]) != (hour, valid):
            raise ValueError("Incomplete or misordered wave forecast")
        if any(frame.get(k) != v for k, v in {"model": model, "run": manifest["run"],
               "grid": grid, "hour": hour, "validTime": valid}.items()):
            raise ValueError("Mixed model/run/frame metadata")
        for name in variables:
            values = frame.get(name)
            # Land and unresolved cells are null; they are never filled with zero.
            if not isinstance(values, list) or len(values) != count or not all(
                    value is None or number(value, 1000) for value in values):
                raise ValueError(f"Invalid {name} field")
        objects.append((path, data))
    validate_spot_series(manifest.get("spotSeries"), variables, hours, run)
    if datetime.fromisoformat(frames[-1]["validTime"].replace("Z", "+00:00")) <= now:
        raise ValueError("Wave horizon has already expired")
    return objects


def validate_spot_series(series, variables, hours, run):
    if not isinstance(series, dict) or not series:
        raise ValueError("Missing precomputed spot series")
    for spot, steps in series.items():
        if not isinstance(steps, list) or len(steps) != len(hours):
            raise ValueError(f"Spot series for {spot} does not cover every step")
        for step, hour in zip(steps, hours):
            if step.get("hour") != hour or step.get("validTime") != valid_time(run, hour):
                raise ValueError(f"Spot series for {spot} is misordered")
            values = step.get("values")
            if not isinstance(values, dict) or set(values) != set(variables):
                raise ValueError(f"Spot series for {spot} must carry every variable")
            if not all(value is None or number(value, 1000) for value in values.values()):
                raise ValueError(f"Invalid spot value for {spot}")


def validate_tide_bundle(public, model, manifest, run, now):
    """Predictions, not observations: an immutable file per used station."""
    stations, spots = manifest.get("stations"), manifest.get("spots")
    coverage = manifest.get("coverage", {})
    if not isinstance(stations, dict) or not stations or not isinstance(spots, dict):
        raise ValueError("Tide manifests need stations and spot assignments")
    start = datetime.fromisoformat(coverage["from"].replace("Z", "+00:00"))
    end = datetime.fromisoformat(coverage["to"].replace("Z", "+00:00"))
    if end <= now or end <= start:
        raise ValueError("Tide coverage has already expired")
    objects = []
    for identifier, station in stations.items():
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", identifier):
            raise ValueError(f"Invalid station id {identifier!r}")
        if not isinstance(station.get("name"), str) or not station["name"].strip():
            raise ValueError(f"Station {identifier} needs a name")
        if not (number(station.get("lat"), 90) and number(station.get("lon"), 180)):
            raise ValueError(f"Station {identifier} has no valid position")
        if not isinstance(station.get("modelled"), bool):
            raise ValueError(f"Station {identifier} must state whether it is modelled")
        if not isinstance(station.get("datumNote"), str) or not station["datumNote"].strip():
            raise ValueError(f"Station {identifier} must document its datum")
        path, data = referenced(public, station["url"], object_root(model), 2)
        validate_station_file(json.loads(data), identifier, coverage)
        objects.append((path, data))
    for spot, assignment in spots.items():
        station = assignment.get("station")
        if station is None:
            if not isinstance(assignment.get("reason"), str) or not assignment["reason"].strip():
                raise ValueError(f"Spot {spot} needs a reason for having no tides")
            continue
        if station not in stations or not number(assignment.get("distanceKm"), 1000, 0):
            raise ValueError(f"Spot {spot} refers to an unknown station or distance")
    return objects


def validate_station_file(station, identifier, coverage):
    if station.get("station") != identifier or station.get("datum") != "LAT":
        raise ValueError(f"Station file {identifier} has the wrong identity or datum")
    if (station.get("from"), station.get("to")) != (coverage["from"], coverage["to"]):
        raise ValueError(f"Station file {identifier} does not match the published coverage")
    step = station.get("stepMinutes")
    curve = station.get("curve")
    if not whole(step) or not 1 <= step <= 60 or not isinstance(curve, list) or len(curve) < 2:
        raise ValueError(f"Station file {identifier} has no usable curve")
    start = datetime.fromisoformat(coverage["from"].replace("Z", "+00:00"))
    end = datetime.fromisoformat(coverage["to"].replace("Z", "+00:00"))
    if len(curve) != int((end - start).total_seconds() // (step * 60)) + 1:
        raise ValueError(f"Station file {identifier} curve length does not match its window")
    if not all(number(height, MAX_HEIGHT_METRES, MIN_HEIGHT_METRES) for height in curve):
        raise ValueError(f"Implausible predicted height for {identifier}")
    events = station.get("events")
    if not isinstance(events, list) or len(events) < 2:
        raise ValueError(f"Station file {identifier} has no high/low events")
    previous = None
    for event in events:
        moment = datetime.fromisoformat(event["time"].replace("Z", "+00:00"))
        if not start <= moment <= end or (previous is not None and moment <= previous):
            raise ValueError(f"Misordered or out-of-window event for {identifier}")
        previous = moment
        if event.get("kind") not in ("high", "low"):
            raise ValueError(f"Unknown tide event kind for {identifier}")
        if not number(event.get("height"), MAX_HEIGHT_METRES, MIN_HEIGHT_METRES):
            raise ValueError(f"Implausible event height for {identifier}")
        index = round((moment - start).total_seconds() / (step * 60))
        near = curve[max(0, index - 1):index + 2]
        if abs(event["height"] - min(near, key=lambda h: abs(h - event["height"]))) > 0.15:
            raise ValueError(f"Event height disagrees with the curve for {identifier}")


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
        if current.get("stepHours", 0) < incoming.get("stepHours", 0):
            return True
        return {k: v for k, v in current.items() if k != "generatedAt"} == {
            k: v for k, v in incoming.items() if k != "generatedAt"}
    return False


def publish(s3, public, model, bucket, prefix="", max_age_hours=12, now=None):
    if prefix and (prefix.startswith("/") or ".." in PurePosixPath(prefix).parts):
        raise ValueError("S3 prefix must be a relative object prefix")
    prefix = prefix.rstrip("/") + "/" if prefix else ""
    manifest, body, objects = validate_bundle(public, model, max_age_hours, now)
    pointer = prefix + MANIFESTS[model]
    current, _ = read_current(s3, bucket, pointer)
    if already_current(current, manifest):
        return "unchanged-or-newer"
    for path, data in objects:
        put_immutable(s3, bucket, prefix + path, data)
    archive = (f"{object_root(model)}/manifests/{model}/"
               f"{manifest['run']}-{hashlib.sha256(body).hexdigest()[:16]}.json")
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
