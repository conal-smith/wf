"""scripts/release/verify_bucket.py: the acceptance run's check that the bucket
holds every object a published pointer names."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from registry import MANIFESTS
from test_publish_s3 import BundleFixture, FakeS3

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "release" / "verify_bucket.py"
spec = importlib.util.spec_from_file_location("verify_bucket", SCRIPT)
verify_bucket = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_bucket)


class PagedS3(FakeS3):
    """The fake bucket with the paginator boto3 gives a listing."""

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        s3 = self

        class Pages:
            def paginate(self, Bucket, Prefix=""):
                token = None
                while True:
                    page = s3.list_objects_v2(Bucket, Prefix, ContinuationToken=token)
                    yield page
                    if not page["IsTruncated"]:
                        return
                    token = page["NextContinuationToken"]
        return Pages()


class VerifyBucketTests(BundleFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.s3 = PagedS3()

    def test_a_published_run_is_every_tile_and_square_its_pointer_names(self):
        self.assertEqual(self.run_publish(), "published")
        lines, failed = verify_bucket.check(self.s3, "test", "", ["harmonie"], self.root)
        self.assertFalse(failed, lines)
        self.assertEqual(lines, [f"ok   harmonie: run 2026091312, {len(self.keys())} objects"])

    def test_a_missing_tile_fails(self):
        self.run_publish()
        tile = next(key for key in self.keys() if key.endswith(".bin"))
        del self.s3.objects[tile]
        lines, failed = verify_bucket.check(self.s3, "test", "", ["harmonie"], self.root)
        self.assertTrue(failed)
        self.assertIn("1 referenced objects missing", lines[0])
        self.assertIn(tile, lines[0])

    def test_a_pointer_that_lists_its_files_is_checked_by_them(self):
        # Tides keep schemaVersion 1: a pointer and the station files it names.
        station = "marine/tides/dublin-0a0b0c0d.json"
        tides = {"schemaVersion": 1, "model": "tides", "run": "2026091312",
                 "stations": [{"id": "dublin", "url": station}]}
        public = Path(tempfile.mkdtemp(dir=self.temp.name))
        (public / MANIFESTS["tides"]).parent.mkdir(parents=True)
        (public / MANIFESTS["tides"]).write_text(json.dumps(tides))
        self.s3.seed(MANIFESTS["tides"], json.dumps(tides).encode())
        lines, failed = verify_bucket.check(self.s3, "test", "", ["tides"], public)
        self.assertTrue(failed)
        self.assertIn(station, lines[0])
        self.s3.seed(station, b"{}")
        lines, failed = verify_bucket.check(self.s3, "test", "", ["tides"], public)
        self.assertEqual((lines, failed), (["ok   tides: run 2026091312, 1 objects"], False))


if __name__ == "__main__":
    unittest.main()
