"""Fake bundles for the optional manifest extensions, kind by kind.

Wave, weather, ensemble and instantaneous-gust bundles are validated here, so an
adapter that publishes one can rely on a settled contract.
"""
import ast
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path, PurePosixPath
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

    def register(self, model, manifest_path, kind):
        """A later agent adds one registry line; the tests add the same line temporarily.

        Registering also makes the run directory, named for the model: the
        publisher requires every referenced object to sit under a directory its
        own model owns, exactly as every real adapter names them, so a shared
        `weather/run/` would now be refused as belonging to nobody.
        """
        entry = {"script": "unused.py", "manifest": manifest_path, "kind": kind, "maxAgeHours": 12}
        for target, value in [(MODELS, entry), (MANIFESTS, manifest_path)]:
            patcher = patch.dict(target, {model: value})
            patcher.start()
            self.addCleanup(patcher.stop)
        self.run_directory = f"weather/{model}-run"
        (self.root / self.run_directory).mkdir(parents=True, exist_ok=True)
        return self.run_directory

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
            url = f"{self.run_directory}/{hour}.json"
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
        frame = self.root / f"{self.run_directory}/1.json"
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
        for path in sorted((self.root / self.run_directory).glob("*.json")):
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
            url = f"{self.run_directory}/{hour}.json"
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
        frame = self.root / f"{self.run_directory}/1.json"
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
            url = f"{self.run_directory}/{hour}.json"
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
        """The bytes one published frame holds, with room to spoil them."""
        payload = {"model": "fake-bin", "run": "2026091312", "hour": hour,
                   "grid": self.GRID, "u": [1.5] * 4, "v": [-2.5] * 4, "gust": [9.0] * 4}
        payload.update(changes)
        return f5bin.encode_frame(payload)

    def binary_bundle(self, gusts=True, **changes):
        """A wind bundle whose frames are F5 int16 rather than JSON.

        Frames are content-addressed, exactly as `publish_frame` writes them, so
        that the validator's name check is exercised by the ordinary case as well
        as by the test that attacks it.
        """
        self.register("fake-bin", "weather/fake-bin.json", "wind")
        frames = []
        for hour in (0, 1, 2):
            data = self.binary_frame(hour, **({} if gusts else {"gust": None}))
            url = f"{self.run_directory}/{f5bin.basename(hour, data)}"
            frames.append({"hour": hour, "validTime": valid(hour), "url": url,
                           "gustIntervalHours": [max(hour - 1, 0), hour] if gusts else None})
            (self.root / url).write_bytes(data)
        manifest = {**self.identity("fake-bin", "wind"), "grid": self.GRID,
                    "encoding": f5bin.ENCODING, "frames": frames,
                    "gustAvailable": gusts, "spotForecasts": {}}
        self.manifest = self.save("fake-bin", {**manifest, **changes})
        return self.manifest

    def rewrite(self, index, data):
        """Replace one published frame, keeping the name content-addressed.

        The manifest is updated to the new name, so the validator's name check is
        satisfied and whatever the test is really attacking is what fails. A test
        that wants the name check itself keeps the old name instead.
        """
        info = self.manifest["frames"][index]
        (self.root / info["url"]).unlink()
        info["url"] = f"{self.run_directory}/{f5bin.basename(info['hour'], data)}"
        (self.root / info["url"]).write_bytes(data)
        self.save("fake-bin", self.manifest)
        return self.root / info["url"]

    def test_a_binary_wind_bundle_validates_and_publishes_its_frames(self):
        manifest = self.binary_bundle()
        published, _, objects = validate_bundle(self.root, "fake-bin", now=NOW)
        self.assertEqual(published["encoding"], f5bin.ENCODING)
        self.assertEqual([path for path, _ in objects],
                         [frame["url"] for frame in manifest["frames"]])
        # The bytes uploaded are the frame's own, uncompressed: compression is the
        # uploader's business and the sidecars are never objects of their own.
        self.assertEqual(objects[0][1], (self.root / manifest["frames"][0]["url"]).read_bytes())
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root, "fake-bin", "test", now=NOW), "published")
        self.assertEqual(s3.writes[-1], "weather/fake-bin.json")
        self.assertEqual(len(s3.writes), 5)  # three frames, the archive, the pointer

    def test_a_binary_frame_from_the_wrong_run_or_hour_is_refused(self):
        """The header is what makes this catchable; the file name alone is not."""
        for change in ({"hour": 9}, {"hour": 0}, {"run": "2026091300"},
                       {"run": "2026091313"}):
            with self.subTest(**change):
                self.binary_bundle()
                self.rewrite(1, self.binary_frame(**{"hour": 1, **change}))
                with self.assertRaises(ValueError) as caught:
                    validate_bundle(self.root, "fake-bin", now=NOW)
                self.assertIn("Mixed model/run/frame metadata", str(caught.exception))

    def test_a_frame_under_another_models_run_directory_is_refused(self):
        """The model is not in the file, so the path is what has to carry it.

        Every wind model's objects live under `weather/`, so without this a
        HARMONIE manifest could reference a GFS run's frames with the same run,
        hour and grid and be accepted — and GFS's next publish would then delete
        objects a live HARMONIE pointer still pointed at.
        """
        manifest = self.binary_bundle()
        foreign = self.root / "weather/fake-other-run"
        foreign.mkdir(parents=True)
        for frame in manifest["frames"]:
            moved = f"weather/fake-other-run/{PurePosixPath(frame['url']).name}"
            (self.root / moved).write_bytes((self.root / frame["url"]).read_bytes())
            frame["url"] = moved
        self.save("fake-bin", manifest)
        with self.assertRaises(ValueError) as caught:
            validate_bundle(self.root, "fake-bin", now=NOW)
        self.assertIn("is not named for fake-bin", str(caught.exception))

    def test_a_frame_whose_name_is_not_its_content_hash_is_refused(self):
        """A content-addressed name is checkable; a JSON frame's never was.

        The substituted frame carries the right run, hour and grid, so every
        header check passes and only the name is left to catch it — which is the
        case that matters, because a frame silently swapped for another of the
        same shape is exactly what a hash is supposed to notice.
        """
        manifest = self.binary_bundle()
        published = self.root / manifest["frames"][1]["url"]
        published.write_bytes(self.binary_frame(1, u=[7.5] * 4))
        with self.assertRaises(ValueError) as caught:
            validate_bundle(self.root, "fake-bin", now=NOW)
        self.assertIn("does not hold the frame its name claims", str(caught.exception))

    def test_a_binary_frame_of_the_wrong_size_or_shape_is_refused(self):
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
            "reserved bytes used": whole[:18] + b"\1" + whole[19:],
        }
        for name, body in cases.items():
            with self.subTest(name):
                self.binary_bundle()
                self.rewrite(1, body)
                with self.assertRaises(ValueError):
                    validate_bundle(self.root, "fake-bin", now=NOW)

    def test_a_binary_bundle_keeps_every_gust_rule(self):
        # A gust block where the manifest declares none.
        self.binary_bundle(gusts=False)
        for index in (0, 1, 2):
            self.rewrite(index, self.binary_frame(index))
        with self.assertRaises(ValueError) as caught:
            validate_bundle(self.root, "fake-bin", now=NOW)
        self.assertIn("Gust block does not match", str(caught.exception))
        # The same bundle with the gust block actually absent is fine.
        self.binary_bundle(gusts=False)
        self.assertEqual(len(validate_bundle(self.root, "fake-bin", now=NOW)[2]), 3)
        # And a missing gust block where the manifest promises one is refused.
        self.binary_bundle()
        self.rewrite(1, self.binary_frame(1, gust=None))
        with self.assertRaises(ValueError) as caught:
            validate_bundle(self.root, "fake-bin", now=NOW)
        self.assertIn("Gust block does not match", str(caught.exception))

    def test_an_implausible_value_inside_a_binary_frame_is_refused(self):
        """Hand-built bytes, because the encoder refuses to write these at all."""
        for offset, value in [(0, 1501), (4 * 2, -1501), (8 * 2, -1)]:
            with self.subTest(offset=offset):
                self.binary_bundle()
                body = bytearray(self.binary_frame(1))
                body[f5bin.HEADER_BYTES + offset:f5bin.HEADER_BYTES + offset + 2] = (
                    int(value).to_bytes(2, "little", signed=True))
                self.rewrite(1, bytes(body))
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


class PublishedRunContractTests(unittest.TestCase):
    """`readsPublishedRun` and the adapter's own code must say the same thing.

    The worker reads exit 3 as "nothing new" only from an adapter the registry says
    implements the contract. A flag without the code wastes a bucket read; code
    without the flag is worse, because its "nothing new" becomes a failed job.
    Each adapter's test module checks the behaviour; this checks the agreement,
    from the source, so that a new adapter cannot forget either half.
    """

    HERE = Path(__file__).resolve().parent
    CHECKS = {"published_in_bucket", "already_published"}

    def local_imports(self, tree):
        names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                names.add(node.module)
        return {name for name in names if (self.HERE / f"{name}.py").exists()}

    def implements(self, script):
        """Whether the script, or a shared helper it runs, checks the published run.

        Helpers that are not themselves registered scripts count (`meteofrance.py`
        runs ARPEGE and AROME); another model's script does not, because importing
        `fetch_gfs` for its decoder says nothing about this model's own exit.
        """
        scripts = {entry["script"] for entry in MODELS.values()}
        tree = ast.parse((self.HERE / script).read_text())
        sources = [tree] + [ast.parse((self.HERE / f"{name}.py").read_text())
                            for name in self.local_imports(tree) if f"{name}.py" not in scripts]
        calls = {node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, "attr", None)
                 for source in sources for node in ast.walk(source) if isinstance(node, ast.Call)}
        names = {node.id for source in sources for node in ast.walk(source) if isinstance(node, ast.Name)}
        return bool(calls & self.CHECKS) and "UNCHANGED_EXIT" in names

    def test_the_registry_flag_and_the_adapter_agree(self):
        for model, entry in MODELS.items():
            with self.subTest(model=model):
                self.assertEqual(bool(entry.get("readsPublishedRun")), self.implements(entry["script"]))

    def test_every_forecast_skips_a_published_run(self):
        # Tides and observations have no provider run to compare; see the registry.
        # The blend is not a forecast: its run is the hour it was worked out.
        self.assertEqual(sorted(model for model, entry in MODELS.items()
                                if not entry.get("readsPublishedRun")),
                         ["blend", "sea-temperature", "tides"])


if __name__ == "__main__":
    unittest.main()
