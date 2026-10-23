"""Download NOAA GFS 0.25° surface weather and publish an Ireland variables bundle.

The surface-weather half of the run the `gfs` wind importer reads, as its own
bundle: the dock's sky, air and rain rows past ICON-EU weather's three days, as
far as GFS's sixteen. Public domain, no API key. The NOMADS GRIB filter returns
only the Ireland/Atlantic subregion (about 100 KB a step for every field read);
`--source s3` falls back to ranged reads of the whole-globe messages on NOAA's
Open Data bucket through their `.idx` sidecar.

It publishes a `kind: "weather"` bundle in ICON-EU weather's own names (t2m,
td2m, rh2m, tp, precip, clct, clcl, clcm, clch, pmsl, vis, cape, ww, tg), so
the dock reads either the same way, with a precomputed series per riding
location and no map frames (docs/TILING_DESIGN.md).

Units are converted and rounded once, here: °C, mm, %, hPa, km, J/kg. `tp` is
GFS's precipitation accumulated since initialization and `precip` the amount
in the interval ending at the step, differenced from it; GFS publishes no
accumulation at hour 0, so both are null there. `ww` is a WMO present-weather
code DERIVED here, because GFS publishes none: from GFS's own categorical
precipitation type and rate at the hour, its visibility and its total cloud
(`present_weather`). `tg` is GFS's surface temperature, over sea a proxy for
SST and not an observation.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import os
import re
import sys
from urllib.parse import urlencode

import eccodes as ec
import numpy as np

import fetch_gfs
from fetch_gfs import discover, get, run_datetime
from fetch_forecast import (BBOX, ROOT, decode_handle, load_spots, published_in_bucket, sample,
                            spots_file)
from registry import MODELS, UNCHANGED_EXIT
from rundir import write_run
import timing

MODEL = "gfs-weather"
SOURCE_URL = "https://www.nco.ncep.noaa.gov/pmb/products/gfs/"
# GFS's whole run, three-hourly: hourly steps stop at +120 h, and three-hourly
# ones are what the dock's columns past ICON-EU weather fall on anyway.
STEP = 3
DEFAULT_HOURS = 384
MAX_HOURS = 384
MAX_AGE_HOURS = MODELS[MODEL]["maxAgeHours"]
PAUSE = {"nomads": 0.6, "s3": 0.05}
KELVIN = -273.15     # Added to kelvin to get degrees Celsius.
CODE = "code"        # A code-table entry, never interpolated and never a measurement.

# Every published variable, in publication order. `grib` is the message's
# identity (category, number, ecCodes' level type, level); every one is read at
# the valid hour itself except `tp`, the accumulation from initialization.
# `precip` and `ww` are derived here. `range` is the plausible published range:
# a value outside it plus `slack` fails the run, and a value inside the slack is
# clipped (a humidity of 100.4 % becomes 100).
VARIABLES = {
    "t2m": {"grib": (0, 0, "heightAboveGround", 2), "sourceUnits": ("K",),
            "offset": KELVIN, "decimals": 1, "range": (-50.0, 60.0),
            "units": "°C", "label": "Air temperature",
            "description": "Air temperature 2 m above ground (GFS TMP), converted from kelvin"},
    "td2m": {"grib": (0, 6, "heightAboveGround", 2), "sourceUnits": ("K",),
             "offset": KELVIN, "decimals": 1, "range": (-60.0, 45.0),
             "units": "°C", "label": "Dew point",
             "description": "Dew-point temperature 2 m above ground (GFS DPT), converted from kelvin"},
    "rh2m": {"grib": (1, 1, "heightAboveGround", 2), "sourceUnits": ("%",),
             "decimals": 0, "range": (0.0, 100.0), "slack": 1.0,
             "units": "%", "label": "Relative humidity",
             "description": "Relative humidity 2 m above ground (GFS RH), whole per cent"},
    "tp": {"grib": (1, 8, "surface", 0), "sourceUnits": ("kg m**-2", "kg m-2"), "accum": True,
           "decimals": 1, "range": (0.0, 2000.0),
           "units": "mm", "label": "Precipitation since run",
           "description": "Total precipitation accumulated from initialization to this hour "
                          "(GFS APCP); 1 kg/m² is 1 mm. Not published at initialization"},
    "precip": {"grib": None, "decimals": 1, "range": (0.0, 500.0),
               "units": "mm", "label": "Precipitation",
               "description": "Precipitation in the interval ending at this hour, differenced from "
                              "the APCP accumulation; null at initialization, which has no interval"},
    "clct": {"grib": (6, 1, "atmosphere", 0), "sourceUnits": ("%",),
             "decimals": 0, "range": (0.0, 100.0), "slack": 1.0,
             "units": "%", "label": "Total cloud",
             "description": "Total cloud cover of the entire atmosphere at this hour (GFS TCDC)"},
    "clcl": {"grib": (6, 3, "lowCloudLayer", 0), "sourceUnits": ("%",),
             "decimals": 0, "range": (0.0, 100.0), "slack": 1.0,
             "units": "%", "label": "Low cloud",
             "description": "Cloud cover of GFS's low cloud layer at this hour (GFS LCDC)"},
    "clcm": {"grib": (6, 4, "middleCloudLayer", 0), "sourceUnits": ("%",),
             "decimals": 0, "range": (0.0, 100.0), "slack": 1.0,
             "units": "%", "label": "Medium cloud",
             "description": "Cloud cover of GFS's middle cloud layer at this hour (GFS MCDC)"},
    "clch": {"grib": (6, 5, "highCloudLayer", 0), "sourceUnits": ("%",),
             "decimals": 0, "range": (0.0, 100.0), "slack": 1.0,
             "units": "%", "label": "High cloud",
             "description": "Cloud cover of GFS's high cloud layer at this hour (GFS HCDC)"},
    "pmsl": {"grib": (3, 1, "meanSea", 0), "sourceUnits": ("Pa",),
             "scale": 0.01, "decimals": 1, "range": (870.0, 1090.0),
             "units": "hPa", "label": "Pressure (MSL)",
             "description": "Pressure reduced to mean sea level (GFS PRMSL), converted from pascals"},
    "vis": {"grib": (19, 0, "surface", 0), "sourceUnits": ("m",),
            "scale": 0.001, "decimals": 1, "range": (0.0, 150.0),
            "units": "km", "label": "Visibility",
            "description": "Surface visibility (GFS VIS), converted from metres"},
    "cape": {"grib": (7, 6, "surface", 0), "sourceUnits": ("J kg**-1", "J kg-1"),
             "decimals": 0, "range": (0.0, 20000.0),
             "units": "J/kg", "label": "CAPE (surface parcel)",
             "description": "Convective available potential energy of a surface parcel (GFS CAPE)"},
    "ww": {"grib": None, "kind": CODE, "decimals": 0, "range": (0.0, 99.0),
           "units": "WMO code", "label": "Present weather (derived)",
           "description": "A WMO present-weather code derived by Force5 from GFS's categorical "
                          "precipitation type, precipitation rate, visibility and total cloud at "
                          "this hour, because GFS publishes none: 0–3 clear to overcast, 45 fog, "
                          "61–65 rain, 66–67 freezing rain, 68–69 rain and snow, 71–75 snow, "
                          "79 ice pellets. Never averaged"},
    "tg": {"grib": (0, 0, "surface", 0), "sourceUnits": ("K",),
           "offset": KELVIN, "decimals": 1, "range": (-60.0, 60.0),
           "units": "°C", "label": "Surface temperature (SST proxy at sea)",
           "description": "GFS surface temperature (TMP at the surface), converted from kelvin. "
                          "Over sea this is the model's own sea-surface temperature and only a "
                          "proxy for a measured SST; over land it is the skin temperature of the "
                          "ground, not an air temperature"},
}
# Read only to derive `ww`; not published.
INPUTS = {
    "prate": {"grib": (1, 7, "surface", 0), "sourceUnits": ("kg m**-2 s**-1", "kg m-2 s-1")},
    "crain": {"grib": (1, 192, "surface", 0)},
    "cfrzr": {"grib": (1, 193, "surface", 0)},
    "cicep": {"grib": (1, 194, "surface", 0)},
    "csnow": {"grib": (1, 195, "surface", 0)},
}
READ = {name: entry for name, entry in {**VARIABLES, **INPUTS}.items() if entry["grib"]}
BY_IDENTITY = {entry["grib"]: name for name, entry in READ.items()}
# The NOMADS filter's names for the same fields: every pairing of a selected
# variable and a selected level comes back, so the decoder picks by identity.
FILTER_VARS = ("TMP", "DPT", "RH", "APCP", "TCDC", "LCDC", "MCDC", "HCDC", "PRMSL", "VIS", "CAPE",
               "PRATE", "CRAIN", "CFRZR", "CICEP", "CSNOW")
FILTER_LEVELS = ("2_m_above_ground", "surface", "mean_sea_level", "entire_atmosphere",
                 "low_cloud_layer", "middle_cloud_layer", "high_cloud_layer")
# The same messages by their `.idx` names, for ranged reads from the bucket.
RECORDS = {"t2m": ("TMP", "2 m above ground"), "td2m": ("DPT", "2 m above ground"),
           "rh2m": ("RH", "2 m above ground"), "tp": ("APCP", "surface"),
           "clct": ("TCDC", "entire atmosphere"), "clcl": ("LCDC", "low cloud layer"),
           "clcm": ("MCDC", "middle cloud layer"), "clch": ("HCDC", "high cloud layer"),
           "pmsl": ("PRMSL", "mean sea level"), "vis": ("VIS", "surface"),
           "cape": ("CAPE", "surface"), "tg": ("TMP", "surface"), "prate": ("PRATE", "surface"),
           "crain": ("CRAIN", "surface"), "cfrzr": ("CFRZR", "surface"),
           "cicep": ("CICEP", "surface"), "csnow": ("CSNOW", "surface")}

# Deriving `ww`. Precipitation is falling at the hour where GFS's rate there is
# at least WET_MM_PER_HOUR; its intensity is graded by the rate as the American
# Meteorological Society grades rain (slight under 2.5 mm/h, moderate under
# 7.6, heavy above), and its kind by GFS's own categorical type. Otherwise a
# visibility under FOG_KM is fog, and the sky is graded by total cloud in oktas:
# 0–1 clear, 2–3 mainly clear, 4–6 partly cloudy, 7–8 overcast.
WET_MM_PER_HOUR = 0.1
MODERATE_MM_PER_HOUR, HEAVY_MM_PER_HOUR = 2.5, 7.6
FOG_KM = 1.0
CLOUD_STEPS = (18.75, 43.75, 81.25)  # Per cent: 1.5, 3.5 and 6.5 oktas.
PRESENT_WEATHER_NOTE = (
    "GFS publishes no present-weather code, so ww is derived by Force5 from GFS's own fields at the "
    f"hour, cell by cell: where the precipitation rate is at least {WET_MM_PER_HOUR} mm/h it is "
    "precipitation, of the kind GFS's categorical type says (freezing rain 66–67, ice pellets 79, "
    "rain and snow 68–69, snow 71/73/75, otherwise rain 61/63/65), graded slight, moderate or heavy "
    f"at {MODERATE_MM_PER_HOUR} and {HEAVY_MM_PER_HOUR} mm/h; otherwise a visibility under "
    f"{FOG_KM:g} km is fog (45); otherwise the total cloud in oktas says clear (0, up to one okta), "
    "mainly clear (1, up to three), partly cloudy (2, up to six) or overcast (3). GFS cannot tell "
    "a shower, drizzle or a thunderstorm from rain, so it never says one. It is a code, not a "
    "measurement: read from the cell containing a location and never interpolated, averaged or "
    "blended between models.")


def validate_metadata(metadata, field, run, hour):
    """GFS contract for one surface field: parameter, level, units, step, run."""
    entry = READ[field]
    category, number, level_type, level = entry["grib"]
    if metadata["parameterCategory"] != category or metadata["parameterNumber"] != number:
        raise ValueError(f"Wrong GRIB parameter for {field}")
    if metadata["typeOfLevel"] != level_type or metadata["level"] != level:
        raise ValueError(f"Unexpected level for {field}")
    if "sourceUnits" in entry and metadata["units"] not in entry["sourceUnits"]:
        raise ValueError(f"Unexpected units for {field}: {metadata['units']}")
    if metadata["gridType"] != "regular_ll":
        raise ValueError("Expected a regular latitude/longitude grid")
    # The accumulation runs from initialization; everything else is read at the valid hour.
    accum = entry.get("accum", False)
    if metadata["stepType"] != ("accum" if accum else "instant"):
        raise ValueError(f"Unexpected statistical processing for {field}")
    if metadata["stepUnits"] != 1 or metadata["startStep"] != (0 if accum else hour) \
            or metadata["endStep"] != hour:
        raise ValueError("Forecast lead time mismatch")
    if f'{metadata["dataDate"]}{metadata["dataTime"]:04d}' != run + "00":
        raise ValueError("Mixed forecast runs")
    expected_valid = datetime.strptime(run, "%Y%m%d%H") + timedelta(hours=hour)
    if f'{metadata["validityDate"]}{metadata["validityTime"]:04d}' != expected_valid.strftime("%Y%m%d%H%M"):
        raise ValueError("Valid time mismatch")


def convert(field, values):
    """Source units to published units, range-checked once and rounded once.
    The inputs to `ww` stay as GFS publishes them."""
    if field in INPUTS:
        if not np.all(np.isfinite(values)) or np.any(values < 0):
            raise ValueError(f"Implausible {field} value in the GFS crop")
        return np.asarray(values, dtype=float)
    entry = VARIABLES[field]
    low, high = entry["range"]
    values = (values + entry.get("offset", 0.0)) * entry.get("scale", 1.0)
    slack = entry.get("slack", 0.5)
    if np.any(values < low - slack) or np.any(values > high + slack):
        raise ValueError(f"Implausible {field} value in the GFS crop")
    values = np.clip(values, low, high)
    if entry["decimals"] == 0:
        return [int(value) for value in np.rint(values)]
    return np.round(values, entry["decimals"]).tolist()


def wanted(handle):
    """The field a message is, or None for one the filter sent that is not read:
    a period average, or the bucket accumulation beside the run total."""
    ec.codes_set(handle, "stepUnits", 1)
    identity = (ec.codes_get(handle, "parameterCategory"), ec.codes_get(handle, "parameterNumber"),
                ec.codes_get(handle, "typeOfLevel"), ec.codes_get(handle, "level"))
    field = BY_IDENTITY.get(identity)
    if field is None:
        return None
    step_type = ec.codes_get(handle, "stepType")
    if READ[field].get("accum"):
        return field if step_type == "accum" and ec.codes_get(handle, "startStep") == 0 else None
    return field if step_type == "instant" else None


def decode(path, run, hour, layout=None):
    """Every field of one step, validated and cropped. GFS has no accumulation at
    hour 0; at every other step the accumulation from initialization must be
    there, and where GFS repeats it (its first six-hour bucket is the same
    interval) both copies must agree."""
    fields = {}
    with path.open("rb") as stream:
        while True:
            handle = ec.codes_grib_new_from_file(stream)
            if handle is None:
                break
            try:
                if ec.codes_get(handle, "centre") != "kwbc":
                    raise ValueError("Expected an NCEP (kwbc) GFS message")
                field = wanted(handle)
            except Exception:
                ec.codes_release(handle)
                raise
            if field is None:
                ec.codes_release(handle)
                continue
            values, layout, _ = decode_handle(handle, field, run, hour, layout, validate_metadata, convert)
            if field in fields:
                if field != "tp" or fields[field] != values:
                    raise ValueError(f"Duplicate GFS {field} message at +{hour:03d}h")
            fields[field] = values
    expected = set(READ) - ({"tp"} if hour == 0 else set())
    if set(fields) != expected:
        raise ValueError(f"GFS +{hour:03d}h is missing {', '.join(sorted(expected - set(fields)))}")
    if layout[2]["dx"] != 0.25 or layout[2]["dy"] != 0.25:
        raise ValueError("Expected the 0.25-degree GFS grid")
    return fields, layout


def present_weather(prate, crain, cfrzr, cicep, csnow, vis_km, cloud):
    """A WMO 4677 code per cell from GFS's own fields at the hour (PRESENT_WEATHER_NOTE)."""
    rate = np.asarray(prate, dtype=float) * 3600.0  # kg m-2 s-1 is mm/s.
    grade = np.where(rate < MODERATE_MM_PER_HOUR, 0, np.where(rate < HEAVY_MM_PER_HOUR, 1, 2))
    rain, freezing, pellets, snow = (np.asarray(flag, dtype=float) >= 0.5
                                     for flag in (crain, cfrzr, cicep, csnow))
    cloud = np.asarray(cloud, dtype=float)
    sky = np.select([cloud < CLOUD_STEPS[0], cloud < CLOUD_STEPS[1], cloud < CLOUD_STEPS[2]],
                    [0, 1, 2], 3)
    dry = np.where(np.asarray(vis_km, dtype=float) < FOG_KM, 45, sky)
    wet = np.select([freezing, pellets, snow & rain, snow],
                    [66 + np.minimum(grade, 1), 79, 68 + np.minimum(grade, 1), 71 + 2 * grade],
                    61 + 2 * grade)
    return [int(code) for code in np.where(rate >= WET_MM_PER_HOUR, wet, dry)]


def derive(fields, previous_tp):
    """The published variables from one step's fields: `precip` from the
    accumulation, `ww` from its inputs, and the inputs dropped."""
    out = {name: fields.get(name) for name in VARIABLES if VARIABLES[name]["grib"]}
    tp = fields.get("tp")
    if tp is None:
        out["precip"] = None
    else:
        entry = VARIABLES["precip"]
        # The accumulation is zero at initialization by definition, so the first
        # interval's amount is the first accumulation itself.
        before = np.zeros(len(tp)) if previous_tp is None else np.asarray(previous_tp, dtype=float)
        difference = np.asarray(tp, dtype=float) - before
        # A tiny decrease where two steps' packing disagrees is no rain, not negative rain.
        out["precip"] = np.round(np.clip(difference, 0.0, entry["range"][1]), entry["decimals"]).tolist()
    out["ww"] = present_weather(fields["prate"], fields["crain"], fields["cfrzr"], fields["cicep"],
                                fields["csnow"], fields["vis"], fields["clct"])
    return out


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


def filter_url(run, hour):
    west, south, east, north = BBOX
    query = [("dir", f"/gfs.{run[:8]}/{run[-2:]}/atmos"),
             ("file", f"gfs.t{run[-2:]}z.pgrb2.0p25.f{hour:03d}")]
    query += [(f"var_{name}", "on") for name in FILTER_VARS]
    query += [(f"lev_{level}", "on") for level in FILTER_LEVELS]
    query += [("subregion", ""), ("leftlon", west), ("rightlon", east),
              ("toplat", north), ("bottomlat", south)]
    return fetch_gfs.FILTER + "?" + urlencode(query)


def accumulation_step(hour):
    """The `.idx` names of the run total to this hour: wgrib2 says whole days in days."""
    names = {f"0-{hour} hour acc fcst"}
    if hour % 24 == 0:
        names.add(f"0-{hour // 24} day acc fcst")
    return names


def index_ranges(text, hour):
    """Byte ranges of every message read at this hour, from the `.idx` sidecar."""
    entries = []
    for line in text.splitlines():
        parts = line.split(":")
        if len(parts) >= 6 and parts[1].isdigit():
            entries.append((int(parts[1]), parts[3], parts[4], parts[5]))
    if not entries:
        raise ValueError("Unreadable GFS index")
    instant = "anl" if hour == 0 else f"{hour} hour fcst"
    ranges = []
    for field, (name, level) in RECORDS.items():
        if field == "tp" and hour == 0:
            continue
        steps = accumulation_step(hour) if field == "tp" else {instant}
        found = [i for i, entry in enumerate(entries) if entry[1:3] == (name, level) and entry[3] in steps]
        # GFS lists the first interval's total twice (it is also a six-hour bucket):
        # the same bytes either way, so the first is read.
        if not found or (len(found) > 1 and field != "tp"):
            raise ValueError(f"GFS index has no single {name} at {level} for +{hour:03d}h")
        start = entries[found[0]][0]
        end = entries[found[0] + 1][0] - 1 if found[0] + 1 < len(entries) else ""
        ranges.append((start, end))
    return ranges


def download(source, run, hour):
    if source == "nomads":
        return get(filter_url(run, hour))
    key = fetch_gfs.object_key(run, hour)
    text = get(f"{fetch_gfs.BUCKET}/{key}.idx").decode()
    return b"".join(get(f"{fetch_gfs.BUCKET}/{key}", headers={"Range": f"bytes={start}-{end}"})
                    for start, end in fetch_gfs.contiguous(index_ranges(text, hour)))


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, default=DEFAULT_HOURS,
                        help=f"{STEP}–{MAX_HOURS}, divisible by {STEP}")
    parser.add_argument("--run", help="Optional specific YYYYMMDDHH run (00/06/12/18)")
    parser.add_argument("--source", choices=["nomads", "s3"], default="nomads",
                        help="NOMADS subregion filter, or ranged reads from NOAA's S3 mirror")
    args = parser.parse_args(argv)
    if not STEP <= args.hours <= MAX_HOURS or args.hours % STEP:
        parser.error(f"Use {STEP}–{MAX_HOURS} hours divisible by {STEP}")
    if args.run and not re.fullmatch(r"\d{8}(00|06|12|18)", args.run):
        parser.error("A run is YYYYMMDDHH on a 00/06/12/18 cycle")
    return args


def manifest_for(run, run_time, args, grid, series):
    return {
        "schemaVersion": 1, "kind": "weather", "model": MODEL,
        "modelName": "GFS weather", "provider": "NOAA NCEP",
        "modelDetail": "Global Forecast System surface fields, 0.25° deterministic",
        "resolutionKm": None, "resolutionLabel": "0.25° global grid",
        "run": run, "runTime": run_time.isoformat().replace("+00:00", "Z"),
        "generatedAt": datetime.now(timezone.utc).isoformat(), "stepHours": STEP,
        "grid": grid,
        "variables": {name: {key: entry[key] for key in ("units", "label", "description")}
                              | ({"kind": CODE} if entry.get("kind") == CODE else {})
                      for name, entry in VARIABLES.items()},
        # No map frames: nothing reads a weather grid, and the spot series is the
        # product (docs/TILING_DESIGN.md). The horizon is stated instead.
        "frames": [], "horizonHours": args.hours, "spotSeries": series,
        "precipitationNote": (
            "tp is GFS's own accumulation since initialization (APCP), which GFS does not publish at "
            f"hour 0; precip is the amount in the {STEP}-hour interval ending at each step, obtained by "
            "differencing it (the first interval's is the first accumulation itself), clamped at zero "
            "and null at initialization, which has no interval. Each series step declares that "
            "interval in precipIntervalHours."),
        "seaTemperatureNote": (
            "tg is GFS's surface temperature. Over sea it is the model's own sea-surface temperature "
            "and a proxy for a measured SST, not an observation; over land it is the skin temperature "
            "of the ground, which on a sunny afternoon runs far above the air temperature in t2m."),
        "presentWeatherNote": PRESENT_WEATHER_NOTE,
        "processing": (
            "Sixteen GFS 0.25° surface fields (TMP and DPT and RH at 2 m, TMP at the surface, APCP, "
            "TCDC, LCDC, MCDC, HCDC, PRMSL, VIS, CAPE, PRATE and the four categorical precipitation "
            "types) are read from one cycle at three-hour steps, checked for parameter, level, units, "
            "statistical processing, initialization and valid time, then cropped to 18°W–2°E / "
            "48°–59°N on the source grid, rows north-to-south and columns west-to-east. Values are "
            "converted to the published units and rounded once (0.1 °C, whole per cent, 0.1 hPa, "
            "0.1 km, 0.1 mm, whole J/kg) and clipped into their plausible range; a value outside it "
            "fails the run. precip is derived by differencing APCP, and ww from the precipitation "
            "rate and type, visibility and total cloud (see presentWeatherNote); neither the rate nor "
            "the types are published. spotSeries carries every variable at every published hour, "
            "bilinearly sampled except ww, which is read from the containing cell. No hour is "
            "interpolated: only native forecast steps are published."),
        "sourceUrl": SOURCE_URL,
        "attribution": "Weather data: NOAA/NCEP Global Forecast System (GFS), a work of the US "
                       "Government in the public domain. Cropped, converted and processed by Force5 "
                       "(wingfoil.ie); this is modified NOAA output, not official government "
                       "material, and NOAA/NWS does not endorse Force5.",
        "licenseUrl": "https://www.weather.gov/disclaimer",
    }


def main(argv=None):
    args = parse_args(argv)
    fetch_gfs.THROTTLE.pause = PAUSE[args.source]
    hours = list(range(0, args.hours + 1, STEP))
    timing.start("discover")
    run = discover(args.source, hours, args.run)
    run_time = run_datetime(run)
    age = (datetime.now(timezone.utc) - run_time).total_seconds() / 3600
    if not -1 <= age <= MAX_AGE_HOURS:
        raise ValueError(f"Refusing a stale/future GFS run (maximum age {MAX_AGE_HOURS} hours)")
    if published_in_bucket(run, args.run):
        print(f"GFS surface weather {run} is already published; nothing to download.", flush=True)
        return UNCHANGED_EXIT
    print(f"Fetching GFS surface weather {run} from {args.source}: {len(hours)} steps through "
          f"+{args.hours}h", flush=True)
    cache = ROOT / ".cache" / MODEL / run
    cache.mkdir(parents=True, exist_ok=True)

    def fetch(hour):
        path = cache / f"{hour:03d}.grib2"
        # Revalidate cached data; a truncated cache entry must never publish.
        if path.exists():
            try:
                return hour, decode(path, run, hour)
            except Exception:
                print(f"Re-fetching invalid cached step +{hour:03d}h", flush=True)
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
    timing.start("download", workers=2)
    with ThreadPoolExecutor(max_workers=2) as pool:
        decoded = dict(pool.map(fetch, hours))
    timing.start("decode")
    spots = load_spots()
    print(f"Sampling {len(spots)} spots from {spots_file()}", flush=True)
    output = ROOT / "public" / "weather"
    prefix = f"{MODEL}-{run}-{args.hours}h-v1"
    signature = decoded[0][1][0]
    # The shared crop names one unit for a wind grid; a weather grid has many.
    grid = {key: value for key, value in decoded[0][1][2].items() if key != "units"}
    series = {spot["id"]: [] for spot in spots}
    previous_tp = None
    for hour in hours:
        fields, layout = decoded[hour]
        if layout[0] != signature:
            raise ValueError("GFS grid changed within the run")
        published = derive(fields, previous_tp)
        previous_tp = fields.get("tp")
        interval = None if hour == 0 else [hour - STEP, hour]
        valid = (run_time + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
        for spot in spots:
            series[spot["id"]].append({"hour": hour, "validTime": valid,
                                       "precipIntervalHours": interval,
                                       "values": {name: None if values is None else sample_variable(
                                           grid, values, spot["lon"], spot["lat"], name)
                                           for name, values in published.items()}})
    manifest = manifest_for(run, run_time, args, grid, series)
    # Only this final operation advances the published snapshot.
    write_run(output, f"{MODEL}.json", manifest, prefix, spots)
    print(f"Published {len(hours)} GFS weather steps for {len(spots)} spots to "
          f"{output / (MODEL + '.json')}", flush=True)


if __name__ == "__main__":
    try:
        # A run that is already published exits UNCHANGED_EXIT, which the worker
        # reads as "nothing new", not as a failure and not as a bundle to validate.
        sys.exit(main() or 0)
    except Exception as error:
        print(f"GFS weather refresh failed: {error}. Last published snapshot preserved.",
              file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
