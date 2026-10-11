"""Phase timings: where a job's time went, in its event, its summary line and status."""
import contextlib
from io import StringIO
import json
from pathlib import Path
import subprocess
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import requests

import status
import timing
from timing import Timings, summary
from registry import UNCHANGED_EXIT
from test_publish_s3 import FakeS3


class Clock:
    """A clock the test moves by hand."""

    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now

    def tick(self, seconds):
        self.now += seconds


class PhaseTest(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.timings = Timings(clock=self.clock)

    def phases(self):
        return self.timings.record()["phases"]

    def test_stages_follow_one_another_and_add_up_to_the_job(self):
        self.timings.start("discover")
        self.clock.tick(2)
        self.timings.start("download", workers=2)
        self.clock.tick(30)
        self.timings.start("decode")
        self.clock.tick(5)
        self.timings.stop()
        self.clock.tick(1)  # Outside any stage: in the total, in no phase.
        record = self.timings.record()
        self.assertEqual(record["seconds"], 38.0)
        self.assertEqual(record["phases"], {"discover": {"seconds": 2.0},
                                            "download": {"seconds": 30.0, "workers": 2},
                                            "decode": {"seconds": 5.0}})

    def test_an_inner_phase_pauses_the_outer_one(self):
        self.timings.start("decode")
        self.clock.tick(4)
        with self.timings.phase("write"):
            self.clock.tick(3)
            with self.timings.phase("decode"):
                self.clock.tick(1)
            self.clock.tick(2)
        self.clock.tick(6)
        self.timings.stop()
        phases = self.phases()
        self.assertEqual((phases["decode"]["seconds"], phases["write"]["seconds"]), (11.0, 5.0))

    def test_a_running_phase_is_counted_so_far(self):
        self.timings.start("download")
        self.clock.tick(7)
        self.assertEqual(self.phases()["download"]["seconds"], 7.0)

    def test_requests_count_towards_the_open_phase_from_any_thread(self):
        self.timings.start("discover")
        self.timings.request(1_000)
        self.timings.start("download", workers=2)
        workers = [threading.Thread(target=self.timings.request, args=(500,)) for _ in range(4)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join()
        self.timings.retry()
        self.timings.failure()
        self.timings.received(250)
        phases = self.phases()
        self.assertEqual(phases["discover"], {"seconds": 0.0, "requests": 1, "bytes": 1_000})
        self.assertEqual(phases["download"], {"seconds": 0.0, "workers": 2, "requests": 4,
                                              "bytes": 2_250, "retries": 1, "failures": 1})

    def test_a_request_outside_any_phase_is_other(self):
        self.timings.request(10)
        self.assertEqual(self.phases()["other"]["requests"], 1)

    def test_a_phase_on_a_worker_thread_is_summed_and_says_where_it_ran(self):
        self.timings.start("download", workers=2)

        def decode():
            with self.timings.phase("decode"):
                self.clock.tick(3)

        for _ in range(2):
            thread = threading.Thread(target=decode)
            thread.start()
            thread.join()
        self.timings.stop()
        phases = self.phases()
        # The main thread's download ran throughout: worker time never pauses it.
        self.assertEqual(phases["download"]["seconds"], 6.0)
        self.assertEqual(phases["decode"], {"seconds": 0.0, "threadSeconds": 6.0,
                                            "within": "download"})

    def test_a_decorated_function_is_its_phase(self):
        @self.timings.timed("decode")
        def work(value):
            self.clock.tick(2)
            return value * 2

        self.assertEqual(work(21), 42)
        self.assertEqual(work.__name__, "work")
        self.assertEqual(self.phases()["decode"]["seconds"], 2.0)

    def test_phases_are_reported_in_pipeline_order_whatever_order_they_ran(self):
        for name in ("write", "score", "decode", "discover", "index"):
            with self.timings.phase(name):
                self.clock.tick(1)
        self.assertEqual(list(self.phases()),
                         ["discover", "index", "decode", "write", "score"])

    def test_a_phase_raising_still_closes(self):
        with self.assertRaises(ValueError), self.timings.phase("decode"):
            self.clock.tick(2)
            raise ValueError("bad GRIB")
        self.clock.tick(5)
        self.assertEqual(self.phases()["decode"]["seconds"], 2.0)
        self.assertEqual(self.timings.stack, [])

    def test_the_record_is_written_where_the_worker_said_and_finish_prints_a_line(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "jobs", "gefs.adapter.json")
            timings = Timings(path, clock=self.clock)
            timings.start("download", workers=2)
            timings.request(18_700_000)
            self.clock.tick(1_890)
            out = StringIO()
            with contextlib.redirect_stdout(out):
                timings.finish()
            saved = json.loads(path.read_text())
        self.assertEqual(saved["phases"]["download"]["requests"], 1)
        self.assertEqual(saved["seconds"], 1_890.0)
        self.assertEqual(out.getvalue(), "Timing: download 1,890 s (1 req, 18.7 MB, "
                                         "2 at a time) · total 1,890 s\n")

    def test_a_heartbeat_keeps_the_record_current_during_a_long_download(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "record.json")
            timings = Timings(path, clock=self.clock)
            timings.start("download")
            timings.request(1)  # The first request writes at once.
            self.clock.tick(timing.HEARTBEAT + 1)
            timings.request(1)
            self.assertEqual(json.loads(path.read_text())["phases"]["download"]["requests"], 2)

    def test_an_unwritable_record_never_fails_the_job(self):
        with tempfile.TemporaryDirectory() as directory:
            blocker = Path(directory, "file")
            blocker.write_text("")
            timings = Timings(blocker / "record.json", clock=self.clock)
            timings.start("discover")
            with contextlib.redirect_stdout(StringIO()):
                timings.finish()


class SummaryTest(unittest.TestCase):
    def test_the_summary_line_names_each_phase_with_its_transfers(self):
        record = {"seconds": 1_964.4, "phases": {
            "discover": {"seconds": 3.24, "requests": 2, "bytes": 1_400, "failures": 1},
            "download": {"seconds": 1_890.2, "workers": 2, "requests": 1_271,
                         "bytes": 18_700_000, "retries": 3},
            "decode": {"seconds": 41.0, "threadSeconds": 9.0, "within": "download"},
            "write": {"seconds": 3.0}, "validate": {"seconds": 0.0}}}
        self.assertEqual(summary(record),
                         "discover 3.2 s (2 req, 1.4 kB, 1 failed) · "
                         "download 1,890 s (1,271 req, 18.7 MB, 2 at a time, 3 retried) · "
                         "decode 41 s (+9.0 s across download workers) · write 3.0 s · "
                         "total 1,964 s")

    def test_a_requests_session_counts_its_responses(self):
        session = timing.count_responses(requests.Session())
        response = requests.Response()
        response.status_code, response._content = 503, b"busy"
        with patch.object(timing, "TIMINGS", Timings(clock=Clock())):
            for hook in session.hooks["response"]:
                hook(response)
            counted = timing.TIMINGS.record()["phases"]["other"]
        self.assertEqual(counted, {"seconds": 0.0, "retries": 1, "requests": 1, "bytes": 4})


class WorkerEventTest(unittest.TestCase):
    """The worker carries the adapter's phases into its event, adds its own, keeps it."""

    def setUp(self):
        import worker
        self.worker = worker
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.args = SimpleNamespace(models=["gfs"], step=3, run=None, ecmwf_source="ecmwf",
                                    ecmwf_cycle=None, noaa_source="nomads",
                                    bucket=None, prefix="", publish_only=False,
                                    max_age_hours=None, timeout_seconds=60)
        self.adapter = {"seconds": 40.0, "phases": {"discover": {"seconds": 1.0},
                                                    "download": {"seconds": 35.0, "workers": 2,
                                                                 "requests": 81, "bytes": 1_200_000},
                                                    "decode": {"seconds": 3.0},
                                                    "write": {"seconds": 1.0}}}

    def run_models(self, code, s3=None, write=True):
        self.seen = {}

        def fake_run(command, **kwargs):
            self.seen = dict(kwargs.get("env") or {})
            if write:
                record = Path(self.seen[timing.TIMINGS_ENV])
                record.parent.mkdir(parents=True, exist_ok=True)
                record.write_text(json.dumps(self.adapter))
            return subprocess.CompletedProcess(command, code)

        out, err = StringIO(), StringIO()
        bundle = ({"run": "2026091306", "frames": [{}, {}]}, None, ["a", "b"])
        with patch.object(self.worker.subprocess, "run", fake_run), \
                patch.object(self.worker, "validate_bundle", return_value=bundle), \
                patch.object(self.worker, "drop_superseded", return_value=0), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            result = self.worker.run_models(self.args, self.root, s3)
        lines = (out.getvalue() + err.getvalue()).splitlines()
        return result, json.loads(lines[-1])

    def test_a_completed_job_reports_every_phase_including_its_own(self):
        result, event = self.run_models(0)
        self.assertEqual((result, event["event"]), (0, "forecast_complete"))
        self.assertEqual(list(event["phases"]),
                         ["discover", "download", "decode", "write", "validate", "publish"])
        self.assertEqual(event["phases"]["download"],
                         {"seconds": 35.0, "workers": 2, "requests": 81, "bytes": 1_200_000})
        self.assertIn("seconds", event["phases"]["publish"])
        # The adapter's record is the worker's to read once: it never outlives the job.
        self.assertFalse(Path(self.seen[timing.TIMINGS_ENV]).exists())

    def test_a_failed_job_still_says_how_far_it_got(self):
        self.adapter["phases"] = {"discover": {"seconds": 1.0},
                                  "download": {"seconds": 2_400.0, "requests": 40}}
        result, event = self.run_models(1)
        self.assertEqual((result, event["event"]), (1, "forecast_failed"))
        self.assertEqual(event["phases"]["download"]["requests"], 40)
        self.assertNotIn("publish", event["phases"])

    def test_an_unchanged_run_reports_its_discovery(self):
        s3 = FakeS3()
        s3.seed("weather/gfs.json", json.dumps({"model": "gfs", "run": "2026091300",
                                                "frames": []}).encode())
        self.args.bucket = "test"
        self.adapter["phases"] = {"discover": {"seconds": 2.0, "requests": 3}}
        result, event = self.run_models(UNCHANGED_EXIT, s3=s3)
        self.assertEqual((result, event["event"]), (0, "forecast_unchanged"))
        self.assertEqual(event["phases"], {"discover": {"seconds": 2.0, "requests": 3}})

    def test_an_adapter_that_records_nothing_still_gets_the_workers_phases(self):
        _, event = self.run_models(0, write=False)
        self.assertEqual(list(event["phases"]), ["validate", "publish"])

    def test_status_reports_the_last_job_without_changing_the_verdict(self):
        self.run_models(0)
        job = status.last_job(self.root, "gfs")
        self.assertEqual((job["outcome"], job["run"]), ("complete", "2026091306"))
        self.assertEqual(job["phases"]["download"]["requests"], 81)
        self.assertIsNone(status.last_job(self.root, "ecmwf"))
        self.assertTrue(status.job_note(job).startswith("complete in "))
        out = StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(StringIO()):
            code = status.main(["--models", "gfs", "--json", "--root", str(self.root)])
        row = json.loads(out.getvalue())
        self.assertEqual((code, row["state"]), (1, "absent"))
        self.assertEqual(row["lastJob"]["outcome"], "complete")

    def test_a_note_names_the_phase_that_took_longest(self):
        job = {"outcome": "complete", "seconds": 40,
               "phases": self.adapter["phases"]}
        self.assertEqual(status.job_note(job), "complete in 40 s, 88% download")
        self.assertEqual(status.job_note(None), "-")


if __name__ == "__main__":
    unittest.main()
