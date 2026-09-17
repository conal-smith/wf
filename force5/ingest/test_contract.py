"""Fake bundles for the optional manifest extensions, kind by kind.

Wave, weather, ensemble and instantaneous-gust bundles are validated here, so an
adapter that publishes one can rely on a settled contract.
"""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import f5bin
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

    # --- weather ---------------------------------------------------------
    def weather_bundle(self, kind="weather", **changes):
        """A surface-variables bundle: hectopascals, nulls and a code table."""
        self.register("fake-weather", "weather/fake-weather.json", kind)
        grid = {"width": 2, "height": 2}
        variables = {
            "t2m": {"units": "°C", "label": "Air temperature",
                    "description": "Air temperature 2 m above ground"},
            "pmsl": {"units": "hPa", "label": "Pressure (MSL)",
                     "description": "Pressure reduced to mean sea level"},
            "ww": {"units": "WMO code", "label": "Present weather", "kind": "code",
                   "description": "WMO present-weather interpretation code"},
        }
        frames, series = [], {"brandon": []}
        for hour in (0, 1, 2):
            url = f"weather/run/{hour}.json"
            frames.append({"hour": hour, "validTime": valid(hour), "url": url})
            (self.root / url).write_text(json.dumps({"model": "fake-weather", "run": "2026091312",
                "hour": hour, "validTime": valid(hour), "grid": grid,
                # Null is an hour with no interval or a cell with no value, never zero.
                "t2m": [14.2, 13.9, None, 12.0], "pmsl": [1013.2, 1013.0, 1012.8, 1014.1],
                "ww": [0, 45, 61, 95]}))
            series["brandon"].append({"hour": hour, "validTime": valid(hour),
                                      "values": {"t2m": 14.0, "pmsl": 1013.1, "ww": 45}})
        return self.save("fake-weather", {**self.identity("fake-weather", kind), "grid": grid,
                                          "variables": variables, "frames": frames,
                                          "spotSeries": series, **changes})

    def test_weather_bundles_carry_hectopascals_and_whole_weather_codes(self):
        self.weather_bundle()
        manifest, _, objects = validate_bundle(self.root, "fake-weather", now=NOW)
        self.assertEqual(len(objects), 3)
        self.assertEqual(manifest["kind"], "weather")
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root, "fake-weather", "test", now=NOW), "published")
        self.assertEqual(s3.writes[-1], "weather/fake-weather.json")

    def test_weather_rejects_fractional_codes_and_unknown_variable_kinds(self):
        manifest = self.weather_bundle()
        frame = self.root / "weather/run/1.json"
        original = json.loads(frame.read_text())
        cases = [
            # A code table has no half-codes and no out-of-table entries.
            ({}, {"ww": [0, 45.5, 61, 95]}),
            ({}, {"ww": [0, 45, 61, 1000]}),
            ({}, {"ww": [0, 45, 61, True]}),
            ({}, {"pmsl": [1013.2, 1013.0, 1012.8, "1014.1"]}),
            ({"variables": {**manifest["variables"],
                            "ww": {**manifest["variables"]["ww"], "kind": "flag"}}}, None),
            ({"spotSeries": {"brandon": [{"hour": hour, "validTime": valid(hour),
                                          "values": {"t2m": 14.0, "pmsl": 1013.1, "ww": 45.5}}
                                         for hour in (0, 1, 2)]}}, None),
        ]
        for change, frame_change in cases:
            with self.subTest(change=sorted(change), frame=frame_change):
                self.save("fake-weather", {**manifest, **change})
                frame.write_text(json.dumps({**original, **(frame_change or {})}))
                with self.assertRaises(ValueError):
                    validate_bundle(self.root, "fake-weather", now=NOW)
        frame.write_text(json.dumps(original))

    def test_a_wave_bundle_still_refuses_a_weather_sized_measurement(self):
        """Waves are metres and seconds: the same 1013 hPa field is out of range."""
        self.weather_bundle(kind="wave")
        with self.assertRaises(ValueError):
            validate_bundle(self.root, "fake-weather", now=NOW)

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
                                     "gust": [11.0] * members} for hour in hours]
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

    # --- binary wind frames ------------------------------------------------
    GRID = {"width": 2, "height": 2}

    def binary_frame(self, hour, **changes):
        """The bytes one `weather/run/H.bin` holds, with room to spoil them."""
        payload = {"model": "fake-bin", "run": "2026091312", "hour": hour,
                   "grid": self.GRID, "u": [1.5] * 4, "v": [-2.5] * 4, "gust": [9.0] * 4}
        payload.update(changes)
        return f5bin.encode_frame(payload)

    def binary_bundle(self, **changes):
        """A wind bundle whose frames are F5 int16 rather than JSON."""
        self.register("fake-bin", "weather/fake-bin.json", "wind")
        frames = []
        for hour in (0, 1, 2):
            url = f"weather/run/{hour}.bin"
            frames.append({"hour": hour, "validTime": valid(hour), "url": url,
                           "gustIntervalHours": [max(hour - 1, 0), hour]})
            (self.root / url).write_bytes(self.binary_frame(hour))
        manifest = {**self.identity("fake-bin", "wind"), "grid": self.GRID,
                    "encoding": f5bin.ENCODING, "frames": frames,
                    "gustAvailable": True, "spotForecasts": {}}
        return self.save("fake-bin", {**manifest, **changes})

    def test_a_binary_wind_bundle_validates_and_publishes_its_frames(self):
        self.binary_bundle()
        manifest, _, objects = validate_bundle(self.root, "fake-bin", now=NOW)
        self.assertEqual(manifest["encoding"], f5bin.ENCODING)
        self.assertEqual([path for path, _ in objects],
                         ["weather/run/0.bin", "weather/run/1.bin", "weather/run/2.bin"])
        # The bytes uploaded are the frame's own, uncompressed: compression is the
        # uploader's business and the sidecars are never objects of their own.
        self.assertEqual(objects[0][1], (self.root / "weather/run/0.bin").read_bytes())
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root, "fake-bin", "test", now=NOW), "published")
        self.assertEqual(s3.writes[-1], "weather/fake-bin.json")
        self.assertEqual(len(s3.writes), 5)  # three frames, the archive, the pointer

    def test_a_binary_frame_from_the_wrong_run_or_hour_is_refused(self):
        """The header is what makes this catchable; the file name alone is not."""
        self.binary_bundle()
        frame = self.root / "weather/run/1.bin"
        for change in ({"hour": 9}, {"hour": 0}, {"run": "2026091300"},
                       {"run": "2026091313"}):
            with self.subTest(**change):
                frame.write_bytes(self.binary_frame(**{"hour": 1, **change}))
                with self.assertRaises(ValueError):
                    validate_bundle(self.root, "fake-bin", now=NOW)

    def test_a_binary_frame_of_the_wrong_size_or_shape_is_refused(self):
        self.binary_bundle()
        frame = self.root / "weather/run/1.bin"
        whole = self.binary_frame(1)
        cases = {
            "wider grid": self.binary_frame(1, grid={"width": 4, "height": 2},
                                            u=[1.5] * 8, v=[-2.5] * 8, gust=[9.0] * 8),
            "taller grid": self.binary_frame(1, grid={"width": 2, "height": 4},
                                             u=[1.5] * 8, v=[-2.5] * 8, gust=[9.0] * 8),
            "truncated": whole[:-2],
            "oversized": whole + b"\0\0",
            "header only": whole[:f5bin.HEADER_BYTES],
            "not a frame": b"{\"model\": \"fake-bin\"}",
        }
        for name, body in cases.items():
            with self.subTest(name):
                frame.write_bytes(body)
                with self.assertRaises(ValueError):
                    validate_bundle(self.root, "fake-bin", now=NOW)

    def test_a_binary_bundle_keeps_every_gust_rule(self):
        # A gust block where the manifest declares none.
        self.binary_bundle(gustAvailable=False,
                           frames=[{"hour": hour, "validTime": valid(hour),
                                    "url": f"weather/run/{hour}.bin",
                                    "gustIntervalHours": None} for hour in (0, 1, 2)])
        with self.assertRaises(ValueError):
            validate_bundle(self.root, "fake-bin", now=NOW)
        # The same bundle with the gust block actually absent is fine.
        for hour in (0, 1, 2):
            (self.root / f"weather/run/{hour}.bin").write_bytes(
                self.binary_frame(hour, gust=None))
        self.assertEqual(len(validate_bundle(self.root, "fake-bin", now=NOW)[2]), 3)
        # And a missing gust block where the manifest promises one is refused.
        self.binary_bundle()
        (self.root / "weather/run/1.bin").write_bytes(self.binary_frame(1, gust=None))
        with self.assertRaises(ValueError):
            validate_bundle(self.root, "fake-bin", now=NOW)

    def test_an_implausible_value_inside_a_binary_frame_is_refused(self):
        """Hand-built bytes, because the encoder refuses to write these at all."""
        self.binary_bundle()
        frame = self.root / "weather/run/1.bin"
        for offset, value in [(0, 1501), (4 * 2, -1501), (8 * 2, -1)]:
            with self.subTest(offset=offset):
                body = bytearray(self.binary_frame(1))
                body[f5bin.HEADER_BYTES + offset:f5bin.HEADER_BYTES + offset + 2] = (
                    int(value).to_bytes(2, "little", signed=True))
                frame.write_bytes(bytes(body))
                with self.assertRaises(ValueError):
                    validate_bundle(self.root, "fake-bin", now=NOW)

    def test_an_unknown_encoding_is_refused_rather_than_read_as_json(self):
        self.binary_bundle(encoding="f5-int16-v2")
        with self.assertRaises(ValueError):
            validate_bundle(self.root, "fake-bin", now=NOW)

    def test_only_wind_frames_may_declare_a_binary_encoding(self):
        manifest = self.wave_bundle()
        self.save("fake-wave", {**manifest, "encoding": f5bin.ENCODING})
        with self.assertRaises(ValueError):
            validate_bundle(self.root, "fake-wave", now=NOW)

    def test_registry_kind_must_match_the_manifest(self):
        self.wave_bundle()
        publish_s3.MODELS["fake-wave"]["kind"] = "wind"
        self.addCleanup(publish_s3.MODELS["fake-wave"].__setitem__, "kind", "wave")
        with self.assertRaises(ValueError):
            validate_bundle(self.root, "fake-wave", now=NOW)


if __name__ == "__main__":
    unittest.main()
