"""Copernicus Marine IBI wave forecast (Météo-France MFWAM) for every riding location.

IBI_ANALYSISFORECAST_WAV_005_005, the Iberia-Biscay-Ireland wave analysis and
forecast: MFWAM, Météo-France's spectral wave model, on a regular 1/36° grid
(0.0278°, about 3.1 km north-south and 1.8 km east-west here) from 26°N to 56°N
and 19°W to 5°E, hourly, ten days ahead. Free under the Copernicus Marine
licence, which allows derived products for any purpose with a credit and the
product's DOI. This adapter does not run the model; it reads per-spot series out
of the published run and republishes them, with no map frames.

How it is read. The Marine Data Store is public over HTTPS: its STAC catalogue
names the dataset's versions and stores, its S3 bucket lists the day files, and
its ARCO stores are consolidated zarr. That is what the Copernicus Marine Toolbox
reads too, unsigned; the toolbox would add about 330 MB of the image (xarray,
dask, pandas, pyarrow) and 400 MB to the job, so this reads the same objects
with requests and numcodecs instead, and needs no account. The version is the
toolbox's default one: the newest released and not retired (202411 retires on
12 January 2027 in favour of 202611, released 24 November 2026), so a version
change needs no code change.

How a run is published. One run a day, labelled by its first forecast day R,
lands in two halves: days R to R+4 at about 11:30-13:30 UTC on day R, and days
R+5 to R+9 at about 00:10-02:00 UTC on day R+1. Each half overwrites the days the
day before's run had written. The service keeps one file per day, named for the
run it came from (`..._20261104_20261104_R20261104_FC01.nc`), and the ARCO stores
are rebuilt from those files minutes later. So between the two
halves the aggregate is a mixture: the first five days of the new run and the
last four of yesterday's. This adapter publishes only a whole run. It lists the
day files, takes the newest run all ten of whose days are its own, and refuses
otherwise: from the second half's landing to the next day's first half (about
02:00 to 11:30 UTC) the newest run is whole, and that is when the job runs.

Run identity. `run` is day R at 00 UTC, the first forecast hour (FC01 begins
there); hours 0-239 follow hourly. The day files say which run each day is
from, and the catalogue's `admp_updated_data` for the dataset must be no older
than the newest of the run's files, with no update in progress and unchanged
from before the read to after it, so the values read are the run the files name
and not a store half rewritten.

Reading only what is needed. The ARCO time-series store is chunked as 16 x 16
cells by 3,408 hours (3,264 in version 202611). Each spot's cell is chosen first, from the model's
land-sea mask; then each 16 x 16 tile holding a chosen cell is read once, every
variable of it, for the run's 240 hours, and every spot in that tile takes its
cell from it. Whole files (about 220 MB a day) are never downloaded.

Nearest grid point. Every riding location is a beach, and the cell containing it
is usually land, or water on the coastline. The series is read at the nearest
open-water cell (sea, and sea on all four sides) within SEARCH_KM, or failing
that the nearest sea cell; one with neither in range (an inland lake) is
published as nulls with a stated reason. `spotCoverage` records the cell, its
offset and its depth.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import itertools
import json
import math
import re
import sys
import time
from urllib.parse import urlencode
from xml.etree import ElementTree

import numcodecs
import numpy as np
import requests

from fetch_forecast import ROOT, load_spots, published_in_bucket
from fetch_tides import distance_km, stamp
from registry import MODELS, UNCHANGED_EXIT
from rundir import write_run
from squares import SPOT_KEYS
import timing

MODEL = "ibi-wave"
PRODUCT = "IBI_ANALYSISFORECAST_WAV_005_005"
DATASET = "cmems_mod_ibi_wav_anfc_0.027deg_PT1H-i"
STATIC = "cmems_mod_ibi_wav_anfc_0.027deg_static"
DOI = "https://doi.org/10.48670/moi-00025"
SOURCE_URL = f"https://data.marine.copernicus.eu/product/{PRODUCT}/description"
LICENSE_URL = "https://marine.copernicus.eu/user-corner/service-commitments-and-licence"
# Where the Marine Data Store says its catalogue is, as the Copernicus Marine
# Toolbox reads it.
CLIENTS_CONFIG = "https://stac.marine.copernicus.eu/clients-config-v1"
USER_AGENT = "Force5/0.1 (wingfoil.ie)"
TIMEOUT = (15, 90)
ATTEMPTS = 3
SESSION = timing.count_responses(requests.Session())
# The Copernicus Marine licence (section 2.4a) asks a derived product for exactly
# this credit, with the product's DOI, wherever the product is reached.
CREDIT = f"Generated using E.U. Copernicus Marine Service Information; {DOI}"
ATTRIBUTION = (f"{CREDIT}. Wave forecast from Météo-France's MFWAM model, read at the "
               "nearest open-water cell to each beach and published by Force5. Copernicus "
               "Marine gives no warranty of its quality or suitability for any purpose.")
FORECAST_DAYS = 10
HOURS = FORECAST_DAYS * 24 - 1  # The last forecast hour: day R+9 at 23 UTC.
# The served run is about 26 h old when it lands (the second half is due by 02:00
# UTC on R+1, read at 02:30) and is replaced a day later: registry.py's limit.
MAX_AGE_HOURS = MODELS[MODEL]["maxAgeHours"]
SEARCH_KM = 8.0
# The ARCO time-series store's tile, in cells; a read box is aligned to it so that
# every chunk is fetched once. Checked against the store's own chunking.
TILE = 16
# Ireland and its approaches, wide enough for every riding location's search.
BOX_PAD_DEGREES = 0.2
RESOLUTION_LABEL = ("1/36° regular grid (0.0278°): about 3.1 km north-south and about "
                    "1.8 km east-west at Irish latitudes")

HEIGHT, PERIOD, DIRECTION = "height", "period", "direction"
LIMITS = {HEIGHT: (0.0, 30.0, 2), PERIOD: (0.0, 40.0, 2), DIRECTION: (0.0, 360.0, 1)}
# Our names, as GFS-Wave and SWAN publish them (force5/src/waves.ts reads them),
# for the source's own.
VARIABLES = {
    "swh": {"source": "VHM0", "kind": HEIGHT, "units": "m", "label": "Wave height",
            "description": "Spectral significant height of the whole sea, wind sea and "
                           "swell together (VHM0)."},
    "pp1d": {"source": "VTPK", "kind": PERIOD, "units": "s", "label": "Peak period",
             "description": "Period at the peak of the wave spectrum (VTPK)."},
    "mwp": {"source": "VTM02", "kind": PERIOD, "units": "s", "label": "Mean period",
            "description": "Mean wave period Tm02, from the spectrum's second frequency "
                           "moment (VTM02)."},
    "mwd": {"source": "VMDR", "kind": DIRECTION, "units": "degrees true",
            "label": "Mean direction",
            "description": "Mean direction the whole sea comes FROM (VMDR)."},
    "shww": {"source": "VHM0_WW", "kind": HEIGHT, "units": "m", "label": "Wind-wave height",
             "description": "Significant height of the wind sea, the waves the local wind "
                            "is raising (VHM0_WW)."},
    "mpww": {"source": "VTM01_WW", "kind": PERIOD, "units": "s", "label": "Wind-wave period",
             "description": "Mean period Tm01 of the wind sea (VTM01_WW)."},
    "mdww": {"source": "VMDR_WW", "kind": DIRECTION, "units": "degrees true",
             "label": "Wind-wave direction",
             "description": "Mean direction the wind sea comes FROM (VMDR_WW)."},
    "swell1_h": {"source": "VHM0_SW1", "kind": HEIGHT, "units": "m",
                 "label": "Primary swell height",
                 "description": "Significant height of the primary swell partition (VHM0_SW1)."},
    "swell1_p": {"source": "VTM01_SW1", "kind": PERIOD, "units": "s",
                 "label": "Primary swell period",
                 "description": "Mean period Tm01 of the primary swell partition (VTM01_SW1)."},
    "swell1_d": {"source": "VMDR_SW1", "kind": DIRECTION, "units": "degrees true",
                 "label": "Primary swell direction",
                 "description": "Mean direction the primary swell comes FROM (VMDR_SW1)."},
    "swell2_h": {"source": "VHM0_SW2", "kind": HEIGHT, "units": "m",
                 "label": "Secondary swell height",
                 "description": "Significant height of the secondary swell partition "
                                "(VHM0_SW2)."},
    "swell2_p": {"source": "VTM01_SW2", "kind": PERIOD, "units": "s",
                 "label": "Secondary swell period",
                 "description": "Mean period Tm01 of the secondary swell partition "
                                "(VTM01_SW2)."},
    "swell2_d": {"source": "VMDR_SW2", "kind": DIRECTION, "units": "degrees true",
                 "label": "Secondary swell direction",
                 "description": "Mean direction the secondary swell comes FROM (VMDR_SW2)."},
}
SOURCE_VARIABLES = [entry["source"] for entry in VARIABLES.values()]
PUBLISHED = ("units", "label", "description")
DIRECTION_CONVENTION = (
    "Wave directions are the bearing waves travel FROM, in degrees true, like the wind "
    "direction rows: 270° is a westerly swell running east.")
PARTITION_NOTE = (
    "swh/pp1d/mwp/mwd describe the whole spectrum. shww/mpww/mdww are the wind sea, "
    "swell1_* the primary swell and swell2_* the secondary swell: separate wave trains "
    "that arrive together, so their heights add in energy, not in metres. A partition "
    "the model finds no energy in at an hour has a height near zero and may have no "
    "period or direction, which is published as null.")
# A day file: ..._<first day>_<last day>_R<run>_<AN|FC|HC><number>.nc
DAY_FILE = re.compile(r"_(\d{8})_(\d{8})_R(\d{8})_([A-Z]{2})(\d{2})\.nc$")


def day_of(text):
    return datetime.strptime(text, "%Y%m%d").date()


def parse_listing(files):
    """{day: {"run", "kind", "number", "modified"}} from the day files' names.

    The service keeps one file a day; two for one day would be a layout this
    importer does not understand, and so would a file covering more than a day.
    """
    days = {}
    for entry in files:
        match = DAY_FILE.search(entry["name"])
        if not match:
            continue
        first, last, run, kind, number = match.groups()
        if first != last:
            raise ValueError(f"A day file covers more than one day: {entry['name']}")
        day = day_of(first)
        if day in days:
            raise ValueError(f"Two IBI wave files for {day}: the layout has changed")
        days[day] = {"run": day_of(run), "kind": kind, "number": int(number),
                     "modified": moment(entry["modified"]), "name": entry["name"]}
    return days


def moment(text):
    value = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def complete_run(days):
    """The newest run all of whose forecast days are its own, and its files.

    Day R + k must be the run's FC(k+1) for k in 0..9. Between the two halves of
    a run nothing is whole (the new run's first five days sit beside the old
    run's last four), and that is a refusal, not a run to publish.
    """
    runs = sorted({entry["run"] for entry in days.values() if entry["kind"] == "FC"},
                  reverse=True)
    for run in runs:
        files = [days.get(run + timedelta(days=k)) for k in range(FORECAST_DAYS)]
        if all(entry and entry["run"] == run and entry["kind"] == "FC"
               and entry["number"] == k + 1 for k, entry in enumerate(files)):
            return run, files
    found = ", ".join(f"{day:%d %b} R{entry['run']:%Y%m%d} {entry['kind']}{entry['number']:02d}"
                      for day, entry in sorted(days.items()) if entry["kind"] == "FC")
    raise ValueError("No whole IBI wave run is published: the forecast days come from "
                     f"more than one run ({found}). The second half of the newest run is "
                     "due by 02:00 UTC; the retry will pick it up.")


def months_to_list(today):
    """The month folders holding every day a run that could be whole might cover."""
    first, last = today - timedelta(days=3), today + timedelta(days=FORECAST_DAYS)
    months, day = [], first.replace(day=1)
    while day <= last:
        months.append(f"{day:%Y/%m}")
        day = (day.replace(day=28) + timedelta(days=4)).replace(day=1)
    return months


class Arco:
    """Just enough of a consolidated zarr v2 store, read over HTTPS, for this adapter.

    Copernicus Marine's ARCO stores are public objects: the consolidated
    metadata says each array's shape, chunking, codec and scaling, and a chunk
    is one object at `<array>/<i>.<j>.<k>`. Only the chunks a read overlaps are
    fetched; a chunk the store does not hold is all fill, as zarr defines it.
    """

    def __init__(self, url, session):
        self.url, self.session = url.rstrip("/"), session
        self.meta = fetch_json(session, f"{self.url}/.zmetadata")["metadata"]

    def array(self, name):
        try:
            layout = self.meta[f"{name}/.zarray"]
        except KeyError:
            raise ValueError(f"The store {self.url} has no {name}") from None
        if layout.get("zarr_format") != 2 or layout.get("filters") or layout.get("order") != "C":
            raise ValueError(f"{name}: an ARCO layout this importer does not read")
        return layout, self.meta.get(f"{name}/.zattrs", {})

    def chunk(self, name, index):
        layout, _ = self.array(name)
        key = layout.get("dimension_separator", ".").join(str(part) for part in index)
        body = get(self.session, f"{self.url}/{name}/{key}", missing_ok=True)
        if body is None:
            return None
        if layout.get("compressor"):
            body = numcodecs.get_codec(layout["compressor"]).decode(body)
        values = np.frombuffer(body, dtype=np.dtype(layout["dtype"]))
        if values.size != math.prod(layout["chunks"]):
            raise ValueError(f"{name}/{key}: {values.size} values, not a whole chunk")
        return values.reshape(layout["chunks"])

    def read(self, names, ranges, workers=8):
        """{name: float array over `ranges` ([start, stop) per dimension)}, NaN where unset.

        Every chunk of every array the box overlaps is fetched once, side by side;
        packed integers are unpacked with the array's own scale and offset.
        """
        jobs, out = [], {}
        for name in names:
            layout, attributes = self.array(name)
            shape, chunks = layout["shape"], layout["chunks"]
            if len(ranges) != len(shape) or any(not 0 <= a < b <= n for (a, b), n
                                                 in zip(ranges, shape)):
                raise ValueError(f"{name}: {ranges} lies outside its shape {shape}")
            out[name] = np.full([b - a for a, b in ranges], np.nan)
            spans = [range(a // c, (b - 1) // c + 1) for (a, b), c in zip(ranges, chunks)]
            jobs += [(name, index) for index in itertools.product(*spans)]
        with ThreadPoolExecutor(max_workers=workers) as pool:
            chunks_read = list(pool.map(lambda job: self.chunk(*job), jobs))
        for (name, index), raw in zip(jobs, chunks_read):
            if raw is None:
                continue
            layout, attributes = self.array(name)
            source, target = [], []
            for (a, b), c, i in zip(ranges, layout["chunks"], index):
                low, high = max(a, i * c), min(b, (i + 1) * c)
                source.append(slice(low - i * c, high - i * c))
                target.append(slice(low - a, high - a))
            out[name][tuple(target)] = unpack(raw[tuple(source)], layout, attributes)
        return out


def unpack(raw, layout, attributes):
    values = raw.astype(float)
    for fill in (layout.get("fill_value"), attributes.get("_FillValue")):
        if fill is not None and fill != "NaN":
            values[raw == fill] = np.nan
    return (values * float(attributes.get("scale_factor", 1.0))
            + float(attributes.get("add_offset", 0.0)))


def get(session, url, missing_ok=False):
    """Bytes of one public object, retried; None for a missing one when allowed."""
    for attempt in range(ATTEMPTS):
        try:
            response = session.get(url, timeout=TIMEOUT, headers={"User-Agent": USER_AGENT})
            if response.status_code in (403, 404) and missing_ok:
                return None
            response.raise_for_status()
            return response.content
        except Exception:
            if attempt == ATTEMPTS - 1:
                raise
            time.sleep(2 ** attempt)


def fetch_json(session, url):
    return json.loads(get(session, url))


def hours_since(units):
    """(seconds per unit, epoch) from a CF time unit such as "hours since 1950-01-01"."""
    match = re.fullmatch(r"(seconds|minutes|hours|days) since (\d{4}-\d{2}-\d{2})"
                         r"(?:[ T]00:00(?::00)?)?Z?", units.strip())
    if not match:
        raise ValueError(f"Unreadable time units {units!r}")
    seconds = {"seconds": 1, "minutes": 60, "hours": 3600, "days": 86400}[match.group(1)]
    return seconds, datetime.fromisoformat(match.group(2)).replace(tzinfo=timezone.utc)


class Marine:
    """The Copernicus Marine Data Store, as this adapter reads it. Tests replace it.

    Everything is public HTTPS: the STAC catalogue that names the dataset's
    versions and stores, the S3 listing of the day files, and the ARCO stores.
    """

    def __init__(self, session=None):
        self.session = session or SESSION

    def item(self, root, name):
        return fetch_json(self.session, f"{root}{PRODUCT}/{name}/dataset.stac.json")

    def describe(self, now=None):
        """The dataset version the Marine Data Store serves today, and its stores' state.

        The newest version that is released, not retired and not in preparation:
        the one the Copernicus Marine Toolbox picks by default.
        """
        now = now or datetime.now(timezone.utc)
        config = fetch_json(self.session, CLIENTS_CONFIG)
        root = config["catalogues"][0]["stacRoot"]
        product = fetch_json(self.session, f"{root}{PRODUCT}/product.stac.json")
        pattern = re.compile(rf"^{re.escape(DATASET)}_(\d{{6}})/dataset\.stac\.json$")
        versions = sorted((match.group(1) for link in product.get("links", [])
                           if link.get("rel") == "item"
                           and (match := pattern.match(link.get("href", "")))), reverse=True)
        for version in versions:
            item = self.item(root, f"{DATASET}_{version}")
            properties = item["properties"]
            released, retired = (properties.get("admp_released_date"),
                                 properties.get("admp_retired_date"))
            if (properties.get("admp_in_preparation")
                    or (released and moment(released) > now)
                    or (retired and moment(retired) <= now)):
                continue
            static = self.item(root, f"{STATIC}_{version}--ext--bathy")
            return {"version": version,
                    "updated": properties.get("admp_updated_data"),
                    "updating": properties.get("admp_updating_start_date"),
                    "retired": retired,
                    "series": item["assets"]["geoChunked"]["href"],
                    "native": item["assets"]["native"]["href"],
                    "static": static["assets"]["static"]["href"]}
        raise ValueError(f"No released version of {DATASET} is listed in the catalogue")

    def listing(self, state, months):
        """[{"name", "modified"}] of the day files in each month folder."""
        endpoint, bucket, prefix = re.match(r"(https://[^/]+)/([^/]+)/(.+)$",
                                            state["native"]).groups()
        files = []
        for month in months:
            token = None
            while True:
                query = {"list-type": "2", "prefix": f"{prefix}/{month}/"}
                if token:
                    query["continuation-token"] = token
                body = get(self.session, f"{endpoint}/{bucket}?{urlencode(query)}")
                tree = ElementTree.fromstring(body)
                space = {"s3": tree.tag.split("}")[0].strip("{")}
                for item in tree.findall("s3:Contents", space):
                    files.append({"name": item.find("s3:Key", space).text.rsplit("/", 1)[-1],
                                  "modified": item.find("s3:LastModified", space).text})
                token = tree.findtext("s3:NextContinuationToken", None, space)
                if tree.findtext("s3:IsTruncated", "false", space) != "true" or not token:
                    break
        return files

    def grid(self, state):
        return Static(Arco(state["static"], self.session))

    def series(self, state, rows, columns, start, end):
        return Series(Arco(state["series"], self.session), rows, columns, start, end)


class Static:
    def __init__(self, store):
        self.store = store
        self.latitudes = axis(store, "latitude")
        self.longitudes = axis(store, "longitude")

    def read(self, rows, columns):
        """Sea (bool) and depth in metres over [rows) x [columns), rows south to north."""
        arrays = self.store.read(["mask", "deptho"], [rows, columns])
        return np.nan_to_num(arrays["mask"]) > 0.5, arrays["deptho"]


def axis(store, name):
    layout, _ = store.array(name)
    return store.read([name], [(0, layout["shape"][0])])[name]


class Series:
    """The run's hours of the time-series store over one box of the grid."""

    def __init__(self, store, rows, columns, start, end):
        self.store, self.rows, self.columns = store, rows, columns
        layout, attributes = store.array("time")
        seconds, epoch = hours_since(attributes.get("units", ""))
        values = axis(store, "time")
        wanted = [(start - epoch).total_seconds() / seconds + step * 3600 / seconds
                  for step in range(int((end - start).total_seconds() // 3600) + 1)]
        first = int(np.searchsorted(values, wanted[0]))
        found = values[first:first + len(wanted)]
        self.times = [epoch + timedelta(seconds=float(value) * seconds) for value in found]
        self.first = first
        self.latitudes = axis(store, "latitude")[rows[0]:rows[1]]
        self.longitudes = axis(store, "longitude")[columns[0]:columns[1]]
        chunks = store.array(SOURCE_VARIABLES[0])[0]["chunks"]
        self.tile = (chunks[1], chunks[2])

    def read(self, rows, columns):
        """{source variable: array[time, row, column]} for one block of the box."""
        span = (self.first, self.first + len(self.times))
        return self.store.read(SOURCE_VARIABLES, [span, (self.rows[0] + rows[0],
                                                         self.rows[0] + rows[1]),
                                                  (self.columns[0] + columns[0],
                                                   self.columns[0] + columns[1])])


def aligned(low, high, size):
    """[start, stop) on the tile lattice covering indices low..high, clipped to the grid."""
    return max(0, low // TILE * TILE), min(size, (high // TILE + 1) * TILE)


def spot_box(spots, latitudes, longitudes):
    """The tile-aligned index box around every riding location and its search."""
    def index(axis, value):
        return int(np.clip(np.searchsorted(axis, value), 0, axis.size - 1))
    pad_lat = SEARCH_KM / 111.195 + BOX_PAD_DEGREES
    pad_lon = SEARCH_KM / (111.195 * math.cos(math.radians(56))) + BOX_PAD_DEGREES
    south = index(latitudes, min(spot["lat"] for spot in spots) - pad_lat)
    north = index(latitudes, max(spot["lat"] for spot in spots) + pad_lat)
    west = index(longitudes, min(spot["lon"] for spot in spots) - pad_lon)
    east = index(longitudes, max(spot["lon"] for spot in spots) + pad_lon)
    return aligned(south, north, latitudes.size), aligned(west, east, longitudes.size)


def inside(spot, latitudes, longitudes):
    step = (latitudes[-1] - latitudes[0]) / max(latitudes.size - 1, 1)
    return (latitudes[0] - step / 2 <= spot["lat"] <= latitudes[-1] + step / 2
            and longitudes[0] - step / 2 <= spot["lon"] <= longitudes[-1] + step / 2)


def choose_cell(spot, latitudes, longitudes, sea, depth):
    """The cell a spot is read at, as indices into the box, or None and the reason.

    The nearest open-water cell (sea, with sea on all four sides) within
    SEARCH_KM, or failing that the nearest sea cell: a cell on the model's
    coastline has land on one side, which no wave can come from, so it reads
    lower and points away from the land whatever the wind does.
    """
    if not inside(spot, latitudes, longitudes):
        return None, "This location lies outside the IBI wave model's domain."
    d_lat = SEARCH_KM / 111.195
    d_lon = SEARCH_KM / (111.195 * max(math.cos(math.radians(spot["lat"])), 0.05))
    rows = np.flatnonzero(np.abs(latitudes - spot["lat"]) <= d_lat + 0.03)
    columns = np.flatnonzero(np.abs(longitudes - spot["lon"]) <= d_lon + 0.03)
    best = {True: None, False: None}
    height, width = sea.shape
    for i in rows:
        for j in columns:
            if not sea[i, j]:
                continue
            kilometres = distance_km(spot["lat"], spot["lon"], latitudes[i], longitudes[j])
            if kilometres > SEARCH_KM:
                continue
            open_water = all(0 <= i + a < height and 0 <= j + b < width and sea[i + a, j + b]
                             for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if best[open_water] is None or kilometres < best[open_water][0]:
                best[open_water] = (kilometres, int(i), int(j))
    found = best[True] or best[False]
    if found is None:
        return None, (f"The IBI wave model has no sea within {SEARCH_KM:g} km of this "
                      "location. It cannot say anything about waves here.")
    kilometres, i, j = found
    containing = (int(np.argmin(np.abs(latitudes - spot["lat"]))),
                  int(np.argmin(np.abs(longitudes - spot["lon"]))))
    value = depth[i, j]
    return {"row": i, "column": j, "offsetKm": round(kilometres, 2),
            "openWater": best[True] is not None, "own": (i, j) == containing,
            "depthM": None if not np.isfinite(value) else round(float(value), 1)}, None


def coverage_for(spot, cell, reason, latitudes, longitudes):
    """The manifest's own words on where a location's waves were read."""
    if cell is None:
        return {"landMasked": True, "resolved": False, "nearestOffsetKm": None,
                "note": reason}
    where = ("open water" if cell["openWater"] else
             "the model's coastline, the only sea within reach")
    if cell["own"]:
        note = f"This location sits in a sea cell of the 1/36° wave grid ({where})."
    else:
        note = (f"Read from the nearest cell of {where}, {cell['offsetKm']:.1f} km away"
                + (f" and {cell['depthM']:g} m deep" if cell["depthM"] is not None else "")
                + ": it describes the sea off this beach rather than the shorebreak.")
    return {"landMasked": not cell["own"], "resolved": True,
            "nearestOffsetKm": cell["offsetKm"],
            "cellLat": round(float(latitudes[cell["row"]]), 5),
            "cellLon": round(float(longitudes[cell["column"]]), 5),
            "openWater": cell["openWater"], "depthM": cell["depthM"], "note": note}


def value_of(raw, name):
    """A source value or None; an implausible value fails the run."""
    if raw is None or not math.isfinite(raw):
        return None
    low, high, digits = LIMITS[VARIABLES[name]["kind"]]
    if VARIABLES[name]["kind"] == DIRECTION:
        return round(raw % 360, digits) % 360
    if not low - 0.01 <= raw <= high + 0.01:
        raise ValueError(f"Implausible {name} value {raw}")
    return round(max(raw, low), digits)


def cell_series(arrays, row, column, run, hours):
    """One cell's published series from a block's arrays (source names)."""
    series = []
    for hour in hours:
        values = {name: value_of(float(arrays[entry["source"]][hour, row, column]), name)
                  for name, entry in VARIABLES.items()}
        series.append({"hour": hour, "validTime": stamp(run + timedelta(hours=hour)),
                       "values": values})
    return series


def null_series(run, hours):
    return [{"hour": hour, "validTime": stamp(run + timedelta(hours=hour)),
             "values": {name: None for name in VARIABLES}} for hour in hours]


def check_store(state, files, when):
    """The ARCO store holds the run the day files name, and is not mid-update."""
    if state.get("updating"):
        raise ValueError(f"The IBI wave store is being updated (since {state['updating']}); "
                         "the retry will read it once it is done")
    newest = max(entry["modified"] for entry in files)
    if not state.get("updated") or moment(state["updated"]) < newest:
        raise ValueError(f"The IBI wave store was last updated {state.get('updated')} {when}, "
                         f"before the run's newest file ({stamp(newest)}): it does not hold "
                         "that run yet")


def processing(run, spots, coverage, tiles):
    resolved = [key for key, entry in coverage.items() if entry["resolved"]]
    coast = sum(1 for key in resolved if not coverage[key]["openWater"])
    offsets = sorted(coverage[key]["nearestOffsetKm"] for key in resolved)
    median = offsets[len(offsets) // 2] if offsets else None
    return (
        f"One whole run of Copernicus Marine's {PRODUCT} (Météo-France MFWAM), the run of "
        f"{run:%d %B %Y}: `run` is its first forecast hour, 00 UTC that day, and hours 0-{HOURS} "
        "follow hourly, every one a source time step. The service's day files show which "
        "run each day came from, and a run is published only when all ten of its days are "
        "its own, so this is never a mixture of two runs. Each location is read at one grid "
        f"cell, unchanged and never interpolated: the nearest open-water cell (sea on all "
        f"four sides) within {SEARCH_KM:g} km, else the nearest sea cell. {len(resolved)} of "
        f"{len(spots)} locations have one (median {median} km away"
        + (f"; {coast} only on the model's coastline" if coast else "")
        + f"), the rest are published as nulls with a stated reason. The {tiles} tiles of "
        f"16 × 16 cells holding those cells were read from the ARCO time-series store, "
        "every variable for the run's 240 hours; no whole file was downloaded. Directions "
        "are normalised onto [0, 360); every other value is source output, rounded only. "
        "A partition with no energy at an hour may have no period or direction: null.")


def manifest_for(run, now, state, files, series, coverage, spots, tiles):
    run_time = datetime.combine(run, datetime.min.time(), tzinfo=timezone.utc)
    return {
        "schemaVersion": 1, "kind": "wave", "model": MODEL, "modelName": "IBI Wave",
        "provider": "Copernicus Marine Service",
        "modelDetail": "Météo-France MFWAM spectral wave model, Iberia-Biscay-Ireland "
                       "analysis and forecast",
        "run": run_time.strftime("%Y%m%d%H"), "runTime": stamp(run_time),
        "generatedAt": stamp(now.replace(microsecond=0)),
        "stepHours": 1, "horizonHours": HOURS,
        "resolutionKm": 3.1, "resolutionLabel": RESOLUTION_LABEL,
        "variables": {name: {key: entry[key] for key in PUBLISHED}
                      for name, entry in VARIABLES.items()},
        "frames": [], "spotSeries": series, "spotCoverage": coverage,
        "directionConvention": DIRECTION_CONVENTION, "partitionNote": PARTITION_NOTE,
        "sourceProduct": PRODUCT, "sourceDataset": f"{DATASET}_{state['version']}",
        "sourceFiles": {"first": files[0]["name"], "last": files[-1]["name"],
                        "newestModified": stamp(max(entry["modified"] for entry in files))},
        "sourceUpdated": state.get("updated"),
        "processing": processing(run, spots, coverage, tiles),
        "source": f"Copernicus Marine Service {PRODUCT}, dataset {DATASET}: its ARCO "
                  "time-series store and land-sea mask, read over public HTTPS",
        "sourceUrl": SOURCE_URL, "doi": DOI, "attribution": ATTRIBUTION,
        "licenseUrl": LICENSE_URL,
    }


def build(marine, state, run, files, spots, now):
    hours = list(range(HOURS + 1))
    run_time = datetime.combine(run, datetime.min.time(), tzinfo=timezone.utc)
    timing.start("discover")
    static = marine.grid(state)
    rows, columns = spot_box(spots, static.latitudes, static.longitudes)
    latitudes = static.latitudes[rows[0]:rows[1]]
    longitudes = static.longitudes[columns[0]:columns[1]]
    sea, depth = static.read(rows, columns)
    cells, coverage = {}, {}
    for spot in spots:
        cell, reason = choose_cell(spot, latitudes, longitudes, sea, depth)
        cells[spot["id"]] = cell
        coverage[spot["id"]] = coverage_for(spot, cell, reason, latitudes, longitudes)

    data = marine.series(state, rows, columns, run_time, run_time + timedelta(hours=HOURS))
    expected = [run_time + timedelta(hours=hour) for hour in hours]
    if data.times != expected:
        raise ValueError(f"The store's hours for run {run:%Y%m%d} are not hours 0-{HOURS}: "
                         f"{len(data.times)} from {data.times[0] if data.times else None}")
    if (data.latitudes.size, data.longitudes.size) != sea.shape or not (
            np.allclose(data.latitudes, latitudes) and np.allclose(data.longitudes, longitudes)):
        raise ValueError("The wave grid is not the land-sea mask's grid")
    if data.tile != (TILE, TILE):
        print(f"  The store's tiles are {data.tile}, not {TILE} x {TILE}: some chunks "
              "will be read more than once", flush=True)
    blocks = {}
    for spot_id, cell in cells.items():
        if cell:
            blocks.setdefault((cell["row"] // TILE, cell["column"] // TILE), []).append(spot_id)
    series = {spot["id"]: null_series(run_time, hours) for spot in spots}
    timing.start("download", workers=8)
    for (tile_row, tile_column), members in sorted(blocks.items()):
        block_rows = (tile_row * TILE, min((tile_row + 1) * TILE, sea.shape[0]))
        block_columns = (tile_column * TILE, min((tile_column + 1) * TILE, sea.shape[1]))
        arrays = data.read(block_rows, block_columns)
        with timing.phase("decode"):
            for spot_id in members:
                cell = cells[spot_id]
                values = cell_series(arrays, cell["row"] - block_rows[0],
                                     cell["column"] - block_columns[0], run_time, hours)
                if any(step["values"]["swh"] is None for step in values):
                    raise ValueError(f"{spot_id}: the sea cell it is read at has no wave height "
                                     "at some hours of the run; the store is incomplete")
                series[spot_id] = values
    timing.start("discover")
    after = marine.describe(now)
    check_store(after, files, "after the read")
    if (after["version"], after["updated"]) != (state["version"], state["updated"]):
        raise ValueError(f"The IBI wave store changed while it was read (updated "
                         f"{state['updated']}, then {after['updated']}); the retry reads it again")
    manifest = manifest_for(run, now, state, files, series, coverage, spots, len(blocks))
    output = ROOT / "public" / "weather"
    prefix = f"{MODEL}-{manifest['run']}-{HOURS}h-v1"
    pointer = write_run(output, f"{MODEL}.json", manifest, prefix, spots)
    resolved = sum(1 for entry in coverage.values() if entry["resolved"])
    print(f"Published {len(hours)} IBI wave hours for {len(spots)} locations ({resolved} with a "
          f"sea cell) from {len(blocks)} tiles x {len(SOURCE_VARIABLES)} variables to "
          f"{output / (MODEL + '.json')}", flush=True)
    return {**pointer, **{key: manifest[key] for key in SPOT_KEYS if key in manifest}}


def main(argv=None, marine=None, now=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args(argv)
    now = now or datetime.now(timezone.utc)
    timing.start("discover")
    marine = marine or Marine()
    state = marine.describe(now)
    files = marine.listing(state, months_to_list(now.date()))
    run, run_files = complete_run(parse_listing(files))
    run_time = datetime.combine(run, datetime.min.time(), tzinfo=timezone.utc)
    age = (now - run_time).total_seconds() / 3600
    if not 0 <= age <= MAX_AGE_HOURS:
        raise ValueError(f"The newest whole IBI wave run, {run:%Y%m%d}, is {age:.0f} h old: "
                         f"refusing a run outside 0-{MAX_AGE_HOURS} h")
    if published_in_bucket(run_time.strftime("%Y%m%d%H")):
        print(f"IBI wave run {run:%Y%m%d} is already published; nothing to download.",
              flush=True)
        return UNCHANGED_EXIT
    check_store(state, run_files, "before the read")
    print(f"IBI wave run {run:%Y%m%d} ({state['version']}), hours 0-{HOURS}: its files "
          f"{run_files[0]['name']} to {run_files[-1]['name']}", flush=True)
    return build(marine, state, run, run_files, load_spots(), now)


if __name__ == "__main__":
    try:
        # main() returns the manifest it wrote, or UNCHANGED_EXIT when the run is
        # already published, which the worker reads as "nothing new", not as a
        # failure and not as a bundle to validate.
        sys.exit(UNCHANGED_EXIT if main() == UNCHANGED_EXIT else 0)
    except Exception as error:
        print(f"IBI wave refresh failed: {error}. Last published wave forecast preserved.",
              file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
