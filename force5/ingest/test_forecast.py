import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import fetch_forecast
from fetch_forecast import (PUBLISHED_IN_BUCKET, PUBLISHED_ON_DISK, already_published,
                            discover, published_in_bucket, sample, validate_metadata, write_json)
from registry import UNCHANGED_EXIT


class AlreadyPublishedTests(unittest.TestCase):
    """Raw downloads are not kept, so a repeated slot must not download a run twice."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.weather = Path(directory.name) / "weather"
        self.manifest = self.weather / "ecmwf.json"
        (self.weather / "ecmwf-2026091700-360h-v2").mkdir(parents=True)
        write_json(self.manifest, {"run": "2026091700", "frames": [
            {"url": "weather/ecmwf-2026091700-360h-v2/000-abc.json"}]})

    def test_the_run_on_the_pointer_is_not_downloaded_again(self):
        self.assertEqual(already_published(self.manifest, "2026091700",
                                           "ecmwf-2026091700-360h-v2"), PUBLISHED_ON_DISK)

    def test_a_newer_run_or_a_different_bundle_is_downloaded(self):
        self.assertFalse(already_published(self.manifest, "2026091712", "ecmwf-2026091712-360h-v2"))
        self.assertFalse(already_published(self.manifest, "2026091700", "ecmwf-2026091700-360h-v3"))

    def test_the_run_the_bucket_serves_wins_over_an_empty_disk(self):
        # A one-shot container has no previous output, so the worker's answer is the
        # only one there is; a different run is still downloaded.
        with patch.dict(os.environ, {"FORCE5_PUBLISHED_RUN": "2026091712"}):
            self.assertEqual(already_published(self.weather / "absent.json", "2026091712", "x"),
                             PUBLISHED_IN_BUCKET)
            self.assertFalse(already_published(self.weather / "absent.json", "2026091800", "x"))

    def test_a_run_only_on_disk_is_never_reported_as_published(self):
        """The publish failed last time and /data persisted: republish, don't skip.

        The bucket still serves an older run while the newer one sits on disk. Only
        the bucket's answer may end the job; confusing the two would leave the site
        stale for a whole source cycle while the worker logged success.
        """
        with patch.dict(os.environ, {"FORCE5_PUBLISHED_RUN": "2026091612"}):
            self.assertEqual(already_published(self.manifest, "2026091700",
                                               "ecmwf-2026091700-360h-v2"), PUBLISHED_ON_DISK)

    def test_a_missing_or_broken_pointer_or_run_directory_is_downloaded(self):
        self.assertFalse(already_published(self.weather / "absent.json", "2026091700", "x"))
        (self.weather / "ecmwf-2026091700-360h-v2").rmdir()
        self.assertFalse(already_published(self.manifest, "2026091700", "ecmwf-2026091700-360h-v2"))
        self.manifest.write_text("nope")
        self.assertFalse(already_published(self.manifest, "2026091700", "ecmwf-2026091700-360h-v2"))


class PublishedInBucketTests(unittest.TestCase):
    """The bucket half alone, for adapters that cannot name their bundle before downloading."""

    def test_only_the_run_the_worker_passed_matches(self):
        with patch.dict(os.environ, {"FORCE5_PUBLISHED_RUN": "2026091712"}):
            self.assertTrue(published_in_bucket("2026091712"))
            self.assertFalse(published_in_bucket("2026091800"))
            self.assertFalse(published_in_bucket(None))

    def test_an_explicit_run_is_always_imported_again(self):
        with patch.dict(os.environ, {"FORCE5_PUBLISHED_RUN": "2026091712"}):
            self.assertFalse(published_in_bucket("2026091712", "2026091712"))

    def test_without_the_worker_nothing_is_ever_published(self):
        # A local run never sets it, and a run on disk is not the bucket's answer.
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(published_in_bucket("2026091712"))
        with patch.dict(os.environ, {"FORCE5_PUBLISHED_RUN": ""}):
            self.assertFalse(published_in_bucket(""))


class IconPublishedRunTests(unittest.TestCase):
    """ICON-EU decides from its inventory listing, before a single GRIB is fetched."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)

    def run_main(self, published, *argv):
        urls = {(hour, field): f"url/{field}/{hour}" for hour in (0, 3) for field in ("u", "v", "gust")}
        with patch("sys.argv", ["fetch_forecast.py", "--hours", "3", *argv]), \
             patch.object(fetch_forecast, "ROOT", self.root), \
             patch.dict(os.environ, {"FORCE5_PUBLISHED_RUN": published}), \
             patch("fetch_forecast.discover", return_value=("2026091706", urls)), \
             patch("fetch_forecast.get", side_effect=OSError("network")) as get, \
             patch("sys.stdout", io.StringIO()):
            try:
                return fetch_forecast.main(), get
            except OSError:
                return "downloaded", get

    def test_the_run_the_bucket_serves_is_not_downloaded_again(self):
        result, get = self.run_main("2026091706")
        self.assertEqual(result, UNCHANGED_EXIT)
        get.assert_not_called()
        self.assertFalse((self.root / "public/weather/latest.json").exists())

    def test_a_newer_run_or_an_explicit_run_is_downloaded(self):
        self.assertEqual(self.run_main("2026091700")[0], "downloaded")
        self.assertEqual(self.run_main("2026091706", "--run", "2026091706")[0], "downloaded")


class ForecastTests(unittest.TestCase):
    def setUp(self):
        self.metadata = {"parameterCategory": 2, "parameterNumber": 2, "units": "m s**-1", "level": 10,
                         "typeOfLevel": "heightAboveGround", "gridType": "regular_ll", "uvRelativeToGrid": 0,
                         "stepUnits": 1, "startStep": 3, "endStep": 3, "dataDate": 20260913, "dataTime": 600,
                         "validityDate": 20260913, "validityTime": 900, "stepType": "instant"}

    def test_valid_metadata(self):
        validate_metadata(self.metadata, "u", "2026091306", 3)

    def test_reject_wrong_vector_orientation_units_time(self):
        for key, value in [("uvRelativeToGrid", 1), ("units", "knots"), ("validityTime", 1200), ("dataTime", 0), ("level", 100), ("parameterNumber", 3), ("stepType", "avg")]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_metadata({**self.metadata, key: value}, "u", "2026091306", 3)

    def test_interpolation_orientation_and_boundaries(self):
        grid = {"width": 2, "height": 2, "west": -10, "north": 54, "dx": 1, "dy": 1}
        self.assertEqual(sample(grid, [0,10,20,30], -9.5, 53.5), 15)
        self.assertEqual(sample(grid, [0,10,20,30], -9, 53), 30)
        self.assertIsNone(sample(grid, [0,10,20,30], -11, 53))

    def test_discovery_skips_incomplete_newer_run(self):
        def inventory(cycle, field):
            if cycle == "06":
                return {("2026091306", h): f"url/{field}/{h}" for h in [0,3]}
            if cycle == "12":
                return {("2026091312", h): f"url/{field}/{h}" for h in ([0] if field=="vmax_10m" else [0,3])}
            return {}
        with patch("fetch_forecast.listing", side_effect=inventory):
            run, urls = discover([0,3])
        self.assertEqual(run, "2026091306")
        self.assertEqual(len(urls), 6)

    def test_atomic_publish_preserves_previous_manifest_on_error(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"latest.json"
            write_json(path, {"run":"last-good"})
            with patch("fetch_forecast.os.replace", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    write_json(path, {"run":"incomplete"})
            self.assertEqual(json.loads(path.read_text())["run"], "last-good")


if __name__ == "__main__":
    unittest.main()
