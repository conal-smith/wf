"""In-situ sea temperature for every riding location, from Marine Institute ERDDAP.

These are **observations, not a forecast**. Nothing here is modelled, interpolated
or extrapolated: each spot is given the nearest station that has actually reported
recently, its latest quality-controlled reading, and a subsampled recent series for
a sparkline. A spot with no station in range is published with a stated reason
rather than being attached to a buoy that says nothing about its water.

Three live networks are read, preferred in this order, because water at a beach is
not the same water as the open shelf: in summer an offshore buoy reads colder than
a bay and in winter warmer, so a near-shore station in range beats a closer-looking
offshore one.

  coastal   ICTempNetwork      shore logger sites in the aquaculture bays
  sentinel  compass_mace_head, sentinel_lehanagh   inshore moored met-ocean buoys
  buoy      IWBNetwork         the offshore weather buoys M2-M6

`run` is the newest published observation hour, not an ingest time, so the
registry's freshness limit measures how old the data is rather than how long ago
the job ran.
"""
import argparse
import csv
from datetime import datetime, timedelta, timezone
import io
import json
import math
import re
import sys
import time
from urllib.parse import quote

import requests

from fetch_forecast import ROOT, load_spots, write_json
import timing

ERDDAP = "https://erddap.marine.ie/erddap/tabledap"
SOURCE_URL = "https://erddap.marine.ie/erddap/search/index.html?searchFor=sea+temperature"
ATTRIBUTION = "Sea temperature © Marine Institute, CC BY 4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
USER_AGENT = "Force5/0.1 (wingfoil.ie prototype)"

MAX_DISTANCE_KM = 60.0
MAX_OBSERVATION_AGE_HOURS = 48.0  # Matches the registry limit for this model.
SERIES_DAYS = 7
STEP_MINUTES = 180  # The published series step; a coarser source is simply sparser.
MIN_CELSIUS, MAX_CELSIUS = -2.0, 35.0
SINGLE_FILE_LIMIT_BYTES = 300 * 1024
# A deployment-record suffix on a station name, trimmed for display only.
DEPLOYMENT_SUFFIX = re.compile(r"\s+(Buoy\s+)?Deployment\s+Location$", re.IGNORECASE)
NETWORK_RANK = {"coastal": 0, "sentinel": 1, "buoy": 2}
SESSION = timing.count_responses(requests.Session())


class Source:
    """One ERDDAP table that publishes an in-situ sea temperature.

    `good_flags` is None for a dataset with no quality column; those rows pass on
    the physical range check alone, which is stated in the manifest.
    """

    def __init__(self, dataset, network, prefix, station_column, value_column,
                 description, flag_column=None, good_flags=None, depth_column=None,
                 fixed_depth=None):
        self.dataset, self.network, self.prefix = dataset, network, prefix
        self.station_column, self.value_column = station_column, value_column
        self.flag_column, self.good_flags = flag_column, good_flags
        self.depth_column, self.fixed_depth = depth_column, fixed_depth
        self.description = description

    @property
    def columns(self):
        names = [self.station_column, "latitude", "longitude", "time", self.value_column]
        for optional in (self.depth_column, self.flag_column):
            if optional:
                names.append(optional)
        return names

    @property
    def info_url(self):
        return f"https://erddap.marine.ie/erddap/info/{self.dataset}/index.html"


SOURCES = (
    # Delayed-mode logger archive: it is the densest coastal network Ireland has, but
    # sites are downloaded in batches, so most of the time it has nothing recent and
    # contributes no station. QFlag publishes only 1 (good) and 40 (failed).
    Source("ICTempNetwork", "coastal", "IC", "SiteName", "SeaTemperature",
           "Irish Coastal Temperature Network shore loggers",
           flag_column="QFlag", good_flags=(1,), depth_column="Depth"),
    Source("compass_mace_head", "sentinel", "MI", "station_id", "sbe_temp_avg",
           "Mace Head sentinel met-ocean buoy, SBE sensor", depth_column="depth"),
    Source("sentinel_lehanagh", "sentinel", "MI", "station_id", "SBE_Temp_Avg",
           "Lehanagh Pool sentinel met-ocean buoy, SBE sensor", depth_column="depth"),
    # QC_Flag is SeaDataNet: 0 unknown, 1 good, 9 missing. Real-time rows arrive
    # unflagged as 0, so the range check is what actually filters this network.
    Source("IWBNetwork", "buoy", "IWB", "station_id", "SeaTemperature",
           "Irish Weather Buoy Network, offshore buoys M2-M6",
           flag_column="QC_Flag", good_flags=(0, 1)),
)


def stamp(value):
    return value.isoformat().replace("+00:00", "Z")


def moment(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def fetch_csv(url, attempts=3):
    """ERDDAP answers 404 when a query selects no rows; here that means "nothing
    recent from this network", which is normal, so it returns an empty string."""
    for attempt in range(attempts):
        try:
            response = SESSION.get(url, timeout=(15, 120), headers={"User-Agent": USER_AGENT})
            if response.status_code == 404 and "nRows = 0" in response.text:
                return ""
            response.raise_for_status()
            return response.text
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(2 ** attempt)


def rows(text, expected):
    if not text.strip():
        return []
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    next(reader, None)  # ERDDAP's units line.
    if header != expected:
        raise ValueError(f"Unexpected ERDDAP columns: {header}")
    return [row for row in reader if row]


def observation_query(source, start, end):
    columns = ",".join(source.columns)
    return (f"{ERDDAP}/{source.dataset}.csv?{quote(columns)}"
            f"&time{quote('>=')}{stamp(start)}&time{quote('<=')}{stamp(end)}")


def number(text):
    """A finite float, or None for NaN, an empty cell or unparseable text."""
    try:
        value = float(text)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def display_name(name):
    """The published station name without its deployment-record suffix."""
    return DEPLOYMENT_SUFFIX.sub("", name).strip() or name


def station_id(source, name):
    """A stable identifier from the displayed name, namespaced by network."""
    slug = re.sub(r"_+", "_", re.sub(r"[^A-Za-z0-9]+", "_", display_name(name))).strip("_")
    identifier = f"{source.prefix}_{slug}"[:64]
    if not slug or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", identifier):
        raise ValueError(f"{source.dataset}: cannot form a station id from {name!r}")
    return identifier


def read_observations(source, text, now):
    """Group a source's CSV into {station id: station}, keeping only good rows.

    A row is kept when its quality flag is one the network calls usable and its
    value is inside the published physical range. Nothing is repaired.
    """
    stations, rejected = {}, 0
    for row in rows(text, source.columns):
        record = dict(zip(source.columns, row))
        name = record[source.station_column].strip()
        latitude, longitude = number(record["latitude"]), number(record["longitude"])
        value = number(record[source.value_column])
        if not name or latitude is None or longitude is None:
            rejected += 1
            continue
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            raise ValueError(f"{source.dataset}: station {name} has an impossible position")
        at = moment(record["time"])
        if at > now + timedelta(minutes=5):
            raise ValueError(f"{source.dataset}: observation at {record['time']} is in the future")
        flag = number(record[source.flag_column]) if source.flag_column else None
        usable = value is not None and MIN_CELSIUS <= value <= MAX_CELSIUS and (
            source.good_flags is None or (flag is not None and int(flag) in source.good_flags))
        if not usable:
            rejected += 1
            continue
        depth = source.fixed_depth
        if source.depth_column is not None:
            published = number(record[source.depth_column])
            # Some networks publish depth as a negative elevation; below the
            # surface is below the surface, so it is carried as metres down.
            depth = None if published is None else round(abs(published), 1)
        identifier = station_id(source, name)
        station = stations.setdefault(identifier, {
            "id": identifier, "name": display_name(name), "sourceName": name,
            "lat": round(latitude, 5), "lon": round(longitude, 5),
            "network": source.network, "dataset": source.dataset,
            "depth": depth, "sourceUrl": source.info_url, "readings": []})
        if station["sourceName"] != name:
            raise ValueError(f"{source.dataset}: {name!r} and {station['sourceName']!r} "
                             f"both claim the station id {identifier}")
        station["readings"].append((at, round(value, 2)))
    for station in stations.values():
        station["readings"].sort(key=lambda reading: reading[0])
    return stations, rejected


def slot_series(readings, start, end, step_minutes=STEP_MINUTES):
    """Thin readings to roughly one per aligned slot, keeping real measurements.

    Each slot takes the reading nearest to it, and each published entry carries
    that reading's **own** time and value: nothing is averaged, interpolated or
    relabelled onto a grid it was not measured on. A slot with no reading within
    half a step contributes nothing, so a source coarser than the step yields a
    sparser series rather than an invented one, and a reading picked twice by two
    neighbouring slots is published once.
    """
    if not readings:
        return []
    step = timedelta(minutes=step_minutes)
    tolerance = step / 2
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    # No slot past the newest reading: a series never reaches into the future.
    last = min(end, readings[-1][0])
    at = epoch + math.ceil((start - epoch) / step) * step
    series, index, taken = [], 0, None
    while at <= last:
        while (index + 1 < len(readings)
               and abs(readings[index + 1][0] - at) <= abs(readings[index][0] - at)):
            index += 1
        if abs(readings[index][0] - at) <= tolerance and index != taken:
            when, value = readings[index]
            series.append({"time": stamp(when), "value": value})
            taken = index
        at += step
    return series


def distance_km(lat1, lon1, lat2, lon2):
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi, d_lambda = phi2 - phi1, math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(a))


def assign_stations(spots, stations, now, maximum_km=MAX_DISTANCE_KM,
                    maximum_age_hours=MAX_OBSERVATION_AGE_HOURS):
    """Nearest recently-reporting station per spot, coastal networks first."""
    assignments = {}
    for spot in spots:
        ranked, in_range, candidates = [], [], []
        for station in stations.values():
            kilometres = distance_km(spot["lat"], spot["lon"], station["lat"], station["lon"])
            ranked.append((kilometres, station))
            if kilometres > maximum_km:
                continue
            in_range.append((kilometres, station))
            age = (now - station["readings"][-1][0]).total_seconds() / 3600
            if age <= maximum_age_hours:
                candidates.append((NETWORK_RANK[station["network"]], kilometres, station))
        if candidates:
            _, kilometres, station = min(candidates, key=lambda item: (item[0], item[1]))
            latest_at, latest_value = station["readings"][-1]
            assignments[spot["id"]] = {
                "station": station["id"], "distanceKm": round(kilometres, 1),
                "latest": {"time": stamp(latest_at), "value": latest_value},
                "series": station["series"]}
            continue
        nearest = min(ranked, key=lambda item: item[0])
        if in_range:
            stale = min(in_range, key=lambda item: item[0])[1]
            hours = (now - stale["readings"][-1][0]).total_seconds() / 3600
            reason = (f"The nearest station in range ({stale['name']}) last reported "
                      f"{hours:.0f} h ago, beyond the {maximum_age_hours:.0f} h limit.")
        else:
            reason = (f"The nearest reporting station ({nearest[1]['name']}) is "
                      f"{nearest[0]:.0f} km away, beyond the {maximum_km:.0f} km limit.")
        assignments[spot["id"]] = {"station": None, "distanceKm": round(nearest[0], 1),
                                   "reason": reason}
    return assignments


def collect(sources, start, end, now, fetch=None):
    """Every station any source reported in the window, with its slot series.

    `fetch` is resolved here rather than as a default argument, so a caller or a
    test that replaces `fetch_csv` on the module is actually the one used.
    """
    fetch = fetch or fetch_csv
    stations, counts = {}, {}
    for source in sources:
        found, rejected = read_observations(
            source, fetch(observation_query(source, start, end)), now)
        counts[source.dataset] = {"stations": len(found), "rejected": rejected,
                                  "readings": sum(len(s["readings"]) for s in found.values())}
        for identifier, station in found.items():
            if identifier in stations:
                raise ValueError(f"Station id {identifier} is published by two datasets")
            station["series"] = slot_series(station["readings"], start, end)
            if not station["series"]:
                continue  # Readings too sparse to draw; the station is not published.
            stations[identifier] = station
    return stations, counts


def build_manifest(stations, assignments, start, end, now, args):
    newest = max(station["readings"][-1][0] for station in stations.values())
    run = newest.replace(minute=0, second=0, microsecond=0)
    published = {}
    for identifier, station in sorted(stations.items()):
        latest_at, latest_value = station["readings"][-1]
        published[identifier] = {
            "name": station["name"], "sourceName": station["sourceName"],
            "lat": station["lat"], "lon": station["lon"],
            "network": station["network"], "depth": station["depth"],
            "dataset": station["dataset"], "sourceUrl": station["sourceUrl"],
            "observations": len(station["readings"]),
            "latest": {"time": stamp(latest_at), "value": latest_value}}
    return {
        "schemaVersion": 1, "kind": "observation", "model": "sea-temperature",
        "modelName": "Marine Institute in-situ sea temperature",
        "provider": "Marine Institute",
        "modelDetail": "Observed water temperature from coastal loggers and moored buoys",
        # The newest observation hour, so freshness measures the data, not the job.
        "run": run.strftime("%Y%m%d%H"), "runTime": stamp(run),
        "generatedAt": stamp(now),
        "observed": True,
        "variable": {"name": "seaTemperature", "units": "°C",
                     "label": "Sea temperature", "minimum": MIN_CELSIUS, "maximum": MAX_CELSIUS},
        "stepMinutes": STEP_MINUTES,
        "observationWindow": {"from": stamp(start), "to": stamp(newest)},
        "maxDistanceKm": args.max_distance_km,
        "maxObservationAgeHours": args.max_observation_age_hours,
        "networkOrder": [name for name, _ in sorted(NETWORK_RANK.items(), key=lambda i: i[1])],
        "stations": published, "spots": assignments,
        "processing": (
            f"Observations, not a forecast. Each riding location takes the nearest station "
            f"within {args.max_distance_km:.0f} km whose newest good reading is under "
            f"{args.max_observation_age_hours:.0f} h old, preferring coastal sites over "
            f"inshore sentinel buoys over offshore weather buoys, because beach water and "
            f"open-shelf water are not the same water. Values are °C as published, rounded "
            f"to 0.01, kept only inside {MIN_CELSIUS:g}..{MAX_CELSIUS:g} °C and only where "
            f"the network's own quality flag calls them usable; IWBNetwork delivers "
            f"real-time rows unflagged (0 = unknown), so the range check is what filters "
            f"them. The series subsamples the nearest actual reading to each "
            f"{STEP_MINUTES}-minute slot over {SERIES_DAYS} days and interpolates nothing, "
            f"so a slot with no reading within {STEP_MINUTES // 2} minutes is absent and a "
            f"source coarser than the step is simply sparser. Spots with no station in "
            f"range, or none reporting, are published with a stated reason."),
        "source": "Marine Institute ERDDAP " + ", ".join(s.dataset for s in SOURCES),
        "sourceUrl": SOURCE_URL, "attribution": ATTRIBUTION, "licenseUrl": LICENSE_URL,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--max-distance-km", type=float, default=MAX_DISTANCE_KM,
                        help="Refuse a spot whose nearest reporting station is farther")
    parser.add_argument("--max-observation-age-hours", type=float,
                        default=MAX_OBSERVATION_AGE_HOURS,
                        help="Ignore a station whose newest reading is older than this")
    parser.add_argument("--days", type=int, default=SERIES_DAYS,
                        help="Length of the published recent series")
    args = parser.parse_args(argv)
    if not 0 < args.max_distance_km <= 500 or not 0 < args.max_observation_age_hours <= 720:
        parser.error("Use a 0-500 km station limit and a 0-720 h freshness limit")
    if not 1 <= args.days <= 30:
        parser.error("Use a 1-30 day series window")
    now = datetime.now(timezone.utc)
    end = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    start = end - timedelta(days=args.days)
    spots = load_spots()
    timing.start("download")
    stations, counts = collect(SOURCES, start, end, now)
    timing.start("decode")
    for dataset, count in counts.items():
        print(f"  {dataset}: {count['stations']} stations, {count['readings']} good readings, "
              f"{count['rejected']} rejected", flush=True)
    if not stations:
        raise ValueError("No Marine Institute station reported a sea temperature in the window")
    assignments = assign_stations(spots, stations, now, args.max_distance_km,
                                  args.max_observation_age_hours)
    manifest = build_manifest(stations, assignments, start, end, now, args)
    body = json.dumps(manifest, separators=(",", ":"), allow_nan=False)
    if len(body) > SINGLE_FILE_LIMIT_BYTES:
        raise ValueError(f"Manifest is {len(body)} bytes, over the {SINGLE_FILE_LIMIT_BYTES} "
                         "byte single-file limit; split the series into per-station files")
    covered = sum(1 for item in assignments.values() if item["station"])
    print(f"Marine Institute sea temperature {manifest['observationWindow']['from']} → "
          f"{manifest['observationWindow']['to']}: {len(stations)} stations, "
          f"{covered}/{len(spots)} riding locations covered", flush=True)
    # Only this final operation advances the published observations.
    write_json(ROOT / "public" / "marine" / "sea-temperature.json", manifest)
    print(f"Published {len(body)} bytes to "
          f"{ROOT / 'public' / 'marine' / 'sea-temperature.json'}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Sea temperature refresh failed: {error}. Last published observations preserved.",
              file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
