"""Download DWD ICON-EU GRIB2 and atomically publish an Ireland-only snapshot.

No API key. All stored values are model output in m/s, rounded to 0.01 m/s.
Requires Python 3.9+ and scripts/requirements.txt. See README for usage.
"""
import argparse
import bz2
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import time
from urllib.request import Request, urlopen

import eccodes as ec
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ROOT = Path(os.environ.get("FORCE5_WORK_DIR", str(PROJECT_ROOT))).resolve()
RIDING_LOCATIONS_FILE = PROJECT_ROOT / "public" / "riding-locations.json"
ORIGINAL_SPOTS_FILE = PROJECT_ROOT / "public" / "spots.json"
BASE = "https://opendata.dwd.de/weather/nwp/icon-eu/grib"
PARAMS = {"u": "u_10m", "v": "v_10m", "gust": "vmax_10m"}
BBOX = (-18.0, 48.0, 2.0, 59.0)  # Ireland + Atlantic buffer, west/south/east/north
KEYS = ["Ni", "Nj", "latitudeOfFirstGridPointInDegrees", "longitudeOfFirstGridPointInDegrees",
        "iDirectionIncrementInDegrees", "jDirectionIncrementInDegrees", "jScansPositively",
        "iScansNegatively", "jPointsAreConsecutive", "alternativeRowScanning"]


def spots_file():
    """Every adapter precomputes series for the public riding places.

    `npm run spots:export` regenerates riding-locations.json from src/locations.ts,
    so the browser and the pipeline cannot disagree about ids or coordinates.
    """
    configured = os.environ.get("FORCE5_SPOTS_FILE")
    if configured:
        return Path(configured)
    if RIDING_LOCATIONS_FILE.exists():
        return RIDING_LOCATIONS_FILE
    print(f"Warning: {RIDING_LOCATIONS_FILE} is absent; using the original eight spots. "
          "Run 'npm run spots:export' to publish series for every riding location.", file=sys.stderr)
    return ORIGINAL_SPOTS_FILE


def load_spots():
    spots = json.loads(spots_file().read_text())
    ids = [spot["id"] for spot in spots]
    if not spots or len(set(ids)) != len(ids):
        raise ValueError("Empty or duplicated spot catalogue")
    for spot in spots:
        if not (-90 <= spot["lat"] <= 90 and -180 <= spot["lon"] <= 180):
            raise ValueError(f"Invalid coordinate for spot {spot['id']}")
    return spots


def get(url):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": "Force5/0.1 (wingfoil.ie prototype)"}), timeout=45) as response:
                return response.read()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def listing(cycle, parameter):
    html = get(f"{BASE}/{cycle}/{parameter}/").decode()
    names = re.findall(r'href="(icon-eu_europe_regular-lat-lon_single-level_(\d{10})_(\d{3})_[A-Z0-9_]+\.grib2\.bz2)"', html)
    return {(run, int(hour)): f"{BASE}/{cycle}/{parameter}/{name}" for name, run, hour in names}


def discover(hours, requested_run=None):
    # Main cycles have the full horizon. Inspect inventories, not assumptions about release time.
    inventories = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {pool.submit(listing, cycle, parameter): (cycle, field)
                   for cycle in ["00", "06", "12", "18"] for field, parameter in PARAMS.items()}
        for future in as_completed(pending):
            cycle, field = pending[future]
            try:
                inventories[(cycle, field)] = future.result()
            except Exception as error:
                print(f"Inventory unavailable ({cycle}/{field}): {error}", file=sys.stderr)
    candidates = sorted({run for inventory in inventories.values() for run, _ in inventory}, reverse=True)
    for run in candidates:
        if requested_run and run != requested_run:
            continue
        cycle = run[-2:]
        if all((run, hour) in inventories.get((cycle, field), {}) for hour in hours for field in PARAMS):
            return run, {(hour, field): inventories[(cycle, field)][(run, hour)] for hour in hours for field in PARAMS}
    raise RuntimeError("No complete requested run is available. Existing forecast has not been changed.")


def validate_metadata(metadata, field, run, hour):
    expected = {"u": 2, "v": 3, "gust": 22}[field]
    if metadata["parameterCategory"] != 2 or metadata["parameterNumber"] != expected:
        raise ValueError(f"Wrong GRIB parameter for {field}")
    if metadata["units"] not in ("m s**-1", "m s-1") or metadata["level"] != 10 or metadata["typeOfLevel"] != "heightAboveGround":
        raise ValueError("Expected 10 m wind in metres per second")
    if metadata["gridType"] != "regular_ll" or metadata["uvRelativeToGrid"] != 0:
        raise ValueError("Expected regular latitude/longitude and earth-relative vectors")
    if metadata["stepUnits"] != 1 or metadata["endStep"] != hour:
        raise ValueError("Forecast lead time mismatch")
    if f'{metadata["dataDate"]}{metadata["dataTime"]:04d}' != run + "00":
        raise ValueError("Mixed forecast runs")
    expected_valid = datetime.strptime(run, "%Y%m%d%H") + timedelta(hours=hour)
    if f'{metadata["validityDate"]}{metadata["validityTime"]:04d}' != expected_valid.strftime("%Y%m%d%H%M"):
        raise ValueError("Valid time mismatch")
    if metadata["stepType"] != ("max" if field == "gust" else "instant"):
        raise ValueError("Unexpected statistical processing")


def decode(path, field, run, hour, layout=None):
    handle = ec.codes_new_from_message(bz2.decompress(path.read_bytes()))
    return decode_handle(handle, field, run, hour, layout)


def decode_handle(handle, field, run, hour, layout=None, validate=validate_metadata):
    """Validate/crop a regular earth-relative GRIB; takes ownership of handle.

    `validate` lets another provider apply its own parameter/level/step rules."""
    try:
        # ecCodes represents zero-length steps in minutes unless explicitly normalised.
        ec.codes_set(handle, "stepUnits", 1)
        metadata = {key: ec.codes_get(handle, key) for key in ["parameterCategory", "parameterNumber", "units", "level", "typeOfLevel",
                    "gridType", "uvRelativeToGrid", "stepUnits", "startStep", "endStep", "dataDate", "dataTime", "validityDate", "validityTime", "stepType"]}
        validate(metadata, field, run, hour)
        signature = tuple(ec.codes_get(handle, key) for key in KEYS)
        if layout is None:
            lats = ec.codes_get_array(handle, "latitudes")
            lons = (ec.codes_get_array(handle, "longitudes") + 180) % 360 - 180
            west, south, east, north = BBOX
            selected = np.flatnonzero((lats >= south) & (lats <= north) & (lons >= west) & (lons <= east))
            selected = selected[np.lexsort((lons[selected], -lats[selected]))]
            xs = np.unique(lons[selected])
            ys = np.unique(lats[selected])[::-1]
            if len(selected) != len(xs) * len(ys) or len(xs) < 2 or len(ys) < 2:
                raise ValueError("Crop is not a complete regular grid")
            if not np.allclose(np.diff(xs), np.diff(xs)[0]) or not np.allclose(np.diff(ys), np.diff(ys)[0]):
                raise ValueError("Unexpected irregular grid spacing")
            grid = {"width": len(xs), "height": len(ys), "west": float(xs[0]), "east": float(xs[-1]),
                    "north": float(ys[0]), "south": float(ys[-1]), "dx": float(xs[1] - xs[0]), "dy": float(ys[0] - ys[1]),
                    "order": "north-to-south, west-to-east", "units": "m/s"}
            layout = (signature, selected, grid)
        if signature != layout[0]:
            raise ValueError("Grid changed within a run")
        values = ec.codes_get_values(handle)[layout[1]]
        if not np.all(np.isfinite(values)) or np.any(np.abs(values) > 150) or (field == "gust" and np.any(values < 0)):
            raise ValueError("Missing or implausible wind values")
        return np.round(values, 2).tolist(), layout, metadata
    finally:
        ec.codes_release(handle)


def sample(grid, values, lon, lat):
    x = (lon - grid["west"]) / grid["dx"]
    y = (grid["north"] - lat) / grid["dy"]
    if not (0 <= x <= grid["width"] - 1 and 0 <= y <= grid["height"] - 1):
        return None
    x0, y0 = min(math.floor(x), grid["width"] - 2), min(math.floor(y), grid["height"] - 2)
    tx, ty = x - x0, y - y0
    i = y0 * grid["width"] + x0
    return round((values[i] * (1-tx) + values[i+1] * tx) * (1-ty) +
                 (values[i+grid["width"]] * (1-tx) + values[i+grid["width"]+1] * tx) * ty, 2)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, separators=(",", ":"), allow_nan=False))
    os.replace(temporary, path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, default=72)
    parser.add_argument("--step", type=int, default=3)
    parser.add_argument("--run", help="Optional specific YYYYMMDDHH run")
    args = parser.parse_args()
    if not 3 <= args.hours <= 72 or args.step not in (1, 3) or args.hours % args.step:
        parser.error("Use 3–72 hours, step 1 or 3, with hours divisible by step")
    hours = list(range(0, args.hours + 1, args.step))
    run, urls = discover(hours, args.run)
    print(f"Fetching ICON-EU {run}, {len(hours)} frames ({len(urls)} fields)", flush=True)
    cache = ROOT / ".cache" / "grib" / run
    cache.mkdir(parents=True, exist_ok=True)

    def download(item):
        (hour, field), url = item
        path = cache / f"{hour:03d}-{field}.grib2.bz2"
        if not path.exists():
            data = get(url)
            # Reject incomplete/error responses before adding to cache.
            if not bz2.decompress(data).startswith(b"GRIB"):
                raise ValueError(f"Not a GRIB response: {url}")
            temporary = path.with_suffix(".download")
            temporary.write_bytes(data)
            os.replace(temporary, path)
        return (hour, field), path

    with ThreadPoolExecutor(max_workers=4) as pool:
        paths = dict(pool.map(download, urls.items()))
    print("Downloads complete. Validating and cropping to Ireland…", flush=True)
    output = ROOT / "public" / "weather"
    run_time = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    # A content/version-specific prefix prevents cache collisions on importer changes.
    prefix = f"icon-eu-{run}-{args.hours}h-v1"
    layout = None
    frames = []
    spots = load_spots()
    spot_forecasts = {spot["id"]: [] for spot in spots}
    for hour in hours:
        fields = {}
        gust_interval = None
        for field in PARAMS:
            values, layout, metadata = decode(paths[(hour, field)], field, run, hour, layout)
            fields[field] = values
            if field == "gust":
                gust_interval = [int(metadata["startStep"]), int(metadata["endStep"])]
        grid = layout[2]
        valid = (run_time + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
        payload = {"model": "icon-eu", "run": run, "hour": hour, "validTime": valid, "grid": grid,
                   "gustIntervalHours": gust_interval, **fields}
        # Hash makes every published frame immutable, including after a code correction.
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:12]
        name = f"{prefix}/{hour:03d}-{digest}.json"
        write_json(output / name, payload)
        frames.append({"hour": hour, "validTime": valid, "url": f"weather/{name}", "gustIntervalHours": gust_interval})
        for spot in spots:
            point = {field: sample(grid, fields[field], spot["lon"], spot["lat"]) for field in PARAMS}
            spot_forecasts[spot["id"]].append({"hour": hour, "validTime": valid, **point})
        print(f"  +{hour:03d}h — {grid['width']} × {grid['height']}", flush=True)
    manifest = {"schemaVersion": 1, "model": "icon-eu", "modelName": "ICON-EU", "provider": "DWD",
                "resolutionKm": 6.5, "run": run, "runTime": run_time.isoformat().replace("+00:00", "Z"),
                "generatedAt": datetime.now(timezone.utc).isoformat(), "stepHours": args.step,
                "grid": layout[2], "frames": frames, "spotForecasts": spot_forecasts,
                "sourceUrl": BASE + "/", "attribution": "Weather data: Deutscher Wetterdienst (DWD), modified and cropped by wingfoil.ie",
                "licenseUrl": "https://www.dwd.de/EN/service/legal_notice/legal_notice_node.html"}
    # Only this final operation advances the published snapshot.
    write_json(output / "latest.json", manifest)
    print(f"Published {len(frames)} real forecast frames to {output / 'latest.json'}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Forecast refresh failed: {error}. Last published snapshot preserved.", file=sys.stderr)
        sys.exit(1)
