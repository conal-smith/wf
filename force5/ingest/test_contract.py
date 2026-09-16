"""Fake bundles for the optional manifest extensions no adapter emits yet.

Wave, ensemble and instantaneous-gust models are validated here so the adapters
that will produce them can rely on a settled contract.
"""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import publish_s3
from publish_s3 import publish, validate_bundle
from registry import MANIFESTS, MODELS
from test_publish_s3 import FakeS3

RUN = datetime(2026, 9, 13, 12, tzinfo=timezone.utc)
NOW = RUN + timedelta(hours=1)


def valid(hour):
    return (RUN + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "weather/run").mkdir(parents=True)

    def register(self, model, manifest_path, kind):
        """A later agent adds one registry line; the tests add the same line temporarily."""
        entry = {"script": "unused.py", "manifest": manifest_path, "kind": kind, "maxAgeHours": 12}
        for target, value in [(MODELS, entry), (MANIFESTS, manifest_path)]:
            patcher = patch.dict(target, {model: value})
            patcher.start()
            self.addCleanup(patcher.stop)

    def save(self, model, manifest):
        (self.root / MANIFESTS[model]).write_text(json.dumps(manifest))
        return manifest

    def identity(self, model, kind):
        return {"schemaVersion": 1, "kind": kind, "model": model, "run": "2026091312",
                "runTime": valid(0), "generatedAt": NOW.isoformat(), "stepHours": 1}

    # --- wave ------------------------------------------------------------
    def wave_bundle(self, hours=(0, 1, 2)):
        self.register("fake-wave", "weather/fake-wave.json", "wave")
        grid = {"width": 2, "height": 2}
        variables = {"swh": {"units": "m", "label": "Wave height",
                             "description": "Significant height of combined wind waves and swell"},
                     "mwp": {"units": "s", "label": "Wave period", "description": "Mean wave period"}}
        frames, series = [], {"brandon": []}
        for hour in hours:
            url = f"weather/run/{hour}.json"
            frames.append({"hour": hour, "validTime": valid(hour), "url": url})
            # Null is land or an unresolved cell; it is never filled with zero.
            (self.root / url).write_text(json.dumps({"model": "fake-wave", "run": "2026091312",
                "hour": hour, "validTime": valid(hour), "grid": grid,
                "swh": [1.2, 2.5, None, 0.4], "mwp": [7.1, 8.0, None, 6.2]}))
            series["brandon"].append({"hour": hour, "validTime": valid(hour),
                                      "values": {"swh": 1.9, "mwp": 7.5}})
        return self.save("fake-wave", {**self.identity("fake-wave", "wave"), "grid": grid,
                                       "variables": variables, "frames": frames, "spotSeries": series,
                                       "sourceUrl": "https://example.invalid/wave",
                                       "attribution": "Fake wave source", "licenseUrl": "https://example.invalid/"})

    def test_wave_bundle_validates_and_publishes_frames_before_the_pointer(self):
        self.wave_bundle()
        manifest, _, objects = validate_bundle(self.root, "fake-wave", now=NOW)
        self.assertEqual(len(objects), 3)
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root, "fake-wave", "test", now=NOW), "published")
        self.assertEqual(s3.writes[-1], "weather/fake-wave.json")
        self.assertIn("weather/manifests/fake-wave/", s3.writes[-2])
        self.assertEqual(manifest["kind"], "wave")

    def test_wave_rejects_undescribed_variables_and_bad_fields(self):
        manifest = self.wave_bundle()
        frame = self.root / "weather/run/1.json"
        original = json.loads(frame.read_text())
        cases = [
            ({"variables": {"swh": {"units": "m", "label": "Wave height"}}}, None),
            ({"variables": {**manifest["variables"], "SWH": manifest["variables"]["swh"]}}, None),
            ({"spotSeries": {"brandon": [{"hour": 0, "validTime": valid(0), "values": {"swh": 1.0}}]}}, None),
            ({"spotSeries": {}}, None),
            ({}, {"swh": [1.2, 2.5, None]}),
            ({}, {"mwp": [1.2, 2.5, None, float("inf")]}),
            ({}, {"hour": 9}),
        ]
        for change, frame_change in cases:
            with self.subTest(change=change, frame=frame_change):
                self.save("fake-wave", {**manifest, **change})
                frame.write_text(json.dumps({**original, **(frame_change or {})}))
                s3 = FakeS3()
                with self.assertRaises(ValueError):
                    publish(s3, self.root, "fake-wave", "test", now=NOW)
                self.assertEqual(s3.writes, [])
        frame.write_text(json.dumps(original))

    def test_wave_frames_are_optional_when_a_spot_series_is_published(self):
        manifest = self.wave_bundle()
        self.save("fake-wave", {**manifest, "frames": [], "horizonHours": 2})
        published, _, objects = validate_bundle(self.root, "fake-wave", now=NOW)
        self.assertEqual(objects, [])
        self.assertEqual(len(published["spotSeries"]["brandon"]), 3)
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root, "fake-wave", "test", now=NOW), "published")
        self.assertEqual(len(s3.writes), 2)  # The archived manifest, then the pointer.

    def test_a_frameless_wave_bundle_declares_a_horizon_its_series_covers(self):
        manifest = self.wave_bundle()
        cases = [{"frames": []},  # No declared horizon at all.
                 {"frames": [], "horizonHours": 3},  # A horizon the series stops short of.
                 {"frames": [], "horizonHours": 2, "spotSeries": {}},
                 {"horizonHours": 5}]  # Disagrees with the published frame list.
        for change in cases:
            with self.subTest(change=sorted(change)), self.assertRaises(ValueError):
                self.save("fake-wave", {**manifest, **change})
                validate_bundle(self.root, "fake-wave", now=NOW)

    def test_frames_may_carry_a_declared_subset_of_the_wave_variables(self):
        manifest = self.wave_bundle()
        for path in sorted((self.root / "weather/run").glob("*.json")):
            frame = json.loads(path.read_text())
            path.write_text(json.dumps({k: v for k, v in frame.items() if k != "mwp"}))
        with self.assertRaises(ValueError):  # Every declared variable is gridded by default.
            validate_bundle(self.root, "fake-wave", now=NOW)
        self.save("fake-wave", {**manifest, "frameVariables": ["swh"]})
        self.assertEqual(len(validate_bundle(self.root, "fake-wave", now=NOW)[2]), 3)
        for narrowing in ([], ["swh", "swh"], ["swh", "gust"], "swh"):
            with self.subTest(narrowing=narrowing), self.assertRaises(ValueError):
                self.save("fake-wave", {**manifest, "frameVariables": narrowing})
                validate_bundle(self.root, "fake-wave", now=NOW)

    def test_wave_horizon_must_not_have_expired(self):
        self.wave_bundle()
        with self.assertRaises(ValueError):
            validate_bundle(self.root, "fake-wave", max_age_hours=48, now=RUN + timedelta(hours=9))

    # --- instantaneous gusts ---------------------------------------------
    def gust_bundle(self, kind, interval):
        self.register("fake-gfs", "weather/fake-gfs.json", "wind")
        grid = {"width": 2, "height": 2}
        frames = []
        for hour in (0, 1, 2):
            url = f"weather/run/{hour}.json"
            window = interval(hour)
            frames.append({"hour": hour, "validTime": valid(hour), "url": url,
                           "gustIntervalHours": window})
            (self.root / url).write_text(json.dumps({"model": "fake-gfs", "run": "2026091312",
                "hour": hour, "validTime": valid(hour), "grid": grid, "gustIntervalHours": window,
                "u": [1] * 4, "v": [2] * 4, "gust": [9] * 4}))
        manifest = {**self.identity("fake-gfs", "wind"), "grid": grid, "frames": frames,
                    "gustAvailable": True, "spotForecasts": {}}
        if kind:
            manifest["gustKind"] = kind
        return self.save("fake-gfs", manifest)

    def test_instantaneous_gusts_carry_a_zero_length_window_at_every_hour(self):
        self.gust_bundle("instantaneous", lambda hour: [hour, hour])
        self.assertEqual(len(validate_bundle(self.root, "fake-gfs", now=NOW)[2]), 3)

    def test_zero_length_windows_need_the_instantaneous_declaration(self):
        for kind in (None, "interval", "period-maximum"):
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                self.gust_bundle(kind, lambda hour: [hour, hour])
                validate_bundle(self.root, "fake-gfs", now=NOW)

    def test_instantaneous_gusts_reject_an_accumulation_window(self):
        self.gust_bundle("instantaneous", lambda hour: [max(hour - 1, 0), hour])
        with self.assertRaises(ValueError):
            validate_bundle(self.root, "fake-gfs", now=NOW)

    def test_interval_gusts_are_unchanged_by_default(self):
        self.gust_bundle(None, lambda hour: [max(hour - 1, 0), hour])
        self.assertEqual(len(validate_bundle(self.root, "fake-gfs", now=NOW)[2]), 3)

    # --- ensembles --------------------------------------------------------
    def ensemble_bundle(self, members=3, **changes):
        self.register("fake-eps", "weather/fake-eps.json", "wind")
        hours = (0, 1, 2)
        spot_members = {"brandon": [{"hour": hour, "validTime": valid(hour),
                                     "u": [4.0 + index] * members, "v": [-2.0] * members,
                                     "gust": [11.0] * (members - 1) + [None]} for hour in hours]
                        for index in [0]}
        means = {"brandon": [{"hour": hour, "validTime": valid(hour), "u": 4.0, "v": -2.0, "gust": 11.0}
                             for hour in hours]}
        manifest = {**self.identity("fake-eps", "wind"), "frames": [],
                    "ensemble": {"members": members, "control": 0,
                                 "description": "Control plus perturbed members"},
                    "spotMembers": spot_members, "spotForecasts": means}
        return self.save("fake-eps", {**manifest, **changes})

    def test_ensemble_without_frames_publishes_only_the_manifest(self):
        self.ensemble_bundle()
        manifest, _, objects = validate_bundle(self.root, "fake-eps", now=NOW)
        self.assertEqual(objects, [])
        self.assertEqual(len(manifest["spotForecasts"]["brandon"]), 3)
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root, "fake-eps", "test", now=NOW), "published")
        self.assertEqual(s3.writes[-1], "weather/fake-eps.json")
        self.assertEqual(len(s3.writes), 2)  # archived manifest, then the pointer

    def test_frames_may_only_be_empty_for_an_ensemble(self):
        manifest = self.ensemble_bundle()
        self.save("fake-eps", {k: v for k, v in manifest.items() if k not in ("ensemble", "spotMembers")})
        with self.assertRaises(ValueError):
            validate_bundle(self.root, "fake-eps", now=NOW)

    def test_member_arrays_must_match_the_declared_membership(self):
        manifest = self.ensemble_bundle()
        broken = [
            {"ensemble": {**manifest["ensemble"], "members": 4}},
            {"ensemble": {**manifest["ensemble"], "control": 3}},
            {"ensemble": {"members": 3, "control": None, "description": "  "}},
            {"spotMembers": {"brandon": [{**manifest["spotMembers"]["brandon"][0], "u": [4.0, 4.0, 999.0]}]
                             + manifest["spotMembers"]["brandon"][1:]}},
            {"spotMembers": {"brandon": [{**manifest["spotMembers"]["brandon"][0], "gust": [-1.0, 1.0, 1.0]}]
                             + manifest["spotMembers"]["brandon"][1:]}},
            {"spotMembers": {"brandon": [{**manifest["spotMembers"]["brandon"][0], "validTime": valid(5)}]
                             + manifest["spotMembers"]["brandon"][1:]}},
            {"spotForecasts": {"brandon": manifest["spotForecasts"]["brandon"][:2]}},
            {"spotForecasts": {}},
        ]
        for change in broken:
            with self.subTest(change=list(change)[0]):
                self.save("fake-eps", {**manifest, **change})
                with self.assertRaises(ValueError):
                    validate_bundle(self.root, "fake-eps", now=NOW)

    def test_ensemble_horizon_must_not_have_expired(self):
        self.ensemble_bundle()
        with self.assertRaises(ValueError):
            validate_bundle(self.root, "fake-eps", max_age_hours=48, now=RUN + timedelta(hours=6))

    def test_registry_kind_must_match_the_manifest(self):
        self.wave_bundle()
        publish_s3.MODELS["fake-wave"]["kind"] = "wind"
        self.addCleanup(publish_s3.MODELS["fake-wave"].__setitem__, "kind", "wave")
        with self.assertRaises(ValueError):
            validate_bundle(self.root, "fake-wave", now=NOW)


if __name__ == "__main__":
    unittest.main()
