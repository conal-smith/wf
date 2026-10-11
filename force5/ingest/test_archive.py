"""The archive store, and the guards that keep every deleter out of archive/.

The archive is the only record of what was forecast and observed, and two sweeps
delete from the store, one of them through `delete_keys`, while a pointer's
`superseded` list decides what they may keep. Each is tested here against an
archive that looks as deletable as anything can: old, unreferenced and named
like the objects they normally delete.
"""
from datetime import datetime, timedelta, timezone
import gzip
import importlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import archive
from archive import BucketArchive, LocalArchive, archive_key, forecast_key, observation_key
import prune
from prune import bucket_prune, delete_keys, is_archived, prune_published
from squares import retire
import registry
from test_publish_s3 import FakeS3

NOW = datetime(2026, 9, 13, 12, tzinfo=timezone.utc)
OLD = NOW - timedelta(days=400)


class KeyTests(unittest.TestCase):
    def test_only_relative_keys_under_archive_are_accepted(self):
        self.assertEqual(archive_key("archive/forecasts/gfs/2026091300.json"),
                         "archive/forecasts/gfs/2026091300.json")
        for bad in ("weather/gfs.json", "/archive/x.json", "archive/../weather/gfs.json",
                    "archive", "archived/x.json"):
            with self.subTest(key=bad), self.assertRaises(ValueError):
                archive_key(bad)

    def test_named_keys(self):
        self.assertEqual(forecast_key("ecmwf-ens", "2026091300"),
                         "archive/forecasts/ecmwf-ens/2026091300.json")
        self.assertEqual(observation_key("2026-09-13"), "archive/observations/2026-09-13.json")

    def test_is_archived_sees_the_segment_through_a_bucket_prefix(self):
        self.assertTrue(is_archived("archive/observations/2026-09-13.json"))
        self.assertTrue(is_archived("site/archive/observations/2026-09-13.json"))
        self.assertFalse(is_archived("weather/harmonie-archive-run/0.bin"))
        self.assertFalse(is_archived("weather/manifests/harmonie/x.json"))


class LocalArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.public = Path(self.temp.name) / "public"
        self.store = LocalArchive(self.public)

    def test_create_writes_once(self):
        key = forecast_key("gfs", "2026091300")
        self.assertTrue(self.store.create(key, {"a": 1}))
        self.assertFalse(self.store.create(key, {"a": 2}))
        self.assertEqual(self.store.read(key), {"a": 1})
        self.assertTrue((self.public / key).is_file())

    def test_merge_skips_the_write_when_nothing_changed(self):
        key = observation_key("2026-09-13")
        self.store.merge(key, lambda current: {"n": 1})
        before = (self.public / key).stat().st_mtime_ns
        os.utime(self.public / key, ns=(before - 10**9, before - 10**9))
        self.assertEqual(self.store.merge(key, lambda current: None), {"n": 1})
        self.assertEqual((self.public / key).stat().st_mtime_ns, before - 10**9)

    def test_keys_lists_below_a_prefix(self):
        for run in ("2026091300", "2026091306"):
            self.store.create(forecast_key("gfs", run), {})
        self.store.create(forecast_key("ecmwf", "2026091300"), {})
        self.assertEqual(self.store.keys("archive/forecasts/gfs"),
                         ["archive/forecasts/gfs/2026091300.json",
                          "archive/forecasts/gfs/2026091306.json"])
        self.assertEqual(len(self.store.keys("archive/forecasts")), 3)
        self.assertEqual(self.store.keys("archive/observations"), [])


class BucketArchiveTests(unittest.TestCase):
    def setUp(self):
        self.s3 = FakeS3()
        self.store = BucketArchive(self.s3, "bucket", "site")

    def test_objects_are_gzip_json_under_the_prefix(self):
        key = forecast_key("gfs", "2026091300")
        self.assertTrue(self.store.create(key, {"model": "gfs"}))
        stored = self.s3.objects["site/" + key]
        self.assertEqual(stored["ContentEncoding"], "gzip")
        self.assertEqual(json.loads(gzip.decompress(stored["Body"])), {"model": "gfs"})
        self.assertEqual(self.store.read(key), {"model": "gfs"})
        self.assertFalse(self.store.create(key, {"model": "changed"}))

    def test_merge_retries_from_a_fresh_read_when_it_loses_a_race(self):
        key = observation_key("2026-09-13")
        self.store.merge(key, lambda current: {"readings": [1]})
        calls = []

        def combine(current):
            calls.append(current)
            if len(calls) == 1:
                # Another writer lands between our read and our write.
                self.s3.put_object(Bucket="bucket", Key="site/" + key,
                                   Body=gzip.compress(b'{"readings":[1,2]}'),
                                   ContentEncoding="gzip")
            return {"readings": current["readings"] + [3]}

        self.assertEqual(self.store.merge(key, combine), {"readings": [1, 2, 3]})
        self.assertEqual(len(calls), 2)

    def test_keys_strip_the_prefix(self):
        self.store.create(forecast_key("gfs", "2026091300"), {})
        self.s3.seed("site/weather/gfs.json", b"{}")
        self.assertEqual(self.store.keys("archive/forecasts"), [forecast_key("gfs", "2026091300")])


class PruneNeverTouchesTheArchive(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.public = Path(self.temp.name)

    def test_the_archive_is_not_a_data_root(self):
        self.assertNotIn(prune.ARCHIVE_ROOT, prune.DATA_ROOTS)

    def test_registering_a_manifest_under_archive_stops_the_pruner_loading(self):
        with patch.dict(registry.MANIFESTS, {"bad": "archive/bad.json"}):
            with self.assertRaises(RuntimeError):
                importlib.reload(prune)
        importlib.reload(prune)  # Restore the real module state for later tests.

    def test_local_prune_leaves_an_old_archive_alone(self):
        stale = self.public / "archive" / "forecasts" / "gfs" / "2025091300.json"
        stale.parent.mkdir(parents=True)
        stale.write_text("{}")
        run = self.public / "weather" / "gfs-2025091300-x"
        run.mkdir(parents=True)
        (run / "0.bin").write_bytes(b"x")
        for path in (stale, run / "0.bin", run):
            os.utime(path, (OLD.timestamp(), OLD.timestamp()))
        result = prune_published(self.public, 0, now=NOW)
        self.assertEqual(result["removed"], ["weather/gfs-2025091300-x"])
        self.assertTrue(stale.is_file())

    def test_bucket_sweep_never_deletes_archived_objects(self):
        s3 = FakeS3()
        s3.seed("archive/forecasts/gfs/2025091300.json", b"{}", modified=OLD)
        s3.seed("archive/observations/2025-09-13.json", b"{}", modified=OLD)
        s3.seed("weather/gfs-2025-orphan/0.bin", b"x", modified=OLD)
        s3.seed("weather/gfs.json", json.dumps({"model": "gfs", "run": "2026091300", "frames": [
            {"url": "weather/gfs-2026091300-a/0.bin"}]}).encode(), modified=OLD)
        result = bucket_prune(s3, "bucket", now=NOW)
        self.assertEqual(result["removed"], ["weather/gfs-2025-orphan/0.bin"])
        self.assertIn("archive/forecasts/gfs/2025091300.json", s3.objects)
        self.assertIn("archive/observations/2025-09-13.json", s3.objects)

    def test_delete_keys_refuses_any_archived_key(self):
        s3 = FakeS3()
        s3.seed("archive/observations/2025-09-13.json", b"{}")
        s3.seed("weather/gfs-old/0.bin", b"x")
        for keys in (["archive/observations/2025-09-13.json"],
                     ["weather/gfs-old/0.bin", "site/archive/forecasts/gfs/1.json"]):
            with self.subTest(keys=keys), self.assertRaises(ValueError):
                delete_keys(s3, "bucket", keys)
        self.assertEqual(s3.delete_calls, 0)
        self.assertIn("weather/gfs-old/0.bin", s3.objects)

    def test_a_superseded_entry_can_only_ever_name_a_run_directory_beside_its_pointer(self):
        current = {"model": "gfs", "run": "2026091306", "base": "gfs-2026091306-6h-v1-1a1b1c1d/"}
        self.assertEqual(retire({"model": "gfs", "base": "gfs-2026091300-6h-v1-0a0b0c0d/"},
                                current, NOW),
                         [{"base": "gfs-2026091300-6h-v1-0a0b0c0d/", "at": "2026-09-13T12:00:00Z"}])
        for base in ("../archive/forecasts-0a0b0c0d/", "archive/gfs-0a0b0c0d/",
                     "/archive-0a0b0c0d/"):
            with self.subTest(base=base):
                self.assertEqual(retire({"model": "gfs", "base": base,
                                         "superseded": [{"base": base, "at": "2026-09-13T11:00:00Z"}]},
                                        current, NOW), [])


class OpenArchiveTests(unittest.TestCase):
    def test_a_bucket_wins_over_the_work_directory(self):
        self.assertIsInstance(archive.open_archive(public="/tmp/x"), LocalArchive)
        self.assertIsInstance(archive.open_archive(s3=FakeS3(), bucket="b"), BucketArchive)


if __name__ == "__main__":
    unittest.main()
