"""Marine Institute Irish Shelf SWAN wave forecast for every riding location.

Public ERDDAP griddap, CC BY 4.0, no account. SWAN is a spectral *wave* model
driven by somebody else's wind; this adapter does not run it. It asks ERDDAP for
server-side subsets of one published run and republishes per-spot series, plus
optional map frames.

Run identity. ERDDAP exposes only the aggregated `time` axis, and that axis holds
a hindcast followed by the forecast, so the axis alone cannot say where the
forecast begins. The dataset's global `date` attribute is the model day and the
axis always ends six days after it, so `run` is that day at 00 UTC: the first
*forecast* hour. Frame and series hours count from there, which is what the
manifest contract requires, and the hindcast hours before it are deliberately not
published. `sourceUpdated` carries the provider's own `history` timestamp, which
states no time zone and is therefore republished verbatim.

Nearest grid point. The shelf grid is 0.025°, about 2.8 km north-south but only
about 1.6 km east-west at Irish latitudes, and every riding location is a beach:
the cell containing it is usually dry. This importer searches the surrounding
cells for the closest wet one and records that offset per spot. It refuses to
borrow a cell farther away than the search limit rather than pretend an open-sea
state belongs to a sheltered lough or an inland lake.
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

ERDDAP = "https://erddap.marine.ie/erddap"
SHELF = "IMI_IRISH_SHELF_SWAN_WAVE"
NEST = "IMI_CONNEMARA_SWAN_WAVE"
SOURCE_URL = f"{ERDDAP}/info/{SHELF}/index.html"
NEST_URL = f"{ERDDAP}/info/{NEST}/index.html"
ATTRIBUTION = ("Wave forecast © Marine Institute, CC BY 4.0. "
               "Best-endeavours, not for safety-critical use.")
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
USER_AGENT = "Force5/0.1 (wingfoil.ie prototype)"
TIMEOUT = (15, 90)
ATTEMPTS = 3
CONCURRENCY = 2  # Be a polite guest on a public research service.
FORECAST_HOURS = 144  # Six days of forecast follow the run hour.
NEST_RESOLUTION_LABEL = "about 200 m (0.00177° latitude by 0.00298° longitude)"
# Our key -> the ERDDAP variable name. `shww` is derived, not published.
SOURCE_VARIABLES = {"swh": "significant_wave_height",
                    "hswe": "sea_surface_swell_wave_significant_height",
                    "mwp": "mean_wave_period_tm02",
                    "pp1d": "peak_wave_period",
                    "mwd": "mean_wave_direction_from",
                    "pwd": "peak_wave_direction_from",
                    "spread": "directional_spread"}
FRAME_VARIABLES = ("swh", "mwp", "mwd")
LIMITS = {"swh": (0.0, 25.0, 2), "hswe": (0.0, 25.0, 2), "shww": (0.0, 25.0, 2),
          "mwp": (0.0, 30.0, 2), "pp1d": (0.0, 40.0, 2), "mwd": (0.0, 360.0, 1),
          "pwd": (0.0, 360.0, 1), "spread": (0.0, 180.0, 1)}
VARIABLES = {
    "swh": {"units": "m", "label": "Wave height",
            "description": "Significant wave height of combined wind sea and swell (SWAN Hs)."},
    "hswe": {"units": "m", "label": "Swell height",
             "description": "Significant wave height of the swell part of the spectrum."},
    "shww": {"units": "m", "label": "Wind-sea height",
             "description": "Derived by Force5 as sqrt(max(0, swh squared minus hswe squared)); "
                            "SWAN publishes the total and swell heights, not a wind-sea height. "
                            "Null whenever either input is null."},
    "mwp": {"units": "s", "label": "Mean period",
            "description": "Mean wave period tm02, the spectral second-moment period."},
    "pp1d": {"units": "s", "label": "Peak period",
             "description": "Peak wave period tps, at the spectral peak."},
    "mwd": {"units": "deg", "label": "Mean direction",
            "description": "Mean wave direction theta0 in the meteorological convention: the "
                           "bearing the waves come from."},
    "pwd": {"units": "deg", "label": "Peak direction",
            "description": "Peak wave direction thetap in the meteorological convention: the "
                           "bearing the waves come from. SWAN reads it off its discrete spectral "
                           "direction bins, so it steps in 10° increments (5°, 15°, 25° and so on) "
                           "and is much coarser than the mean direction."},
    "spread": {"units": "deg", "label": "Directional spread",
               "description": "Directional spreading of the wave spectrum; larger values mean a "
                              "more confused sea."},
}
# Frames cover Ireland and its approaches, not the whole 480 x 280 shelf domain.
FRAME_BOX = (-11.0, 51.0, -5.0, 56.0)  # west, south, east, north
DATASETS = {
    SHELF: {"label": "Irish Shelf SWAN", "searchKm": 8.0},
    # The 200 m nest exists to resolve Galway Bay, so its search stays local.
    NEST: {"label": "Connemara SWAN nest", "searchKm": 2.0},
}
INFO_COLUMNS = ["Row Type", "Variable Name", "Attribute Name", "Data Type", "Value"]
SESSION = timing.count_responses(requests.Session())


def griddap(dataset, query, extension="csv"):
    return f"{ERDDAP}/griddap/{dataset}.{extension}?" + quote(query, safe="(),:-.[]")


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
        # Two spots can share a grid cell, so the scratch name must be per thread.
        temporary = cache.with_suffix(f"{cache.suffix}.{threading.get_ident()}.tmp")
        temporary.write_text(text)
        os.replace(temporary, cache)
    return text


def dataset_info(dataset, cache):
    """Global attributes and variable names. The info page carries no units row."""
    text = fetch(f"{ERDDAP}/info/{dataset}/index.csv", cache / f"{dataset}-info.csv")
    reader = csv.reader(io.StringIO(text))
    if next(reader, None) != INFO_COLUMNS:
        raise ValueError(f"Unexpected ERDDAP info columns for {dataset}")
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
        raise ValueError(f"{dataset} no longer publishes {', '.join(missing)}")
    if "Creative Commons Attribution 4.0" not in attributes.get("license", ""):
        raise ValueError(f"{dataset} licence changed: {attributes.get('license')!r}")
    if attributes.get("Directional_convention") != "meteorological":
        raise ValueError(f"{dataset} changed its direction convention")
    bounds = {key: float(attributes[f"geospatial_{key}"]) for key in
              ("lat_min", "lat_max", "lon_min", "lon_max", "lat_resolution", "lon_resolution")}
    return {"attributes": attributes, "bounds": bounds}


def last_time(dataset, cache):
    """The axis itself, not the info page, which ERDDAP may serve from its cache."""
    values = erddap_rows(fetch(griddap(dataset, "time[last]"),
                               cache / f"{dataset}-time-last.csv"), ["time"])
    if len(values) != 1:
        raise ValueError(f"{dataset} returned {len(values)} last time steps")
    return moment(values[0][0])


def source_updated(history):
    """The provider's own timestamp. No time zone is stated, so none is claimed."""
    parts = history.strip().split()
    try:
        return datetime.strptime(" ".join(parts[:5]).rstrip(":"),
                                 "%a %b %d %H:%M:%S %Y").isoformat()
    except ValueError:
        return None


def discover(info, latest, forecast_hours=FORECAST_HOURS):
    """`run` is the first forecast hour: the model day at 00 UTC."""
    day = info["attributes"].get("date", "")
    if len(day) != 8 or not day.isdigit():
        raise ValueError(f"Unusable Marine Institute model day {day!r}")
    run = datetime.strptime(day, "%Y%m%d").replace(tzinfo=timezone.utc)
    if latest != run + timedelta(hours=forecast_hours):
        raise ValueError(f"Model day {day} does not end {forecast_hours} h later: the axis ends "
                         f"{stamp(latest)}. The aggregate is mid-update or its layout changed.")
    return run


def inside(spot, bounds):
    return (bounds["lat_min"] <= spot["lat"] <= bounds["lat_max"]
            and bounds["lon_min"] <= spot["lon"] <= bounds["lon_max"])


def search_box(spot, kilometres, bounds):
    """A degree box around the spot, clipped to the dataset's own extent."""
    d_lat = kilometres / 111.195
    d_lon = kilometres / (111.195 * max(math.cos(math.radians(spot["lat"])), 0.05))
    south = max(spot["lat"] - d_lat, bounds["lat_min"])
    north = min(spot["lat"] + d_lat, bounds["lat_max"])
    west = max(spot["lon"] - d_lon, bounds["lon_min"])
    east = min(spot["lon"] + d_lon, bounds["lon_max"])
    return None if south > north or west > east else (south, north, west, east)


def block(keys, start, end, stride, south, north, west, east):
    """One full index block per variable; several variables share one request."""
    index = (f"[({stamp(start)}):{stride}:({stamp(end)})]"
             f"[({south:.6f}):1:({north:.6f})][({west:.6f}):1:({east:.6f})]")
    return ",".join(SOURCE_VARIABLES[key] + index for key in keys)


def columns(keys):
    return ["time", "latitude", "longitude"] + [SOURCE_VARIABLES[key] for key in keys]


def missing(text):
    return text.strip() in ("NaN", "nan", "")


def number(text, key):
    """Source value or None; an implausible value is a failure, not a reading."""
    if missing(text):
        return None
    value = float(text)
    low, high, digits = LIMITS[key]
    if not math.isfinite(value) or not low - 0.01 <= value <= high + 0.01:
        raise ValueError(f"Implausible {key} value {value}")
    return round(value, digits)


def nearest_valid(dataset, info, spot, when, cache):
    """Closest wet cell to the spot, or None plus the reason nothing was found."""
    limit = DATASETS[dataset]["searchKm"]
    extent = search_box(spot, limit, info["bounds"])
    if extent is None:
        return None, {"reason": f"{DATASETS[dataset]['label']} does not cover this location."}
    text = fetch(griddap(dataset, block(["swh"], when, when, 1, *extent)),
                 cache / f"{dataset}-mask-{spot['id']}.csv")
    cells = erddap_rows(text, columns(["swh"]))
    if not cells:
        raise ValueError(f"{dataset} returned no cells around {spot['id']}")
    closest, wet = None, None
    for _, latitude, longitude, raw in cells:
        lat, lon = float(latitude), float(longitude)
        kilometres = distance_km(spot["lat"], spot["lon"], lat, lon)
        if closest is None or kilometres < closest[0]:
            closest = (kilometres, not missing(raw))
        # The request is a degree box, so its corners reach past the stated radius.
        if not missing(raw) and kilometres <= limit and (wet is None or kilometres < wet[0]):
            wet = (kilometres, lat, lon)
    searched = {"cellsSearched": len(cells), "searchKm": limit}
    if wet is None:
        return None, {**searched, "reason": f"No wet {DATASETS[dataset]['label']} cell within "
                                           f"{limit:.0f} km of this location."}
    return ({"dataset": dataset, "lat": round(wet[1], 6), "lon": round(wet[2], 6),
             "offsetKm": round(wet[0], 2)},
            # neighbourSearch is true when the cell containing the spot is dry.
            {**searched, "offsetKm": round(wet[0], 2), "neighbourSearch": not closest[1]})


def wind_sea(swh, hswe):
    """Derived, not published: what is left after removing the swell energy."""
    if swh is None or hswe is None:
        return None
    return round(math.sqrt(max(0.0, swh * swh - hswe * hswe)), 2)


def point_series(dataset, point, run, hours, step, cache):
    """Every declared variable for one grid cell, one request, source steps only."""
    query = block(SOURCE_VARIABLES, run, run + timedelta(hours=hours), step,
                  point["lat"], point["lat"], point["lon"], point["lon"])
    name = f"{dataset}-series-{point['lat']:.6f}-{point['lon']:.6f}-{step}h.csv"
    table = erddap_rows(fetch(griddap(dataset, query), cache / name), columns(SOURCE_VARIABLES))
    expected = list(range(0, hours + 1, step))
    if len(table) != len(expected):
        raise ValueError(f"{dataset} returned {len(table)} of {len(expected)} steps for "
                         f"{point['lat']},{point['lon']}")
    series = []
    for hour, row in zip(expected, table):
        when = moment(row[0])
        if when != run + timedelta(hours=hour):
            raise ValueError(f"{dataset} returned {row[0]} where hour {hour} was requested")
        if abs(float(row[1]) - point["lat"]) > 1e-6 or abs(float(row[2]) - point["lon"]) > 1e-6:
            raise ValueError(f"{dataset} returned cell {row[1]},{row[2]}, not "
                             f"{point['lat']},{point['lon']}")
        values = {key: number(row[3 + index], key)
                  for index, key in enumerate(SOURCE_VARIABLES)}
        values["shww"] = wind_sea(values["swh"], values["hswe"])
        series.append({"hour": hour, "validTime": stamp(when), "values": values})
    return series


def null_series(run, hours, step):
    return [{"hour": hour, "validTime": stamp(run + timedelta(hours=hour)),
             "values": {key: None for key in VARIABLES}}
            for hour in range(0, hours + 1, step)]


def mean_difference(one, other):
    """Mean absolute wave-height difference between two series for the same spot."""
    differences = [abs(a["values"]["swh"] - b["values"]["swh"]) for a, b in zip(one, other)
                   if a["values"]["swh"] is not None and b["values"]["swh"] is not None]
    return round(sum(differences) / len(differences), 3) if differences else None


def spot_task(spot, infos, run, hours, step, cache):
    """One spot: take the dataset whose nearest wet cell is closest, nest first."""
    record, candidates = {"lat": spot["lat"], "lon": spot["lon"], "searched": {}}, []
    order = [NEST] if NEST in infos and inside(spot, infos[NEST]["bounds"]) else []
    for dataset in order + [SHELF]:
        point, meta = nearest_valid(dataset, infos[dataset], spot, run, cache)
        record["searched"][dataset] = {k: v for k, v in meta.items() if k != "neighbourSearch"}
        if point:
            candidates.append((point, meta))
    if not candidates:
        reasons = sorted({found.get("reason", "") for found in record["searched"].values()})
        record.update({"dataset": None, "nearestOffsetKm": None, "neighbourSearch": False,
                       "nest": False, "reason": " ".join(filter(None, reasons))
                       or "No wave grid cell near this location."})
        return record, null_series(run, hours, step)
    # The nest is listed first, so an equal offset keeps the 200 m grid.
    point, meta = min(candidates, key=lambda item: item[0]["offsetKm"])
    series = point_series(point["dataset"], point, run, hours, step, cache)
    if all(entry["values"]["swh"] is None for entry in series):
        raise ValueError(f"{spot['id']}: cell {point['lat']},{point['lon']} had a value at the run "
                         "hour but is null for the whole published horizon")
    record.update({"dataset": point["dataset"], "cellLat": point["lat"], "cellLon": point["lon"],
                   "nearestOffsetKm": point["offsetKm"],
                   "neighbourSearch": meta["neighbourSearch"], "nest": point["dataset"] == NEST})
    others = [item for item in candidates if item[0] is not point]
    if others:
        other = others[0][0]
        record["comparedWith"] = {
            "dataset": other["dataset"], "offsetKm": other["offsetKm"],
            "meanAbsSwhDifferenceM": mean_difference(
                series, point_series(other["dataset"], other, run, hours, step, cache))}
    return record, series


def frame_axis(bounds, low, high, key):
    """Exact source coordinates inside a requested edge; nothing is resampled."""
    origin, spacing = bounds[f"{key}_min"], bounds[f"{key}_resolution"]
    limit = round((bounds[f"{key}_max"] - origin) / spacing)
    first = math.ceil(round((low - origin) / spacing, 6))
    last = math.floor(round((high - origin) / spacing, 6))
    if not 0 <= first < last <= limit:
        raise ValueError(f"Requested {key} range lies outside the SWAN domain")
    return [round(origin + index * spacing, 6) for index in range(first, last + 1)]


def frame_grid(bounds):
    west, south, east, north = FRAME_BOX
    longitudes = frame_axis(bounds, west, east, "lon")
    latitudes = frame_axis(bounds, south, north, "lat")
    return {"width": len(longitudes), "height": len(latitudes),
            "west": longitudes[0], "east": longitudes[-1],
            "north": latitudes[-1], "south": latitudes[0],
            "dx": round(bounds["lon_resolution"], 6), "dy": round(bounds["lat_resolution"], 6),
            "order": "north-to-south, west-to-east",
            "units": "per variable; see the variables map"}, longitudes, latitudes


def frame_fields(dataset, run, hour, longitudes, latitudes, cache):
    """One request per frame for the frame variables over the published crop."""
    when = run + timedelta(hours=hour)
    text = fetch(griddap(dataset, block(FRAME_VARIABLES, when, when, 1, latitudes[0],
                                        latitudes[-1], longitudes[0], longitudes[-1])),
                 cache / f"{dataset}-frame-{hour:03d}.csv")
    table = erddap_rows(text, columns(FRAME_VARIABLES))
    count = len(longitudes) * len(latitudes)
    if len(table) != count:
        raise ValueError(f"Frame {hour} returned {len(table)} of {count} cells")
    fields = {name: [None] * count for name in FRAME_VARIABLES}
    # Published rows run north-to-south; ERDDAP returns latitude ascending.
    row_of = {value: index for index, value in enumerate(reversed(latitudes))}
    column_of = {value: index for index, value in enumerate(longitudes)}
    for row in table:
        if moment(row[0]) != when:
            raise ValueError(f"Frame {hour} carries time {row[0]}")
        y, x = row_of.get(round(float(row[1]), 6)), column_of.get(round(float(row[2]), 6))
        if y is None or x is None:
            raise ValueError(f"Frame {hour} returned cell {row[1]},{row[2]} outside the crop")
        for index, name in enumerate(FRAME_VARIABLES):
            fields[name][y * len(longitudes) + x] = number(row[3 + index], name)
    return fields


def describe(step, hours, framed, spots):
    used = [record for record in spots.values() if record.get("dataset")]
    nested = sum(1 for record in used if record.get("nest"))
    searched = sum(1 for record in used if record.get("neighbourSearch"))
    return (
        f"One Marine Institute SWAN run, subset server-side by ERDDAP, with no spatial or temporal "
        f"interpolation anywhere. `run` is the model day at 00 UTC, the first forecast hour: it "
        f"comes from the dataset's `date` attribute and is cross-checked against the end of the "
        f"aggregated time axis, which always lies {FORECAST_HOURS} h later. Hours 0-{hours} at "
        f"{step}-hour steps are all source time steps; the roughly eight days of hindcast that "
        f"precede the run hour in the same aggregate are not published. Each spot series comes from "
        f"the nearest wet grid cell: {searched} of {len(spots)} locations sit on a dry cell and use "
        f"a neighbour, {nested} use the 200 m Connemara nest in preference to the 0.025° shelf grid, "
        f"and {len(spots) - len(used)} have no wet cell within the search limit and are published as "
        f"nulls with a stated reason. `nearestOffsetKm` is the distance from the location to the "
        f"cell actually used. `shww` is derived by Force5 from the published total and swell "
        f"heights; every other value is source output, rounded only. Land and unresolved cells are "
        f"null, never zero. "
        + (f"Frames are the {abs(FRAME_BOX[0])}-{abs(FRAME_BOX[2])}°W / {FRAME_BOX[1]}-"
           f"{FRAME_BOX[3]}°N crop of the shelf grid at native resolution, carrying "
           f"{', '.join(FRAME_VARIABLES)}."
           if framed else "No map frames are published in this run: the spot series is the product "
                          "and the full grid is far larger than the site needs."))


def build(args, infos, run, cache, now):
    hours = list(range(0, args.hours + 1, args.step))
    series, records = {}, {}
    spots = load_spots()
    # Each spot's task searches, downloads and reads its own series, so this stage
    # is the download and the per-spot decode together.
    timing.start("download", workers=CONCURRENCY)
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        results = {spot["id"]: pool.submit(spot_task, spot, infos, run, args.hours, args.step,
                                           cache) for spot in spots}
    timing.start("decode")
    for spot in spots:
        records[spot["id"]], series[spot["id"]] = results[spot["id"]].result()
        record = records[spot["id"]]
        if record["dataset"]:
            print(f"  {spot['id']}: {DATASETS[record['dataset']]['label']} cell "
                  f"{record['cellLat']},{record['cellLon']} at {record['nearestOffsetKm']} km"
                  + (" (neighbour search)" if record["neighbourSearch"] else ""), flush=True)
        else:
            print(f"  {spot['id']}: no series. {record['reason']}", flush=True)

    grid, frames = None, []
    output = ROOT / "public" / "weather"
    # The run directory, framed or not: the spot squares are written into it too.
    directory = f"mi-swan-{run.strftime('%Y%m%d%H')}-{args.hours}h-v1"
    if args.frames:
        grid, longitudes, latitudes = frame_grid(infos[SHELF]["bounds"])
        timing.start("download", workers=CONCURRENCY)
        with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
            fields = list(pool.map(lambda hour: frame_fields(SHELF, run, hour, longitudes,
                                                            latitudes, cache), hours))
        timing.start("decode")
        for hour, values in zip(hours, fields):
            when = stamp(run + timedelta(hours=hour))
            frame = {"model": "mi-swan", "run": run.strftime("%Y%m%d%H"), "hour": hour,
                     "validTime": when, "grid": grid, **values}
            name = frame_name(directory, hour, "json")
            write_json(output / name, frame)
            frames.append({"hour": hour, "validTime": when, "url": f"weather/{name}"})
        print(f"  {len(frames)} frames of {grid['width']} x {grid['height']} cells", flush=True)

    attributes = infos[SHELF]["attributes"]
    manifest = {
        "schemaVersion": 1, "kind": "wave", "model": "mi-swan",
        "modelName": "Irish Shelf SWAN", "provider": "Marine Institute",
        "modelDetail": "SWAN third-generation spectral wave model, Irish Shelf domain",
        "run": run.strftime("%Y%m%d%H"), "runTime": stamp(run), "generatedAt": stamp(now),
        "stepHours": args.step, "horizonHours": args.hours,
        "resolutionKm": 2.8,
        "resolutionLabel": "0.025° regular grid: about 2.8 km north-south and about 1.6 km "
                           "east-west at Irish latitudes",
        "nest": None if NEST not in infos else {
            "dataset": NEST, "name": "Connemara SWAN nest", "resolutionKm": 0.2,
            "resolutionLabel": NEST_RESOLUTION_LABEL,
            "bounds": {"west": infos[NEST]["bounds"]["lon_min"],
                       "east": infos[NEST]["bounds"]["lon_max"],
                       "south": infos[NEST]["bounds"]["lat_min"],
                       "north": infos[NEST]["bounds"]["lat_max"]},
            "sourceUrl": NEST_URL,
            "note": "Used for the Galway Bay locations inside it, in preference to the shelf grid "
                    "whenever its nearest wet cell is at least as close."},
        "directionConvention": "meteorological: the bearing the waves come from",
        "sourceDate": attributes.get("date"),
        "sourceUpdated": source_updated(attributes.get("history", "")),
        "sourceUpdatedNote": "The provider's own `history` timestamp. ERDDAP states no time zone "
                             "for it, so none is assumed: it is neither the run hour nor UTC.",
        "sourceHistory": attributes.get("history"),
        "sourceTimeRange": {"from": attributes.get("time_coverage_start"),
                            "to": attributes.get("time_coverage_end")},
        "variables": VARIABLES, "frames": frames, "spotSeries": series, "spotCells": records,
        "processing": describe(args.step, args.hours, bool(frames), records),
        "source": f"Marine Institute ERDDAP griddap {SHELF}"
                  + (f" and {NEST}" if NEST in infos else ""),
        "sourceUrl": SOURCE_URL, "attribution": ATTRIBUTION, "licenseUrl": LICENSE_URL,
    }
    if grid is not None:
        # Frames carry fewer fields than the spot series: a map needs height, period
        # and direction, and tripling the grid for the rest would not earn its bytes.
        manifest["grid"] = grid
        manifest["frameVariables"] = list(FRAME_VARIABLES)
    # Only this final atomic write advances the published wave forecast.
    pointer = write_run(output, "mi-swan.json", manifest, directory, spots)
    print(f"Published {len(hours)} steps for {len(spots)} locations to "
          f"{output / 'mi-swan.json'}", flush=True)
    # What a reader of the published run sees: the pointer, with its squares merged in.
    return {**pointer, **{key: manifest[key] for key in SPOT_KEYS if key in manifest}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, default=FORECAST_HOURS,
                        help="Forecast horizon to publish from the run hour (default 144)")
    parser.add_argument("--step", type=int, choices=[1, 3], default=1,
                        help="Source cadence to publish; SWAN is hourly (default 1)")
    parser.add_argument("--frames", action="store_true",
                        help="Also publish map frames; off by default because the grid is large")
    parser.add_argument("--no-nest", action="store_true",
                        help="Ignore the 200 m Connemara nest and use the shelf grid everywhere")
    args = parser.parse_args(argv)
    if not 1 <= args.hours <= FORECAST_HOURS or args.hours % args.step:
        parser.error(f"Publish 1-{FORECAST_HOURS} hours as a whole number of {args.step}-hour steps")
    if args.frames and args.step == 1:
        print("Warning: hourly frames over the Ireland crop are roughly 0.9 MB each; "
              "--step 3 is the intended combination with --frames.", file=sys.stderr)
    now = datetime.now(timezone.utc)
    root = Path(ROOT) / ".cache" / "mi-swan"
    datasets = [SHELF] if args.no_nest else [SHELF, NEST]
    timing.start("discover")
    infos = {dataset: dataset_info(dataset, root / "info") for dataset in datasets}
    run = discover(infos[SHELF], last_time(SHELF, root / "info"))
    if NEST in infos and discover(infos[NEST], last_time(NEST, root / "info")) != run:
        raise ValueError("The Connemara nest is on a different model day than the shelf run")
    # One run a day, checked three times: the run is known from two small ERDDAP
    # requests, before any of the per-spot and frame subsets are asked for.
    if published_in_bucket(run.strftime("%Y%m%d%H")):
        print(f"Marine Institute SWAN run {stamp(run)} is already published; "
              "nothing to download.", flush=True)
        return UNCHANGED_EXIT
    print(f"Marine Institute SWAN run {stamp(run)} (+0..{args.hours} h at {args.step} h steps)",
          flush=True)
    return build(args, infos, run, root / run.strftime("%Y%m%d%H"), now)


if __name__ == "__main__":
    try:
        # main() returns the manifest it wrote, or UNCHANGED_EXIT when the run is
        # already published, which the worker reads as "nothing new", not as a
        # failure and not as a bundle to validate.
        sys.exit(UNCHANGED_EXIT if main() == UNCHANGED_EXIT else 0)
    except Exception as error:
        print(f"Marine Institute SWAN refresh failed: {error}. "
              "Last published wave forecast preserved.", file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
