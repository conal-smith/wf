"""ECMWF IFS wave open data: an Ireland wave bundle on the same box as the wind.

The `wave` stream of ECMWF's open data is the IFS-coupled WAM ocean wave model,
published at 0.25° with no API key, at the 00 and 12 UTC cycles on exactly the
ladder the wind control uses: 3-hourly to +144h, then 6-hourly to +360h. The
client handles `stream="wave"` with no special casing — verified against the live
index on 17 September 2026 — so the whole adapter is the wind importer's crop and
frame contract plus a land mask.

Ten variables are published. `swh`/`mwd`/`mwp`/`pp1d` describe the whole sea.
The six band heights `h1012`…`h2530` are the significant wave height carried by
waves in a period band (10–12 s, 12–14 s, 14–17 s, 17–21 s, 21–25 s, 25–30 s).
**They are the only swell information in this stream:** the open-data wave
inventory has no swell partition at all, so a long-period band height is the
nearest thing to "how much groundswell is arriving, and how long". They are not
a partition: bands overlap nothing and sum in energy, not in metres, they say
nothing about direction, and nothing below 10 s is published, so a short wind sea
is invisible in them. They roughly double a run's download; `--no-bands` skips
them.

Unlike the wind fields, a wave field is undefined over land: the grid carries a
bitmap and the cells the model did not solve arrive as its missing value. Those
are published as `null`, never zero, and a riding location whose own cell is dry
is read from the nearest cell the model did solve, with the offset recorded.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
import sys

import eccodes as ec
import numpy as np

from cadence import ECMWF_HOURS, ecmwf_ladder
from fetch_ecmwf import SOURCE_URL, client
from fetch_forecast import ROOT, decode_handle, load_spots, published_in_bucket, spots_file, write_json
from registry import UNCHANGED_EXIT
import timing

MODEL = "ecmwf-wave"
# Two cycles a day, published roughly eight hours after run time; a run is at most
# a day old when its successor is due, like the wind control.
MAX_AGE_HOURS = 24
# How far a location may reach for the nearest cell the model solved. Beyond this
# the answer would describe a different piece of coast, so nothing is published.
NEAREST_LIMIT_KM = 40.0
EARTH_RADIUS_KM = 6371.0088

HEIGHT, PERIOD, DIRECTION = "height", "period", "direction"
LIMITS = {HEIGHT: (0.0, 30.0), PERIOD: (0.0, 30.0), DIRECTION: (0.0, 360.0)}
# Identity is the paramId: the six band heights share discipline 10, category 0 and
# parameter number 3 with `swh` and differ only in the local parameter number, so a
# category/number check alone cannot tell a 25–30 s band height from the total sea.
SEA = {
    "swh": {"id": 140229, "number": 3, "level": "surface", "kind": HEIGHT, "units": "m",
            "label": "Wave height",
            "description": "Significant height of combined wind waves and swell (swh)"},
    "mwd": {"id": 140230, "number": 14, "level": "surface", "kind": DIRECTION,
            "units": "degrees true", "label": "Mean wave direction",
            "description": "Mean direction the whole sea comes FROM (mwd)"},
    "pp1d": {"id": 140231, "number": 34, "level": "surface", "kind": PERIOD, "units": "s",
             "label": "Peak period",
             "description": "Period of the most energetic waves in the spectrum (pp1d)"},
    "mwp": {"id": 140232, "number": 15, "level": "surface", "kind": PERIOD, "units": "s",
            "label": "Mean wave period",
            "description": "Mean period of the whole sea, energy-weighted (mwp)"},
}
BAND_SECONDS = [(10, 12), (12, 14), (14, 17), (17, 21), (21, 25), (25, 30)]
BANDS = {
    f"h{low:02d}{high:02d}": {
        "id": 140114 + index, "number": 3, "level": "meanSea", "kind": HEIGHT, "units": "m",
        "label": f"{low}–{high} s wave height",
        "description": f"Significant wave height carried by waves of {low}–{high} s period "
                       f"(h{low:02d}{high:02d}). A band height, not a swell partition: it "
                       "has no direction and adds to the other bands in energy, not metres.",
    }
    for index, (low, high) in enumerate(BAND_SECONDS)
}
ALL_VARIABLES = {**SEA, **BANDS}
BY_ID = {entry["id"]: name for name, entry in ALL_VARIABLES.items()}
# What the live 0.25° wave headers say, read on 17 September 2026.
IDENTITY = {"centre": "ecmf", "marsClass": "od", "marsStream": "wave", "dataType": "fc"}
PUBLISHED = ("units", "label", "description")  # What each variable declares downstream.
DIRECTION_CONVENTION = (
    "Wave directions are the bearing waves travel FROM, in degrees true, like the wind "
    "direction rows: 270° is a westerly swell running east.")
BAND_NOTE = (
    "swh/mwd/mwp/pp1d describe the whole sea. h1012…h2530 are the significant wave height "
    "carried by waves in one period band, and they are the only swell information ECMWF's "
    "open-data wave stream publishes: it has no swell partition. A band height is not a "
    "partition — the bands add in energy rather than in metres, they carry no direction, "
    "and no band below 10 s exists, so a short local wind sea does not appear in them. Read "
    "a large h1417 or h1721 as long groundswell arriving, not as a measured swell height.")


def haversine_km(lon1, lat1, lon2, lat2):
    """Great-circle distance, on arrays or scalars."""
    phi1, phi2 = np.radians(lat1), np.radians(lat2)
    a = (np.sin((phi2 - phi1) / 2) ** 2
         + np.cos(phi1) * np.cos(phi2) * np.sin(np.radians(np.asarray(lon2) - lon1) / 2) ** 2)
    return 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def validate_metadata(metadata, name, run, hour):
    """The wave contract: instantaneous scalar ocean fields at the stated level."""
    entry = ALL_VARIABLES[name]
    if metadata["gridType"] != "regular_ll":
        raise ValueError("Expected the regular latitude/longitude open-data grid")
    if metadata["parameterCategory"] != 0 or metadata["parameterNumber"] != entry["number"]:
        raise ValueError(f"Wrong GRIB parameter for {name}")
    units = {HEIGHT: ("m",), PERIOD: ("s",), DIRECTION: ("Degree true", "deg")}[entry["kind"]]
    if metadata["units"] not in units:
        raise ValueError(f"Unexpected units for {name}: {metadata['units']}")
    if metadata["typeOfLevel"] != entry["level"] or metadata["level"] != 0:
        raise ValueError(f"Unexpected level for {name}")
    if metadata["stepType"] != "instant":
        raise ValueError("Expected instantaneous wave fields")
    if metadata["stepUnits"] != 1 or metadata["startStep"] != hour or metadata["endStep"] != hour:
        raise ValueError("Forecast lead time mismatch")
    if f'{metadata["dataDate"]}{metadata["dataTime"]:04d}' != run + "00":
        raise ValueError("Mixed forecast runs")
    valid = datetime.strptime(run, "%Y%m%d%H") + timedelta(hours=hour)
    if f'{metadata["validityDate"]}{metadata["validityTime"]:04d}' != valid.strftime("%Y%m%d%H%M"):
        raise ValueError("Valid time mismatch")


def crop_values(name, values, missing):
    """One cropped wave field: published values, and the mask of cells with water.

    A cell the model did not solve — land, or an enclosed sea the 0.25° grid does
    not resolve — arrives as the file's own missing value under its bitmap. It is
    published as `null`, never as zero: a zero reads as a measured flat calm.
    Directions are normalised onto [0, 360) before rounding, because the source
    writes values a shade over 360 and a bare range check would fail on them.
    """
    entry = ALL_VARIABLES[name]
    wet = np.isfinite(values) & (values != missing)
    water = values[wet]
    if water.size == 0:
        raise ValueError(f"No water at all in the cropped {name} field")
    low, high = LIMITS[entry["kind"]]
    if entry["kind"] == DIRECTION:
        published = np.round(water % 360, 1) % 360
    else:
        if np.any(water < low) or np.any(water > high):
            raise ValueError(f"Implausible {name} value")
        if entry["kind"] == PERIOD and np.any(water <= 0):
            raise ValueError(f"Non-positive {name} period")
        published = np.round(water, 2)
    output = [None] * values.size
    for index, value in zip(np.flatnonzero(wet), published):
        output[index] = float(value)
    return output, wet


@timing.timed("decode")
def decode(path, run, hour, variables, layout=None):
    """Validate and crop every message of one wave step."""
    fields, masks = {}, {}
    with path.open("rb") as stream:
        while True:
            handle = ec.codes_grib_new_from_file(stream)
            if handle is None:
                break
            try:
                name = BY_ID.get(ec.codes_get(handle, "paramId"))
                if name is None or name not in variables or name in fields:
                    raise ValueError("Unexpected or duplicate ECMWF wave message")
                if ec.codes_get(handle, "discipline") != 10:
                    raise ValueError(f"{name} is not an oceanographic parameter")
                for key, expected in IDENTITY.items():
                    found = ec.codes_get(handle, key)
                    if found != expected:
                        raise ValueError(f"Expected the ECMWF IFS wave forecast "
                                         f"({key}={expected}), not {key}={found!r}")
                if ec.codes_get(handle, "bitmapPresent") != 1:
                    raise ValueError(f"{name} carries no land bitmap; refusing to guess "
                                     "which cells are sea")
                missing = ec.codes_get(handle, "missingValue")
            except Exception:
                ec.codes_release(handle)
                raise
            (fields[name], masks[name]), layout, _ = decode_handle(
                handle, name, run, hour, layout, validate=validate_metadata,
                convert=lambda field, array: crop_values(field, array, missing))
    if set(fields) != set(variables):
        raise ValueError(f"Missing ECMWF wave parameter: "
                         f"{sorted(set(variables) - set(fields))}")
    if layout[2]["dx"] != 0.25 or layout[2]["dy"] != 0.25:
        raise ValueError("Expected the 0.25-degree open-data grid")
    # The shared crop labels its grid with the wind importer's units; a wave grid
    # carries metres, seconds and degrees, declared per variable instead.
    layout[2].pop("units", None)
    return fields, masks, layout


def spot_plans(grid, wet, spots):
    """How each riding location is read from the wave grid.

    `bilinear` when the four cells around it were all solved, which is the only
    way to get a value that belongs to the point. Otherwise the nearest cell the
    model did solve, if one lies within `NEAREST_LIMIT_KM`, used unchanged and
    with its offset recorded — that value describes the open sea off the coast,
    not the bay. Otherwise nothing: the model cannot speak here and every hour of
    the series is null, which is a statement, not a gap.
    """
    lons = grid["west"] + np.arange(grid["width"]) * grid["dx"]
    lats = grid["north"] - np.arange(grid["height"]) * grid["dy"]
    mesh_lon, mesh_lat = np.meshgrid(lons, lats)
    water = np.flatnonzero(wet)
    plans = {}
    for spot in spots:
        lon, lat = spot["lon"], spot["lat"]
        x, y = (lon - grid["west"]) / grid["dx"], (grid["north"] - lat) / grid["dy"]
        plan = {"mode": "none", "offsetKm": None}
        if 0 <= x <= grid["width"] - 1 and 0 <= y <= grid["height"] - 1:
            x0 = min(math.floor(x), grid["width"] - 2)
            y0 = min(math.floor(y), grid["height"] - 2)
            tx, ty = x - x0, y - y0
            index = y0 * grid["width"] + x0
            corners = (index, index + 1, index + grid["width"], index + grid["width"] + 1)
            if all(wet[corner] for corner in corners):
                plan = {"mode": "bilinear", "corners": corners, "offsetKm": 0.0,
                        "weights": ((1 - tx) * (1 - ty), tx * (1 - ty),
                                    (1 - tx) * ty, tx * ty)}
        if plan["mode"] == "none" and water.size:
            distance = haversine_km(lon, lat, mesh_lon.ravel()[water], mesh_lat.ravel()[water])
            nearest = int(np.argmin(distance))
            if distance[nearest] <= NEAREST_LIMIT_KM:
                plan = {"mode": "nearest", "cell": int(water[nearest]),
                        "offsetKm": round(float(distance[nearest]), 1)}
        plans[spot["id"]] = plan
    return plans


def read_spot(plan, values, wet, kind):
    """One variable at one hour for one location, or null. Nothing is invented.

    The mask is read per hour and per variable, not once: `pp1d` has a few more
    unsolved cells than `swh`, and sea ice moves. A bilinear read whose stencil
    has lost a cell since the plan was made falls to null rather than quietly
    renormalising onto whatever is left.
    """
    if plan["mode"] == "nearest":
        cell = plan["cell"]
        return values[cell] if wet[cell] else None
    if plan["mode"] != "bilinear":
        return None
    corners, weights = plan["corners"], plan["weights"]
    if not all(wet[corner] for corner in corners):
        return None
    if kind == DIRECTION:
        # Bearings are averaged as unit vectors: the mean of 350° and 10° is 0°,
        # not 180°, and a plain bilinear across the 0°/360° seam invents a swell
        # from the opposite direction.
        radians = [math.radians(values[corner]) for corner in corners]
        east = sum(w * math.sin(r) for w, r in zip(weights, radians))
        north = sum(w * math.cos(r) for w, r in zip(weights, radians))
        return round(math.degrees(math.atan2(east, north)) % 360, 1) % 360
    return round(sum(w * values[corner] for w, corner in zip(weights, corners)), 2)


def coverage_for(plan, resolved):
    """The manifest's own words on why a location reads the way it does."""
    if plan["mode"] == "bilinear":
        note = ("This location sits in resolved 0.25° water; values are interpolated from "
                "the four surrounding cells of the wave grid.")
    elif plan["mode"] == "nearest":
        note = (f"The 0.25° wave grid has no solved water at this location, so the values "
                f"are taken unchanged from the nearest cell the model did solve, "
                f"{plan['offsetKm']:.1f} km away. They describe the open sea off this "
                "coast, not the beach itself.")
    else:
        note = (f"No cell this wave model solved lies within {NEAREST_LIMIT_KM:g} km of "
                "this location. It cannot say anything about waves here.")
    # `landMasked` is the UI's question — can the model be read at this point at
    # all — so a stencil with one dry corner counts, not only a dry centre cell.
    return {"landMasked": plan["mode"] != "bilinear", "resolved": bool(resolved),
            "nearestOffsetKm": plan["offsetKm"], "note": note}


def run_datetime(run):
    if len(run) != 10:
        raise ValueError("A run is YYYYMMDDHH")
    value = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    if value.hour not in (0, 12):
        raise ValueError("The full-length wave product runs at 00 and 12 UTC")
    return value


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", help="Optional YYYYMMDDHH, cycle 00 or 12")
    # The AWS mirror has been answering 503 SlowDown; data.ecmwf.int is the default.
    parser.add_argument("--source", choices=["ecmwf", "aws", "google"], default="ecmwf",
                        help="Official ECMWF public mirror (default: ECMWF's own)")
    parser.add_argument("--hours", type=int, default=ECMWF_HOURS[-1],
                        help="Horizon; must end on a step of the IFS ladder "
                             "(3-hourly to +144h, then 6-hourly to +360h)")
    parser.add_argument("--no-bands", dest="bands", action="store_false",
                        help="Skip the six period-band heights, halving the download")
    parser.add_argument("--workers", type=int, default=3, help="Concurrent ranged downloads")
    args = parser.parse_args(argv)
    if args.hours not in ECMWF_HOURS[1:]:
        parser.error("The horizon must be one of the source's own steps: 3-hourly to "
                     "+144h, then 6-hourly to +360h")
    if not 1 <= args.workers <= 4:
        parser.error("Use 1–4 concurrent downloads; the mirrors throttle harder above that")
    return args


def cadence_for(hours):
    """The ladder prefix this run publishes, in the manifest's own vocabulary."""
    last = hours[-1]
    if last > 144:
        return [{"throughHour": 144, "stepHours": 3}, {"throughHour": last, "stepHours": 6}]
    return [{"throughHour": last, "stepHours": 3}]


def manifest_for(run, run_time, hours, variables, grid, frames, series, coverage):
    ranges = cadence_for(hours)
    if ecmwf_ladder(ranges) != tuple(hours):
        raise ValueError("Published hours are not the ladder the manifest declares")
    return {
        "schemaVersion": 1, "kind": "wave", "model": MODEL, "modelName": "ECMWF Wave",
        "provider": "ECMWF", "modelDetail": "IFS-coupled WAM ocean wave forecast",
        "resolutionKm": None, "resolutionLabel": "0.25° open-data grid", "run": run,
        "runTime": run_time.isoformat().replace("+00:00", "Z"),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "stepHours": ranges[0]["stepHours"], "stepRanges": ranges, "grid": grid,
        "variables": {name: {key: ALL_VARIABLES[name][key] for key in PUBLISHED}
                      for name in variables},
        "frames": frames, "spotSeries": series, "spotCoverage": coverage,
        "directionConvention": DIRECTION_CONVENTION, "partitionNote": BAND_NOTE,
        "processing": (
            "ECMWF's open-data wave stream (the WAM model coupled to IFS), cropped from the "
            "public 0.25° regular grid to exactly the box the ECMWF wind product uses, "
            f"{grid['width']} × {grid['height']} cells, rows north-to-south. Nothing is "
            "resampled or downscaled: every published cell is a source cell. Source steps "
            f"are 3-hourly to +144h then 6-hourly to +{hours[-1]}h, and no hour between "
            "them is interpolated — a sea state belongs to the spectrum the model solved at "
            "that hour. A cell the model did not solve is null, never zero. A riding "
            "location is read bilinearly when all four cells around it were solved, and "
            "otherwise from the nearest solved cell within "
            f"{NEAREST_LIMIT_KM:g} km, unchanged and with the offset recorded in "
            "spotCoverage; directions are interpolated as unit vectors, never as degrees. "
            "At 0.25° a bay is several cells wide at best: this model has no refraction "
            "round a headland, no breaking waves and no idea that a beach is sheltered."),
        "sourceUrl": SOURCE_URL,
        "attribution": f"© {run_time.year} European Centre for Medium-Range Weather "
        "Forecasts (ECMWF). This service is based on data and products of the European "
        "Centre for Medium-Range Weather Forecasts (ECMWF). Data cropped and processed by "
        "Force5 under CC BY 4.0. ECMWF provides no warranty and accepts no liability for "
        "errors, availability or consequences of use; it does not endorse Force5.",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "termsUrl": "https://apps.ecmwf.int/datasets/licences/general/",
    }


def main(argv=None):
    args = parse_args(argv)
    hours = [hour for hour in ECMWF_HOURS if hour <= args.hours]
    variables = list(SEA) + (list(BANDS) if args.bands else [])

    def wave():
        """A fresh client per call: its session is not shared between threads."""
        return client(args.source)

    timing.start("discover")
    # Probing the requested last step avoids selecting the shorter 06/18 products
    # and a cycle that is still publishing. Every step is still validated below.
    run = args.run or wave().latest(step=args.hours, stream="wave",
                                    type="fc").strftime("%Y%m%d%H")
    run_time = run_datetime(run)
    age = (datetime.now(timezone.utc) - run_time).total_seconds() / 3600
    if not -1 <= age <= MAX_AGE_HOURS:
        raise ValueError(f"Refusing a stale/future ECMWF wave run "
                         f"(maximum age {MAX_AGE_HOURS} hours)")
    if published_in_bucket(run, args.run):
        print(f"ECMWF IFS wave {run} is already published; nothing to download.", flush=True)
        return UNCHANGED_EXIT
    print(f"Fetching ECMWF IFS wave {run} from {args.source}: {len(hours)} frames through "
          f"+{args.hours}h, {len(variables)} variables"
          f"{'' if args.bands else ' (no period bands)'}", flush=True)
    cache = ROOT / ".cache" / MODEL / run
    cache.mkdir(parents=True, exist_ok=True)
    spots = load_spots()
    print(f"Sampling {len(spots)} spots from {spots_file()}", flush=True)

    def download(hour):
        path = cache / f"{hour:03d}-{len(variables)}v.grib2"
        # Validate cached data too: a truncated cache entry must never publish.
        if path.exists():
            try:
                return hour, decode(path, run, hour, variables)
            except Exception:
                print(f"Re-fetching invalid cached frame +{hour:03d}h", flush=True)
        temporary = path.with_suffix(".download")
        wave().retrieve(date=run[:8], time=int(run[-2:]), step=hour, stream="wave",
                        type="fc", param=variables, target=str(temporary))
        decoded = decode(temporary, run, hour, variables)
        os.replace(temporary, path)
        print(f"  Validated +{hour:03d}h ({path.stat().st_size} bytes)", flush=True)
        return hour, decoded

    timing.start("download", workers=args.workers)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        decoded = dict(pool.map(download, hours))
    timing.start("decode")
    output = ROOT / "public" / "weather"
    prefix = f"{MODEL}-{run}-{args.hours}h-{len(variables)}v-v1"
    signature, grid = decoded[0][2][0], decoded[0][2][2]
    plans = spot_plans(grid, decoded[0][1]["swh"], spots)
    series = {spot["id"]: [] for spot in spots}
    frames = []
    for hour in hours:
        fields, masks, layout = decoded[hour]
        if layout[0] != signature or layout[2] != grid:
            raise ValueError("ECMWF wave grid changed within the run")
        valid = (run_time + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
        payload = {"model": MODEL, "run": run, "hour": hour, "validTime": valid,
                   "grid": grid, **fields}
        with timing.phase("write"):
            digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:12]
            name = f"{prefix}/{hour:03d}-{digest}.json"
            write_json(output / name, payload)
        frames.append({"hour": hour, "validTime": valid, "url": f"weather/{name}"})
        for spot in spots:
            plan = plans[spot["id"]]
            series[spot["id"]].append({"hour": hour, "validTime": valid, "values": {
                variable: read_spot(plan, fields[variable], masks[variable],
                                    ALL_VARIABLES[variable]["kind"])
                for variable in variables}})
    coverage = {spot["id"]: coverage_for(
        plans[spot["id"]], series[spot["id"]][0]["values"]["swh"] is not None)
        for spot in spots}
    manifest = manifest_for(run, run_time, hours, variables, grid, frames, series, coverage)
    # Only this final write advances the published snapshot.
    write_json(output / f"{MODEL}.json", manifest)
    modes = [plans[spot["id"]]["mode"] for spot in spots]
    transferred = sum(path.stat().st_size for path in cache.glob("*.grib2"))
    print(f"Published {len(frames)} ECMWF wave frames to {output / (MODEL + '.json')}; "
          f"{modes.count('bilinear')} of {len(spots)} spots read directly, "
          f"{modes.count('nearest')} from the nearest solved cell, "
          f"{modes.count('none')} with no wave data; "
          f"{transferred / 1e6:.1f} MB of source GRIB cached under {cache}", flush=True)


if __name__ == "__main__":
    try:
        # A run that is already published exits UNCHANGED_EXIT, which the worker
        # reads as "nothing new", not as a failure and not as a bundle to validate.
        sys.exit(main() or 0)
    except Exception as error:
        print(f"ECMWF wave refresh failed: {error}. Last published snapshot preserved.",
              file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
