"""Publish a Met Éireann HARMONIE-AROME DINI member ensemble for Irish spots.

Met Éireann's public endpoints do not expose coherent perturbed members:

* The near-real-time portal addresses files by name, and all six files a cycle
  writes for one step (control plus five perturbed members) share one name. A
  download therefore resolves to one arbitrary member, and the member it returns
  changes from step to step, so a single perturbed member's time series cannot be
  reconstructed. Verified on 16 September 2026: cycle 2026091619 returned members
  7, 7, 10, 6, 6, 9, 0, 7, 9, 7… for steps +000…+048.
* `opendata2.met.ie/nwp/<cycle>/mbrNNN/` keeps twelve hourly cycles and rotates
  through the 30 perturbed members, but the perturbed directories publish only
  eight surface parameters and no 10 m wind at all.

What is unambiguous is `fcYYYYMMDDHH+HHHCONTROL_grib2_ieIoI`: exactly one file per
cycle and step. This adapter therefore publishes a time-lagged control ensemble —
the control of the anchor cycle plus the control of each older hourly cycle, all
shifted onto the anchor's valid-time axis, so members differ by initialization
time and are listed individually in `memberRuns`.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import io
import os
import re
import sys
import threading
import time
from urllib.parse import urlencode
import zipfile

import eccodes as ec
import numpy as np

from f5bin import ENCODING as FRAME_ENCODING, publish_frame
from fetch_forecast import ROOT, get, published_in_bucket, sample, write_json
from fetch_forecast import load_spots, spots_file
from fetch_harmonie import (GEOMETRY, GRID, PORTAL, earth_vectors, inventory,
                            make_layout, messages, resample)
from registry import UNCHANGED_EXIT

MODEL = "harmonie-eps"
PRODUCT = "CONTROL_grib2_ieIoI"  # Ireland Lambert subset; one file per cycle and step.
ENSEMBLE_SIZE = 31  # numberOfForecastsInEnsemble published by DINI-EPS.
MAX_SOURCE_STEP = 60  # The control product reaches +60 h.
MAX_LAG = 11  # opendata2 keeps twelve hourly cycles; nothing older is reachable.
FIELDS = {2: "u", 3: "v"}  # No scalar gust: this subset has only signed components.
TRANSFER = {"bytes": 0, "files": 0}
LOCK = threading.Lock()


def cycle_time(cycle):
    return datetime.strptime(cycle, "%Y%m%d%H").replace(tzinfo=timezone.utc)


def source_name(cycle, step):
    return f"fc{cycle}+{step:03d}{PRODUCT}"


def cache_path(name):
    return ROOT / ".cache" / MODEL / (name + ".wind.grib2")


def catalogue(items):
    """Steps published per cycle for the unambiguous control product."""
    published = {}
    for item in items:
        match = re.fullmatch(rf"fc(\d{{10}})\+(\d{{3}}){re.escape(PRODUCT)}", item.get("name", ""))
        if match:
            published.setdefault(match[1], set()).add(int(match[2]))
    return published


def cached_cycles():
    pattern = re.compile(rf"fc(\d{{10}})\+\d{{3}}{re.escape(PRODUCT)}\.wind\.grib2")
    return {match[1] for path in (ROOT / ".cache" / MODEL).glob("fc*.wind.grib2")
            if (match := pattern.fullmatch(path.name))}


def assemble(published, hours, requested_run=None, max_lag=6):
    """Anchor on the newest complete cycle, then lag older cycles into members.

    A cycle contributes when every file it owes is still listed in the portal's
    three-hour window or already validated in our cache, so consecutive hourly
    runs keep members whose source files the portal has since dropped.
    """
    def available(cycle, steps):
        listed = published.get(cycle, set())
        return all(step in listed or cache_path(source_name(cycle, step)).exists() for step in steps)

    cycles = sorted(set(published) | cached_cycles(), reverse=True)
    for run in cycles:
        if (requested_run and run != requested_run) or not available(run, hours):
            continue
        anchor = cycle_time(run)
        members = [{"run": run, "lag": 0}]
        for cycle in cycles:
            lag = (anchor - cycle_time(cycle)).total_seconds() / 3600
            if lag.is_integer() and 1 <= lag <= max_lag and lag + hours[-1] <= MAX_SOURCE_STEP \
                    and available(cycle, [int(lag) + hour for hour in hours]):
                members.append({"run": cycle, "lag": int(lag)})
        return run, members
    raise RuntimeError("No HARMONIE cycle publishes a complete control forecast over the "
                       "requested hours. Try again later; existing snapshots are unchanged.")


def extract(data):
    """Cache only the two 10 m fields we publish; other levels are discarded."""
    found = {}
    for message in messages(data):
        h = ec.codes_new_from_message(message)
        try:
            if (ec.codes_get(h, "discipline") == 0 and ec.codes_get(h, "parameterCategory") == 2
                    and ec.codes_get(h, "typeOfLevel") == "heightAboveGround"
                    and ec.codes_get(h, "level") == 10):
                field = FIELDS.get(ec.codes_get(h, "parameterNumber"))
                if field:
                    if field in found:
                        raise ValueError("Duplicate 10 m wind field")
                    found[field] = message
        finally:
            ec.codes_release(h)
    if set(found) != {"u", "v"}:
        raise ValueError("Source file is missing 10 m U/V wind")
    return found["u"] + found["v"]


def download(task):
    cycle, step = task
    name = source_name(cycle, step)
    path = cache_path(name)
    if not path.exists():
        url = f"{PORTAL}/data-portal/near-realtime/download/nwp?{urlencode({'files': name})}"
        body = get(url)
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            if archive.namelist() != [name] or archive.getinfo(name).file_size > 100_000_000:
                raise ValueError("Unexpected forecast ZIP contents")
            data = extract(archive.read(name))  # ZIP CRC and GRIB framing checked.
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".download")
        temporary.write_bytes(data)
        os.replace(temporary, path)
        with LOCK:
            TRANSFER["bytes"] += len(body)
            TRANSFER["files"] += 1
    return path


def validate(h, field, member, hour):
    """The control adapter's checks, against this member's own initialization."""
    ec.codes_set(h, "stepUnits", 1)
    step = member["lag"] + hour
    expected = {"discipline": 0, "parameterCategory": 2, "parameterNumber": {"u": 2, "v": 3}[field],
                "typeOfLevel": "heightAboveGround", "level": 10, "gridType": "lambert",
                "uvRelativeToGrid": 1, "shapeOfTheEarth": 6, "centre": "eidb",
                "typeOfProcessedData": "cf", "perturbationNumber": 0, "number": 0,
                "numberOfForecastsInEnsemble": ENSEMBLE_SIZE, "stepType": "instant",
                "startStep": step, "endStep": step, "iScansNegatively": 0, "jScansPositively": 1,
                "jPointsAreConsecutive": 0, "alternativeRowScanning": 0,
                "DxInMetres": 2000, "DyInMetres": 2000}
    for key, value in expected.items():
        if ec.codes_get(h, key) != value:
            raise ValueError(f"Unsupported HARMONIE EPS {key}: expected {value}")
    if ec.codes_get(h, "units") not in ("m s**-1", "m s-1") or ec.codes_get(h, "numberOfMissing") != 0:
        raise ValueError("Missing wind values or incorrect units")
    if f'{ec.codes_get(h, "dataDate")}{ec.codes_get(h, "dataTime"):04d}' != member["run"] + "00":
        raise ValueError("A member file carries another model run")
    valid = cycle_time(member["run"]) + timedelta(hours=step)
    if f'{ec.codes_get(h, "validityDate")}{ec.codes_get(h, "validityTime"):04d}' != valid.strftime("%Y%m%d%H%M"):
        raise ValueError("Incorrect HARMONIE EPS valid time")


def decode(member, hour, layout=None):
    """Validate, rotate and regrid one member/step onto the display grid."""
    path = cache_path(source_name(member["run"], member["lag"] + hour))
    records = list(messages(path.read_bytes()))
    if len(records) != 2:
        raise ValueError("Cached wind file must contain exactly U and V")
    fields = {}
    for field, message in zip(["u", "v"], records):
        h = ec.codes_new_from_message(message)
        try:
            validate(h, field, member, hour)
            if layout is None:
                layout = make_layout(h)
            if tuple(ec.codes_get(h, key) for key in GEOMETRY) != layout["signature"]:
                raise ValueError("Mixed forecast grids")
            values = ec.codes_get_values(h)
            if not np.all(np.isfinite(values)) or np.any(np.abs(values) > 150):
                raise ValueError("Implausible or missing wind values")
            fields[field] = values
        finally:
            ec.codes_release(h)
    east, north = earth_vectors(fields["u"], fields["v"], layout["convergence"])
    return {"u": np.round(resample(east, layout), 2).tolist(),
            "v": np.round(resample(north, layout), 2).tolist()}, layout


def digest(member, hours):
    checksum = hashlib.sha256()
    for hour in hours:
        checksum.update(cache_path(source_name(member["run"], member["lag"] + hour)).read_bytes())
    return checksum.hexdigest()


def description(run, members):
    return ("Time-lagged HARMONIE-AROME DINI ensemble. The public portal gives every file of one "
            "cycle and step the same name, so a download returns an arbitrary perturbed member that "
            "changes step to step, and opendata2's perturbed member directories publish no 10 m "
            "wind: coherent perturbed members are not obtainable without the archive. Member 0 is "
            f"the control of anchor cycle {run}; every other member is the control of a cycle up to "
            f"{max(m['lag'] for m in members)} h older, shifted onto the anchor's valid-time axis. "
            "Members therefore have different initialization times, listed in memberRuns, and "
            "spread reflects initialization lag only, not model perturbations.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, default=48)
    parser.add_argument("--step", type=int, choices=[1, 3], default=3)
    parser.add_argument("--run", help="Optional available YYYYMMDDHH anchor cycle")
    parser.add_argument("--max-lag", type=int, default=6,
                        help="Oldest member cycle, in hours behind the anchor")
    parser.add_argument("--min-members", type=int, default=2)
    args = parser.parse_args()
    if not 3 <= args.hours <= MAX_SOURCE_STEP or args.hours % args.step:
        parser.error(f"Use 3–{MAX_SOURCE_STEP} hours, divisible by step")
    if not 1 <= args.max_lag <= MAX_LAG or args.min_members < 2:
        parser.error(f"Use a 1–{MAX_LAG} hour member lag and at least two members")
    started = time.monotonic()
    hours = list(range(0, args.hours + 1, args.step))
    run, members = assemble(catalogue(inventory()), hours, args.run, args.max_lag)
    if len(members) < args.min_members:
        raise RuntimeError(f"Only {len(members)} HARMONIE ensemble members are retrievable; "
                           f"{args.min_members} required. Existing snapshots are unchanged.")
    # Re-assembling an anchor that is already published can only find the same
    # members or fewer, as older cycles leave the portal's window, and the
    # publisher refuses to replace a larger ensemble with a smaller one anyway.
    if published_in_bucket(run, args.run):
        print(f"HARMONIE-AROME DINI EPS anchored on {run} is already published; "
              "nothing to download.", flush=True)
        return UNCHANGED_EXIT
    print(f"HARMONIE-AROME DINI EPS anchored on {run}: {len(members)} members from cycles "
          f"{', '.join(member['run'] for member in members)} × {len(hours)} steps", flush=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(download, [(member["run"], member["lag"] + hour)
                                 for member in members for hour in hours]))
    print(f"Downloaded {TRANSFER['files']} files, {TRANSFER['bytes'] / 1e6:.0f} MB; "
          "validating, rotating and regridding…", flush=True)
    output = ROOT / "public" / "weather"
    run_time = cycle_time(run)
    prefix = f"{MODEL}-{run}-{args.hours}h-v1"
    spots = load_spots()
    print(f"Sampling {len(spots)} spots from {spots_file()}", flush=True)
    mean_series = {spot["id"]: [] for spot in spots}
    member_series = {spot["id"]: [] for spot in spots}
    absent = [None] * len(members)
    frames, layout = [], None
    for hour in hours:
        valid = (run_time + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
        columns = []
        for member in members:
            values, layout = decode(member, hour, layout)
            columns.append(values)
        mean = {field: np.round(np.mean([column[field] for column in columns], axis=0), 2).tolist()
                for field in ("u", "v")}
        payload = {"model": MODEL, "run": run, "hour": hour, "validTime": valid, "grid": GRID,
                   "gustIntervalHours": None, **mean, "gust": None}
        name = publish_frame(output, prefix, payload)
        frames.append({"hour": hour, "validTime": valid, "url": f"weather/{name}",
                       "gustIntervalHours": None})
        for spot in spots:
            point = {field: sample(GRID, mean[field], spot["lon"], spot["lat"]) for field in ("u", "v")}
            if any(value is None for value in point.values()):
                raise ValueError("Named spot outside the HARMONIE EPS crop")
            mean_series[spot["id"]].append({"hour": hour, "validTime": valid, **point, "gust": None})
            member_series[spot["id"]].append({"hour": hour, "validTime": valid, "gust": list(absent), **{
                field: [sample(GRID, column[field], spot["lon"], spot["lat"]) for column in columns]
                for field in ("u", "v")}})
        print(f"  +{hour:03d}h — {len(members)} members validated, rotated and regridded", flush=True)
    manifest = {"schemaVersion": 1, "model": MODEL, "modelName": "HARMONIE EPS",
                "provider": "Met Éireann", "modelDetail": "HARMONIE-AROME DINI ensemble members",
                "resolutionKm": 2, "run": run, "runTime": run_time.isoformat().replace("+00:00", "Z"),
                "generatedAt": datetime.now(timezone.utc).isoformat(), "stepHours": args.step,
                "grid": GRID, "encoding": FRAME_ENCODING, "frames": frames,
                "spotForecasts": mean_series,
                "spotMembers": member_series,
                "ensemble": {"members": len(members), "control": 0,
                             "memberRuns": [cycle_time(member["run"]).isoformat().replace("+00:00", "Z")
                                            for member in members],
                             "memberLagHours": [member["lag"] for member in members],
                             "description": description(run, members)},
                "gustAvailable": False,
                "gustDescription": "Gust speed is unavailable: this subset supplies signed gust "
                                   "components, not the scalar gust maximum, and their combination "
                                   "has not been validated. No mean or per-member gust is "
                                   "manufactured, so every gust value is null.",
                "processing": "Native 2 km Lambert Ireland subset; grid-relative U/V rotated to true "
                              "east/north at native points, then bilinearly resampled to 0.025° × "
                              "0.02° for display. Frames and spotForecasts are the ensemble mean of "
                              "all members; spotMembers keeps every member separately on the same "
                              "valid-time axis. Ireland-only crop; no extrapolation.",
                "sourceFiles": [{"run": member["run"], "lagHours": member["lag"],
                                 "files": [source_name(member["run"], member["lag"] + hour)
                                           for hour in hours],
                                 "windGribSha256": digest(member, hours)} for member in members],
                "sourceUrl": PORTAL + "/nwp/near-realtime",
                "attribution": "Weather data: Met Éireann, HARMONIE-AROME DINI control forecasts from "
                               "successive cycles, CC BY 4.0; lag-assembled, rotated, resampled and "
                               "cropped by Force5 / wingfoil.ie.",
                "licenseUrl": "https://creativecommons.org/licenses/by/4.0/"}
    write_json(output / f"{MODEL}.json", manifest)
    print(f"Published {len(frames)} ensemble-mean frames and {len(members)}-member spot series in "
          f"{time.monotonic() - started:.0f}s; {TRANSFER['bytes'] / 1e6:.0f} MB downloaded"
          + (f" ({TRANSFER['bytes'] / TRANSFER['files'] / 1e6:.1f} MB per member-step)"
             if TRANSFER["files"] else " (all member/steps served from cache)")
          + ". Other models unchanged.", flush=True)


if __name__ == "__main__":
    try:
        # A run that is already published exits UNCHANGED_EXIT, which the worker
        # reads as "nothing new", not as a failure and not as a bundle to validate.
        sys.exit(main() or 0)
    except Exception as error:
        print(f"HARMONIE EPS refresh failed: {error}. Last published snapshot preserved.", file=sys.stderr)
        sys.exit(1)
