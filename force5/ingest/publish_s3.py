"""Validate a local snapshot; publish immutable objects before its S3 pointer.

No bucket creation, ACL changes or credentials stored in this module. It does
delete, but only ever the immutable objects the pointer manifest it has just
replaced referenced and the new one does not: nothing a live manifest points at
can be in that set, and nothing is listed to find it.

The backend is AWS S3 or any S3-compatible store; Cloudflare R2 is selected by
passing an endpoint URL. Credentials come from the standard environment chain.

Bundle kinds (`kind`, default "wind" when absent, all at schemaVersion 1):

- wind  frames of u/v/gust grids plus `spotForecasts`. Optional `gustKind`
        ("interval", the default, or "instantaneous") and `ensemble`/`spotMembers`.
- wave  `spotSeries` per riding location plus optional frames of one array per
        gridded variable. `frames` may be empty, and `horizonHours` then declares
        the horizon the series covers; `frameVariables` may narrow the frames to a
        subset of `variables`.
- weather  the same shape as wave, for surface variables (temperature,
        precipitation, cloud, pressure, humidity, visibility, CAPE). A variable
        may declare `"kind": "code"`, making its values whole code-table entries
        rather than measurements, so no range check applies to them.
- tide  a station manifest plus immutable per-station prediction files.
- observation  in-situ measurements rather than a forecast: stations, a per-spot
        nearest-station assignment with its latest reading and a recent series, and
        no immutable objects at all, because the whole bundle is one small file.
        `run` is the newest observation hour, so the freshness limit measures the
        age of the data.
"""
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import sys
from cadence import expected_hours
import f5bin
from prune import ARCHIVE_DIRECTORY, delete_keys, manifest_urls, model_owns
from registry import MANIFESTS, MODELS, object_root

MAX_HEIGHT_METRES = 8.0  # Tidal range above LAT; no Irish station approaches this.
MIN_HEIGHT_METRES = -1.0
# How large a measurement a variables bundle may publish: metres and seconds for
# waves, but a weather bundle carries hectopascals, millimetres and J/kg as well.
VARIABLE_LIMITS = {"wave": 1000, "weather": 100_000}
MAX_CODE = 1000  # A code-table entry is a small whole number, never a measurement.
# Sea water: below freezing point at salinity, above anything Irish waters reach.
OBSERVATION_MIN_CELSIUS, OBSERVATION_MAX_CELSIUS = -2.0, 35.0
OBSERVATION_SKEW_SECONDS = 300  # Clock skew allowance; no observation is from the future.
OBSERVATION_NETWORKS = ("coastal", "sentinel", "buoy")

IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
POINTER_CACHE = "public, max-age=0, s-maxage=60, must-revalidate"
# The condition held but the object was already there. This is the normal answer.
PRECONDITION_CODES = ("PreconditionFailed", "412", "ConditionalRequestConflict", "409")
# A different answer entirely: the backend says it does not implement the feature.
# Deliberately narrow. `InvalidArgument`/`InvalidRequest` are *not* here: they also
# cover a malformed request, and treating one as "no conditional writes" would throw
# away the compare-and-swap on a bug. R2's real answer is unverified (no credentials
# exist yet) and must be confirmed against a live bucket before this list is trusted;
# anything else still fails the job loudly, which is the right way round.
UNSUPPORTED_CONDITION_CODES = ("NotImplemented", "501")
MISSING_CODES = ("NoSuchKey", "NotFound", "404")


def error_code(error):
    return getattr(error, "response", {}).get("Error", {}).get("Code", "")


def log_event(event, error=None, **fields):
    """One JSON line, as the worker logs. Never carries credentials: only keys and counts."""
    payload = {"event": event, **fields}
    if error is not None:
        payload["error"] = str(error)
    print(json.dumps(payload), file=sys.stderr if error is not None else sys.stdout, flush=True)


def object_prefix(prefix):
    """Normalise an optional bucket prefix, refusing anything that is not relative."""
    if prefix and (prefix.startswith("/") or ".." in PurePosixPath(prefix).parts):
        raise ValueError("S3 prefix must be a relative object prefix")
    return prefix.rstrip("/") + "/" if prefix else ""


def make_client(endpoint_url=None, region=None):
    """A boto3 S3 client; an endpoint URL points it at Cloudflare R2 instead of AWS.

    Credentials stay in the standard AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY chain
    and are never read, copied or logged here. R2 ignores the region while boto3
    insists on having one, so an endpoint without an explicit region gets "auto".
    """
    import boto3
    from botocore.config import Config
    return boto3.client("s3", endpoint_url=endpoint_url or None,
                        region_name=region or ("auto" if endpoint_url else None),
                        config=Config(retries={"mode": "standard", "max_attempts": 5},
                                      connect_timeout=15, read_timeout=90))


def number(value, limit, minimum=None):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and abs(value) <= limit
            and (minimum is None or value >= minimum))


def whole(value):
    return isinstance(value, int) and not isinstance(value, bool)


def valid_time(run, hour):
    return (run + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")


def referenced(public, url, model, depth):
    """Read an immutable object the manifest points at, refusing unsafe paths.

    The run directory (or station file) must also be **named for this model**,
    by the same rule `prune.model_owns` applies — the rule the superseded delete
    and the bucket sweep already assume. Without it a manifest could reference an
    object under another model's directory: the JSON frames caught that through
    the `model` field inside the frame, but `object_root` is "weather" for every
    wind model, so the path itself never said who owned it. Two things then go
    wrong at once — this model uploads objects into another's namespace, and that
    other model's next publish deletes them out from under a live pointer.
    """
    path = PurePosixPath(url)
    root = object_root(model)
    if path.is_absolute() or ".." in path.parts or len(path.parts) != depth or path.parts[0] != root:
        raise ValueError("Unsafe object path")
    if not model_owns(model, path.parts[1]):
        raise ValueError(f"{url} is not named for {model}")
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
    # Wave and weather bundles are the same shape: declared variables, optional
    # frames of one array each, and a precomputed series per riding location.
    if kind != "wind" and manifest.get("encoding") is not None:
        raise ValueError("Only wind frames may declare a binary encoding")
    validator = {"wind": validate_wind_bundle, "wave": validate_variables_bundle,
                 "weather": validate_variables_bundle, "tide": validate_tide_bundle,
                 "observation": validate_observation_bundle}[kind]
    return manifest, body, validator(public, model, manifest, run, now)


def frame_encoding(manifest):
    """Which frame encoding a manifest declares. Absent is the original JSON."""
    encoding = manifest.get("encoding")
    if encoding is not None and encoding != f5bin.ENCODING:
        raise ValueError(f"Unknown frame encoding {encoding!r}")
    return encoding


def wind_frame(data, encoding, model, manifest, grid, info, hour, valid):
    """One wind frame as a dict, from JSON bytes or from an F5 int16 body.

    What a binary frame proves about itself, and what it cannot:

    - **run, forecast hour, grid size**: in the header, checked here.
    - **model**: *not* in the file. It is established by the path instead —
      `referenced()` has already required the run directory to be named for this
      model — and by the content hash below, which proves the bytes are the ones
      published under that name. The dict returned therefore carries the model it
      was asked about, and the `frame.get("model") != model` check downstream is
      a tautology for a binary frame; the path check is what stands in for it.
    - **valid time and grid geometry**: not in the file either. The manifest
      declares them, and `validate_bundle` has already checked the manifest's own
      run/hour/validTime arithmetic, so they are filled in from it here.
    - **gust window**: not in the file. Only the *presence* of the gust block is
      checkable, and it is, immediately below and again downstream: a frame with
      no window must carry no gust block, and one with a window must carry it.
    """
    if encoding is None:
        return json.loads(data)
    decoded = f5bin.decode_frame(data)
    if ((decoded["run"], decoded["hour"], decoded["width"], decoded["height"])
            != (manifest["run"], hour, grid["width"], grid["height"])):
        raise ValueError("Mixed model/run/frame metadata")
    # A content-addressed name is checkable in a way a JSON frame's never was:
    # these bytes must be the ones published under this name, at this hour.
    if not f5bin.names_these_bytes(PurePosixPath(info["url"]).name, hour, data):
        raise ValueError(f"{info['url']} does not hold the frame its name claims")
    # The window lives only in the manifest, so this is the one thing the two can
    # still be made to agree about: no window means no gust block, and vice versa.
    if (info.get("gustIntervalHours") is None) != (decoded["gust"] is None):
        raise ValueError("Gust block does not match the published gust period")
    return {"model": model, "run": decoded["run"], "hour": decoded["hour"],
            "validTime": valid, "grid": grid,
            "gustIntervalHours": info.get("gustIntervalHours"),
            "u": decoded["u"], "v": decoded["v"], "gust": decoded["gust"]}


def validate_wind_bundle(public, model, manifest, run, now):
    frames, grid = manifest["frames"], manifest.get("grid")
    encoding = frame_encoding(manifest)
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
        path, data = referenced(public, info["url"], model, 3)
        hour = hours[index]
        valid = valid_time(run, hour)
        if (info["hour"], info["validTime"]) != (hour, valid):
            raise ValueError("Incomplete or misordered forecast")
        frame = wind_frame(data, encoding, model, manifest, grid, info, hour, valid)
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
    missing_gust_hours = manifest.get("gustMissingHours", [])
    gust_available = manifest.get("gustAvailable") is not False
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
            gust_missing = not gust_available or hour in missing_gust_hours
            for field in ("u", "v", "gust"):
                values = step.get(field)
                if not isinstance(values, list) or len(values) != members:
                    raise ValueError(f"Expected {members} {field} members for {spot}")
                if field == "gust" and gust_missing:
                    # Members may not carry a gust where the mean declares none.
                    if any(value is not None for value in values):
                        raise ValueError(f"Unexpected gust members for {spot} at +{hour}h")
                    continue
                if not all(number(value, 150, 0 if field == "gust" else None) for value in values):
                    raise ValueError(f"Invalid {field} member value for {spot}")
        horizon = datetime.fromisoformat(steps[-1]["validTime"].replace("Z", "+00:00"))
        last = horizon if last is None else min(last, horizon)
    return last


def variable_value(value, name, codes, limit):
    """One published cell or spot value: null, a code-table entry, or a measurement."""
    if value is None:
        return True  # Land, an unresolved cell or an hour with no interval.
    if name in codes:
        return whole(value) and 0 <= value < MAX_CODE
    return number(value, limit)


def validate_variables_bundle(public, model, manifest, run, now):
    """A wave or weather bundle: declared variables, optional frames, spot series."""
    kind = manifest.get("kind", "wave")
    limit = VARIABLE_LIMITS[kind]
    variables = manifest.get("variables")
    if not isinstance(variables, dict) or not variables:
        raise ValueError(f"A {kind} manifest must declare its variables")
    for name, meta in variables.items():
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,31}", name) or not isinstance(meta, dict):
            raise ValueError(f"Invalid {kind} variable {name!r}")
        if any(not isinstance(meta.get(key), str) or not meta[key].strip()
               for key in ("units", "label", "description")):
            raise ValueError(f"Variable {name} needs units, label and description")
        if meta.get("kind") not in (None, "code"):
            raise ValueError(f"Unknown variable kind for {name}")
    # A code variable is an index into a code table (WMO present weather), so it is
    # checked for being a whole small number instead of for a physical range.
    codes = {name for name, meta in variables.items() if meta.get("kind") == "code"}
    frames = manifest["frames"]
    hours = expected_hours(manifest)
    horizon = manifest.get("horizonHours")
    if horizon is not None and horizon != hours[-1]:
        raise ValueError(f"Declared {kind} horizon does not match the published cadence")
    if not frames:
        # Frames are optional: the precomputed spot series is the product, and a full
        # gridded run is far larger than a site showing beach series needs.
        validate_spot_series(manifest.get("spotSeries"), variables, hours, run, codes, limit)
        if run + timedelta(hours=hours[-1]) <= now:
            raise ValueError(f"The {kind} horizon has already expired")
        return []
    grid = manifest["grid"]
    if len(frames) != len(hours):
        raise ValueError(f"Empty {kind} forecast or unsupported cadence")
    # Frames may carry a declared subset: a map needs fewer fields than a spot series.
    gridded = manifest.get("frameVariables", list(variables))
    if (not isinstance(gridded, list) or not gridded or len(set(gridded)) != len(gridded)
            or not set(gridded) <= set(variables)):
        raise ValueError("Frame variables must be a distinct subset of the declared variables")
    count = grid_count(grid)
    objects = []
    for index, info in enumerate(frames):
        path, data = referenced(public, info["url"], model, 3)
        frame = json.loads(data)
        hour = hours[index]
        valid = valid_time(run, hour)
        if (info["hour"], info["validTime"]) != (hour, valid):
            raise ValueError(f"Incomplete or misordered {kind} forecast")
        if any(frame.get(k) != v for k, v in {"model": model, "run": manifest["run"],
               "grid": grid, "hour": hour, "validTime": valid}.items()):
            raise ValueError("Mixed model/run/frame metadata")
        for name in gridded:
            values = frame.get(name)
            # Land, unresolved cells and hours with no interval are null; never zero.
            if not isinstance(values, list) or len(values) != count or not all(
                    variable_value(value, name, codes, limit) for value in values):
                raise ValueError(f"Invalid {name} field")
        objects.append((path, data))
    validate_spot_series(manifest.get("spotSeries"), variables, hours, run, codes, limit)
    if datetime.fromisoformat(frames[-1]["validTime"].replace("Z", "+00:00")) <= now:
        raise ValueError(f"The {kind} horizon has already expired")
    return objects


def validate_spot_series(series, variables, hours, run, codes=frozenset(), limit=1000):
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
            if not all(variable_value(value, name, codes, limit)
                       for name, value in values.items()):
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
        path, data = referenced(public, station["url"], model, 2)
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


def observation_time(value, now, label):
    """A parseable instant that is not in the future; observations only look back."""
    if not isinstance(value, str):
        raise ValueError(f"{label} has no observation time")
    try:
        at = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{label} has an unparseable time {value!r}") from error
    if at.tzinfo is None:
        raise ValueError(f"{label} time {value!r} has no time zone")
    if (at - now).total_seconds() > OBSERVATION_SKEW_SECONDS:
        raise ValueError(f"{label} is dated in the future")
    return at


def observation_value(value, label):
    if not (number(value, 100)
            and OBSERVATION_MIN_CELSIUS <= value <= OBSERVATION_MAX_CELSIUS):
        raise ValueError(f"{label} is not a plausible sea temperature")
    return value


def validate_observation_bundle(public, model, manifest, run, now):
    """Measurements, not predictions: one self-contained file, no immutable objects.

    `run` is the newest observation hour the manifest publishes, which is what makes
    the registry's freshness limit mean "how old is the newest reading".
    """
    stations, spots = manifest.get("stations"), manifest.get("spots")
    variable = manifest.get("variable")
    if not isinstance(stations, dict) or not stations or not isinstance(spots, dict) or not spots:
        raise ValueError("Observation manifests need stations and spot assignments")
    if not isinstance(variable, dict) or not isinstance(variable.get("units"), str) \
            or not variable["units"].strip() or not isinstance(variable.get("label"), str):
        raise ValueError("An observation manifest must declare its variable and units")
    step = manifest.get("stepMinutes")
    if not whole(step) or not 1 <= step <= 1440:
        raise ValueError("An observation manifest must declare a usable series step")
    newest = None
    for identifier, station in stations.items():
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", identifier):
            raise ValueError(f"Invalid station id {identifier!r}")
        if not isinstance(station, dict) or not isinstance(station.get("name"), str) \
                or not station["name"].strip():
            raise ValueError(f"Station {identifier} needs a name")
        if not (number(station.get("lat"), 90) and number(station.get("lon"), 180)):
            raise ValueError(f"Station {identifier} has no valid position")
        if station.get("network") not in OBSERVATION_NETWORKS:
            raise ValueError(f"Station {identifier} declares an unknown network")
        depth = station.get("depth")
        if depth is not None and not number(depth, 12_000, 0):
            raise ValueError(f"Station {identifier} has an implausible sensor depth")
        latest = station.get("latest")
        if not isinstance(latest, dict):
            raise ValueError(f"Station {identifier} publishes no latest reading")
        at = observation_time(latest.get("time"), now, f"Station {identifier}")
        observation_value(latest.get("value"), f"Station {identifier} latest value")
        newest = at if newest is None else max(newest, at)
    if newest.replace(minute=0, second=0, microsecond=0) != run:
        raise ValueError("Run is not the newest published observation hour")
    for spot, assignment in spots.items():
        if not isinstance(assignment, dict):
            raise ValueError(f"Spot {spot} has no assignment")
        station = assignment.get("station")
        if station is None:
            if not isinstance(assignment.get("reason"), str) or not assignment["reason"].strip():
                raise ValueError(f"Spot {spot} needs a reason for having no sea temperature")
            continue
        if station not in stations or not number(assignment.get("distanceKm"), 1000, 0):
            raise ValueError(f"Spot {spot} refers to an unknown station or distance")
        latest = assignment.get("latest")
        if not isinstance(latest, dict):
            raise ValueError(f"Spot {spot} publishes no latest reading")
        at = observation_time(latest.get("time"), now, f"Spot {spot}")
        observation_value(latest.get("value"), f"Spot {spot} latest value")
        series = assignment.get("series")
        if not isinstance(series, list) or not series:
            raise ValueError(f"Spot {spot} publishes no recent series")
        previous = None
        for entry in series:
            if not isinstance(entry, dict):
                raise ValueError(f"Spot {spot} has an unusable series entry")
            when = observation_time(entry.get("time"), now, f"Spot {spot} series")
            if previous is not None and when <= previous:
                raise ValueError(f"Spot {spot} series is not in increasing time order")
            previous = when
            observation_value(entry.get("value"), f"Spot {spot} series value")
        if previous > at:
            raise ValueError(f"Spot {spot} series runs past its own latest reading")
    # The whole bundle is the pointer manifest; there is nothing immutable to upload.
    return []


def no_collision(s3, bucket, key, digest, error=None):
    """An existing immutable key is only acceptable when it holds exactly these bytes."""
    existing = s3.head_object(Bucket=bucket, Key=key)
    if existing.get("Metadata", {}).get("sha256") != digest:
        raise ValueError(f"Immutable object collision: {key}") from error


def bucket_encoding(chosen=None):
    """Which compression a binary frame is stored under: brotli unless asked otherwise.

    One encoding per object, so there are never `.br`/`.gz` sidecars in the
    bucket — those exist only on the local Caddy deployment's disk. Brotli is the
    default because every browser that reaches the data domain over HTTPS accepts
    it; `FORCE5_BUCKET_ENCODING=gzip` is the way back if a CDN ever mangles it.
    """
    encoding = chosen or os.environ.get("FORCE5_BUCKET_ENCODING") or "br"
    if encoding not in ("br", "gzip"):
        raise ValueError(f"Unsupported bucket content encoding {encoding!r}")
    return encoding


def sidecar_body(source, suffix, body):
    """The `.br`/`.gz` the ingest job already wrote for this frame, if it is sound.

    The adapters compress every frame once for the local Caddy deployment. Doing
    it again here would double the brotli cost of a run that both serves locally
    and uploads, so the file on disk is reused — but only after decompressing it
    and confirming it is exactly these bytes. That costs a brotli *decompress*,
    about half a millisecond for a HARMONIE frame, instead of a *compress*, about
    nineteen; and it means a stale, truncated or half-written sidecar can never
    be uploaded as though it were the frame. Anything unreadable, absent or
    different falls through to compressing here, which is always correct.
    """
    if source is None:
        return None
    path = Path(str(source) + suffix)
    try:
        stored = path.read_bytes()
    except OSError:
        return None
    try:
        if suffix == ".gz":
            plain = gzip.decompress(stored)
        else:
            import brotli
            plain = brotli.decompress(stored)
    except Exception as error:
        log_event("sidecar_unusable", key=str(path), error=error)
        return None
    return stored if plain == body else None


def object_body(key, body, encoding=None, source=None):
    """The bytes to store for one immutable object, with its type and encoding.

    A `.bin` frame is stored brotli- or gzip-encoded and served as binary; every
    other object is JSON and stays gzip-encoded exactly as it always has been.
    One encoding per object either way — the sidecars are never objects.
    """
    if not key.endswith(".bin"):
        return gzip.compress(body, mtime=0), "application/json", "gzip"
    suffix = ".gz" if bucket_encoding(encoding) == "gzip" else ".br"
    stored = sidecar_body(source, suffix, body)
    if stored is None:
        stored = (gzip.compress(body, mtime=0) if suffix == ".gz"
                  else f5bin.brotli_body(body))
    return stored, "application/octet-stream", "br" if suffix == ".br" else "gzip"


def put_immutable(s3, bucket, key, body, state=None, encoding=None, source=None):
    """Write bytes that must never change again, refusing to overwrite different ones.

    `IfNoneMatch="*"` does this in one request and is the only path on AWS S3. A
    backend that does not implement it says so by rejecting the header, and then a
    head + sha256 compare + plain put gives the same guarantee in two requests.
    `state` remembers that answer for the rest of a publish, so a 250-frame ECMWF
    run does not pay the extra round trip 250 times over.

    The sha256 recorded in the object's metadata is always taken over the
    **uncompressed** bytes, so the collision check above compares frames rather
    than compressors: change the compression and the same frame still matches.
    """
    digest = hashlib.sha256(body).hexdigest()
    stored, content_type, content_encoding = object_body(key, body, encoding, source)
    args = {"Bucket": bucket, "Key": key, "Body": stored,
            "ContentType": content_type, "ContentEncoding": content_encoding,
            "CacheControl": IMMUTABLE_CACHE, "Metadata": {"sha256": digest}}
    state = {} if state is None else state
    if state.get("conditional", True):
        try:
            s3.put_object(**args, IfNoneMatch="*")
            return
        except Exception as error:
            code = error_code(error)
            if code in PRECONDITION_CODES:
                return no_collision(s3, bucket, key, digest, error)
            if code not in UNSUPPORTED_CONDITION_CODES:
                raise
            state["conditional"] = False
            log_event("conditional_put_unsupported", key=key, code=code)
    try:
        s3.head_object(Bucket=bucket, Key=key)
    except Exception as error:
        if error_code(error) not in MISSING_CODES:
            raise
    else:
        # Present already: the collision check is the whole point, so keep it.
        return no_collision(s3, bucket, key, digest)
    s3.put_object(**args)


def read_current(s3, bucket, key):
    """The pointer manifest the bucket serves now, with its ETag for compare-and-swap.

    A pointer that is present but unparseable is reported as absent: the next good
    run then republishes over it (still conditionally, on its ETag), and because
    the caller learns nothing about what it referenced, nothing is deleted from it.
    """
    try:
        response = s3.get_object(Bucket=bucket, Key=key)
    except Exception as error:
        if error_code(error) in MISSING_CODES:
            return None, None
        raise
    body = response["Body"].read()
    if response.get("ContentEncoding") == "gzip":
        body = gzip.decompress(body)
    try:
        return json.loads(body), response["ETag"]
    except ValueError as error:
        log_event("unreadable_pointer", key=key, error=error)
        return None, response["ETag"]


def superseded_objects(model, previous, manifest):
    """Immutable objects the manifest we are replacing referenced and the new one does not.

    Five guards, because this is the only code in the pipeline that deletes from the
    bucket: the source is one model's own previous pointer (never a listing, so an
    upload in flight for another model is invisible to it); anything the new manifest
    still references is excluded first; the path must sit under that model's object
    root; its run directory or station file must be named for this model and for no
    other, which every adapter satisfies (`weather/ecmwf-RUN-360h-v2/…`,
    `marine/tides-STATION-…json`) — "harmonie" must not match "harmonie-eps", nor
    "gfs" match "gfs-wave"; and pointer manifests and the archive directory are never
    touched. An adapter that ever stops using that naming simply stops deleting, and
    the bucket sweep collects its leftovers instead: the safe direction to fail in.
    """
    if not isinstance(previous, dict) or previous.get("model") != model:
        return []
    keep, root = manifest_urls(manifest), object_root(model)
    pointers = set(MANIFESTS.values())
    stale = []
    for url in sorted(manifest_urls(previous) - keep):
        parts = PurePosixPath(url).parts
        if not 2 <= len(parts) <= 3 or parts[0] != root or ".." in parts:
            continue  # Not one of ours to delete; an absolute or foreign URL is left alone.
        if url in pointers or parts[1] == ARCHIVE_DIRECTORY or not model_owns(model, parts[1]):
            continue
        stale.append(url)
    return stale


def drop_superseded_objects(s3, bucket, prefix, model, previous, manifest):
    """Delete the replaced run's objects. Never fails the forecast that just published."""
    stale = superseded_objects(model, previous, manifest)
    if not stale:
        return 0
    try:
        deleted = delete_keys(s3, bucket, [prefix + url for url in stale])
    except Exception as error:
        # The forecast is live; these objects are only cost. The bucket sweep gets them.
        log_event("superseded_delete_failed", model=model, objects=len(stale), error=error)
        return 0
    log_event("superseded_deleted", model=model, run=previous.get("run"), objects=deleted)
    return deleted


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
        # A diagnostic run with fewer members must not replace a fuller ensemble.
        if (current.get("ensemble") or {}).get("members", 0) > (incoming.get("ensemble") or {}).get("members", 0):
            return True
        return same_manifest(current, incoming)
    return False


def same_manifest(current, incoming):
    """The published pointer is byte-for-byte this bundle, give or take when it was made."""
    return bool(current) and {k: v for k, v in current.items() if k != "generatedAt"} == {
        k: v for k, v in incoming.items() if k != "generatedAt"}


def publish(s3, public, model, bucket, prefix="", max_age_hours=12, now=None, encoding=None):
    prefix = object_prefix(prefix)
    bucket_encoding(encoding)  # Refuse an unusable choice before anything is uploaded.
    f5bin.brotli_quality()  # Likewise an unusable compression level.
    public = Path(public).resolve()
    manifest, body, objects = validate_bundle(public, model, max_age_hours, now)
    pointer = prefix + MANIFESTS[model]
    replaced, _ = read_current(s3, bucket, pointer)
    if already_current(replaced, manifest):
        return "unchanged-or-newer"
    state = {}  # Whether this backend honours conditional puts; answered once per publish.
    for path, data in objects:
        # The local file too, so a frame the adapter already compressed is
        # uploaded from its sidecar instead of being compressed a second time.
        put_immutable(s3, bucket, prefix + path, data, state, encoding, public / path)
    archive = (f"{object_root(model)}/manifests/{model}/"
               f"{manifest['run']}-{hashlib.sha256(body).hexdigest()[:16]}.json")
    put_immutable(s3, bucket, prefix + archive, body, state, encoding)
    for _ in range(4):
        current, etag = read_current(s3, bucket, pointer)
        if already_current(current, manifest):
            if same_manifest(current, manifest):
                # Our own bundle is up there although we never saw the answer: a PUT
                # that succeeded server-side and then reported PreconditionFailed on a
                # retry. The pointer is in place, so the run it replaced is still ours
                # to delete; without this it would leak until the next bucket sweep.
                drop_superseded_objects(s3, bucket, prefix, model, replaced, manifest)
            return "unchanged-or-newer"
        replaced = current  # The newest manifest we have seen that this publish replaces.
        condition = {"IfMatch": etag} if etag else {"IfNoneMatch": "*"}
        try:
            # The only mutable object. Publish LAST using compare-and-swap.
            s3.put_object(Bucket=bucket, Key=pointer, Body=body,
                          ContentType="application/json", CacheControl=POINTER_CACHE, **condition)
        except Exception as error:
            code = error_code(error)
            if code in PRECONDITION_CODES:
                continue
            if code not in UNSUPPORTED_CONDITION_CODES:
                raise
            # The backend has no conditional writes at all, so this write gives up the
            # compare-and-swap. We re-read the pointer immediately above and only one
            # job per model runs at a time, but it is a real downgrade: log it as one.
            log_event("conditional_put_unsupported", key=pointer, code=code)
            log_event("pointer_put_unconditional", model=model, key=pointer,
                      note="Compare-and-swap unavailable on this backend")
            s3.put_object(Bucket=bucket, Key=pointer, Body=body,
                          ContentType="application/json", CacheControl=POINTER_CACHE)
        # The new pointer is in place. Only now is the one it replaced junk, and only
        # now can deleting what it referenced not break a manifest anybody can read.
        drop_superseded_objects(s3, bucket, prefix, model, replaced, manifest)
        return "published"
    raise RuntimeError("Manifest changed repeatedly during publish; retry the job")
