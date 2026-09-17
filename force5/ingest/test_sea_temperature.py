"""Sea temperature adapter tests against a fake ERDDAP; no network access."""
import contextlib
from datetime import datetime, timedelta, timezone
import io
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import fetch_sea_temperature as sea
from fetch_sea_temperature import (SOURCES, Source, assign_stations, collect, distance_km,
                                  main, read_observations, slot_series, station_id)
from publish_s3 import publish, validate_bundle
from status import describe
from prune import prune_published
from test_publish_s3 import FakeS3

SPOTS = [
    # Inside Lehanagh's range, and nearer it than Mace Head.
    {"id": "rusheen", "name": "Rusheen Bay", "county": "Galway", "lat": 53.251, "lon": -9.121},
    # Inside M2's range and nothing else's.
    {"id": "dollymount", "name": "Dollymount", "county": "Dublin", "lat": 53.365, "lon": -6.135},
    # Far from every station in the fake catalogue.
    {"id": "ballyholme", "name": "Ballyholme", "county": "Down", "lat": 54.67, "lon": -5.645},
]
# Real positions, so the distances the tests assert are the published ones.
BUOYS = {"M2": (53.4836, -5.4302), "M3": (51.215956, -10.548261)}
MACE_HEAD = (53.3306, -9.9326)
LEHANAGH = (53.4001, -9.8207)
COASTAL = (53.25299, -9.72885)  # A Kilkieran Bay logger site.


def wave(at, start, middle=15.0):
    """A smooth daily cycle, so a resampled series stays recognisable."""
    hours = (at - start).total_seconds() / 3600
    return round(middle + 1.5 * math.sin(2 * math.pi * hours / 24), 3)


def csv_table(columns, rows):
    lines = [",".join(columns), ",".join("" for _ in columns)]
    lines += [",".join(str(cell) for cell in row) for row in rows]
    return "\n".join(lines) + "\n"


class FakeErddap:
    """Answers each source's query from a generated hourly or 10-minute record.

    `until` shifts a station's last report back in time, which is how the real
    coastal network behaves: present in the table, months out of date.
    """

    def __init__(self, start, end, until=None, corrupt=None, future=False):
        self.start, self.end = start, end
        # ERDDAP cannot answer with a row it has not recorded yet, so neither does
        # the fake unless a test is deliberately checking that guard.
        self.latest = end if future else min(end, datetime.now(timezone.utc))
        self.until = until or {}
        self.corrupt = corrupt or {}

    def stations(self, dataset):
        if dataset == "IWBNetwork":
            return [(name, lat, lon, 60, None, 0) for name, (lat, lon) in BUOYS.items()]
        if dataset == "compass_mace_head":
            return [("Mace Head Buoy Deployment Location", *MACE_HEAD, 10, 0.0, None)]
        if dataset == "sentinel_lehanagh":
            return [("Lehanagh Pool Buoy Deployment Location", *LEHANAGH, 10, 0.0, None)]
        return [("Casheen", *COASTAL, 60, -7.0, 1)]

    def __call__(self, url, attempts=3):
        source = next(s for s in SOURCES if f"/{s.dataset}.csv" in url)
        rows = []
        for name, lat, lon, step, depth, flag in self.stations(source.dataset):
            last = self.until.get(name, self.latest)
            at = self.start
            while at <= min(last, self.latest):
                value = wave(at, self.start)
                cells = [name, lat, lon, sea.stamp(at), self.spoil(name, at, value)]
                if source.depth_column is not None:
                    cells.append(depth)
                if source.flag_column is not None:
                    cells.append(self.flag(name, at, flag))
                rows.append(cells)
                at += timedelta(minutes=step)
        if not rows:
            return ""  # ERDDAP's 404-for-no-rows, as fetch_csv translates it.
        return csv_table(source.columns, rows)

    def spoil(self, name, at, value):
        if self.corrupt.get(name) == "nan" and at.hour % 6 == 0:
            return "NaN"
        if self.corrupt.get(name) == "range" and at.hour % 6 == 0:
            return 812.5
        return value

    def flag(self, name, at, flag):
        if self.corrupt.get(name) == "flag" and at.hour % 6 == 0:
            return 9 if flag == 0 else 40
        return flag


class SeaTemperatureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.now = datetime(2026, 9, 16, 23, 50, tzinfo=timezone.utc)
        self.end = self.now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        self.start = self.end - timedelta(days=7)

    def gather(self, **kwargs):
        fake = FakeErddap(self.start, self.end, **kwargs)
        fake.latest = self.now.replace(minute=0, second=0, microsecond=0)
        return collect(SOURCES, self.start, self.end, self.now, fetch=fake)

    # --- station identity and reading -------------------------------------
    def test_station_ids_are_namespaced_and_names_lose_the_deployment_suffix(self):
        stations, counts = self.gather()
        self.assertEqual(sorted(stations),
                         ["IC_Casheen", "IWB_M2", "IWB_M3", "MI_Lehanagh_Pool", "MI_Mace_Head"])
        self.assertEqual(stations["MI_Mace_Head"]["name"], "Mace Head")
        self.assertEqual(stations["MI_Mace_Head"]["sourceName"],
                         "Mace Head Buoy Deployment Location")
        self.assertEqual(counts["IWBNetwork"]["stations"], 2)
        self.assertEqual(stations["IWB_M2"]["network"], "buoy")
        self.assertEqual(stations["MI_Mace_Head"]["network"], "sentinel")
        self.assertEqual(stations["IC_Casheen"]["network"], "coastal")

    def test_a_negative_published_depth_becomes_metres_below_the_surface(self):
        stations, _ = self.gather()
        self.assertEqual(stations["IC_Casheen"]["depth"], 7.0)
        self.assertEqual(stations["MI_Mace_Head"]["depth"], 0.0)
        # IWBNetwork publishes no sensor depth, and none is invented for it.
        self.assertIsNone(stations["IWB_M2"]["depth"])

    def test_station_ids_stay_inside_the_published_identifier_grammar(self):
        source = SOURCES[0]
        self.assertEqual(station_id(source, "Gearhies - Cuan Baoi 2"), "IC_Gearhies_Cuan_Baoi_2")
        with self.assertRaises(ValueError):
            station_id(source, "   ")

    def test_great_circle_distance_matches_a_known_separation(self):
        self.assertAlmostEqual(distance_km(53.0, -9.0, 54.0, -9.0), 111.2, places=0)

    # --- quality control --------------------------------------------------
    def test_a_flag_the_network_does_not_call_usable_is_dropped(self):
        stations, counts = self.gather(corrupt={"M2": "flag", "Casheen": "flag"})
        self.assertEqual(counts["IWBNetwork"]["rejected"], 28)  # Every sixth hour, 7 days.
        self.assertEqual(counts["ICTempNetwork"]["rejected"], 28)
        for identifier in ("IWB_M2", "IC_Casheen"):
            self.assertTrue(stations[identifier]["readings"])

    def test_nan_and_out_of_range_values_are_dropped_not_repaired(self):
        for corrupt in ("nan", "range"):
            with self.subTest(corrupt=corrupt):
                stations, counts = self.gather(corrupt={"M2": corrupt})
                self.assertEqual(counts["IWBNetwork"]["rejected"], 28)
                values = [value for _, value in stations["IWB_M2"]["readings"]]
                self.assertTrue(all(-2 <= value <= 35 for value in values))

    def test_a_reading_dated_in_the_future_is_fatal(self):
        fake = FakeErddap(self.start, self.end + timedelta(days=2), future=True)
        with self.assertRaises(ValueError):
            collect(SOURCES, self.start, self.end, self.now, fetch=fake)

    def test_a_source_with_no_rows_in_the_window_is_not_an_error(self):
        stations, counts = self.gather(until={"Casheen": self.start - timedelta(days=200)})
        self.assertNotIn("IC_Casheen", stations)
        self.assertEqual(counts["ICTempNetwork"], {"stations": 0, "rejected": 0, "readings": 0})

    # --- series resampling ------------------------------------------------
    def test_the_series_thins_real_readings_to_the_published_step(self):
        stations, _ = self.gather()
        series = stations["IWB_M2"]["series"]
        times = [sea.moment(entry["time"]) for entry in series]
        self.assertEqual(len(series), 56)  # Seven days at three hours, ending at 21:00.
        self.assertTrue(all(b - a == timedelta(hours=3) for a, b in zip(times, times[1:])))
        readings = dict(stations["IWB_M2"]["readings"])
        # Every published pair is a pair the source actually published.
        for entry, at in zip(series, times):
            self.assertEqual(entry["value"], readings[at])
        self.assertLessEqual(times[-1], stations["IWB_M2"]["readings"][-1][0])

    def test_the_series_never_reaches_past_the_newest_reading(self):
        start = datetime(2026, 9, 16, tzinfo=timezone.utc)
        readings = [(start + timedelta(hours=n), 14.0 + n) for n in range(5)]
        # The window runs to 09:00 but the readings stop at 04:00; the 06:00 slot
        # would otherwise borrow the 04:00 reading and date it two hours late.
        series = slot_series(readings, start, start + timedelta(hours=9))
        self.assertEqual([entry["time"] for entry in series],
                         ["2026-09-16T00:00:00Z", "2026-09-16T03:00:00Z"])

    def test_a_reading_two_slots_could_claim_is_published_once(self):
        start = datetime(2026, 9, 16, tzinfo=timezone.utc)
        # 01:30 is exactly half a step from both the 00:00 and the 03:00 slot.
        readings = [(start + timedelta(minutes=90), 15.0), (start + timedelta(hours=9), 16.0)]
        series = slot_series(readings, start, start + timedelta(hours=9))
        self.assertEqual([entry["time"] for entry in series],
                         ["2026-09-16T01:30:00Z", "2026-09-16T09:00:00Z"])

    def test_a_source_coarser_than_the_step_is_simply_sparser(self):
        start = datetime(2026, 9, 10, tzinfo=timezone.utc)
        readings = [(start + timedelta(hours=8 * n), 12.0 + n) for n in range(6)]
        series = slot_series(readings, start, start + timedelta(days=2))
        # Every eight-hourly reading once, at its own time, and nothing between them.
        self.assertEqual([entry["time"] for entry in series],
                         [sea.stamp(at) for at, _ in readings])
        self.assertEqual([entry["value"] for entry in series], [12.0, 13.0, 14.0, 15.0, 16.0, 17.0])

    def test_a_gap_stays_a_gap_rather_than_being_filled_in(self):
        start = datetime(2026, 9, 10, tzinfo=timezone.utc)
        readings = [(start, 12.0), (start + timedelta(days=1), 13.0)]
        series = slot_series(readings, start, start + timedelta(days=1))
        self.assertEqual([entry["time"] for entry in series],
                         ["2026-09-10T00:00:00Z", "2026-09-11T00:00:00Z"])

    def test_a_station_whose_only_reading_misses_every_slot_is_not_published(self):
        source = Source("empty", "buoy", "X", "station_id", "SeaTemperature", "nothing")
        start = datetime(2026, 9, 16, 1, tzinfo=timezone.utc)
        end = datetime(2026, 9, 16, 4, tzinfo=timezone.utc)  # One slot, at 03:00.
        lonely = sea.stamp(datetime(2026, 9, 16, 1, 10, tzinfo=timezone.utc))
        self.assertEqual(slot_series([(sea.moment(lonely), 14.0)], start, end), [])
        stations, _ = collect([source], start, end, end,
                              fetch=lambda url, attempts=3: csv_table(
                                  source.columns, [("Lonely", 53.0, -9.0, lonely, 14.0)]))
        self.assertEqual(stations, {})

    # --- station selection ------------------------------------------------
    def test_nearest_station_wins_and_only_a_buoy_is_left_where_it_must_be(self):
        stations, _ = self.gather()
        assignments = assign_stations(SPOTS, stations, self.now)
        # Rusheen is 40 km from the Casheen logger, 49 from Lehanagh, 55 from Mace Head.
        self.assertEqual(assignments["rusheen"]["station"], "IC_Casheen")
        self.assertEqual(assignments["rusheen"]["distanceKm"], 40.4)
        # Dublin has nothing but the offshore weather buoy, and takes it.
        self.assertEqual(assignments["dollymount"]["station"], "IWB_M2")
        self.assertEqual(assignments["dollymount"]["distanceKm"], 48.5)
        without_coastal = {k: v for k, v in stations.items() if k != "IC_Casheen"}
        nearest = assign_stations(SPOTS, without_coastal, self.now)
        self.assertEqual(nearest["rusheen"]["station"], "MI_Lehanagh_Pool")

    def test_a_coastal_site_in_range_beats_a_nearer_buoy(self):
        """Beach water is not open-shelf water, so the near-shore network wins."""
        stations, _ = self.gather()
        # Put the logger farther from Rusheen than both buoys, but still in range.
        stations["IC_Casheen"]["lat"], stations["IC_Casheen"]["lon"] = 53.751, -9.121
        assignments = assign_stations(SPOTS, stations, self.now)
        self.assertEqual(assignments["rusheen"]["station"], "IC_Casheen")
        self.assertGreater(assignments["rusheen"]["distanceKm"],
                           distance_km(53.251, -9.121, *LEHANAGH))
        # Age the logger out and the nearest sentinel buoy takes over.
        stations["IC_Casheen"]["readings"] = [
            (self.now - timedelta(days=30), 12.0)]
        aged = assign_stations(SPOTS, stations, self.now)
        self.assertEqual(aged["rusheen"]["station"], "MI_Lehanagh_Pool")

    def test_a_spot_out_of_range_is_published_with_a_distance_reason(self):
        stations, _ = self.gather()
        assignments = assign_stations(SPOTS, stations, self.now)
        self.assertIsNone(assignments["ballyholme"]["station"])
        self.assertIn("beyond the 60 km limit", assignments["ballyholme"]["reason"])
        self.assertGreater(assignments["ballyholme"]["distanceKm"], 100)
        self.assertNotIn("series", assignments["ballyholme"])

    def test_a_station_in_range_but_silent_gives_a_freshness_reason(self):
        stations, _ = self.gather(until={"M2": self.end - timedelta(days=4)})
        assignments = assign_stations(SPOTS, stations, self.now)
        self.assertIsNone(assignments["dollymount"]["station"])
        self.assertIn("last reported", assignments["dollymount"]["reason"])
        self.assertIn("beyond the 48 h limit", assignments["dollymount"]["reason"])

    def test_both_limits_are_configurable(self):
        stations, _ = self.gather(until={"M2": self.end - timedelta(days=4)})
        patient = assign_stations(SPOTS, stations, self.now, maximum_age_hours=200)
        self.assertEqual(patient["dollymount"]["station"], "IWB_M2")
        buoys = {k: v for k, v in stations.items() if v["network"] == "buoy"}
        far = assign_stations(SPOTS, buoys, self.now, maximum_km=500, maximum_age_hours=200)
        self.assertEqual(far["ballyholme"]["station"], "IWB_M2")
        strict = assign_stations(SPOTS, stations, self.now, maximum_km=1)
        self.assertIsNone(strict["rusheen"]["station"])

    # --- end to end -------------------------------------------------------
    def run_main(self, argv=("fetch_sea_temperature.py",), **kwargs):
        now = datetime.now(timezone.utc)
        end = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        fake = FakeErddap(end - timedelta(days=7), end, **kwargs)
        with patch("fetch_sea_temperature.ROOT", self.root), patch("sys.argv", list(argv)), \
             patch("fetch_sea_temperature.load_spots", return_value=SPOTS), \
             patch("fetch_sea_temperature.fetch_csv", side_effect=fake):
            main()
        return json.loads((self.root / "public/marine/sea-temperature.json").read_text())

    def published(self):
        return self.root / "public/marine/sea-temperature.json"

    def test_a_full_run_publishes_a_manifest_the_publisher_accepts(self):
        manifest = self.run_main()
        self.assertEqual((manifest["kind"], manifest["model"], manifest["schemaVersion"]),
                         ("observation", "sea-temperature", 1))
        self.assertEqual(manifest["variable"]["units"], "°C")
        self.assertEqual(manifest["attribution"], "Sea temperature © Marine Institute, CC BY 4.0")
        self.assertEqual(manifest["licenseUrl"], "https://creativecommons.org/licenses/by/4.0/")
        self.assertIn("erddap.marine.ie", manifest["sourceUrl"])
        self.assertIn("Observations, not a forecast", manifest["processing"])
        self.assertEqual(manifest["stepMinutes"], 180)
        self.assertEqual(manifest["spots"]["rusheen"]["station"], "IC_Casheen")
        self.assertIsNone(manifest["spots"]["ballyholme"]["station"])
        manifest_, _, objects = validate_bundle(self.root / "public", "sea-temperature",
                                                max_age_hours=48)
        self.assertEqual(objects, [])  # Self-contained: nothing immutable to upload.
        self.assertEqual(manifest_["run"], manifest["run"])

    def test_the_run_is_the_newest_observation_hour_not_the_ingest_hour(self):
        manifest = self.run_main()
        newest = max(sea.moment(station["latest"]["time"])
                     for station in manifest["stations"].values())
        self.assertEqual(manifest["run"], newest.strftime("%Y%m%d%H"))
        self.assertEqual(sea.moment(manifest["runTime"]),
                         newest.replace(minute=0, second=0, microsecond=0))
        self.assertGreater(sea.moment(manifest["generatedAt"]), newest - timedelta(hours=2))

    def test_publication_writes_only_the_archive_and_the_pointer(self):
        self.run_main()
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root / "public", "sea-temperature", "test",
                                 max_age_hours=48), "published")
        self.assertEqual(s3.writes[-1], "marine/sea-temperature.json")
        self.assertIn("marine/manifests/sea-temperature/", s3.writes[-2])
        self.assertEqual(len(s3.writes), 2)

    def test_a_corrupt_source_preserves_the_last_published_manifest(self):
        published = self.published()
        published.parent.mkdir(parents=True)
        published.write_text('{"run":"last-good"}')
        with self.assertRaises(ValueError):
            self.run_main(until={name: self.start - timedelta(days=400)
                                 for name in ("M2", "M3", "Casheen",
                                              "Mace Head Buoy Deployment Location",
                                              "Lehanagh Pool Buoy Deployment Location")})
        self.assertEqual(json.loads(published.read_text()), {"run": "last-good"})

    def test_bad_arguments_are_refused(self):
        for argv in (("x", "--max-distance-km", "0"), ("x", "--max-distance-km", "900"),
                     ("x", "--max-observation-age-hours", "0"), ("x", "--days", "0"),
                     ("x", "--days", "99")):
            with self.subTest(argv=argv), self.assertRaises(SystemExit), \
                 contextlib.redirect_stderr(io.StringIO()):
                self.run_main(argv)

    # --- contract ---------------------------------------------------------
    def test_the_publisher_rejects_a_manifest_that_lies_about_its_readings(self):
        manifest = self.run_main()
        published = self.published()
        stations, spots = manifest["stations"], manifest["spots"]
        first = spots["rusheen"]
        future = sea.stamp(datetime.now(timezone.utc) + timedelta(days=1))
        for label, change in [
            ("no stations", {"stations": {}}),
            ("no spots", {"spots": {}}),
            ("unknown network", {"stations": {**stations, "IWB_M2": {
                **stations["IWB_M2"], "network": "satellite"}}}),
            ("impossible value", {"stations": {**stations, "IWB_M2": {
                **stations["IWB_M2"], "latest": {**stations["IWB_M2"]["latest"], "value": 91.0}}}}),
            ("future reading", {"stations": {**stations, "IWB_M2": {
                **stations["IWB_M2"], "latest": {**stations["IWB_M2"]["latest"], "time": future}}}}),
            ("unparseable time", {"stations": {**stations, "IWB_M2": {
                **stations["IWB_M2"], "latest": {"time": "whenever", "value": 15.0}}}}),
            ("no sea temperature units", {"variable": {"label": "Sea temperature"}}),
            ("unknown station", {"spots": {**spots, "rusheen": {**first, "station": "IWB_M9"}}}),
            ("missing reason", {"spots": {**spots, "ballyholme": {"station": None,
                                                                 "distanceKm": 130.0}}}),
            ("empty series", {"spots": {**spots, "rusheen": {**first, "series": []}}}),
            ("misordered series", {"spots": {**spots, "rusheen": {
                **first, "series": list(reversed(first["series"]))}}}),
            ("series value out of range", {"spots": {**spots, "rusheen": {
                **first, "series": [{**first["series"][0], "value": -40.0}] + first["series"][1:]}}}),
            ("series past its own latest", {"spots": {**spots, "rusheen": {
                **first, "latest": {**first["latest"], "time": first["series"][0]["time"]}}}}),
            ("run is not the newest hour", {"run": (sea.moment(manifest["runTime"])
                                                    - timedelta(hours=3)).strftime("%Y%m%d%H"),
                                            "runTime": sea.stamp(sea.moment(manifest["runTime"])
                                                                 - timedelta(hours=3))}),
        ]:
            with self.subTest(change=label):
                published.write_text(json.dumps({**manifest, **change}))
                with self.assertRaises(ValueError):
                    validate_bundle(self.root / "public", "sea-temperature", max_age_hours=48)

    def test_status_reports_the_newest_observation_age_and_never_calls_it_expired(self):
        self.run_main()
        now = datetime.now(timezone.utc)
        row = describe(self.root / "public", "sea-temperature", now)
        self.assertEqual((row["state"], row["ok"], row["kind"]), ("fresh", True, "observation"))
        self.assertNotIn("coverageEnds", row)
        self.assertLess(row["observationAgeHours"], 2)
        self.assertEqual((row["stations"], row["spots"]), (5, 3))
        stale = describe(self.root / "public", "sea-temperature", now + timedelta(days=5))
        self.assertEqual(stale["state"], "stale")

    def test_prune_keeps_a_manifest_that_points_at_nothing(self):
        self.run_main()
        result = prune_published(self.root / "public", max_age_hours=0)
        self.assertEqual(result["removed"], [])
        self.assertTrue(self.published().is_file())


if __name__ == "__main__":
    unittest.main()
