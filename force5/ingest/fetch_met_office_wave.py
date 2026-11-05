"""Met Office North-West Shelf wave forecast (about 1.5 km) for every riding location.

The Met Office's UK wave model (WAVEWATCH III on the AMM15 shelf grid, 16°W–13°E,
46–62.7°N) runs four times a day to +60 h, hourly. The Met Office publishes it
on an anonymous S3 bucket, `met-office-nws-wave-model-data` in eu-west-2, under
CC BY-SA 4.0. Every run lands about 2 h 45 m after its run time as one NetCDF4
file per parameter per day of forecast: hours 0–23, 24–47 and 48–60.

No spatial subsetting exists. Each file is chunked one whole 1240 × 958 field
per hour (about 0.5 MB compressed), so even an HTTP range read of a single cell
fetches its hour's whole field. This adapter therefore downloads each of the
files it needs once, into memory, reads the few cells near each riding location
and drops the rest: 15 parameters × 3 files, about 430 MB a run, nothing written
to disk. That is the floor for this source; dropping a partition is the only way
to read less.

Nearest wet cell. The grid is 1/74° of latitude by 1/33° of longitude, about
1.5 km north-south and 2 km east-west at Irish latitudes. A beach's own cell is
often land, so each spot reads the closest cell the model solved, within
`SEARCH_KM`, and records that offset in `spotCoverage`. Directions come from the
closest wet cell whose four neighbours are wet too: on the model's coastline no
wave arrives from the land side, so a coastline cell's direction points out to
sea whatever the wind does (the same reasoning as fetch_mi_swan.py).

What counts as wet. Land is the fill value, but a cell that is not fill need not
hold waves: about 4,000 of the grid's cells, many of them on the Irish coast and
the same cells run after run, are written as exactly zero at every hour, wind
over them or not. Their depth does not tell them apart either: `wave_grid_depth`
gives most of those near Ireland a depth of 1-8 m. So a cell is wet if a wave
appears in it at some hour of the run. Height at the run hour alone will not do:
about 200 real sea cells are calm at +0 and carry waves later.

Licence. CC BY-SA 4.0: the per-spot series this publishes are adapted material,
so they are offered under the same licence, with the Met Office credited and the
changes stated in the manifest (`attribution`, `licenseUrl`, `processing`). The
rest of the site's data is not: a few hundred cells out of a 1.2-million-cell
grid is not a substantial part of the Met Office's database.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import io
import math
import re
import sys
import time
from urllib.parse import quote
from xml.etree import ElementTree

import h5py
import numpy as np
import requests

from fetch_forecast import ROOT, load_spots, published_in_bucket
from registry import UNCHANGED_EXIT
from rundir import write_run
import timing

MODEL = "met-office-wave"
BUCKET = "met-office-nws-wave-model-data"
BUCKET_URL = f"https://{BUCKET}.s3.eu-west-2.amazonaws.com"
PREFIX = "nws-wave"
SOURCE_URL = "https://registry.opendata.aws/met-office-nws-wave/"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
ATTRIBUTION = ("Wave forecast: Met Office North-West Shelf wave model, © British Crown "
               "copyright, the Met Office, licensed under CC BY-SA 4.0. Sampled at each riding "
               "location and reformatted by wingfoil.ie; these derived series are offered under "
               "the same licence, CC BY-SA 4.0. Not endorsed by the Met Office; not for "
               "navigation or safety-critical use.")
USER_AGENT = "Force5/0.1 (wingfoil.ie)"
# The one grid this adapter decodes. A new grid version is a change to review,
# not one to follow silently.
GRID_NAME = "wave_uk_standard_v1-level_1"
CYCLES = (0, 6, 12, 18)
FORECAST_HOURS = 60
FILE_HOURS = 24  # Each file holds one day of the run: +0, +24 and +48 h onwards.
MAX_AGE_HOURS = 12  # As the registry's maxAgeHours.
LOOKBACK_CYCLES = 4
SEARCH_KM = 8.0
# The least height a cell must reach at some hour of the run to count as wet:
# the smallest the published two decimals can tell from nothing.
MIN_WAVE_M = 0.01
CONCURRENCY = 4
TIMEOUT = (15, 120)
ATTEMPTS = 3
EXPECTED_SHAPE = (1240, 958)  # latitude, longitude
DOMAIN = {"south": 46.0, "north": 62.75, "west": -16.0, "east": 13.0}
KEY = re.compile(r"/b(?P<run>\d{8}T\d{4}Z)_hi(?P<start>\d{8}T\d{4}Z)-(?P<grid>.+?)-"
                 r"(?P<param>[a-z0-9_]+)\.nc$")

HEIGHT, PERIOD, DIRECTION = "height", "period", "direction"
# Our name: (parameter file, NetCDF variable, standard_name, kind, label, description).
SOURCES = {
    "swh": ("wave_significant_height", "VHM0", "sea_surface_wave_significant_height", HEIGHT,
            "Wave height", "Spectral significant height of the whole sea, wind waves and swell "
                           "together (Hm0)."),
    "pp1d": ("wave_peak_period", "VTPK",
             "sea_surface_wave_period_at_variance_spectral_density_maximum", PERIOD,
             "Peak period", "Period at the peak of the whole spectrum (Tp)."),
    "mwd": ("wave_mean_direction", "VMDR", "sea_surface_wave_from_direction", DIRECTION,
            "Mean direction", "Mean direction the whole sea comes from. Read from the spot's "
                              "`directionCell`, clear of the model's coastline."),
    "shww": ("wind_wave_significant_height", "VHM0_WW",
             "sea_surface_wind_wave_significant_height", HEIGHT,
             "Wind-sea height", "Significant height of the locally generated wind sea."),
    "ppww": ("wind_wave_peak_period", "VTPK_WW",
             "sea_surface_wind_wave_period_at_variance_spectral_density_maximum", PERIOD,
             "Wind-sea peak period", "Peak period of the locally generated wind sea."),
    "mdww": ("wind_wave_mean_direction", "VMDR_WW", "sea_surface_wind_wave_from_direction",
             DIRECTION, "Wind-sea direction", "Mean direction the wind sea comes from, from the "
                                              "`directionCell`."),
}
for _number, _word in ((1, "primary"), (2, "secondary"), (3, "tertiary")):
    _label = {1: "Primary", 2: "Secondary", 3: "Tertiary"}[_number]
    SOURCES.update({
        f"swell{_number}_h": (f"{_word}_swell_wave_significant_height", f"VHM0_SW{_number}",
                              f"sea_surface_{_word}_swell_wave_significant_height", HEIGHT,
                              f"{_label} swell height",
                              f"Significant height of the {_word} swell partition."),
        f"swell{_number}_p": (f"{_word}_swell_wave_peak_period", f"VTPK_SW{_number}",
                              f"sea_surface_{_word}_swell_wave_period_at_variance_spectral_"
                              "density_maximum", PERIOD, f"{_label} swell peak period",
                              f"Peak period of the {_word} swell partition."),
        f"swell{_number}_d": (f"{_word}_swell_wave_mean_direction", f"VMDR_SW{_number}",
                              f"sea_surface_{_word}_swell_wave_from_direction", DIRECTION,
                              f"{_label} swell direction",
                              f"Mean direction the {_word} swell comes from, from the "
                              "`directionCell`."),
    })
UNITS = {HEIGHT: ("m", "m"), PERIOD: ("s", "s"), DIRECTION: ("degree", "deg")}
# Physical bounds; a value outside them is a broken file, not a forecast.
LIMITS = {HEIGHT: (0.0, 30.0, 2), PERIOD: (0.0, 100.0, 2), DIRECTION: (0.0, 360.0, 1)}
VARIABLES = {name: {"units": UNITS[entry[3]][1], "label": entry[4], "description": entry[5]}
             for name, entry in SOURCES.items()}
PARAMETERS = {entry[0]: name for name, entry in SOURCES.items()}
DIRECTION_KEYS = tuple(name for name, entry in SOURCES.items() if entry[3] == DIRECTION)
# Each sea state as (height, period, direction). Where a partition is absent the
# source writes zero for all three, and a zero bearing would read as "from the
# north": with no height there is no period or direction to publish.
SEA_STATES = (("swh", "pp1d", "mwd"), ("shww", "ppww", "mdww"),
              *((f"swell{n}_h", f"swell{n}_p", f"swell{n}_d") for n in (1, 2, 3)))
SESSION = timing.count_responses(requests.Session())


def stamp(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def compact(moment):
    return moment.strftime("%Y%m%dT%H%MZ")


def run_prefix(run):
    return f"{PREFIX}/{run:%Y/%m/%d}/T{run:%H%M}Z/"


def get(url, **kwargs):
    for attempt in range(ATTEMPTS):
        try:
            response = SESSION.get(url, timeout=TIMEOUT,
                                   headers={"User-Agent": USER_AGENT}, **kwargs)
            response.raise_for_status()
            return response
        except Exception:
            if attempt == ATTEMPTS - 1:
                raise
            time.sleep(2 ** attempt)


def listing(prefix):
    """Every key and size under `prefix`, following continuation tokens."""
    namespace = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
    keys, token = {}, None
    while True:
        query = f"list-type=2&prefix={quote(prefix, safe='/')}"
        if token:
            query += f"&continuation-token={quote(token, safe='')}"
        root = ElementTree.fromstring(get(f"{BUCKET_URL}/?{query}").content)
        for item in root.findall("s3:Contents", namespace):
            keys[item.findtext("s3:Key", namespaces=namespace)] = int(
                item.findtext("s3:Size", namespaces=namespace))
        if root.findtext("s3:IsTruncated", namespaces=namespace) != "true":
            return keys
        token = root.findtext("s3:NextContinuationToken", namespaces=namespace)


def file_starts(hours):
    return list(range(0, hours + 1, FILE_HOURS))


def run_files(run, keys, hours=FORECAST_HOURS):
    """{(parameter, start hour): key} for a complete run, or the reason it is not."""
    wanted = {(parameter, start) for parameter in PARAMETERS for start in file_starts(hours)}
    found = {}
    for key in keys:
        match = KEY.search("/" + key)
        if not match or match["run"] != compact(run) or match["grid"] != GRID_NAME:
            continue
        start = datetime.strptime(match["start"], "%Y%m%dT%H%MZ").replace(tzinfo=timezone.utc)
        offset = (start - run).total_seconds() / 3600
        found[(match["param"], offset)] = key
    missing = sorted(wanted - set(found))
    if missing:
        return None, f"{len(missing)} of {len(wanted)} files missing"
    return {item: found[item] for item in sorted(wanted)}, None


def candidates(now, requested=None):
    if requested:
        run = datetime.strptime(requested, "%Y%m%d%H").replace(tzinfo=timezone.utc)
        if run.hour not in CYCLES:
            raise ValueError("The Met Office wave model runs at 00, 06, 12 and 18 UTC")
        return [run]
    newest = now.replace(minute=0, second=0, microsecond=0)
    newest -= timedelta(hours=newest.hour % 6)
    return [newest - timedelta(hours=6 * back) for back in range(LOOKBACK_CYCLES)]


def discover(now, requested=None, hours=FORECAST_HOURS):
    """The newest run whose every needed file is listed, with its keys and bytes."""
    for run in candidates(now, requested):
        keys = listing(run_prefix(run))
        files, reason = run_files(run, keys, hours)
        if files:
            return run, files, sum(keys[key] for key in files.values())
        print(f"Skipping Met Office wave run {stamp(run)}: {reason}", flush=True)
    raise RuntimeError("No complete Met Office wave run is listed. "
                       "The published forecast has not been changed.")


def text(value):
    return value.decode() if isinstance(value, bytes) else str(value)


def scalar(attributes, name):
    value = attributes.get(name)
    return None if value is None else np.asarray(value).reshape(-1)[0].item()


def check_axis(values, low, high, name):
    steps = np.diff(values)
    if values.ndim != 1 or not np.all(steps > 0) or np.ptp(steps) > 1e-6:
        raise ValueError(f"The {name} axis is no longer regular and increasing")
    if values[0] < low - 0.01 or values[-1] > high + 0.01:
        raise ValueError(f"The {name} axis now reaches {values[0]:.3f}..{values[-1]:.3f}")


def open_file(data, name, run, start, hours):
    """The file's dataset, checked for identity, axes and hours, with its decoding."""
    handle = h5py.File(io.BytesIO(data), "r")
    parameter, variable, standard, kind = SOURCES[name][:4]
    if variable not in handle:
        raise ValueError(f"{parameter} no longer carries {variable}")
    dataset = handle[variable]
    attributes = dataset.attrs
    if text(attributes.get("standard_name", b"")) != standard:
        raise ValueError(f"{variable} changed its standard name")
    if text(attributes.get("units", b"")) != UNITS[kind][0]:
        raise ValueError(f"{variable} changed its units to {text(attributes.get('units'))!r}")
    if dataset.ndim != 3 or dataset.shape[1:] != EXPECTED_SHAPE:
        raise ValueError(f"{variable} has shape {dataset.shape}, not (hours, *{EXPECTED_SHAPE})")
    reference = handle["forecast_reference_time"]
    if (text(reference.attrs.get("units", b"")) != "seconds since 1970-01-01T00:00:00"
            or int(reference[()]) != int(run.timestamp())):
        raise ValueError(f"{parameter} +{start} h is not the {stamp(run)} run")
    periods = handle["forecast_period"][:]
    expected = list(range(start, min(start + FILE_HOURS - 1, hours) + 1))
    published = [int(value) // 3600 for value in periods]
    if published[:len(expected)] != expected or any(int(v) % 3600 for v in periods):
        raise ValueError(f"{parameter} +{start} h holds hours {published[:3]}..., "
                         f"not {expected[0]}..{expected[-1]}")
    valid = handle["time"][:len(expected)]
    if [int(v) for v in valid] != [int(run.timestamp()) + 3600 * h for h in expected]:
        raise ValueError(f"{parameter} +{start} h has valid times that do not match its periods")
    decoding = {"scale": float(scalar(attributes, "scale_factor") or 1.0),
                "offset": float(scalar(attributes, "add_offset") or 0.0),
                "fill": scalar(attributes, "_FillValue"),
                "min": scalar(attributes, "valid_min"), "max": scalar(attributes, "valid_max")}
    return handle, dataset, expected, decoding


def grid_of(handle):
    latitudes = handle["latitude"][:]
    longitudes = handle["longitude"][:]
    check_axis(latitudes, DOMAIN["south"], DOMAIN["north"], "latitude")
    check_axis(longitudes, DOMAIN["west"], DOMAIN["east"], "longitude")
    return latitudes, longitudes


def decode_values(raw, decoding, kind, label):
    """Raw packed integers to rounded floats, None where the model has no value."""
    out = []
    low, high, digits = LIMITS[kind]
    for value in raw.tolist():
        if decoding["fill"] is not None and value == decoding["fill"]:
            out.append(None)
            continue
        if ((decoding["min"] is not None and value < decoding["min"])
                or (decoding["max"] is not None and value > decoding["max"])):
            raise ValueError(f"{label}: packed value {value} outside the declared valid range")
        number = value * decoding["scale"] + decoding["offset"]
        if not math.isfinite(number) or not low - 0.01 <= number <= high + 0.01:
            raise ValueError(f"{label}: implausible value {number}")
        number = round(number, digits)
        out.append(number % 360 if kind == DIRECTION else number)
    return out


def read_cells(data, name, run, start, hours, cells, grid=None):
    """{hour: [value per cell]} for one parameter file; the grid must match the run's."""
    handle, dataset, expected, decoding = open_file(data, name, run, start, hours)
    with handle:
        if grid is not None:
            latitudes, longitudes = grid_of(handle)
            if not (np.array_equal(latitudes, grid[0]) and np.array_equal(longitudes, grid[1])):
                raise ValueError(f"{SOURCES[name][0]} +{start} h is on a different grid")
        kind = SOURCES[name][3]
        values = {}
        for index, hour in enumerate(expected):
            field = dataset[index]
            values[hour] = decode_values(field.reshape(-1)[cells], decoding, kind,
                                         f"{name} +{hour} h")
        return values


def holds_waves(fields, decoding):
    """The cells a wave reaches at some hour, from a run's packed height fields."""
    wet = None
    for field in fields:
        water = (field != decoding["fill"] if decoding["fill"] is not None
                 else np.isfinite(field))
        here = water & (field * decoding["scale"] + decoding["offset"] >= MIN_WAVE_M)
        wet = here if wet is None else wet | here
    return wet


def haversine_km(lat, lon, lats, lons):
    lat, lon = math.radians(lat), math.radians(lon)
    lats, lons = np.radians(lats), np.radians(lons)
    a = (np.sin((lats - lat) / 2) ** 2
         + math.cos(lat) * np.cos(lats) * np.sin((lons - lon) / 2) ** 2)
    return 2 * 6371.0088 * np.arcsin(np.sqrt(a))


def plan_spot(spot, latitudes, longitudes, wet):
    """The cells one spot is read from: the nearest wet one, and the nearest open one."""
    rows, columns = wet.shape
    inside = (latitudes[0] <= spot["lat"] <= latitudes[-1]
              and longitudes[0] <= spot["lon"] <= longitudes[-1])
    if not inside:
        return {"cell": None, "open": None, "ownWet": False, "inside": False}
    d_lat = latitudes[1] - latitudes[0]
    d_lon = longitudes[1] - longitudes[0]
    row = int(round((spot["lat"] - latitudes[0]) / d_lat))
    column = int(round((spot["lon"] - longitudes[0]) / d_lon))
    reach_rows = math.ceil(SEARCH_KM / (111.195 * d_lat)) + 1
    reach_columns = math.ceil(SEARCH_KM / (111.195 * d_lon * max(
        math.cos(math.radians(spot["lat"])), 0.05))) + 1
    top, bottom = max(row - reach_rows, 0), min(row + reach_rows, rows - 1)
    left, right = max(column - reach_columns, 0), min(column + reach_columns, columns - 1)
    block_rows, block_columns = np.mgrid[top:bottom + 1, left:right + 1]
    distance = haversine_km(spot["lat"], spot["lon"], latitudes[block_rows],
                            longitudes[block_columns])
    block_wet = wet[top:bottom + 1, left:right + 1]
    # Open water: wet, with all four neighbours wet. Outside the domain counts as dry.
    padded = np.pad(wet, 1, constant_values=False)
    neighbours = (padded[:-2, 1:-1] & padded[2:, 1:-1] & padded[1:-1, :-2] & padded[1:-1, 2:])
    block_open = block_wet & neighbours[top:bottom + 1, left:right + 1]

    def nearest(mask):
        candidates = np.where(mask & (distance <= SEARCH_KM), distance, np.inf)
        index = np.unravel_index(int(np.argmin(candidates)), candidates.shape)
        if not np.isfinite(candidates[index]):
            return None
        r, c = int(block_rows[index]), int(block_columns[index])
        return {"flat": r * columns + c, "lat": round(float(latitudes[r]), 5),
                "lon": round(float(longitudes[c]), 5),
                "offsetKm": round(float(candidates[index]), 2)}

    return {"cell": nearest(block_wet), "open": nearest(block_open),
            "ownWet": bool(wet[row, column]), "inside": True}


def coverage_for(plan):
    cell, clear = plan["cell"], plan["open"]
    if not plan["inside"]:
        note = "This location is outside the Met Office North-West Shelf wave model's domain."
    elif cell is None:
        note = (f"No cell of this 1.5 km wave model that holds waves lies within "
                f"{SEARCH_KM:g} km of this location. It cannot say anything about waves here.")
    elif plan["ownWet"]:
        note = "This location sits in a cell the 1.5 km wave model solved."
    else:
        note = (f"The 1.5 km cell over this location is land in the wave model, or water no "
                f"wave reaches in this run, so the values come from the nearest cell that holds "
                f"waves, {cell['offsetKm']:.1f} km away. They describe the sea just off this "
                "beach, not the shorebreak.")
    return {"landMasked": not plan["ownWet"], "resolved": cell is not None,
            "nearestOffsetKm": None if cell is None else cell["offsetKm"],
            "cellLat": None if cell is None else cell["lat"],
            "cellLon": None if cell is None else cell["lon"],
            "directionCell": None if clear is None else {
                "lat": clear["lat"], "lon": clear["lon"], "offsetKm": clear["offsetKm"]},
            "note": note}


def series_for(plan, values, index, run, hours):
    """One spot's hourly steps: heights and periods from its cell, directions from open water."""
    steps = []
    cell, clear = plan["cell"], plan["open"]
    for hour in range(hours + 1):
        row = {}
        for name in SOURCES:
            source = clear if name in DIRECTION_KEYS else cell
            row[name] = None if source is None else values[name][hour][index[source["flat"]]]
        for height, period, direction in SEA_STATES:
            if row[height] == 0:
                row[period] = row[direction] = None
        steps.append({"hour": hour, "validTime": stamp(run + timedelta(hours=hour)),
                      "values": row})
    return steps


def check_series(series, coverage):
    """Refuse a run that says something about a spot its cell cannot.

    `holds_waves` should have kept every spot off a cell like these: reaching
    one means that test has stopped working. Zero at every hour is a cell no
    wave reaches, not a calm sea, and the forecast it would replace is better
    than a flat one at a beach with surf on it."""
    for spot, steps in series.items():
        if not coverage[spot]["resolved"]:
            continue
        heights = [step["values"]["swh"] for step in steps]
        if all(height is None for height in heights):
            raise ValueError(f"{spot}: its cell holds waves but has no wave height at any hour")
        if not any(heights):
            raise ValueError(f"{spot}: reads zero at every hour, which is a cell no wave "
                             "reaches and not a forecast")


def describe(hours, coverage):
    resolved = sum(1 for entry in coverage.values() if entry["resolved"])
    masked = sum(1 for entry in coverage.values() if entry["resolved"] and entry["landMasked"])
    directed = sum(1 for entry in coverage.values() if entry["directionCell"])
    return (
        f"One Met Office North-West Shelf wave run (WAVEWATCH III on the {EXPECTED_SHAPE[0]} × "
        f"{EXPECTED_SHAPE[1]} regular latitude-longitude grid, 1/74° by 1/33°), read from the "
        f"Met Office's NetCDF files on AWS. Hours 0-{hours}, every source hour, none "
        f"interpolated. Each value is the model's own at one grid cell, unpacked from its "
        f"integer encoding and rounded; nothing is resampled. {resolved} of {len(coverage)} "
        f"locations have a cell holding waves within {SEARCH_KM:g} km; {masked} of them sit on a "
        f"land cell, or one no wave reaches in the run, and read the nearest that holds waves, "
        f"its distance in `spotCoverage.nearestOffsetKm`. Directions (mwd, mdww, swell*_d) come "
        f"from the nearest such cell whose four neighbours hold waves too, "
        f"`spotCoverage.directionCell`, because a coastline cell hears nothing from the land "
        f"side; {directed} locations have one within the limit, the rest publish null "
        f"directions. Land and unresolved cells are null, never zero; a cell the model writes as "
        f"zero at every hour of the run is not read at all.")


def manifest_for(run, now, hours, series, coverage, source):
    return {
        "schemaVersion": 1, "kind": "wave", "model": MODEL,
        "modelName": "Met Office NWS Wave", "provider": "Met Office",
        "modelDetail": "WAVEWATCH III North-West Shelf wave model (AMM15 grid), 1.5 km",
        "run": run.strftime("%Y%m%d%H"), "runTime": stamp(run), "generatedAt": stamp(now),
        "stepHours": 1, "horizonHours": hours, "frames": [],
        "resolutionKm": 1.5,
        "resolutionLabel": "1/74° by 1/33° regular grid: about 1.5 km north-south and 2 km "
                           "east-west at Irish latitudes",
        "variables": VARIABLES, "spotSeries": series, "spotCoverage": coverage,
        "directionConvention": "Wave directions are the bearing the waves come FROM, in degrees "
                               "true, like the wind direction rows: 270° is a westerly swell.",
        "partitionNote": "swh/pp1d/mwd describe the whole spectrum. shww/ppww/mdww are the "
                         "locally generated wind sea and swell1_*, swell2_* and swell3_* the "
                         "Met Office's primary, secondary and tertiary swell partitions; they are "
                         "separate wave trains arriving together, so their heights add in energy, "
                         "not in metres. Periods here are peak periods. A partition the model "
                         "did not find at an hour has height 0 and null period and direction.",
        "processing": describe(hours, coverage),
        "source": f"s3://{BUCKET}/{run_prefix(run)}",
        "sourceFiles": source,
        "sourceUrl": SOURCE_URL, "attribution": ATTRIBUTION, "licenseUrl": LICENSE_URL,
        "license": "CC BY-SA 4.0",
    }


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--hours", type=int, default=FORECAST_HOURS,
                        help=f"Hours to publish from the run, 1-{FORECAST_HOURS} (default)")
    parser.add_argument("--run", help="A specific YYYYMMDDHH run (00/06/12/18) to import again")
    args = parser.parse_args(argv)
    if not 1 <= args.hours <= FORECAST_HOURS:
        parser.error(f"Publish 1-{FORECAST_HOURS} hours")
    return args


def main(argv=None, now=None):
    args = parse_args(argv)
    now = now or datetime.now(timezone.utc)
    timing.start("discover")
    run, files, total = discover(now, args.run, args.hours)
    age = (now - run).total_seconds() / 3600
    if not args.run and not -1 <= age <= MAX_AGE_HOURS:
        raise ValueError(f"Refusing a stale Met Office wave run {stamp(run)} "
                         f"(maximum age {MAX_AGE_HOURS} hours)")
    if published_in_bucket(run.strftime("%Y%m%d%H"), args.run):
        print(f"Met Office wave run {stamp(run)} is already published; nothing to download.",
              flush=True)
        return UNCHANGED_EXIT
    print(f"Met Office wave run {stamp(run)}: {len(files)} files, {total / 1e6:.0f} MB, "
          f"+0..{args.hours} h", flush=True)

    spots = load_spots()
    # The height files plan every spot: the grid, and the cells a wave reaches
    # at some hour of the run.
    timing.start("download", workers=CONCURRENCY)
    height_files = [item for item in files if item[0] == SOURCES["swh"][0]]
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        bodies = dict(zip(height_files, pool.map(
            lambda item: get(f"{BUCKET_URL}/{files[item]}").content, height_files)))
    timing.start("decode")
    grid, wet = None, None
    for (_, start), body in bodies.items():
        handle, dataset, expected, decoding = open_file(body, "swh", run, start, args.hours)
        with handle:
            grid = grid or grid_of(handle)
            reached = holds_waves((dataset[i] for i in range(len(expected))), decoding)
        wet = reached if wet is None else wet | reached
    plans = {spot["id"]: plan_spot(spot, *grid, wet) for spot in spots}
    cells = sorted({cell["flat"] for plan in plans.values()
                    for cell in (plan["cell"], plan["open"]) if cell})
    index = {flat: position for position, flat in enumerate(cells)}
    cells = np.array(cells, dtype=np.int64)

    def task(item):
        (parameter, start), key = item
        name = PARAMETERS[parameter]
        body = bodies.get(item[0]) or get(f"{BUCKET_URL}/{key}").content
        with timing.phase("decode"):
            return name, read_cells(body, name, run, start, args.hours, cells, grid)

    timing.start("download", workers=CONCURRENCY)
    values = {name: {} for name in SOURCES}
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        for name, hours in pool.map(task, files.items()):
            values[name].update(hours)
    del bodies
    timing.start("decode")
    for name, hours in values.items():
        if sorted(hours) != list(range(args.hours + 1)):
            raise ValueError(f"{name} does not cover hours 0-{args.hours}")
    series = {spot["id"]: series_for(plans[spot["id"]], values, index, run, args.hours)
              for spot in spots}
    coverage = {spot["id"]: coverage_for(plans[spot["id"]]) for spot in spots}
    check_series(series, coverage)
    manifest = manifest_for(run, now, args.hours, series, coverage,
                            sorted(key.rsplit("/", 1)[1] for key in files.values()))
    output = ROOT / "public" / "weather"
    prefix = f"{MODEL}-{run:%Y%m%d%H}-{args.hours}h-v1"
    # Only this final atomic write advances the published wave forecast.
    pointer = write_run(output, f"{MODEL}.json", manifest, prefix, spots)
    resolved = sum(1 for entry in coverage.values() if entry["resolved"])
    print(f"Published {args.hours + 1} Met Office wave steps to {output / (MODEL + '.json')}; "
          f"{resolved} of {len(spots)} spots have wave values", flush=True)
    return pointer


if __name__ == "__main__":
    try:
        # A run the bucket already serves exits UNCHANGED_EXIT, which the worker
        # reads as "nothing new", not as a failure and not as a bundle to validate.
        sys.exit(UNCHANGED_EXIT if main() == UNCHANGED_EXIT else 0)
    except Exception as error:
        print(f"Met Office wave refresh failed: {error}. Last published wave forecast preserved.",
              file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
