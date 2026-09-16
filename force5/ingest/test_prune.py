"""Retention must never remove a run a current manifest still points at."""
import contextlib
from datetime import datetime, timedelta, timezone
import io
import json
import os
from pathlib import Path
import tempfile
import unittest

import prune

NOW = datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)


def manifest(model, run, directory, hours=(0, 3)):
    return {"model": model, "run": run, "runTime": "2026-09-16T00:00:00Z", "stepHours": 3,
            "grid": {"width": 2, "height": 2},
            "frames": [{"hour": hour, "validTime": "2026-09-16T00:00:00Z",
                        "url": f"weather/{directory}/{hour:03d}-abc.json"} for hour in hours]}


class Tree:
    """A throwaway work directory shaped like the volume the worker writes."""

    def __init__(self, base):
        self.root = Path(base)
        self.weather = self.root / "public" / "weather"
        self.weather.mkdir(parents=True)

    def pointer(self, name, payload):
        (self.weather / name).write_text(json.dumps(payload))

    def run_directory(self, name, age_hours, hours=(0, 3)):
        directory = self.weather / name
        directory.mkdir()
        for hour in hours:
            (directory / f"{hour:03d}-abc.json").write_text('{"u":[0,0,0,0]}')
        self.age(directory, age_hours)
        return directory

    def age(self, path, hours):
        when = (NOW - timedelta(hours=hours)).timestamp()
        for child in sorted(path.rglob("*"), reverse=True):
            os.utime(child, (when, when))
        os.utime(path, (when, when))

    def cache_file(self, name, days):
        path = self.root / ".cache" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("grib")
        when = (NOW - timedelta(days=days)).timestamp()
        os.utime(path, (when, when))
        return path


class PruneRunsTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.tree = Tree(self.directory.name)
        self.tree.pointer("harmonie.json", manifest("harmonie", "2026091600", "harmonie-live"))
        self.tree.pointer("gfs.json", manifest("gfs", "2026091600", "gfs-live"))
        self.referenced_old = self.tree.run_directory("harmonie-live", age_hours=100)
        self.referenced_new = self.tree.run_directory("gfs-live", age_hours=1)
        self.orphan_old = self.tree.run_directory("harmonie-previous", age_hours=100)
        self.orphan_new = self.tree.run_directory("gfs-previous", age_hours=6)
        archive = self.tree.weather / "manifests" / "harmonie"
        archive.mkdir(parents=True)
        (archive / "2026091600-abc.json").write_text("{}")
        self.tree.age(self.tree.weather / "manifests", 500)

    def prune(self, **kwargs):
        return prune.prune_runs(self.tree.weather, 48, now=NOW, **kwargs)

    def test_removes_only_unreferenced_and_aged_runs(self):
        result = self.prune()
        self.assertEqual(result["removedRuns"], ["harmonie-previous"])
        self.assertFalse(self.orphan_old.exists())
        for kept in (self.referenced_old, self.referenced_new, self.orphan_new):
            self.assertTrue(kept.exists(), kept)
        self.assertGreater(result["freedBytes"], 0)

    def test_keeps_pointer_manifests_and_the_archive(self):
        self.prune()
        self.assertTrue((self.tree.weather / "harmonie.json").is_file())
        self.assertTrue((self.tree.weather / "gfs.json").is_file())
        self.assertTrue((self.tree.weather / "manifests" / "harmonie" /
                         "2026091600-abc.json").is_file())

    def test_reasons_explain_every_kept_run(self):
        kept = {entry["run"]: entry["reason"] for entry in self.prune(dry_run=True)["keptRuns"]}
        self.assertEqual(kept, {"harmonie-live": "referenced", "gfs-live": "referenced",
                                "gfs-previous": "within-window"})

    def test_dry_run_reports_without_deleting(self):
        result = self.prune(dry_run=True)
        self.assertEqual(result["removedRuns"], ["harmonie-previous"])
        self.assertTrue(self.orphan_old.exists())

    def test_zero_window_still_protects_referenced_runs(self):
        result = prune.prune_runs(self.tree.weather, 0, now=NOW)
        self.assertEqual(sorted(result["removedRuns"]), ["gfs-previous", "harmonie-previous"])
        self.assertTrue(self.referenced_old.exists())

    def test_unreadable_manifest_aborts_before_deleting(self):
        (self.tree.weather / "harmonie.json").write_text("{not json")
        with self.assertRaises(ValueError):
            self.prune()
        self.assertTrue(self.orphan_old.exists())

    def test_unsafe_frame_path_aborts(self):
        self.tree.pointer("ecmwf.json", {"frames": [{"url": "weather/../../etc/passwd"}]})
        with self.assertRaises(ValueError):
            self.prune()
        self.assertTrue(self.orphan_old.exists())

    def test_manifest_without_frames_aborts(self):
        self.tree.pointer("ecmwf.json", {"model": "ecmwf", "frames": []})
        with self.assertRaises(ValueError):
            self.prune()
        self.assertTrue(self.orphan_old.exists())


class PruneCacheTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.tree = Tree(self.directory.name)
        self.old = self.tree.cache_file("grib/old.grib2", days=9)
        self.fresh = self.tree.cache_file("grib/fresh.grib2", days=0.5)
        self.lock = self.tree.cache_file("worker.lock", days=30)

    def test_removes_aged_raw_files_only(self):
        result = prune.prune_cache(self.tree.root / ".cache", 3, now=NOW)
        self.assertEqual(result["removedCacheFiles"], 1)
        self.assertFalse(self.old.exists())
        self.assertTrue(self.fresh.exists())
        self.assertTrue(self.lock.exists())

    def test_removes_emptied_directories(self):
        self.fresh.unlink()
        prune.prune_cache(self.tree.root / ".cache", 3, now=NOW)
        self.assertFalse((self.tree.root / ".cache" / "grib").exists())
        self.assertTrue(self.lock.exists())

    def test_dry_run_and_missing_cache_are_safe(self):
        self.assertEqual(prune.prune_cache(self.tree.root / "absent", 3, now=NOW),
                         {"removedCacheFiles": 0, "freedCacheBytes": 0})
        prune.prune_cache(self.tree.root / ".cache", 3, now=NOW, dry_run=True)
        self.assertTrue(self.old.exists())


def run_main(argv):
    """Call the command line, returning its exit code and captured JSON event."""
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = prune.main(argv)
    return code, json.loads((out.getvalue() or err.getvalue()).splitlines()[-1])


class MainTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.tree = Tree(self.directory.name)
        self.tree.pointer("harmonie.json", manifest("harmonie", "2026091600", "harmonie-live"))
        self.tree.run_directory("harmonie-live", age_hours=1)
        self.tree.run_directory("harmonie-previous", age_hours=200)

    def test_main_prunes_and_reports(self):
        code, event = run_main(["--root", self.directory.name])
        self.assertEqual(code, 0)
        self.assertEqual(event["event"], "prune_complete")
        self.assertEqual(event["removedRuns"], ["harmonie-previous"])
        self.assertEqual(event["maxAgeHours"], prune.DEFAULT_MAX_AGE_HOURS)
        self.assertFalse((self.tree.weather / "harmonie-previous").exists())

    def test_main_honours_an_explicit_window(self):
        code, event = run_main(["--root", self.directory.name, "--max-age-hours", "1000",
                                "--dry-run"])
        self.assertEqual((code, event["removedRuns"]), (0, []))
        self.assertTrue((self.tree.weather / "harmonie-previous").exists())

    def test_main_fails_without_a_weather_directory(self):
        with tempfile.TemporaryDirectory() as empty:
            code, event = run_main(["--root", empty])
            self.assertEqual((code, event["event"]), (1, "prune_failed"))

    def test_main_fails_on_a_broken_manifest_without_deleting(self):
        (self.tree.weather / "harmonie.json").write_text("nope")
        code, event = run_main(["--root", self.directory.name])
        self.assertEqual((code, event["event"]), (1, "prune_failed"))
        self.assertTrue((self.tree.weather / "harmonie-previous").exists())


if __name__ == "__main__":
    unittest.main()
