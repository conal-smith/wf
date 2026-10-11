"""Download NOAA GFS-Wave arctic 9 km output and publish an Ireland wave snapshot.

Public domain source, no API key. The NOMADS grib filter returns a polar
stereographic sub-block of the 9 km Arctic grid (about 70 KB per step for the
nine published fields); `--source s3` falls back to ranged reads of the
whole-grid messages on noaa-gfs-bdp-pds through their `.idx` sidecar.

ecCodes cannot compute latitudes for this grid — its polar stereographic
iterator only supports a spherical earth, and the files declare WGS84 — so the
geometry is reconstructed with pyproj and checked against the parent lattice
before anything is published. Every published value is model output bilinearly
resampled onto a regular 0.05° display grid; land and unresolved cells are null.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import math
import os
import re
import sys
from urllib.parse import quote, urlencode

import eccodes as ec
import numpy as np
from pyproj import CRS, Transformer

import fetch_gfs
from fetch_gfs import get, index_ranges, run_datetime
from fetch_forecast import ROOT, load_spots, published_in_bucket, sample, spots_file
from registry import UNCHANGED_EXIT
from rundir import write_run
import timing

MODEL = "gfs-wave"
FILTER = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl"
BUCKET = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
SOURCE_URL = "https://polar.ncep.noaa.gov/waves/"
SOURCE_GRID = "arctic.9km"
HOURLY_THROUGH = 120  # GFS-Wave publishes 1-hour steps only this far; 3-hourly beyond.
DEFAULT_HOURS = {3: 240, 1: HOURLY_THROUGH}
MAX_HOURS = 384
MAX_AGE_HOURS = 12  # Four cycles a day, published about 3 h 50 m after run time.
PAUSE = {"nomads": 0.6, "s3": 0.05}

# The regular display grid. Rows run north-to-south, columns west-to-east.
GRID = {"width": 121, "height": 101, "west": -11.0, "east": -5.0, "north": 56.0,
        "south": 51.0, "dx": 0.05, "dy": 0.05, "order": "north-to-south, west-to-east"}
# The filter subregion is a degree larger on every side: the source block is a
# rotated quadrilateral in latitude/longitude, so a matching box would leave the
# display corners outside native coverage.
REQUEST_BOX = (-12.0, 50.0, -4.0, 57.0)  # west, south, east, north

# arctic.9km: 1006 × 1006 cells of 9 km, true at 70°N, centred on the pole.
PARENT_POINTS = 1006
PARENT_CORNER = (35.349744, -45.0)  # First point of the whole grid, from its own header.
SPACING = 9000.0
LAD, LOV = 70.0, 0.0
# NOMADS' filter rewrites a cut-out's corner using NCEP's legacy 6367.47 km
# sphere, so the declared WGS84 shape misses the real lattice by about one cell.
WRITER_RADIUS = 6367470.0

GEOMETRY = ["gridType", "Nx", "Ny", "latitudeOfFirstGridPointInDegrees",
            "longitudeOfFirstGridPointInDegrees", "LaDInDegrees",
            "orientationOfTheGridInDegrees", "DxInMetres", "DyInMetres",
            "projectionCentreFlag", "iScansNegatively", "jScansPositively",
            "jPointsAreConsecutive", "alternativeRowScanning", "shapeOfTheEarth"]
METADATA = ["discipline", "parameterCategory", "parameterNumber", "units",
            "scaledValueOfFirstFixedSurface", "scaleFactorOfFirstFixedSurface",
            "stepType", "stepUnits", "startStep", "endStep", "dataDate", "dataTime",
            "validityDate", "validityTime"]
# Fixed-surface codes: 1 is the ground/water surface, 241 an ordered sequence
# whose scaled value is the wave partition number. Identity is taken from those
# numbers rather than ecCodes' derived `typeOfLevel` name, which this build
# cannot resolve for 241 outside a real NCEP message.
SURFACE, SEQUENCE = 1, 241

# Discipline 10 (oceanography), category 0 (waves).
HEIGHT, PERIOD, DIRECTION = "height", "period", "direction"
VARIABLES = {
    "swh": {"number": 3, "level": (SURFACE, 1), "record": ("HTSGW", "surface"),
            "kind": HEIGHT, "units": "m", "label": "Wave height",
            "description": "Significant height of combined wind waves and swell (HTSGW)"},
    "pp1d": {"number": 11, "level": (SURFACE, 1), "record": ("PERPW", "surface"),
             "kind": PERIOD, "units": "s", "label": "Peak period",
             "description": "Period of the primary (most energetic) wave component (PERPW)"},
    "mwd": {"number": 10, "level": (SURFACE, 1), "record": ("DIRPW", "surface"),
            "kind": DIRECTION, "units": "degrees true",
            "label": "Peak direction",
            "description": "Direction the primary wave component comes FROM (DIRPW)"},
    "shww": {"number": 5, "level": (SURFACE, 1), "record": ("WVHGT", "surface"),
             "kind": HEIGHT, "units": "m", "label": "Wind-wave height",
             "description": "Significant height of the locally generated wind sea (WVHGT)"},
    "mpww": {"number": 6, "level": (SURFACE, 1), "record": ("WVPER", "surface"),
             "kind": PERIOD, "units": "s", "label": "Wind-wave period",
             "description": "Mean period of the locally generated wind sea (WVPER)"},
    "mdww": {"number": 4, "level": (SURFACE, 1), "record": ("WVDIR", "surface"),
             "kind": DIRECTION, "units": "degrees true", "label": "Wind-wave direction",
             "description": "Direction the wind sea comes FROM (WVDIR)"},
    "swell1_h": {"number": 8, "level": (SEQUENCE, 1),
                 "record": ("SWELL", "1 in sequence"), "kind": HEIGHT, "units": "m",
                 "label": "Primary swell height",
                 "description": "Significant height of the first swell partition (SWELL, level 1)"},
    "swell1_p": {"number": 9, "level": (SEQUENCE, 1),
                 "record": ("SWPER", "1 in sequence"), "kind": PERIOD, "units": "s",
                 "label": "Primary swell period",
                 "description": "Mean period of the first swell partition (SWPER, level 1)"},
    "swell1_d": {"number": 7, "level": (SEQUENCE, 1),
                 "record": ("SWDIR", "1 in sequence"), "kind": DIRECTION,
                 "units": "degrees true", "label": "Primary swell direction",
                 "description": "Direction the first swell partition comes FROM (SWDIR, level 1)"},
}
FIELDS = {(entry["number"], *entry["level"]): name for name, entry in VARIABLES.items()}
RECORDS = tuple(entry["record"] for entry in VARIABLES.values())
LIMITS = {HEIGHT: (0.0, 30.0), PERIOD: (0.0, 30.0), DIRECTION: (0.0, 360.0)}


def projection(earth):
    return Transformer.from_crs("EPSG:4326", CRS.from_proj4(
        f"+proj=stere +lat_0=90 +lat_ts={LAD} +lon_0={LOV} {earth} +units=m +no_defs"),
        always_xy=True)


DECLARED = projection("+ellps=WGS84")       # The shape the files declare.
WRITER = projection(f"+R={WRITER_RADIUS:.0f}")  # The shape the filter writes corners with.


def parent_origin():
    """Projected metres of the whole grid's first point, checked for pole centring.

    A 1006 × 1006 grid of 9 km cells centred on the pole puts its first point at
    −(1006 − 1)/2 × 9 km on both axes. The published corner matches that to
    better than a metre on WGS84 and nowhere near it on any sphere, which is how
    we know the declared shape of the earth is the one the grid was built with.
    """
    x, y = DECLARED.transform(PARENT_CORNER[1], PARENT_CORNER[0])
    expected = -(PARENT_POINTS - 1) / 2 * SPACING
    if max(abs(x - expected), abs(y - expected)) > 1.0:
        raise ValueError("arctic.9km is no longer the pole-centred grid this importer decodes")
    return expected


def block_origin(lon, lat, nx, ny):
    """Which cell of the whole grid a sub-block's first point is.

    Recover the integer cell on the sphere the filter writes corners with, then
    place the block on the lattice the file's own shapeOfTheEarth declares.
    Verified against the whole-grid message on 16 September 2026: an Ireland
    cut-out decodes to exactly one parent block, values bit-identical.
    """
    corner = WRITER.transform(PARENT_CORNER[1], PARENT_CORNER[0])
    x, y = WRITER.transform(lon, lat)
    i, j = (x - corner[0]) / SPACING, (y - corner[1]) / SPACING
    origin = (round(i), round(j))
    if max(abs(i - origin[0]), abs(j - origin[1])) > 0.05:
        raise ValueError("Sub-block corner does not sit on the arctic.9km lattice")
    if origin[0] < 0 or origin[1] < 0 or origin[0] + nx > PARENT_POINTS or origin[1] + ny > PARENT_POINTS:
        raise ValueError("Sub-block does not fit inside the arctic.9km grid")
    return origin


def make_layout(handle, spots):
    """Bilinear stencil from the native block onto the display grid, plus spot cells."""
    geometry = {key: ec.codes_get(handle, key) for key in GEOMETRY}
    expected = {"gridType": "polar_stereographic", "LaDInDegrees": LAD,
                "orientationOfTheGridInDegrees": LOV, "DxInMetres": SPACING,
                "DyInMetres": SPACING, "projectionCentreFlag": 0, "shapeOfTheEarth": 5,
                "iScansNegatively": 0, "jScansPositively": 1, "jPointsAreConsecutive": 0,
                "alternativeRowScanning": 0}
    for key, value in expected.items():
        if geometry[key] != value:
            raise ValueError(f"Unsupported GFS-Wave {key}: expected {value}")
    nx, ny = geometry["Nx"], geometry["Ny"]
    if not 2 <= nx <= PARENT_POINTS or not 2 <= ny <= PARENT_POINTS:
        raise ValueError("Implausible GFS-Wave block size")
    lat = geometry["latitudeOfFirstGridPointInDegrees"]
    lon = (geometry["longitudeOfFirstGridPointInDegrees"] + 180) % 360 - 180
    origin = parent_origin()
    i0, j0 = block_origin(lon, lat, nx, ny)
    x0, y0 = origin + i0 * SPACING, origin + j0 * SPACING

    mesh_lon, mesh_lat = np.meshgrid(GRID["west"] + np.arange(GRID["width"]) * GRID["dx"],
                                    GRID["north"] - np.arange(GRID["height"]) * GRID["dy"])
    x, y = DECLARED.transform(mesh_lon.ravel(), mesh_lat.ravel())
    gx, gy = (x - x0) / SPACING, (y - y0) / SPACING
    if np.any((gx < 0) | (gx > nx - 1) | (gy < 0) | (gy > ny - 1)):
        raise ValueError("Display grid is not covered by the downloaded block")
    ix = np.minimum(np.floor(gx).astype(int), nx - 2)
    iy = np.minimum(np.floor(gy).astype(int), ny - 2)
    tx, ty = gx - ix, gy - iy
    index = iy * nx + ix
    # Spot land masking is reported from the 9 km cell the spot sits in, which is
    # what "no wave data here" actually means at this resolution.
    sx, sy = DECLARED.transform([spot["lon"] for spot in spots], [spot["lat"] for spot in spots])
    px = np.rint((np.asarray(sx) - x0) / SPACING).astype(int)
    py = np.rint((np.asarray(sy) - y0) / SPACING).astype(int)
    inside = (px >= 0) & (px < nx) & (py >= 0) & (py < ny)
    return {"signature": tuple(geometry[key] for key in GEOMETRY), "block": (i0, j0),
            "size": (nx, ny), "corners": np.stack([index, index + 1, index + nx, index + nx + 1]),
            "weights": np.stack([(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty]),
            "spotCells": np.where(inside, np.clip(py, 0, ny - 1) * nx + np.clip(px, 0, nx - 1), -1)}


def resample(values, valid, kind, layout):
    """Bilinear onto the display grid; a cell with no water in reach stays null.

    Cells whose four native neighbours are all land are null — never zero. Where
    part of the stencil is land the remaining weights are renormalised, so the
    coastal water the product exists for survives instead of being blanked; that
    also means water values can reach up to one 9 km cell inland. Directions are
    averaged as unit vectors, never as degrees.
    """
    corners, weights = layout["corners"], layout["weights"]
    good = valid[corners]
    share = (weights * good).sum(0)
    resolved = share > 1e-9
    safe = np.where(resolved, share, 1.0)
    if kind == DIRECTION:
        radians = np.radians(np.where(good, values[corners], 0.0))
        east = (weights * good * np.sin(radians)).sum(0) / safe
        north = (weights * good * np.cos(radians)).sum(0) / safe
        output = np.round(np.degrees(np.arctan2(east, north)) % 360, 1) % 360
    else:
        output = np.round((weights * good * np.where(good, values[corners], 0.0)).sum(0) / safe, 2)
    return [float(value) if ok else None for ok, value in zip(resolved, output)]


def validate_metadata(metadata, name, run, hour):
    """GFS-Wave contract: instantaneous discipline-10 wave parameters."""
    entry = VARIABLES[name]
    if metadata["discipline"] != 10 or metadata["parameterCategory"] != 0:
        raise ValueError(f"{name} is not an oceanographic wave parameter")
    if metadata["parameterNumber"] != entry["number"]:
        raise ValueError(f"Wrong GRIB parameter for {name}")
    units = {HEIGHT: ("m",), PERIOD: ("s",), DIRECTION: ("Degree true", "deg")}[entry["kind"]]
    if metadata["units"] not in units:
        raise ValueError(f"Unexpected units for {name}: {metadata['units']}")
    # The swell partition index is the scaled value of the fixed surface, at
    # scale 10^0; anything else is a different product than these keys name.
    if ((metadata["typeOfFirstFixedSurface"], metadata["scaledValueOfFirstFixedSurface"])
            != entry["level"] or metadata["scaleFactorOfFirstFixedSurface"] != 0):
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


@timing.timed("decode")
def decode(path, run, hour, spots, layout=None):
    """Validate every message of one step, then resample it onto the display grid."""
    native, masks = {}, {}
    with path.open("rb") as stream:
        while True:
            handle = ec.codes_grib_new_from_file(stream)
            if handle is None:
                break
            try:
                ec.codes_set(handle, "stepUnits", 1)
                if ec.codes_get(handle, "centre") != "kwbc":
                    raise ValueError("Expected an NCEP (kwbc) GFS-Wave message")
                metadata = {key: ec.codes_get(handle, key) for key in METADATA}
                # Read the surface as its numeric code: ecCodes renders it as a
                # name ('sfc', '241') by default.
                metadata["typeOfFirstFixedSurface"] = ec.codes_get(
                    handle, "typeOfFirstFixedSurface", int)
                name = FIELDS.get((metadata["parameterNumber"],
                                   metadata["typeOfFirstFixedSurface"],
                                   metadata["scaledValueOfFirstFixedSurface"]))
                if name is None or name in native:
                    raise ValueError("Unexpected or duplicate GFS-Wave message")
                validate_metadata(metadata, name, run, hour)
                if layout is None:
                    layout = make_layout(handle, spots)
                elif tuple(ec.codes_get(handle, key) for key in GEOMETRY) != layout["signature"]:
                    raise ValueError("Grid changed within a run")
                values = np.asarray(ec.codes_get_values(handle), dtype=float)
                if values.size != layout["size"][0] * layout["size"][1]:
                    raise ValueError(f"Wrong number of values for {name}")
                # Land, ice and unresolved cells arrive as the file's missing value.
                missing = ec.codes_get(handle, "missingValue")
                masks[name] = np.isfinite(values) & (values != missing)
                native[name] = np.where(masks[name], values, 0.0)
            finally:
                ec.codes_release(handle)
    if set(native) != set(VARIABLES):
        raise ValueError("Missing GFS-Wave parameter")
    for name, entry in VARIABLES.items():
        water = native[name][masks[name]]
        low, high = LIMITS[entry["kind"]]
        if water.size == 0:
            raise ValueError(f"No water at all in the {name} field")
        if np.any(water < low) or np.any(water > high) or (entry["kind"] == PERIOD and np.any(water <= 0)):
            raise ValueError(f"Implausible {name} value")
    fields = {name: resample(native[name], masks[name], entry["kind"], layout)
              for name, entry in VARIABLES.items()}
    cells = layout["spotCells"]
    land = {spot["id"]: bool(cells[index] < 0 or not masks["swh"][cells[index]])
            for index, spot in enumerate(spots)}
    return fields, layout, land


def sample_wave(grid, values, lon, lat):
    """The shared bilinear sampler, made null-safe: no water in reach, no value."""
    x = (lon - grid["west"]) / grid["dx"]
    y = (grid["north"] - lat) / grid["dy"]
    if not (0 <= x <= grid["width"] - 1 and 0 <= y <= grid["height"] - 1):
        return None
    x0 = min(math.floor(x), grid["width"] - 2)
    y0 = min(math.floor(y), grid["height"] - 2)
    index = y0 * grid["width"] + x0
    if any(values[corner] is None for corner in
           (index, index + 1, index + grid["width"], index + grid["width"] + 1)):
        return None
    return sample(grid, values, lon, lat)


def filter_url(run, hour):
    west, south, east, north = REQUEST_BOX
    query = [("dir", f"/gfs.{run[:8]}/{run[-2:]}/wave/gridded"),
             ("file", f"gfswave.t{run[-2:]}z.{SOURCE_GRID}.f{hour:03d}.grib2")]
    query += [(f"var_{name}", "on") for name in dict.fromkeys(name for name, _ in RECORDS)]
    query += [("lev_surface", "on"), ("lev_1_in_sequence", "on"),
              ("subregion", ""), ("leftlon", west), ("rightlon", east),
              ("toplat", north), ("bottomlat", south)]
    return FILTER + "?" + urlencode(query)


def object_key(run, hour):
    return (f"gfs.{run[:8]}/{run[-2:]}/wave/gridded/"
            f"gfswave.t{run[-2:]}z.{SOURCE_GRID}.f{hour:03d}.grib2")


def download(source, run, hour):
    if source == "nomads":
        return get(filter_url(run, hour))
    key = object_key(run, hour)
    text = get(f"{BUCKET}/{key}.idx").decode()
    # Whole-grid messages: the fallback trades roughly 3.5 MB a step for not
    # depending on the filter service, and needs no corner reconstruction.
    return b"".join(get(f"{BUCKET}/{key}", headers={"Range": f"bytes={start}-{end}"})
                    for start, end in index_ranges(text, hour, RECORDS))


def inventory(source, run):
    """Forecast hours the provider actually lists for a run. No release-time guesses."""
    pattern = rf"gfswave\.t{run[-2:]}z\.{re.escape(SOURCE_GRID)}\.f(\d{{3}})\.grib2"
    if source == "s3":
        prefix = f"gfs.{run[:8]}/{run[-2:]}/wave/gridded/gfswave.t{run[-2:]}z.{SOURCE_GRID}."
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
        raise RuntimeError("Unexpectedly long GFS-Wave object listing")
    page = get(f"{FILTER}?dir=%2Fgfs.{run[:8]}%2F{run[-2:]}%2Fwave%2Fgridded").decode("utf-8", "replace")
    return {int(value) for value in re.findall(pattern, page)}


def candidates(requested_run, now):
    if requested_run:
        return [requested_run]
    latest = now.replace(minute=0, second=0, microsecond=0, hour=now.hour // 6 * 6)
    # Only cycles that can still pass the freshness check are worth listing.
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
        print(f"Skipping incomplete GFS-Wave {run}: {len(set(hours) - available)} step(s) missing",
              flush=True)
    raise RuntimeError("No complete requested GFS-Wave run is available. "
                       "Existing forecast has not been changed.")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, help=f"3–{MAX_HOURS}, divisible by --step; "
                        f"default {DEFAULT_HOURS[3]} at 3-hour steps, {DEFAULT_HOURS[1]} hourly")
    parser.add_argument("--step", type=int, choices=[1, 3], default=3)
    parser.add_argument("--run", help="Optional specific YYYYMMDDHH run (00/06/12/18)")
    parser.add_argument("--source", choices=["nomads", "s3"], default="nomads",
                        help="NOMADS subregion filter, or ranged whole-grid reads from NOAA's S3 mirror")
    args = parser.parse_args(argv)
    if args.hours is None:
        args.hours = DEFAULT_HOURS[args.step]
    if not 3 <= args.hours <= MAX_HOURS or args.hours % args.step:
        parser.error(f"Use 3–{MAX_HOURS} hours divisible by the step")
    if args.step == 1 and args.hours > HOURLY_THROUGH:
        parser.error(f"GFS-Wave publishes hourly steps only through +{HOURLY_THROUGH}h; use --step 3")
    return args


def manifest_for(run, run_time, args, series, coverage, layout):
    nx, ny = layout["size"]
    i0, j0 = layout["block"]
    return {
        "schemaVersion": 1, "kind": "wave", "model": MODEL, "modelName": "GFS-Wave",
        "provider": "NOAA NCEP",
        "modelDetail": "WAVEWATCH III global wave model, 9 km Arctic grid",
        "resolutionKm": 9, "resolutionLabel": "9 km polar stereographic",
        "run": run, "runTime": run_time.isoformat().replace("+00:00", "Z"),
        "generatedAt": datetime.now(timezone.utc).isoformat(), "stepHours": args.step,
        "grid": GRID, "variables": {name: {key: entry[key] for key in ("units", "label", "description")}
                                    for name, entry in VARIABLES.items()},
        # No map frames: nothing reads a wave grid yet, and the spot series is the
        # product (docs/TILING_DESIGN.md). The horizon is stated instead.
        "frames": [], "horizonHours": args.hours,
        "spotSeries": series, "spotCoverage": coverage,
        "directionConvention": "Wave directions are the bearing waves travel FROM, in degrees true, "
                               "like the wind direction rows: 270° is a westerly swell running east.",
        "partitionNote": "swh/pp1d/mwd describe the whole spectrum. shww/mpww/mdww are the locally "
                         "generated wind sea and swell1_* the first (most energetic) swell partition; "
                         "the partitions are separate wave trains that arrive together, so their "
                         "heights add in energy, not in metres. Partitions 2 and 3 exist in the source "
                         "and are deliberately not published yet.",
        "processing": (
            f"Source {SOURCE_GRID}: a {PARENT_POINTS} × {PARENT_POINTS} polar stereographic grid of "
            f"{SPACING / 1000:g} km cells, true at {LAD:g}°N, oriented on {LOV:g}°, centred on the pole. "
            f"Only the {nx} × {ny} block at cell ({i0}, {j0}) is downloaded, covering "
            f"{-REQUEST_BOX[0]:g}°W–{-REQUEST_BOX[2]:g}°W / {REQUEST_BOX[1]:g}–{REQUEST_BOX[3]:g}°N. "
            "ecCodes cannot compute coordinates for this grid, so latitudes and longitudes are "
            "reconstructed with pyproj on the WGS84 shape the file declares, checked against the "
            "whole grid's pole-centred lattice, and the cut-out corner is matched back to an integer "
            "parent cell. Values are then bilinearly resampled onto a regular "
            f"{GRID['dx']:g}° × {GRID['dy']:g}° grid, rows north-to-south. A display cell whose four "
            "native neighbours are all land, ice or unresolved is null, never zero; where part of the "
            "stencil is land the remaining weights are renormalised, so water values can extend up to "
            "one 9 km cell inland. Directions are averaged as unit vectors. No hour is interpolated: "
            "only native forecast steps are published."),
        "sourceUrl": SOURCE_URL,
        "sourceFilterUrl": FILTER,
        "attribution": "Wave data: NOAA/NCEP GFS-Wave (WAVEWATCH III), a work of the US Government in "
                       "the public domain. Resampled, cropped and processed by Force5 (wingfoil.ie); "
                       "this is modified NOAA output, not official government material, and NOAA/NWS "
                       "does not endorse Force5.",
        "licenseUrl": "https://www.weather.gov/disclaimer",
    }


def main(argv=None):
    args = parse_args(argv)
    fetch_gfs.THROTTLE.pause = PAUSE[args.source]
    hours = list(range(0, args.hours + 1, args.step))
    timing.start("discover")
    run = discover(args.source, hours, args.run)
    run_time = run_datetime(run)
    age = (datetime.now(timezone.utc) - run_time).total_seconds() / 3600
    if not -1 <= age <= MAX_AGE_HOURS:
        raise ValueError(f"Refusing a stale/future GFS-Wave run (maximum age {MAX_AGE_HOURS} hours)")
    if published_in_bucket(run, args.run):
        print(f"GFS-Wave {SOURCE_GRID} {run} is already published; nothing to download.", flush=True)
        return UNCHANGED_EXIT
    print(f"Fetching GFS-Wave {SOURCE_GRID} {run} from {args.source}: "
          f"{len(hours)} steps through +{args.hours}h", flush=True)
    cache = ROOT / ".cache" / "gfswave" / run
    cache.mkdir(parents=True, exist_ok=True)
    spots = load_spots()
    print(f"Sampling {len(spots)} spots from {spots_file()}", flush=True)

    def fetch(hour):
        path = cache / f"{hour:03d}.grib2"
        # A truncated cache entry must never publish: revalidate before reuse.
        if path.exists():
            try:
                return hour, decode(path, run, hour, spots)
            except Exception:
                print(f"Re-fetching invalid cached frame +{hour:03d}h", flush=True)
        data = download(args.source, run, hour)
        if not data.startswith(b"GRIB"):
            raise ValueError(f"Not a GRIB response for +{hour:03d}h")
        temporary = path.with_suffix(".download")
        temporary.write_bytes(data)
        decoded = decode(temporary, run, hour, spots)
        os.replace(temporary, path)
        print(f"  Validated +{hour:03d}h ({len(data)} bytes)", flush=True)
        return hour, decoded

    # Two concurrent requests at most: NOMADS asks well-behaved clients to stay low.
    timing.start("download", workers=2)
    with ThreadPoolExecutor(max_workers=2) as pool:
        decoded = dict(pool.map(fetch, hours))
    timing.start("decode")
    output = ROOT / "public" / "weather"
    prefix = f"{MODEL}-{run}-{args.hours}h-v1"
    signature = decoded[0][1]["signature"]
    series = {spot["id"]: [] for spot in spots}
    for hour in hours:
        fields, layout, land = decoded[hour]
        if layout["signature"] != signature:
            raise ValueError("GFS-Wave grid changed within the run")
        valid = (run_time + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
        for spot in spots:
            series[spot["id"]].append({"hour": hour, "validTime": valid, "values": {
                name: sample_wave(GRID, values, spot["lon"], spot["lat"])
                for name, values in fields.items()}})
    coverage = {}
    for spot in spots:
        masked = decoded[0][2][spot["id"]]
        resolved = series[spot["id"]][0]["values"]["swh"] is not None
        if not masked:
            note = "This location sits in a resolved 9 km water cell."
        elif resolved:
            note = ("The 9 km cell over this location is land, ice or unresolved; the values come "
                    "from the resolved water next to it, so they describe the nearby open sea "
                    "rather than the shoreline itself.")
        else:
            note = ("The 9 km cell over this location, and every cell reaching it, is land, ice or "
                    "unresolved. This model cannot say anything about waves here.")
        coverage[spot["id"]] = {"landMasked": masked, "resolved": resolved, "note": note}
    manifest = manifest_for(run, run_time, args, series, coverage, decoded[0][1])
    # Only this final operation advances the published snapshot.
    write_run(output, f"{MODEL}.json", manifest, prefix, spots)
    resolved = sum(1 for entry in coverage.values() if entry["resolved"])
    print(f"Published {len(hours)} GFS-Wave steps to {output / (MODEL + '.json')}; "
          f"{resolved} of {len(spots)} spots have wave values", flush=True)


if __name__ == "__main__":
    try:
        # A run that is already published exits UNCHANGED_EXIT, which the worker
        # reads as "nothing new", not as a failure and not as a bundle to validate.
        sys.exit(main() or 0)
    except Exception as error:
        print(f"GFS-Wave refresh failed: {error}. Last published snapshot preserved.", file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
