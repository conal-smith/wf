"""Freshness reporting: a missing, broken or overdue model must not read as healthy."""
import contextlib
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest

import status

NOW = datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)


def manifest(run="2026091606", hours=(0, 3), directory="gfs-2026091606-240h-v1"):
    start = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    return {"model": "gfs", "run": run,
            "runTime": start.isoformat().replace("+00:00", "Z"),
            "frames": [{"hour": hour, "url": f"weather/{directory}/{hour:03d}-abc.json",
                        "validTime": (start + timedelta(hours=hour)).isoformat()
                        .replace("+00:00", "Z")} for hour in hours]}


class DescribeTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.public = Path(self.directory.name, "public")
        (self.public / "weather").mkdir(parents=True)

    def publish(self, payload, frames=True):
        (self.public / "weather" / "gfs.json").write_text(json.dumps(payload))
        for frame in payload.get("frames", []) if frames else []:
            path = self.public / frame["url"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("{}")

    def describe(self, **kwargs):
        return status.describe(self.public, "gfs", NOW, **kwargs)

    def test_a_current_run_with_every_frame_is_fresh(self):
        self.publish(manifest(hours=(0, 3, 6, 9)))
        row = self.describe()
        self.assertEqual((row["state"], row["ok"], row["missingFrames"]), ("fresh", True, 0))
        self.assertEqual(row["ageHours"], 6.0)
        self.assertEqual(row["frames"], 4)

    def test_a_missing_manifest_is_absent(self):
        row = self.describe()
        self.assertEqual((row["state"], row["ok"]), ("absent", False))

    def test_an_unreadable_manifest_is_reported_not_raised(self):
        (self.public / "weather" / "gfs.json").write_text("{oops")
        self.assertEqual(self.describe()["state"], "unreadable")

    def test_a_manifest_missing_its_frames_on_disk_is_incomplete(self):
        self.publish(manifest(hours=(0, 3, 6)), frames=False)
        row = self.describe()
        self.assertEqual((row["state"], row["missingFrames"], row["ok"]), ("incomplete", 3, False))

    def test_a_passed_horizon_is_expired(self):
        self.publish(manifest(run="2026091600", hours=(0, 3)))
        self.assertEqual(self.describe()["state"], "expired")

    def test_an_old_run_with_a_live_horizon_is_stale(self):
        self.publish(manifest(run="2026091522", hours=(0, 24)))
        row = self.describe()
        self.assertEqual(row["state"], "stale")
        self.assertGreater(row["ageHours"], row["maxAgeHours"])

    def test_the_ecmwf_window_is_wider_and_overridable(self):
        self.assertEqual(status.max_age_hours("ecmwf"), 24.0)
        self.assertEqual(status.max_age_hours("gfs"), 12.0)
        self.assertEqual(status.max_age_hours("ecmwf", 3.0), 3.0)

    def test_a_reshaped_frame_list_does_not_crash_the_report(self):
        self.publish({**manifest(), "frames": ["nonsense", {"validTime": "2026-09-17T00:00:00Z"}]},
                     frames=False)
        self.assertIn(self.describe()["state"], ("incomplete", "unreadable"))


class MainTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        Path(self.directory.name, "public", "weather").mkdir(parents=True)

    def run_main(self, argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = status.main([*argv, "--root", self.directory.name])
        return code, out.getvalue()

    def test_an_absent_model_fails_the_check(self):
        code, output = self.run_main(["--models", "gfs"])
        self.assertEqual(code, 1)
        self.assertIn("absent", output)

    def test_an_unknown_model_is_reported_without_crashing(self):
        code, output = self.run_main(["--models", "tides"])
        self.assertEqual(code, 1)
        self.assertNotIn("tides", output)

    def test_json_output_is_one_object_per_model(self):
        _, output = self.run_main(["--models", "gfs", "ecmwf", "--json"])
        rows = [json.loads(line) for line in output.splitlines()]
        self.assertEqual([row["model"] for row in rows], ["gfs", "ecmwf"])


if __name__ == "__main__":
    unittest.main()
