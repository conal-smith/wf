"""Northern Ireland's harmonic tides: the engine, the committed constants, the
validation they were published with, and the levels the foil build reads."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import unittest

import numpy as np

import harmonics
import tides_ni

HERE = Path(__file__).parent
VALIDATION = HERE.parent.parent / "scripts" / "tides" / "validation.json"


def seconds(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()


class HarmonicsTests(unittest.TestCase):
    def test_speeds_are_the_standard_ones(self):
        # Degrees per hour, as tabulated (Pugh & Woodworth 2014, table 4.2).
        for name, speed in {"M2": 28.9841042, "S2": 30.0, "N2": 28.4397295, "K2": 30.0821373,
                            "K1": 15.0410686, "O1": 13.9430356, "P1": 14.9589314, "Q1": 13.3986609,
                            "M4": 57.9682084, "MS4": 58.9841042, "SA": 0.0410667, "SSA": 0.0821373}.items():
            with self.subTest(name=name):
                self.assertAlmostEqual(harmonics.speed(name), speed, places=4)

    def test_eot20s_own_prediction_is_reproduced(self):
        # pyTMD's EOT20 series from the model's 17 constituents alone, in 2026 and in
        # 2035 (the lunar node half a cycle on): arguments, phases and nodal factors.
        fixture = json.loads((HERE / "fixtures" / "eot20_point.json").read_text())
        constants = {k: tuple(v) for k, v in fixture["constituents"].items()}
        for start, series in fixture["series"].items():
            t = seconds(start) + np.arange(len(series)) * fixture["stepHours"] * 3600.0
            with self.subTest(start=start):
                self.assertLess(np.abs(harmonics.predict(constants, 0.0, t) - series).max(), 0.002)

    def test_analysis_recovers_constants_and_inference_ties_a_child(self):
        t = seconds("2026-09-19T00:00:00Z") + np.arange(0, 29.3 * 86400, 900.0)
        truth = {"M2": (1.15, 317.5), "S2": (0.30, 2.8), "N2": (0.21, 287.5), "K1": (0.10, 193.6),
                 "O1": (0.106, 44.0), "M4": (0.011, 95.5), "K2": (0.088, 358.7), "P1": (0.038, 195.4)}
        levels = harmonics.predict(truth, 2.19, t)
        found, z0, residual = harmonics.analyse(
            t, levels, ["M2", "S2", "N2", "K1", "O1", "M4"],
            inferred={"K2": ("S2", 0.088 / 0.30, (358.7 - 2.8) % 360),
                      "P1": ("K1", 0.038 / 0.10, 195.4 - 193.6)})
        self.assertAlmostEqual(z0, 2.19, places=6)
        self.assertLess(np.abs(residual).max(), 1e-6)
        for name, (amplitude, phase) in truth.items():
            self.assertAlmostEqual(found[name][0], amplitude, places=5)
            self.assertAlmostEqual((found[name][1] - phase + 180) % 360 - 180, 0, places=3)

    def test_extremes_alternate_and_merge_a_stand(self):
        t = np.arange(0, 2 * 86400, 60.0)
        tide = np.cos(2 * np.pi * t / 44712 + 1.0)
        rippled = tide + 0.02 * np.sin(2 * np.pi * t / 1800)  # a ripple on the tide: stands, no turns
        truth = harmonics.extremes(t, tide)
        turns = harmonics.extremes(t, rippled, minimum_range=0.1)
        self.assertEqual([kind for _, kind in turns], [kind for _, kind in truth])
        self.assertEqual(len(truth), 8)
        for (found, _), (expected, _) in zip(turns, truth):
            self.assertLess(abs(t[found] - t[expected]), 30 * 60)


class ConstantsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = tides_ni.load()
        cls.stations = cls.doc["stations"]

    def test_every_station_covers_the_coast_round_from_portrush_to_dundrum_bay(self):
        self.assertEqual(sorted(self.stations), sorted([
            "Portrush", "Ballycastle_MODELLED", "Larne_MODELLED", "Bangor", "Portavogie_MODELLED",
            "Killard_MODELLED", "Strangford_MODELLED", "Ardglass_MODELLED", "Dundrum_Bay_MODELLED"]))
        for identifier, station in self.stations.items():
            with self.subTest(station=identifier):
                self.assertTrue(54.0 < station["lat"] < 55.4 and -7.0 < station["lon"] < -5.3)
                self.assertNotIn("Marine Institute", station["attribution"])
                self.assertIn("wingfoil.ie", station["attribution"])
                self.assertEqual(station["modelled"], station["kind"] != "gauge")

    def test_the_gauges_are_the_environment_agencys_and_the_rest_eot20(self):
        for identifier, station in self.stations.items():
            with self.subTest(station=identifier):
                if station["kind"] == "gauge":
                    self.assertIn("Environment Agency", station["attribution"])
                    self.assertIn("open-government-licence", station["licenseUrl"])
                    self.assertGreaterEqual(station["gauge"]["readings"], 2000)
                else:
                    self.assertIn("EOT20", station["attribution"])

    def test_strangford_is_killards_tide_100_minutes_later(self):
        lough = self.stations["Strangford_MODELLED"]
        self.assertEqual((lough["lagOf"], lough["lagMinutes"]), ("Killard_MODELLED", 100))
        t = seconds("2026-10-18T00:00:00Z") + np.arange(0, 86400, 600.0)
        np.testing.assert_allclose(tides_ni.heights(self.stations, "Strangford_MODELLED", t + 6000),
                                   tides_ni.heights(self.stations, "Killard_MODELLED", t))

    def test_the_datum_is_the_lowest_level_over_a_nodal_cycle(self):
        # Hourly over 18.6 years: never below LAT, and within a few cm of it.
        t = seconds("2026-01-01T00:00:00Z") + np.arange(0, 18.61 * 365.25 * 86400, 3600.0)
        for identifier, station in self.stations.items():
            if station.get("lagOf"):
                continue
            with self.subTest(station=identifier):
                z = tides_ni.heights(self.stations, identifier, t)
                self.assertGreaterEqual(z.min(), -0.005)
                self.assertLess(z.min(), 0.05)
                self.assertAlmostEqual(z.max(), station["hatMetres"], delta=0.05)

    def test_ranges_rise_from_the_north_coast_to_the_irish_sea(self):
        hat = {k: v["hatMetres"] for k, v in self.stations.items() if "hatMetres" in v}
        self.assertLess(hat["Ballycastle_MODELLED"], hat["Portrush"])
        self.assertLess(hat["Portrush"], hat["Larne_MODELLED"])
        self.assertLess(hat["Bangor"], hat["Portavogie_MODELLED"])
        self.assertLess(hat["Portavogie_MODELLED"], hat["Killard_MODELLED"])

    def test_a_window_has_about_two_highs_and_two_lows_a_day(self):
        start = datetime(2026, 10, 17, tzinfo=timezone.utc)
        end = start + timedelta(days=9)
        for identifier in self.stations:
            with self.subTest(station=identifier):
                curve, events = tides_ni.station_series(self.stations, identifier, start, end, 10)
                self.assertEqual(len(curve), 9 * 144 + 1)
                self.assertTrue(16 <= sum(e["kind"] == "high" for e in events) <= 19)
                kinds = [e["kind"] for e in events]
                self.assertTrue(all(a != b for a, b in zip(kinds, kinds[1:])))
                for event in events:
                    at = (seconds(event["time"]) - start.timestamp()) / 600
                    near = curve[max(0, int(at) - 1):int(at) + 3]
                    self.assertLess(min(abs(h - event["height"]) for h in near), 0.15)

    def test_levels_for_the_foil_build_are_in_its_stations_layout(self):
        doc = tides_ni.levels(self.doc, datetime(2026, 1, 1, tzinfo=timezone.utc),
                              datetime(2026, 2, 1, tzinfo=timezone.utc))
        bangor = doc["stations"]["Bangor"]
        for key in ("name", "lat", "lon", "modelled", "mslMetres", "mhwMetres", "mlwMetres",
                    "hatMetres", "lowestMetres"):
            self.assertIn(key, bangor)
        self.assertLess(bangor["lowestMetres"], bangor["mlwMetres"])
        self.assertLess(bangor["mlwMetres"], bangor["mslMetres"])
        self.assertLess(bangor["mslMetres"], bangor["mhwMetres"])
        self.assertLess(bangor["mhwMetres"], bangor["hatMetres"])
        self.assertEqual(doc["stations"]["Strangford_MODELLED"]["lagOf"], "Killard_MODELLED")


class ValidationTests(unittest.TestCase):
    """The numbers scripts/tides/validation.json was published with (scripts/tides/README.md)."""

    @classmethod
    def setUpClass(cls):
        cls.results = json.loads(VALIDATION.read_text())["results"]

    def test_against_the_gauges_own_record(self):
        for gauge in ("Portrush", "Bangor"):
            with self.subTest(gauge=gauge):
                published = self.results[gauge]["published"]
                floor = self.results[gauge]["ownFourYearAnalysis"]
                self.assertGreater(published["samples"], 25000)
                # Within 3 cm RMS of what a full analysis of the record itself leaves (the weather).
                self.assertLess(published["heightRmsMetres"], floor["heightRmsMetres"] + 0.03)
                self.assertLess(abs(published["highTimeMinutes"]["mean"]), 5)
                self.assertLess(published["highTimeMinutes"]["rms"], 25)
                self.assertLess(self.results[gauge]["publishedVsFourYearAnalysis"]["heightRmsMetres"], 0.1)

    def test_the_same_methods_against_the_marine_institutes_predictions(self):
        for station, method, rms in [("Malin_Head", "gaugeMonth", 0.08), ("Howth", "gaugeMonth", 0.07),
                                     ("Port_Oriel", "eot20Only", 0.11), ("Skerries", "eot20Only", 0.10),
                                     ("Malin_Head", "eot20Only", 0.12)]:
            with self.subTest(station=station, method=method):
                result = self.results[station][method]
                self.assertLess(result["heightRmsMetres"], rms)
                self.assertLess(result["highTimeMinutes"]["rms"], 13)
                self.assertLess(result["lowTimeMinutes"]["rms"], 13)


if __name__ == "__main__":
    unittest.main()
