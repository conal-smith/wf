"""Tide adapter tests against a fake ERDDAP; no network access."""
from datetime import datetime, timedelta, timezone
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import fetch_tides
import tides_ni
from fetch_tides import (assign_stations, distance_km, main, read_curve, read_events,
                         station_catalogue, station_payload)
from publish_s3 import publish, validate_bundle
from test_publish_s3 import FakeS3

OFFSET = 2.68  # LAT minus OD Malin, as Fenit actually publishes it.
PERIOD_MINUTES = 12 * 60 + 25
CATALOGUE_CSV = """stationID,longitude,latitude
,degrees_east,degrees_north
Fenit,-9.8644,52.27129
Achill_Island_MODELLED,-10.1016,53.9522
Dublin_Port,-6.22166,53.34574
"""
SPOTS = [{"id": "brandon", "name": "Brandon Bay", "county": "Kerry", "lat": 52.276, "lon": -10.024},
         {"id": "keel", "name": "Keel Beach", "county": "Mayo", "lat": 53.971, "lon": -10.067},
         {"id": "ballyholme", "name": "Ballyholme", "county": "Down", "lat": 54.67, "lon": -5.645}]
NI_SPOTS = [{"id": "portrush", "name": "Portrush", "county": "Antrim", "lat": 55.2023468, "lon": -6.6564811},
            {"id": "newtownards", "name": "Newtownards — Strangford Lough", "county": "Down",
             "lat": 54.56012, "lon": -5.62772},
            {"id": "killard", "name": "Killard", "county": "Down", "lat": 54.320084, "lon": -5.541111},
            {"id": "newcastle", "name": "Newcastle — Dundrum Bay", "county": "Down",
             "lat": 54.209745, "lon": -5.885668},
            {"id": "oxford-island", "name": "Lough Neagh — Oxford Island", "county": "Armagh",
             "lat": 54.489371, "lon": -6.3668812}]
NI_STATIONS = ["Ardglass_MODELLED", "Ballycastle_MODELLED", "Bangor", "Dundrum_Bay_MODELLED",
               "Killard_MODELLED", "Larne_MODELLED", "Portavogie_MODELLED", "Portrush", "Strangford_MODELLED"]


def height(at, start):
    minutes = (at - start).total_seconds() / 60
    return round(2.5 + 2.0 * math.cos(2 * math.pi * minutes / PERIOD_MINUTES), 2)


def curve_csv(identifier, start, end, step=5, corrupt=None):
    lines = ["stationID,time,Water_Level,Water_Level_ODM", ",UTC,metres,metres"]
    at = start
    while at <= end:
        level = height(at, start)
        malin = round(level - OFFSET, 3)
        if corrupt == "datum" and at == start + timedelta(minutes=30):
            malin = round(malin - 0.5, 3)
        lines.append(f"{identifier},{fetch_tides.stamp(at)},{level},{malin}")
        at += timedelta(minutes=step)
    return "\n".join(lines) + "\n"


def events_csv(identifier, start, end, corrupt=None):
    lines = ["stationID,time,tide_time_category,Water_Level_ODMalin", ",UTC,,metres"]
    at, index = start, 0
    while at <= end:
        # Synthetic curve extremes sit every half period, starting at high water.
        moment = start + timedelta(minutes=round(index * PERIOD_MINUTES / 2 / 5) * 5)
        if moment > end:
            break
        kind = "HIGH" if index % 2 == 0 else "LOW"
        malin = round(height(moment, start) - OFFSET, 3)
        if corrupt == "category":
            kind = "SLACK"
        if corrupt == "height":
            malin = round(malin + 1.0, 3)
        if corrupt == "extreme":
            moment += timedelta(minutes=95)
        lines.append(f"{identifier},{fetch_tides.stamp(moment)},{kind},{malin}")
        index += 1
        at = moment
    return "\n".join(lines) + "\n"


class TideTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.start = datetime(2026, 9, 15, tzinfo=timezone.utc)
        self.end = self.start + timedelta(days=9)

    def catalogue(self):
        with patch("fetch_tides.fetch_csv", return_value=CATALOGUE_CSV):
            return station_catalogue(self.root / ".cache" / "tides")

    def fake_erddap(self, corrupt=None, step=5):
        def answer(url, attempts=3):
            if "distinct()" in url:
                return CATALOGUE_CSV
            identifier = url.split("stationID=%22")[1].split("%22")[0]
            if "HighLow" in url:
                return events_csv(identifier, self.window[0], self.window[1], corrupt)
            return curve_csv(identifier, self.window[0], self.window[1], step, corrupt)
        return answer

    # --- station mapping --------------------------------------------------
    def test_catalogue_records_modelled_stations(self):
        catalogue = self.catalogue()
        self.assertEqual(catalogue["Achill_Island_MODELLED"]["modelled"], True)
        self.assertEqual(catalogue["Fenit"]["modelled"], False)
        self.assertEqual(catalogue["Fenit"]["lat"], 52.27129)

    def test_catalogue_is_cached_after_the_first_fetch(self):
        self.catalogue()
        with patch("fetch_tides.fetch_csv", side_effect=AssertionError("refetched")) as fetch:
            station_catalogue(self.root / ".cache" / "tides")
        fetch.assert_not_called()

    def test_nearest_station_wins_and_distant_spots_are_refused(self):
        assignments = assign_stations(SPOTS, self.catalogue())
        self.assertEqual(assignments["brandon"]["station"], "Fenit")
        self.assertEqual(assignments["keel"]["station"], "Achill_Island_MODELLED")
        self.assertIsNone(assignments["ballyholme"]["station"])
        self.assertIn("beyond the 40 km limit", assignments["ballyholme"]["reason"])
        self.assertGreater(assignments["ballyholme"]["distanceKm"], 100)

    def test_the_distance_limit_is_configurable(self):
        self.assertEqual(assign_stations(SPOTS, self.catalogue(), 500)["ballyholme"]["station"], "Dublin_Port")
        self.assertIsNone(assign_stations(SPOTS, self.catalogue(), 5)["brandon"]["station"])

    def test_northern_ireland_spots_take_the_nearest_station_of_either_provider(self):
        catalogue = self.catalogue()
        catalogue.update(fetch_tides.ni_catalogue(tides_ni.load()))
        assignments = assign_stations(SPOTS + NI_SPOTS, catalogue)
        self.assertEqual(assignments["brandon"]["station"], "Fenit")
        self.assertEqual(assignments["ballyholme"]["station"], "Bangor")
        self.assertEqual(assignments["portrush"]["station"], "Portrush")
        self.assertEqual(assignments["newtownards"]["station"], "Strangford_MODELLED")
        self.assertEqual(assignments["killard"]["station"], "Killard_MODELLED")
        self.assertEqual(assignments["newcastle"]["station"], "Dundrum_Bay_MODELLED")
        self.assertEqual(catalogue["Bangor"]["provider"], "wingfoil.ie")
        self.assertEqual(catalogue["Fenit"]["provider"], "Marine Institute")

    def test_a_near_tie_keeps_the_marine_institutes_station(self):
        catalogue = self.catalogue()
        catalogue["Port_Oriel"] = {"lat": 53.79899, "lon": -6.221713, "modelled": False,
                                   "provider": "Marine Institute"}
        catalogue.update(fetch_tides.ni_catalogue(tides_ni.load()))
        spots = [{"id": "warrenpoint", "lat": 54.0993169, "lon": -6.2554859},
                 {"id": "newcastle", "lat": 54.209745, "lon": -5.885668}]
        assignments = assign_stations(spots, catalogue)
        # 33.5 km down the coast against 31.0 km across the Mournes.
        self.assertEqual(assignments["warrenpoint"]["station"], "Port_Oriel")
        self.assertEqual(assignments["newcastle"]["station"], "Dundrum_Bay_MODELLED")

    def test_a_freshwater_lake_has_no_tide_rather_than_a_far_station(self):
        catalogue = self.catalogue()
        catalogue.update(fetch_tides.ni_catalogue(tides_ni.load()))
        lake = assign_stations(NI_SPOTS, catalogue)["oxford-island"]
        self.assertIsNone(lake["station"])
        self.assertTrue(lake["noTide"])
        self.assertEqual(lake["reason"], "No tide: a freshwater lake.")
        # Every lake the catalogue knows is a real riding location.
        ids = {spot["id"] for spot in json.loads((Path(__file__).parents[2] / "public/riding-locations.json").read_text())}
        self.assertLessEqual(set(fetch_tides.NON_TIDAL), ids)

    def test_great_circle_distance_matches_a_known_separation(self):
        self.assertAlmostEqual(distance_km(53.0, -9.0, 54.0, -9.0), 111.2, places=0)

    # --- datum handling ---------------------------------------------------
    def test_curve_carries_lat_and_derives_the_od_malin_offset(self):
        curve, offset = read_curve(curve_csv("Fenit", self.start, self.end), "Fenit", self.start, self.end)
        self.assertEqual(len(curve), 9 * 288 + 1)
        self.assertAlmostEqual(offset, OFFSET, places=3)
        self.assertEqual(curve[self.start], 4.5)

    def test_event_heights_come_from_the_curve_not_the_od_malin_column(self):
        curve, offset = read_curve(curve_csv("Fenit", self.start, self.end), "Fenit", self.start, self.end)
        events = read_events(events_csv("Fenit", self.start, self.end), "Fenit", curve, offset)
        self.assertEqual(events[0]["kind"], "high")
        self.assertEqual(events[0]["height"], 4.5)  # Above LAT, not the -1.82 m OD Malin value.
        self.assertEqual(events[1]["kind"], "low")
        self.assertLess(events[1]["height"], 0.6)
        self.assertEqual(len(events), 35)  # Roughly two per 12 h 25 min over nine days.

    def test_inconsistent_datum_offset_is_rejected(self):
        with self.assertRaises(ValueError):
            read_curve(curve_csv("Fenit", self.start, self.end, corrupt="datum"),
                       "Fenit", self.start, self.end)

    def test_published_samples_are_source_samples(self):
        curve, offset = read_curve(curve_csv("Fenit", self.start, self.end), "Fenit", self.start, self.end)
        events = read_events(events_csv("Fenit", self.start, self.end), "Fenit", curve, offset)
        payload = station_payload("Fenit", curve, offset, events, self.start, self.end)
        self.assertEqual(len(payload["curve"]), 9 * 144 + 1)
        self.assertEqual(payload["datum"], "LAT")
        self.assertEqual(payload["odMalinOffsetMetres"], round(offset, 3))
        for index, value in enumerate(payload["curve"]):
            self.assertEqual(value, curve[self.start + timedelta(minutes=10 * index)])

    # --- source validation ------------------------------------------------
    def test_short_irregular_and_foreign_curves_are_rejected(self):
        cases = [curve_csv("Fenit", self.start, self.end - timedelta(hours=2)),
                 curve_csv("Fenit", self.start, self.end, step=10),
                 curve_csv("Galway", self.start, self.end),
                 "stationID,time,Water_Level\n,UTC,metres\n"]
        for text in cases:
            with self.subTest(text=text[:80]), self.assertRaises(ValueError):
                read_curve(text, "Fenit", self.start, self.end)

    def test_bad_events_are_rejected(self):
        curve, offset = read_curve(curve_csv("Fenit", self.start, self.end), "Fenit", self.start, self.end)
        for corrupt in ("category", "height", "extreme"):
            with self.subTest(corrupt=corrupt), self.assertRaises(ValueError):
                read_events(events_csv("Fenit", self.start, self.end, corrupt), "Fenit", curve, offset)

    # --- end to end -------------------------------------------------------
    def run_main(self, argv=("fetch_tides.py",), corrupt=None, step=5):
        now = datetime.now(timezone.utc)
        start = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
        self.window = (start, start + timedelta(days=9))
        with patch("fetch_tides.ROOT", self.root), patch("sys.argv", list(argv)), \
             patch("fetch_tides.load_spots", return_value=SPOTS), \
             patch("fetch_tides.fetch_csv", side_effect=self.fake_erddap(corrupt, step)):
            main()
        return json.loads((self.root / "public/marine/tides.json").read_text())

    def test_a_full_run_publishes_a_manifest_the_publisher_accepts(self):
        manifest = self.run_main()
        self.assertEqual((manifest["kind"], manifest["model"], manifest["datum"]), ("tide", "tides", "LAT"))
        self.assertEqual(sorted(manifest["stations"]), sorted(["Achill_Island_MODELLED", "Fenit"] + NI_STATIONS))
        self.assertEqual(manifest["spots"]["ballyholme"]["station"], "Bangor")
        self.assertIn("Subtract 2.680 m", manifest["stations"]["Fenit"]["datumNote"])
        self.assertTrue(manifest["attribution"].startswith("Tidal predictions © Marine Institute, CC BY 4.0"))
        _, _, objects = validate_bundle(self.root / "public", "tides", max_age_hours=30)
        self.assertEqual(len(objects), 2 + len(NI_STATIONS))
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root / "public", "tides", "test", max_age_hours=30), "published")
        self.assertEqual(s3.writes[-1], "marine/tides.json")
        self.assertEqual(len(s3.writes), 3 + len(NI_STATIONS))  # every station, then the pointer

    def test_each_station_credits_its_own_source(self):
        manifest = self.run_main()
        fenit = manifest["stations"]["Fenit"]
        self.assertEqual((fenit["provider"], fenit["attribution"]),
                         ("Marine Institute", "Tidal predictions © Marine Institute, CC BY 4.0"))
        for identifier in NI_STATIONS:
            with self.subTest(station=identifier):
                station = manifest["stations"][identifier]
                self.assertEqual(station["provider"], "wingfoil.ie")
                self.assertNotIn("Marine Institute", station["attribution"])
                self.assertNotIn("odMalinOffsetMetres", station)
                self.assertIn("Lowest Astronomical Tide", station["datumNote"])
        self.assertIn("Environment Agency", manifest["stations"]["Bangor"]["attribution"])
        self.assertIn("EOT20", manifest["stations"]["Larne_MODELLED"]["attribution"])
        self.assertIn("100 minutes later", manifest["stations"]["Strangford_MODELLED"]["datumNote"])

    def test_northern_ireland_station_files_are_predicted_curves_and_turns(self):
        manifest = self.run_main()
        station = json.loads((self.root / "public" / manifest["stations"]["Bangor"]["url"]).read_text())
        self.assertEqual((station["station"], station["datum"], station["stepMinutes"]), ("Bangor", "LAT", 10))
        self.assertEqual((station["from"], station["to"]), (manifest["coverage"]["from"], manifest["coverage"]["to"]))
        self.assertEqual(len(station["curve"]), 9 * 144 + 1)
        self.assertTrue(-0.1 < min(station["curve"]) < max(station["curve"]) < 4.5)
        self.assertGreaterEqual(len(station["events"]), 30)

    def test_station_files_are_immutable_and_named_by_window_and_content(self):
        manifest = self.run_main()
        url = manifest["stations"]["Fenit"]["url"]
        self.assertRegex(url, r"^marine/tides-Fenit-\d{8}-\d{8}-[0-9a-f]{12}\.json$")
        self.assertEqual(json.loads((self.root / "public" / url).read_text())["station"], "Fenit")

    def test_a_corrupt_source_preserves_the_last_published_manifest(self):
        published = self.root / "public/marine/tides.json"
        published.parent.mkdir(parents=True)
        published.write_text('{"run":"last-good"}')
        for corrupt, step in [("datum", 5), ("height", 5), (None, 10)]:
            with self.subTest(corrupt=corrupt, step=step), self.assertRaises(ValueError):
                self.run_main(corrupt=corrupt, step=step)
            self.assertEqual(json.loads(published.read_text()), {"run": "last-good"})

    def test_an_unreachable_station_limit_refuses_to_publish(self):
        with self.assertRaises(ValueError):
            self.run_main(("fetch_tides.py", "--max-distance-km", "1"))

    def test_publisher_rejects_a_station_file_that_does_not_match_the_manifest(self):
        manifest = self.run_main()
        path = self.root / "public" / manifest["stations"]["Fenit"]["url"]
        station = json.loads(path.read_text())
        for change in [{"datum": "OD Malin"}, {"curve": station["curve"][:-1]},
                       {"curve": [9.9] * len(station["curve"])},
                       {"events": [{**station["events"][0], "height": 0.2}] + station["events"][1:]},
                       {"events": [{**station["events"][0], "kind": "slack"}] + station["events"][1:]},
                       {"events": [{**station["events"][0], "height": 9.5}] + station["events"][1:]},
                       {"events": station["events"][:1]},
                       {"station": "Galway"}]:
            with self.subTest(change=list(change)[0]):
                path.write_text(json.dumps({**station, **change}))
                s3 = FakeS3()
                with self.assertRaises(ValueError):
                    publish(s3, self.root / "public", "tides", "test", max_age_hours=30)
                self.assertEqual(s3.writes, [])

    def test_publisher_rejects_an_unsafe_station_path_and_unknown_station(self):
        manifest = self.run_main()
        published = self.root / "public/marine/tides.json"
        for change in [{"stations": {**manifest["stations"], "Fenit": {
                            **manifest["stations"]["Fenit"], "url": "../outside.json"}}},
                       {"spots": {**manifest["spots"], "brandon": {"station": "Galway", "distanceKm": 1}}},
                       {"spots": {**manifest["spots"], "ballyholme": {"station": None}}},
                       {"coverage": {"from": manifest["coverage"]["from"],
                                     "to": manifest["coverage"]["from"]}}]:
            with self.subTest(change=list(change)[0]):
                published.write_text(json.dumps({**manifest, **change}))
                with self.assertRaises(ValueError):
                    validate_bundle(self.root / "public", "tides", max_age_hours=30)


if __name__ == "__main__":
    unittest.main()
