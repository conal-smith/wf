"""The EPA's bathing water notices, matched to the riding places they reach.

Local authorities report every bathing water incident and restriction to the
EPA, which publishes them on beaches.ie and in its open Bathing Water API: a
prohibition, an advice against bathing or a prior warning, with what caused it
(a storm water or sewage overflow, an algal bloom, heavy rain), when it began,
how long it is expected to last and the council's notice. This job reads that
API once an hour and publishes `marine/water-quality.json`, so the map, the
spot page and the MCP server read one file and can never disagree
(force5/src/waterQuality.ts reads it, and holds the rule for the stars).

Two of the API's datasets are read:

  alerts     every incident still open, with `has_bathing_restriction_in_place`
             saying whether its restriction still stands. One that no longer
             does is left out: the API keeps an incident listed for months
             after its restriction is lifted.
  locations  every monitored bathing water: its place (Irish Grid, converted
             here to WGS84), and any restriction for the whole season, which
             the alerts do not repeat.

A riding place takes the notices of every bathing water within MAX_DISTANCE_KM
of it, unless NOT_THE_SAME_WATER says that water is not the one it is ridden
on. A place with none in range is not listed: nothing is known there, which is
not the same as clean water. The EPA monitors bathing waters in the Republic
only, in the bathing season (1 June to 15 September, some all year), so most of
the year, and in Northern Ireland always, there is nothing to say.

Every notice is published as the EPA wrote it: its restriction, description,
dates, expected duration and the council's notice, never edited. Its start
and end are dates without a time or a zone; `from` and `until` are those dates
read in Irish time, the start of the first day and the end of the last, and an
incident with no end date stays in force until the council lifts it.

Licence: CC BY 4.0 (the API's own licence, and data.gov.ie's record of it); the
file credits the EPA, and every display does.

`run` is the hour the API was read in, so the registry's freshness limit
measures how long since the job last succeeded. An API this job cannot read,
or one whose shape has changed, fails the job rather than publishing an empty
list: an empty list says "no notices", which a broken feed must never say.
"""
import argparse
from datetime import datetime, timedelta, timezone
import math
import sys

import requests

from fetch_forecast import ROOT, load_spots, write_json
import timing

MANIFEST = "marine/water-quality.json"
API = "https://data.epa.ie/bw/api/v1"
ALERTS = f"{API}/alerts"
LOCATIONS = f"{API}/locations"
PAGE_SIZE = 500
BEACHES_PAGE = "https://www.beaches.ie"
USER_AGENT = "Force5/0.1 (wingfoil.ie prototype)"
SESSION = timing.count_responses(requests.Session())
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
ATTRIBUTION = ("Bathing water notices from the Environmental Protection Agency (EPA), "
               "beaches.ie, licensed under CC BY 4.0, published unaltered.")

# A bathing water this far from a riding place is taken to be its water: the
# same beach or the next one along it. Further than this, a notice says little
# about the water a rider is on.
MAX_DISTANCE_KM = 1.5
# Bathing waters within range that are not the water the place is ridden on.
NOT_THE_SAME_WATER = {
    # Keel Lough is a lake behind the dunes; Keel Beach is the sea.
    "keel-lake": {"IEWEBWC250_0000_0200"},
}

# The restriction types as the EPA's notices word them (Bathing Water Quality
# Regulations 2008: a prior warning, a bathing advisory, a bathing prohibition),
# matched on their words. One the job does not recognise is published as a
# restriction, which takes the stars away: the cautious reading of a notice
# whose restriction stands.
KINDS = (
    ("prior-warning", ("prior warning", "may be affected")),
    ("prohibition", ("prohibit", "do not swim", "do not bathe")),
    ("advice-against", ("advised against", "advice against", "not advised")),
)
ALL_SEASON = "all-season"


def stamp(value):
    return value.isoformat().replace("+00:00", "Z")


def last_sunday(year, month):
    day = datetime(year, month + 1, 1) - timedelta(days=1)
    return day - timedelta(days=(day.weekday() + 1) % 7)


def irish_offset(utc):
    """Ireland's offset from UTC at an instant: summer time (IST, UTC+1) runs from
    01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday of October."""
    start = last_sunday(utc.year, 3).replace(hour=1, tzinfo=timezone.utc)
    end = last_sunday(utc.year, 10).replace(hour=1, tzinfo=timezone.utc)
    return timedelta(hours=1) if start <= utc < end else timedelta(0)


def irish_midnight(day):
    """The instant an Irish calendar day begins, in UTC."""
    guess = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    return guess - irish_offset(guess - timedelta(hours=1))


def published_date(value, label):
    """A date as the API writes it, "2025-09-14T00:00:00": a day, no zone."""
    try:
        return datetime.fromisoformat(str(value)).date()
    except ValueError as error:
        raise ValueError(f"{label} is not a date: {value!r}") from error


def kind_of(restriction):
    words = restriction.strip().lower()
    for kind, phrases in KINDS:
        if any(phrase in words for phrase in phrases):
            return kind
    return "restriction"


def text(value):
    return value.strip() if isinstance(value, str) and value.strip() else None


def check_page(body, label):
    if not isinstance(body, dict) or not isinstance(body.get("list"), list) \
            or not isinstance(body.get("count"), int):
        raise ValueError(f"The {label} are not a page of the Bathing Water API")
    return body["list"], body["count"]


def irish_grid_to_wgs84():
    """Irish Grid (TM75) eastings and northings to longitude and latitude, as the
    EPA's own beaches.ie places them (checked in test_water_quality.py)."""
    from pyproj import Transformer
    return Transformer.from_crs("EPSG:29903", "EPSG:4326", always_xy=True).transform


def read_locations(rows, to_wgs84):
    """Every bathing water by its id: name, county, place, and any all-season
    restriction. One with no grid reference is kept for its name but not placed."""
    waters = {}
    for index, row in enumerate(rows):
        label = f"Location {index}"
        if not isinstance(row, dict) or not text(row.get("beach_id")) or not text(row.get("beach_name")):
            raise ValueError(f"{label} has no beach_id or beach_name")
        place = None
        easting, northing = row.get("easting"), row.get("northing")
        if isinstance(easting, (int, float)) and isinstance(northing, (int, float)) \
                and easting > 0 and northing > 0:
            lon, lat = to_wgs84(easting, northing)
            if not (51 <= lat <= 56 and -11 <= lon <= -5):
                raise ValueError(f"{label} ({row['beach_name']}) is not in Ireland")
            place = (round(lat, 5), round(lon, 5))
        waters[row["beach_id"].strip()] = {
            "name": row["beach_name"].strip(), "county": text(row.get("county_name")),
            "authority": text(row.get("local_authority_name")), "place": place,
            "allSeason": str(row.get("has_all_season_bathing_restriction_in_place")).strip() == "Yes",
            "allSeasonReason": text(row.get("reason_for_all_season_bathing_restriction")),
            "updated": text(row.get("last_updated")),
        }
    return waters


def incident_notice(row, index):
    """One open incident whose restriction stands, as published, with its days in
    UTC; None for one whose restriction has been lifted."""
    label = f"Alert {index}"
    if not isinstance(row, dict):
        raise ValueError(f"{label} is not an object")
    standing = row.get("has_bathing_restriction_in_place")
    if standing not in ("Yes", "No"):
        raise ValueError(f"{label} has no has_bathing_restriction_in_place")
    if standing == "No":
        return None
    for field in ("beach_id", "beach_name", "bathing_restriction_type", "incident_start_date"):
        if not text(row.get(field)):
            raise ValueError(f"{label} has no {field}")
    start = published_date(row["incident_start_date"], f"{label} incident_start_date")
    end = row.get("incident_end_date")
    end = published_date(end, f"{label} incident_end_date") if text(end) else None
    if end and end < start:
        raise ValueError(f"{label} ends before it starts")
    days = row.get("incident_expected_duration")
    if days is not None and (not isinstance(days, int) or days < 0):
        raise ValueError(f"{label} has an odd incident_expected_duration")
    restriction = row["bathing_restriction_type"].strip()
    identifier = text(row.get("bathing_water_incident_id")) or str(row.get("incident_id"))
    return {
        "id": identifier, "water": row["beach_id"].strip(), "beach": row["beach_name"].strip(),
        "county": text(row.get("county_name")), "authority": text(row.get("local_authority_name")),
        "kind": kind_of(restriction), "restriction": restriction,
        "description": text(row.get("incident_description")),
        "start": row["incident_start_date"], "expectedDays": days,
        "end": text(row.get("incident_end_date")),
        "from": stamp(irish_midnight(start)),
        "until": stamp(irish_midnight(end + timedelta(days=1))) if end else None,
        "notice": text(row.get("bathing_notice_pdf")), "updated": text(row.get("last_updated")),
    }


def season_notice(code, water):
    """A bathing water's restriction for the whole season, from its location."""
    return {
        "id": f"season-{code}", "water": code, "beach": water["name"],
        "county": water["county"], "authority": water["authority"],
        "kind": ALL_SEASON, "restriction": None, "description": water["allSeasonReason"],
        "start": None, "expectedDays": None, "end": None, "from": None, "until": None,
        "notice": None, "updated": water["updated"],
    }


def distance_km(lat1, lon1, lat2, lon2):
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi, d_lambda = phi2 - phi1, math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(a))


def spot_waters(spots, waters, maximum_km=MAX_DISTANCE_KM):
    """Each riding place's bathing waters within range, nearest first. Places with
    none are left out."""
    matched = {}
    for spot in spots:
        near = []
        for code, water in waters.items():
            if not water["place"] or code in NOT_THE_SAME_WATER.get(spot["id"], ()):
                continue
            km = distance_km(spot["lat"], spot["lon"], *water["place"])
            if km <= maximum_km:
                near.append({"water": code, "name": water["name"], "km": round(km, 2)})
        if near:
            matched[spot["id"]] = sorted(near, key=lambda item: item["km"])
    return matched


def build_manifest(alerts, locations, spots, now, to_wgs84):
    waters = read_locations(locations, to_wgs84)
    # One whose end date has passed is over, whatever the API still says.
    notices = [notice for index, row in enumerate(alerts)
               if (notice := incident_notice(row, index))
               and (notice["until"] is None or notice["until"] > stamp(now))]
    notices += [season_notice(code, water) for code, water in sorted(waters.items())
                if water["allSeason"]]
    run = now.replace(minute=0, second=0, microsecond=0)
    return {
        "schemaVersion": 1, "kind": "water-quality", "model": "water-quality",
        "modelName": "EPA bathing water notices", "provider": "Environmental Protection Agency",
        "run": run.strftime("%Y%m%d%H"), "runTime": stamp(run), "generatedAt": stamp(now),
        # `sourceUrl`, never `url`: the pruner reads every "url" as an object.
        "sourceUrl": ALERTS, "locationsUrl": LOCATIONS, "page": BEACHES_PAGE,
        "licence": "CC BY 4.0", "licenseUrl": LICENSE_URL, "attribution": ATTRIBUTION,
        "maxDistanceKm": MAX_DISTANCE_KM,
        "notices": notices,
        "spots": spot_waters(spots, waters),
    }


def fetch_all(endpoint, label):
    """Every row of a paged endpoint."""
    rows, page = [], 1
    while True:
        response = SESSION.get(endpoint, params={"page": page, "per_page": PAGE_SIZE},
                               headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                               timeout=60)
        response.raise_for_status()
        found, count = check_page(response.json(), label)
        rows += found
        if len(rows) >= count or not found:
            break
        page += 1
    if len(rows) != count:
        raise ValueError(f"The {label} listed {len(rows)} of the {count} the API counts")
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.parse_args(argv)
    spots = load_spots()
    timing.start("download")
    alerts = fetch_all(ALERTS, "alerts")
    locations = fetch_all(LOCATIONS, "locations")
    if not locations:
        raise ValueError("The Bathing Water API lists no bathing waters")
    timing.start("decode")
    manifest = build_manifest(alerts, locations, spots,
                              datetime.now(timezone.utc).replace(microsecond=0),
                              irish_grid_to_wgs84())
    out = ROOT / "public" / MANIFEST
    write_json(out, manifest)
    reached = {code for near in manifest["spots"].values() for code in (n["water"] for n in near)}
    at_spots = [n for n in manifest["notices"] if n["water"] in reached]
    print(f"EPA bathing water notices: {len(manifest['notices'])} standing "
          f"({len(at_spots)} at riding places), of {len(alerts)} open incidents; "
          f"{len(manifest['spots'])}/{len(spots)} riding places have a bathing water within "
          f"{MAX_DISTANCE_KM} km; written to {out}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Water quality refresh failed: {error}. Last published notices preserved.",
              file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
