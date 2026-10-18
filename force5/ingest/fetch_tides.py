"""Tidal predictions for every riding location, island-wide.

The Republic's come from the Marine Institute: public ERDDAP tabledap, CC BY
4.0, no account. Heights are published above Chart Datum (LAT) with each
station's Ordnance Datum Malin offset carried alongside, so the UI can show
either datum without this importer inventing a conversion.

The Marine Institute has no station in Northern Ireland, so its stations there
are predicted here from committed harmonic constants (tides_ni.py,
tide_stations_ni.json: the Environment Agency's open gauges at Portrush and
Bangor, EOT20 elsewhere), heights above each station's own LAT. Every station
carries its own attribution. A spot takes the nearest station of either.

These are astronomical *predictions*, not observations or a surge forecast:
real water levels differ with weather. A spot on a freshwater lake has no tide
and says so.
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
import tides_ni
import timing

ERDDAP = "https://erddap.marine.ie/erddap/tabledap"
CURVE_DATASET = "imiTidePrediction"
EVENTS_DATASET = "IMI_TidePrediction_HighLow"
SOURCE_URL = "https://erddap.marine.ie/erddap/tabledap/imiTidePrediction.html"
MI_ATTRIBUTION = "Tidal predictions © Marine Institute, CC BY 4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
ATTRIBUTION = (f"{MI_ATTRIBUTION}; Northern Ireland: tidal predictions by wingfoil.ie from Environment "
               "Agency tide gauge data (Open Government Licence v3.0) and the EOT20 ocean tide model "
               "(DGFI-TUM, CC BY 4.0)")
NI_PROVIDER = "wingfoil.ie"
# Riding locations on water the sea does not reach: said so, not given a station's tide.
NON_TIDAL = {
    "lough-neagh-antrim": "a freshwater lake",
    "oxford-island": "a freshwater lake",
    "fi-mountshannon-lough-derg": "a freshwater lake",
    "lough-derg-killaloe": "a freshwater lake",
    "blessington": "a freshwater lake (a reservoir)",
    "keel-lake": "a freshwater lake",
    "ladys-island-lake": "a lagoon closed off from the sea by a shingle bar",
}
USER_AGENT = "Force5/0.1 (wingfoil.ie prototype)"
SOURCE_STEP_MINUTES = 5  # The published curve; we republish every second sample.
STEP_MINUTES = 10
DAYS_BEFORE, DAYS_AFTER = 1, 8
MAX_DISTANCE_KM = 40.0
PREFER_MI_KM = 5.0
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
                                 "modelled": identifier.endswith("_MODELLED"),
                                 "provider": "Marine Institute"}
    if not catalogue:
        raise ValueError("Empty Marine Institute station catalogue")
    return catalogue


def distance_km(lat1, lon1, lat2, lon2):
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi, d_lambda = phi2 - phi1, math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(a))


def ni_catalogue(doc):
    """Northern Ireland's stations, in the Marine Institute catalogue's shape."""
    return {identifier: {"lon": station["lon"], "lat": station["lat"], "modelled": bool(station["modelled"]),
                         "provider": NI_PROVIDER}
            for identifier, station in doc["stations"].items()}


def assign_stations(spots, catalogue, maximum_km=MAX_DISTANCE_KM, non_tidal=None):
    """Nearest station of any provider by great-circle distance, or an explicit
    refusal: too far from every station, or on water with no tide.

    A near tie goes to the Marine Institute: its station is kept when it is at
    most PREFER_MI_KM farther than our own nearest (Warrenpoint, at the head of
    Carlingford Lough, is 2 km nearer Dundrum Bay across the Mournes than Port
    Oriel down the coast, whose tide the rest of the lough already takes)."""
    non_tidal = NON_TIDAL if non_tidal is None else non_tidal
    assignments = {}
    for spot in spots:
        ranked = sorted(((distance_km(spot["lat"], spot["lon"], station["lat"], station["lon"]), name)
                         for name, station in catalogue.items()))
        kilometres, identifier = ranked[0]
        if catalogue[identifier].get("provider") != "Marine Institute":
            mi = next(((km, name) for km, name in ranked
                       if catalogue[name].get("provider") == "Marine Institute"), None)
            if mi and mi[0] <= min(maximum_km, kilometres + PREFER_MI_KM):
                kilometres, identifier = mi
        if spot["id"] in non_tidal:
            assignments[spot["id"]] = {"station": None, "distanceKm": round(kilometres, 1),
                                       "noTide": True, "reason": f"No tide: {non_tidal[spot['id']]}."}
        elif kilometres > maximum_km:
            assignments[spot["id"]] = {"station": None, "distanceKm": round(kilometres, 1),
                                       "reason": f"Nearest tide station ({identifier}) is "
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


def ni_datum_note(station, stations):
    note = ("Heights are metres above Lowest Astronomical Tide: the lowest level this station's harmonic "
            "constants predict over a full 18.6-year cycle. Astronomical prediction only; no surge or wind effect.")
    if station["kind"] == "gauge":
        return note + " From a month of the gauge's own levels."
    if station["kind"] == "lag":
        parent = stations[station["lagOf"]]["name"]
        return (note + f" {parent}'s tide {station['lagMinutes']:g} minutes later, the lag satellite images of "
                "the lough's flats show; the heights are " + parent + "'s, and the lough's own range is "
                "probably smaller.")
    return note + " Modelled (the EOT20 ocean tide model), not a gauge: expect a decimetre or two and a quarter of an hour."


def ni_station_payload(identifier, curve, events, start, end):
    return {"station": identifier, "from": stamp(start), "to": stamp(end),
            "stepMinutes": STEP_MINUTES, "datum": "LAT", "curve": curve, "events": events}


def write_station(output, identifier, payload, start, end):
    with timing.phase("write"):
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:12]
        name = f"tides-{identifier}-{start.strftime('%Y%m%d')}-{end.strftime('%Y%m%d')}-{digest}.json"
        write_json(output / name, payload)
    return f"marine/{name}"


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
    ni = tides_ni.load()
    catalogue.update(ni_catalogue(ni))
    assignments = assign_stations(spots, catalogue, args.max_distance_km)
    used = sorted({item["station"] for item in assignments.values() if item["station"]})
    if not used:
        raise ValueError("No riding location is within range of a tide station")
    mi_used = [identifier for identifier in used if catalogue[identifier]["provider"] == "Marine Institute"]
    # Every Northern Ireland station is published, a spot nearest it or not: they cost
    # no download, and the foil-depth layer's regions there are cut on them.
    ni_used = sorted(ni["stations"])
    print(f"Tides {stamp(start)} → {stamp(end)}: {len(mi_used)} Marine Institute and {len(ni_used)} "
          f"Northern Ireland stations for {len(spots)} riding locations", flush=True)
    output = ROOT / "public" / "marine"
    stations = {}
    # One station at a time, each read and written before the next is asked for.
    timing.start("download", workers=1)
    for identifier in mi_used:
        curve, offset = read_curve(fetch_csv(curve_query(identifier, start, end)), identifier, start, end)
        events = read_events(fetch_csv(events_query(identifier, start, end)), identifier, curve, offset)
        payload = station_payload(identifier, curve, offset, events, start, end)
        stations[identifier] = {"name": identifier.removesuffix("_MODELLED").replace("_", " "),
                                "lat": catalogue[identifier]["lat"], "lon": catalogue[identifier]["lon"],
                                "modelled": catalogue[identifier]["modelled"],
                                "provider": "Marine Institute", "attribution": MI_ATTRIBUTION,
                                "licenseUrl": LICENSE_URL, "sourceUrl": SOURCE_URL,
                                "odMalinOffsetMetres": offset, "datumNote": datum_note(offset),
                                "url": write_station(output, identifier, payload, start, end)}
        print(f"  {identifier}: {len(payload['curve'])} samples, {len(events)} events", flush=True)
    timing.start("predict")
    for identifier in ni_used:
        station = ni["stations"][identifier]
        curve, events = tides_ni.station_series(ni["stations"], identifier, start, end, STEP_MINUTES)
        if len(events) < 2:
            raise ValueError(f"{identifier}: no high/low waters predicted in the window")
        payload = ni_station_payload(identifier, curve, events, start, end)
        stations[identifier] = {"name": station["name"], "lat": station["lat"], "lon": station["lon"],
                                "modelled": bool(station["modelled"]), "provider": NI_PROVIDER,
                                "attribution": station["attribution"], "licenseUrl": station["licenseUrl"],
                                "sourceUrl": station["sourceUrl"], "method": station["method"],
                                "datumNote": ni_datum_note(station, ni["stations"]),
                                "url": write_station(output, identifier, payload, start, end)}
        if station.get("lagOf"):
            stations[identifier].update({"lagOf": station["lagOf"], "lagMinutes": station["lagMinutes"]})
        print(f"  {identifier}: {len(curve)} samples, {len(events)} events (harmonic)", flush=True)
    manifest = {
        "schemaVersion": 1, "kind": "tide", "model": "tides",
        "modelName": "Tidal predictions", "provider": "Marine Institute; wingfoil.ie in Northern Ireland",
        "modelDetail": ("Marine Institute harmonic predictions (gauge stations plus modelled points); in Northern "
                        "Ireland, harmonic constants from the Environment Agency's gauges and the EOT20 model"),
        "run": now.strftime("%Y%m%d%H"),
        "runTime": stamp(now.replace(minute=0, second=0, microsecond=0)),
        "generatedAt": stamp(now), "stepMinutes": STEP_MINUTES, "datum": "LAT",
        "coverage": {"from": stamp(start), "to": stamp(end)},
        "maxDistanceKm": args.max_distance_km,
        "stations": stations, "spots": assignments,
        "processing": (f"Marine Institute: the source curve is {SOURCE_STEP_MINUTES}-minute; every second sample is "
                       f"republished at {STEP_MINUTES} minutes with no interpolation. High/low heights above LAT are "
                       "read from the curve, because the published events dataset gives OD Malin only; the two "
                       "are cross-checked against each station's constant datum offset. Northern Ireland: "
                       "predicted here from each station's harmonic constants (force5/ingest/"
                       "tide_stations_ni.json), high and low waters on a one-minute curve. Spots farther than "
                       "the station limit, or on a freshwater lake, are published without tides and with a "
                       "stated reason."),
        "source": (f"Marine Institute ERDDAP {CURVE_DATASET} and {EVENTS_DATASET}; Northern Ireland: "
                   "Environment Agency flood-monitoring API tide gauges and EOT20"),
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
