"""The blend job: what it reads from the bucket, and what the publisher accepts of it."""
import gzip
import json
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest

import fetch_blend
from publish_s3 import validate_bundle
from registry import MANIFESTS, MODELS
from test_publish_s3 import FakeS3

NOW = datetime(2026, 9, 14, 0, 20, tzinfo=timezone.utc)
TIMES = ["2026-09-14T00:00:00Z", "2026-09-14T01:00:00Z", "2026-09-14T03:00:00Z"]


def blend(**changes):
    value = {
        "schemaVersion": 1, "kind": "blend", "model": "blend",
        "run": "2026091400", "runTime": "2026-09-14T00:00:00Z",
        "generatedAt": "2026-09-14T00:20:00Z",
        "coverage": {"from": TIMES[0], "to": TIMES[-1]},
        "times": TIMES,
        "sources": [{"id": "harmonie", "name": "HARMONIE", "run": "2026091323",
                     "runTime": "2026-09-13T23:00:00Z", "resolutionKm": 2,
                     "ensemble": False, "weight": 3, "columns": [0, 1, 2]}],
        "spots": {"brandon": {"wind": [123, None, 87], "gust": [180, None, None],
                              "from": [270, None, 255], "agreement": "h-m"}},
    }
    value.update(changes)
    return value


class BlendBundleTests(unittest.TestCase):
    def check(self, manifest):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / MANIFESTS["blend"]
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(manifest))
            return validate_bundle(directory, "blend", MODELS["blend"]["maxAgeHours"], now=NOW)

    def test_a_blend_is_one_self_contained_file(self):
        manifest, _, objects = self.check(blend())
        self.assertEqual(manifest["run"], "2026091400")
        self.assertEqual(objects, [])

    def test_refuses_a_blend_that_does_not_hold_together(self):
        short = blend()
        short["spots"]["brandon"]["wind"] = [123, None]
        unordered = blend(times=[TIMES[1], TIMES[0], TIMES[2]])
        unordered["coverage"] = {"from": TIMES[1], "to": TIMES[2]}
        bad_column = blend()
        bad_column["sources"][0]["columns"] = [0, 3]
        bad_letter = blend()
        bad_letter["spots"]["brandon"]["agreement"] = "h?m"
        for name, manifest in {"a short series": short, "unordered times": unordered,
                               "a column past the end": bad_column,
                               "an unknown agreement": bad_letter,
                               "no places": blend(spots={}),
                               "an old blend": blend(run="2026091318",
                                                     runTime="2026-09-13T18:00:00Z")}.items():
            with self.subTest(name), self.assertRaises(ValueError):
                self.check(manifest)


def pointer(model, squares):
    return {"model": model, "base": f"{model}-2026091312-6h-v1-0a0b0c0d/",
            "spots": {"squareDegrees": 2, "url": "spots/{square}.json", "squares": squares,
                      "keys": ["spotForecasts"]}}


class ReadBucketTests(unittest.TestCase):
    def test_copies_every_wind_pointer_the_bucket_serves_and_its_squares(self):
        s3 = FakeS3()
        for model, squares in (("harmonie", ["n52w010", "n54w008"]), ("ecmwf", ["n52w010"])):
            s3.seed("forecast/" + MANIFESTS[model], json.dumps(pointer(model, squares)).encode())
            for square in squares:
                key = f"forecast/weather/{model}-2026091312-6h-v1-0a0b0c0d/spots/{square}.json"
                s3.objects[key] = {"Body": gzip.compress(json.dumps({"square": square}).encode()),
                                   "ContentEncoding": "gzip", "ETag": '"x"'}
        s3.seed("forecast/" + MANIFESTS["tides"], json.dumps({"model": "tides"}).encode())
        with tempfile.TemporaryDirectory() as directory:
            found = fetch_blend.read_bucket(s3, "bucket", "forecast", Path(directory))
            self.assertEqual(sorted(found), ["ecmwf", "harmonie"])
            self.assertEqual(json.loads((Path(directory) / MANIFESTS["ecmwf"]).read_text()),
                             pointer("ecmwf", ["n52w010"]))
            square = (Path(directory) / "weather/harmonie-2026091312-6h-v1-0a0b0c0d"
                      / "spots/n54w008.json")
            self.assertEqual(json.loads(square.read_text()), {"square": "n54w008"})
            self.assertFalse((Path(directory) / MANIFESTS["tides"]).exists())


if __name__ == "__main__":
    unittest.main()
