"""Shared Météo-France PNT client for the ARPEGE and AROME wind adapters.

Météo-France publishes its numerical prediction packages as whole-domain GRIB2
bundles on OVH object storage (Etalab Open Licence 2.0, no key, no server-side
subsetting). The surface package we need is 646 MB a run for ARPEGE and 461 MB
for AROME, and there is no `.idx` sidecar to skip with. Transferring that for
three fields is not defensible, so this module walks each package's GRIB2
message headers over HTTP byte ranges — about 1 KB a message — and then
downloads only the 10 m u/v and gust messages it will publish. A 102-hour
ARPEGE run costs roughly 35 MB that way and a 51-hour AROME run 37 MB.

The bucket ignores a multi-range request and answers 200 with the whole object,
so `Session.get` accepts one range and refuses any response that is not a 206
of exactly the requested length. Packages are CCSDS/AEC packed (data
representation template 42), which only an ecCodes built with libaec can
decode; `values()` turns that failure into one sentence naming libaec.

Both adapters publish the ordinary Force5 wind contract through `refresh()`.
"""
from concurrent.futures import ThreadPoolExecutor
import http.client
from datetime import datetime, timedelta, timezone
import json
import os
import re
import socket
import ssl
import sys
import threading
import time
from urllib.parse import quote

import eccodes as ec
import numpy as np

from f5bin import ENCODING as FRAME_ENCODING, publish_frame
from fetch_forecast import ROOT, get, load_spots, messages, sample, spots_file, write_json

HOST = "meteofrance-pnt.s3.rbx.io.cloud.ovh.net"
BUCKET = f"https://{HOST}"
DATAGOUV = "https://www.data.gouv.fr/api/1/datasets/{slug}/"
SOURCE_URL = "https://meteo.data.gouv.fr/"
USER_AGENT = "Force5/0.1 (+https://wingfoil.ie forecast ingest; contact via site)"
LICENCE_URL = "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
ATTRIBUTION = ("Weather data: Météo-France, ARPEGE and AROME public numerical prediction "
               "packages from meteo.data.gouv.fr, Etalab Open Licence 2.0. Cropped, "
               "validated and processed by Force5 (wingfoil.ie); this is modified "
               "Météo-France output, not official Météo-France material.")

# GRIB2 identity of the three messages we accept: discipline, parameter category,
# parameter number and product definition template. Numbers, not names. FF_RAF is
# WMO 0/2/22 under a statistical template, not a Météo-France local code: these
# files declare master table 15 with local table 0, and `grib_ls` names cannot be
# trusted to stay stable across ecCodes releases.
FIELDS = {(0, 2, 2, 0): "u", (0, 2, 3, 0): "v", (0, 2, 22, 8): "gust"}
LEVEL = (103, 10)  # Fixed surface: height above ground, 10 m.
GUST_WINDOW_HOURS = 1  # FF_RAF is a maximum over the hour ending at the frame.
MAX_SPEED = 150
MAX_AGE_HOURS = 12
GEOMETRY = ["Ni", "Nj", "latitudeOfFirstGridPointInDegrees",
            "longitudeOfFirstGridPointInDegrees", "iDirectionIncrementInDegrees",
            "jDirectionIncrementInDegrees", "jScansPositively", "iScansNegatively",
            "jPointsAreConsecutive", "alternativeRowScanning", "shapeOfTheEarth",
            "uvRelativeToGrid"]
# Scanning and shape every message must declare: first point north-west, rows
# west-to-east then north-to-south, earth-relative vectors, IAG-GRS80 spheroid.
SCANNING = {"gridType": "regular_ll", "uvRelativeToGrid": 0, "iScansNegatively": 0,
            "jScansPositively": 0, "jPointsAreConsecutive": 0,
            "alternativeRowScanning": 0, "shapeOfTheEarth": 6}
PACKAGE = re.compile(r"(?P<family>arpege|arome)__(?P<resolution>[0-9]+)__(?P<package>[A-Z0-9]+)__"
                     r"(?P<start>\d+)H(?P<end>\d+)H__(?P<run>[\dT:-]+Z)\.grib2")

# Physical facts per model, verified against live packages on 17 September 2026.
# `domain` is the package's own whole grid (west, south, east, north) and `bbox`
# the box we publish; a box edge outside the domain is clamped, not extrapolated.
SPECS = {
    "arpege": {
        "model": "arpege", "family": "arpege", "resolution": "01", "package": "SP1",
        "slug": "paquets-arpege-resolution-0-1deg", "cycles": (0, 6, 12, 18),
        "horizon": 102, "spacing": 0.1, "domain": (-32.0, 20.0, 42.0, 72.0),
        "bbox": (-18.0, 48.0, 2.0, 59.0), "modelName": "ARPEGE",
        "provider": "Météo-France", "resolutionKm": None,
        "resolutionLabel": "0.1° (about 11 km) EURAT01 grid",
        "modelDetail": "ARPEGE 0.1° deterministic, EURAT01 domain",
    },
    "arome": {
        "model": "arome", "family": "arome", "resolution": "0025", "package": "SP1",
        "slug": "paquets-arome-resolution-0-025deg", "cycles": tuple(range(0, 24, 3)),
        "horizon": 51, "spacing": 0.025, "domain": (-12.0, 37.5, 16.0, 55.4),
        # The 0.025° lat/lon box is only the bounding box of a rotated native
        # domain: a GRIB2 bitmap masks 17% of it, and the masked north-west
        # corner cuts diagonally across Donegal (valid data starts at 8.45°W on
        # the 55°N row). This crop is the largest rectangle wholly inside the
        # unmasked area, measured from a real run; `decode` fails loudly if a
        # future run's mask moves.
        "bbox": (-10.9, 51.0, -5.0, 54.75), "modelName": "AROME",
        "provider": "Météo-France", "resolutionKm": 2.5,
        "resolutionLabel": "0.025° (about 2.5 km) EURW1S40 grid",
        "modelDetail": "AROME 0.025° deterministic, EURW1S40 domain",
    },
}


def run_key(run):
    """`2026091618` is the contract's run id; the bucket keys it as an instant."""
    return datetime.strptime(run, "%Y%m%d%H").strftime("%Y-%m-%dT%H:00:00Z")


def run_datetime(spec, run):
    if not re.fullmatch(r"\d{10}", run or ""):
        raise ValueError("A Météo-France run identifier is YYYYMMDDHH")
    value = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    if value.hour not in spec["cycles"]:
        raise ValueError(f"{spec['modelName']} runs at {spec['cycles']} UTC only")
    return value


class Session:
    """One keep-alive HTTPS connection to the package bucket.

    Only single-byte-range reads: this endpoint answers a multi-range request
    with 200 and the entire object, so anything but a 206 of the requested
    length is treated as a fault and the connection is dropped unread."""

    def __init__(self, host=HOST, timeout=120, pause=0.0):
        self.host, self.timeout, self.pause = host, timeout, pause
        self.connection, self.last, self.requests, self.bytes = None, 0.0, 0, 0

    def _connect(self):
        if self.connection is None:
            self.connection = http.client.HTTPSConnection(
                self.host, timeout=self.timeout, context=ssl.create_default_context())
        return self.connection

    def close(self):
        if self.connection is not None:
            self.connection.close()
            self.connection = None

    def get(self, path, byte_range=None, attempts=4):
        for attempt in range(attempts):
            delay = self.pause - (time.monotonic() - self.last)
            if delay > 0:
                time.sleep(delay)
            self.last = time.monotonic()
            headers = {"User-Agent": USER_AGENT}
            if byte_range is not None:
                headers["Range"] = f"bytes={byte_range[0]}-{byte_range[1]}"
            try:
                connection = self._connect()
                connection.request("GET", path, headers=headers)
                response = connection.getresponse()
                if byte_range is not None and response.status != 206:
                    # Never read the body: a range the server ignored is the
                    # whole 71 MB package, and reading it would defeat the point.
                    self.close()
                    raise ValueError(f"Expected a partial response for {path}, got {response.status}")
                if response.status >= 400:
                    response.read()
                    raise ValueError(f"HTTP {response.status} for {path}")
                body = response.read()
                self.requests += 1
                self.bytes += len(body)
                if byte_range is not None and len(body) != byte_range[1] - byte_range[0] + 1:
                    raise ValueError(f"Short range response for {path}")
                return body
            except (http.client.HTTPException, socket.error, ssl.SSLError, OSError) as error:
                self.close()
                if attempt == attempts - 1:
                    raise ValueError(f"Could not read {path}: {error}") from error
                time.sleep(2 ** attempt)
            except ValueError:
                self.close()
                if attempt == attempts - 1:
                    raise
                time.sleep(2 ** attempt)


class SessionPool:
    """One `Session` per worker thread.

    A package walk is inherently serial — each message's length says where the
    next one starts — but the nine time-group files of a run are independent, so
    walking several at once turns a two-minute scan into half a minute. Sockets
    are never shared between threads, and the counters are read after the pool
    has been joined."""

    def __init__(self, workers=3):
        self.workers, self.local = workers, threading.local()
        self.lock, self.opened = threading.Lock(), []

    def session(self):
        found = getattr(self.local, "session", None)
        if found is None:
            found = self.local.session = Session()
            with self.lock:
                self.opened.append(found)
        return found

    def map(self, work, items):
        items = list(items)
        if self.workers <= 1 or len(items) <= 1:
            return [work(self.session(), item) for item in items]
        with ThreadPoolExecutor(max_workers=min(self.workers, len(items))) as executor:
            return list(executor.map(lambda item: work(self.session(), item), items))

    def close(self):
        for session in self.opened:
            session.close()

    @property
    def requests(self):
        return sum(session.requests for session in self.opened)

    @property
    def bytes(self):
        return sum(session.bytes for session in self.opened)


def listing(session, prefix):
    """Every key under a bucket prefix with its size, from the public S3 listing."""
    found, token = {}, ""
    for _ in range(8):
        query = f"/?list-type=2&max-keys=1000&prefix={quote(prefix)}"
        body = session.get(query + (f"&continuation-token={quote(token)}" if token else "")).decode()
        for block in re.findall(r"<Contents>(.*?)</Contents>", body, re.S):
            key = re.search(r"<Key>([^<]*)</Key>", block)
            size = re.search(r"<Size>(\d+)</Size>", block)
            if key and size:
                found[key.group(1)] = int(size.group(1))
        follow = re.search(r"<NextContinuationToken>([^<]+)</", body)
        if not follow:
            return found
        token = follow.group(1)
    raise RuntimeError("Unexpectedly long Météo-France package listing")


def parse_packages(spec, run, names, sizes):
    """The run's time-group files, from names alone: `SP1__013H024H__<run>`."""
    groups = []
    for name in names:
        match = PACKAGE.fullmatch(name.rsplit("/", 1)[-1])
        if not match or match["run"] != run_key(run):
            continue
        if (match["family"], match["resolution"], match["package"]) != (
                spec["family"], spec["resolution"], spec["package"]):
            continue
        start, end = int(match["start"]), int(match["end"])
        if start > end:
            raise ValueError(f"Reversed forecast range in {name}")
        groups.append({"start": start, "end": end, "key": name, "size": sizes[name]})
    groups.sort(key=lambda group: group["start"])
    for previous, group in zip(groups, groups[1:]):
        if group["start"] != previous["end"] + 1:
            raise ValueError(f"Gap or overlap in the {spec['modelName']} {run} package set")
    return groups


def packages(source, session, spec, run):
    """The run's package files, from the bucket listing or the data.gouv catalogue."""
    if source == "datagouv":
        # The published catalogue rewrites one resource per time group in place, so
        # a run in progress shows a mixture and only its complete groups match.
        body = json.loads(get(DATAGOUV.format(slug=spec["slug"])))
        names, sizes = [], {}
        for resource in body.get("resources", []):
            url, size = resource.get("url", ""), resource.get("filesize")
            if f"/pnt/{run_key(run)}/" in url and size:
                names.append(url.split(f"/pnt/{run_key(run)}/", 1)[1])
                sizes[names[-1]] = int(size)
        prefix = f"pnt/{run_key(run)}/"
        return [{**group, "key": prefix + group["key"]}
                for group in parse_packages(spec, run, names, sizes)]
    prefix = f"pnt/{run_key(run)}/{spec['family']}/{spec['resolution']}/{spec['package']}/"
    sizes = listing(session, prefix)
    return parse_packages(spec, run, list(sizes), sizes)


def group_for(hour, groups):
    """The one package file holding a forecast hour's fields.

    A gust valid at +h is the maximum over [h-1, h] and is filed by that end
    hour, so every field for +h lives in the group whose range contains h."""
    for group in groups:
        if group["start"] <= hour <= group["end"]:
            return group
    return None


def candidates(spec, requested_run, now):
    if requested_run:
        return [requested_run]
    found, moment = [], now.replace(minute=0, second=0, microsecond=0)
    while len(found) < 24 and (now - moment).total_seconds() / 3600 <= MAX_AGE_HOURS:
        if moment.hour in spec["cycles"]:
            found.append(moment.strftime("%Y%m%d%H"))
        moment -= timedelta(hours=1)
    return found


def discover(source, session, spec, hours, requested_run=None, now=None):
    """Newest cycle whose published package set covers every requested hour."""
    for run in candidates(spec, requested_run, now or datetime.now(timezone.utc)):
        try:
            groups = packages(source, session, spec, run)
        except Exception as error:
            print(f"Package listing unavailable ({run}): {error}", file=sys.stderr)
            continue
        missing = [hour for hour in hours if group_for(hour, groups) is None]
        if groups and not missing:
            return run, groups
        print(f"Skipping incomplete {spec['modelName']} {run}: "
              f"{len(missing) or 'all'} step(s) not published yet", flush=True)
    raise RuntimeError(f"No complete requested {spec['modelName']} run is available. "
                       "Existing forecast has not been changed.")


def header(buffer):
    """Identify one GRIB2 message from its leading sections, without unpacking it.

    Reads section 0 for the length, 4 for the parameter, fixed surface and lead
    time, and 5 for the packing. Returns the field name this importer would give
    it, or None for one of the package's other two dozen parameters."""
    if buffer[:4] != b"GRIB" or buffer[7] != 2:
        raise ValueError("Not a GRIB2 message boundary")
    info = {"discipline": buffer[6], "length": int.from_bytes(buffer[8:16], "big"), "field": None}
    if info["length"] < 32:
        raise ValueError("Implausible GRIB2 message length")
    offset, seen = 16, set()
    while offset + 5 <= len(buffer):
        length, number = int.from_bytes(buffer[offset:offset + 4], "big"), buffer[offset + 4]
        if number == 7 or length < 5 or offset + length > len(buffer):
            break
        section, seen = buffer[offset:offset + length], seen | {number}
        if number == 4 and length >= 34:
            info["template"] = int.from_bytes(section[7:9], "big")
            info["category"], info["number"] = section[9], section[10]
            info["unit"] = section[17]
            info["forecastTime"] = int.from_bytes(section[18:22], "big")
            info["level"] = (section[22], int.from_bytes(section[24:28], "big"))
            if info["template"] == 8 and length >= 58:
                info["statistic"] = section[46]
                info["rangeUnit"] = section[48]
                info["rangeLength"] = int.from_bytes(section[49:53], "big")
        if number == 5 and length >= 11:
            info["points"] = int.from_bytes(section[5:9], "big")
            info["packing"] = int.from_bytes(section[9:11], "big")
        offset += length
    if not {4, 5} <= seen or "category" not in info:
        raise ValueError("GRIB2 header window is too small to identify the message")
    field = FIELDS.get((info["discipline"], info["category"], info["number"], info["template"]))
    if field is None or info["level"] != LEVEL or info["unit"] != 1:
        return info
    if field == "gust":
        if (info.get("statistic"), info.get("rangeUnit"), info.get("rangeLength")) != (
                2, 1, GUST_WINDOW_HOURS):
            return info  # A differently-processed gust is not the FF_RAF we publish.
        info["hour"] = info["forecastTime"] + GUST_WINDOW_HOURS
    else:
        info["hour"] = info["forecastTime"]
    info["field"] = field
    return info


def scan(session, group, wanted, window=1024):
    """Walk a package's message headers over ranges; locate only `wanted`.

    The packages are laid out parameter-major, so the walk stops as soon as every
    wanted (field, hour) has been found rather than reading to end of file."""
    found, offset = {}, 0
    while offset < group["size"] and len(found) < len(wanted):
        info = header(session.get("/" + group["key"],
                                  (offset, min(offset + window, group["size"]) - 1)))
        identity = (info["field"], info.get("hour"))
        if info["field"] is not None and identity in wanted and identity not in found:
            if offset + info["length"] > group["size"]:
                raise ValueError(f"Truncated message in {group['key']}")
            found[identity] = (offset, info["length"])
        offset += info["length"]
    if len(found) != len(wanted):
        absent = sorted(f"{field}+{hour:03d}h" for field, hour in set(wanted) - set(found))
        raise ValueError(f"{group['key']} has no {', '.join(absent)}")
    return found


def index(pool, spec, run, groups, hours, cache):
    """Byte ranges of every message we will publish, cached per run.

    Scanning a nine-file package set costs a few hundred header reads, so the
    result is kept beside the messages: a retried job re-reads nothing."""
    path = cache / "index.json"
    wanted = {}
    for hour in hours:
        for field in fields_for(hour):
            wanted.setdefault(group_for(hour, groups)["key"], set()).add((field, hour))
    stored = {}
    if path.exists():
        try:
            saved = json.loads(path.read_text())
            if saved.get("run") == run and saved.get("model") == spec["model"]:
                stored = saved["messages"]
        except Exception:
            print("Ignoring an unreadable package index", flush=True)
    reads = pool.requests
    remembered, pending = {}, []
    for group in groups:
        needed = wanted.get(group["key"])
        if not needed:
            continue
        held = {tuple(json.loads(key)): tuple(value)
                for key, value in stored.get(group["key"], {}).items()}
        if needed <= set(held):
            remembered[group["key"]] = held
        else:
            pending.append(group)

    def walk(session, group):
        held = scan(session, group, wanted[group["key"]])
        print(f"  Indexed {group['key'].rsplit('/', 1)[-1]}: {len(held)} messages", flush=True)
        return group["key"], held

    found = {**remembered, **dict(pool.map(walk, pending))}
    write_json(path, {"model": spec["model"], "run": run, "messages": {
        key: {json.dumps(list(identity)): list(value) for identity, value in held.items()}
        for key, held in found.items()}})
    if pool.requests > reads:
        print(f"  Package index cost {pool.requests - reads} header reads", flush=True)
    return found


def fields_for(hour):
    """Initialization has no preceding hour, so it carries no FF_RAF maximum."""
    return ("u", "v") if hour == 0 else ("u", "v", "gust")


def download(session, spec, groups, located, hour, cache):
    """One cached GRIB2 file per forecast hour, holding just our messages."""
    path = cache / f"{hour:03d}.grib2"
    if path.exists():
        return path
    group = group_for(hour, groups)
    blobs = []
    for field in fields_for(hour):
        offset, length = located[group["key"]][(field, hour)]
        data = session.get("/" + group["key"], (offset, offset + length - 1))
        if not data.startswith(b"GRIB") or not data.endswith(b"7777"):
            raise ValueError(f"Not a complete GRIB2 message for {field} at +{hour:03d}h")
        blobs.append(data)
    temporary = path.with_suffix(".download")
    temporary.write_bytes(b"".join(blobs))
    os.replace(temporary, path)
    return path


def make_layout(handle, spec):
    """Crop the declared regular lat/lon lattice on integer indices.

    Neither 0.1° nor 0.025° is a binary fraction, so ecCodes' own coordinate
    arrays drift by ~1e-13 over a row and a plain `longitude <= east` test
    silently drops the eastern column and publishes a ragged box. The crop is
    therefore taken on lattice indices, the published bounds are computed from
    those indices, and the arithmetic lattice is checked against every
    coordinate ecCodes reports before it is trusted."""
    for key, value in SCANNING.items():
        if ec.codes_get(handle, key) != value:
            raise ValueError(f"Unsupported Météo-France geometry: {key} is not {value}")
    ni, nj = ec.codes_get(handle, "Ni"), ec.codes_get(handle, "Nj")
    di = ec.codes_get(handle, "iDirectionIncrementInDegrees")
    dj = ec.codes_get(handle, "jDirectionIncrementInDegrees")
    spacing = spec["spacing"]
    if abs(di - spacing) > 1e-9 or abs(dj - spacing) > 1e-9:
        raise ValueError(f"Expected the {spacing}° {spec['modelName']} grid")
    lon0 = (ec.codes_get(handle, "longitudeOfFirstGridPointInDegrees") + 180) % 360 - 180
    lat0 = ec.codes_get(handle, "latitudeOfFirstGridPointInDegrees")
    lons, lats = lon0 + np.arange(ni) * di, lat0 - np.arange(nj) * dj
    if any(abs(a - b) > spacing / 2 for a, b in
           zip((lon0, lats[-1], lons[-1], lat0), spec["domain"])):
        raise ValueError(f"Unexpected {spec['modelName']} domain "
                         f"({lon0:.3f}, {lats[-1]:.3f}, {lons[-1]:.3f}, {lat0:.3f})")
    # ecCodes is the independent witness that the lattice is where we think it is.
    decoded_lon = (ec.codes_get_array(handle, "longitudes") + 180) % 360 - 180
    decoded_lat = ec.codes_get_array(handle, "latitudes")
    if (decoded_lon.size != ni * nj
            or np.max(np.abs(decoded_lon.reshape(nj, ni) - lons)) > 1e-6
            or np.max(np.abs(decoded_lat.reshape(nj, ni) - lats[:, None])) > 1e-6):
        raise ValueError("Declared geometry disagrees with the decoded coordinates")
    west, south, east, north = spec["bbox"]
    tolerance = spacing / 100
    first = int(np.searchsorted(lons, west - tolerance))
    last = int(np.searchsorted(lons, east + tolerance, side="right")) - 1
    top = int(np.searchsorted(-lats, -north - tolerance))
    bottom = int(np.searchsorted(-lats, -south + tolerance, side="right")) - 1
    if last - first < 1 or bottom - top < 1:
        raise ValueError(f"The {spec['modelName']} crop falls outside the model domain")
    rows, columns = np.arange(top, bottom + 1), np.arange(first, last + 1)
    grid = {"width": len(columns), "height": len(rows),
            "west": round(float(lons[first]), 6), "east": round(float(lons[last]), 6),
            "north": round(float(lats[top]), 6), "south": round(float(lats[bottom]), 6),
            "dx": round(di, 6), "dy": round(dj, 6),
            "order": "north-to-south, west-to-east", "units": "m/s"}
    return {"signature": tuple(ec.codes_get(handle, key) for key in GEOMETRY),
            "selected": (rows[:, None] * ni + columns).ravel(), "grid": grid}


def validate(handle, run, hour, spec):
    """Which of our three fields this message is, checked by number not by name."""
    ec.codes_set(handle, "stepUnits", 1)
    if ec.codes_get(handle, "centre") != "lfpw":
        raise ValueError("Expected a Météo-France (lfpw) message")
    identity = (ec.codes_get(handle, "discipline"), ec.codes_get(handle, "parameterCategory"),
                ec.codes_get(handle, "parameterNumber"),
                ec.codes_get(handle, "productDefinitionTemplateNumber"))
    field = FIELDS.get(identity)
    if field is None:
        raise ValueError(f"Unexpected Météo-France parameter {identity}")
    if (ec.codes_get(handle, "typeOfLevel"), ec.codes_get(handle, "level")) != ("heightAboveGround", 10):
        raise ValueError(f"Unexpected level for {field}")
    if ec.codes_get(handle, "units") not in ("m s**-1", "m s-1"):
        raise ValueError("Expected wind speed in metres per second")
    if ec.codes_get(handle, "typeOfProcessedData") != "fc":
        raise ValueError("Expected a deterministic forecast, not an analysis or a member")
    # AROME's bitmap marks every point outside its rotated native domain. Make
    # those points NaN so one finiteness test on the crop catches them, instead
    # of 9999 m/s slipping through a range check.
    ec.codes_set_double(handle, "missingValue", float("nan"))
    interval = None
    if field == "gust":
        # Read the maximum's window from the statistical keys, never from the
        # parameter number: FF_RAF is the one-hour maximum ending at the frame.
        if (ec.codes_get(handle, "typeOfStatisticalProcessing") != 2
                or ec.codes_get(handle, "indicatorOfUnitForTimeRange") != 1
                or ec.codes_get(handle, "lengthOfTimeRange") != GUST_WINDOW_HOURS
                or ec.codes_get(handle, "stepType") != "max"):
            raise ValueError(f"Expected a {GUST_WINDOW_HOURS}-hour maximum gust")
        interval = [hour - GUST_WINDOW_HOURS, hour]
    elif ec.codes_get(handle, "stepType") != "instant":
        raise ValueError(f"Expected an instantaneous {field} field")
    if (ec.codes_get(handle, "startStep"), ec.codes_get(handle, "endStep")) != (
            interval[0] if interval else hour, hour):
        raise ValueError(f"Forecast lead time mismatch for {field}")
    if f'{ec.codes_get(handle, "dataDate")}{ec.codes_get(handle, "dataTime"):04d}' != run + "00":
        raise ValueError("Mixed forecast runs")
    expected = datetime.strptime(run, "%Y%m%d%H") + timedelta(hours=hour)
    if (f'{ec.codes_get(handle, "validityDate")}{ec.codes_get(handle, "validityTime"):04d}'
            != expected.strftime("%Y%m%d%H%M")):
        raise ValueError(f"Valid time mismatch for {field}")
    return field, interval


def values(handle, field):
    """Unpack one CCSDS-packed field, naming libaec if ecCodes cannot."""
    try:
        return ec.codes_get_values(handle)
    except Exception as error:
        if ec.codes_get(handle, "dataRepresentationTemplateNumber") == 42:
            raise ValueError(
                f"ecCodes cannot unpack the CCSDS/AEC-packed Météo-France {field} field. "
                "Install an eccodes build with libaec (the manylinux and macOS wheels of "
                f"eccodes>=2.35 carry it): {error}") from error
        raise


def decode(path, run, hour, spec, layout=None):
    """Validate and crop one cached forecast hour's messages."""
    fields, interval = {}, None
    for message in messages(path.read_bytes()):
        handle = ec.codes_new_from_message(message)
        try:
            field, window = validate(handle, run, hour, spec)
            if field in fields:
                raise ValueError(f"Duplicate {field} message at +{hour:03d}h")
            if layout is None:
                layout = make_layout(handle, spec)
            elif tuple(ec.codes_get(handle, key) for key in GEOMETRY) != layout["signature"]:
                raise ValueError("The forecast grid changed within a run")
            cropped = values(handle, field)[layout["selected"]]
            if (not np.all(np.isfinite(cropped)) or np.any(np.abs(cropped) > MAX_SPEED)
                    or (field == "gust" and np.any(cropped < 0))):
                raise ValueError(
                    f"Missing or implausible {field} values at +{hour:03d}h. A masked cell "
                    "means the crop has reached the edge of the model's native domain, "
                    f"which for {spec['modelName']} is smaller than its lat/lon box.")
            fields[field] = np.round(cropped, 2).tolist()
            if window is not None:
                interval = window
        finally:
            ec.codes_release(handle)
    if set(fields) != set(fields_for(hour)):
        raise ValueError(f"Incomplete wind or gust fields at +{hour:03d}h")
    fields.setdefault("gust", None)
    return fields, interval, layout


def coverage(spots, grid, sample_values):
    """Riding locations the crop can resolve, and the ones it cannot.

    The grid never moves within a run, so one test at the first step decides for
    every hour. A location outside the crop keeps its place in `spotForecasts`
    with null values: a missing key would look like a catalogue change."""
    inside = [spot["id"] for spot in spots
              if sample(grid, sample_values, spot["lon"], spot["lat"]) is not None]
    return set(inside), [spot["id"] for spot in spots if spot["id"] not in set(inside)]


def refresh(spec, args, prose):
    """Fetch, validate, crop and atomically publish one run of one model."""
    model = spec["model"]
    if not args.step <= args.hours <= spec["horizon"] or args.hours % args.step:
        raise ValueError(f"Use {args.step}–{spec['horizon']} hours divisible by the step")
    hours = list(range(0, args.hours + 1, args.step))
    pool = SessionPool(args.workers)
    try:
        run, groups = discover(args.source, pool.session(), spec, hours, args.run)
        run_time = run_datetime(spec, run)
        age = (datetime.now(timezone.utc) - run_time).total_seconds() / 3600
        if not -1 <= age <= MAX_AGE_HOURS:
            raise ValueError(f"Refusing a stale/future {spec['modelName']} run "
                             f"(maximum age {MAX_AGE_HOURS} hours)")
        print(f"Fetching {spec['modelName']} {spec['resolutionLabel']} {run} via {args.source}: "
              f"{len(hours)} frames through +{args.hours}h", flush=True)
        cache = ROOT / ".cache" / "meteofrance" / model / run
        cache.mkdir(parents=True, exist_ok=True)
        located = index(pool, spec, run, groups, hours, cache)
        paths = dict(pool.map(
            lambda session, hour: (hour, download(session, spec, groups, located, hour, cache)),
            hours))
        print(f"Downloaded {pool.bytes / 1e6:.1f} MB in {pool.requests} requests. "
              "Validating and cropping…", flush=True)
    finally:
        pool.close()

    output = ROOT / "public" / "weather"
    prefix = f"{model}-{run}-{args.hours}h-v1"
    spots = load_spots()
    print(f"Sampling {len(spots)} spots from {spots_file()}", flush=True)
    series = {spot["id"]: [] for spot in spots}
    frames, layout, inside, outside = [], None, None, []
    for hour in hours:
        fields, interval, layout = decode(paths[hour], run, hour, spec, layout)
        grid = layout["grid"]
        valid = (run_time + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
        payload = {"model": model, "run": run, "hour": hour, "validTime": valid, "grid": grid,
                   "gustIntervalHours": interval, **fields}
        name = publish_frame(output, prefix, payload)
        frames.append({"hour": hour, "validTime": valid, "url": f"weather/{name}",
                       "gustIntervalHours": interval})
        if inside is None:
            inside, outside = coverage(spots, grid, fields["u"])
            if not inside:
                raise ValueError(f"No riding location falls inside the {spec['modelName']} crop")
            if outside:
                print(f"Outside the {spec['modelName']} domain, no series for: "
                      f"{', '.join(outside)}", file=sys.stderr)
        for spot in spots:
            point = {field: (sample(grid, fields[field], spot["lon"], spot["lat"])
                             if fields[field] is not None and spot["id"] in inside else None)
                     for field in ("u", "v", "gust")}
            series[spot["id"]].append({"hour": hour, "validTime": valid, **point})
        print(f"  Validated +{hour:03d}h — {grid['width']} × {grid['height']}"
              f"{f'; gust maximum over [{interval[0]},{interval[1]}]h' if interval else ''}",
              flush=True)
    note = prose["coverageNote"]
    if outside:
        note += (" Outside it, and published with null values: "
                 + ", ".join(sorted(outside)) + ".")
    manifest = {
        "schemaVersion": 1, "model": model, "modelName": spec["modelName"],
        "provider": spec["provider"], "modelDetail": spec["modelDetail"],
        "resolutionKm": spec["resolutionKm"], "resolutionLabel": spec["resolutionLabel"],
        "run": run, "runTime": run_time.isoformat().replace("+00:00", "Z"),
        "generatedAt": datetime.now(timezone.utc).isoformat(), "stepHours": args.step,
        "grid": layout["grid"], "encoding": FRAME_ENCODING, "frames": frames,
        "spotForecasts": series,
        "gustAvailable": True, "gustMissingHours": [0], "coverageNote": note,
        "gustDescription": prose["gustDescription"], "processing": prose["processing"],
        "sourceUrl": SOURCE_URL, "attribution": ATTRIBUTION, "licenseUrl": LICENCE_URL,
    }
    # Only this final operation advances the published snapshot.
    write_json(output / f"{model}.json", manifest)
    print(f"Published {len(frames)} {spec['modelName']} frames to "
          f"{output / f'{model}.json'}", flush=True)
