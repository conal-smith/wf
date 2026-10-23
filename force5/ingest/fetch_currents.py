"""Marine Institute North East Atlantic ROMS surface currents, for the map and every spot.

Public ERDDAP griddap (IMI_NEATL), CC BY 4.0, no account. ROMS is an ocean
circulation model run by the Marine Institute on a 2 km curvilinear grid of the
North East Atlantic, tides included, regridded by them onto a regular 0.0125°
grid (about 1.4 km north-south, 0.8 km east-west here) for ERDDAP. This adapter
does not run it: it asks ERDDAP for server-side subsets of one published run and
republishes an hourly map frame of the surface current over Ireland, decimated,
plus a series per riding location.

Run identity. ERDDAP exposes only the aggregated `time` axis, a week of hindcast
followed by the forecast, and the aggregate carries no model-day attribute. The
Marine Institute writes each day's forecast files (THREDDS
`NEATLANTIC_NATIVE_2KM_40L_1H/FORECAST`, `NEATL_<day>01_FC.nc` to
`NEATL_<day+3>00_FC.nc`) shortly after 00:35 UTC that day, so the axis always ends
72 h after the model day's 00 UTC. `run` is that hour: the axis end less 72 h,
which must fall on 00 UTC or the layout has changed and nothing is published.

What the model can and cannot say. At 1-2 km the model gets the timing and the
direction of the tidal streams right in open water and in wide sounds, but it
cannot resolve a narrow channel: Strangford Narrows is land in this grid, and a
harbour mouth is one or two cells. The map adds per-spot tidal stream curves for
such places (force5/src/tidalStreams.ts); this bundle is only the model.

Nearest grid point. A riding location's own cell is often land, so each spot
takes the closest cell with water within SEARCH_KM, and records the offset; one
with none in range (an inland lake) is published as nulls with a stated reason.

The Marine Institute says its forecasts must not be used for safety-critical
decisions, and neither may this: the manifest says so, and the map repeats it.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timedelta, timezone
import io
import math
import os
from pathlib import Path
import sys
import threading
import time
from urllib.parse import quote

import requests

from fetch_forecast import ROOT, load_spots, published_in_bucket, write_json
# The tide adapter already reads this ERDDAP's CSV dialect; share its helpers.
from fetch_tides import distance_km, moment, rows as erddap_rows, stamp
from registry import UNCHANGED_EXIT
from rundir import frame_name, write_run
from squares import SPOT_KEYS
import timing

MODEL = "currents"
ERDDAP = "https://erddap.marine.ie/erddap"
DATASET = "IMI_NEATL"
SOURCE_URL = f"{ERDDAP}/info/{DATASET}/index.html"
ATTRIBUTION = ("Currents © Marine Institute, CC BY 4.0. "
               "A rough guide: not for safety-critical use.")
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
USER_AGENT = "Force5/0.1 (wingfoil.ie prototype)"
TIMEOUT = (15, 120)
ATTEMPTS = 3
CONCURRENCY = 2  # Be a polite guest on a public research service.
FORECAST_HOURS = 72  # The model day's 00 UTC to three days on.
# Our key -> the ERDDAP variable name.
SOURCE_VARIABLES = {"u": "sea_surface_x_velocity", "v": "sea_surface_y_velocity"}
# A surface current faster than this is a broken field, not a reading: the
# fastest tidal streams round Ireland, in channels this grid cannot resolve, are
# about 4 m/s.
MAX_SPEED_MS = 6.0
VARIABLES = {
    "u": {"units": "m/s", "label": "Current, east",
          "description": "Eastward component of the surface current: the velocity the water "
                         "moves with, positive towards the east."},
    "v": {"units": "m/s", "label": "Current, north",
          "description": "Northward component of the surface current: the velocity the water "
                         "moves with, positive towards the north."},
}
# Frames cover Ireland and its approaches, every FRAME_STRIDE-th cell of the
# source grid: 0.05°, about 5.6 km north-south and 3.3 km east-west. That is a
# map's worth of arrows at any zoom (the map thins them further), and a frame
# of 121 x 101 cells is about 200 kB of JSON before compression.
FRAME_BOX = (-11.0, 51.0, -5.0, 56.0)  # west, south, east, north
FRAME_STRIDE = 4
SEARCH_KM = 5.0
INFO_COLUMNS = ["Row Type", "Variable Name", "Attribute Name", "Data Type", "Value"]
SESSION = timing.count_responses(requests.Session())


def griddap(query, extension="csv"):
    return f"{ERDDAP}/griddap/{DATASET}.{extension}?" + quote(query, safe="(),:-.[]")


def fetch(url, cache=None):
    """Cached, retried GET. A cached raw response is reused for the whole run."""
    if cache is not None and cache.exists() and cache.stat().st_size:
        return cache.read_text()
    for attempt in range(ATTEMPTS):
        try:
            response = SESSION.get(url, timeout=TIMEOUT, headers={"User-Agent": USER_AGENT})
            response.raise_for_status()
            text = response.text
            break
        except Exception:
            if attempt == ATTEMPTS - 1:
                raise
            time.sleep(2 ** attempt)
    if cache is not None:
        cache.parent.mkdir(parents=True, exist_ok=True)
        temporary = cache.with_suffix(f"{cache.suffix}.{threading.get_ident()}.tmp")
        temporary.write_text(text)
        os.replace(temporary, cache)
    return text


def dataset_info(cache):
    """Global attributes, checked for the licence and the variables we read."""
    text = fetch(f"{ERDDAP}/info/{DATASET}/index.csv", cache / "info.csv")
    reader = csv.reader(io.StringIO(text))
    if next(reader, None) != INFO_COLUMNS:
        raise ValueError(f"Unexpected ERDDAP info columns for {DATASET}")
    attributes, variables = {}, set()
    for row in reader:
        if not row:
            continue
        kind, name, attribute, _, value = row
        if kind == "attribute" and name == "NC_GLOBAL":
            attributes[attribute] = value
        elif kind in ("variable", "dimension"):
            variables.add(name)
    missing = sorted(set(SOURCE_VARIABLES.values()) - variables)
    if missing:
        raise ValueError(f"{DATASET} no longer publishes {', '.join(missing)}")
    if "Creative Commons Attribution 4.0" not in attributes.get("license", ""):
        raise ValueError(f"{DATASET} licence changed: {attributes.get('license')!r}")
    bounds = {key: float(attributes[f"geospatial_{key}"]) for key in
              ("lat_min", "lat_max", "lon_min", "lon_max", "lat_resolution", "lon_resolution")}
    return {"attributes": attributes, "bounds": bounds}


def last_time(cache):
    """The axis itself, not the info page, which ERDDAP may serve from its cache."""
    values = erddap_rows(fetch(griddap("time[last]"), cache / "time-last.csv"), ["time"])
    if len(values) != 1:
        raise ValueError(f"{DATASET} returned {len(values)} last time steps")
    return moment(values[0][0])


def discover(latest, now, forecast_hours=FORECAST_HOURS):
    """`run` is the model day at 00 UTC: the axis end less the forecast's length."""
    run = latest - timedelta(hours=forecast_hours)
    if (run.hour, run.minute, run.second) != (0, 0, 0):
        raise ValueError(f"The {DATASET} axis ends {stamp(latest)}, which is not {forecast_hours} h "
                         "after a model day's 00 UTC: the aggregate is mid-update or its layout "
                         "changed.")
    if run > now:
        raise ValueError(f"The {DATASET} axis ends {stamp(latest)}, so its model day would be "
                         f"{stamp(run)}, in the future: the forecast has grown longer than "
                         f"{forecast_hours} h.")
    return run


def block(start, end, south, north, west, east, stride=1):
    """u and v over one index block, in one request."""
    index = (f"[({stamp(start)}):1:({stamp(end)})]"
             f"[({south:.6f}):{stride}:({north:.6f})][({west:.6f}):{stride}:({east:.6f})]")
    return ",".join(name + index for name in SOURCE_VARIABLES.values())


COLUMNS = ["time", "latitude", "longitude"] + list(SOURCE_VARIABLES.values())


def number(text):
    """Source value in m/s, or None for land; an implausible value fails the run."""
    if text.strip() in ("NaN", "nan", ""):
        return None
    value = float(text)
    if not math.isfinite(value) or abs(value) > MAX_SPEED_MS:
        raise ValueError(f"Implausible surface current component {value} m/s")
    return round(value, 2)


def pair(row):
    """u and v of one row, both or neither: half a vector is no current."""
    u, v = number(row[3]), number(row[4])
    if (u is None) != (v is None):
        raise ValueError(f"Only one current component at {row[1]},{row[2]} at {row[0]}")
    if u is not None and math.hypot(u, v) > MAX_SPEED_MS:
        raise ValueError(f"Implausible surface current {math.hypot(u, v):.2f} m/s at "
                         f"{row[1]},{row[2]}")
    return u, v


def search_box(spot, kilometres, bounds):
    d_lat = kilometres / 111.195
    d_lon = kilometres / (111.195 * max(math.cos(math.radians(spot["lat"])), 0.05))
    south = max(spot["lat"] - d_lat, bounds["lat_min"])
    north = min(spot["lat"] + d_lat, bounds["lat_max"])
    west = max(spot["lon"] - d_lon, bounds["lon_min"])
    east = min(spot["lon"] + d_lon, bounds["lon_max"])
    return None if south > north or west > east else (south, north, west, east)


def nearest_wet(info, spot, run, cache, limit=SEARCH_KM):
    """The closest cell with water to the spot, or None and the reason there is none."""
    extent = search_box(spot, limit, info["bounds"])
    if extent is None:
        return None, f"The {DATASET} model does not cover this location."
    text = fetch(griddap(block(run, run, *extent)), cache / f"mask-{spot['id']}.csv")
    cells = erddap_rows(text, COLUMNS)
    if not cells:
        raise ValueError(f"{DATASET} returned no cells around {spot['id']}")
    best = None
    for row in cells:
        u, _ = pair(row)
        if u is None:
            continue
        lat, lon = float(row[1]), float(row[2])
        kilometres = distance_km(spot["lat"], spot["lon"], lat, lon)
        # The request is a degree box, so its corners reach past the stated radius.
        if kilometres <= limit and (best is None or kilometres < best[0]):
            best = (kilometres, lat, lon)
    if best is None:
        return None, (f"No {DATASET} cell with water within {limit:.0f} km of this location: "
                      "the model says nothing about the water here.")
    return {"lat": round(best[1], 6), "lon": round(best[2], 6), "offsetKm": round(best[0], 2)}, None


def point_series(cell, run, hours, cache):
    """u and v at one cell for every published hour, in one request."""
    query = block(run, run + timedelta(hours=hours), cell["lat"], cell["lat"],
                  cell["lon"], cell["lon"])
    name = f"series-{cell['lat']:.6f}-{cell['lon']:.6f}.csv"
    table = erddap_rows(fetch(griddap(query), cache / name), COLUMNS)
    if len(table) != hours + 1:
        raise ValueError(f"{DATASET} returned {len(table)} of {hours + 1} steps for "
                         f"{cell['lat']},{cell['lon']}")
    series = []
    for hour, row in enumerate(table):
        when = moment(row[0])
        if when != run + timedelta(hours=hour):
            raise ValueError(f"{DATASET} returned {row[0]} where hour {hour} was requested")
        if abs(float(row[1]) - cell["lat"]) > 1e-6 or abs(float(row[2]) - cell["lon"]) > 1e-6:
            raise ValueError(f"{DATASET} returned cell {row[1]},{row[2]}, not "
                             f"{cell['lat']},{cell['lon']}")
        u, v = pair(row)
        series.append({"hour": hour, "validTime": stamp(when), "values": {"u": u, "v": v}})
    return series


def null_series(run, hours):
    return [{"hour": hour, "validTime": stamp(run + timedelta(hours=hour)),
             "values": {key: None for key in VARIABLES}} for hour in range(hours + 1)]


def spot_task(spot, info, run, hours, cache):
    cell, reason = nearest_wet(info, spot, run, cache)
    if cell is None:
        return {"cellLat": None, "cellLon": None, "offsetKm": None, "reason": reason}, \
            null_series(run, hours)
    series = point_series(cell, run, hours, cache)
    if all(step["values"]["u"] is None for step in series):
        raise ValueError(f"{spot['id']}: cell {cell['lat']},{cell['lon']} had water at the run "
                         "hour but is null for the whole published horizon")
    return {"cellLat": cell["lat"], "cellLon": cell["lon"], "offsetKm": cell["offsetKm"]}, series


def frame_axis(bounds, low, high, key, stride=FRAME_STRIDE):
    """Exact source coordinates of every `stride`-th cell from the first inside the edge.

    ERDDAP's stride starts at the first index at or past the requested low edge,
    so these are the coordinates it returns; nothing is resampled."""
    origin, spacing = bounds[f"{key}_min"], bounds[f"{key}_resolution"]
    limit = round((bounds[f"{key}_max"] - origin) / spacing)
    first = math.ceil(round((low - origin) / spacing, 6))
    last = math.floor(round((high - origin) / spacing, 6))
    if not 0 <= first < last <= limit:
        raise ValueError(f"Requested {key} range lies outside the {DATASET} domain")
    return [round(origin + index * spacing, 6) for index in range(first, last + 1, stride)]


def frame_grid(bounds, box=None, stride=FRAME_STRIDE):
    west, south, east, north = box or FRAME_BOX
    longitudes = frame_axis(bounds, west, east, "lon", stride)
    latitudes = frame_axis(bounds, south, north, "lat", stride)
    return {"width": len(longitudes), "height": len(latitudes),
            "west": longitudes[0], "east": longitudes[-1],
            "north": latitudes[-1], "south": latitudes[0],
            "dx": round(bounds["lon_resolution"] * stride, 6),
            "dy": round(bounds["lat_resolution"] * stride, 6),
            "order": "north-to-south, west-to-east",
            "units": "m/s; see the variables map"}, longitudes, latitudes


def frame_fields(run, hour, longitudes, latitudes, cache, stride=FRAME_STRIDE):
    """One request per frame, both components over the published crop."""
    when = run + timedelta(hours=hour)
    text = fetch(griddap(block(when, when, latitudes[0], latitudes[-1], longitudes[0],
                               longitudes[-1], stride)),
                 cache / f"frame-{hour:03d}.csv")
    table = erddap_rows(text, COLUMNS)
    count = len(longitudes) * len(latitudes)
    if len(table) != count:
        raise ValueError(f"Frame {hour} returned {len(table)} of {count} cells")
    fields = {name: [None] * count for name in VARIABLES}
    # Published rows run north-to-south; ERDDAP returns latitude ascending.
    row_of = {value: index for index, value in enumerate(reversed(latitudes))}
    column_of = {value: index for index, value in enumerate(longitudes)}
    for row in table:
        if moment(row[0]) != when:
            raise ValueError(f"Frame {hour} carries time {row[0]}")
        y, x = row_of.get(round(float(row[1]), 6)), column_of.get(round(float(row[2]), 6))
        if y is None or x is None:
            raise ValueError(f"Frame {hour} returned cell {row[1]},{row[2]} outside the crop")
        fields["u"][y * len(longitudes) + x], fields["v"][y * len(longitudes) + x] = pair(row)
    if all(value is None for value in fields["u"]):
        raise ValueError(f"Frame {hour} has no water at all")
    return fields


def describe(hours, grid, records):
    used = [record for record in records.values() if record.get("cellLat") is not None]
    return (
        f"One Marine Institute ROMS run, subset server-side by ERDDAP from {DATASET}, with no "
        f"spatial or temporal interpolation. `run` is the model day at 00 UTC: the end of the "
        f"aggregated time axis less {FORECAST_HOURS} h, which the Marine Institute's daily "
        f"forecast always spans; the week of hindcast before it in the same aggregate is not "
        f"published. Hours 0-{hours} are hourly source steps. u and v are the surface current, "
        f"the velocity the water moves with (towards the east and the north), in m/s rounded "
        f"to 0.01; land is null, never zero. Frames are every {FRAME_STRIDE}th cell of the "
        f"0.0125° grid over {abs(FRAME_BOX[0]):g}-{abs(FRAME_BOX[2]):g}°W / "
        f"{FRAME_BOX[1]:g}-{FRAME_BOX[3]:g}°N ({grid['width']} x {grid['height']} cells), "
        f"picked, not averaged. Each spot series comes from the closest cell with water within "
        f"{SEARCH_KM:g} km, `spotCells.offsetKm` away; {len(used)} of {len(records)} locations "
        f"have one and the rest are nulls with a stated reason. The model resolves open water "
        f"and wide sounds, not a narrow channel or a harbour mouth, where it understates the "
        f"stream badly. A rough guide, not for safety-critical decisions: the Marine Institute "
        f"says its forecasts must not be used for them.")


def build(args, info, run, cache, now):
    hours = args.hours
    spots = load_spots()
    records, series = {}, {}
    timing.start("download", workers=CONCURRENCY)
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        results = {spot["id"]: pool.submit(spot_task, spot, info, run, hours, cache)
                   for spot in spots}
    timing.start("decode")
    for spot in spots:
        records[spot["id"]], series[spot["id"]] = results[spot["id"]].result()
        record = records[spot["id"]]
        if record["cellLat"] is None:
            print(f"  {spot['id']}: no series. {record['reason']}", flush=True)

    output = ROOT / "public" / "weather"
    directory = f"{MODEL}-{run.strftime('%Y%m%d%H')}-{hours}h-v1"
    grid, longitudes, latitudes = frame_grid(info["bounds"])
    timing.start("download", workers=CONCURRENCY)
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        fields = list(pool.map(lambda hour: frame_fields(run, hour, longitudes, latitudes, cache),
                               range(hours + 1)))
    timing.start("decode")
    frames = []
    for hour, values in enumerate(fields):
        when = stamp(run + timedelta(hours=hour))
        frame = {"model": MODEL, "run": run.strftime("%Y%m%d%H"), "hour": hour,
                 "validTime": when, "grid": grid, **values}
        name = frame_name(directory, hour, "json")
        write_json(output / name, frame)
        frames.append({"hour": hour, "validTime": when, "url": f"weather/{name}"})
    print(f"  {len(frames)} frames of {grid['width']} x {grid['height']} cells", flush=True)

    attributes = info["attributes"]
    manifest = {
        "schemaVersion": 1, "kind": "current", "model": MODEL,
        "modelName": "NE Atlantic ROMS", "provider": "Marine Institute",
        "modelDetail": "ROMS ocean model of the North East Atlantic: surface currents, tides "
                       "included",
        "run": run.strftime("%Y%m%d%H"), "runTime": stamp(run), "generatedAt": stamp(now),
        "stepHours": 1, "horizonHours": hours,
        "resolutionKm": 1.4,
        "resolutionLabel": "ROMS's 2 km grid regridded to 0.0125°: about 1.4 km north-south "
                           "and 0.8 km east-west at Irish latitudes; the map's frames take "
                           f"every {FRAME_STRIDE}th cell",
        "directionConvention": "oceanographic: u and v are the velocity the water moves with, "
                               "so the current's bearing is where it flows to",
        "caveat": "A rough guide. At 1-2 km the model has the timing and direction of the "
                  "streams but cannot resolve a narrow channel or a harbour mouth, where the "
                  "stream runs much faster than it says. Not for safety-critical decisions.",
        "sourceTimeRange": {"from": attributes.get("time_coverage_start"),
                            "to": attributes.get("time_coverage_end")},
        "variables": VARIABLES, "frames": frames, "grid": grid,
        "frameVariables": list(VARIABLES), "frameStride": FRAME_STRIDE,
        "spotSeries": series, "spotCells": records,
        "processing": describe(hours, grid, records),
        "source": f"Marine Institute ERDDAP griddap {DATASET}",
        "sourceUrl": SOURCE_URL, "attribution": ATTRIBUTION, "licenseUrl": LICENSE_URL,
    }
    # Only this final atomic write advances the published currents.
    pointer = write_run(output, f"{MODEL}.json", manifest, directory, spots)
    print(f"Published {hours + 1} hours for {len(spots)} locations to "
          f"{output / f'{MODEL}.json'}", flush=True)
    return {**pointer, **{key: manifest[key] for key in SPOT_KEYS if key in manifest}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--hours", type=int, default=FORECAST_HOURS,
                        help=f"Hours to publish from the run hour (default {FORECAST_HOURS})")
    args = parser.parse_args(argv)
    if not 1 <= args.hours <= FORECAST_HOURS:
        parser.error(f"Publish 1-{FORECAST_HOURS} hours")
    now = datetime.now(timezone.utc)
    root = Path(ROOT) / ".cache" / MODEL
    timing.start("discover")
    info = dataset_info(root / "info")
    run = discover(last_time(root / "info"), now)
    # One run a day, checked three times: the run is known from two small ERDDAP
    # requests, before any of the per-spot and frame subsets are asked for.
    if published_in_bucket(run.strftime("%Y%m%d%H")):
        print(f"Marine Institute ROMS run {stamp(run)} is already published; nothing to download.",
              flush=True)
        return UNCHANGED_EXIT
    print(f"Marine Institute ROMS currents run {stamp(run)} (+0..{args.hours} h hourly)",
          flush=True)
    return build(args, info, run, root / run.strftime("%Y%m%d%H"), now)


if __name__ == "__main__":
    try:
        # main() returns the manifest it wrote, or UNCHANGED_EXIT when the run is
        # already published, which the worker reads as "nothing new".
        sys.exit(UNCHANGED_EXIT if main() == UNCHANGED_EXIT else 0)
    except Exception as error:
        print(f"Marine Institute currents refresh failed: {error}. "
              "Last published currents preserved.", file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
