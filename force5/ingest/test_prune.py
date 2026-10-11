"""Retention must never remove an object a current manifest still points at."""
import contextlib
from datetime import datetime, timedelta, timezone
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import prune
from workspace import workspace_lock

NOW = datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)


def wind_manifest(model, run, directory, hours=(0, 3)):
    """A schemaVersion 2 pointer: one run directory beside it, urls relative to that."""
    return {"schemaVersion": 2, "model": model, "kind": "wind", "run": run,
            "runTime": "2026-09-16T00:00:00Z", "stepHours": 3, "grid": {"width": 2, "height": 2},
            "base": f"{directory}/",
            "frames": [{"hour": hour, "validTime": "2026-09-16T00:00:00Z",
                        "url": f"frames/{hour:03d}.json"} for hour in hours],
            "spots": {"squareDegrees": 2, "url": "spots/{square}.json", "squares": ["n52w010"],
                      "keys": ["spotForecasts"]}}


def superseding(manifest, directory, when):
    """The pointer, naming `directory` as the run directory it replaced at `when`."""
    return {**manifest, "superseded": [{"base": f"{directory}/",
                                        "at": when.strftime("%Y-%m-%dT%H:%M:%SZ")}]}


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
        (directory / "frames").mkdir()
        (directory / "spots").mkdir()
        for hour in hours:
            (directory / f"frames/{hour:03d}.json").write_text('{"u":[0,0,0,0]}')
        (directory / "spots/n52w010.json").write_text('{"square":"n52w010"}')
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


class DecodeBodyTest(unittest.TestCase):
    """A body is decoded by what it is, not only by the header that came with it."""

    def test_an_encoded_body_is_decoded(self):
        import brotli
        import gzip
        self.assertEqual(prune.decode_body(gzip.compress(b'{"a":1}'), "gzip"), b'{"a":1}')
        tile = b"F5T1" + bytes(range(40))
        self.assertEqual(prune.decode_body(brotli.compress(tile), "br"), tile)
        self.assertEqual(prune.decode_body(b'{"a":1}', None), b'{"a":1}')
        # A brotli stream's first byte can be a "[": that is no sign it is JSON.
        large = b"F5T1" + bytes(70000)
        stream = brotli.compress(large)
        self.assertEqual(stream[:1], b"[")
        self.assertEqual(prune.decode_body(stream, "br"), large)

    def test_a_body_already_decoded_is_kept_whatever_the_header_says(self):
        # A client or proxy that decoded the body and left Content-Encoding set.
        tile = b"F5T1" + bytes(range(40))
        for body, encoding in ((b'{"a":1}', "gzip"), (b"[1,2]", "gzip"), (b'{"a":1}', "br"),
                               (tile, "br"), (tile, "gzip")):
            with self.subTest(body=body[:4], encoding=encoding):
                self.assertEqual(prune.decode_body(body, encoding), body)

    def test_read_object_reads_either(self):
        import gzip

        class Bucket:
            def __init__(self, body, encoding):
                self.response = {"Body": io.BytesIO(body), "ContentEncoding": encoding}

            def get_object(self, Bucket, Key):
                return self.response

        for body in (gzip.compress(b'{"run":"x"}'), b'{"run":"x"}'):
            with self.subTest(body=body[:2]):
                self.assertEqual(prune.read_object(Bucket(body, "gzip"), "b", "k"), b'{"run":"x"}')


class PrunePublishedTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.tree = Tree(self.directory.name)
        self.tree.pointer("weather/harmonie.json",
                          wind_manifest("harmonie", "2026091600", "harmonie-live-1a1a1a1a"))
        self.tree.pointer("weather/gfs.json", wind_manifest("gfs", "2026091600", "gfs-live-2b2b2b2b"))
        self.tree.pointer("marine/tides.json",
                          tide_manifest("2026091600", "tides-DUBLIN-live.json"))
        self.referenced_old = self.tree.run_directory("harmonie-live-1a1a1a1a", age_hours=100)
        self.referenced_new = self.tree.run_directory("gfs-live-2b2b2b2b", age_hours=1)
        self.orphan_old = self.tree.run_directory("harmonie-previous-3c3c3c3c", age_hours=100)
        self.orphan_new = self.tree.run_directory("gfs-previous-4d4d4d4d", age_hours=6)
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
                         ["marine/tides-DUBLIN-previous.json", "weather/harmonie-previous-3c3c3c3c"])
        self.assertFalse(self.orphan_old.exists())
        self.assertFalse(self.station_old.exists())
        for kept in (self.referenced_old, self.referenced_new, self.orphan_new,
                     self.station_live, self.station_new):
            self.assertTrue(kept.exists(), kept)
        self.assertGreater(result["freedBytes"], 0)

    def test_a_binary_frames_sidecars_live_and_die_with_their_run(self):
        """`.bin.br`/`.bin.gz` are never referenced, so only whole-run retention saves them.

        The sweep works on top-level entries under `weather/`, keeping or removing
        a run directory entire, which is exactly what the sidecars need: nothing
        points at them, so a file-by-file sweep would collect them the moment they
        were written.
        """
        for directory in (self.referenced_old, self.orphan_old):
            for suffix in (".bin", ".bin.br", ".bin.gz"):
                (directory / f"000-abc{suffix}").write_bytes(b"F5F1")
        self.tree.age(self.referenced_old, 100)
        self.tree.age(self.orphan_old, 100)
        result = self.prune()
        self.assertIn("weather/harmonie-previous-3c3c3c3c", result["removed"])
        for suffix in (".bin", ".bin.br", ".bin.gz"):
            self.assertTrue((self.referenced_old / f"000-abc{suffix}").is_file(), suffix)
            self.assertFalse((self.orphan_old / f"000-abc{suffix}").exists(), suffix)
        self.assertNotIn("weather/harmonie-live-1a1a1a1a", result["removed"])

    def test_keeps_pointer_manifests_and_the_archive(self):
        self.prune()
        for pointer in ("weather/harmonie.json", "weather/gfs.json", "marine/tides.json"):
            self.assertTrue((self.tree.public / pointer).is_file(), pointer)
        self.assertTrue((self.public("weather") / prune.ARCHIVE_DIRECTORY / "harmonie" /
                         "2026091600-abc.json").is_file())

    def test_keeps_a_manifest_for_a_model_the_registry_lacks(self):
        self.tree.pointer("weather/nws-wave.json",
                          wind_manifest("nws-wave", "2026091600", "nws-wave-live-5e5e5e5e"))
        self.tree.age(self.public("weather") / "nws-wave.json", 400)
        result = self.prune()
        self.assertNotIn("weather/nws-wave.json", result["removed"])
        self.assertIn({"path": "weather/nws-wave.json", "reason": "manifest"},
                      result["kept"])

    def test_reasons_explain_every_kept_object(self):
        kept = {entry["path"]: entry["reason"] for entry in self.prune(dry_run=True)["kept"]}
        self.assertEqual(kept, {"weather/harmonie-live-1a1a1a1a": "referenced",
                                "weather/gfs-live-2b2b2b2b": "referenced",
                                "weather/gfs-previous-4d4d4d4d": "within-window",
                                "marine/tides-DUBLIN-live.json": "referenced",
                                "marine/tides-GALWAY-previous.json": "within-window"})

    def test_dry_run_reports_without_deleting(self):
        result = self.prune(dry_run=True)
        self.assertIn("weather/harmonie-previous-3c3c3c3c", result["removed"])
        self.assertTrue(self.orphan_old.exists())
        self.assertTrue(self.station_old.exists())

    def test_zero_window_still_protects_referenced_objects(self):
        result = prune.prune_published(self.tree.public, 0, now=NOW)
        self.assertIn("weather/gfs-previous-4d4d4d4d", result["removed"])
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

    def test_a_superseded_run_outlives_the_swap_by_its_grace_period(self):
        # Old by its files, but its pointer only stopped naming it half an hour ago:
        # a reader may still hold that pointer.
        self.tree.pointer("weather/harmonie.json", superseding(
            wind_manifest("harmonie", "2026091600", "harmonie-live-1a1a1a1a"),
            "harmonie-previous-3c3c3c3c", NOW - timedelta(minutes=30)))
        result = prune.prune_published(self.tree.public, 0, now=NOW)
        self.assertNotIn("weather/harmonie-previous-3c3c3c3c", result["removed"])
        self.assertIn({"path": "weather/harmonie-previous-3c3c3c3c",
                       "reason": "superseded-within-grace"}, result["kept"])
        self.assertTrue(self.orphan_old.exists())
        # Past its grace it is junk like any other.
        result = prune.prune_published(self.tree.public, 0, now=NOW, grace=20)
        self.assertIn("weather/harmonie-previous-3c3c3c3c", result["removed"])
        self.assertFalse(self.orphan_old.exists())

    def test_the_grace_period_comes_from_the_environment_and_is_bounded(self):
        self.tree.pointer("weather/harmonie.json", superseding(
            wind_manifest("harmonie", "2026091600", "harmonie-live-1a1a1a1a"),
            "harmonie-previous-3c3c3c3c", NOW - timedelta(minutes=30)))
        with patch.dict(os.environ, {prune.GRACE_ENV: "10"}):
            self.assertIn("weather/harmonie-previous-3c3c3c3c",
                          prune.prune_published(self.tree.public, 0, now=NOW,
                                                dry_run=True)["removed"])
        for grace in (-1, prune.SUPERSEDED_KEEP_HOURS * 60 + 1):
            with self.subTest(grace=grace), self.assertRaises(ValueError):
                prune.prune_published(self.tree.public, 0, now=NOW, grace=grace)

    def test_a_superseded_entry_with_an_unreadable_time_counts_as_just_now(self):
        manifest = wind_manifest("harmonie", "2026091600", "harmonie-live-1a1a1a1a")
        manifest["superseded"] = [{"base": "harmonie-previous-3c3c3c3c/", "at": "soon"}]
        self.tree.pointer("weather/harmonie.json", manifest)
        result = prune.prune_published(self.tree.public, 0, now=NOW)
        self.assertNotIn("weather/harmonie-previous-3c3c3c3c", result["removed"])


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
                          wind_manifest("harmonie", "2026091600", "harmonie-live-1a1a1a1a"))
        self.tree.run_directory("harmonie-live-1a1a1a1a", age_hours=1)
        self.tree.run_directory("harmonie-previous-3c3c3c3c", age_hours=200)

    def test_main_prunes_and_reports(self):
        code, event = run_main(["--root", self.directory.name])
        self.assertEqual(code, 0)
        self.assertEqual(event["event"], "prune_complete")
        self.assertEqual(event["removed"], ["weather/harmonie-previous-3c3c3c3c"])
        self.assertEqual(event["maxAgeHours"], prune.DEFAULT_MAX_AGE_HOURS)
        self.assertFalse((self.tree.public / "weather" / "harmonie-previous-3c3c3c3c").exists())

    def test_main_honours_an_explicit_window(self):
        code, event = run_main(["--root", self.directory.name, "--max-age-hours", "1000",
                                "--dry-run"])
        self.assertEqual((code, event["removed"]), (0, []))
        self.assertTrue((self.tree.public / "weather" / "harmonie-previous-3c3c3c3c").exists())

    def test_main_fails_without_published_output(self):
        with tempfile.TemporaryDirectory() as empty:
            code, event = run_main(["--root", empty])
            self.assertEqual((code, event["event"]), (1, "prune_failed"))

    def test_main_fails_on_a_broken_manifest_without_deleting(self):
        (self.tree.public / "weather" / "harmonie.json").write_text("nope")
        code, event = run_main(["--root", self.directory.name])
        self.assertEqual((code, event["event"]), (1, "prune_failed"))
        self.assertTrue((self.tree.public / "weather" / "harmonie-previous-3c3c3c3c").exists())

    def test_main_keeps_nothing_superseded_by_default(self):
        self.tree.run_directory("harmonie-an-hour-ago", age_hours=1)
        code, event = run_main(["--root", self.directory.name])
        self.assertEqual(code, 0)
        self.assertEqual(event["removed"], ["weather/harmonie-an-hour-ago",
                                            "weather/harmonie-previous-3c3c3c3c"])

    def test_main_skips_the_sweep_while_an_import_holds_the_lock(self):
        # A run that is still being written is unreferenced too; only the lock protects it.
        self.tree.run_directory("harmonie-arriving", age_hours=0)
        with workspace_lock(Path(self.directory.name)):
            code, event = run_main(["--root", self.directory.name])
        self.assertEqual((code, event["event"]), (0, "prune_skipped"))
        self.assertTrue((self.tree.public / "weather" / "harmonie-arriving").exists())
        self.assertTrue((self.tree.public / "weather" / "harmonie-previous-3c3c3c3c").exists())


class RunDirectoryLayoutTest(unittest.TestCase):
    """A schemaVersion 2 pointer keeps its whole run directory, squares and all."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.tree = Tree(self.directory.name)

    def test_the_whole_run_directory_lives_with_its_pointer(self):
        self.tree.pointer("weather/harmonie.json",
                          wind_manifest("harmonie", "2026091600", "harmonie-live-1a1a1a1a"))
        live = self.tree.run_directory("harmonie-live-1a1a1a1a", age_hours=100)
        # A square the frame list does not name is still the run's: it is kept with it.
        (live / "spots/n54w010.json").write_text("{}")
        staging = self.tree.run_directory("harmonie-2026091612-6h-v2", age_hours=100)
        result = prune.prune_published(self.tree.public, 0, now=NOW)
        self.assertEqual(result["removed"], ["weather/harmonie-2026091612-6h-v2"])
        self.assertTrue((live / "spots/n54w010.json").is_file())
        self.assertTrue((live / "frames/000.json").is_file())
        self.assertFalse(staging.exists())

    def test_a_base_that_leaves_its_directory_stops_the_sweep(self):
        for base in ("../harmonie-live-1a1a1a1a/", "harmonie-live", "a/harmonie-live-1a1a1a1a/",
                     "/harmonie-live-1a1a1a1a/"):
            with self.subTest(base=base):
                manifest = wind_manifest("harmonie", "2026091600", "harmonie-live-1a1a1a1a")
                self.tree.pointer("weather/harmonie.json", {**manifest, "base": base})
                with self.assertRaises(ValueError):
                    prune.prune_published(self.tree.public, 0, now=NOW)

    def test_a_frame_url_that_leaves_the_run_stops_the_sweep(self):
        manifest = wind_manifest("harmonie", "2026091600", "harmonie-live-1a1a1a1a")
        manifest["frames"][0]["url"] = "../../marine/tides.json"
        self.tree.pointer("weather/harmonie.json", manifest)
        with self.assertRaises(ValueError):
            prune.prune_published(self.tree.public, 0, now=NOW)

    def test_the_run_directory_a_pointer_names(self):
        manifest = wind_manifest("harmonie", "2026091600", "harmonie-live-1a1a1a1a")
        self.assertEqual(prune.run_directory(manifest, "weather/harmonie.json"),
                         "weather/harmonie-live-1a1a1a1a")
        self.assertIsNone(prune.run_directory(tide_manifest("2026091600"), "marine/tides.json"))


class BucketPruneTest(unittest.TestCase):
    """The bucket sweep clears failed uploads and nothing else, ever."""

    def setUp(self):
        from test_publish_s3 import FakeS3
        self.s3 = FakeS3()
        self.pointer = self.s3.seed("weather/harmonie.json", json.dumps(
            wind_manifest("harmonie", "2026091600", "harmonie-live-1a1a1a1a")).encode(), NOW)
        # Both models need a pointer: with none, the sweep protects everything of
        # theirs rather than treating it as unreferenced.
        self.tide_pointer = self.s3.seed("marine/tides.json", json.dumps(
            tide_manifest("2026091600", "tides-DUBLIN-live.json")).encode(), NOW)
        self.live = [self.s3.seed(f"weather/harmonie-live-1a1a1a1a/{hour:03d}-abc.json", b'{"u":[0]}',
                                  NOW - timedelta(hours=100)) for hour in (0, 3)]
        self.station_live = self.s3.seed("marine/tides-DUBLIN-live.json",
                                         b'{"station":"DUBLIN","curve":[1,2]}',
                                         NOW - timedelta(hours=99))
        self.orphan = self.s3.seed("weather/harmonie-previous-3c3c3c3c/000-abc.json", b'{"u":[0,0]}',
                                   NOW - timedelta(hours=100))
        self.arriving = self.s3.seed("weather/harmonie-arriving/000-abc.json", b'{"u":[0]}',
                                     NOW - timedelta(hours=1))
        self.archive = self.s3.seed("weather/manifests/harmonie/2026091600-abc.json", b"{}",
                                    NOW - timedelta(hours=500))
        self.station = self.s3.seed("marine/tides-DUBLIN-previous.json",
                                    b'{"station":"DUBLIN","curve":[1,2]}', NOW - timedelta(hours=99))

    def sweep(self, **kwargs):
        return prune.bucket_prune(self.s3, "test", now=NOW, **kwargs)

    def test_every_object_inside_a_referenced_run_directory_is_kept(self):
        inside = [self.s3.seed(f"weather/harmonie-live-1a1a1a1a/{name}", b"{}",
                               NOW - timedelta(hours=100))
                  for name in ("frames/000.bin", "frames/003.bin", "spots/n52w010.json",
                               "spots/n54w010.json")]
        lookalike = self.s3.seed("weather/harmonie-live-1a1a1a1a0/spots/n52w010.json", b"{}",
                                 NOW - timedelta(hours=100))
        result = self.sweep()
        for key in inside:
            self.assertIn(key, self.s3.objects)
        self.assertIn(lookalike, result["removed"])

    def test_removes_only_unreferenced_objects_past_the_guard(self):
        result = self.sweep()
        self.assertEqual(result["removed"], ["marine/tides-DUBLIN-previous.json",
                                             "weather/harmonie-previous-3c3c3c3c/000-abc.json"])
        self.assertGreater(result["freedBytes"], 0)
        for key in [*self.live, self.arriving, self.archive, self.pointer,
                    self.tide_pointer, self.station_live]:
            self.assertIn(key, self.s3.objects, key)

    def test_a_model_with_no_pointer_keeps_everything_it_owns(self):
        # An absent pointer says nothing about what that model still needs, so
        # "unreferenced" is meaningless for it. Only tides may be swept here.
        del self.s3.objects["weather/harmonie.json"]
        result = self.sweep()
        self.assertEqual(result["removed"], ["marine/tides-DUBLIN-previous.json"])
        self.assertIn("harmonie", result["noPointer"])
        self.assertIn("harmonie", result["protectedModels"])
        # The two live frames and the previous run; the arriving one is already
        # held back by the age guard and never reaches this stage.
        self.assertEqual((result["protectedObjects"], result["withinGuard"]), (3, 1))
        self.assertIn(self.orphan, self.s3.objects)
        for key in self.live:
            self.assertIn(key, self.s3.objects, key)

    def test_a_sibling_models_missing_pointer_does_not_protect_this_one(self):
        # harmonie-eps has published no pointer, but "harmonie-previous-3c3c3c3c" is harmonie's
        # and harmonie has one, so the nesting must not hand it a free pass.
        self.assertFalse(prune.model_owns("harmonie-eps", "harmonie-previous-3c3c3c3c"))
        result = self.sweep()
        self.assertIn("harmonie-eps", result["noPointer"])
        self.assertIn("weather/harmonie-previous-3c3c3c3c/000-abc.json", result["removed"])
        self.assertNotIn(self.orphan, self.s3.objects)

    def test_an_object_referenced_while_the_listing_ran_is_not_deleted(self):
        # The keep-set is read before a slow paginated listing, and put_immutable
        # leaves an already-present object alone, so a re-referenced stable key keeps
        # its old LastModified and the age guard cannot protect it. The second read can.
        listing = prune.bucket_objects

        def publish_midway(s3, bucket, prefix):
            yield from list(listing(s3, bucket, prefix))
            self.s3.seed("marine/tides.json", json.dumps(tide_manifest(
                "2026091612", "tides-DUBLIN-previous.json")).encode(), NOW)

        with patch.object(prune, "bucket_objects", publish_midway):
            result = self.sweep()
        self.assertNotIn("marine/tides-DUBLIN-previous.json", result["removed"])
        self.assertIn(self.station, self.s3.objects)

    def test_a_young_orphan_is_a_run_another_machine_may_still_be_uploading(self):
        self.assertEqual(self.sweep()["withinGuard"], 1)
        self.assertIn(self.arriving, self.s3.objects)
        # Past the guard it is ordinary wreckage.
        self.assertIn("weather/harmonie-arriving/000-abc.json",
                      self.sweep(min_age_hours=0.5)["removed"])

    def test_an_unreadable_manifest_aborts_before_deleting_anything(self):
        self.s3.seed("weather/harmonie.json", b"{not json")
        with self.assertRaises(ValueError):
            self.sweep()
        self.assertEqual(self.s3.deleted, [])

    def test_a_manifest_that_cannot_be_read_at_all_aborts(self):
        self.s3.deny.add("weather/harmonie.json")
        with self.assertRaises(ValueError):
            self.sweep()
        self.assertEqual(self.s3.deleted, [])

    def test_a_manifest_referencing_nothing_aborts(self):
        self.s3.seed("weather/harmonie.json", json.dumps(
            {"model": "harmonie", "run": "2026091600", "frames": []}).encode())
        with self.assertRaises(ValueError):
            self.sweep()
        self.assertEqual(self.s3.deleted, [])

    def test_a_pointer_for_a_model_the_registry_lacks_is_kept(self):
        self.s3.seed("weather/nws-wave.json", json.dumps(
            wind_manifest("nws-wave", "2026091600", "nws-wave-live-5e5e5e5e")).encode(),
            NOW - timedelta(hours=400))
        self.assertNotIn("weather/nws-wave.json", self.sweep()["removed"])
        self.assertIn("weather/nws-wave.json", self.s3.objects)

    def test_dry_run_reports_without_deleting(self):
        result = self.sweep(dry_run=True)
        self.assertIn("weather/harmonie-previous-3c3c3c3c/000-abc.json", result["removed"])
        self.assertEqual(self.s3.deleted, [])
        self.assertIn(self.orphan, self.s3.objects)

    def test_listings_and_deletes_are_paginated(self):
        self.s3.page_size = 400
        keys = [self.s3.seed(f"weather/harmonie-failed/{i:05d}-abc.json", b"{}",
                             NOW - timedelta(hours=50)) for i in range(1100)]
        result = self.sweep()
        self.assertEqual(len(result["removed"]), 1100 + 2)
        self.assertGreater(self.s3.list_calls, 3)
        # A directory at a time, 1000 keys to a request: 1100 keys in two, the
        # previous run's directory in one, and the stale station file in one.
        self.assertEqual(self.s3.delete_calls, 4)
        for key in keys:
            self.assertNotIn(key, self.s3.objects)

    def test_a_prefix_confines_the_sweep(self):
        self.s3.objects = {f"cdn/{key}": value for key, value in self.s3.objects.items()}
        result = prune.bucket_prune(self.s3, "test", "cdn/", now=NOW)
        self.assertEqual(result["removed"], ["marine/tides-DUBLIN-previous.json",
                                             "weather/harmonie-previous-3c3c3c3c/000-abc.json"])
        self.assertIn("cdn/weather/harmonie-live-1a1a1a1a/000-abc.json", self.s3.objects)

    def supersede_previous(self, minutes_ago):
        self.s3.seed("weather/harmonie.json", json.dumps(superseding(
            wind_manifest("harmonie", "2026091600", "harmonie-live-1a1a1a1a"),
            "harmonie-previous-3c3c3c3c", NOW - timedelta(minutes=minutes_ago))).encode(), NOW)

    def test_a_superseded_run_is_kept_for_its_grace_period_however_old_its_objects(self):
        # Its objects are a hundred hours old, far past the guard; it is the swap
        # half an hour ago that matters, because readers still hold that pointer.
        self.supersede_previous(30)
        result = self.sweep()
        self.assertNotIn("weather/harmonie-previous-3c3c3c3c/000-abc.json", result["removed"])
        self.assertEqual(result["withinGrace"], 1)
        self.assertIn(self.orphan, self.s3.objects)
        result = self.sweep(grace=20)
        self.assertIn("weather/harmonie-previous-3c3c3c3c/000-abc.json", result["removed"])
        self.assertNotIn(self.orphan, self.s3.objects)

    def test_a_directory_named_again_just_before_its_delete_is_kept(self):
        # A republish of the same content reuses the directory and leaves its old
        # objects, and their old LastModified, alone. If its pointer lands after the
        # sweep's second read, only the read just before the delete can see it.
        reads = []
        keep_sets = prune.keep_sets

        def republished(s3, bucket, prefix, now, grace):
            reads.append(1)
            if len(reads) == 3:
                self.s3.seed("weather/harmonie.json", json.dumps(wind_manifest(
                    "harmonie", "2026091612", "harmonie-previous-3c3c3c3c")).encode(), NOW)
            return keep_sets(s3, bucket, prefix, now, grace)

        with patch.object(prune, "keep_sets", republished):
            result = self.sweep()
        self.assertGreaterEqual(len(reads), 3)
        self.assertNotIn("weather/harmonie-previous-3c3c3c3c/000-abc.json", result["removed"])
        self.assertIn(self.orphan, self.s3.objects)
        self.assertIn("marine/tides-DUBLIN-previous.json", result["removed"])

    def test_a_run_directory_is_judged_by_its_newest_object(self):
        # Half of a run uploaded long ago and half just now is one run in flight, not
        # one old object to delete and one young one to keep.
        young = self.s3.seed("weather/harmonie-previous-3c3c3c3c/003-abc.json", b"{}",
                             NOW - timedelta(hours=1))
        result = self.sweep()
        self.assertNotIn("weather/harmonie-previous-3c3c3c3c/000-abc.json", result["removed"])
        self.assertIn(self.orphan, self.s3.objects)
        self.assertIn(young, self.s3.objects)


class SweepCommandTest(unittest.TestCase):
    def test_the_bucket_mode_reports_and_never_touches_a_work_directory(self):
        from test_publish_s3 import FakeS3
        s3 = FakeS3()
        s3.seed("weather/harmonie.json", json.dumps(
            wind_manifest("harmonie", "2026091600", "harmonie-live-1a1a1a1a")).encode())
        s3.seed("weather/harmonie-live-1a1a1a1a/000-abc.json", b"{}")
        orphan = s3.seed("weather/harmonie-previous-3c3c3c3c/000-abc.json", b"{}",
                         datetime(2020, 1, 1, tzinfo=timezone.utc))
        with patch("publish_s3.make_client", return_value=s3):
            code, event = run_main(["--bucket", "test", "--endpoint-url",
                                    "https://account.r2.cloudflarestorage.com"])
        self.assertEqual((code, event["event"]), (0, "sweep_complete"))
        self.assertEqual(event["removed"], ["weather/harmonie-previous-3c3c3c3c/000-abc.json"])
        self.assertNotIn(orphan, s3.objects)

    def test_s3_bucket_in_the_environment_does_not_hijack_the_local_sweep(self):
        # The scheduler's environment carries S3_BUCKET for the worker. If this
        # command picked it up, the hourly retention job would quietly become a
        # bucket sweep and the disk would fill.
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        tree = Tree(directory.name)
        tree.pointer("weather/harmonie.json",
                     wind_manifest("harmonie", "2026091600", "harmonie-live-1a1a1a1a"))
        tree.run_directory("harmonie-live-1a1a1a1a", age_hours=1)
        tree.run_directory("harmonie-previous-3c3c3c3c", age_hours=200)
        with patch.dict(os.environ, {"S3_BUCKET": "wingfoil-forecast"}):
            code, event = run_main(["--root", directory.name])
        self.assertEqual((code, event["event"]), (0, "prune_complete"))
        self.assertEqual(event["removed"], ["weather/harmonie-previous-3c3c3c3c"])

    def test_the_grace_period_is_an_option_of_both_modes_and_bounded(self):
        from test_publish_s3 import FakeS3
        s3 = FakeS3()
        s3.seed("weather/harmonie.json", json.dumps(superseding(
            wind_manifest("harmonie", "2026091600", "harmonie-live-1a1a1a1a"),
            "harmonie-previous-3c3c3c3c", datetime.now(timezone.utc) - timedelta(minutes=30)))
            .encode())
        s3.seed("weather/harmonie-previous-3c3c3c3c/000-abc.json", b"{}",
                datetime(2020, 1, 1, tzinfo=timezone.utc))
        with patch("publish_s3.make_client", return_value=s3):
            code, event = run_main(["--bucket", "test"])
            self.assertEqual((code, event["removed"], event["withinGrace"]), (0, [], 1))
            self.assertEqual(event["graceMinutes"], prune.DEFAULT_GRACE_MINUTES)
            code, event = run_main(["--bucket", "test", "--grace-minutes", "15"])
            self.assertEqual(event["removed"], ["weather/harmonie-previous-3c3c3c3c/000-abc.json"])
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            prune.main(["--bucket", "test", "--grace-minutes", "600"])

    def test_local_only_options_cannot_be_combined_with_a_bucket(self):
        for extra in (["--max-age-hours", "48"], ["--cache-days", "1"], ["--root", "/tmp"]):
            with self.subTest(extra=extra[0]), contextlib.redirect_stderr(io.StringIO()) as err:
                with self.assertRaises(SystemExit):
                    prune.main(["--bucket", "test", *extra])
            self.assertIn(extra[0], err.getvalue())

    def test_a_broken_manifest_fails_the_command_without_deleting(self):
        from test_publish_s3 import FakeS3
        s3 = FakeS3()
        s3.seed("weather/harmonie.json", b"nope")
        s3.seed("weather/harmonie-previous-3c3c3c3c/000-abc.json", b"{}",
                datetime(2020, 1, 1, tzinfo=timezone.utc))
        with patch("publish_s3.make_client", return_value=s3):
            code, event = run_main(["--bucket", "test"])
        self.assertEqual((code, event["event"]), (1, "sweep_failed"))
        self.assertEqual(s3.deleted, [])


class WorkerTest(unittest.TestCase):
    def test_a_published_run_deletes_the_one_it_replaced(self):
        import worker
        with tempfile.TemporaryDirectory() as directory:
            tree = Tree(directory)
            tree.pointer("weather/harmonie.json",
                         wind_manifest("harmonie", "2026091600", "harmonie-live-1a1a1a1a"))
            tree.run_directory("harmonie-live-1a1a1a1a", age_hours=0)
            tree.run_directory("harmonie-previous-3c3c3c3c", age_hours=0)
            self.assertEqual(worker.drop_superseded(tree.public), 1)
            self.assertTrue((tree.public / "weather" / "harmonie-live-1a1a1a1a").exists())
            self.assertFalse((tree.public / "weather" / "harmonie-previous-3c3c3c3c").exists())

    def test_the_run_a_publish_just_replaced_waits_out_its_grace_period(self):
        import worker
        with tempfile.TemporaryDirectory() as directory:
            tree = Tree(directory)
            tree.pointer("weather/harmonie.json", superseding(
                wind_manifest("harmonie", "2026091600", "harmonie-live-1a1a1a1a"),
                "harmonie-previous-3c3c3c3c", datetime.now(timezone.utc)))
            tree.run_directory("harmonie-live-1a1a1a1a", age_hours=0)
            tree.run_directory("harmonie-previous-3c3c3c3c", age_hours=0)
            self.assertEqual(worker.drop_superseded(tree.public), 0)
            self.assertTrue((tree.public / "weather" / "harmonie-previous-3c3c3c3c").exists())

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
            tree.run_directory("harmonie-previous-3c3c3c3c", age_hours=0)
            (tree.public / "weather" / "harmonie.json").write_text("nope")
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(worker.drop_superseded(tree.public), 0)
            self.assertTrue((tree.public / "weather" / "harmonie-previous-3c3c3c3c").exists())


if __name__ == "__main__":
    unittest.main()
