"""Publish Met Éireann HARMONIE-AROME DINI control wind for Ireland.

Uses the public near-real-time portal, not its authenticated archive. Only a
complete requested run is published. No synthetic gusts or model substitution.
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

from fetch_forecast import ROOT, get, sample, write_json

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
    """Cache only 10 m U/V; other levels and gust components are not scalar gusts."""
    found = {}
    for message in messages(data):
        h = ec.codes_new_from_message(message)
        try:
            if (ec.codes_get(h, "discipline") == 0 and ec.codes_get(h, "parameterCategory") == 2
                    and ec.codes_get(h, "typeOfLevel") == "heightAboveGround" and ec.codes_get(h, "level") == 10):
                field = {2: "u", 3: "v"}.get(ec.codes_get(h, "parameterNumber"))
                if field:
                    if field in found:
                        raise ValueError("Duplicate 10 m wind field")
                    found[field] = message
        finally:
            ec.codes_release(h)
    if set(found) != {"u", "v"}:
        raise ValueError("Control file is missing 10 m U/V wind")
    return found["u"] + found["v"]


def download(name):
    path = ROOT / ".cache" / "harmonie" / (name + ".wind.grib2")
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


def validate(h, field, run, hour):
    ec.codes_set(h, "stepUnits", 1)
    expected = {"discipline": 0, "parameterCategory": 2, "parameterNumber": {"u": 2, "v": 3}[field],
                "typeOfLevel": "heightAboveGround", "level": 10, "gridType": "lambert",
                "uvRelativeToGrid": 1, "shapeOfTheEarth": 6, "centre": "eidb",
                "typeOfProcessedData": "cf", "perturbationNumber": 0, "stepType": "instant",
                "startStep": hour, "endStep": hour, "iScansNegatively": 0, "jScansPositively": 1,
                "jPointsAreConsecutive": 0, "alternativeRowScanning": 0,
                "DxInMetres": 2000, "DyInMetres": 2000}
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


def decode(path, run, hour, layout=None):
    fields = {}
    records = list(messages(path.read_bytes()))
    if len(records) != 2:
        raise ValueError("Cached wind file must contain exactly U and V")
    for field, message in zip(["u", "v"], records):
        h = ec.codes_new_from_message(message)
        try:
            validate(h, field, run, hour)
            if layout is None:
                layout = make_layout(h)
            if tuple(ec.codes_get(h, k) for k in GEOMETRY) != layout["signature"]:
                raise ValueError("Mixed forecast grids")
            values = ec.codes_get_values(h)
            if not np.all(np.isfinite(values)) or np.any(np.abs(values) > 150):
                raise ValueError("Implausible or missing wind values")
            fields[field] = values
        finally:
            ec.codes_release(h)
    if set(fields) != {"u", "v"}:
        raise ValueError("Incomplete cached wind fields")
    east, north = earth_vectors(fields["u"], fields["v"], layout["convergence"])
    return {"u": np.round(resample(east, layout), 2).tolist(),
            "v": np.round(resample(north, layout), 2).tolist(), "gust": None}, layout


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
    output = ROOT / "public" / "weather"
    run_time = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    prefix = f"harmonie-{run}-{args.hours}h-v1"
    spots = json.loads((ROOT / "public" / "spots.json").read_text())
    series = {s["id"]: [] for s in spots}
    frames, sources, layout = [], [], None
    for hour in hours:
        fields, layout = decode(paths[hour], run, hour, layout)
        valid = (run_time + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
        payload = {"model": MODEL, "run": run, "hour": hour, "validTime": valid, "grid": GRID,
                   "gustIntervalHours": None, **fields}
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:12]
        name = f"{prefix}/{hour:03d}-{digest}.json"
        write_json(output / name, payload)
        frames.append({"hour": hour, "validTime": valid, "url": f"weather/{name}", "gustIntervalHours": None})
        sources.append({"file": names[hour], "windGribSha256": hashlib.sha256(paths[hour].read_bytes()).hexdigest()})
        for spot in spots:
            point = {f: sample(GRID, fields[f], spot["lon"], spot["lat"]) for f in ["u", "v"]}
            if any(v is None for v in point.values()):
                raise ValueError("Named spot outside HARMONIE crop")
            series[spot["id"]].append({"hour": hour, "validTime": valid, **point, "gust": None})
        print(f"  +{hour:03d}h validated, rotated and regridded", flush=True)
    manifest = {"schemaVersion": 1, "model": MODEL, "modelName": "HARMONIE", "provider": "Met Éireann",
                "modelDetail": "HARMONIE-AROME DINI control (member 0)", "resolutionKm": 2,
                "run": run, "runTime": run_time.isoformat().replace("+00:00", "Z"),
                "generatedAt": datetime.now(timezone.utc).isoformat(), "stepHours": args.step,
                "grid": GRID, "frames": frames, "spotForecasts": series, "gustAvailable": False,
                "gustDescription": "Gust speed is unavailable in this integration: the source supplies gust components, whose combination has not been validated. No substitute gusts are shown.",
                "processing": "Native 2 km Lambert grid; grid-relative U/V rotated to true east/north at native points, then bilinearly resampled to 0.025° × 0.02° for display. Ireland-only crop; no extrapolation.",
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
