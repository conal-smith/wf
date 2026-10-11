"""Validate a local snapshot; publish immutable objects before its S3 pointer.

No bucket creation, ACL changes or credentials stored in this module. It does
delete, but only ever what the pointer manifest it has just replaced named and
the new one does not: the superseded run directory, listed by its own prefix, or
the station files a tide manifest no longer references. Nothing a live manifest
points at can be in that set.

The backend is AWS S3 or any S3-compatible store; Cloudflare R2 is selected by
passing an endpoint URL. Credentials come from the standard environment chain.

The forecast kinds (wind, wave, weather) are **runs** at schemaVersion 2: the
pointer names one run directory, `base`, beside itself, and everything the run
publishes is inside it (rundir.py): its frames, at urls relative to `base`, and
its per-spot data in one file per 2° spot square, listed under `spots`
(squares.py). The directory's name ends in the hash of its content, which the
validator recomputes, and it must hold exactly the files the manifest names.
The per-spot keys below are read from the squares and checked as before.

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

The other kinds are at schemaVersion 1 and are single files, or (tide) a pointer
and its station files:

- tide  a station manifest plus immutable per-station prediction files.
- observation  in-situ measurements rather than a forecast: stations, a per-spot
        nearest-station assignment with its latest reading and a recent series, and
        no immutable objects at all, because the whole bundle is one small file.
        `run` is the newest observation hour, so the freshness limit measures the
        age of the data. `"observes": "wind"` is the wind variant: stations with
        a class and a window of [time, speed, gust, direction] readings, and no
        spot assignments, because it exists to verify forecasts.
- archive  the forecast archive job's summary of what it has copied under
        `archive/` (archive.py); it points at nothing the pruner could delete.
- verification  the forecast verification scores (verify.py), one small file.
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
import f5tile
from prune import (ARCHIVE_DIRECTORY, bucket_keys, delete_keys, is_archived, manifest_urls,
                   model_owns, run_directory)
from registry import MANIFESTS, MODELS, object_root
import rundir
from squares import SCHEMA_VERSION as RUN_SCHEMA, SPOT_KEYS, check_base, load_spot_data, run_path

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
# Wind observations: station exposure classes and physical limits, in m/s.
WIND_OBSERVATION_CLASSES = ("buoy", "coastal", "inland")
WIND_OBSERVATION_MAX_SPEED, WIND_OBSERVATION_MAX_GUST = 75.0, 90.0
WIND_OBSERVATION_GUST_SLACK = 0.15  # The adapter's own rounding allowance, plus 0.1 m/s rounding.

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
# Kinds published as a run directory and a schemaVersion 2 pointer.
RUN_KINDS = ("wind", "wave", "weather")


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

    The station file must also be **named for this model**, by the same rule
    `prune.model_owns` applies — the rule the superseded delete and the bucket
    sweep already assume. Without it a manifest could reference an object of
    another model's: `object_root` is shared, so the path itself would not say
    who owned it, this model would upload into another's namespace, and that
    other model's next publish would delete it out from under a live pointer.
    A run's files are read by `run_files`, which applies the same rule to its
    directory.
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


def run_files(public, model, manifest):
    """Every file of the run directory a schemaVersion 2 pointer names, checked.

    The directory must sit beside the pointer, be named for this model (the rule
    `prune.model_owns` applies, so "harmonie" never claims "harmonie-eps-…"),
    hash to the name it carries, and hold exactly the frames (a wind run's tiles)
    and spot squares the manifest names: nothing missing, and nothing extra that
    would be uploaded and served under a run that never mentions it. Returns
    {path inside the run: bytes}.
    """
    base = check_base(manifest.get("base"))
    if not model_owns(model, base[:-1]):
        raise ValueError(f"{base} is not named for {model}")
    pointer = PurePosixPath(MANIFESTS[model]).parent
    directory = (public / str(pointer) / base[:-1]).resolve()
    if public not in directory.parents or not directory.is_dir():
        raise ValueError(f"Run directory {base} is missing")
    files = rundir.content_files(directory)
    if rundir.digest(files) != rundir.hash_of(base):
        raise ValueError(f"{base} does not hold the content its name claims")
    index = manifest.get("spots") or {}
    named = {frame.get("url") for frame in manifest.get("frames") or []
             if "tiles" not in manifest} | {
        str(index.get("url", "")).replace("{square}", square)
        for square in index.get("squares") or []}
    if "tiles" in manifest:
        # A tiled run's frames are every tile its `tiles` block does not call absent.
        named |= set(f5tile.run_tiles(manifest))
    for url in named:
        run_path(base, url)
    if set(files) != named:
        extra, missing = sorted(set(files) - named), sorted(named - set(files))
        raise ValueError(f"Run directory {base} does not match its manifest: "
                         f"unreferenced {extra[:3]}, missing {missing[:3]}")
    return files


def run_file(public, model, manifest, relative):
    """One file of a published run, by its path inside the run directory.

    The same guards as `run_files` without hashing the whole directory: for a
    reader that wants one frame of a run that has already been validated.
    Returns its published path and its bytes.
    """
    base = check_base(manifest.get("base"))
    if not model_owns(model, base[:-1]):
        raise ValueError(f"{base} is not named for {model}")
    path = f"{PurePosixPath(MANIFESTS[model]).parent}/{run_path(base, relative)}"
    source = (public / path).resolve()
    if public not in source.parents:
        raise ValueError("Object path escapes output directory")
    return path, source.read_bytes()


def run_bundle(public, model, manifest):
    """A run's pointer, its files, and the manifest with its spot squares merged in."""
    if manifest.get("schemaVersion") != RUN_SCHEMA:
        raise ValueError(f"A {manifest.get('kind', 'wind')} manifest must be schemaVersion "
                         f"{RUN_SCHEMA}")
    inline = [key for key in SPOT_KEYS if key in manifest]
    if inline:
        raise ValueError(f"Per-spot data belongs in the spot squares, not the pointer: {inline}")
    files = run_files(public, model, manifest)
    base = manifest["base"]

    def read_json(path):
        return json.loads(files[path[len(base):]])

    whole = {**manifest, **load_spot_data(manifest, read_json)}
    pointer = PurePosixPath(MANIFESTS[model]).parent
    objects = [(f"{pointer}/{base}{path}", data) for path, data in sorted(files.items())]
    return whole, files, objects


def frame_file(files, info, hour, suffix):
    """A wave or weather frame's bytes, at the one name its hour may have inside the run."""
    if info.get("url") != f"{rundir.FRAMES}/{hour:03d}.{suffix}":
        raise ValueError(f"Frame +{hour}h is published as {info.get('url')!r}")
    return files[info["url"]]


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
    if manifest.get("encoding") is not None:
        raise ValueError("Whole-frame encodings are retired: wind frames are published as tiles")
    if kind != "wind" and manifest.get("tiles") is not None:
        raise ValueError("Only wind frames are published as tiles")
    if kind in RUN_KINDS:
        # The run's own checks read the spot data from its squares, merged back in
        # exactly as the adapter held it, and every file of the run is uploaded.
        whole, files, objects = run_bundle(public, model, manifest)
        validator = validate_wind_bundle if kind == "wind" else validate_variables_bundle
        validator(files, model, whole, run, now)
        return manifest, body, objects
    validator = {"tide": validate_tide_bundle,
                 "observation": validate_observation_bundle, "blend": validate_blend_bundle,
                 "archive": validate_archive_bundle,
                 "verification": validate_verification_bundle}[kind]
    return manifest, body, validator(public, model, manifest, run, now)


def validate_wind_bundle(files, model, manifest, run, now):
    """A wind run: `manifest` with its squares merged in, `files` its run directory.

    Its frames are tiles (f5tile.py): the `tiles` block must match the grid,
    every tile it does not call absent must be there for every hour (which
    `run_files` has already required), and each tile must say in its header the
    run, hour, level and place it is published as, carry a gust block exactly
    where the frame has a gust window, hold only plausible values, and at level
    0 leave no cell of the grid missing.
    """
    frames, grid = manifest["frames"], manifest.get("grid")
    ensemble = manifest.get("ensemble")
    last = validate_ensemble(manifest, ensemble, run) if ensemble is not None else None
    gust_kind = manifest.get("gustKind", "interval")
    if gust_kind not in ("interval", "instantaneous"):
        raise ValueError("Unknown gust kind")
    missing_gust_hours = manifest.get("gustMissingHours", [])
    if missing_gust_hours not in ([], [0]):
        raise ValueError("Only initialization gusts may be explicitly missing")
    if not isinstance(manifest.get("spotForecasts"), dict):
        raise ValueError("A wind run publishes spotForecasts")
    if not frames:
        # Only an ensemble may publish spot series without map frames.
        if ensemble is None:
            raise ValueError("Empty forecast or unsupported cadence")
        if manifest.get("tiles") is not None:
            raise ValueError("A run without frames has no tiles")
        if last <= now:
            raise ValueError("Forecast horizon has already expired")
        # The pointer alone says how far a frameless run reaches (squares.py).
        reach = [steps[-1]["hour"] for key in ("spotForecasts", "spotMembers")
                 for steps in (manifest.get(key) or {}).values() if steps]
        if manifest.get("horizonHours") != (max(reach) if reach else None):
            raise ValueError("Declared horizon does not match the spot series")
        return
    hours = expected_hours(manifest)
    if len(frames) != len(hours):
        raise ValueError("Empty forecast or unsupported cadence")
    grid_count(grid)
    if manifest.get("tiles") is None:
        raise ValueError("A wind run's frames are published as tiles")
    tiles = f5tile.check_tiles(manifest)
    # A wind field has a value at every cell of its grid, so no native tile that
    # owns part of the grid can be empty at every hour.
    for x, y in tiles["levels"][0]["absent"]:
        if f5tile.owns_domain(grid, 0, x, y, tiles["size"]):
            raise ValueError(f"Tile 0/{x}/{y} is absent but holds part of the grid")
    for index, info in enumerate(frames):
        hour = hours[index]
        valid = valid_time(run, hour)
        if (info.get("hour"), info.get("validTime")) != (hour, valid):
            raise ValueError("Incomplete or misordered forecast")
        if "url" in info:
            raise ValueError(f"Frame +{hour}h names a url; a wind frame is its tiles")
        gust_missing = manifest.get("gustAvailable") is False or hour in missing_gust_hours
        interval = info.get("gustIntervalHours")
        if not gust_missing:
            if (not isinstance(interval, list) or len(interval) != 2
                    or not all(whole(x) for x in interval)
                    or interval[0] < 0 or interval[0] > interval[1] or interval[1] != hour):
                raise ValueError("Invalid or mismatched gust interval")
            if gust_kind == "instantaneous":
                # A surface gust read at the valid time, not a period maximum.
                if interval[0] != hour:
                    raise ValueError("Instantaneous gusts declare a zero-length interval")
            elif hour > 0 and interval[0] == interval[1]:
                raise ValueError("Invalid or mismatched gust interval")
        elif interval is not None:
            raise ValueError("Unavailable gusts cannot declare a period")
    for path, (level, x, y, info) in sorted(f5tile.run_tiles(manifest).items()):
        data = files[path]
        # The header says which run, hour, tile and gust period the bytes are;
        # decoding refuses implausible values and a negative gust.
        header = f5tile.check_tile(data, manifest, level, x, y, info)
        blocks = f5tile.decode_blocks(data)
        if level == 0 and not f5tile.covers_domain(header, blocks, grid):
            raise ValueError(f"Tile {path} leaves part of the grid missing")
    if datetime.fromisoformat(frames[-1]["validTime"].replace("Z", "+00:00")) <= now:
        raise ValueError("Forecast horizon has already expired")


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


def validate_variables_bundle(files, model, manifest, run, now):
    """A wave or weather run: declared variables, optional frames, spot series."""
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
        return
    grid = manifest["grid"]
    if len(frames) != len(hours):
        raise ValueError(f"Empty {kind} forecast or unsupported cadence")
    # Frames may carry a declared subset: a map needs fewer fields than a spot series.
    gridded = manifest.get("frameVariables", list(variables))
    if (not isinstance(gridded, list) or not gridded or len(set(gridded)) != len(gridded)
            or not set(gridded) <= set(variables)):
        raise ValueError("Frame variables must be a distinct subset of the declared variables")
    count = grid_count(grid)
    for index, info in enumerate(frames):
        hour = hours[index]
        frame = json.loads(frame_file(files, info, hour, "json"))
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
    validate_spot_series(manifest.get("spotSeries"), variables, hours, run, codes, limit)
    if datetime.fromisoformat(frames[-1]["validTime"].replace("Z", "+00:00")) <= now:
        raise ValueError(f"The {kind} horizon has already expired")


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


BLEND_AGREEMENT = set("hml-")
BLEND_SERIES = {"wind": (0, 2000), "gust": (0, 2000), "from": (0, 360)}


def validate_blend_bundle(public, model, manifest, run, now):
    """Every riding place's wind consensus (src/spotBlend.ts): one self-contained file.

    `run` is the hour it was worked out, not a provider's run, so the registry's
    freshness limit means "how long since the blend was last worked out". Speeds
    are tenths of a knot and bearings whole degrees, one value per time.
    """
    times, sources, spots = manifest.get("times"), manifest.get("sources"), manifest.get("spots")
    if manifest.get("schemaVersion") != 1:
        raise ValueError("Unknown blend schema")
    if not isinstance(times, list) or not times or not all(isinstance(t, str) for t in times):
        raise ValueError("A blend needs the times it covers")
    moments = [datetime.fromisoformat(t.replace("Z", "+00:00")) for t in times]
    if any(b <= a for a, b in zip(moments, moments[1:])):
        raise ValueError("A blend's times must be distinct and in order")
    coverage = manifest.get("coverage")
    if not isinstance(coverage, dict) or coverage.get("from") != times[0] or coverage.get("to") != times[-1]:
        raise ValueError("A blend's coverage must be its first and last time")
    if not isinstance(sources, list) or not sources:
        raise ValueError("A blend must name the models it read")
    for source in sources:
        if not isinstance(source, dict) or not isinstance(source.get("id"), str) \
                or not number(source.get("weight"), 100, 0) or not source["weight"] > 0 \
                or not isinstance(source.get("columns"), list) \
                or not all(whole(c) and 0 <= c < len(times) for c in source["columns"]):
            raise ValueError("A blend source is malformed")
    if not isinstance(spots, dict) or not spots:
        raise ValueError("A blend needs the places it rates")
    for spot, series in spots.items():
        if not isinstance(series, dict):
            raise ValueError(f"The blend for {spot} is malformed")
        for key, (low, high) in BLEND_SERIES.items():
            values = series.get(key)
            if not isinstance(values, list) or len(values) != len(times) or not all(
                    value is None or (number(value, high, low)) for value in values):
                raise ValueError(f"The blend's {key} for {spot} is malformed")
        agreement = series.get("agreement")
        if not isinstance(agreement, str) or len(agreement) != len(times) \
                or not set(agreement) <= BLEND_AGREEMENT:
            raise ValueError(f"The blend's agreement for {spot} is malformed")
    return []


def validate_observation_bundle(public, model, manifest, run, now):
    """Measurements, not predictions: one self-contained file, no immutable objects.

    `run` is the newest observation hour the manifest publishes, which is what makes
    the registry's freshness limit mean "how old is the newest reading".
    """
    if manifest.get("observes") == "wind":
        return validate_wind_observations(manifest, run, now)
    if manifest.get("observes") is not None:
        raise ValueError(f"Unknown observed quantity {manifest.get('observes')!r}")
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


def validate_wind_observations(manifest, run, now):
    """Wind readings at stations: [time, speed, gust, direction] rows, in m/s.

    Each station's readings are strictly increasing in time, inside the declared
    window behind `run`, physically possible, and never a gust below the speed it
    accompanies; the latest reading is the last row. Attribution is required,
    because both networks license the data on condition of it.
    """
    stations = manifest.get("stations")
    if not isinstance(stations, dict) or not stations:
        raise ValueError("A wind observation manifest needs stations")
    if manifest.get("readingFields") != ["time", "speed", "gust", "direction"]:
        raise ValueError("A wind observation manifest must declare its reading fields")
    if (manifest.get("units") or {}).get("speed") != "m/s":
        raise ValueError("Wind observations are published in m/s")
    hours = manifest.get("windowHours")
    if not whole(hours) or not 1 <= hours <= 240:
        raise ValueError("A wind observation manifest must declare its window")
    for key in ("attribution", "licenseUrl"):
        if not isinstance(manifest.get(key), str) or not manifest[key].strip():
            raise ValueError(f"A wind observation manifest needs its {key}")
    if manifest_urls(manifest):
        # The pruner would read it as an object this manifest keeps alive.
        raise ValueError("A wind observation manifest must not carry a `url`")
    earliest = run - timedelta(hours=hours)
    newest = None
    for identifier, station in stations.items():
        label = f"Station {identifier}"
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", identifier):
            raise ValueError(f"Invalid station id {identifier!r}")
        if not isinstance(station, dict) or not isinstance(station.get("name"), str) \
                or not station["name"].strip():
            raise ValueError(f"{label} needs a name")
        if not (number(station.get("lat"), 90) and number(station.get("lon"), 180)):
            raise ValueError(f"{label} has no valid position")
        if station.get("class") not in WIND_OBSERVATION_CLASSES:
            raise ValueError(f"{label} declares an unknown class")
        if not isinstance(station.get("source"), str) or not station["source"].strip():
            raise ValueError(f"{label} must name its source")
        height = station.get("heightM")
        if height is not None and not number(height, 200, 0):
            raise ValueError(f"{label} has an implausible anemometer height")
        readings = station.get("readings")
        if not isinstance(readings, list) or not readings:
            raise ValueError(f"{label} publishes no readings")
        previous = None
        for row in readings:
            if not isinstance(row, list) or len(row) != 4:
                raise ValueError(f"{label} has a malformed reading")
            at = observation_time(row[0], now, label)
            if previous is not None and at <= previous:
                raise ValueError(f"{label} readings are not in increasing time order")
            if at < earliest:
                raise ValueError(f"{label} has a reading older than the declared window")
            previous = at
            speed, gust, heading = row[1:]
            if not number(speed, WIND_OBSERVATION_MAX_SPEED, 0):
                raise ValueError(f"{label} has an impossible wind speed")
            if gust is not None and (not number(gust, WIND_OBSERVATION_MAX_GUST, 0)
                                     or gust + WIND_OBSERVATION_GUST_SLACK < speed):
                raise ValueError(f"{label} has an impossible gust")
            if heading is not None and not (whole(heading) and 0 <= heading < 360):
                raise ValueError(f"{label} has an impossible direction")
        latest = station.get("latest")
        if not isinstance(latest, dict) or [latest.get(k) for k in
                                            ("time", "speed", "gust", "direction")] != readings[-1]:
            raise ValueError(f"{label} latest reading is not its newest row")
        newest = previous if newest is None else max(newest, previous)
    if newest.replace(minute=0, second=0, microsecond=0) != run:
        raise ValueError("Run is not the newest published observation hour")
    return []


def generated_hour(manifest, run, label):
    """A job output's own clock: `generatedAt` must fall in the hour its run names."""
    try:
        at = datetime.fromisoformat(str(manifest.get("generatedAt")).replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{label} has no usable generatedAt") from error
    if at.tzinfo is None or at.replace(minute=0, second=0, microsecond=0) != run:
        raise ValueError(f"{label} was not generated in the hour its run names")


def validate_archive_bundle(public, model, manifest, run, now):
    """What the archive job copied this hour. Its keys must all be archive keys.

    The archived files themselves are written by the job straight to the archive,
    which nothing prunes, so they are not objects of this bundle: the summary is
    the whole publication, and it deliberately carries no `url` for the pruner to
    follow.
    """
    generated_hour(manifest, run, "The archive summary")
    if manifest.get("schemaVersion") != 1:
        raise ValueError("Unknown archive summary schema")
    archived, current = manifest.get("archived"), manifest.get("current")
    if not isinstance(archived, list) or not isinstance(current, dict):
        raise ValueError("The archive summary must list what it archived and what is current")
    for entry in archived:
        if not isinstance(entry, dict) or not isinstance(entry.get("key"), str) \
                or not entry["key"].startswith("archive/forecasts/") \
                or entry.get("model") not in MODELS or MODELS[entry["model"]]["kind"] != "wind" \
                or not re.fullmatch(r"\d{10}", str(entry.get("run"))):
            raise ValueError("An archived forecast entry is malformed")
    for wind_model, entry in current.items():
        if wind_model not in MODELS or not isinstance(entry, dict) \
                or not re.fullmatch(r"\d{10}", str(entry.get("run"))):
            raise ValueError("The archive summary's current runs are malformed")
    observations = manifest.get("observations")
    if observations is not None and (not isinstance(observations, dict) or not all(
            isinstance(key, str) and key.startswith("archive/observations/")
            for key in observations.get("days", []))):
        raise ValueError("The archive summary's observation days are malformed")
    if manifest_urls(manifest):
        raise ValueError("The archive summary must not reference objects by url")
    return []


def validate_verification_bundle(public, model, manifest, run, now):
    """Forecast verification scores: tables of rows under declared field names."""
    generated_hour(manifest, run, "The verification scores")
    if manifest.get("schemaVersion") != 1:
        raise ValueError("Unknown verification schema")
    fields, windows = manifest.get("fields"), manifest.get("windows")
    if not isinstance(fields, list) or not fields or not all(isinstance(f, str) for f in fields):
        raise ValueError("Verification scores must declare their fields")
    if not isinstance(windows, list) or not windows:
        raise ValueError("Verification scores must declare their windows")
    for key in ("attribution", "licenseUrl"):
        if not isinstance(manifest.get(key), str) or not manifest[key].strip():
            raise ValueError(f"Verification scores need their {key}")
    for table in ("byClass", "byStation"):
        tables = manifest.get(table)
        if not isinstance(tables, dict):
            raise ValueError(f"Verification scores need {table}")
        for window in windows:
            rows = tables.get(str(window.get("days")))
            if not isinstance(rows, list):
                raise ValueError(f"{table} has no rows for the {window.get('days')}-day window")
            for row in rows:
                if not isinstance(row, list) or len(row) != len(fields) or not all(
                        value is None or isinstance(value, str) or number(value, 1e9)
                        for value in row):
                    raise ValueError(f"A {table} row does not match the declared fields")
    if manifest_urls(manifest):
        raise ValueError("Verification scores must not reference objects by url")
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
    """What the pointer we are replacing named and the new one does not.

    Returns `(directories, keys)`: the superseded run directory, to be deleted by
    listing its own prefix, and for a tide manifest the station files it no
    longer references. Five guards, because this is the only code in the
    pipeline that deletes from the bucket: the source is one model's own previous
    pointer (never a listing of the store, so an upload in flight for another
    model is invisible to it); anything the new manifest still names is excluded
    first; the path must sit directly under that model's object root; the run
    directory or station file must be named for this model and for no other,
    which every adapter satisfies (`weather/ecmwf-RUN-360h-v2-HASH/`,
    `marine/tides-STATION-…json`) — "harmonie" must not match "harmonie-eps", nor
    "gfs" match "gfs-wave"; and pointer manifests, the archived manifests and the
    forecast archive (`archive/`, archive.py) are never touched. A pointer that
    ever stops using that naming simply stops deleting, and the bucket sweep
    collects its leftovers instead: the safe direction to fail in.
    """
    if not isinstance(previous, dict) or previous.get("model") != model:
        return [], []
    root = object_root(model)
    pointers = set(MANIFESTS.values())

    def ours(path):
        parts = PurePosixPath(path).parts
        return (len(parts) == 2 and parts[0] == root and ".." not in parts
                and not is_archived(path) and path not in pointers
                and parts[1] != ARCHIVE_DIRECTORY and model_owns(model, parts[1]))

    directories = []
    try:
        old = run_directory(previous, MANIFESTS[model])
    except ValueError:
        old = None  # An unusable `base` names nothing we may delete.
    if old is not None:
        try:
            new = run_directory(manifest, MANIFESTS[model])
        except ValueError:
            new = None
        if old != new and ours(old):
            directories.append(old)
        return directories, []
    keep = manifest_urls(manifest)
    keys = [url for url in sorted(manifest_urls(previous) - keep) if ours(url)]
    return directories, keys


def drop_superseded_objects(s3, bucket, prefix, model, previous, manifest):
    """Delete the replaced run's objects. Never fails the forecast that just published."""
    directories, keys = superseded_objects(model, previous, manifest)
    if not directories and not keys:
        return 0
    try:
        stale = [prefix + key for key in keys]
        for directory in directories:
            # The trailing slash is what keeps `…-1a2b3c4d/` from also listing a
            # longer name that merely starts the same way.
            stale.extend(key for key, _, _ in bucket_keys(s3, bucket, f"{prefix}{directory}/"))
        deleted = delete_keys(s3, bucket, stale) if stale else 0
    except Exception as error:
        # The forecast is live; these objects are only cost. The bucket sweep gets them.
        log_event("superseded_delete_failed", model=model, directories=directories,
                  objects=len(keys), error=error)
        return 0
    log_event("superseded_deleted", model=model, run=previous.get("run"),
              directories=directories, objects=deleted)
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
