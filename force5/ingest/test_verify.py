"""Verification scoring: the pure arithmetic, the pairing, the blend and the daily sums."""
import contextlib
from datetime import datetime, timedelta, timezone
import io
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from archive import LocalArchive, forecast_key, observation_key, sums_key
from consensus import place_consensus
from publish_s3 import validate_bundle
from status import describe
import verify
from verify import (accumulate, angle_difference, blend_members, empty_sums, lead_bucket,
                    metrics, model_pairs, station_record)

NOW = datetime(2026, 10, 10, 7, 25, tzinfo=timezone.utc)
OLD_DAY, RECENT_DAY = "2026-10-05", "2026-10-09"


def iso(at):
    return at.isoformat().replace("+00:00", "Z")


def record(model, run, hours, u, v=0.0, gust=None, resolution=None, available=None,
           stations=("ME_1", "MI_M2")):
    """An archived run whose wind is a steady `u` from the west at every station."""
    return {"schemaVersion": 1, "model": model, "run": run.strftime("%Y%m%d%H"),
            "runTime": iso(run), "generatedAt": iso(available or run + timedelta(hours=3)),
            "archivedAt": iso((available or run + timedelta(hours=3)) + timedelta(minutes=20)),
            "resolutionKm": resolution, "hours": list(hours),
            "stations": {station: {"u": [u] * len(hours), "v": [v] * len(hours),
                                   "gust": [gust] * len(hours)} for station in stations}}


def day_file(day, speed, gust=None, heading=270, stations=("ME_1", "MI_M2")):
    start = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
    return {"schemaVersion": 1, "date": day,
            "stations": {"ME_1": {"name": "Coast", "class": "coastal", "lat": 54, "lon": -9,
                                  "source": "met-eireann"},
                         "MI_M2": {"name": "M2", "class": "buoy", "lat": 53.5, "lon": -5.4,
                                   "source": "marine-institute"}},
            "readings": {station: [[iso(start + timedelta(hours=h)), speed, gust, heading]
                                   for h in range(24)] for station in stations}}


class ArithmeticTests(unittest.TestCase):
    def test_lead_buckets_are_half_open(self):
        self.assertEqual([lead_bucket(h) for h in (0, 11.9, 12, 23, 24, 47, 48, 72, 119, 120, 360)],
                         ["0-12", "0-12", "12-24", "12-24", "24-48", "24-48", "48-72", "72-120",
                          "72-120", "120+", "120+"])
        self.assertIsNone(lead_bucket(-1))

    def test_angles_wrap(self):
        self.assertEqual(angle_difference(350, 10), 20)
        self.assertEqual(angle_difference(10, 350), 20)
        self.assertEqual(angle_difference(0, 180), 180)
        self.assertEqual(angle_difference(90, 90), 0)

    def test_sums_become_scores(self):
        sums = empty_sums()
        accumulate(sums, (8.0, 12.0, 280.0), (6.0, 10.0, 270.0))   # Hit, +2.
        accumulate(sums, (4.0, None, 90.0), (7.0, 11.0, 300.0))    # Miss, -3, 150° off.
        accumulate(sums, (7.0, 9.0, 10.0), (2.0, 4.0, 200.0))      # False alarm; calm-ish bearing.
        accumulate(sums, (1.0, 2.0, None), (1.5, 3.0, None))       # Correct negative.
        scored = metrics(sums)
        self.assertEqual(scored["n"], 4)
        self.assertEqual(scored["speedBias"], round((2 - 3 + 5 - 0.5) / 4, 2))
        self.assertEqual(scored["speedMae"], round((2 + 3 + 5 + 0.5) / 4, 2))
        self.assertAlmostEqual(scored["speedRmse"], round(math.sqrt((4 + 9 + 25 + 0.25) / 4), 2))
        self.assertEqual((scored["gustN"], scored["gustBias"]), (3, round((2 + 5 - 1) / 3, 2)))
        # Only the two pairs whose observed wind is at least 3 m/s score a bearing.
        self.assertEqual((scored["dirN"], scored["dirMae"]), (2, 80.0))
        self.assertEqual((scored["hits"], scored["misses"], scored["falseAlarms"]), (1, 1, 1))
        self.assertEqual((scored["pod"], scored["far"]), (0.5, 0.5))

    def test_nothing_to_score_is_none_not_zero(self):
        scored = metrics(empty_sums())
        self.assertEqual(scored["n"], 0)
        self.assertIsNone(scored["speedBias"])
        self.assertIsNone(scored["pod"])


class PairingTests(unittest.TestCase):
    def test_only_exact_valid_hours_on_the_day_pair(self):
        run = datetime(2026, 10, 4, 18, tzinfo=timezone.utc)
        rec = station_record(record("gfs", run, [0, 3, 6, 9, 30], 8.0))
        observed = verify.observed_hours(day_file(OLD_DAY, 6.0))
        pairs = list(model_pairs(rec, observed, OLD_DAY))
        # +6 h is 00 UTC on the 5th, +9 h is 03 UTC; +30 h is the 6th.
        self.assertEqual(sorted({lead for lead, *_ in pairs}), [6, 9])
        lead, station, forecast, observation = pairs[0]
        self.assertAlmostEqual(forecast[0], 8.0)
        self.assertAlmostEqual(forecast[2], 270.0)   # u > 0 blows east: from the west.
        self.assertEqual(observation, (6.0, None, 270))

    def test_off_the_hour_readings_are_not_paired(self):
        document = day_file(OLD_DAY, 6.0)
        document["readings"]["ME_1"].append(["2026-10-05T10:20:00Z", 9.0, None, 200])
        self.assertNotIn("2026-10-05T10:20:00Z", verify.observed_hours(document)["ME_1"])

    def test_the_blend_uses_what_had_been_published_by_its_issue_time(self):
        early = station_record(record("ecmwf", datetime(2026, 10, 4, 0, tzinfo=timezone.utc), [0], 5,
                                      available=datetime(2026, 10, 4, 4, tzinfo=timezone.utc)))
        late = station_record(record("ecmwf", datetime(2026, 10, 4, 6, tzinfo=timezone.utc), [0], 5,
                                     available=datetime(2026, 10, 4, 13, tzinfo=timezone.utc)))
        other = station_record(record("not-blended", datetime(2026, 10, 4, 6, tzinfo=timezone.utc),
                                      [0], 5))
        at_noon = blend_members([early, late, other], datetime(2026, 10, 4, 12, tzinfo=timezone.utc))
        self.assertEqual([r["run"] for r in at_noon], ["2026100400"])
        at_six = blend_members([early, late], datetime(2026, 10, 4, 18, tzinfo=timezone.utc))
        self.assertEqual([r["run"] for r in at_six], ["2026100406"])

    def test_the_blend_at_a_station_is_the_replica_of_the_sites_blend(self):
        issue = datetime(2026, 10, 4, 18, tzinfo=timezone.utc)
        harmonie = station_record(record("harmonie", datetime(2026, 10, 4, 12, tzinfo=timezone.utc),
                                         range(0, 49), 9.0, gust=13.0, resolution=2))
        ecmwf = station_record(record("ecmwf", datetime(2026, 10, 4, 12, tzinfo=timezone.utc),
                                      range(0, 121, 3), 3.0, v=-3.0, gust=6.0))
        observed = verify.observed_hours(day_file(OLD_DAY, 7.0, stations=("ME_1",)))
        # Six hours ahead happens once per issue time; the first is the blend issued
        # at 18 UTC on the 4th, valid at 00 UTC on the 5th.
        pairs = [pair for pair in verify.blend_pairs([harmonie, ecmwf], observed, OLD_DAY)
                 if pair[0] == 6]
        self.assertEqual(len(pairs), 4)
        expected = place_consensus(
            [verify.station_manifest(harmonie, "ME_1"), verify.station_manifest(ecmwf, "ME_1")],
            verify.BLEND_MODELS, "ME_1", ["2026-10-05T00:00:00Z"])
        _, station, forecast, _ = pairs[0]
        self.assertEqual(station, "ME_1")
        self.assertAlmostEqual(forecast[0], expected["median"][0])
        # HARMONIE reaches the hour, so the blend's wind and gust are HARMONIE's own.
        self.assertAlmostEqual(forecast[0], 9.0)
        self.assertAlmostEqual(forecast[1], 13.0)


class JobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.public = Path(self.temp.name) / "public"
        self.store = LocalArchive(self.public)
        for day in (OLD_DAY, RECENT_DAY):
            self.store.write(observation_key(day), day_file(day, 7.0, gust=10.0))
            start = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
            for hours_before in (6, 30):
                run = start - timedelta(hours=hours_before)
                self.store.write(forecast_key("harmonie", run.strftime("%Y%m%d%H")),
                                 record("harmonie", run, range(0, 61), 8.0, gust=11.0, resolution=2))
                self.store.write(forecast_key("gfs", run.strftime("%Y%m%d%H")),
                                 record("gfs", run, range(0, 121, 3), 5.0, gust=8.0))

    def score(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return verify.score_days(self.store, NOW)

    def test_only_days_beyond_the_observation_window_are_kept(self):
        results = self.score()
        self.assertEqual(sorted(results), [OLD_DAY, RECENT_DAY])
        self.assertTrue(self.store.exists(sums_key(OLD_DAY)))
        self.assertFalse(self.store.exists(sums_key(RECENT_DAY)))

    def test_a_kept_day_is_read_back_not_recomputed(self):
        first = self.score()
        with patch.object(verify, "day_sums", side_effect=AssertionError("recomputed")) as spy:
            with self.assertRaises(AssertionError):
                self.score()  # The recent day is still recomputed...
        spy.assert_called_once()
        self.store.write(observation_key(RECENT_DAY), {"readings": {}})  # ...so give it nothing.
        second = self.score()
        self.assertEqual(second[OLD_DAY][0], first[OLD_DAY][0])

    def test_a_changed_blend_replica_recomputes_kept_days(self):
        self.score()
        with patch.object(verify, "blend_signature", return_value="changed"), \
                patch.object(verify, "day_sums", wraps=verify.day_sums) as spy:
            self.score()
        self.assertEqual(spy.call_count, 2)

    def test_scores_publish_and_validate(self):
        document = verify.scores(self.score(), NOW)
        self.assertEqual(document["models"], ["blend", "gfs", "harmonie"])
        rows = {tuple(row[:3]): dict(zip(document["fields"], row))
                for row in document["byClass"]["30"]}
        harmonie = rows[("harmonie", "0-12", "coastal")]
        self.assertEqual(harmonie["speedBias"], 1.0)
        self.assertEqual(harmonie["gustBias"], 1.0)
        self.assertEqual((harmonie["pod"], harmonie["far"]), (1.0, 0.0))
        self.assertEqual(rows[("gfs", "24-48", "buoy")]["speedBias"], -2.0)
        self.assertEqual(rows[("gfs", "24-48", "buoy")]["misses"],
                         rows[("gfs", "24-48", "buoy")]["n"])
        self.assertIn(("blend", "0-12", "all"), rows)
        stations = {row[2] for row in document["byStation"]["90"]}
        self.assertEqual(stations, {"ME_1", "MI_M2"})
        self.assertEqual(document["windows"][0]["daysWithData"], 2)
        out = self.public / verify.SCORES
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(document))
        validate_bundle(self.public, "verify", 36, now=NOW)
        self.assertEqual(describe(self.public, "verify", NOW)["state"], "fresh")

    def test_an_empty_archive_still_publishes_an_honest_empty_scoreboard(self):
        empty = LocalArchive(Path(self.temp.name) / "other")
        with contextlib.redirect_stdout(io.StringIO()):
            document = verify.scores(verify.score_days(empty, NOW), NOW)
        self.assertEqual(document["byClass"], {"30": [], "90": []})
        self.assertEqual(document["windows"][1]["daysWithData"], 0)


if __name__ == "__main__":
    unittest.main()
