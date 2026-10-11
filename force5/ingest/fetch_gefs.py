"""NOAA GEFS 0.25° ensemble: per-spot member series plus ensemble-mean frames.

Public domain source, no API key. 31 members (gec00 control + gep01–gep30), four
cycles a day, 3-hourly to +240h in the `pgrb2sp25` "s" parameter set, which holds
UGRD/VGRD at 10 m and GUST at the surface.

The default NOMADS GRIB filter crops the Ireland box server-side and returns
about 15 KB per member-step. `--source s3` reads the same three messages from the
`noaa-gefs-pds` Open Data bucket through the `.idx` sidecar, which transfers
whole-globe messages at about 2.2 MB per member-step — roughly 145 times the
traffic. NOMADS asks for at most two connections and a pause between requests,
and answers each one in two to three seconds, so its 1,271 requests take 20 to 30
minutes; the bucket asks for neither, so `--source s3` reads with many more workers
and finishes in minutes for its 2.8 GB. Which to use is a trade of bandwidth for
time; see docs/LIVE_FORECAST_PIPELINE.md.

Like the GFS control product, GEFS gusts are INSTANTANEOUS surface values, not
period maxima: `gustKind: "instantaneous"` with `[hour, hour]` on every frame.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import os
import re
import sys
import threading
import time
from urllib.parse import quote, urlencode

import eccodes as ec
import requests

import fetch_gfs
from cadence import ladder_hours
from fetch_gfs import FIELDS, contiguous, index_ranges, validate_metadata
from f5bin import publish_frame
from fetch_forecast import (BBOX, ROOT, decode_handle, load_spots, published_in_bucket, sample,
                            spots_file)
from registry import UNCHANGED_EXIT
from rundir import write_run
import timing

FILTER = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gefs_atmos_0p25s.pl"
BUCKET = "https://noaa-gefs-pds.s3.amazonaws.com"
SOURCE_URL = "https://www.nco.ncep.noaa.gov/pmb/products/gens/"
SET = "pgrb2sp25"  # The 0.25° subset that carries 10 m wind and the surface gust.
# Measured 2026-09-16 on the live 18 UTC cycle: one member-step is 14.7–15.6 KB
# through the NOMADS filter and 2.17–2.24 MB through the S3 .idx byte ranges.
BYTES_PER_MEMBER_STEP = {"nomads": 15_400, "s3": 2_220_000}
# Concurrent downloads, by default and at most, and the pause between request
# starts. Two connections and 0.6 s are NOMADS's own terms for a well-behaved
# client, and it answers each request in two to three seconds, so a run takes half
# an hour however it is asked. The S3 bucket states no such terms. Measured on
# 10 October 2026 over 62 member-steps: 4 workers read 8.6 MB/s, 8 read 17 MB/s,
# 12 read 21 MB/s and 16 read 23 MB/s, which is this connection's ceiling, so 12
# takes a whole run in a little over two minutes; any pause between requests
# halved it, because each member-step is three requests.
WORKERS = {"nomads": 2, "s3": 12}
MAX_WORKERS = {"nomads": 2, "s3": 16}
PAUSE = {"nomads": fetch_gfs.PAUSE["nomads"], "s3": 0.0}
PERTURBED = 30  # gep01–gep30; with the gec00 control that is 31 members.
MEMBERS = PERTURBED + 1
STEP, HOURS = 6, 240
MAX_HOURS = 240  # The 0.25° "s" set stops here; beyond it GEFS is 0.5° only.
MAX_AGE_HOURS = 12  # Four cycles a day; the 0.25° members finish 4.5–6 h after run time.


def member_name(member):
    """0 is the low-resolution control gec00; 1..30 are gep01..gep30."""
    if not isinstance(member, int) or isinstance(member, bool) or not 0 <= member <= PERTURBED:
        raise ValueError(f"GEFS has a control (0) and perturbed members 1–{PERTURBED}")
    return "c00" if member == 0 else f"p{member:02d}"


def file_name(run, member, hour):
    return f"ge{member_name(member)}.t{run[-2:]}z.pgrb2s.0p25.f{hour:03d}"


def directory(run):
    return f"/gefs.{run[:8]}/{run[-2:]}/atmos/{SET}"


def filter_url(run, member, hour):
    west, south, east, north = BBOX
    return FILTER + "?" + urlencode({
        "dir": directory(run), "file": file_name(run, member, hour),
        "var_UGRD": "on", "var_VGRD": "on", "var_GUST": "on",
        "lev_10_m_above_ground": "on", "lev_surface": "on",
        "subregion": "", "leftlon": west, "rightlon": east, "toplat": north, "bottomlat": south})


def object_key(run, member, hour):
    return f"{directory(run).lstrip('/')}/{file_name(run, member, hour)}"


class Meter:
    """Bytes actually transferred this run, for the closing report."""

    total, lock = 0, threading.Lock()

    @classmethod
    def count(cls, size):
        with cls.lock:
            cls.total += size


CONNECTIONS = threading.local()


def bucket_get(url, headers=None, attempts=4):
    """`fetch_gfs.get` for the S3 bucket, over one kept-alive connection per thread.

    Sixteen workers opening a fresh TLS connection for every request, some fifteen
    a second, had new connections refused for minutes at a time (10 October 2026).
    Reused, each worker connects once, and the same reads ran twice as fast."""
    session = getattr(CONNECTIONS, "session", None)
    if session is None:
        session = CONNECTIONS.session = requests.Session()
    for attempt in range(attempts):
        fetch_gfs.THROTTLE.wait()
        try:
            response = session.get(url, timeout=(15, 90), headers={
                "User-Agent": fetch_gfs.USER_AGENT, **(headers or {})})
            response.raise_for_status()
            timing.request(len(response.content))
            return response.content
        except requests.HTTPError as error:
            # A missing or rejected object is a real answer; only retry transient faults.
            if error.response.status_code in (400, 403, 404) or attempt == attempts - 1:
                timing.failure()
                raise
        except Exception:
            if attempt == attempts - 1:
                timing.failure()
                raise
        timing.retry()
        time.sleep(2 ** attempt)


def download(source, run, member, hour):
    if source == "nomads":
        data = fetch_gfs.get(filter_url(run, member, hour))
        Meter.count(len(data))
        return data
    key = object_key(run, member, hour)
    sidecar = bucket_get(f"{BUCKET}/{key}.idx")
    Meter.count(len(sidecar))
    # UGRD and VGRD sit side by side in the file, so this is two ranges, not three.
    parts = [bucket_get(f"{BUCKET}/{key}", headers={"Range": f"bytes={start}-{end}"})
             for start, end in contiguous(index_ranges(sidecar.decode(), hour))]
    Meter.count(sum(len(part) for part in parts))
    return b"".join(parts)


def inventory(source, run):
    """Forecast hours each member is actually published for. No release guesses."""
    pattern = rf"ge([cp]\d\d)\.t{run[-2:]}z\.pgrb2s\.0p25\.f(\d{{3}})"
    hours = {}
    if source == "s3":
        prefix = f"{directory(run).lstrip('/')}/"
        token = ""
        for _ in range(16):
            url = f"{BUCKET}/?list-type=2&max-keys=1000&prefix={quote(prefix)}"
            body = fetch_gfs.get(url + (f"&continuation-token={quote(token)}" if token else "")).decode()
            # Require the sidecar: ranged reads need it, and it is written last.
            for name, hour in re.findall(pattern + r"\.idx</Key>", body):
                hours.setdefault(name, set()).add(int(hour))
            follow = re.search(r"<NextContinuationToken>([^<]+)</", body)
            if not follow:
                return hours
            token = follow.group(1)
        raise RuntimeError("Unexpectedly long GEFS object listing")
    page = fetch_gfs.get(f"{FILTER}?dir={quote(directory(run))}").decode("utf-8", "replace")
    for name, hour in re.findall(pattern + r"(?!\d)", page):
        hours.setdefault(name, set()).add(int(hour))
    return hours


def candidates(requested_run, now):
    if requested_run:
        return [requested_run]
    latest = now.replace(minute=0, second=0, microsecond=0, hour=now.hour // 6 * 6)
    # Only cycles that can still pass the freshness check below are worth listing.
    return [(latest - timedelta(hours=6 * index)).strftime("%Y%m%d%H")
            for index in range(MAX_AGE_HOURS // 6)]


def discover(source, hours, members, requested_run=None, now=None):
    """Newest cycle whose listing holds every requested step for every member."""
    wanted = set(hours)
    for run in candidates(requested_run, now or datetime.now(timezone.utc)):
        try:
            available = inventory(source, run)
        except Exception as error:
            print(f"Inventory unavailable ({run}): {error}", file=sys.stderr)
            continue
        short = [member for member in members
                 if not wanted <= available.get(member_name(member), set())]
        if not short:
            return run
        print(f"Skipping incomplete GEFS {run}: {len(short)} of {len(members)} member(s) "
              f"missing steps, first ge{member_name(short[0])}", flush=True)
    raise RuntimeError("No complete requested GEFS run is available. "
                       "Existing forecast has not been changed.")


def run_datetime(run):
    if not re.fullmatch(r"\d{10}", run or ""):
        raise ValueError("A GEFS run identifier is YYYYMMDDHH")
    value = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    if value.hour not in (0, 6, 12, 18):
        raise ValueError("GEFS runs at 00, 06, 12 and 18 UTC only")
    return value


def decode_member(path, run, hour, member, layout=None):
    """Validate and crop the three messages of one member's step."""
    fields = {}
    with path.open("rb") as stream:
        while True:
            handle = ec.codes_grib_new_from_file(stream)
            if handle is None:
                break
            try:
                if ec.codes_get(handle, "centre") != "kwbc":
                    raise ValueError("Expected an NCEP (kwbc) GEFS message")
                perturbation = ec.codes_get(handle, "perturbationNumber")
                if perturbation != member:
                    raise ValueError(f"Expected member {member}, found {perturbation}")
                expected_type = "cf" if member == 0 else "pf"
                if ec.codes_get(handle, "dataType") != expected_type:
                    raise ValueError(f"Member {member} is not a GEFS {expected_type} message")
                if ec.codes_get(handle, "numberOfForecastsInEnsemble") != PERTURBED:
                    raise ValueError(f"Expected {PERTURBED} perturbed GEFS members")
                field = FIELDS.get((ec.codes_get(handle, "parameterCategory"),
                                    ec.codes_get(handle, "parameterNumber"),
                                    ec.codes_get(handle, "typeOfLevel")))
                if field is None or field in fields:
                    raise ValueError("Unexpected or duplicate GEFS wind message")
                if ec.codes_get(handle, "numberOfMissing") != 0:
                    raise ValueError("Incomplete GEFS field")
            except Exception:
                ec.codes_release(handle)
                raise
            # decode_handle normalises 0–360° longitudes before cropping to BBOX,
            # and validate_metadata is the GFS contract: instantaneous u/v/gust.
            fields[field], layout, _ = decode_handle(handle, field, run, hour, layout, validate_metadata)
    if set(fields) != set(FIELDS.values()):
        raise ValueError(f"Member {member} is missing a wind or gust component at +{hour:03d}h")
    if layout[2]["dx"] != 0.25 or layout[2]["dy"] != 0.25:
        raise ValueError("Expected the 0.25-degree GEFS grid")
    return fields, layout


def decode_step(cache, source, run, hour, members, layout=None):
    """Every member of one step, re-fetching a cache entry that will not validate."""
    step = {}
    for member in members:
        try:
            values, layout = decode_member(fetch(cache, source, run, member, hour),
                                           run, hour, member, layout)
        except Exception as error:
            print(f"Re-fetching ge{member_name(member)} +{hour:03d}h after {error}", flush=True)
            values, layout = decode_member(
                fetch(cache, source, run, member, hour, refresh=True), run, hour, member, layout)
        if values is not None:
            step[member] = values
    # Nothing may publish a partial step, however a member came to be absent.
    if set(step) != set(members):
        raise ValueError(f"Incomplete ensemble at +{hour:03d}h: "
                         f"{len(step)} of {len(members)} members decoded")
    return {field: {member: step[member][field] for member in members}
            for field in FIELDS.values()}, layout


def fetch(cache, source, run, member, hour, refresh=False):
    path = cache / f"{hour:03d}-ge{member_name(member)}.grib2"
    if path.exists() and not refresh:
        return path
    data = download(source, run, member, hour)
    if not data.startswith(b"GRIB"):
        raise ValueError(f"Not a GRIB response for ge{member_name(member)} +{hour:03d}h")
    temporary = path.with_suffix(".download")
    temporary.write_bytes(data)
    os.replace(temporary, path)
    return path


def average(series):
    return [round(sum(column) / len(series), 2) for column in zip(*series)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, default=HOURS,
                        help=f"Horizon, 3–{MAX_HOURS}, divisible by --step (default {HOURS})")
    parser.add_argument("--step", type=int, choices=[3, 6], default=STEP,
                        help=f"Uniform source step in hours (default {STEP})")
    parser.add_argument("--members", type=int, default=MEMBERS,
                        help=f"Total members 2–{MEMBERS}, control first (default {MEMBERS})")
    parser.add_argument("--run", help="Optional specific YYYYMMDDHH run (00/06/12/18)")
    parser.add_argument("--source", choices=["nomads", "s3"], default="nomads",
                        help="NOMADS subregion filter, or ranged reads from NOAA's S3 mirror")
    parser.add_argument("--workers", type=int,
                        help=f"Concurrent downloads: default {WORKERS['nomads']} from NOMADS, "
                        f"which asks for at most {MAX_WORKERS['nomads']}, and "
                        f"{WORKERS['s3']} (at most {MAX_WORKERS['s3']}) from S3")
    args = parser.parse_args()
    if not 3 <= args.hours <= MAX_HOURS or args.hours % args.step:
        parser.error(f"Use 3–{MAX_HOURS} hours divisible by the step")
    if not 2 <= args.members <= MEMBERS:
        parser.error(f"Use 2–{MEMBERS} members; member 0 is the control")
    if args.workers is None:
        args.workers = WORKERS[args.source]
    if not 1 <= args.workers <= MAX_WORKERS[args.source]:
        parser.error(f"Use 1–{MAX_WORKERS[args.source]} concurrent downloads from "
                     f"{args.source}" + (": NOMADS limits well-behaved clients"
                                         if args.source == "nomads" else ""))
    fetch_gfs.THROTTLE.pause = PAUSE[args.source]
    members = list(range(args.members))
    ranges = [{"throughHour": args.hours, "stepHours": args.step}]
    hours = list(ladder_hours(ranges))
    timing.start("discover")
    run = discover(args.source, hours, members, args.run)
    run_time = run_datetime(run)
    age = (datetime.now(timezone.utc) - run_time).total_seconds() / 3600
    if not -1 <= age <= MAX_AGE_HOURS:
        raise ValueError(f"Refusing a stale/future GEFS run (maximum age {MAX_AGE_HOURS} hours)")
    # The newest cycle is often still publishing at its slot, so discovery falls back
    # to the previous one, which is usually the one already published.
    if published_in_bucket(run, args.run):
        print(f"GEFS 0.25° {run} is already published; nothing to download.", flush=True)
        return UNCHANGED_EXIT
    member_steps = len(members) * len(hours)
    print(f"Fetching GEFS 0.25° {run} from {args.source}: {len(members)} members × "
          f"{len(hours)} steps to +{args.hours}h ({member_steps} member-steps, about "
          f"{member_steps * BYTES_PER_MEMBER_STEP[args.source] / 1e6:,.0f} MB, "
          f"{args.workers} at a time)", flush=True)
    cache = ROOT / ".cache" / "gefs" / run
    cache.mkdir(parents=True, exist_ok=True)
    timing.start("download", workers=args.workers)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(lambda pair: fetch(cache, args.source, run, pair[1], pair[0]),
                      [(hour, member) for hour in hours for member in members]))
    print("Downloads complete. Validating every member and cropping to Ireland…", flush=True)
    timing.start("decode")
    output = ROOT / "public" / "weather"
    prefix = f"gefs-{run}-{args.hours}h-v1"
    spots = load_spots()
    print(f"Sampling {len(spots)} spots from {spots_file()}", flush=True)
    spot_forecasts = {spot["id"]: [] for spot in spots}
    spot_members, member_spots = {}, None
    layout, frames = None, []
    for hour in hours:
        fields, layout = decode_step(cache, args.source, run, hour, members, layout)
        grid = layout[2]
        valid = (run_time + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
        # Instantaneous gust: the interval is the forecast time itself, hour 0 included.
        interval = [hour, hour]
        mean = {field: average([fields[field][member] for member in members])
                for field in ("u", "v", "gust")}
        payload = {"model": "gefs", "run": run, "hour": hour, "validTime": valid, "grid": grid,
                   "gustIntervalHours": interval, **mean}
        publish_frame(output, prefix, payload)
        frames.append({"hour": hour, "validTime": valid, "gustIntervalHours": interval})
        if member_spots is None:
            # A member series of nulls is unpublishable and useless: the ensemble
            # contract requires a number per member. The grid never moves within a
            # run, so one test at the first step decides for every hour.
            member_spots = [spot for spot in spots
                            if sample(grid, mean["u"], spot["lon"], spot["lat"]) is not None]
            outside = [spot["id"] for spot in spots if spot not in member_spots]
            if not member_spots:
                raise ValueError("No riding location falls inside the GEFS crop")
            if outside:
                print(f"Outside the 0.25° crop, no member series for: {', '.join(outside)}",
                      file=sys.stderr)
            spot_members = {spot["id"]: [] for spot in member_spots}
        for spot in spots:
            lon, lat = spot["lon"], spot["lat"]
            spot_forecasts[spot["id"]].append({
                "hour": hour, "validTime": valid,
                **{field: sample(grid, values, lon, lat) for field, values in mean.items()}})
            if spot["id"] in spot_members:
                spot_members[spot["id"]].append({
                    "hour": hour, "validTime": valid,
                    **{field: [sample(grid, fields[field][member], lon, lat) for member in members]
                       for field in ("u", "v", "gust")}})
        print(f"  Validated +{hour:03d}h — {len(members)} members, gust {interval}", flush=True)
    manifest = {
        "schemaVersion": 1, "model": "gefs", "modelName": "GEFS", "provider": "NOAA NCEP",
        "modelDetail": f"Global Ensemble Forecast System, 0.25°, {len(members)} members",
        "resolutionKm": None, "resolutionLabel": "0.25° global grid", "run": run,
        "runTime": run_time.isoformat().replace("+00:00", "Z"),
        "generatedAt": datetime.now(timezone.utc).isoformat(), "stepHours": args.step,
        "stepRanges": ranges, "grid": layout[2], "frames": frames,
        "spotForecasts": spot_forecasts, "spotMembers": spot_members,
        "ensemble": {"members": len(members), "control": 0,
                     "description": f"NOAA GEFS members 0–{len(members) - 1}: index 0 is the "
                     f"gec00 low-resolution control and 1–{len(members) - 1} are the perturbed "
                     f"members gep01–gep{len(members) - 1:02d} of {PERTURBED}. Perturbed members "
                     "are exchangeable, so a leading subset is a valid random subsample, not a "
                     "selection of better members. The control is a forecast in its own right, "
                     "not a best estimate, and is included in the published mean."},
        "spotForecastsDescription": "spotForecasts holds the ensemble MEAN u/v/gust per spot, "
        "sampled from the published mean frames. Per-member values are in spotMembers, indexed "
        "identically for every hour with the control at index 0. A mean is not the most likely "
        "outcome; use the members for spread and probabilities. It is also a VECTOR mean of u "
        "and v, so when members disagree on direction its speed is lower than the members' "
        "median speed, increasingly so with lead time. Derive a speed distribution from "
        "spotMembers rather than reading the mean as a forecast wind strength.",
        "gustAvailable": True, "gustKind": "instantaneous",
        "gustDescription": "Ensemble-mean instantaneous surface wind gust valid at the forecast "
        "time itself, not a maximum over a preceding period. Every frame therefore declares a "
        "zero-length interval, including initialization, and no forecast time is missing a gust. "
        "These values read lower than the interval maxima published for ICON-EU and ECMWF, so do "
        "not compare them directly across models; they match the GFS control product's semantics. "
        "Averaging gusts across members lowers them further than any single member's gust.",
        "processing": f"Ensemble mean of members 0–{len(members) - 1} (control first), cropped "
        "from NOAA's 0.25° global regular latitude/longitude grid without downscaling; source "
        "0–360° longitudes are normalised to −180…180° before cropping to 18°W–2°E, 48–59°N. "
        f"Rows run north-to-south and columns west-to-east. Uniform {args.step}-hour source steps "
        f"to +{args.hours}h; no hours are interpolated or invented. Values are model output in "
        "m/s rounded to 0.01. Frames carry the mean only: member spread is published solely as "
        "per-spot series, because 31 member grids per step would be unusable in a browser. "
        "Ensemble spread describes model uncertainty, not local terrain effects, and is not a "
        "measured probability of rideable conditions.",
        "sourceUrl": SOURCE_URL,
        "attribution": "Weather data: NOAA/NCEP Global Ensemble Forecast System (GEFS), a work "
        "of the US Government in the public domain. Cropped, converted and processed by Force5 "
        "(wingfoil.ie); this is modified NOAA output, not official government material, and "
        "NOAA/NWS does not endorse Force5.",
        "licenseUrl": "https://www.weather.gov/disclaimer",
    }
    # Only this final operation advances the published snapshot.
    write_run(output, "gefs.json", manifest, prefix, spots)
    print(f"Published {len(frames)} GEFS mean frames and {len(spot_members)} member series to "
          f"{output / 'gefs.json'}", flush=True)
    cached = sum(path.stat().st_size for path in cache.glob("*.grib2"))
    print(f"Transferred {Meter.total / 1e6:.1f} MB this run over {member_steps} member-steps "
          f"({Meter.total / max(member_steps, 1) / 1e3:.1f} kB each); {cached / 1e6:.1f} MB of "
          f"source GRIB is cached under {cache}", flush=True)


if __name__ == "__main__":
    try:
        # A run that is already published exits UNCHANGED_EXIT, which the worker
        # reads as "nothing new", not as a failure and not as a bundle to validate.
        sys.exit(main() or 0)
    except Exception as error:
        print(f"GEFS refresh failed: {error}. Last published snapshot preserved.", file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
