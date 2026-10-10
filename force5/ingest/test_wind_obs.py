"""Wind observation adapter tests against fake Met Éireann and ERDDAP answers; no network."""
import contextlib
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest

import fetch_wind_obs as obs
from fetch_wind_obs import (KNOTS_TO_MPS, build_manifest, collect, edr_readings, iwb_readings,
                            load_catalogue, qc_readings, to_mps)
from prune import manifest_urls, prune_published
from publish_s3 import validate_bundle
from status import describe

NOW = datetime(2026, 10, 10, 1, 40, tzinfo=timezone.utc)
START = NOW.replace(minute=0) - timedelta(hours=72)


def hours_back(count, end=NOW.replace(minute=0)):
    return [end - timedelta(hours=count - 1 - i) for i in range(count)]


def reading(at, speed, gust=None, heading=None):
    return {"time": at, "speed": speed, "gust": gust, "direction": heading}


def edr_payload(times, speed_kt=20.0, gust_kt=30.0, heading=270.0):
    items = []
    for i, at in enumerate(times):
        stamp = at.isoformat()
        items += [{"parameter_name": "wind_speed_mean", "observed_at": stamp, "value_num": speed_kt + i * 0.13},
                  {"parameter_name": "wind_gust", "observed_at": stamp, "value_num": gust_kt + i * 0.17},
                  {"parameter_name": "wind_direction", "observed_at": stamp, "value_num": heading + i % 7}]
    return {"items": items}


LOCATIONS = {"features": [
    {"id": 17, "properties": {"station_id": 17, "station_name": "Malin Head", "wmo_synop_no": 3980,
                              "dd_lat": 55.371944, "dd_lon": -7.339167, "elevation": 20}},
    {"id": 99, "properties": {"station_id": 99, "station_name": "Somewhere New", "wmo_synop_no": 3999,
                              "dd_lat": 53.0, "dd_lon": -8.0, "elevation": 50}},
]}


def iwb_csv(rows, speed_units="kn"):
    header = ",".join(obs.IWB_COLUMNS)
    units = ",".join(["", "degrees_north", "degrees_east", "UTC", speed_units, speed_units,
                      "degrees_true", ""])
    return "\n".join([header, units] + [",".join(str(cell) for cell in row) for row in rows]) + "\n"


class QualityControlTests(unittest.TestCase):
    def test_good_readings_pass_untouched(self):
        times = hours_back(5)
        readings = [reading(at, 8 + i * 0.3, 12 + i * 0.3, 250 + i) for i, at in enumerate(times)]
        kept, counts = qc_readings(readings)
        self.assertEqual(kept, readings)
        self.assertEqual(counts, {})

    def test_missing_and_impossible_speeds_drop_the_reading(self):
        times = hours_back(3)
        kept, counts = qc_readings([reading(times[0], None), reading(times[1], 80.0),
                                    reading(times[2], 5.0)])
        self.assertEqual([r["time"] for r in kept], [times[2]])
        self.assertEqual(counts, {"missing": 1, "range": 1})

    def test_a_bad_gust_or_bearing_drops_only_that_value(self):
        times = hours_back(3)
        kept, counts = qc_readings([reading(times[0], 10.0, 95.0, 200),
                                    reading(times[1], 10.0, 7.0, 400),
                                    reading(times[2], 10.0, 9.9, 360)])
        self.assertEqual([(r["gust"], r["direction"]) for r in kept],
                         [(None, 200), (None, None), (9.9, 0.0)])
        self.assertEqual(counts, {"gustRange": 1, "gustBelowSpeed": 1, "directionRange": 1})

    def test_a_calm_has_no_bearing_and_that_is_not_a_fault(self):
        kept, counts = qc_readings([reading(NOW, 0.2, 1.0, 123)])
        self.assertIsNone(kept[0]["direction"])
        self.assertEqual(counts, {})

    def test_a_frozen_speed_drops_the_whole_run(self):
        times = hours_back(8)
        speeds = [5.0, 7.0, 7.0, 7.0, 7.0, 7.0, 7.0, 6.0]
        kept, counts = qc_readings([reading(at, s) for at, s in zip(times, speeds)])
        self.assertEqual([r["speed"] for r in kept], [5.0, 6.0])
        self.assertEqual(counts, {"stuck": 6})

    def test_a_steady_calm_and_a_broken_run_are_not_stuck(self):
        times = hours_back(8)
        calm, _ = qc_readings([reading(at, 0.0) for at in times])
        self.assertEqual(len(calm), 8)
        gappy = [reading(at, 7.0) for i, at in enumerate(times) if i != 3]  # A missing hour.
        kept, counts = qc_readings(gappy)
        self.assertEqual(len(kept), 7)
        self.assertEqual(counts, {})

    def test_whole_knot_sources_get_a_longer_run_before_stuck(self):
        times = hours_back(8)
        kept, counts = qc_readings([reading(at, 7.2) for at in times], stuck_run=12)
        self.assertEqual((len(kept), counts), (8, {}))

    def test_a_frozen_vane_loses_its_bearings_but_keeps_its_speeds(self):
        times = hours_back(6)
        kept, counts = qc_readings([reading(at, 5 + i, None, 180) for i, at in enumerate(times)])
        self.assertEqual(len(kept), 6)
        self.assertTrue(all(r["direction"] is None for r in kept))
        self.assertEqual(counts, {"stuckDirection": 6})

    def test_duplicates_keep_the_first(self):
        kept, counts = qc_readings([reading(NOW, 5.0), reading(NOW, 6.0)])
        self.assertEqual([r["speed"] for r in kept], [5.0])
        self.assertEqual(counts, {"duplicate": 1})


class ParsingTests(unittest.TestCase):
    def test_units_are_converted_from_what_the_source_declares(self):
        self.assertAlmostEqual(to_mps(10, "kts"), 10 * KNOTS_TO_MPS)
        self.assertEqual(to_mps(10, "m s-1"), 10)
        self.assertIsNone(to_mps(None, "kn"))
        with self.assertRaises(ValueError):
            to_mps(10, "furlongs/fortnight")

    def test_edr_items_become_one_reading_per_hour_in_metres_per_second(self):
        times = hours_back(2)
        readings = sorted(edr_readings(edr_payload(times), {"speed": "kts", "gust": "kts"}),
                          key=lambda r: r["time"])
        self.assertEqual([r["time"] for r in readings], times)
        self.assertAlmostEqual(readings[0]["speed"], 20 * KNOTS_TO_MPS)
        self.assertAlmostEqual(readings[1]["gust"], 30.17 * KNOTS_TO_MPS)
        self.assertEqual(readings[0]["direction"], 270)

    def test_edr_no_sensor_sentinel_is_missing(self):
        payload = {"items": [{"parameter_name": "wind_speed_mean", "observed_at": NOW.isoformat(),
                              "value_num": -99}]}
        self.assertIsNone(edr_readings(payload, {"speed": "kts", "gust": "kts"})[0]["speed"])

    def test_met_eireann_stations_take_their_class_from_the_catalogue(self):
        times = hours_back(3)

        def fetch(url):
            return LOCATIONS if url.endswith("/locations?f=json") else edr_payload(times)

        stations = obs.fetch_met_eireann(START, NOW, load_catalogue(), fetch)
        malin = stations["ME_03980"]
        self.assertEqual((malin["name"], malin["class"], malin["heightM"]),
                         ("Malin Head", "coastal", 10))
        unknown = stations["ME_03999"]
        self.assertEqual((unknown["class"], unknown["classified"]), ("inland", False))

    def test_iwb_rows_flagged_bad_are_dropped_and_counted(self):
        text = iwb_csv([["M2", 53.48, -5.43, "2026-10-10T00:00:00Z", 20, 28, 250, 1],
                        ["M2", 53.48, -5.43, "2026-10-10T01:00:00Z", 21, 29, 255, 4],
                        ["M6", 53.07, -15.88, "2026-10-10T00:00:00Z", "NaN", "NaN", "NaN", 0]])
        stations, flagged = iwb_readings(text, load_catalogue())
        self.assertEqual(flagged, 1)
        self.assertEqual(sorted(stations), ["MI_M2", "MI_M6"])
        self.assertAlmostEqual(stations["MI_M2"]["readings"][0]["speed"], 20 * KNOTS_TO_MPS)
        self.assertEqual(stations["MI_M2"]["class"], "buoy")
        self.assertIsNone(stations["MI_M6"]["readings"][0]["speed"])

    def test_iwb_in_metres_per_second_is_not_converted(self):
        text = iwb_csv([["M3", 51.2, -10.5, "2026-10-10T00:00:00Z", 10, 14, 200, 0]], "m/s")
        stations, _ = iwb_readings(text, load_catalogue())
        self.assertEqual(stations["MI_M3"]["readings"][0]["speed"], 10)

    def test_unexpected_columns_are_refused(self):
        with self.assertRaises(ValueError):
            iwb_readings("a,b\nc,d\n", load_catalogue())
        self.assertEqual(iwb_readings("", load_catalogue()), ({}, 0))


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.public = Path(self.temp.name)

    def stations(self):
        times = hours_back(6, NOW.replace(minute=0) - timedelta(hours=1))

        def met():
            return {"ME_03980": {"id": "ME_03980", "name": "Malin Head", "sourceName": "Malin Head",
                                 "lat": 55.37, "lon": -7.34, "elevationM": 20, "source": "met-eireann",
                                 "class": "coastal", "classified": True, "heightM": 10,
                                 "sourceId": "17",
                                 "readings": [reading(at, 9 + i * 0.37, 14 + i, 260 + i)
                                              for i, at in enumerate(times)]}}, 0

        def buoys():
            raise RuntimeError("504 Gateway Time-out")

        with contextlib.redirect_stderr(io.StringIO()):
            return collect(START, NOW, load_catalogue(), NOW,
                           {"met-eireann": met, "marine-institute": buoys})

    def save(self, manifest):
        path = self.public / obs.MANIFEST
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(manifest))

    def test_one_source_down_still_publishes_the_other(self):
        stations, statuses, rejected = self.stations()
        self.assertEqual(statuses["marine-institute"]["status"], "failed")
        self.assertEqual(statuses["met-eireann"], {"status": "ok", "stations": 1, "readings": 6})
        manifest = build_manifest(stations, statuses, rejected, NOW)
        self.assertEqual(manifest["run"], "2026101000")
        self.assertEqual(manifest["sources"]["marine-institute"]["status"], "failed")
        self.assertIn("Met Éireann", manifest["attribution"])
        self.assertIn("warnings", manifest["notice"])
        malin = manifest["stations"]["ME_03980"]
        self.assertEqual(malin["readings"][0], ["2026-10-09T19:00:00Z", 9.0, 14.0, 260])
        self.assertEqual(malin["latest"]["time"], malin["readings"][-1][0])

    def test_the_bundle_validates_and_reports_its_age(self):
        stations, statuses, rejected = self.stations()
        self.save(build_manifest(stations, statuses, rejected, NOW))
        validate_bundle(self.public, "wind-obs", 6, now=NOW)
        row = describe(self.public, "wind-obs", NOW)
        self.assertEqual((row["state"], row["stations"]), ("fresh", 1))

    def test_the_validator_refuses_impossible_readings(self):
        stations, statuses, rejected = self.stations()
        good = build_manifest(stations, statuses, rejected, NOW)
        breakages = {
            "gust below speed": lambda m: m["stations"]["ME_03980"]["readings"][0].__setitem__(2, 1.0),
            "speed too high": lambda m: m["stations"]["ME_03980"]["readings"][0].__setitem__(1, 99.0),
            "bearing 360": lambda m: m["stations"]["ME_03980"]["readings"][0].__setitem__(3, 360),
            "out of order": lambda m: m["stations"]["ME_03980"]["readings"].reverse(),
            "unknown class": lambda m: m["stations"]["ME_03980"].__setitem__("class", "pier"),
            "no attribution": lambda m: m.__setitem__("attribution", ""),
            "older than window": lambda m: m.__setitem__("windowHours", 2),
            "latest is not last": lambda m: m["stations"]["ME_03980"]["latest"].__setitem__("speed", 1.0),
        }
        for name, breakage in breakages.items():
            with self.subTest(name):
                manifest = json.loads(json.dumps(good))
                breakage(manifest)
                self.save(manifest)
                with self.assertRaises(ValueError):
                    validate_bundle(self.public, "wind-obs", 6, now=NOW)

    def test_the_pruner_sees_a_self_contained_bundle(self):
        # Every "url" in a manifest is an object the pruner must keep, and an https
        # address is not one: it would abort every prune. Sources say `sourceUrl`.
        stations, statuses, rejected = self.stations()
        manifest = build_manifest(stations, statuses, rejected, NOW)
        self.assertEqual(manifest_urls(manifest), set())
        self.save(manifest)
        self.assertEqual(prune_published(self.public, 0, now=NOW)["removed"], [])
        manifest["sources"]["met-eireann"]["url"] = "https://example.invalid/"
        self.save(manifest)
        with self.assertRaises(ValueError):
            validate_bundle(self.public, "wind-obs", 6, now=NOW)

    def test_nothing_usable_is_an_error_not_an_empty_manifest(self):
        with self.assertRaises(ValueError):
            build_manifest({}, {}, {}, NOW)

    def test_the_committed_catalogue_is_well_formed(self):
        catalogue = load_catalogue()
        self.assertGreaterEqual(len(catalogue), 23)
        for identifier, station in catalogue.items():
            self.assertRegex(identifier, r"^(ME_\d{5}|MI_[A-Z0-9]+)$")
            self.assertIn(station["class"], obs.CLASSES)
        self.assertEqual({s["class"] for s in catalogue.values() if s["source"] == "marine-institute"},
                         {"buoy"})


if __name__ == "__main__":
    unittest.main()
