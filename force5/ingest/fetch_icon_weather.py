"""Download DWD ICON-EU surface weather GRIB2 and publish an Ireland variables bundle.

No API key (DWD open data, CC BY 4.0). Thirteen single-level parameters are read
from the same four ICON-EU cycles as the wind importer, cropped to the same
Ireland/Atlantic 0.0625° grid, and published as a `kind: "weather"` bundle: a
declared `variables` map, one array per gridded variable in every frame, and a
precomputed series per riding location carrying every variable.

Units are converted and rounded once, here, so nothing downstream has to guess:
°C, mm, %, hPa, km, J/kg. `tp` is DWD's precipitation accumulated since
initialization and `precip` the amount in the interval ending at the frame,
differenced from it and null at hour 0. `ww` is a WMO present-weather code, not
a measurement: it is sampled nearest-neighbour and never interpolated or
averaged. `tg` is the model's ground/skin temperature, which over sea only
approximates SST; it is published as a labelled proxy, not as an SST product.
"""
import argparse
import bz2
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import sys

import eccodes as ec
import numpy as np

from fetch_forecast import (BASE, ROOT, decode_handle, get, listing, load_spots,
                            published_in_bucket, sample, spots_file, write_json)
from registry import UNCHANGED_EXIT

MODEL = "icon-eu-weather"
CYCLES = ("00", "06", "12", "18")
MAX_HOURS = 72       # ICON-EU publishes hourly steps to +78 h, three-hourly beyond.
MAX_AGE_HOURS = 12   # Four cycles a day, each published about 3.5 hours after its run.
KELVIN = -273.15     # Added to kelvin to get degrees Celsius.
CODE = "code"        # A code-table entry, never interpolated and never a measurement.

# Every published variable, in publication order. `directory` is the DWD open-data
# folder (and its upper-case name is the file suffix); `precip` alone is derived
# here. `category`/`number` are the GRIB2 parameter, `levels`/`level` its fixed
# surface — ecCodes names ICON's cloud layers and mean-layer CAPE inconsistently,
# so the accepted level names are listed per field while the numeric level, the
# parameter and the statistical processing stay exact. `range` is the plausible
# published range: a value outside it plus `slack` fails the run, and a value
# inside the slack is clipped, which is how DWD's 100.0006 % humidity becomes 100.
VARIABLES = {
    "t2m": {"directory": "t_2m", "category": 0, "number": 0, "level": 2,
            "levels": ("heightAboveGround",), "sourceUnits": ("K",), "stepType": "instant",
            "offset": KELVIN, "decimals": 1, "range": (-50.0, 60.0),
            "units": "°C", "label": "Air temperature",
            "description": "Air temperature 2 m above ground (DWD T_2M), converted from kelvin"},
    "td2m": {"directory": "td_2m", "category": 0, "number": 6, "level": 2,
             "levels": ("heightAboveGround",), "sourceUnits": ("K",), "stepType": "instant",
             "offset": KELVIN, "decimals": 1, "range": (-60.0, 45.0),
             "units": "°C", "label": "Dew point",
             "description": "Dew-point temperature 2 m above ground (DWD TD_2M), converted from kelvin"},
    "rh2m": {"directory": "relhum_2m", "category": 1, "number": 1, "level": 2,
             "levels": ("heightAboveGround",), "sourceUnits": ("%",), "stepType": "instant",
             "decimals": 0, "range": (0.0, 100.0), "slack": 1.0,
             "units": "%", "label": "Relative humidity",
             "description": "Relative humidity 2 m above ground (DWD RELHUM_2M), whole per cent"},
    "tp": {"directory": "tot_prec", "category": 1, "number": 52, "level": 0,
           "levels": ("surface",), "sourceUnits": ("kg m**-2", "kg m-2"), "stepType": "accum",
           "decimals": 1, "range": (0.0, 2000.0),
           "units": "mm", "label": "Precipitation since run",
           "description": "Total precipitation accumulated from initialization to this hour "
                          "(DWD TOT_PREC); 1 kg/m² is 1 mm"},
    "precip": {"directory": None, "decimals": 1, "range": (0.0, 500.0),
               "units": "mm", "label": "Precipitation",
               "description": "Precipitation in the interval ending at this hour, differenced from "
                              "the TOT_PREC accumulation; null at initialization, which has no interval"},
    "clct": {"directory": "clct", "category": 6, "number": 1, "level": 0,
             "levels": ("surface",), "sourceUnits": ("%",), "stepType": "instant",
             "decimals": 0, "range": (0.0, 100.0), "slack": 1.0,
             "units": "%", "label": "Total cloud",
             "description": "Total cloud cover through the whole column (DWD CLCT)"},
    "clcl": {"directory": "clcl", "category": 6, "number": 22, "level": 800,
             "levels": ("isobaricLayer", "unknown"), "sourceUnits": ("%",), "stepType": "instant",
             "decimals": 0, "range": (0.0, 100.0), "slack": 1.0,
             "units": "%", "label": "Low cloud",
             "description": "Cloud cover from the ground to 800 hPa (DWD CLCL)"},
    "clcm": {"directory": "clcm", "category": 6, "number": 22, "level": 400,
             "levels": ("isobaricLayer", "unknown"), "sourceUnits": ("%",), "stepType": "instant",
             "decimals": 0, "range": (0.0, 100.0), "slack": 1.0,
             "units": "%", "label": "Medium cloud",
             "description": "Cloud cover between 800 and 400 hPa (DWD CLCM)"},
    "clch": {"directory": "clch", "category": 6, "number": 22, "level": 0,
             "levels": ("isobaricLayer", "unknown"), "sourceUnits": ("%",), "stepType": "instant",
             "decimals": 0, "range": (0.0, 100.0), "slack": 1.0,
             "units": "%", "label": "High cloud",
             "description": "Cloud cover between 400 hPa and the model top (DWD CLCH)"},
    "pmsl": {"directory": "pmsl", "category": 3, "number": 1, "level": 0,
             "levels": ("meanSea",), "sourceUnits": ("Pa",), "stepType": "instant",
             "scale": 0.01, "decimals": 1, "range": (870.0, 1090.0),
             "units": "hPa", "label": "Pressure (MSL)",
             "description": "Pressure reduced to mean sea level (DWD PMSL), converted from pascals"},
    "vis": {"directory": "vis", "category": 19, "number": 0, "level": 0,
            "levels": ("surface",), "sourceUnits": ("m",), "stepType": "instant",
            "scale": 0.001, "decimals": 1, "range": (0.0, 150.0),
            "units": "km", "label": "Visibility",
            "description": "Near-surface horizontal visibility (DWD VIS), converted from metres"},
    "cape": {"directory": "cape_ml", "category": 7, "number": 6, "level": 0,
             "levels": ("unknown", "meanLayer", "surface"), "sourceUnits": ("J kg-1", "J kg**-1"),
             "stepType": "instant", "decimals": 0, "range": (0.0, 20000.0),
             "units": "J/kg", "label": "CAPE (mean layer)",
             "description": "Convective available potential energy of a mean-layer parcel (DWD CAPE_ML)"},
    "ww": {"directory": "ww", "category": 19, "number": 25, "level": 0,
           "levels": ("surface",), "sourceUnits": ("Numeric",), "stepType": "instant",
           "kind": CODE, "decimals": 0, "range": (0.0, 99.0),
           "units": "WMO code", "label": "Present weather",
           "description": "WMO present-weather interpretation code (DWD WW), a code-table entry: "
                          "0–3 clear to overcast, 45 fog, 51–57 drizzle, 61–67 rain, 71–77 snow, "
                          "80–82 showers, 85–86 snow showers, 95–99 thunderstorm. Never averaged"},
    "tg": {"directory": "t_g", "category": 0, "number": 0, "level": 0,
           "levels": ("surface",), "sourceUnits": ("K",), "stepType": "instant",
           "offset": KELVIN, "decimals": 1, "range": (-60.0, 60.0),
           "units": "°C", "label": "Surface temperature (SST proxy at sea)",
           "description": "Model ground/skin temperature (DWD T_G), converted from kelvin. Over sea "
                          "this is the model's own sea-surface temperature and only a proxy for a "
                          "measured SST; over land it is the skin temperature, not an air temperature"},
}
# What is downloaded, and the subset the frames carry by default. Thirteen arrays
# over 56,817 cells would be about 3 MB of JSON per frame, so the map fields are a
# declared subset and `spotSeries` carries every variable at every hour.
DIRECTORIES = {name: entry["directory"] for name, entry in VARIABLES.items() if entry["directory"]}
DERIVED = tuple(name for name, entry in VARIABLES.items() if not entry["directory"])
FRAME_DEFAULT = ("t2m", "precip", "clct", "pmsl", "ww")


def validate_metadata(metadata, field, run, hour):
    """ICON-EU contract for one single-level field: parameter, surface, step, run."""
    entry = VARIABLES[field]
    if metadata["parameterCategory"] != entry["category"] or metadata["parameterNumber"] != entry["number"]:
        raise ValueError(f"Wrong GRIB parameter for {field}")
    if metadata["units"] not in entry["sourceUnits"]:
        raise ValueError(f"Unexpected units for {field}: {metadata['units']}")
    if metadata["level"] != entry["level"] or metadata["typeOfLevel"] not in entry["levels"]:
        raise ValueError(f"Unexpected level for {field}")
    if metadata["gridType"] != "regular_ll":
        raise ValueError("Expected a regular latitude/longitude grid")
    if metadata["stepType"] != entry["stepType"]:
        raise ValueError(f"Unexpected statistical processing for {field}")
    # Accumulations run from initialization; everything else is read at the valid hour.
    start = 0 if entry["stepType"] == "accum" else hour
    if metadata["stepUnits"] != 1 or metadata["startStep"] != start or metadata["endStep"] != hour:
        raise ValueError("Forecast lead time mismatch")
    if f'{metadata["dataDate"]}{metadata["dataTime"]:04d}' != run + "00":
        raise ValueError("Mixed forecast runs")
    expected_valid = datetime.strptime(run, "%Y%m%d%H") + timedelta(hours=hour)
    if f'{metadata["validityDate"]}{metadata["validityTime"]:04d}' != expected_valid.strftime("%Y%m%d%H%M"):
        raise ValueError("Valid time mismatch")


def convert(field, values):
    """Source units to published units, range-checked once and rounded once."""
    entry = VARIABLES[field]
    low, high = entry["range"]
    if entry.get("kind") == CODE:
        # A code table has no interpolation and no tolerance: whole numbers only.
        if np.any(np.abs(values - np.rint(values)) > 1e-6) or np.any(values < low) or np.any(values > high):
            raise ValueError(f"Implausible {field} code in the ICON-EU crop")
        return [int(value) for value in np.rint(values)]
    values = (values + entry.get("offset", 0.0)) * entry.get("scale", 1.0)
    slack = entry.get("slack", 0.5)
    if np.any(values < low - slack) or np.any(values > high + slack):
        raise ValueError(f"Implausible {field} value in the ICON-EU crop")
    values = np.clip(values, low, high)
    if entry["decimals"] == 0:
        return [int(value) for value in np.rint(values)]
    return np.round(values, entry["decimals"]).tolist()


def decode(path, field, run, hour, layout=None):
    """One bz2 GRIB file: this provider's checks, this field's units, the shared crop."""
    handle = ec.codes_new_from_message(bz2.decompress(path.read_bytes()))
    try:
        # ICON's cloud, CAPE and present-weather parameters are only named by DWD's
        # own local tables, so the originating centre is part of their identity.
        if ec.codes_get(handle, "centre") != "edzw":
            raise ValueError("Expected a DWD (edzw) ICON-EU message")
    except Exception:
        ec.codes_release(handle)
        raise
    return decode_handle(handle, field, run, hour, layout, validate_metadata, convert)


def derive_precip(current, previous):
    """The interval amount: the accumulation's own increase, never a negative one.

    DWD's TOT_PREC is monotonic in principle; a tiny decrease can still appear
    where the packing of two steps disagrees, and that is clamped to zero rather
    than published as negative rain.
    """
    entry = VARIABLES["precip"]
    difference = np.asarray(current, dtype=float) - np.asarray(previous, dtype=float)
    return np.round(np.clip(difference, 0.0, entry["range"][1]), entry["decimals"]).tolist()


def sample_variable(grid, values, lon, lat, field):
    """Bilinear for measurements; the containing cell for a code table."""
    entry = VARIABLES[field]
    if entry.get("kind") == CODE:
        x = round((lon - grid["west"]) / grid["dx"])
        y = round((grid["north"] - lat) / grid["dy"])
        if not (0 <= x < grid["width"] and 0 <= y < grid["height"]):
            return None
        return int(values[y * grid["width"] + x])
    point = sample(grid, values, lon, lat)
    if point is None:
        return None
    return int(round(point)) if entry["decimals"] == 0 else round(point, entry["decimals"])


def discover(hours, requested_run=None):
    """Newest run whose four-cycle inventories hold every field at every hour."""
    inventories = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {pool.submit(listing, cycle, directory): (cycle, field)
                   for cycle in CYCLES for field, directory in DIRECTORIES.items()}
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
        if all((run, hour) in inventories.get((cycle, field), {})
               for hour in hours for field in DIRECTORIES):
            return run, {(hour, field): inventories[(cycle, field)][(run, hour)]
                         for hour in hours for field in DIRECTORIES}
        print(f"Skipping incomplete ICON-EU {run}", flush=True)
    raise RuntimeError("No complete requested run is available. "
                       "Existing forecast has not been changed.")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, default=72, help=f"3–{MAX_HOURS}, divisible by --step")
    parser.add_argument("--step", type=int, choices=[1, 3], default=3)
    parser.add_argument("--run", help="Optional specific YYYYMMDDHH run (00/06/12/18)")
    parser.add_argument("--frame-variables", default=",".join(FRAME_DEFAULT),
                        help="Gridded variables, comma separated, or 'all' for much larger frames. "
                             "The spot series always carries every variable.")
    args = parser.parse_args(argv)
    if not 3 <= args.hours <= MAX_HOURS or args.hours % args.step:
        parser.error(f"Use 3–{MAX_HOURS} hours divisible by the step")
    if args.run and (len(args.run) != 10 or not args.run.isdigit() or args.run[-2:] not in CYCLES):
        parser.error("A run is YYYYMMDDHH on a 00/06/12/18 cycle")
    names = list(VARIABLES) if args.frame_variables == "all" else args.frame_variables.split(",")
    if not names or len(set(names)) != len(names) or not set(names) <= set(VARIABLES):
        parser.error(f"Frame variables must be distinct names from: {', '.join(VARIABLES)}")
    args.frame_variables = names
    return args


def manifest_for(run, run_time, args, grid, frames, series):
    return {
        "schemaVersion": 1, "kind": "weather", "model": MODEL,
        "modelName": "ICON-EU surface weather", "provider": "DWD",
        "modelDetail": "ICON-EU single-level surface fields, 0.0625° regular latitude/longitude",
        "resolutionKm": 6.5, "resolutionLabel": "0.0625° (about 6.5 km)",
        "run": run, "runTime": run_time.isoformat().replace("+00:00", "Z"),
        "generatedAt": datetime.now(timezone.utc).isoformat(), "stepHours": args.step,
        "grid": grid,
        "variables": {name: {key: entry[key] for key in ("units", "label", "description")}
                              | ({"kind": CODE} if entry.get("kind") == CODE else {})
                      for name, entry in VARIABLES.items()},
        "frameVariables": list(args.frame_variables),
        "frames": frames, "spotSeries": series,
        "precipitationNote": (
            "tp is the model's own accumulation since initialization; precip is the amount in the "
            f"{args.step}-hour interval ending at each frame, obtained by differencing it, clamped at "
            "zero and null at initialization, which has no interval. Each frame and series step "
            "declares that interval in precipIntervalHours."),
        "seaTemperatureNote": (
            "tg is the model's ground/skin temperature. Over sea it is ICON's own sea-surface "
            "temperature field and a proxy for a measured SST, not an observation; over land it is "
            "the skin temperature of the ground, which on a sunny afternoon runs far above the air "
            "temperature in t2m."),
        "presentWeatherNote": (
            "ww is a WMO present-weather code, not a measurement: it is read from the cell "
            "containing a location and is never interpolated, averaged or blended between models."),
        "processing": (
            f"Thirteen ICON-EU single-level parameters ({', '.join(sorted(DIRECTORIES.values()))}) are "
            "read from one cycle, checked for parameter, surface, units, statistical processing, "
            "initialization and valid time, then cropped to 18°W–2°E / 48°–59°N on the source 0.0625° "
            "grid, rows north-to-south and columns west-to-east. Values are converted to the published "
            "units and rounded once (0.1 °C, whole per cent, 0.1 hPa, 0.1 km, 0.1 mm, whole J/kg) and "
            "clipped into their plausible range; a value outside it fails the run. precip is derived by "
            "differencing tot_prec. Only the declared frameVariables are gridded, because thirteen "
            "arrays per frame would be about 3 MB of JSON; spotSeries carries every variable at every "
            "published hour, bilinearly sampled except ww, which is read from the containing cell. "
            "No hour is interpolated: only native forecast steps are published."),
        "sourceUrl": BASE + "/",
        "attribution": "Weather data: Deutscher Wetterdienst (DWD) ICON-EU open data, licensed CC BY "
                       "4.0; converted, cropped and processed by Force5 (wingfoil.ie).",
        "licenseUrl": "https://www.dwd.de/EN/service/legal_notice/legal_notice_node.html",
    }


def main(argv=None):
    args = parse_args(argv)
    hours = list(range(0, args.hours + 1, args.step))
    run, urls = discover(hours, args.run)
    run_time = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    age = (datetime.now(timezone.utc) - run_time).total_seconds() / 3600
    if not -1 <= age <= MAX_AGE_HOURS:
        raise ValueError(f"Refusing a stale/future ICON-EU run (maximum age {MAX_AGE_HOURS} hours)")
    if published_in_bucket(run, args.run):
        print(f"ICON-EU surface weather {run} is already published; nothing to download.",
              flush=True)
        return UNCHANGED_EXIT
    print(f"Fetching ICON-EU surface weather {run}: {len(hours)} frames, "
          f"{len(urls)} files, frame variables {', '.join(args.frame_variables)}", flush=True)
    # The same cache root as the wind importer; the parameter names never collide.
    cache = ROOT / ".cache" / "grib" / run
    cache.mkdir(parents=True, exist_ok=True)
    downloaded = 0

    def download(item):
        nonlocal downloaded
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
            downloaded += len(data)
        return (hour, field), path

    with ThreadPoolExecutor(max_workers=4) as pool:
        paths = dict(pool.map(download, urls.items()))
    print(f"Downloads complete ({downloaded / 1e6:.1f} MB). Validating and cropping to Ireland…",
          flush=True)
    spots = load_spots()
    print(f"Sampling {len(spots)} spots from {spots_file()}", flush=True)
    output = ROOT / "public" / "weather"
    prefix = f"{MODEL}-{run}-{args.hours}h-v1"
    layout, grid, previous_tp = None, None, None
    frames, series, published = [], {spot["id"]: [] for spot in spots}, 0
    for hour in hours:
        fields = {}
        for field in DIRECTORIES:
            fields[field], layout, _ = decode(paths[(hour, field)], field, run, hour, layout)
        if grid is None:
            # The shared crop names one unit for a wind grid; a weather frame has many.
            grid = {key: value for key, value in layout[2].items() if key != "units"}
        interval = None if hour == 0 else [hour - args.step, hour]
        fields["precip"] = None if previous_tp is None else derive_precip(fields["tp"], previous_tp)
        previous_tp = fields["tp"]
        valid = (run_time + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
        cells = grid["width"] * grid["height"]
        payload = {"model": MODEL, "run": run, "hour": hour, "validTime": valid, "grid": grid,
                   "precipIntervalHours": interval,
                   # An hour with no interval publishes nulls, never a zeroed field.
                   **{name: fields[name] if fields[name] is not None else [None] * cells
                      for name in args.frame_variables}}
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:12]
        name = f"{prefix}/{hour:03d}-{digest}.json"
        write_json(output / name, payload)
        size = (output / name).stat().st_size
        published += size
        frames.append({"hour": hour, "validTime": valid, "url": f"weather/{name}",
                       "precipIntervalHours": interval})
        for spot in spots:
            series[spot["id"]].append({"hour": hour, "validTime": valid,
                                       "precipIntervalHours": interval,
                                       "values": {name: None if values is None else sample_variable(
                                           grid, values, spot["lon"], spot["lat"], name)
                                           for name, values in fields.items()}})
        print(f"  +{hour:03d}h — {grid['width']} × {grid['height']}, "
              f"{len(args.frame_variables)} arrays, {size / 1e6:.2f} MB", flush=True)
    manifest = manifest_for(run, run_time, args, grid, frames, series)
    # Only this final operation advances the published snapshot.
    write_json(output / f"{MODEL}.json", manifest)
    print(f"Published {len(frames)} ICON-EU weather frames ({published / 1e6:.1f} MB) and "
          f"{len(spots)} spot series to {output / (MODEL + '.json')}", flush=True)


if __name__ == "__main__":
    try:
        # A run that is already published exits UNCHANGED_EXIT, which the worker
        # reads as "nothing new", not as a failure and not as a bundle to validate.
        sys.exit(main() or 0)
    except Exception as error:
        print(f"ICON-EU weather refresh failed: {error}. Last published snapshot preserved.",
              file=sys.stderr)
        sys.exit(1)
