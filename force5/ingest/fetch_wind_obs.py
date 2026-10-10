"""Observed wind at Ireland's weather stations and buoys, for verifying the forecasts.

Until this existed nothing recorded what the wind actually did, so nothing could
say which model had been right. These are **observations, not a forecast**: each
reading is a measurement as its network published it, converted to metres per
second (the pipeline's unit) and quality-controlled, never filled, smoothed or
moved to a time it was not taken at.

Two open networks, both CC BY 4.0:

  met-eireann       Met Éireann's synoptic and automatic stations, hourly, from its
                    OGC EDR observations API (opendata2.met.ie/edr), which keeps
                    about six days. The speed is the hour's mean of 3-second
                    samples, the gust the hour's highest 3-second sample, and the
                    direction the 3-second direction at the top of the hour. The
                    feed covers 21 stations; Dublin, Shannon and Cork airports are
                    not among them, and Knock, Markree Castle and Phoenix
                    Park report no wind at all.
  marine-institute  the Irish Weather Buoy Network (M2-M6) from Marine Institute
                    ERDDAP, hourly, as the buoys report it.

The Commissioners of Irish Lights MetOcean page is not read: it publishes no
machine-readable feed and no open licence, only preliminary data with a
disclaimer.

Each network is fetched independently: one that is down (ERDDAP answers 504 for
hours at a time) costs only its own stations for that hour, because the manifest
is rebuilt from each source's own recent history every time and the archive keeps
everything it has ever seen. The manifest carries the last 72 hours, so the
hourly archive job can miss two whole days and still lose nothing.

`run` is the newest observation hour, so the registry's freshness limit measures
how old the data is rather than when the job ran.
"""
import argparse
import csv
from datetime import datetime, timedelta, timezone
import io
import json
import math
from pathlib import Path
import re
import sys
import time
from urllib.parse import quote

import requests

from fetch_forecast import ROOT, write_json
import timing

MANIFEST = "marine/wind-observations.json"
STATIONS_FILE = Path(__file__).with_name("wind_stations.json")
USER_AGENT = "Force5/0.1 (wingfoil.ie prototype)"
SESSION = timing.count_responses(requests.Session())

WINDOW_HOURS = 72
KNOTS_TO_MPS = 0.514444
# QC limits, in m/s. The strongest gust measured in Ireland is about 51 m/s
# (Kilkeel, 1974), so anything past these is an instrument or decoding fault.
MAX_SPEED_MPS, MAX_GUST_MPS = 75.0, 90.0
# A gust is the hour's highest sample and the speed its mean, so a gust below the
# speed is impossible; the allowance only absorbs the sources' own rounding.
GUST_SLACK_MPS = 0.15
# A wind vane or cup that sticks reports the same value hour after hour. Real wind
# does not hold a non-zero speed to a hundredth of a knot for six hours; a source
# that reports whole knots can, so it is given twice as long (`STUCK_RUNS`).
STUCK_RUN = 6
# Met Éireann reports hundredths of a knot; the buoys' resolution is coarser.
STUCK_RUNS = {"met-eireann": STUCK_RUN, "marine-institute": 2 * STUCK_RUN}
CALM_MPS = 0.5  # Below this a direction is a vane's resting place, not the wind's.
STUCK_DIRECTION_MIN_MPS = 1.0
MISSING_SENTINEL = -99  # Met Éireann's "no sensor".
CLASSES = ("buoy", "coastal", "inland")

EDR = "https://opendata2.met.ie/edr/collections/observations-swob-nrt-60min"
EDR_PARAMETERS = {"wind_speed_mean": "speed", "wind_gust": "gust", "wind_direction": "direction"}
ERDDAP = "https://erddap.marine.ie/erddap/tabledap"
IWB_COLUMNS = ["station_id", "latitude", "longitude", "time", "WindSpeed", "Gust",
               "WindDirection", "QC_Flag"]
IWB_GOOD_FLAGS = (0, 1)  # SeaDataNet: 0 unknown (real-time rows), 1 good.
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"

# `sourceUrl`, never `url`: the pruner reads every "url" in a manifest as an object
# the manifest references, and an https address is not one.
SOURCES = {
    "met-eireann": {
        "name": "Met Éireann hourly station observations (OGC EDR, near real time)",
        "sourceUrl": "https://opendata2.met.ie/obs_public/",
        "licence": "CC BY 4.0", "licenseUrl": LICENSE_URL,
        "attribution": "Contains Met Éireann data, licensed under CC BY 4.0. "
                       "Met Éireann does not accept any liability whatsoever for any "
                       "error or omission in the data, their availability, or for any "
                       "loss or damage arising from their use.",
        "speedKind": "Mean of the hour's 3-second samples, ending at the reading time",
        "gustKind": "Highest 3-second sample in the hour ending at the reading time",
        "directionKind": "3-second direction at the reading time, degrees true",
    },
    "marine-institute": {
        "name": "Marine Institute Irish Weather Buoy Network (ERDDAP IWBNetwork)",
        "sourceUrl": "https://erddap.marine.ie/erddap/tabledap/IWBNetwork.html",
        "licence": "CC BY 4.0", "licenseUrl": LICENSE_URL,
        "attribution": "Weather buoy data © Marine Institute, CC BY 4.0",
        "speedKind": "Buoy wind speed as the network reports it each hour",
        "gustKind": "Buoy gust as the network reports it each hour",
        "directionKind": "Buoy wind direction, degrees true",
    },
}
NOTICE = ("Observations, not forecasts. Any public display of these readings must credit "
          "Met Éireann and the Marine Institute as above, and must also show Met Éireann's "
          "current weather warnings (https://www.met.ie/warnings), as Met Éireann's open "
          "data terms ask of a public weather display.")


def stamp(value):
    return value.isoformat().replace("+00:00", "Z")


def moment(value):
    at = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return at if at.tzinfo else at.replace(tzinfo=timezone.utc)


def finite(value):
    """A finite float, or None for NaN, a missing-sensor sentinel or text."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number == MISSING_SENTINEL:
        return None
    return number


def to_mps(value, units):
    """Convert a speed from the units its source declares. Unknown units are refused."""
    if value is None:
        return None
    unit = (units or "").strip().lower().replace(" ", "")
    if unit in ("kn", "kt", "kts", "knot", "knots"):
        return value * KNOTS_TO_MPS
    if unit in ("m/s", "ms-1", "m.s-1", "ms^-1", "meters/second", "metres/second"):
        return value
    raise ValueError(f"Unknown wind speed units {units!r}")


def get(url, attempts=3, params=None):
    for attempt in range(attempts):
        try:
            response = SESSION.get(url, params=params, timeout=(15, 120),
                                   headers={"User-Agent": USER_AGENT})
            if response.status_code == 404 and "nRows = 0" in response.text:
                return None  # ERDDAP's way of saying "no rows in that window".
            response.raise_for_status()
            return response
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(2 ** attempt)


def load_catalogue(path=STATIONS_FILE):
    """The committed station list: class, height and a position for each station."""
    stations = json.loads(Path(path).read_text())["stations"]
    catalogue = {}
    for station in stations:
        if station["class"] not in CLASSES or station["id"] in catalogue:
            raise ValueError(f"Bad or duplicated station {station['id']} in {path}")
        catalogue[station["id"]] = station
    return catalogue


# --- quality control -----------------------------------------------------------

def qc_readings(readings, stuck_run=STUCK_RUN):
    """Quality-control one station's readings; return (kept, rejection counts).

    `readings` are dicts with `time` (aware datetime), `speed`, `gust` and
    `direction` (m/s, m/s, degrees from), any of which may be None. In order:

    - **duplicate**: a second reading at the same time is dropped.
    - **missing**: no speed at all. The reading is dropped.
    - **range**: a speed outside 0..75 m/s drops the reading; a gust outside 0..90
      m/s or a direction outside 0..360° drops only that value (`gustRange`,
      `directionRange`), because the other measurements are independent sensors.
    - **gustBelowSpeed**: a gust under the hour's mean cannot be right; the gust is
      dropped and the speed kept.
    - **stuck**: six (`stuck_run`) or more consecutive hourly readings with the
      same non-zero speed are a frozen sensor: every one of them is dropped. A run of the same
      direction while the wind blows is a frozen vane: those directions are dropped
      (`stuckDirection`).
    - a direction at a calm speed is dropped without counting as a fault: a vane at
      rest points wherever it stopped.

    Nothing is repaired, interpolated or moved; a dropped value is simply absent.
    """
    counts = {}

    def reject(reason, amount=1):
        counts[reason] = counts.get(reason, 0) + amount

    seen, ordered = set(), []
    for reading in sorted(readings, key=lambda item: item["time"]):
        if reading["time"] in seen:
            reject("duplicate")
            continue
        seen.add(reading["time"])
        ordered.append(dict(reading))
    kept = []
    for reading in ordered:
        speed, gust, heading = reading["speed"], reading["gust"], reading["direction"]
        if speed is None:
            reject("missing")
            continue
        if not 0 <= speed <= MAX_SPEED_MPS:
            reject("range")
            continue
        if gust is not None and not 0 <= gust <= MAX_GUST_MPS:
            reject("gustRange")
            gust = None
        if gust is not None and gust + GUST_SLACK_MPS < speed:
            reject("gustBelowSpeed")
            gust = None
        if heading is not None and not 0 <= heading <= 360:
            reject("directionRange")
            heading = None
        if heading is not None and speed < CALM_MPS:
            heading = None
        if heading == 360:
            heading = 0.0
        kept.append({**reading, "gust": gust, "direction": heading})
    kept = drop_stuck_speeds(kept, reject, stuck_run)
    drop_stuck_directions(kept, reject, stuck_run)
    return kept, counts


def consecutive(previous, current):
    return current["time"] - previous["time"] == timedelta(hours=1)


def runs(readings, key):
    """Index ranges [start, end) of consecutive hourly readings sharing one value."""
    start = 0
    for index in range(1, len(readings) + 1):
        if index == len(readings) or not consecutive(readings[index - 1], readings[index]) \
                or key(readings[index]) != key(readings[start]):
            yield start, index
            start = index


def drop_stuck_speeds(readings, reject, stuck_run=STUCK_RUN):
    stuck = set()
    for start, end in runs(readings, lambda reading: reading["speed"]):
        if end - start >= stuck_run and readings[start]["speed"] > 0:
            stuck.update(range(start, end))
    if stuck:
        reject("stuck", len(stuck))
    return [reading for index, reading in enumerate(readings) if index not in stuck]


def drop_stuck_directions(readings, reject, stuck_run=STUCK_RUN):
    for start, end in runs(readings, lambda reading: reading["direction"]):
        windy = all(reading["speed"] >= STUCK_DIRECTION_MIN_MPS
                    for reading in readings[start:end])
        if end - start >= stuck_run and readings[start]["direction"] is not None and windy:
            for reading in readings[start:end]:
                reading["direction"] = None
            reject("stuckDirection", end - start)


# --- Met Éireann (OGC EDR) -----------------------------------------------------

def edr_locations(fetch=None):
    """Every station the hourly collection serves, by its EDR location id."""
    fetch = fetch or (lambda url: get(url).json())
    features = fetch(f"{EDR}/locations?f=json").get("features") or []
    stations = {}
    for feature in features:
        properties = feature.get("properties") or {}
        wmo = properties.get("wmo_synop_no")
        lat, lon = finite(properties.get("dd_lat")), finite(properties.get("dd_lon"))
        if not isinstance(wmo, int) or lat is None or lon is None:
            continue
        stations[str(feature.get("id", properties.get("station_id")))] = {
            "id": f"ME_{wmo:05d}", "sourceName": str(properties.get("station_name", "")).strip(),
            "lat": round(lat, 5), "lon": round(lon, 5),
            "elevationM": finite(properties.get("elevation"))}
    return stations


def edr_readings(payload, units):
    """Group an EDR location answer's flat items into one reading per time."""
    by_time = {}
    for item in payload.get("items") or []:
        field = EDR_PARAMETERS.get(item.get("parameter_name"))
        if field is None or not isinstance(item.get("observed_at"), str):
            continue
        at = moment(item["observed_at"])
        reading = by_time.setdefault(at, {"time": at, "speed": None, "gust": None,
                                          "direction": None})
        value = finite(item.get("value_num"))
        reading[field] = value if field == "direction" else to_mps(value, units[field])
    return list(by_time.values())


def fetch_met_eireann(start, end, catalogue, fetch=None):
    """{station id: station with raw readings} from Met Éireann's hourly EDR feed."""
    fetch = fetch or (lambda url: get(url).json())
    units = {"speed": "kts", "gust": "kts", "direction": "deg"}
    stations = {}
    for location, found in sorted(edr_locations(fetch).items()):
        query = (f"{EDR}/locations/{quote(location)}?datetime={stamp(start)}/{stamp(end)}"
                 f"&parameter-name={','.join(EDR_PARAMETERS)}&f=json")
        payload = fetch(query)
        known = catalogue.get(found["id"], {})
        stations[found["id"]] = {
            **found, "name": known.get("name") or found["sourceName"],
            "source": "met-eireann", "class": known.get("class", "inland"),
            "classified": bool(known), "heightM": known.get("heightM", 10),
            "sourceId": location, "readings": edr_readings(payload, units)}
    return stations


# --- Marine Institute (ERDDAP IWBNetwork) ---------------------------------------

def iwb_query(start, end):
    columns = ",".join(IWB_COLUMNS)
    return (f"{ERDDAP}/IWBNetwork.csv?{quote(columns)}"
            f"&time{quote('>=')}{stamp(start)}&time{quote('<=')}{stamp(end)}")


def iwb_readings(text, catalogue):
    """{station id: station with raw readings} from an IWBNetwork CSV answer.

    ERDDAP's second line declares each column's units, and the speeds are
    converted from what it says rather than from what we expect it to say. A row
    the network itself flags as bad is dropped and counted (`flagged`).
    """
    if not text or not text.strip():
        return {}, 0
    reader = csv.reader(io.StringIO(text))
    header, units = next(reader, None), next(reader, None)
    if header != IWB_COLUMNS or units is None:
        raise ValueError(f"Unexpected IWBNetwork columns: {header}")
    unit = dict(zip(header, units))
    stations, flagged = {}, 0
    for row in reader:
        if not row:
            continue
        record = dict(zip(header, row))
        name = record["station_id"].strip()
        lat, lon = finite(record["latitude"]), finite(record["longitude"])
        if not re.fullmatch(r"[A-Za-z0-9]{1,16}", name) or lat is None or lon is None:
            flagged += 1
            continue
        flag = finite(record["QC_Flag"])
        if flag is not None and int(flag) not in IWB_GOOD_FLAGS:
            flagged += 1
            continue
        identifier = f"MI_{name}"
        known = catalogue.get(identifier, {})
        station = stations.setdefault(identifier, {
            "id": identifier, "name": known.get("name") or f"{name} weather buoy",
            "sourceName": name, "lat": round(lat, 5), "lon": round(lon, 5),
            "elevationM": 0, "source": "marine-institute", "class": "buoy",
            "classified": True, "heightM": known.get("heightM"), "sourceId": name,
            "readings": []})
        # A moored buoy reports the position of the day; publish the newest.
        station["lat"], station["lon"] = round(lat, 5), round(lon, 5)
        station["readings"].append({
            "time": moment(record["time"]),
            "speed": to_mps(finite(record["WindSpeed"]), unit["WindSpeed"]),
            "gust": to_mps(finite(record["Gust"]), unit["Gust"]),
            "direction": finite(record["WindDirection"])})
    return stations, flagged


def fetch_text(url):
    response = get(url)
    return "" if response is None else response.text


def fetch_marine_institute(start, end, catalogue, fetch=None):
    return iwb_readings((fetch or fetch_text)(iwb_query(start, end)), catalogue)


# --- the manifest --------------------------------------------------------------

def compact(reading):
    """[time, speed, gust, direction]: m/s to 0.1, whole degrees, None where absent."""
    def tenth(value):
        return None if value is None else round(value, 1)
    heading = reading["direction"]
    return [stamp(reading["time"]), tenth(reading["speed"]), tenth(reading["gust"]),
            None if heading is None else round(heading) % 360]


def build_manifest(stations, statuses, rejected, now, window_hours=WINDOW_HOURS):
    """The published bundle from QC'd stations; refuses to publish no readings at all."""
    published, newest = {}, None
    for identifier, station in sorted(stations.items()):
        readings = station["readings"]
        if not readings:
            continue
        rows = [compact(reading) for reading in readings]
        latest = rows[-1]
        newest = readings[-1]["time"] if newest is None else max(newest, readings[-1]["time"])
        source = SOURCES[station["source"]]
        published[identifier] = {
            "name": station["name"], "sourceName": station["sourceName"],
            "lat": station["lat"], "lon": station["lon"], "source": station["source"],
            "class": station["class"], "heightM": station["heightM"],
            "elevationM": station.get("elevationM"), "sourceId": station["sourceId"],
            "speedKind": source["speedKind"], "gustKind": source["gustKind"],
            "latest": {"time": latest[0], "speed": latest[1], "gust": latest[2],
                       "direction": latest[3]},
            "readings": rows}
    if not published:
        raise ValueError("No station published a usable wind reading in the window")
    run = newest.replace(minute=0, second=0, microsecond=0)
    start = run - timedelta(hours=window_hours)
    return {
        "schemaVersion": 1, "kind": "observation", "observes": "wind", "model": "wind-obs",
        "modelName": "Irish wind observations", "provider": "Met Éireann and Marine Institute",
        "modelDetail": "Measured wind at weather stations and buoys, for forecast verification",
        "run": run.strftime("%Y%m%d%H"), "runTime": stamp(run), "generatedAt": stamp(now),
        "observed": True,
        "units": {"speed": "m/s", "gust": "m/s", "direction": "degrees true, blowing from"},
        "readingFields": ["time", "speed", "gust", "direction"],
        "windowHours": window_hours,
        "observationWindow": {"from": stamp(start), "to": stamp(newest)},
        "stations": published,
        "qc": {"rules": qc_readings.__doc__.split("\n\n", 1)[1].strip(),
               "rejected": rejected},
        "sources": {key: {**{k: v for k, v in SOURCES[key].items()
                             if k not in ("speedKind", "gustKind", "directionKind")},
                          **statuses.get(key, {"status": "not-read"})}
                    for key in SOURCES},
        "attribution": " ".join(SOURCES[key]["attribution"] for key in SOURCES),
        "licenseUrl": LICENSE_URL, "notice": NOTICE,
    }


def collect(start, end, catalogue, now, fetchers=None):
    """Every source's QC'd stations, with a status per source. One failure is not fatal."""
    fetchers = fetchers or {"met-eireann": lambda: (fetch_met_eireann(start, end, catalogue), 0),
                            "marine-institute": lambda: fetch_marine_institute(start, end, catalogue)}
    stations, statuses, rejected = {}, {}, {}
    for key, fetch in fetchers.items():
        try:
            found, flagged = fetch()
        except Exception as error:
            statuses[key] = {"status": "failed", "error": str(error)[:300]}
            print(json.dumps({"event": "observation_source_failed", "source": key,
                              "error": str(error)[:300]}), file=sys.stderr, flush=True)
            continue
        counts = {"flagged": flagged} if flagged else {}
        kept_readings = 0
        for identifier, station in found.items():
            window = [reading for reading in station["readings"]
                      if start <= reading["time"] <= now + timedelta(minutes=5)]
            future = len(station["readings"]) - len(window)
            if future:
                counts["outsideWindow"] = counts.get("outsideWindow", 0) + future
            kept, faults = qc_readings(window, STUCK_RUNS.get(key, STUCK_RUN))
            for reason, amount in faults.items():
                counts[reason] = counts.get(reason, 0) + amount
            if kept and not station.get("classified", True):
                print(json.dumps({"event": "station_unclassified", "station": identifier,
                                  "name": station["name"], "class": station["class"]}),
                      file=sys.stderr, flush=True)
            if identifier in stations:
                raise ValueError(f"Station id {identifier} is published by two sources")
            stations[identifier] = {**station, "readings": kept}
            kept_readings += len(kept)
        statuses[key] = {"status": "ok", "stations": sum(1 for s in found.values()),
                         "readings": kept_readings}
        rejected[key] = counts
    return stations, statuses, rejected


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--hours", type=int, default=WINDOW_HOURS,
                        help="How far back the published readings reach")
    args = parser.parse_args(argv)
    if not 6 <= args.hours <= 144:
        parser.error("Use a 6-144 hour window")
    now = datetime.now(timezone.utc)
    end = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    start = end - timedelta(hours=args.hours + 1)
    timing.start("download")
    stations, statuses, rejected = collect(start, end, load_catalogue(), now)
    timing.start("decode")
    for key, status in statuses.items():
        print(f"  {key}: {json.dumps(status)}; rejected {json.dumps(rejected.get(key, {}))}",
              flush=True)
    manifest = build_manifest(stations, statuses, rejected, now, args.hours)
    out = ROOT / "public" / MANIFEST
    write_json(out, manifest)
    print(f"Wind observations to {manifest['observationWindow']['to']}: "
          f"{len(manifest['stations'])} stations, "
          f"{sum(len(s['readings']) for s in manifest['stations'].values())} readings, "
          f"written to {out}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Wind observation refresh failed: {error}. Last published observations preserved.",
              file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
