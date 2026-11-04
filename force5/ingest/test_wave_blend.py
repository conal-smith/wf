"""The wave blend job: what it reads from the bucket, and what the publisher accepts of it.

Published as a run like the wind blend (test_blend.py): the pointer
weather/wave-blend.json carries its times, the models it read and its spot
squares, and each place's sea state is `spotWaveBlend` in its square. The
arithmetic is src/waveBlend.ts's, tested in src/waveBlend.test.ts.
"""
import contextlib
from datetime import datetime, timezone
import gzip
import io
import json
from pathlib import Path
import tempfile
import unittest

import fetch_wave_blend
from prune import prune_published, read_manifests, referenced
from publish_s3 import validate_bundle
from registry import MANIFESTS, MODELS
from runfixtures import publish_whole, read_whole
from test_publish_s3 import FakeS3

NOW = datetime(2026, 11, 4, 18, 20, tzinfo=timezone.utc)
TIMES = ["2026-11-04T12:00:00Z", "2026-11-04T13:00:00Z", "2026-11-04T15:00:00Z"]
PREFIX = "wave-blend-2026110418-0h-v2"


def wave_blend(**changes):
    """The wave blend as the job holds it before it is cut into squares."""
    value = {
        "schemaVersion": 2, "kind": "wave-blend", "model": "wave-blend",
        "run": "2026110418", "runTime": "2026-11-04T18:00:00Z",
        "generatedAt": "2026-11-04T18:20:00Z",
        "coverage": {"from": TIMES[0], "to": TIMES[-1]},
        "times": TIMES,
        "sources": [
            {"id": "mi-swan", "name": "MI SWAN", "run": "2026110400",
             "runTime": "2026-11-04T00:00:00Z", "resolutionKm": 2, "columns": [0, 1],
             "variables": {"height": "swh", "period": "pp1d", "direction": "mwd"},
             "partitions": ["windsea", "swell"]},
            {"id": "gfs-wave", "name": "GFS-Wave", "run": "2026110406",
             "runTime": "2026-11-04T06:00:00Z", "resolutionKm": 9, "columns": [0, 1, 2],
             "variables": {"height": "swh", "period": "pp1d", "direction": "mwd"},
             "partitions": ["windsea", "swell1"]},
        ],
        "spotWaveBlend": {
            "brandon": {
                "height": [150, 160, 200], "low": [140, 160, 200], "high": [160, 160, 200],
                "period": [95, 100, 110], "from": [355, 0, 270],
                "fed": [3, 1, 2], "count": "211", "lead": "001",
                "parts": {
                    "windsea": {"height": [80, 90, 120], "period": [None, None, 60],
                                "from": [None, None, 250]},
                    "swell": {"height": [120, 130, None], "period": [None, None, None],
                              "from": [None, None, None]},
                    "swell1": {"height": [None, None, 150], "period": [None, None, 120],
                               "from": [None, None, 280]},
                },
            },
            "dollymount": {
                "height": [None, 40, None], "low": [None, 40, None], "high": [None, 40, None],
                "period": [None, 40, None], "from": [None, 90, None],
                "fed": [0, 2, 0], "count": "010", "lead": "-1-", "parts": {},
            },
        },
    }
    value.update(changes)
    return value


class WaveBlendRunTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.public = Path(self.directory.name)
        self.weather = self.public / "weather"
        self.weather.mkdir()

    def tearDown(self):
        self.directory.cleanup()

    def publish(self, whole):
        return publish_whole(self.weather, "wave-blend.json", whole, prefix=PREFIX)

    def check(self, whole=None):
        if whole is not None:
            self.publish(whole)
        return validate_bundle(self.public, "wave-blend",
                               MODELS["wave-blend"]["maxAgeHours"], now=NOW)

    def test_a_wave_blend_is_a_pointer_and_one_square_per_place(self):
        pointer = self.publish(wave_blend())
        self.assertNotIn("spotWaveBlend", pointer)
        self.assertRegex(pointer["base"], rf"^{PREFIX}-[0-9a-f]{{8}}/$")
        self.assertEqual(pointer["spots"]["keys"], ["spotWaveBlend"])
        manifest, _, objects = self.check()
        self.assertEqual(manifest["kind"], "wave-blend")
        self.assertEqual([path for path, _ in objects],
                         [f"weather/{pointer['base']}spots/{square}.json"
                          for square in pointer["spots"]["squares"]])
        self.assertEqual(read_whole(self.weather / "wave-blend.json")["spotWaveBlend"],
                         wave_blend()["spotWaveBlend"])

    def test_refuses_a_wave_blend_that_does_not_hold_together(self):
        def changed(edit):
            value = wave_blend()
            edit(value["spotWaveBlend"]["brandon"])
            return value

        bad_column = wave_blend()
        bad_column["sources"][0]["columns"] = [0, 3]
        unknown_part = wave_blend()
        unknown_part["sources"][1]["partitions"] = ["swell9"]
        cases = {
            "a short series": changed(lambda b: b.update(height=[150, 160])),
            "a height past the limit": changed(lambda b: b.update(height=[150, 160, 3001],
                                                                   high=[160, 160, 3001])),
            "a median outside its range": changed(lambda b: b.update(low=[155, 160, 200])),
            "a count that is not the models that fed": changed(lambda b: b.update(count="111")),
            "a mask past the sources": changed(lambda b: b.update(fed=[3, 1, 4], count="211")),
            "a lead that did not feed the hour": changed(lambda b: b.update(lead="011")),
            "a lead past the sources": changed(lambda b: b.update(lead="002")),
            "a height no model fed": changed(lambda b: b.update(fed=[3, 1, 0], count="210",
                                                                 lead="00-")),
            "an unknown partition": changed(lambda b: b["parts"].update(swell9=b["parts"]["swell"])),
            "a short partition": changed(lambda b: b["parts"]["windsea"].update(height=[80])),
            "a column past the end": bad_column,
            "a source's unknown partition": unknown_part,
            "unordered times": wave_blend(times=[TIMES[1], TIMES[0], TIMES[2]],
                                          coverage={"from": TIMES[1], "to": TIMES[2]}),
            "a model named twice": wave_blend(sources=[wave_blend()["sources"][0]] * 2),
            "a model's series beside it": wave_blend(spotSeries={"brandon": []}),
            "no places": wave_blend(spotWaveBlend={}),
            "an old wave blend": wave_blend(run="2026110412", runTime="2026-11-04T12:00:00Z"),
        }
        for name, manifest in cases.items():
            with self.subTest(name), self.assertRaises(ValueError):
                self.check(manifest)

    def test_the_pruner_keeps_the_served_run_and_drops_the_one_it_replaced(self):
        first = self.publish(wave_blend())
        second = self.publish(wave_blend(run="2026110419", runTime="2026-11-04T19:00:00Z"))
        _, directories = referenced(read_manifests(self.public))
        self.assertIn(f"weather/{second['base'][:-1]}", directories)
        self.assertEqual(prune_published(self.public, 0)["removed"], [])
        removed = prune_published(self.public, 0, grace=0)["removed"]
        self.assertEqual(removed, [f"weather/{first['base'][:-1]}"])

    def test_is_never_taken_for_the_wind_blend(self):
        pointer = self.publish(wave_blend())
        self.assertTrue(pointer["base"].startswith("wave-blend-"))
        (self.weather / "blend.json").write_text((self.weather / "wave-blend.json").read_text())
        with self.assertRaisesRegex(ValueError, "kind does not match"):
            validate_bundle(self.public, "blend", 3, now=NOW)


def pointer(model, squares, run="2026110406"):
    return {"schemaVersion": 2, "model": model, "run": run,
            "base": f"{model}-{run}-6h-v1-0a0b0c0d/",
            "spots": {"squareDegrees": 2, "url": "spots/{square}.json", "squares": squares,
                      "keys": ["spotSeries"]}}


class ReadBucketTests(unittest.TestCase):
    def seed(self, s3, model, squares, run="2026110406"):
        s3.seed("forecast/" + MANIFESTS[model], json.dumps(pointer(model, squares, run)).encode())
        for square in squares:
            key = f"forecast/weather/{model}-{run}-6h-v1-0a0b0c0d/spots/{square}.json"
            s3.objects[key] = {"Body": gzip.compress(json.dumps({"square": square}).encode()),
                               "ContentEncoding": "gzip", "ETag": '"x"'}

    def test_reads_every_current_wave_pointer_and_leaves_out_one_past_its_limit(self):
        s3 = FakeS3()
        self.seed(s3, "gfs-wave", ["n52w010"])
        self.seed(s3, "mi-swan", ["n52w010", "n54w008"], run="2026110400")
        # A retired model's last run, still served: refused before its squares are read.
        self.seed(s3, "ecmwf-wave", ["n52w010"], run="2026101000")
        # The wind models are not the wave blend's.
        self.seed(s3, "harmonie", ["n52w010"])
        with tempfile.TemporaryDirectory() as directory, \
                contextlib.redirect_stdout(io.StringIO()) as log:
            found = fetch_wave_blend.read_bucket(
                s3, "bucket", "forecast", Path(directory),
                models=fetch_wave_blend.wave_models(), now=NOW)
            self.assertEqual(sorted(found), ["gfs-wave", "mi-swan"])
            square = (Path(directory) / "weather/mi-swan-2026110400-6h-v1-0a0b0c0d"
                      / "spots/n54w008.json")
            self.assertEqual(json.loads(square.read_text()), {"square": "n54w008"})
            self.assertFalse((Path(directory) / MANIFESTS["ecmwf-wave"]).exists())
            self.assertFalse((Path(directory) / MANIFESTS["harmonie"]).exists())
        refused = [json.loads(line) for line in log.getvalue().splitlines()]
        self.assertEqual([(event["event"], event["model"]) for event in refused],
                         [("blend_input_refused", "ecmwf-wave")])
        self.assertIn("past its 24 h limit", refused[0]["error"])

    def test_every_wave_model_is_one_the_registry_publishes_as_waves(self):
        self.assertTrue(fetch_wave_blend.wave_models())
        for model in fetch_wave_blend.wave_models():
            self.assertEqual(MODELS[model]["kind"], "wave")
        self.assertNotIn("wave-blend", fetch_wave_blend.wave_models())


if __name__ == "__main__":
    unittest.main()
