"""Publish Met Éireann HARMONIE-AROME DINI control wind and gusts for Ireland.

Uses the public near-real-time portal, not its authenticated archive. Only a
complete requested run is published. No model substitution.

Gust speed is the control's own time-maximum 10 m gust. The Ireland subset
publishes it as the signed component pair (GRIB2 parameters 23/24, `max_10efg` /
`max_10nfg`) rather than the scalar parameter 22 (`max_i10fg`). Both are present
together in the full-domain `CONTROL_grib2_ie` export, where the components'
magnitude reproduces the scalar to within GRIB packing precision, so the
magnitude is the provider's gust and not a derived estimate. See docs/GUST_DATA.md.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import os
import re
import sys
from urllib.parse import urlencode
import zipfile

import eccodes as ec
import numpy as np
from pyproj import Proj

from fetch_forecast import ROOT, SPOTS_FILE, get, sample, write_json

PORTAL = "https://opendata.met.ie"
MODEL = "harmonie"
# Fully inside the ieIoI Lambert subset; no extrapolation outside native coverage.
GRID = {"width": 233, "height": 236, "west": -10.9, "east": -5.1,
        "north": 55.7, "south": 51.0, "dx": 0.025, "dy": 0.02,
        "order": "north-to-south, west-to-east", "units": "m/s"}
GEOMETRY = ["Nx", "Ny", "DxInMetres", "DyInMetres", "latitudeOfFirstGridPointInDegrees",
            "longitudeOfFirstGridPointInDegrees", "LoVInDegrees", "LaDInDegrees",
            "Latin1InDegrees", "Latin2InDegrees", "shapeOfTheEarth", "iScansNegatively",
            "jScansPositively", "jPointsAreConsecutive", "alternativeRowScanning", "uvRelativeToGrid"]
# The only 10 m parameters cached. 2/3 are the instantaneous wind; 23/24 are the
# time-maximum gust components. Scalar gust 22 is absent from this Irish subset.
PARAMETERS = {"u": 2, "v": 3, "gustEast": 23, "gustNorth": 24}
FIELDS = {number: field for field, number in PARAMETERS.items()}
GUST_FIELDS = ("gustEast", "gustNorth")
MAX_SPEED = 150


def inventory():
    now = datetime.now(timezone.utc)
    query = urlencode({"from": (now - timedelta(hours=2, minutes=55)).strftime("%Y-%m-%d %H:%M"),
                       "to": (now - timedelta(minutes=1)).strftime("%Y-%m-%d %H:%M")})
    items = json.loads(get(f"{PORTAL}/data-portal/near-realtime/nwp?{query}"))
    if not isinstance(items, list):
        raise ValueError("Met Éireann returned an invalid inventory")
    return items


def discover(items, hours, requested_run=None):
    files = {}
    for item in items:
        match = re.fullmatch(r"fc(\d{10})\+(\d{3})CONTROL_grib2_ieIoI", item.get("name", ""))
        if match:
            files[(match[1], int(match[2]))] = item["name"]
    for run in sorted({r for r, _ in files}, reverse=True):
        if (not requested_run or run == requested_run) and all((run, h) in files for h in hours):
            return run, {h: files[(run, h)] for h in hours}
    raise RuntimeError("No complete HARMONIE control run in the public three-hour inventory. Try again later; existing snapshots are unchanged.")


def messages(data):
    offset = 0
    while offset < len(data):
        if data[offset:offset+4] != b"GRIB" or data[offset+7:offset+8] != b"\x02":
            raise ValueError("Invalid GRIB2 stream")
        length = int.from_bytes(data[offset+8:offset+16], "big")
        if length < 20 or offset + length > len(data) or data[offset+length-4:offset+length] != b"7777":
            raise ValueError("Truncated GRIB2 message")
        yield data[offset:offset+length]
        offset += length


def extract(data):
    """Cache only the 10 m wind and its time-maximum gust components."""
    found = {}
    for message in messages(data):
        h = ec.codes_new_from_message(message)
        try:
            if (ec.codes_get(h, "discipline") == 0 and ec.codes_get(h, "parameterCategory") == 2
                    and ec.codes_get(h, "typeOfLevel") == "heightAboveGround" and ec.codes_get(h, "level") == 10):
                field = FIELDS.get(ec.codes_get(h, "parameterNumber"))
                if field:
                    if field in found:
                        raise ValueError("Duplicate 10 m wind or gust field")
                    found[field] = message
        finally:
            ec.codes_release(h)
    if not {"u", "v"} <= set(found):
        raise ValueError("Control file is missing 10 m U/V wind")
    if not set(GUST_FIELDS) <= set(found):
        # One component alone cannot give a speed; keep the explicit no-gust path.
        found = {f: m for f, m in found.items() if f not in GUST_FIELDS}
    return b"".join(found[field] for field in PARAMETERS if field in found)


def has_gust(path):
    """True when both time-maximum gust components were cached for this step."""
    numbers = set()
    for message in messages(path.read_bytes()):
        h = ec.codes_new_from_message(message)
        try:
            numbers.add(ec.codes_get(h, "parameterNumber"))
        finally:
            ec.codes_release(h)
    return {PARAMETERS[f] for f in GUST_FIELDS} <= numbers


def download(name):
    path = ROOT / ".cache" / "harmonie" / (name + ".windgust.grib2")
    if not path.exists():
        url = f"{PORTAL}/data-portal/near-realtime/download/nwp?{urlencode({'files': name})}"
        with zipfile.ZipFile(io.BytesIO(get(url))) as archive:
            if archive.namelist() != [name] or archive.getinfo(name).file_size > 100_000_000:
                raise ValueError("Unexpected forecast ZIP contents")
            data = extract(archive.read(name))  # ZIP CRC and complete GRIB messages checked.
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".download")
        temporary.write_bytes(data)
        os.replace(temporary, path)
    return path


def gust_window(hour):
    """The source's 1-hour maximum window. Initialization has no preceding hour."""
    return [max(hour - 1, 0), hour]


def validate(h, field, run, hour):
    ec.codes_set(h, "stepUnits", 1)
    gust = field in GUST_FIELDS
    start = gust_window(hour)[0] if gust else hour
    expected = {"discipline": 0, "parameterCategory": 2, "parameterNumber": PARAMETERS[field],
                "typeOfLevel": "heightAboveGround", "level": 10, "gridType": "lambert",
                "uvRelativeToGrid": 1, "shapeOfTheEarth": 6, "centre": "eidb",
                "typeOfProcessedData": "cf", "perturbationNumber": 0,
                "stepType": "max" if gust else "instant",
                "startStep": start, "endStep": hour, "iScansNegatively": 0, "jScansPositively": 1,
                "jPointsAreConsecutive": 0, "alternativeRowScanning": 0,
                "DxInMetres": 2000, "DyInMetres": 2000}
    if gust:
        # Read the maximum's window from the statistical keys, never from the parameter alone.
        expected.update({"typeOfStatisticalProcessing": 2, "indicatorOfUnitForTimeRange": 1,
                         "lengthOfTimeRange": hour - start})
    for key, value in expected.items():
        if ec.codes_get(h, key) != value:
            raise ValueError(f"Unsupported HARMONIE {key}: expected {value}")
    if ec.codes_get(h, "units") not in ("m s**-1", "m s-1") or ec.codes_get(h, "numberOfMissing") != 0:
        raise ValueError("Missing wind values or incorrect units")
    if f'{ec.codes_get(h, "dataDate")}{ec.codes_get(h, "dataTime"):04d}' != run + "00":
        raise ValueError("Mixed HARMONIE model runs")
    valid = datetime.strptime(run, "%Y%m%d%H") + timedelta(hours=hour)
    if f'{ec.codes_get(h, "validityDate")}{ec.codes_get(h, "validityTime"):04d}' != valid.strftime("%Y%m%d%H%M"):
        raise ValueError("Incorrect HARMONIE valid time")


def earth_vectors(u, v, convergence):
    angle = np.radians(convergence)
    return u * np.cos(angle) + v * np.sin(angle), -u * np.sin(angle) + v * np.cos(angle)


def make_layout(h):
    nx, ny = ec.codes_get(h, "Nx"), ec.codes_get(h, "Ny")
    projection = Proj(proj="lcc", lat_1=ec.codes_get(h, "Latin1InDegrees"),
                      lat_2=ec.codes_get(h, "Latin2InDegrees"), lat_0=ec.codes_get(h, "LaDInDegrees"),
                      lon_0=ec.codes_get(h, "LoVInDegrees"), R=ec.codes_get(h, "radius"))
    lat = ec.codes_get_array(h, "latitudes")
    lon = (ec.codes_get_array(h, "longitudes") + 180) % 360 - 180
    x, y = projection(lon, lat)
    dx, dy = ec.codes_get(h, "DxInMetres"), ec.codes_get(h, "DyInMetres")
    # Independently check ecCodes geographic locations against the projected scanning grid.
    if not (np.allclose(x, x[0] + np.tile(np.arange(nx), ny) * dx, atol=0.2, rtol=0)
            and np.allclose(y, y[0] + np.repeat(np.arange(ny), nx) * dy, atol=0.2, rtol=0)):
        raise ValueError("Lambert geometry/scanning validation failed")
    longitude, latitude = np.meshgrid(GRID["west"] + np.arange(GRID["width"]) * GRID["dx"],
                                      GRID["north"] - np.arange(GRID["height"]) * GRID["dy"])
    target_x, target_y = projection(longitude.ravel(), latitude.ravel())
    gx, gy = (target_x - x[0]) / dx, (target_y - y[0]) / dy
    if np.any((gx < 0) | (gx > nx-1) | (gy < 0) | (gy > ny-1)):
        raise ValueError("Target crop exceeds native model domain")
    ix, iy = np.minimum(np.floor(gx).astype(int), nx-2), np.minimum(np.floor(gy).astype(int), ny-2)
    return {"signature": tuple(ec.codes_get(h, k) for k in GEOMETRY), "nx": nx,
            "indices": iy * nx + ix, "tx": gx - ix, "ty": gy - iy,
            "convergence": projection.get_factors(lon, lat).meridian_convergence}


def resample(values, layout):
    i, nx, tx, ty = (layout[k] for k in ["indices", "nx", "tx", "ty"])
    return (values[i] * (1-tx) + values[i+1] * tx) * (1-ty) + (values[i+nx] * (1-tx) + values[i+nx+1] * tx) * ty


def decode(path, run, hour, layout=None, gusts=True):
    # Initialization's gust window is zero length, so its components are checked
    # when present but never required; every later step must supply both.
    wanted = set(PARAMETERS) if gusts else {"u", "v"}
    required = wanted if gusts and hour > 0 else {"u", "v"}
    fields = {}
    for message in messages(path.read_bytes()):
        h = ec.codes_new_from_message(message)
        try:
            field = FIELDS.get(ec.codes_get(h, "parameterNumber"))
            if field is None or field in fields:
                raise ValueError("Unexpected or duplicate cached HARMONIE field")
            if field not in wanted:
                continue
            validate(h, field, run, hour)
            if layout is None:
                layout = make_layout(h)
            if tuple(ec.codes_get(h, k) for k in GEOMETRY) != layout["signature"]:
                raise ValueError("Mixed forecast grids")
            values = ec.codes_get_values(h)
            if not np.all(np.isfinite(values)) or np.any(np.abs(values) > MAX_SPEED):
                raise ValueError("Implausible or missing wind values")
            fields[field] = values
        finally:
            ec.codes_release(h)
    if not required <= set(fields) <= wanted:
        raise ValueError("Incomplete cached wind or gust fields")
    east, north = earth_vectors(fields["u"], fields["v"], layout["convergence"])
    frame = {"u": np.round(resample(east, layout), 2).tolist(),
             "v": np.round(resample(north, layout), 2).tolist(),
             "gust": None, "gustIntervalHours": None}
    # Initialization's window is [0,0]: a zero-length maximum, so no gust is claimed.
    if gusts and hour > 0:
        # The gust components are grid-relative like U/V, but a magnitude is
        # rotation invariant, so combining before rotation is exact and rotation
        # of the gust pair is unnecessary. The scalar is then resampled like wind.
        speed = resample(np.hypot(fields["gustEast"], fields["gustNorth"]), layout)
        if not np.all(np.isfinite(speed)) or np.any(speed < 0) or np.any(speed > MAX_SPEED):
            raise ValueError("Implausible or missing HARMONIE gust values")
        frame["gust"] = np.round(speed, 2).tolist()
        frame["gustIntervalHours"] = gust_window(hour)
    return frame, layout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, default=60)
    parser.add_argument("--step", type=int, choices=[1, 3], default=3)
    parser.add_argument("--run", help="Optional available YYYYMMDDHH control run")
    args = parser.parse_args()
    if not 3 <= args.hours <= 60 or args.hours % args.step:
        parser.error("Use 3–60 hours, divisible by step")
    hours = list(range(0, args.hours+1, args.step))
    run, names = discover(inventory(), hours, args.run)
    print(f"HARMONIE-AROME control {run}: downloading {len(hours)} Ireland subsets", flush=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        paths = dict(zip(hours, pool.map(download, [names[h] for h in hours])))
    # Gusts are published only when every forecast step after initialization has
    # both components; otherwise the run stays explicitly wind-only.
    absent = [h for h in hours if h > 0 and not has_gust(paths[h])]
    gusts = not absent
    if absent:
        print(f"  No gust components at +{absent[0]:03d}h; publishing wind only", flush=True)
    output = ROOT / "public" / "weather"
    run_time = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    prefix = f"harmonie-{run}-{args.hours}h-{'v2' if gusts else 'v1'}"
    spots = json.loads(SPOTS_FILE.read_text())
    series = {s["id"]: [] for s in spots}
    frames, sources, layout = [], [], None
    for hour in hours:
        fields, layout = decode(paths[hour], run, hour, layout, gusts)
        interval = fields["gustIntervalHours"]
        valid = (run_time + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
        payload = {"model": MODEL, "run": run, "hour": hour, "validTime": valid, "grid": GRID, **fields}
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:12]
        name = f"{prefix}/{hour:03d}-{digest}.json"
        write_json(output / name, payload)
        frames.append({"hour": hour, "validTime": valid, "url": f"weather/{name}", "gustIntervalHours": interval})
        sources.append({"file": names[hour], "gribSha256": hashlib.sha256(paths[hour].read_bytes()).hexdigest()})
        for spot in spots:
            point = {f: sample(GRID, fields[f], spot["lon"], spot["lat"]) for f in ["u", "v"]}
            if any(v is None for v in point.values()):
                raise ValueError("Named spot outside HARMONIE crop")
            gust = (sample(GRID, fields["gust"], spot["lon"], spot["lat"])
                    if fields["gust"] is not None else None)
            if fields["gust"] is not None and gust is None:
                raise ValueError("Named spot outside HARMONIE crop")
            series[spot["id"]].append({"hour": hour, "validTime": valid, **point, "gust": gust})
        print(f"  +{hour:03d}h validated, rotated and regridded"
              f"{f'; gust maximum over [{interval[0]},{interval[1]}]h' if interval else ''}", flush=True)
    manifest = {"schemaVersion": 1, "model": MODEL, "modelName": "HARMONIE", "provider": "Met Éireann",
                "modelDetail": "HARMONIE-AROME DINI control (member 0)", "resolutionKm": 2,
                "run": run, "runTime": run_time.isoformat().replace("+00:00", "Z"),
                "generatedAt": datetime.now(timezone.utc).isoformat(), "stepHours": args.step,
                "grid": GRID, "frames": frames, "spotForecasts": series,
                "gustAvailable": gusts,
                **({"gustMissingHours": [0]} if gusts else {}),
                "gustDescription": ("Maximum 10 m gust over the one hour ending at each forecast time, taken from the "
                                    "control's own time-maximum gust components (GRIB2 parameters 23/24) as their "
                                    "magnitude. This reproduces Met Éireann's scalar gust field (parameter 22, published "
                                    "for the full DINI domain) to within GRIB packing precision. Initialization (+0h) has "
                                    "no preceding hour and is shown as unavailable, not zero."
                                    if gusts else
                                    "Gust speed is unavailable for this run: the source did not supply gust components for "
                                    "every forecast step. No substitute gusts are shown."),
                "processing": ("Native 2 km Lambert grid; grid-relative U/V rotated to true east/north at native points, "
                               "then bilinearly resampled to 0.025° × 0.02° for display. Gust speed is combined from its "
                               "grid-relative components at native points — a magnitude is rotation invariant — and "
                               "resampled the same way. Ireland-only crop; no extrapolation."),
                "sourceFiles": sources, "sourceUrl": PORTAL + "/nwp/near-realtime",
                "attribution": "Weather data: Met Éireann, HARMONIE-AROME DINI control, CC BY 4.0; rotated, resampled and cropped by Force5 / wingfoil.ie.",
                "licenseUrl": "https://creativecommons.org/licenses/by/4.0/"}
    write_json(output / "harmonie.json", manifest)
    print(f"Published {len(frames)} HARMONIE frames; ICON-EU snapshot unchanged.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"HARMONIE refresh failed: {error}. Last published snapshot preserved.", file=sys.stderr)
        sys.exit(1)
