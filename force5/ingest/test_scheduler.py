"""The local cadence scheduler: schedule arithmetic and forgiving configuration."""
import atexit
import contextlib
from datetime import datetime, timedelta, timezone
import io
from pathlib import Path
import shutil
import tempfile
import unittest

import scheduler
from registry import MODELS

NOW = datetime(2026, 9, 16, 12, 30, tzinfo=timezone.utc)
JOBS_FILE = Path(__file__).resolve().parents[2] / "deploy" / "local" / "jobs.toml"


SCRATCH = tempfile.mkdtemp(prefix="force5-schedule-")
atexit.register(shutil.rmtree, SCRATCH, ignore_errors=True)


def write(text):
    path = Path(SCRATCH, f"jobs-{len(list(Path(SCRATCH).iterdir()))}.toml")
    path.write_text(text)
    return str(path)


def load(text):
    """Load a schedule, swallowing the warning lines it prints."""
    with contextlib.redirect_stdout(io.StringIO()) as out:
        jobs = scheduler.load_jobs(write(text))
    return jobs, out.getvalue()


class NextDueTest(unittest.TestCase):
    def due(self, after=NOW, **job):
        return scheduler.next_due({"hours": list(range(24)), "minutes": [0], **job}, after)

    def test_hourly_at_a_fixed_minute(self):
        self.assertEqual(self.due(minutes=[45]),
                         datetime(2026, 9, 16, 12, 45, tzinfo=timezone.utc))

    def test_wraps_to_the_next_hour(self):
        self.assertEqual(self.due(minutes=[20]),
                         datetime(2026, 9, 16, 13, 20, tzinfo=timezone.utc))

    def test_six_hourly_cycle_offsets(self):
        self.assertEqual(self.due(hours=[4, 10, 16, 22], minutes=[0]),
                         datetime(2026, 9, 16, 16, 0, tzinfo=timezone.utc))

    def test_wraps_to_the_next_day(self):
        self.assertEqual(self.due(after=datetime(2026, 9, 16, 23, 30, tzinfo=timezone.utc),
                                  hours=[5], minutes=[10]),
                         datetime(2026, 9, 17, 5, 10, tzinfo=timezone.utc))

    def test_never_returns_the_current_minute(self):
        self.assertEqual(self.due(after=datetime(2026, 9, 16, 12, 45, tzinfo=timezone.utc),
                                  minutes=[45]),
                         datetime(2026, 9, 16, 13, 45, tzinfo=timezone.utc))

    def test_several_minutes_in_one_hour(self):
        self.assertEqual(self.due(minutes=[5, 35, 50]),
                         datetime(2026, 9, 16, 12, 35, tzinfo=timezone.utc))


class LoadJobsTest(unittest.TestCase):
    def test_reads_models_arguments_and_defaults(self):
        jobs, _ = load('[[jobs]]\nid = "gfs"\nmodels = ["gfs"]\nargs = ["--step", "3"]\n'
                       'hours = [4, 22, 4]\n')
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["models"], ["gfs"])
        self.assertEqual(jobs[0]["args"], ["--step", "3"])
        self.assertEqual(jobs[0]["hours"], [4, 22])
        self.assertEqual(jobs[0]["minutes"], [0])
        self.assertIsNone(jobs[0]["timeout_seconds"])
        self.assertTrue(jobs[0]["enabled"])

    def test_an_unknown_model_disables_only_its_own_job(self):
        jobs, log = load('[[jobs]]\nid = "wave"\nmodels = ["nws-wave"]\n\n'
                         '[[jobs]]\nid = "gfs"\nmodels = ["gfs"]\n')
        self.assertEqual([job["id"] for job in jobs], ["gfs"])
        self.assertIn("schedule_rejected", log)
        self.assertIn("No importer for nws-wave", log)

    def test_rejects_duplicate_ids_but_keeps_the_first(self):
        jobs, log = load('[[jobs]]\nid = "gfs"\nmodels = ["gfs"]\n\n'
                         '[[jobs]]\nid = "gfs"\nmodels = ["ecmwf"]\n')
        self.assertEqual([job["models"] for job in jobs], [["gfs"]])
        self.assertIn("Duplicate job id", log)

    def test_rejects_impossible_schedules(self):
        jobs, log = load('[[jobs]]\nid = "bad"\nmodels = ["gfs"]\nminutes = [90]\n\n'
                         '[[jobs]]\nid = "good"\nmodels = ["gfs"]\nminutes = [15]\n')
        self.assertEqual([job["id"] for job in jobs], ["good"])
        self.assertIn("0..59", log)

    def test_rejects_an_unknown_command(self):
        jobs, log = load('[[jobs]]\nid = "x"\ncommand = "rm"\n\n'
                         '[[jobs]]\nid = "prune"\ncommand = "prune"\nhours = [5]\n')
        self.assertEqual([job["id"] for job in jobs], ["prune"])
        self.assertIn("Unknown command", log)

    def test_a_worker_job_needs_a_model(self):
        _, log = load('[[jobs]]\nid = "empty"\n\n[[jobs]]\nid = "gfs"\nmodels = ["gfs"]\n')
        self.assertIn("needs at least one model", log)

    def test_disabled_jobs_are_kept_but_not_scheduled(self):
        jobs, _ = load('[[jobs]]\nid = "gfs"\nmodels = ["gfs"]\nenabled = false\n')
        self.assertFalse(jobs[0]["enabled"])
        self.assertIn("disabled", scheduler.describe(jobs, NOW))

    def test_unknown_keys_warn_without_rejecting(self):
        jobs, log = load('[[jobs]]\nid = "gfs"\nmodels = ["gfs"]\nweekday = "monday"\n')
        self.assertEqual(len(jobs), 1)
        self.assertIn("Ignoring unknown key", log)

    def test_a_schedule_with_no_usable_job_is_fatal(self):
        with self.assertRaises(ValueError), contextlib.redirect_stdout(io.StringIO()):
            scheduler.load_jobs(write('[[jobs]]\nid = "wave"\nmodels = ["nws-wave"]\n'))

    def test_a_file_without_a_jobs_array_is_fatal(self):
        with self.assertRaises(ValueError):
            scheduler.load_jobs(write('harmonie = true\n'))


class CommandTest(unittest.TestCase):
    def test_worker_command_passes_models_then_arguments(self):
        job, = load('[[jobs]]\nid = "gfs"\nmodels = ["gfs"]\nargs = ["--step", "3"]\n')[0]
        argv = scheduler.command_for(job)
        self.assertTrue(argv[1].endswith("worker.py"))
        self.assertEqual(argv[2:], ["--models", "gfs", "--step", "3"])

    def test_retention_command_takes_no_models(self):
        job, = load('[[jobs]]\nid = "prune"\ncommand = "prune"\nargs = ["--dry-run"]\n')[0]
        argv = scheduler.command_for(job)
        self.assertTrue(argv[1].endswith("prune.py"))
        self.assertEqual(argv[2:], ["--dry-run"])


class ServeTest(unittest.TestCase):
    def test_runs_a_due_job_and_reschedules_it(self):
        jobs, _ = load('[[jobs]]\nid = "gfs"\nmodels = ["gfs"]\nminutes = [31]\n')
        clock = [NOW, NOW.replace(minute=31), NOW.replace(minute=31), NOW.replace(minute=31)]
        ran = []

        def run(job):
            ran.append(job["id"])
            raise KeyboardInterrupt  # Leave the loop the way a container stop would.

        with self.assertRaises(KeyboardInterrupt), contextlib.redirect_stdout(io.StringIO()):
            scheduler.serve(jobs, sleep=lambda _: None, now=lambda: clock.pop(0), run=run)
        self.assertEqual(ran, ["gfs"])

    def test_waits_while_nothing_is_due(self):
        jobs, _ = load('[[jobs]]\nid = "gfs"\nmodels = ["gfs"]\nminutes = [31]\n')
        slept = []

        def sleep(seconds):
            slept.append(seconds)
            if len(slept) > 2:
                raise KeyboardInterrupt

        with self.assertRaises(KeyboardInterrupt), contextlib.redirect_stdout(io.StringIO()):
            scheduler.serve(jobs, sleep=sleep, now=lambda: NOW, run=lambda job: 0)
        self.assertEqual(slept, [60.0, 60.0, 60.0])


class ShippedScheduleTest(unittest.TestCase):
    """The schedule in the repository must stay loadable and fully understood."""

    def test_every_shipped_job_is_usable(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            jobs = scheduler.load_jobs(JOBS_FILE)
        self.assertNotIn("schedule_rejected", out.getvalue())
        self.assertNotIn("schedule_warning", out.getvalue())
        identities = [job["id"] for job in jobs]
        self.assertEqual(identities, ["harmonie", "icon-eu", "icon-eu-weather", "ecmwf",
                                      "harmonie-eps", "ecmwf-ens", "aifs", "gfs", "gefs", "arpege",
                                      "arome", "gfs-wave", "gfs-weather", "mi-swan", "currents", "ecmwf-wave", "tides",
                                      "sea-temperature", "blend", "blend-after-harmonie", "wind-obs",
                                      "forecast-archive",
                                      "verify", "prune"])
        # The lagged HARMONIE ensemble ships disabled: it is heavy on Met Éireann's
        # bandwidth for a thin spread, so an operator enables it knowingly. The
        # other six are retired to keep downloads near 80 GB a month.
        self.assertEqual([job["id"] for job in jobs if not job["enabled"]],
                         ["harmonie-eps", "ecmwf-ens", "aifs", "gefs", "arpege", "arome",
                          "ecmwf-wave"])
        for job in jobs:
            self.assertIsNotNone(scheduler.next_due(job, NOW), job["id"])
            for model in job["models"]:
                self.assertIn(model, MODELS)

    def test_a_once_or_twice_daily_run_is_not_stale_before_the_next_can_replace_it(self):
        # The served run must stay within maxAgeHours until the slot after one that
        # failed has published, with an hour more for queueing behind another job in
        # Home Compute. HARMONIE's newest complete cycle is about three hours behind
        # each slot. ECMWF takes the 00 and 12 UTC runs, so one run must last from
        # its first slot past a whole failed cycle to the retry of the one after.
        with contextlib.redirect_stdout(io.StringIO()):
            jobs = {job["id"]: job for job in scheduler.load_jobs(JOBS_FILE)}

        def slots(model):
            day = datetime(2026, 10, 12, tzinfo=timezone.utc)
            job = jobs[model]
            return [day.replace(hour=hour, minute=minute)
                    for hour in job["hours"] for minute in job["minutes"]]

        def hours(earlier, later):
            return (later - earlier).total_seconds() / 3600

        harmonie = slots("harmonie")
        gaps = [hours(a, b) for a, b in zip(harmonie, harmonie[1:])] + [
            24 - hours(harmonie[0], harmonie[-1])]
        missed_one = max(a + b for a, b in zip(gaps, gaps[1:] + gaps[:1]))
        self.assertLessEqual(3 + missed_one + 1, MODELS["harmonie"]["maxAgeHours"])

        ecmwf = slots("ecmwf")
        for cycle in (0, 12):
            # A cycle's first slot, its retry, and the other cycle's.
            own = [slot for slot in ecmwf if (slot.hour - cycle) % 24 < 12]
            first = own[0].hour - cycle + own[0].minute / 60  # The run's age then.
            self.assertGreater(first, 7.6, f"ECMWF's {cycle:02d} UTC run is complete "
                               "about 7 h 35 m after its run time")
            self.assertLessEqual(first + 24 + hours(own[0], own[-1]) + 1,
                                 MODELS["ecmwf"]["maxAgeHours"])

    def test_a_run_on_time_is_never_stale(self):
        # "Stale" means later than the schedule allows (issue #120), so a model on its
        # normal cadence must never reach maxAgeHours: not a once-a-day run the hours
        # before tomorrow's slot. Per model, the provider's cycles and how long after
        # its run time a cycle is complete (jobs.toml's comments). Each slot takes the
        # newest complete cycle; the served run is oldest just before a slot that
        # takes a newer one has finished (its timeout), plus an hour of queueing.
        cadence = {
            "harmonie": (range(24), timedelta(hours=2, minutes=25)),
            "icon-eu": ((0,), timedelta(hours=3, minutes=30)),
            "icon-eu-weather": ((0,), timedelta(hours=3, minutes=30)),
            "ecmwf": ((0, 12), timedelta(hours=7, minutes=35)),
            "gfs": ((0, 6, 12, 18), timedelta(hours=4)),
            "gfs-wave": ((0, 6, 12, 18), timedelta(hours=3, minutes=50)),
            # The whole 384 h run, listed later than the wind's 240 h.
            "gfs-weather": ((0, 6, 12, 18), timedelta(hours=4, minutes=45)),
            "mi-swan": ((0,), timedelta(hours=9)),
            # ROMS writes the day's forecast files by about 00:55 UTC; ERDDAP's
            # aggregate takes them up within the hour or so after.
            "currents": ((0,), timedelta(hours=2)),
        }
        with contextlib.redirect_stdout(io.StringIO()):
            jobs = {job["id"]: job for job in scheduler.load_jobs(JOBS_FILE)}
        enabled = {model for job in jobs.values() if job["enabled"] for model in job["models"]
                   if MODELS[model]["kind"] in ("wind", "wave", "weather", "current")}
        self.assertEqual(enabled, set(cadence), "Give a newly enabled forecast its cadence here")
        start = datetime(2026, 10, 12, tzinfo=timezone.utc)
        for model, (cycles, lag) in cadence.items():
            job = jobs[model]
            slots = sorted(start + timedelta(days=day, hours=hour, minutes=minute)
                           for day in range(3) for hour in job["hours"] for minute in job["minutes"])

            def newest(slot):
                ready = slot - lag
                return max(ready.replace(hour=cycle, minute=0) - timedelta(days=back)
                           for back in (0, 1) for cycle in cycles
                           if ready.replace(hour=cycle, minute=0) - timedelta(days=back) <= ready)

            served, oldest = newest(slots[0]), 0.0
            for slot in slots[1:]:
                run = newest(slot)
                if run > served:
                    landed = slot + timedelta(seconds=job["timeout_seconds"])
                    oldest = max(oldest, (landed - served).total_seconds() / 3600)
                    served = run
            self.assertGreater(oldest, 0, model)
            self.assertLessEqual(oldest + 1, MODELS[model]["maxAgeHours"],
                                 f"{model}'s run is {oldest:.1f} h old on time, "
                                 f"too near its {MODELS[model]['maxAgeHours']} h limit")

    def test_every_registered_model_has_a_cadence(self):
        with contextlib.redirect_stdout(io.StringIO()):
            jobs = scheduler.load_jobs(JOBS_FILE)
        scheduled = {model for job in jobs for model in job["models"]}
        self.assertEqual(scheduled, set(MODELS),
                         "Give every registered model a cadence in deploy/local/jobs.toml")


if __name__ == "__main__":
    unittest.main()
