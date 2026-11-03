"""The daylight gate: the riding window follows the season, and the worker obeys it."""
import contextlib
from datetime import datetime, timedelta, timezone
import io
import json
import unittest
from unittest import mock

import daylight
import worker

ARGS = ["--step", "1", "--daylight-only", "--always-hours", "5,19"]
SLOT_HOURS = range(3, 22)  # deploy/local/jobs.toml: HARMONIE at :35 from 03 to 21 UTC.


def at(text):
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


def running_slots(day, args=ARGS):
    """The :35 slots of `day` (YYYY-MM-DD) that fetch, as UTC hours."""
    return [hour for hour in SLOT_HOURS if daylight.slot_runs(args, at(f"{day}T{hour:02d}:35"))]


class TwilightTest(unittest.TestCase):
    def assertNear(self, moment, expected, minutes=4):
        self.assertLessEqual(abs((moment - at(expected)).total_seconds()), minutes * 60,
                             f"{moment:%H:%M} is not about {expected}")

    def test_civil_twilight_over_the_middle_of_ireland(self):
        # Civil twilight at 53.4N 8.0W, from the NOAA solar calculator.
        first, last = daylight.civil_twilight(at("2026-11-03T12:00"))
        self.assertNear(first, "2026-11-03T06:57")
        self.assertNear(last, "2026-11-03T17:33")
        first, last = daylight.civil_twilight(at("2026-06-21T12:00"))
        self.assertNear(first, "2026-06-21T03:10")
        self.assertNear(last, "2026-06-21T21:56")

    def test_it_agrees_with_the_sites_sun_maths(self):
        # force5/src/sun.ts's civilDawn and civilDusk at the same point and day.
        first, last = daylight.civil_twilight(at("2026-12-21T00:00"))
        self.assertNear(first, "2026-12-21T08:02", minutes=1)
        self.assertNear(last, "2026-12-21T16:57", minutes=1)

    def test_the_window_opens_two_and_a_half_hours_before_first_light(self):
        opens, closes = daylight.riding_window(at("2026-11-03T09:00"))
        first, last = daylight.civil_twilight(at("2026-11-03T09:00"))
        self.assertEqual((first - opens, closes), (timedelta(hours=2, minutes=30), last))

    def test_any_time_of_day_gives_that_days_window(self):
        self.assertEqual(daylight.riding_window(at("2026-11-03T00:01")),
                         daylight.riding_window(at("2026-11-03T23:59")))


class GateTest(unittest.TestCase):
    def test_november_runs_from_before_dawn_to_dusk_and_the_evening(self):
        # Light from about 07:00 to 17:30 UTC: the window is 04:27 to 17:33, so
        # 04:35 is the first slot and 16:35 the last before the evening's.
        self.assertEqual(running_slots("2026-11-03"), [*range(4, 17), 19])
        runs, details = daylight.gate(at("2026-11-03T04:20"))
        self.assertFalse(runs)
        self.assertEqual(details["reason"], "dark")
        self.assertIn("before the riding window", details["message"])
        self.assertTrue(daylight.gate(at("2026-11-03T17:30"))[0])
        self.assertFalse(daylight.gate(at("2026-11-03T17:35"))[0])
        runs, details = daylight.gate(at("2026-11-03T18:35"))
        self.assertFalse(runs)
        self.assertIn("after dark", details["message"])
        self.assertIn("04:27 to 17:33 UTC", details["message"])

    def test_june_runs_every_slot(self):
        # Light from about 03:10 to 21:55 UTC (04:10 to 22:55 by the Irish clock).
        self.assertEqual(running_slots("2026-06-21"), list(SLOT_HOURS))
        self.assertEqual(daylight.gate(at("2026-06-21T03:35"))[1]["reason"], "daylight")
        self.assertFalse(daylight.gate(at("2026-06-21T22:35"))[0])

    def test_the_darkest_day_keeps_the_morning_and_evening_runs(self):
        # Light from 08:02 to 16:57 UTC; the window opens at 05:32, just before
        # the 05:35 slot, which runs regardless anyway.
        self.assertEqual(running_slots("2026-12-21"), [*range(5, 17), 19])
        self.assertEqual(daylight.gate(at("2026-12-21T05:35"), (5, 19))[1]["reason"], "always")

    def test_the_evening_run_ignores_the_gate(self):
        # 19:35 UTC is long after dark from October to March, but riders plan
        # tomorrow with it.
        for day in ("2026-01-15", "2026-11-03", "2026-12-21"):
            with self.subTest(day=day):
                self.assertFalse(daylight.gate(at(f"{day}T19:35"))[0])
                runs, details = daylight.gate(at(f"{day}T19:35"), (5, 19))
                self.assertEqual((runs, details["reason"]), (True, "always"))
                self.assertFalse(daylight.gate(at(f"{day}T20:35"), (5, 19))[0])

    def test_nothing_jumps_on_the_days_the_clocks_change(self):
        # Ireland changes its clocks on 29 March and 25 October 2026; the gate is
        # in UTC and follows the sun, so its window moves by minutes, not an hour.
        for before, change, after in (("2026-03-28", "2026-03-29", "2026-03-30"),
                                      ("2026-10-24", "2026-10-25", "2026-10-26")):
            with self.subTest(change=change):
                windows = [daylight.riding_window(at(f"{day}T12:00")) for day in (before, change, after)]
                for (opened, closed), (opens, closes) in zip(windows, windows[1:]):
                    self.assertLess(abs((opens - opened) - timedelta(days=1)), timedelta(minutes=5))
                    self.assertLess(abs((closes - closed) - timedelta(days=1)), timedelta(minutes=5))
                self.assertEqual(running_slots(before), running_slots(change))
        # The spring change day: light from 05:36 to 19:36 UTC, so the window
        # opens at 03:06 and 19:35 is daylight in its own right.
        self.assertEqual(running_slots("2026-03-29"), list(range(3, 20)))
        # The autumn one: light from 06:41 to 17:50 UTC, the window from 04:11.
        self.assertEqual(running_slots("2026-10-25"), [*range(4, 18), 19])

    def test_the_window_is_never_empty_and_never_misses_midday(self):
        day = at("2026-01-01T12:00")
        while day.year == 2026:
            with self.subTest(day=day.date()):
                count = len(running_slots(day.date().isoformat()))
                self.assertGreaterEqual(count, 13)
                self.assertLessEqual(count, 19)
                self.assertTrue(daylight.gate(day)[0])
            day += timedelta(days=1)

    def test_an_ungated_job_always_runs(self):
        self.assertTrue(daylight.slot_runs(["--step", "1"], at("2026-12-21T02:00")))
        self.assertEqual(running_slots("2026-12-21", ["--daylight-only"]), list(range(5, 17)))

    def test_a_naive_time_is_refused(self):
        with self.assertRaises(ValueError):
            daylight.gate(datetime(2026, 11, 3, 12))

    def test_always_hours_are_whole_utc_hours(self):
        self.assertEqual(daylight.hours_list("19, 5,5"), (5, 19))
        for bad in ("", "24", "five", "-1"):
            with self.subTest(value=bad), self.assertRaises(ValueError):
                daylight.hours_list(bad)


class WorkerGateTest(unittest.TestCase):
    """worker.py with --daylight-only: a dark slot stops before the bucket or the lock."""

    def main(self, *argv, now):
        output = io.StringIO()
        with mock.patch("sys.argv", ["worker.py", *argv]), \
                mock.patch.object(worker, "make_client") as client, \
                mock.patch.object(worker, "workspace_lock") as lock, \
                mock.patch.object(worker, "run_models", return_value=0) as run, \
                mock.patch.object(worker, "datetime", wraps=datetime) as clock, \
                contextlib.redirect_stdout(output):
            clock.now.return_value = now
            code = worker.main()
        events = [json.loads(line) for line in output.getvalue().splitlines() if line.startswith("{")]
        return code, events, client, lock, run

    def test_a_dark_slot_reports_nothing_new_and_downloads_nothing(self):
        code, events, client, lock, run = self.main(
            "--models", "harmonie", "--step", "1", "--daylight-only", "--always-hours", "5,19",
            "--bucket", "forecast", now=at("2026-11-03T21:35"))
        self.assertEqual(code, 0)
        self.assertEqual([(event["event"], event["model"], event["reason"]) for event in events],
                         [("forecast_unchanged", "harmonie", "dark")])
        self.assertIn("after dark", events[0]["message"])
        # Home Compute reads a run whose every event ends in _unchanged as "unchanged".
        self.assertTrue(all(event["event"].endswith("_unchanged") for event in events))
        client.assert_not_called()
        lock.assert_not_called()
        run.assert_not_called()

    def test_a_daylight_slot_runs_as_before(self):
        code, events, client, lock, run = self.main(
            "--models", "harmonie", "--daylight-only", "--always-hours", "5,19",
            now=at("2026-11-03T12:35"))
        self.assertEqual((code, events), (0, []))
        run.assert_called_once()

    def test_the_evening_slot_runs_after_dark(self):
        code, events, client, lock, run = self.main(
            "--models", "blend", "--daylight-only", "--always-hours", "5,19",
            now=at("2026-12-21T19:45"))
        self.assertEqual((code, events), (0, []))
        run.assert_called_once()

    def test_without_the_flag_the_light_does_not_matter(self):
        code, events, client, lock, run = self.main("--models", "harmonie", now=at("2026-12-21T02:35"))
        self.assertEqual((code, events), (0, []))
        run.assert_called_once()

    def test_always_hours_need_the_gate_and_whole_hours(self):
        for argv in (["--always-hours", "5,19"], ["--daylight-only", "--always-hours", "25"]):
            with self.subTest(argv=argv), contextlib.redirect_stderr(io.StringIO()), \
                    self.assertRaises(SystemExit) as stopped:
                self.main("--models", "harmonie", *argv, now=at("2026-11-03T12:35"))
            self.assertEqual(stopped.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
