"""Marine Institute tidal predictions for every riding location.

Public ERDDAP tabledap, CC BY 4.0, no account. These are astronomical
*predictions*, not observations or a surge forecast: real water levels differ
with weather. Heights are published above Chart Datum (LAT) with each station's
Ordnance Datum Malin offset carried alongside, so the UI can show either datum
without this importer inventing a conversion.
"""
import argparse
import csv
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import math
import sys
import time
from urllib.parse import quote

import requests

from fetch_forecast import ROOT, load_spots, write_json
import timing

ERDDAP = "https://erddap.marine.ie/erddap/tabledap"
CURVE_DATASET = "imiTidePrediction"
EVENTS_DATASET = "IMI_TidePrediction_HighLow"
SOURCE_URL = "https://erddap.marine.ie/erddap/tabledap/imiTidePrediction.html"
ATTRIBUTION = "Tidal predictions © Marine Institute, CC BY 4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
USER_AGENT = "Force5/0.1 (wingfoil.ie prototype)"
SOURCE_STEP_MINUTES = 5  # The published curve; we republish every second sample.
STEP_MINUTES = 10
DAYS_BEFORE, DAYS_AFTER = 1, 8
MAX_DISTANCE_KM = 40.0
DATUM_TOLERANCE_METRES = 0.03
EVENT_TOLERANCE_METRES = 0.15
SESSION = timing.count_responses(requests.Session())


def fetch_csv(url, attempts=3):
    """ERDDAP answers 404 when a query selects no rows; that is a failure here."""
    for attempt in range(attempts):
        try:
            response = SESSION.get(url, timeout=(15, 120), headers={"User-Agent": USER_AGENT})
            response.raise_for_status()
            return response.text
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(2 ** attempt)


def rows(text, expected):
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    next(reader, None)  # ERDDAP's units line
    if header != expected:
        raise ValueError(f"Unexpected ERDDAP columns: {header}")
    return [row for row in reader if row]


def moment(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def stamp(value):
    return value.isoformat().replace("+00:00", "Z")


def station_catalogue(cache, maximum_age_days=7):
    """Fetched live, then cached: the station list changes at most rarely."""
    path = cache / "stations.csv"
    fresh = path.exists() and (time.time() - path.stat().st_mtime) < maximum_age_days * 86400
    if not fresh:
        text = fetch_csv(f"{ERDDAP}/{CURVE_DATASET}.csv?stationID,longitude,latitude&distinct()")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    catalogue = {}
    for identifier, lon, lat in rows(path.read_text(), ["stationID", "longitude", "latitude"]):
        catalogue[identifier] = {"lon": round(float(lon), 6), "lat": round(float(lat), 6),
                                 # Modelled stations are interpolated, not gauge-derived.
                                 "modelled": identifier.endswith("_MODELLED")}
    if not catalogue:
        raise ValueError("Empty Marine Institute station catalogue")
    return catalogue


def distance_km(lat1, lon1, lat2, lon2):
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi, d_lambda = phi2 - phi1, math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(a))


def assign_stations(spots, catalogue, maximum_km=MAX_DISTANCE_KM):
    """Nearest station by great-circle distance, or an explicit refusal."""
    assignments = {}
    for spot in spots:
        identifier, kilometres = min(
            ((name, distance_km(spot["lat"], spot["lon"], station["lat"], station["lon"]))
             for name, station in catalogue.items()), key=lambda item: item[1])
        if kilometres > maximum_km:
            assignments[spot["id"]] = {"station": None, "distanceKm": round(kilometres, 1),
                                       "reason": f"Nearest Marine Institute station ({identifier}) is "
                                                 f"{kilometres:.0f} km away, beyond the {maximum_km:.0f} km limit."}
        else:
            assignments[spot["id"]] = {"station": identifier, "distanceKm": round(kilometres, 1)}
    return assignments


def window(identifier, start, end):
    return (quote('"%s"' % identifier) + "&time" + quote(">=") + stamp(start)
            + "&time" + quote("<=") + stamp(end))


def curve_query(identifier, start, end):
    return (f"{ERDDAP}/{CURVE_DATASET}.csv?stationID,time,Water_Level,Water_Level_ODM"
            f"&stationID={window(identifier, start, end)}")


def events_query(identifier, start, end):
    # The HighLow dataset publishes modelled stations without the _MODELLED suffix.
    return (f"{ERDDAP}/{EVENTS_DATASET}.csv?stationID,time,tide_time_category,Water_Level_ODMalin"
            f"&stationID={window(identifier.removesuffix('_MODELLED'), start, end)}")


def read_curve(text, identifier, start, end):
    """Return the source 5-minute series plus the station's OD Malin offset."""
    parsed = rows(text, ["stationID", "time", "Water_Level", "Water_Level_ODM"])
    expected = int((end - start).total_seconds() // (SOURCE_STEP_MINUTES * 60)) + 1
    if len(parsed) != expected:
        raise ValueError(f"{identifier}: expected {expected} five-minute samples, received {len(parsed)}")
    curve, offsets = {}, []
    previous = None
    for station, when, level, odm in parsed:
        if station.removesuffix("_MODELLED") != identifier.removesuffix("_MODELLED"):
            raise ValueError(f"{identifier}: ERDDAP returned data for {station}")
        at = moment(when)
        if previous is not None and at - previous != timedelta(minutes=SOURCE_STEP_MINUTES):
            raise ValueError(f"{identifier}: non-monotonic or irregular prediction times")
        previous = at
        height, malin = float(level), float(odm)
        if not (math.isfinite(height) and math.isfinite(malin)) or not -1.0 <= height <= 8.0:
            raise ValueError(f"{identifier}: implausible predicted height {height}")
        curve[at] = round(height, 2)
        offsets.append(height - malin)
    offset = round(sum(offsets) / len(offsets), 3)
    if max(abs(value - offset) for value in offsets) > DATUM_TOLERANCE_METRES:
        raise ValueError(f"{identifier}: LAT and OD Malin series disagree about the datum offset")
    if sorted(curve)[0] != start or sorted(curve)[-1] != end:
        raise ValueError(f"{identifier}: curve does not cover the requested window")
    return curve, offset


def read_events(text, identifier, curve, offset):
    """Heights come back on OD Malin only, so take LAT from the curve itself."""
    parsed = rows(text, ["stationID", "time", "tide_time_category", "Water_Level_ODMalin"])
    events, previous = [], None
    for _, when, category, odm in parsed:
        at = moment(when)
        kind = {"HIGH": "high", "LOW": "low"}.get(category.strip().upper())
        if kind is None:
            raise ValueError(f"{identifier}: unknown tide event category {category!r}")
        if previous is not None and at <= previous:
            raise ValueError(f"{identifier}: misordered high/low events")
        previous = at
        if at not in curve:
            raise ValueError(f"{identifier}: event at {when} has no matching curve sample")
        height = curve[at]
        if abs(height - (float(odm) + offset)) > EVENT_TOLERANCE_METRES:
            raise ValueError(f"{identifier}: event height disagrees with the curve at {when}")
        neighbours = [curve.get(at + timedelta(minutes=SOURCE_STEP_MINUTES * step)) for step in (-1, 1)]
        extreme = all(value is None or (height >= value if kind == "high" else height <= value)
                      for value in neighbours)
        if not extreme:
            raise ValueError(f"{identifier}: {kind} water at {when} is not a curve extreme")
        events.append({"time": stamp(at), "kind": kind, "height": height})
    if len(events) < 2:
        raise ValueError(f"{identifier}: no high/low predictions in the window")
    return events


def station_payload(identifier, curve, offset, events, start, end):
    step = timedelta(minutes=STEP_MINUTES)
    count = int((end - start).total_seconds() // (STEP_MINUTES * 60)) + 1
    # Every published sample is a source sample; nothing is interpolated.
    heights = [curve[start + index * step] for index in range(count)]
    return {"station": identifier, "from": stamp(start), "to": stamp(end),
            "stepMinutes": STEP_MINUTES, "datum": "LAT", "odMalinOffsetMetres": offset,
            "curve": heights, "events": events}


def datum_note(offset):
    return (f"Heights are metres above Chart Datum (LAT). Subtract {offset:.3f} m for "
            "Ordnance Datum Malin. Astronomical prediction only; no surge or wind effect.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-distance-km", type=float, default=MAX_DISTANCE_KM,
                        help="Refuse a spot whose nearest station is farther than this")
    parser.add_argument("--days-ahead", type=int, default=DAYS_AFTER)
    args = parser.parse_args()
    if not 0 < args.max_distance_km <= 500 or not 1 <= args.days_ahead <= 14:
        parser.error("Use a 0–500 km station limit and a 1–14 day horizon")
    now = datetime.now(timezone.utc)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=DAYS_BEFORE)
    end = start + timedelta(days=DAYS_BEFORE + args.days_ahead)
    spots = load_spots()
    timing.start("discover")
    catalogue = station_catalogue(ROOT / ".cache" / "tides")
    assignments = assign_stations(spots, catalogue, args.max_distance_km)
    used = sorted({item["station"] for item in assignments.values() if item["station"]})
    if not used:
        raise ValueError("No riding location is within range of a Marine Institute station")
    print(f"Marine Institute tides {stamp(start)} → {stamp(end)}: "
          f"{len(used)} stations for {len(spots)} riding locations", flush=True)
    output = ROOT / "public" / "marine"
    stations = {}
    # One station at a time, each read and written before the next is asked for.
    timing.start("download", workers=1)
    for identifier in used:
        curve, offset = read_curve(fetch_csv(curve_query(identifier, start, end)), identifier, start, end)
        events = read_events(fetch_csv(events_query(identifier, start, end)), identifier, curve, offset)
        payload = station_payload(identifier, curve, offset, events, start, end)
        with timing.phase("write"):
            digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:12]
            name = (f"tides-{identifier}-{start.strftime('%Y%m%d')}-{end.strftime('%Y%m%d')}-{digest}.json")
            write_json(output / name, payload)
        stations[identifier] = {"name": identifier.removesuffix("_MODELLED").replace("_", " "),
                                "lat": catalogue[identifier]["lat"], "lon": catalogue[identifier]["lon"],
                                "modelled": catalogue[identifier]["modelled"],
                                "odMalinOffsetMetres": offset, "datumNote": datum_note(offset),
                                "url": f"marine/{name}"}
        print(f"  {identifier}: {len(payload['curve'])} samples, {len(events)} events", flush=True)
    manifest = {
        "schemaVersion": 1, "kind": "tide", "model": "tides",
        "modelName": "Marine Institute tidal predictions", "provider": "Marine Institute",
        "modelDetail": "Harmonic tidal prediction; gauge stations plus modelled points",
        "run": now.strftime("%Y%m%d%H"),
        "runTime": stamp(now.replace(minute=0, second=0, microsecond=0)),
        "generatedAt": stamp(now), "stepMinutes": STEP_MINUTES, "datum": "LAT",
        "coverage": {"from": stamp(start), "to": stamp(end)},
        "maxDistanceKm": args.max_distance_km,
        "stations": stations, "spots": assignments,
        "processing": (f"Source curve is {SOURCE_STEP_MINUTES}-minute; every second sample is republished "
                       f"at {STEP_MINUTES} minutes with no interpolation. High/low heights above LAT are read "
                       "from the curve, because the published events dataset gives OD Malin only; the two are "
                       "cross-checked against each station's constant datum offset. Spots farther than the "
                       "station limit are published without tides and with a stated reason."),
        "source": f"Marine Institute ERDDAP {CURVE_DATASET} and {EVENTS_DATASET}",
        "sourceUrl": SOURCE_URL, "attribution": ATTRIBUTION, "licenseUrl": LICENSE_URL,
    }
    # Only this final operation advances the published predictions.
    write_json(output / "tides.json", manifest)
    print(f"Published {len(stations)} tide stations to {output / 'tides.json'}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Tide refresh failed: {error}. Last published predictions preserved.", file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
