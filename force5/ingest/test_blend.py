"""The blend job: what it reads from the bucket, and what the publisher accepts of it.

The blend is published as a run, as the models are (docs/TILING_DESIGN.md,
decision 6): the pointer weather/blend.json carries its times, the models it
read and its spot squares, and each place's series is `spotBlend` in its
square of a run directory named for its content. In production the run is
written by force5/blend/build.ts through scripts/runs.mjs; here by rundir.py,
which both are held to (tests/fixtures/run-digest.json).
"""
import gzip
import json
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest

import fetch_blend
from prune import prune_published, referenced, read_manifests
from publish_s3 import publish, superseded_objects, validate_bundle
from registry import MANIFESTS, MODELS
from runfixtures import publish_whole, read_whole
from squares import spot_square
from test_publish_s3 import FakeS3

NOW = datetime(2026, 9, 14, 0, 20, tzinfo=timezone.utc)
TIMES = ["2026-09-14T00:00:00Z", "2026-09-14T01:00:00Z", "2026-09-14T03:00:00Z"]
PREFIX = "blend-2026091400-3h-v2"


def blend(**changes):
    """The blend as the job holds it before it is cut into squares."""
    value = {
        "schemaVersion": 2, "kind": "blend", "model": "blend",
        "run": "2026091400", "runTime": "2026-09-14T00:00:00Z",
        "generatedAt": "2026-09-14T00:20:00Z",
        "coverage": {"from": TIMES[0], "to": TIMES[-1]},
        "times": TIMES,
        "sources": [{"id": "harmonie", "name": "HARMONIE", "run": "2026091323",
                     "runTime": "2026-09-13T23:00:00Z", "resolutionKm": 2,
                     "ensemble": False, "weight": 3, "columns": [0, 1, 2]}],
        "spotBlend": {
            "brandon": {"wind": [123, None, 87], "gust": [180, None, None],
                        "from": [270, None, 255], "agreement": "h-m"},
            "dollymount": {"wind": [90, 95, 100], "gust": [140, 150, 160],
                           "from": [200, 210, 220], "agreement": "hhl"},
            "rossnowlagh": {"wind": [None, None, None], "gust": [None, None, None],
                            "from": [None, None, None], "agreement": "---"},
        },
    }
    value.update(changes)
    return value


class BlendRunTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.public = Path(self.directory.name)
        self.weather = self.public / "weather"
        self.weather.mkdir()

    def tearDown(self):
        self.directory.cleanup()

    def publish(self, whole):
        return publish_whole(self.weather, "blend.json", whole, prefix=PREFIX)

    def check(self, whole=None):
        if whole is not None:
            self.publish(whole)
        return validate_bundle(self.public, "blend", MODELS["blend"]["maxAgeHours"], now=NOW)

    def test_a_blend_is_a_pointer_and_one_square_per_place(self):
        pointer = self.publish(blend())
        self.assertNotIn("spotBlend", pointer)
        self.assertRegex(pointer["base"], rf"^{PREFIX}-[0-9a-f]{{8}}/$")
        self.assertEqual(pointer["spots"]["keys"], ["spotBlend"])
        self.assertEqual(pointer["spots"]["squares"], ["n52w008", "n52w012", "n54w010"])
        manifest, _, objects = self.check()
        self.assertEqual(manifest["run"], "2026091400")
        self.assertEqual([path for path, _ in objects],
                         [f"weather/{pointer['base']}spots/{square}.json"
                          for square in pointer["spots"]["squares"]])
        for path, data in objects:
            square = json.loads(data)
            self.assertEqual(set(square), {"schemaVersion", "model", "run", "square", "spotBlend"})
            for place in square["spotBlend"]:
                spot = {"brandon": (52.276, -10.024), "dollymount": (53.365, -6.135),
                        "rossnowlagh": (54.551, -8.2)}[place]
                self.assertEqual(spot_square(*spot), square["square"])

    def test_merging_every_square_gives_back_exactly_the_places_split(self):
        self.publish(blend())
        self.assertEqual(read_whole(self.weather / "blend.json")["spotBlend"],
                         blend()["spotBlend"])

    def test_refuses_a_blend_that_does_not_hold_together(self):
        short = blend()
        short["spotBlend"]["brandon"]["wind"] = [123, None]
        unordered = blend(times=[TIMES[1], TIMES[0], TIMES[2]])
        unordered["coverage"] = {"from": TIMES[1], "to": TIMES[2]}
        bad_column = blend()
        bad_column["sources"][0]["columns"] = [0, 3]
        bad_letter = blend()
        bad_letter["spotBlend"]["brandon"]["agreement"] = "h?m"
        too_fast = blend()
        too_fast["spotBlend"]["dollymount"]["gust"] = [140, 150, 2001]
        with_models = blend(spotForecasts={"brandon": [{"hour": 0}]})
        for name, manifest in {"a short series": short, "unordered times": unordered,
                               "a column past the end": bad_column,
                               "an unknown agreement": bad_letter,
                               "a gust past the limit": too_fast,
                               "a model's series beside the blend": with_models,
                               "no places": blend(spotBlend={}),
                               "an old blend": blend(run="2026091318",
                                                     runTime="2026-09-13T18:00:00Z")}.items():
            with self.subTest(name), self.assertRaises(ValueError):
                self.check(manifest)

    def test_refuses_the_old_one_file_blend(self):
        old = blend(schemaVersion=1)
        old["spots"] = old.pop("spotBlend")
        (self.weather / "blend.json").write_text(json.dumps(old))
        with self.assertRaisesRegex(ValueError, "schemaVersion 2"):
            self.check()

    def test_refuses_a_square_changed_after_it_was_named(self):
        pointer = self.publish(blend())
        square = self.weather / pointer["base"] / "spots" / "n52w008.json"
        square.write_text(square.read_text().replace("90", "91", 1))
        with self.assertRaisesRegex(ValueError, "content its name claims"):
            self.check()

    def test_the_pruner_keeps_the_served_run_and_drops_the_one_it_replaced(self):
        first = self.publish(blend())
        second = self.publish(blend(run="2026091401", runTime="2026-09-14T01:00:00Z"))
        self.assertNotEqual(first["base"], second["base"])
        _, directories = referenced(read_manifests(self.public))
        self.assertIn(f"weather/{second['base'][:-1]}", directories)
        removed = prune_published(self.public, 0)["removed"]
        self.assertEqual(removed, [f"weather/{first['base'][:-1]}"])
        self.assertTrue((self.weather / second["base"]).is_dir())

    def test_publishing_uploads_the_squares_then_the_pointer_and_deletes_the_last_run(self):
        s3 = FakeS3()
        first = self.publish(blend())
        self.assertEqual(publish(s3, self.public, "blend", "test", max_age_hours=3, now=NOW),
                         "published")
        self.assertEqual(s3.writes[-1], "weather/blend.json")
        self.assertTrue(all(key.startswith(f"weather/{first['base']}spots/")
                            for key in s3.writes[:-1]))
        later = datetime(2026, 9, 14, 1, 20, tzinfo=timezone.utc)
        second = self.publish(blend(run="2026091401", runTime="2026-09-14T01:00:00Z",
                                    generatedAt="2026-09-14T01:20:00Z"))
        self.assertEqual(superseded_objects("blend", first, second),
                         ([f"weather/{first['base'][:-1]}"], []))
        self.assertEqual(publish(s3, self.public, "blend", "test", max_age_hours=3, now=later),
                         "published")
        self.assertFalse([key for key in s3.objects if key.startswith(f"weather/{first['base']}")])
        self.assertTrue([key for key in s3.objects if key.startswith(f"weather/{second['base']}")])


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
        # The blend's own pointer is not a wind model's: it is never read back.
        s3.seed("forecast/" + MANIFESTS["blend"], json.dumps(pointer("blend", [])).encode())
        with tempfile.TemporaryDirectory() as directory:
            found = fetch_blend.read_bucket(s3, "bucket", "forecast", Path(directory))
            self.assertEqual(sorted(found), ["ecmwf", "harmonie"])
            self.assertEqual(json.loads((Path(directory) / MANIFESTS["ecmwf"]).read_text()),
                             pointer("ecmwf", ["n52w010"]))
            square = (Path(directory) / "weather/harmonie-2026091312-6h-v1-0a0b0c0d"
                      / "spots/n54w008.json")
            self.assertEqual(json.loads(square.read_text()), {"square": "n54w008"})
            self.assertFalse((Path(directory) / MANIFESTS["tides"]).exists())
            self.assertFalse((Path(directory) / MANIFESTS["blend"]).exists())


if __name__ == "__main__":
    unittest.main()
