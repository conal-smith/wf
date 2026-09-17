"""Retention must never remove an object a current manifest still points at."""
import contextlib
from datetime import datetime, timedelta, timezone
import io
import json
import os
from pathlib import Path
import tempfile
import unittest

import prune
from workspace import workspace_lock

NOW = datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)


def wind_manifest(model, run, directory, hours=(0, 3)):
    return {"model": model, "kind": "wind", "run": run, "runTime": "2026-09-16T00:00:00Z",
            "stepHours": 3, "grid": {"width": 2, "height": 2},
            "frames": [{"hour": hour, "validTime": "2026-09-16T00:00:00Z",
                        "url": f"weather/{directory}/{hour:03d}-abc.json"} for hour in hours]}


def tide_manifest(run, *stations):
    return {"model": "tides", "kind": "tide", "run": run, "runTime": "2026-09-16T00:00:00Z",
            "coverage": {"from": "2026-09-14T00:00:00Z", "to": "2026-09-23T00:00:00Z"},
            "spots": {}, "stations": {name.split("-")[1]: {"name": name, "url": f"marine/{name}"}
                                      for name in stations}}


class Tree:
    """A throwaway work directory shaped like the volume the worker writes."""

    def __init__(self, base):
        self.public = Path(base, "public")
        self.root = Path(base)
        (self.public / "weather").mkdir(parents=True)
        (self.public / "marine").mkdir(parents=True)

    def pointer(self, published, payload):
        (self.public / published).write_text(json.dumps(payload))

    def run_directory(self, name, age_hours, hours=(0, 3)):
        directory = self.public / "weather" / name
        directory.mkdir()
        for hour in hours:
            (directory / f"{hour:03d}-abc.json").write_text('{"u":[0,0,0,0]}')
        self.age(directory, age_hours)
        return directory

    def station(self, name, age_hours):
        path = self.public / "marine" / name
        path.write_text('{"station":"x","curve":[1,2]}')
        self.age(path, age_hours)
        return path

    def age(self, path, hours):
        when = (NOW - timedelta(hours=hours)).timestamp()
        for child in sorted(path.rglob("*") if path.is_dir() else [], reverse=True):
            os.utime(child, (when, when))
        os.utime(path, (when, when))

    def cache_file(self, name, days):
        path = self.root / ".cache" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("grib")
        when = (NOW - timedelta(days=days)).timestamp()
        os.utime(path, (when, when))
        return path


class ManifestUrlsTest(unittest.TestCase):
    def test_collects_urls_from_any_bundle_shape(self):
        manifest = {"frames": [{"url": "weather/a/000.json"}],
                    "stations": {"DUBLIN": {"url": "marine/tides-DUBLIN-x.json"}},
                    "sourceUrl": "https://example.invalid/not-an-object"}
        self.assertEqual(prune.manifest_urls(manifest),
                         {"weather/a/000.json", "marine/tides-DUBLIN-x.json"})

    def test_ignores_non_string_urls(self):
        self.assertEqual(prune.manifest_urls({"frames": [{"url": 7}, {}]}), set())


class PrunePublishedTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.tree = Tree(self.directory.name)
        self.tree.pointer("weather/harmonie.json",
                          wind_manifest("harmonie", "2026091600", "harmonie-live"))
        self.tree.pointer("weather/gfs.json", wind_manifest("gfs", "2026091600", "gfs-live"))
        self.tree.pointer("marine/tides.json",
                          tide_manifest("2026091600", "tides-DUBLIN-live.json"))
        self.referenced_old = self.tree.run_directory("harmonie-live", age_hours=100)
        self.referenced_new = self.tree.run_directory("gfs-live", age_hours=1)
        self.orphan_old = self.tree.run_directory("harmonie-previous", age_hours=100)
        self.orphan_new = self.tree.run_directory("gfs-previous", age_hours=6)
        self.station_live = self.tree.station("tides-DUBLIN-live.json", age_hours=100)
        self.station_old = self.tree.station("tides-DUBLIN-previous.json", age_hours=100)
        self.station_new = self.tree.station("tides-GALWAY-previous.json", age_hours=6)
        archive = self.public("weather") / prune.ARCHIVE_DIRECTORY / "harmonie"
        archive.mkdir(parents=True)
        (archive / "2026091600-abc.json").write_text("{}")
        self.tree.age(self.public("weather") / prune.ARCHIVE_DIRECTORY, 500)

    def public(self, name):
        return self.tree.public / name

    def prune(self, **kwargs):
        return prune.prune_published(self.tree.public, 48, now=NOW, **kwargs)

    def test_removes_only_unreferenced_and_aged_objects(self):
        result = self.prune()
        self.assertEqual(result["removed"],
                         ["marine/tides-DUBLIN-previous.json", "weather/harmonie-previous"])
        self.assertFalse(self.orphan_old.exists())
        self.assertFalse(self.station_old.exists())
        for kept in (self.referenced_old, self.referenced_new, self.orphan_new,
                     self.station_live, self.station_new):
            self.assertTrue(kept.exists(), kept)
        self.assertGreater(result["freedBytes"], 0)

    def test_keeps_pointer_manifests_and_the_archive(self):
        self.prune()
        for pointer in ("weather/harmonie.json", "weather/gfs.json", "marine/tides.json"):
            self.assertTrue((self.tree.public / pointer).is_file(), pointer)
        self.assertTrue((self.public("weather") / prune.ARCHIVE_DIRECTORY / "harmonie" /
                         "2026091600-abc.json").is_file())

    def test_keeps_a_manifest_for_a_model_the_registry_lacks(self):
        self.tree.pointer("weather/nws-wave.json",
                          wind_manifest("nws-wave", "2026091600", "nws-wave-live"))
        self.tree.age(self.public("weather") / "nws-wave.json", 400)
        result = self.prune()
        self.assertNotIn("weather/nws-wave.json", result["removed"])
        self.assertIn({"path": "weather/nws-wave.json", "reason": "manifest"},
                      result["kept"])

    def test_reasons_explain_every_kept_object(self):
        kept = {entry["path"]: entry["reason"] for entry in self.prune(dry_run=True)["kept"]}
        self.assertEqual(kept, {"weather/harmonie-live": "referenced",
                                "weather/gfs-live": "referenced",
                                "weather/gfs-previous": "within-window",
                                "marine/tides-DUBLIN-live.json": "referenced",
                                "marine/tides-GALWAY-previous.json": "within-window"})

    def test_dry_run_reports_without_deleting(self):
        result = self.prune(dry_run=True)
        self.assertIn("weather/harmonie-previous", result["removed"])
        self.assertTrue(self.orphan_old.exists())
        self.assertTrue(self.station_old.exists())

    def test_zero_window_still_protects_referenced_objects(self):
        result = prune.prune_published(self.tree.public, 0, now=NOW)
        self.assertIn("weather/gfs-previous", result["removed"])
        self.assertTrue(self.referenced_old.exists())
        self.assertTrue(self.station_live.exists())

    def test_unreadable_manifest_aborts_before_deleting(self):
        (self.public("weather") / "harmonie.json").write_text("{not json")
        with self.assertRaises(ValueError):
            self.prune()
        self.assertTrue(self.orphan_old.exists())

    def test_unsafe_object_path_aborts(self):
        self.tree.pointer("weather/gfs.json", {"frames": [{"url": "weather/../../etc/passwd"}]})
        with self.assertRaises(ValueError):
            self.prune()
        self.assertTrue(self.orphan_old.exists())

    def test_manifest_without_objects_aborts(self):
        self.tree.pointer("weather/gfs.json", {"model": "gfs", "frames": []})
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
        self.tree.pointer("weather/harmonie.json",
                          wind_manifest("harmonie", "2026091600", "harmonie-live"))
        self.tree.run_directory("harmonie-live", age_hours=1)
        self.tree.run_directory("harmonie-previous", age_hours=200)

    def test_main_prunes_and_reports(self):
        code, event = run_main(["--root", self.directory.name])
        self.assertEqual(code, 0)
        self.assertEqual(event["event"], "prune_complete")
        self.assertEqual(event["removed"], ["weather/harmonie-previous"])
        self.assertEqual(event["maxAgeHours"], prune.DEFAULT_MAX_AGE_HOURS)
        self.assertFalse((self.tree.public / "weather" / "harmonie-previous").exists())

    def test_main_honours_an_explicit_window(self):
        code, event = run_main(["--root", self.directory.name, "--max-age-hours", "1000",
                                "--dry-run"])
        self.assertEqual((code, event["removed"]), (0, []))
        self.assertTrue((self.tree.public / "weather" / "harmonie-previous").exists())

    def test_main_fails_without_published_output(self):
        with tempfile.TemporaryDirectory() as empty:
            code, event = run_main(["--root", empty])
            self.assertEqual((code, event["event"]), (1, "prune_failed"))

    def test_main_fails_on_a_broken_manifest_without_deleting(self):
        (self.tree.public / "weather" / "harmonie.json").write_text("nope")
        code, event = run_main(["--root", self.directory.name])
        self.assertEqual((code, event["event"]), (1, "prune_failed"))
        self.assertTrue((self.tree.public / "weather" / "harmonie-previous").exists())

    def test_main_keeps_nothing_superseded_by_default(self):
        self.tree.run_directory("harmonie-an-hour-ago", age_hours=1)
        code, event = run_main(["--root", self.directory.name])
        self.assertEqual(code, 0)
        self.assertEqual(event["removed"], ["weather/harmonie-an-hour-ago",
                                            "weather/harmonie-previous"])

    def test_main_skips_the_sweep_while_an_import_holds_the_lock(self):
        # A run that is still being written is unreferenced too; only the lock protects it.
        self.tree.run_directory("harmonie-arriving", age_hours=0)
        with workspace_lock(Path(self.directory.name)):
            code, event = run_main(["--root", self.directory.name])
        self.assertEqual((code, event["event"]), (0, "prune_skipped"))
        self.assertTrue((self.tree.public / "weather" / "harmonie-arriving").exists())
        self.assertTrue((self.tree.public / "weather" / "harmonie-previous").exists())


class WorkerTest(unittest.TestCase):
    def test_a_published_run_deletes_the_one_it_replaced(self):
        import worker
        with tempfile.TemporaryDirectory() as directory:
            tree = Tree(directory)
            tree.pointer("weather/harmonie.json",
                         wind_manifest("harmonie", "2026091600", "harmonie-live"))
            tree.run_directory("harmonie-live", age_hours=0)
            tree.run_directory("harmonie-previous", age_hours=0)
            self.assertEqual(worker.drop_superseded(tree.public), 1)
            self.assertTrue((tree.public / "weather" / "harmonie-live").exists())
            self.assertFalse((tree.public / "weather" / "harmonie-previous").exists())

    def test_raw_downloads_go_after_the_job_but_small_state_stays(self):
        import worker
        with tempfile.TemporaryDirectory() as directory:
            tree = Tree(directory)
            raw = tree.cache_file("ecmwf-ens/2026091600/000.grib2", days=0)
            state = tree.cache_file("mi-swan/info/shelf.json", days=0)
            lock = tree.cache_file("worker.lock", days=0)
            worker.drop_downloads(tree.root, "ecmwf-ens")
            worker.drop_downloads(tree.root, "mi-swan")
            self.assertFalse(raw.exists())
            self.assertTrue(state.exists())
            self.assertTrue(lock.exists())

    def test_a_failed_sweep_never_fails_the_forecast(self):
        import worker
        with tempfile.TemporaryDirectory() as directory:
            tree = Tree(directory)
            tree.run_directory("harmonie-previous", age_hours=0)
            (tree.public / "weather" / "harmonie.json").write_text("nope")
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(worker.drop_superseded(tree.public), 0)
            self.assertTrue((tree.public / "weather" / "harmonie-previous").exists())


if __name__ == "__main__":
    unittest.main()
