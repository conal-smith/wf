"""Freshness reporting: a missing, broken or overdue model must not read as healthy."""
import contextlib
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest

from registry import MANIFESTS, MODELS
import status

NOW = datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)


def stamp(value):
    return value.isoformat().replace("+00:00", "Z")


SPOTS = {"squareDegrees": 2, "url": "spots/{square}.json", "squares": ["n52w012"],
         "keys": ["spotForecasts"]}


def wind_manifest(run="2026091606", hours=(0, 3), directory="gfs-2026091606-240h-v1-0a0b0c0d"):
    start = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    return {"schemaVersion": 2, "model": "gfs", "kind": "wind", "run": run,
            "runTime": stamp(start), "base": f"{directory}/",
            "frames": [{"hour": hour, "url": f"frames/{hour:03d}.bin",
                        "validTime": stamp(start + timedelta(hours=hour))} for hour in hours],
            "spots": SPOTS}


def tide_manifest(run="2026091606", days=7):
    start = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    return {"model": "tides", "kind": "tide", "run": run, "runTime": stamp(start),
            "coverage": {"from": stamp(start), "to": stamp(start + timedelta(days=days))},
            "spots": {}, "stations": {"DUBLIN": {"name": "Dublin",
                                                 "url": "marine/tides-DUBLIN-abc.json"}}}


class Fixture(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.public = Path(self.directory.name, "public")
        (self.public / "weather").mkdir(parents=True)
        (self.public / "marine").mkdir(parents=True)

    def publish(self, model, payload, objects=True, contents=None):
        (self.public / MANIFESTS[model]).write_text(json.dumps(payload))
        for url in status.published_objects(payload, MANIFESTS[model]) if objects else []:
            path = self.public / url
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps((contents or {}).get(path.name, {})))

    def describe(self, model="gfs", **kwargs):
        return status.describe(self.public, model, NOW, **kwargs)


class DescribeTest(Fixture):
    def test_a_current_run_with_every_object_is_fresh(self):
        self.publish("gfs", wind_manifest(hours=(0, 3, 6, 9)))
        row = self.describe()
        self.assertEqual((row["state"], row["ok"], row["missing"]), ("fresh", True, 0))
        # Four frames and one spot square.
        self.assertEqual((row["ageHours"], row["frames"], row["objects"]), (6.0, 4, 5))

    def test_a_tide_manifest_reports_its_coverage(self):
        self.publish("tides", tide_manifest())
        row = self.describe("tides")
        self.assertEqual((row["kind"], row["state"], row["frames"]), ("tide", "fresh", 0))
        self.assertEqual(row["coverageEnds"], "2026-09-23T06:00:00Z")
        self.assertEqual(row["maxAgeHours"], float(MODELS["tides"]["maxAgeHours"]))

    def test_an_ensemble_without_frames_states_its_horizon(self):
        run = datetime(2026, 9, 16, 6, tzinfo=timezone.utc)
        self.publish("ecmwf-ens", {
            "schemaVersion": 2, "model": "ecmwf-ens", "kind": "wind", "run": "2026091606",
            "runTime": stamp(run), "base": "ecmwf-ens-2026091606-48h-v1-0a0b0c0d/",
            "frames": [], "horizonHours": 48, "spots": SPOTS})
        row = self.describe("ecmwf-ens")
        self.assertEqual((row["state"], row["frames"], row["objects"]), ("fresh", 0, 1))
        self.assertEqual(row["coverageEnds"], "2026-09-18T06:00:00Z")

    def test_an_ensemble_without_a_stated_horizon_is_timed_by_its_squares(self):
        run = datetime(2026, 9, 16, 6, tzinfo=timezone.utc)
        square = {"schemaVersion": 2, "model": "ecmwf-ens", "run": "2026091606",
                  "square": "n52w012", "spotMembers": {
                      "brandon": [{"hour": 0, "validTime": stamp(run)},
                                  {"hour": 48, "validTime": stamp(run + timedelta(hours=48))}]}}
        self.publish("ecmwf-ens", {
            "schemaVersion": 2, "model": "ecmwf-ens", "kind": "wind", "run": "2026091606",
            "runTime": stamp(run), "base": "ecmwf-ens-2026091606-48h-v1-0a0b0c0d/",
            "frames": [], "spots": {**SPOTS, "keys": ["spotMembers"]}},
            contents={"n52w012.json": square})
        row = self.describe("ecmwf-ens")
        self.assertEqual((row["state"], row["frames"]), ("fresh", 0))
        self.assertEqual(row["coverageEnds"], "2026-09-18T06:00:00Z")

    def test_a_missing_manifest_is_absent(self):
        self.assertEqual((self.describe()["state"], self.describe()["ok"]), ("absent", False))

    def test_an_unreadable_manifest_is_reported_not_raised(self):
        (self.public / MANIFESTS["gfs"]).write_text("{oops")
        self.assertEqual(self.describe()["state"], "unreadable")

    def test_a_manifest_with_no_coverage_at_all_is_unreadable(self):
        self.publish("gfs", {"model": "gfs", "run": "2026091606", "frames": []})
        self.assertEqual(self.describe()["state"], "unreadable")

    def test_missing_objects_on_disk_make_it_incomplete(self):
        self.publish("gfs", wind_manifest(hours=(0, 3, 6)), objects=False)
        row = self.describe()
        self.assertEqual((row["state"], row["missing"], row["ok"]), ("incomplete", 4, False))  # 3 frames and a square

    def test_a_passed_horizon_is_expired(self):
        self.publish("gfs", wind_manifest(run="2026091600", hours=(0, 3)))
        self.assertEqual(self.describe()["state"], "expired")

    def test_an_old_run_with_live_coverage_is_stale(self):
        self.publish("gfs", wind_manifest(run="2026091522", hours=(0, 24)))
        row = self.describe()
        self.assertEqual(row["state"], "stale")
        self.assertGreater(row["ageHours"], row["maxAgeHours"])

    def test_an_explicit_limit_overrides_the_registry(self):
        self.publish("gfs", wind_manifest(hours=(0, 24)))
        self.assertEqual(self.describe(override=3.0)["state"], "stale")
        self.assertEqual(self.describe(override=24.0)["state"], "fresh")

    def test_a_reshaped_frame_list_does_not_crash_the_report(self):
        self.publish("gfs", {**wind_manifest(), "frames": ["nonsense"]}, objects=False)
        self.assertEqual(self.describe()["state"], "unreadable")


class MainTest(Fixture):
    def run_main(self, argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = status.main([*argv, "--root", self.directory.name])
        return code, out.getvalue()

    def test_an_absent_model_fails_the_check(self):
        code, output = self.run_main(["--models", "gfs"])
        self.assertEqual(code, 1)
        self.assertIn("absent", output)

    def test_a_fresh_model_passes(self):
        # main() reads the real clock, so anchor this bundle to it rather than NOW.
        current = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        self.publish("gfs", wind_manifest(run=current.strftime("%Y%m%d%H"), hours=(0, 24)))
        code, output = self.run_main(["--models", "gfs"])
        self.assertEqual(code, 0)
        self.assertIn("fresh", output)

    def test_an_unknown_model_is_reported_without_crashing(self):
        code, output = self.run_main(["--models", "nws-wave"])
        self.assertEqual(code, 1)
        self.assertNotIn("nws-wave", output)

    def test_json_output_is_one_object_per_model(self):
        _, output = self.run_main(["--models", "gfs", "tides", "--json"])
        rows = [json.loads(line) for line in output.splitlines()]
        self.assertEqual([row["model"] for row in rows], ["gfs", "tides"])

    def test_the_default_check_covers_every_registered_model(self):
        _, output = self.run_main(["--json"])
        rows = [json.loads(line) for line in output.splitlines()]
        self.assertEqual([row["model"] for row in rows], list(MANIFESTS))


if __name__ == "__main__":
    unittest.main()
