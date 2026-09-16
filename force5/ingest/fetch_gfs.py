"""Download NOAA GFS 0.25° wind and atomically publish an Ireland-only snapshot.

Public domain source, no API key. The primary NOMADS GRIB filter returns only the
Ireland/Atlantic subregion (about 15 KB per step for u, v and gust); `--source s3`
falls back to the NOAA Open Data bucket, reading the `.idx` sidecar and requesting
the three whole-globe messages by byte range. GFS gusts are INSTANTANEOUS surface
values, not period maxima: see the published gustDescription.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import re
import sys
import threading
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import eccodes as ec

from fetch_forecast import BBOX, ROOT, SPOTS_FILE, decode_handle, sample, write_json

FILTER = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
BUCKET = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
SOURCE_URL = "https://www.nco.ncep.noaa.gov/pmb/products/gfs/"
USER_AGENT = "Force5/0.1 (+https://wingfoil.ie forecast ingest; contact via site)"
# GRIB identity of the three messages we accept, by category/number/level type.
FIELDS = {(2, 2, "heightAboveGround"): "u", (2, 3, "heightAboveGround"): "v",
          (2, 22, "surface"): "gust"}
# .idx record selectors, in the order they are concatenated into one GRIB stream.
RECORDS = (("UGRD", "10 m above ground"), ("VGRD", "10 m above ground"), ("GUST", "surface"))
HOURLY_THROUGH = 120  # GFS publishes 1-hour steps only this far; 3-hourly beyond.
DEFAULT_HOURS = {3: 240, 1: HOURLY_THROUGH}  # Horizon when --hours is not given.
MAX_HOURS = 384
MAX_AGE_HOURS = 12  # Cycles are 6-hourly and publish 3.5–5.5 hours after run time.
PAUSE = {"nomads": 0.6, "s3": 0.05}  # Minimum seconds between requests to a source.


class Throttle:
    """Serialise request starts so two workers stay well inside NOMADS' limits."""

    def __init__(self, pause=0.6):
        self.pause, self.lock, self.last = pause, threading.Lock(), 0.0

    def wait(self):
        with self.lock:
            delay = self.pause - (time.monotonic() - self.last)
            if delay > 0:
                time.sleep(delay)
            self.last = time.monotonic()


THROTTLE = Throttle()


def get(url, headers=None, attempts=4):
    for attempt in range(attempts):
        THROTTLE.wait()
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
            with urlopen(request, timeout=90) as response:
                return response.read()
        except HTTPError as error:
            # A missing or rejected object is a real answer; only retry transient faults.
            if error.code in (400, 403, 404) or attempt == attempts - 1:
                raise
        except Exception:
            if attempt == attempts - 1:
                raise
        time.sleep(2 ** attempt)


def validate_metadata(metadata, field, run, hour):
    """GFS contract: 10 m earth-relative u/v plus an instantaneous surface gust."""
    expected = {"u": 2, "v": 3, "gust": 22}[field]
    if metadata["parameterCategory"] != 2 or metadata["parameterNumber"] != expected:
        raise ValueError(f"Wrong GRIB parameter for {field}")
    if metadata["units"] not in ("m s**-1", "m s-1"):
        raise ValueError("Expected wind speed in metres per second")
    if (metadata["typeOfLevel"], metadata["level"]) != (("surface", 0) if field == "gust" else ("heightAboveGround", 10)):
        raise ValueError(f"Unexpected level for {field}")
    if metadata["gridType"] != "regular_ll" or metadata["uvRelativeToGrid"] != 0:
        raise ValueError("Expected regular latitude/longitude and earth-relative vectors")
    if metadata["stepType"] != "instant":
        raise ValueError("Expected instantaneous GFS fields, including the surface gust")
    if metadata["stepUnits"] != 1 or metadata["startStep"] != hour or metadata["endStep"] != hour:
        raise ValueError("Forecast lead time mismatch")
    if f'{metadata["dataDate"]}{metadata["dataTime"]:04d}' != run + "00":
        raise ValueError("Mixed forecast runs")
    expected_valid = datetime.strptime(run, "%Y%m%d%H") + timedelta(hours=hour)
    if f'{metadata["validityDate"]}{metadata["validityTime"]:04d}' != expected_valid.strftime("%Y%m%d%H%M"):
        raise ValueError("Valid time mismatch")


def decode(path, run, hour, layout=None):
    """Validate and crop every message of a three-field GFS step."""
    fields = {}
    with path.open("rb") as stream:
        while True:
            handle = ec.codes_grib_new_from_file(stream)
            if handle is None:
                break
            try:
                if ec.codes_get(handle, "centre") != "kwbc":
                    raise ValueError("Expected an NCEP (kwbc) GFS message")
                field = FIELDS.get((ec.codes_get(handle, "parameterCategory"),
                                    ec.codes_get(handle, "parameterNumber"),
                                    ec.codes_get(handle, "typeOfLevel")))
                if field is None or field in fields:
                    raise ValueError("Unexpected or duplicate GFS wind message")
            except Exception:
                ec.codes_release(handle)
                raise
            # decode_handle normalises 0–360° longitudes before cropping to BBOX.
            fields[field], layout, _ = decode_handle(handle, field, run, hour, layout, validate_metadata)
    if set(fields) != set(FIELDS.values()):
        raise ValueError("Missing GFS wind or gust component")
    if layout[2]["dx"] != 0.25 or layout[2]["dy"] != 0.25:
        raise ValueError("Expected the 0.25-degree GFS grid")
    return fields, layout


def filter_url(run, hour):
    west, south, east, north = BBOX
    return FILTER + "?" + urlencode({
        "dir": f"/gfs.{run[:8]}/{run[-2:]}/atmos",
        "file": f"gfs.t{run[-2:]}z.pgrb2.0p25.f{hour:03d}",
        "var_UGRD": "on", "var_VGRD": "on", "var_GUST": "on",
        "lev_10_m_above_ground": "on", "lev_surface": "on",
        "subregion": "", "leftlon": west, "rightlon": east, "toplat": north, "bottomlat": south})


def object_key(run, hour):
    return f"gfs.{run[:8]}/{run[-2:]}/atmos/gfs.t{run[-2:]}z.pgrb2.0p25.f{hour:03d}"


def index_ranges(text, hour):
    """Byte ranges of u, v and gust in a GFS `.idx` sidecar, in file order."""
    entries = []
    for line in text.splitlines():
        parts = line.split(":")
        if len(parts) >= 6 and parts[1].isdigit():
            entries.append((int(parts[1]), parts[3], parts[4], parts[5]))
    if not entries:
        raise ValueError("Unreadable GFS index")
    step = "anl" if hour == 0 else f"{hour} hour fcst"
    ranges = []
    for name, level in RECORDS:
        found = [i for i, entry in enumerate(entries) if entry[1:] == (name, level, step)]
        if len(found) != 1:
            raise ValueError(f"GFS index has no single {name} at {level} for +{hour:03d}h")
        start = entries[found[0]][0]
        # The record ends where the next one begins; the last runs to end of file.
        end = entries[found[0] + 1][0] - 1 if found[0] + 1 < len(entries) else ""
        ranges.append((start, end))
    return ranges


def download(source, run, hour):
    if source == "nomads":
        return get(filter_url(run, hour))
    key = object_key(run, hour)
    text = get(f"{BUCKET}/{key}.idx").decode()
    return b"".join(get(f"{BUCKET}/{key}", headers={"Range": f"bytes={start}-{end}"})
                    for start, end in index_ranges(text, hour))


def inventory(source, run):
    """Forecast hours the provider actually lists for a run. No release-time guesses."""
    pattern = rf"gfs\.t{run[-2:]}z\.pgrb2\.0p25\.f(\d{{3}})"
    if source == "s3":
        prefix = f"gfs.{run[:8]}/{run[-2:]}/atmos/gfs.t{run[-2:]}z.pgrb2.0p25."
        hours, token = set(), ""
        for _ in range(8):
            url = f"{BUCKET}/?list-type=2&max-keys=1000&prefix={quote(prefix)}"
            body = get(url + (f"&continuation-token={quote(token)}" if token else "")).decode()
            # Require the sidecar: ranged reads need it, and it is written last.
            hours.update(int(value) for value in re.findall(pattern + r"\.idx</Key>", body))
            follow = re.search(r"<NextContinuationToken>([^<]+)</", body)
            if not follow:
                return hours
            token = follow.group(1)
        raise RuntimeError("Unexpectedly long GFS object listing")
    page = get(f"{FILTER}?dir=%2Fgfs.{run[:8]}%2F{run[-2:]}%2Fatmos").decode("utf-8", "replace")
    return {int(value) for value in re.findall(pattern + r"(?!\d)", page)}


def candidates(requested_run, now):
    if requested_run:
        return [requested_run]
    latest = now.replace(minute=0, second=0, microsecond=0, hour=now.hour // 6 * 6)
    # Only cycles that can still pass the freshness check below are worth listing.
    return [(latest - timedelta(hours=6 * index)).strftime("%Y%m%d%H")
            for index in range(MAX_AGE_HOURS // 6)]


def discover(source, hours, requested_run=None, now=None):
    """Newest cycle whose listing contains every requested step."""
    for run in candidates(requested_run, now or datetime.now(timezone.utc)):
        try:
            available = inventory(source, run)
        except Exception as error:
            print(f"Inventory unavailable ({run}): {error}", file=sys.stderr)
            continue
        if set(hours) <= available:
            return run
        print(f"Skipping incomplete GFS {run}: {len(set(hours) - available)} step(s) missing", flush=True)
    raise RuntimeError("No complete requested GFS run is available. Existing forecast has not been changed.")


def run_datetime(run):
    if not re.fullmatch(r"\d{10}", run or ""):
        raise ValueError("A GFS run identifier is YYYYMMDDHH")
    value = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    if value.hour not in (0, 6, 12, 18):
        raise ValueError("GFS runs at 00, 06, 12 and 18 UTC only")
    return value


def load_spots():
    """Spot catalogue: the env override, else riding locations beside it, else spots."""
    preferred = SPOTS_FILE.parent / "riding-locations.json"
    if not os.environ.get("FORCE5_SPOTS_FILE") and preferred.exists():
        try:
            return preferred, usable_spots(json.loads(preferred.read_text()))
        except Exception as error:
            # A partly written or reshaped catalogue must not fail the forecast.
            print(f"Ignoring {preferred.name}: {error}", file=sys.stderr)
    return SPOTS_FILE, usable_spots(json.loads(SPOTS_FILE.read_text()))


def usable_spots(value):
    spots = value.get("locations", value) if isinstance(value, dict) else value
    if not isinstance(spots, list) or not spots:
        raise ValueError("Expected a non-empty list of spots")
    chosen = [spot for spot in spots if isinstance(spot, dict) and isinstance(spot.get("id"), str)
              and spot["id"] and all(isinstance(spot.get(key), (int, float))
                                     and not isinstance(spot.get(key), bool) for key in ("lat", "lon"))]
    if len(chosen) != len(spots) or len({spot["id"] for spot in chosen}) != len(chosen):
        raise ValueError("Spots need a unique id and numeric lat/lon")
    return chosen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, help=f"3–{MAX_HOURS}, divisible by --step; "
                        f"default {DEFAULT_HOURS[3]} at 3-hour steps, {DEFAULT_HOURS[1]} hourly")
    parser.add_argument("--step", type=int, choices=[1, 3], default=3)
    parser.add_argument("--run", help="Optional specific YYYYMMDDHH run (00/06/12/18)")
    parser.add_argument("--source", choices=["nomads", "s3"], default="nomads",
                        help="NOMADS subregion filter, or ranged reads from NOAA's S3 mirror")
    args = parser.parse_args()
    if args.hours is None:
        args.hours = DEFAULT_HOURS[args.step]
    if not 3 <= args.hours <= MAX_HOURS or args.hours % args.step:
        parser.error(f"Use 3–{MAX_HOURS} hours divisible by the step")
    if args.step == 1 and args.hours > HOURLY_THROUGH:
        parser.error(f"GFS publishes hourly steps only through +{HOURLY_THROUGH}h; use --step 3")
    THROTTLE.pause = PAUSE[args.source]
    hours = list(range(0, args.hours + 1, args.step))
    run = discover(args.source, hours, args.run)
    run_time = run_datetime(run)
    age = (datetime.now(timezone.utc) - run_time).total_seconds() / 3600
    if not -1 <= age <= MAX_AGE_HOURS:
        raise ValueError(f"Refusing a stale/future GFS run (maximum age {MAX_AGE_HOURS} hours)")
    print(f"Fetching GFS 0.25° {run} from {args.source}: {len(hours)} frames through +{args.hours}h", flush=True)
    cache = ROOT / ".cache" / "gfs" / run
    cache.mkdir(parents=True, exist_ok=True)

    def fetch(hour):
        path = cache / f"{hour:03d}.grib2"
        # Revalidate cached data; a truncated cache entry must never publish.
        if path.exists():
            try:
                return hour, decode(path, run, hour)
            except Exception:
                print(f"Re-fetching invalid cached frame +{hour:03d}h", flush=True)
        data = download(args.source, run, hour)
        if not data.startswith(b"GRIB"):
            raise ValueError(f"Not a GRIB response for +{hour:03d}h")
        temporary = path.with_suffix(".download")
        temporary.write_bytes(data)
        decoded = decode(temporary, run, hour)
        os.replace(temporary, path)
        print(f"  Validated +{hour:03d}h ({len(data)} bytes)", flush=True)
        return hour, decoded

    # Two concurrent requests at most: NOMADS asks well-behaved clients to stay low.
    with ThreadPoolExecutor(max_workers=2) as pool:
        decoded = dict(pool.map(fetch, hours))
    output = ROOT / "public" / "weather"
    prefix = f"gfs-{run}-{args.hours}h-v1"
    spots_file, spots = load_spots()
    print(f"Sampling {len(spots)} spots from {spots_file}", flush=True)
    spot_forecasts = {spot["id"]: [] for spot in spots}
    signature, grid = decoded[0][1][0], decoded[0][1][2]
    frames = []
    for hour in hours:
        fields, layout = decoded[hour]
        if layout[0] != signature or layout[2] != grid:
            raise ValueError("GFS grid changed within the run")
        valid = (run_time + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
        # Instantaneous gust: the interval is the forecast time itself, hour 0 included.
        interval = [hour, hour]
        payload = {"model": "gfs", "run": run, "hour": hour, "validTime": valid, "grid": grid,
                   "gustIntervalHours": interval, **fields}
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:12]
        name = f"{prefix}/{hour:03d}-{digest}.json"
        write_json(output / name, payload)
        frames.append({"hour": hour, "validTime": valid, "url": f"weather/{name}",
                       "gustIntervalHours": interval})
        for spot in spots:
            spot_forecasts[spot["id"]].append({"hour": hour, "validTime": valid,
                **{field: sample(grid, values, spot["lon"], spot["lat"]) for field, values in fields.items()}})
    manifest = {
        "schemaVersion": 1, "model": "gfs", "modelName": "GFS", "provider": "NOAA NCEP",
        "modelDetail": "Global Forecast System, 0.25° deterministic", "resolutionKm": None,
        "resolutionLabel": "0.25° global grid", "run": run,
        "runTime": run_time.isoformat().replace("+00:00", "Z"),
        "generatedAt": datetime.now(timezone.utc).isoformat(), "stepHours": args.step,
        "grid": grid, "frames": frames, "spotForecasts": spot_forecasts,
        "gustAvailable": True, "gustKind": "instantaneous",
        "gustDescription": "GFS publishes an instantaneous surface wind gust valid at the forecast time itself, not a maximum over a preceding period. Every frame therefore declares a zero-length interval, including initialization, and no forecast time is missing a gust. These values are generally lower than the interval maxima published for ICON-EU and ECMWF, so do not compare them directly across models.",
        "processing": "Cropped from NOAA's 0.25° global regular latitude/longitude grid without downscaling; source 0–360° longitudes are normalised to −180…180° before cropping to 18°W–2°E, 48–59°N. Rows run north-to-south and columns west-to-east. Values are model output in m/s rounded to 0.01. Only native GFS steps are published: no hours are interpolated or invented.",
        "sourceUrl": SOURCE_URL,
        "attribution": "Weather data: NOAA/NCEP Global Forecast System (GFS), a work of the US Government in the public domain. Cropped, converted and processed by Force5 (wingfoil.ie); this is modified NOAA output, not official government material, and NOAA/NWS does not endorse Force5.",
        "licenseUrl": "https://www.weather.gov/disclaimer",
    }
    # Only this final operation advances the published snapshot.
    write_json(output / "gfs.json", manifest)
    print(f"Published {len(frames)} GFS frames to {output / 'gfs.json'}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"GFS refresh failed: {error}. Last published snapshot preserved.", file=sys.stderr)
        sys.exit(1)
