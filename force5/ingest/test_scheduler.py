"""The local cadence scheduler: schedule arithmetic and forgiving configuration."""
import atexit
import contextlib
from datetime import datetime, timezone
import io
from pathlib import Path
import shutil
import tempfile
import unittest

import scheduler
from worker import SCRIPTS

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
        jobs, log = load('[[jobs]]\nid = "tides"\nmodels = ["tides"]\n\n'
                         '[[jobs]]\nid = "gfs"\nmodels = ["gfs"]\n')
        self.assertEqual([job["id"] for job in jobs], ["gfs"])
        self.assertIn("schedule_rejected", log)
        self.assertIn("No importer for tides", log)

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
            scheduler.load_jobs(write('[[jobs]]\nid = "tides"\nmodels = ["tides"]\n'))

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
        self.assertEqual(identities, ["harmonie", "icon-eu", "ecmwf", "gfs", "prune", "status"])
        for job in jobs:
            self.assertTrue(job["enabled"], job["id"])
            self.assertIsNotNone(scheduler.next_due(job, NOW), job["id"])
            for model in job["models"]:
                self.assertIn(model, SCRIPTS)

    def test_the_wind_models_cover_every_importer(self):
        with contextlib.redirect_stdout(io.StringIO()):
            jobs = scheduler.load_jobs(JOBS_FILE)
        scheduled = {model for job in jobs for model in job["models"]}
        self.assertEqual(scheduled, set(SCRIPTS),
                         "Give every registered importer a cadence in deploy/local/jobs.toml")


if __name__ == "__main__":
    unittest.main()
