"""deploy/schedules.py: the timetable editor keeps jobs.toml's comments and refuses bad edits.

    .venv/bin/python -m unittest deploy/test_schedules.py
"""
import json
from pathlib import Path
import shutil
import sys
import tempfile
import types
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import schedules  # noqa: E402

TOML = """[[jobs]]
id = "harmonie"
models = ["harmonie"]
args = ["--step", "1"]
minutes = [45]              # Hourly: Met Éireann publishes an hourly DINI cycle.
timeout_seconds = 3300

[[jobs]]
id = "icon-eu"
models = ["icon-eu"]
hours = [3, 9, 15, 21]      # 00/06/12/18 UTC cycles plus ~3.5 h publication lag.
minutes = [30]
timeout_seconds = 3300

# A comment that belongs to the next table.
[[jobs]]
id = "prune"
command = "prune"
minutes = [10]
"""


def arguments(job, **changes):
    values = {"set": job, "enabled": None, "hours": None, "minutes": None, "memory": None}
    return types.SimpleNamespace(**{**values, **changes})


class EditTest(unittest.TestCase):
    def test_a_value_changes_and_its_comment_stays(self):
        text = schedules.edit(TOML, "icon-eu", hours=[4, 10], minutes=[35])
        self.assertIn("hours = [4, 10]      # 00/06/12/18 UTC cycles", text)
        self.assertIn("minutes = [35]\ntimeout_seconds = 3300\n\n# A comment that belongs", text)

    def test_every_hour_removes_hours_but_keeps_its_comment(self):
        text = schedules.edit(TOML, "icon-eu", hours="every")
        self.assertNotIn("hours =", text)
        self.assertIn("# 00/06/12/18 UTC cycles plus ~3.5 h publication lag.", text)

    def test_a_new_key_lands_inside_its_own_table(self):
        text = schedules.edit(TOML, "icon-eu", enabled=False, memory="3Gb")
        block = text.split("[[jobs]]")[2]
        self.assertIn('enabled = false', block)
        self.assertIn('memory = "3Gb"', block)
        self.assertNotIn("A comment that belongs", block.split("memory")[0])
        self.assertNotIn("enabled = false", schedules.edit(text, "icon-eu", enabled=True))

    def test_an_unknown_job_is_refused(self):
        with self.assertRaisesRegex(ValueError, "No job"):
            schedules.edit(TOML, "gfs", minutes=[0])


class SetTest(unittest.TestCase):
    """apply_set against copies: jobs.toml and both generated files in a temp folder."""

    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.folder)
        self.jobs = self.folder / "jobs.toml"
        self.jobs.write_text(TOML)
        for name, value in (("JOBS_FILE", self.jobs),
                            ("HOME_COMPUTE_FILE", self.folder / "home-compute.json"),
                            ("CLOUDFLARE_FILE", self.folder / "jobs.json")):
            patcher = mock.patch.object(schedules, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        # load() defaults to the module's JOBS_FILE at definition time; follow the patch.
        patcher = mock.patch.object(schedules, "load", lambda path=None, load=schedules.load: load(path or self.jobs))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_an_edit_reaches_both_generated_files(self):
        schedules.apply_set(arguments("harmonie", minutes="5,35", memory="3Gb"))
        self.assertIn("minutes = [5, 35]", self.jobs.read_text())
        home = json.loads((self.folder / "home-compute.json").read_text())["jobs"][0]
        self.assertEqual(home["schedule"]["at"], {"minutes": [5, 35]})
        self.assertEqual(home["task"]["resources"]["memory"], "3Gb")
        cloudflare = json.loads((self.folder / "jobs.json").read_text())["jobs"][0]
        self.assertEqual((cloudflare["minutes"], cloudflare["size"]), ([5, 35], "large"))

    def test_a_minute_off_cloudflares_tick_is_refused_and_nothing_is_written(self):
        with self.assertRaisesRegex(ValueError, "5-minute mark"):
            schedules.apply_set(arguments("harmonie", minutes="7"))
        self.assertEqual(self.jobs.read_text(), TOML)

    def test_the_sweep_keeps_its_fixed_slot(self):
        with self.assertRaisesRegex(ValueError, "fixed time"):
            schedules.apply_set(arguments("prune", hours="3"))
        schedules.apply_set(arguments("prune", enabled="false"))
        self.assertIn("enabled = false", self.jobs.read_text().split("[[jobs]]")[3])

    def test_memory_outside_the_choices_is_refused(self):
        with self.assertRaisesRegex(ValueError, "Memory must be one of"):
            schedules.apply_set(arguments("harmonie", memory="6Gb"))

    def test_a_ceiling_too_close_to_the_measured_peak_is_refused(self):
        with mock.patch.dict(schedules.MEASURED_PEAK_MB, {"harmonie": 400}):
            with self.assertRaisesRegex(ValueError, "measured using 400 MB"):
                schedules.apply_set(arguments("harmonie", memory="512Mb"))
            self.assertEqual(self.jobs.read_text(), TOML)
            schedules.apply_set(arguments("harmonie", memory="1Gb"))
        self.assertIn('memory = "1Gb"', self.jobs.read_text())


class ResourcesTest(unittest.TestCase):
    """The shipped ceilings: measured, with headroom, and small enough to share the VM."""

    # Bacalhau's capacity in the recommended Colima VM (2 GiB, half a GiB kept back
    # for Docker and the kernel; one CPU, so one job at a time):
    # deploy/home-compute/README.md.
    CPUS, MEMORY_MB = 1, 1536

    def test_every_enabled_job_is_measured_and_has_twice_its_peak(self):
        for job in schedules.scheduled(schedules.load()):
            if not job["enabled"] or job["command"] == "prune":
                continue
            with self.subTest(job=job["id"]):
                peak = max(schedules.MEASURED_PEAK_MB[model] for model in job["models"])
                ceiling = schedules.memory_mb(schedules.resources_for(job)["memory"])
                self.assertGreaterEqual(ceiling, 2 * peak)

    def test_the_largest_enabled_job_fits_the_recommended_vm(self):
        enabled = [schedules.resources_for(job) for job in schedules.scheduled(schedules.load())
                   if job["enabled"]]
        largest = max(schedules.memory_mb(resources["memory"]) for resources in enabled)
        self.assertLessEqual(largest, self.MEMORY_MB)

    def test_no_two_enabled_jobs_run_at_once(self):
        for job in schedules.scheduled(schedules.load()):
            if not job["enabled"]:
                continue
            with self.subTest(job=job["id"]):
                cpu = float(schedules.resources_for(job)["cpu"])
                self.assertLessEqual(cpu, self.CPUS)
                self.assertGreater(2 * cpu, self.CPUS)


class SweepTest(unittest.TestCase):
    """The bucket sweep in the real timetable: it deletes superseded run directories."""

    def test_the_bucket_sweep_runs_every_hour_at_a_minute_of_its_own(self):
        jobs = list(schedules.scheduled(schedules.load()))
        sweep = next(job for job in jobs if job["command"] == "prune")
        # Every hour, so a superseded run leaves the bucket 6-7 hours on, not 6-30.
        self.assertEqual(schedules.slots(sweep), {"minutes": schedules.SWEEP_MINUTES})
        taken = {minute for job in jobs if job["enabled"] and job["command"] != "prune"
                 for minute in job["minutes"]}
        self.assertFalse(taken & set(schedules.SWEEP_MINUTES))
        home = next(entry for entry in schedules.home_compute(schedules.load())["jobs"]
                    if entry["id"] == "prune")
        self.assertEqual(home["schedule"]["at"], {"minutes": schedules.SWEEP_MINUTES})


if __name__ == "__main__":
    unittest.main()
