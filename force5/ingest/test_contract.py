"""Fake bundles for the optional manifest extensions, kind by kind.

Wave, weather, ensemble and instantaneous-gust bundles are validated here, so an
adapter that publishes one can rely on a settled contract.
"""
import ast
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import f5bin
import f5tile
import publish_s3
from publish_s3 import publish, validate_bundle
from registry import MANIFESTS, MODELS
import rundir
from runfixtures import TINY_GRID, wind_payload
from test_publish_s3 import FakeS3

RUN = datetime(2026, 9, 13, 12, tzinfo=timezone.utc)
NOW = RUN + timedelta(hours=1)
SPOTS = [{"id": "brandon", "lat": 52.276, "lon": -10.024}]


def valid(hour):
    return (RUN + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def register(self, model, manifest_path, kind):
        """A later agent adds one registry line; the tests add the same line temporarily.

        The tests write their frames into `weather/<model>-run/`, where they can
        spoil them, and `save` publishes them as an adapter would: copied into a
        run directory named for the model (the publisher refuses any other) and
        finished by `rundir.write_run`.
        """
        entry = {"script": "unused.py", "manifest": manifest_path, "kind": kind, "maxAgeHours": 12}
        for target, value in [(MODELS, entry), (MANIFESTS, manifest_path)]:
            patcher = patch.dict(target, {model: value})
            patcher.start()
            self.addCleanup(patcher.stop)
        self.run_directory = f"weather/{model}-run"
        self.prefix = f"{model}-2026091312-2h-v1"
        (self.root / self.run_directory).mkdir(parents=True, exist_ok=True)
        return self.run_directory

    def save(self, model, manifest, spoil=None):
        """Publish a whole manifest, as an adapter holds it, from the tests' own frames.

        A wind frame is published as its tiles (f5bin.publish_frame), from the
        grids in the test's frame file. `spoil(staging)` may then change the
        staged files before the run is finished and named for its content, so
        whatever it breaks is what the validator has to catch.
        """
        staging = self.root / "weather" / self.prefix
        shutil.rmtree(staging, ignore_errors=True)
        wind = manifest.get("kind", "wind") == "wind"
        frames = []
        for info in manifest.get("frames") or []:
            if wind:
                f5bin.publish_frame(self.root / "weather", self.prefix,
                                    wind_payload(self.root / info["url"], manifest, info))
                frames.append({key: value for key, value in info.items() if key != "url"})
                continue
            name = rundir.frame_name(self.prefix, info["hour"], "json")
            (staging / "frames").mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.root / info["url"], self.root / "weather" / name)
            frames.append({**info, "url": f"weather/{name}"})
        if spoil:
            spoil(staging)
        self.pointer = rundir.write_run(self.root / "weather", Path(MANIFESTS[model]).name,
                                        {**manifest, "frames": frames}, self.prefix, SPOTS)
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
        self.assertEqual(len(objects), 4)  # Three frames and one spot square.
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root, "fake-wave", "test", now=NOW), "published")
        self.assertEqual(s3.writes[-1], "weather/fake-wave.json")
        self.assertEqual(manifest["kind"], "wave")
        self.assertNotIn("spotSeries", manifest)

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
                frame.write_text(json.dumps({**original, **(frame_change or {})}))
                self.save("fake-wave", {**manifest, **change})
                s3 = FakeS3()
                with self.assertRaises(ValueError):
                    publish(s3, self.root, "fake-wave", "test", now=NOW)
                self.assertEqual(s3.writes, [])
        frame.write_text(json.dumps(original))

    def test_wave_frames_are_optional_when_a_spot_series_is_published(self):
        manifest = self.wave_bundle()
        self.save("fake-wave", {**manifest, "frames": [], "horizonHours": 2})
        published, _, objects = validate_bundle(self.root, "fake-wave", now=NOW)
        self.assertEqual([path.rsplit("/", 2)[1:] for path, _ in objects],
                         [["spots", "n52w012.json"]])
        self.assertEqual(published["spots"]["squares"], ["n52w012"])
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root, "fake-wave", "test", now=NOW), "published")
        # The square, then the pointer.
        self.assertEqual(s3.writes, [f"weather/{self.pointer['base']}spots/n52w012.json",
                                     "weather/fake-wave.json"])

    def test_a_frameless_wave_bundle_declares_a_horizon_its_series_covers(self):
        manifest = self.wave_bundle()
        # None declared: the split states the one its series reach, as it does a
        # wind ensemble's (squares.series_horizon), so the pointer always has one.
        self.save("fake-wave", {**manifest, "frames": []})
        published, _, _ = validate_bundle(self.root, "fake-wave", now=NOW)
        self.assertEqual(published["horizonHours"], 2)
        cases = [{"frames": [], "horizonHours": 3},  # A horizon the series stops short of.
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
        self.save("fake-wave", manifest)
        with self.assertRaises(ValueError):  # Every declared variable is gridded by default.
            validate_bundle(self.root, "fake-wave", now=NOW)
        self.save("fake-wave", {**manifest, "frameVariables": ["swh"]})
        self.assertEqual(len(validate_bundle(self.root, "fake-wave", now=NOW)[2]), 4)
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
        self.assertEqual(len(objects), 4)
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
                frame.write_text(json.dumps({**original, **(frame_change or {})}))
                self.save("fake-weather", {**manifest, **change})
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
        grid = dict(TINY_GRID)
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
                    "gustAvailable": True, "spotForecasts": {"brandon": []}}
        if kind:
            manifest["gustKind"] = kind
        return self.save("fake-gfs", manifest)

    def test_instantaneous_gusts_carry_a_zero_length_window_at_every_hour(self):
        self.gust_bundle("instantaneous", lambda hour: [hour, hour])
        self.assertEqual(len(validate_bundle(self.root, "fake-gfs", now=NOW)[2]), 4)

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
        self.assertEqual(len(validate_bundle(self.root, "fake-gfs", now=NOW)[2]), 4)

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

    def test_ensemble_without_frames_publishes_only_its_squares_and_the_pointer(self):
        self.ensemble_bundle()
        manifest, _, objects = validate_bundle(self.root, "fake-eps", now=NOW)
        self.assertEqual(len(objects), 1)
        self.assertEqual(manifest["horizonHours"], 2)  # The pointer says how far it reaches.
        self.assertEqual(manifest["spots"]["keys"], ["spotForecasts", "spotMembers"])
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root, "fake-eps", "test", now=NOW), "published")
        self.assertEqual(s3.writes, [f"weather/{self.pointer['base']}spots/n52w012.json",
                                     "weather/fake-eps.json"])

    def test_a_frameless_ensemble_must_state_the_horizon_its_series_reach(self):
        manifest = self.ensemble_bundle()
        self.save("fake-eps", {**manifest, "horizonHours": 5})
        with self.assertRaisesRegex(ValueError, "horizon"):
            validate_bundle(self.root, "fake-eps", now=NOW)

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

    # --- tiled wind frames -------------------------------------------------
    GRID = TINY_GRID
    TILE = "t/0/2/0/{hour:03d}.bin"  # The one native tile TINY_GRID's cells fall in.

    def wind_frame(self, hour, **changes):
        """One frame's grids, as an adapter holds them before they are tiled."""
        payload = {"model": "fake-bin", "run": "2026091312", "hour": hour,
                   "grid": self.GRID, "u": [1.5] * 4, "v": [-2.5] * 4, "gust": [9.0] * 4}
        payload.update(changes)
        return payload

    def tile(self, hour, **changes):
        """The bytes of the native tile a frame publishes, with room to spoil them."""
        payload = self.wind_frame(hour, **changes)
        _, tiles = f5tile.build_pyramid(self.GRID, payload["u"], payload["v"], payload["gust"],
                                        payload["hour"], payload["run"], keep_empty=True)
        return tiles[0][3]

    def tiled_bundle(self, gusts=True, spoil=None, **changes):
        """A wind bundle, published as tiles from the tests' own frame files."""
        self.register("fake-bin", "weather/fake-bin.json", "wind")
        frames = []
        for hour in (0, 1, 2):
            url = f"{self.run_directory}/{hour}.json"
            frames.append({"hour": hour, "validTime": valid(hour), "url": url,
                           "gustIntervalHours": [max(hour - 1, 0), hour] if gusts else None})
            (self.root / url).write_text(json.dumps(
                self.wind_frame(hour, **({} if gusts else {"gust": None}))))
        manifest = {**self.identity("fake-bin", "wind"), "grid": self.GRID, "frames": frames,
                    "gustAvailable": gusts, "spotForecasts": {"brandon": []}}
        self.manifest = self.save("fake-bin", {**manifest, **changes}, spoil)
        return self.manifest

    def replacing(self, hour, data):
        """A spoil that swaps one hour's native tile before the run is named."""
        def spoil(staging):
            (staging / self.TILE.format(hour=hour)).write_bytes(data)
        return spoil

    def repoint(self, **changes):
        """Rewrite the published pointer itself, leaving the run directory alone."""
        pointer = {**self.pointer, **changes}
        (self.root / "weather/fake-bin.json").write_text(json.dumps(pointer))
        return pointer

    def test_a_tiled_wind_bundle_validates_and_publishes_its_tiles(self):
        self.tiled_bundle()
        published, _, objects = validate_bundle(self.root, "fake-bin", now=NOW)
        self.assertNotIn("encoding", published)
        self.assertEqual(published["tiles"]["levels"],
                         [{"level": 0, "dx": 0.5, "dy": 0.4, "x": [2, 2], "y": [0, 0],
                           "absent": []}])
        directory = f"weather/{published['base']}"
        self.assertEqual([path for path, _ in objects],
                         [f"{directory}spots/n52w012.json"]
                         + [f"{directory}{self.TILE.format(hour=hour)}" for hour in (0, 1, 2)])
        # The bytes uploaded are the tile's own, uncompressed: compression is the
        # uploader's business and the sidecars are never objects of their own.
        self.assertEqual(objects[1][1], self.tile(0))
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root, "fake-bin", "test", now=NOW), "published")
        self.assertEqual(s3.writes[-1], "weather/fake-bin.json")
        self.assertEqual(len(s3.writes), 5)  # three tiles, a square, then the pointer

    def test_a_tile_from_the_wrong_run_hour_or_place_is_refused(self):
        """The header is what makes this catchable; the file name alone is not."""
        cases = {"later hour": self.tile(9), "earlier hour": self.tile(0),
                 "earlier run": self.tile(1, run="2026091300"),
                 "later run": self.tile(1, run="2026091313")}
        for name, data in cases.items():
            with self.subTest(name):
                self.tiled_bundle(spoil=self.replacing(1, data))
                with self.assertRaisesRegex(ValueError, "is from run"):
                    validate_bundle(self.root, "fake-bin", now=NOW)
        neighbour = bytearray(self.tile(1))
        neighbour[18:20] = (3).to_bytes(2, "little")  # Tile x = 3, published as x = 2.
        self.tiled_bundle(spoil=self.replacing(1, bytes(neighbour)))
        with self.assertRaisesRegex(ValueError, "is tile 0/3/0"):
            validate_bundle(self.root, "fake-bin", now=NOW)

    def test_a_tile_under_another_models_run_directory_is_refused(self):
        """The model is not in the file, so the path is what has to carry it.

        Every wind model's objects live under `weather/`, so without this a
        HARMONIE manifest could reference a GFS run's tiles with the same run,
        hour and grid and be accepted — and GFS's next publish would then delete
        objects a live HARMONIE pointer still pointed at.
        """
        self.tiled_bundle()
        pointer = dict(self.pointer)
        theirs = "fake-other" + pointer["base"][len("fake-bin"):]
        os.replace(self.root / "weather" / pointer["base"], self.root / "weather" / theirs)
        self.repoint(base=theirs)
        with self.assertRaises(ValueError) as caught:
            validate_bundle(self.root, "fake-bin", now=NOW)
        self.assertIn("is not named for fake-bin", str(caught.exception))

    def test_a_tile_swapped_inside_a_published_run_is_refused(self):
        """The run directory is named for its content, so a swapped tile is noticed.

        The substituted tile carries the right run, hour and place, so every
        header check passes and only the directory's hash is left to catch it.
        """
        self.tiled_bundle()
        published = self.root / "weather" / self.pointer["base"] / self.TILE.format(hour=1)
        published.write_bytes(self.tile(1, u=[7.5] * 4))
        with self.assertRaises(ValueError) as caught:
            validate_bundle(self.root, "fake-bin", now=NOW)
        self.assertIn("does not hold the content its name claims", str(caught.exception))

    def test_a_tile_of_the_wrong_size_or_shape_is_refused(self):
        whole = self.tile(1)
        payload = self.wind_frame(1)
        _, small = f5tile.build_pyramid(self.GRID, payload["u"], payload["v"], payload["gust"],
                                        1, "2026091312", size=64, keep_empty=True)
        cases = {
            "another tile size": small[0][3],
            "truncated": whole[:-2],
            "oversized": whole + b"\0\0",
            "header only": whole[:f5tile.HEADER_BYTES],
            "not a tile": b"{\"model\": \"fake-bin\"}",
            "a whole frame": f5bin.encode_frame(payload),
            "reserved bytes used": whole[:22] + b"\1" + whole[23:],
        }
        for name, body in cases.items():
            with self.subTest(name):
                self.tiled_bundle(spoil=self.replacing(1, body))
                with self.assertRaises(ValueError):
                    validate_bundle(self.root, "fake-bin", now=NOW)

    def test_a_tiled_bundle_keeps_every_gust_rule(self):
        # A gust block where the manifest declares none.
        self.tiled_bundle(gusts=False, spoil=self.replacing(1, self.tile(1)))
        with self.assertRaises(ValueError) as caught:
            validate_bundle(self.root, "fake-bin", now=NOW)
        self.assertIn("Gust block does not match", str(caught.exception))
        # The same bundle with the gust block actually absent is fine.
        self.tiled_bundle(gusts=False)
        self.assertEqual(self.pointer["tiles"]["blocks"], ["u", "v"])
        self.assertEqual(len(validate_bundle(self.root, "fake-bin", now=NOW)[2]), 4)
        # And a missing gust block where the manifest promises one is refused.
        self.tiled_bundle(spoil=self.replacing(1, self.tile(1, gust=None)))
        with self.assertRaises(ValueError) as caught:
            validate_bundle(self.root, "fake-bin", now=NOW)
        self.assertIn("Gust block does not match", str(caught.exception))

    def test_an_implausible_value_inside_a_tile_is_refused(self):
        """Hand-built bytes, because the encoder refuses to write these at all."""
        side = 130 * 130 * 2
        # u, v and gust each at the tile's first owned cell, (1, 1): 131 cells in.
        for block, value in [(0, 1501), (1, -1501), (2, -1)]:
            with self.subTest(block=block):
                body = bytearray(self.tile(1))
                offset = f5tile.HEADER_BYTES + block * side + 131 * 2
                # The cell before it, the first of its row, is stored as a value (missing,
                # off the grid); the delta to the new value wraps in int16, as f5bin's do.
                previous = int.from_bytes(body[offset - 2:offset], "little", signed=True)
                delta = ((value - previous + 32768) & 0xFFFF) - 32768
                body[offset:offset + 2] = delta.to_bytes(2, "little", signed=True)
                self.tiled_bundle(spoil=self.replacing(1, bytes(body)))
                with self.assertRaises(ValueError):
                    validate_bundle(self.root, "fake-bin", now=NOW)

    def test_a_native_tile_may_not_leave_a_hole_in_the_grid(self):
        self.tiled_bundle(spoil=self.replacing(1, self.tile(1, v=[-2.5, None, -2.5, -2.5])))
        with self.assertRaisesRegex(ValueError, "leaves part of the grid missing"):
            validate_bundle(self.root, "fake-bin", now=NOW)

    def test_every_tile_the_manifest_does_not_call_absent_must_be_there(self):
        # A tile listed absent that is there all the same.
        self.tiled_bundle()
        tiles = self.pointer["tiles"]
        absent = {**tiles, "levels": [{**tiles["levels"][0], "absent": [[2, 0]]}]}
        self.repoint(tiles=absent)
        with self.assertRaisesRegex(ValueError, "unreferenced"):
            validate_bundle(self.root, "fake-bin", now=NOW)
        # A tile written at no hour is absent; but a wind field has a value at every
        # cell, so a native tile that holds part of the grid cannot be.
        def empty(staging):
            for path in (staging / "t").rglob("*.bin*"):
                path.unlink()
        self.tiled_bundle(spoil=empty)
        self.assertEqual(self.pointer["tiles"]["levels"][0]["absent"], [[2, 0]])
        with self.assertRaisesRegex(ValueError, "absent but holds part of the grid"):
            validate_bundle(self.root, "fake-bin", now=NOW)
        # A pointer that calls it present names files the run does not have.
        self.repoint(tiles={**self.pointer["tiles"], "levels": [
            {**self.pointer["tiles"]["levels"][0], "absent": []}]})
        with self.assertRaisesRegex(ValueError, "missing"):
            validate_bundle(self.root, "fake-bin", now=NOW)
        # And a tile written for some hours and not others is never published at all.
        def gap(staging):
            (staging / self.TILE.format(hour=2)).unlink()
        with self.assertRaisesRegex(ValueError, "missing at \\+2h"):
            self.tiled_bundle(spoil=gap)

    def test_the_tiles_block_must_describe_the_grid(self):
        self.tiled_bundle()
        tiles = self.pointer["tiles"]
        level = tiles["levels"][0]
        broken = {
            "no tiles": {"tiles": None},
            "size": {"tiles": {**tiles, "size": 64}},
            "no border": {"tiles": {**tiles, "border": 0}},
            "encoding": {"tiles": {**tiles, "encoding": "f5-tile-v2"}},
            "url": {"tiles": {**tiles, "url": "tiles/{level}/{x}/{y}/{hour}.bin"}},
            "blocks": {"tiles": {**tiles, "blocks": ["u", "v"]}},
            "ranges": {"tiles": {**tiles, "levels": [{**level, "x": [2, 3]}]}},
            "cell size": {"tiles": {**tiles, "levels": [{**level, "dx": 0.25}]}},
            "extra level": {"tiles": {**tiles, "levels": [level, {**level, "level": 1}]}},
            "absent outside": {"tiles": {**tiles, "levels": [{**level, "absent": [[3, 0]]}]}},
            "absent twice": {"tiles": {**tiles, "levels": [{**level, "absent": [[2, 0], [2, 0]]}]}},
            "unknown key": {"tiles": {**tiles, "levels": [{**level, "extra": 1}]}},
            "off the lattice": {"grid": {**self.GRID, "west": -10.9, "east": -10.4}},
            "a whole-frame encoding": {"encoding": "f5-int16-v1"},
            "a frame url": {"frames": [{**self.pointer["frames"][0], "url": "frames/000.bin"},
                                       *self.pointer["frames"][1:]]},
        }
        for name, change in broken.items():
            with self.subTest(name):
                self.repoint(**change)
                with self.assertRaises(ValueError):
                    validate_bundle(self.root, "fake-bin", now=NOW)

    def test_only_wind_frames_are_tiles_and_no_bundle_declares_an_encoding(self):
        self.wave_bundle()
        for change in ({"encoding": "f5-int16-v1"},
                       {"tiles": {"size": 128, "border": 1, "encoding": "f5-tile-v1",
                                  "blocks": ["u", "v"], "url": "t/{level}/{x}/{y}/{hour}.bin",
                                  "levels": []}}):
            with self.subTest(sorted(change)):
                (self.root / "weather/fake-wave.json").write_text(
                    json.dumps({**self.pointer, **change}))
                with self.assertRaises(ValueError):
                    validate_bundle(self.root, "fake-wave", now=NOW)
        with self.assertRaisesRegex(ValueError, "retired"):
            self.tiled_bundle(encoding="f5-int16-v1")

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
        # The blend, the archive, the verification and the warnings are not
        # forecasts: their run is the hour they ran.
        self.assertEqual(sorted(model for model, entry in MODELS.items()
                                if not entry.get("readsPublishedRun")),
                         ["blend", "forecast-archive", "sea-temperature", "tides", "verify",
                          "warnings", "wind-obs"])



class ReadsBucketContractTests(unittest.TestCase):
    """A `readsBucket` job is handed the bucket's coordinates, so it must take them.

    The worker passes --bucket, --prefix and, when set, --endpoint-url and --region
    to such a job; a script that did not declare one would fail with a usage error
    on the first one-shot run, which only the bucket deployment would ever see.
    """

    HERE = Path(__file__).resolve().parent
    OPTIONS = {"--bucket", "--prefix", "--endpoint-url", "--region"}

    def declared(self, script):
        tree = ast.parse((self.HERE / script).read_text())
        return {node.args[0].value for node in ast.walk(tree)
                if isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "add_argument"
                and node.args and isinstance(node.args[0], ast.Constant)}

    def test_every_bucket_reader_takes_the_bucket_options(self):
        readers = [model for model, entry in MODELS.items() if entry.get("readsBucket")]
        self.assertEqual(sorted(readers), ["blend", "forecast-archive", "verify"])
        for model in readers:
            with self.subTest(model=model):
                self.assertLessEqual(self.OPTIONS, self.declared(MODELS[model]["script"]))

    def test_no_registered_manifest_lives_in_the_archive(self):
        self.assertFalse([path for path in MANIFESTS.values() if path.split("/")[0] == "archive"])


class StepContractTests(unittest.TestCase):
    """Every adapter the worker hands its `--step` must take it.

    The worker passes `--step` to every wind and weather adapter whose registry
    entry does not say `workerStep: False`; one that did not declare it would fail
    with a usage error on its first scheduled run.
    """

    HERE = Path(__file__).resolve().parent

    def step_option(self, script):
        tree = ast.parse((self.HERE / script).read_text())
        return [node for node in ast.walk(tree)
                if isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "add_argument"
                and node.args and isinstance(node.args[0], ast.Constant)
                and node.args[0].value == "--step"]

    def test_every_adapter_given_the_workers_step_takes_it(self):
        import worker
        stepped = [model for model, entry in MODELS.items()
                   if model not in worker.ECMWF_MODELS and entry["kind"] in worker.STEPPED_KINDS
                   and entry.get("workerStep", True)]
        # ICON-EU weather is among them, so its rain is hourly as scheduled.
        self.assertIn("icon-eu-weather", stepped)
        self.assertNotIn("gfs-weather", stepped)
        for model in stepped:
            with self.subTest(model=model):
                self.assertTrue(self.step_option(MODELS[model]["script"]))


if __name__ == "__main__":
    unittest.main()
