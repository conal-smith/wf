from datetime import datetime, timezone
import json
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
import numpy as np
from pyproj import Proj, Geod
import eccodes as ec

from fetch_harmonie import discover, earth_vectors, resample, messages, validate, GRID
from fetch_harmonie import extract, has_gust, gust_window, main, GUST_FIELDS, PARAMETERS
from fetch_forecast import write_json
from publish_s3 import validate_bundle

# Recorded from the live control run 2026091620 +3h, whose full-domain export
# carries the scalar gust (parameter 22) beside its components (23/24):
# (max_10efg, max_10nfg, max_i10fg) in m/s.
SOURCE_GUSTS = [
    (3.1189, 2.7419, 4.1514),
    (56.9431, -26.7229, 62.9024),
    (-0.2072, -0.0842, 0.2244),
    (4.3279, -4.2542, 6.0700),
    (6.6150, 6.9294, 9.5786),
    (18.4490, -16.7405, 24.9134),
    (-1.0608, 0.8279, 1.3459),
]
WIND_KEYS = {"discipline": 0, "parameterCategory": 2, "parameterNumber": 2,
    "typeOfLevel": "heightAboveGround", "level": 10, "gridType": "lambert", "uvRelativeToGrid": 1,
    "shapeOfTheEarth": 6, "centre": "eidb", "typeOfProcessedData": "cf", "perturbationNumber": 0,
    "stepType": "instant", "startStep": 3, "endStep": 3, "iScansNegatively": 0,
    "jScansPositively": 1, "jPointsAreConsecutive": 0, "alternativeRowScanning": 0,
    "DxInMetres": 2000, "DyInMetres": 2000, "units": "m s**-1", "numberOfMissing": 0,
    "dataDate": 20260913, "dataTime": 1200, "validityDate": 20260913, "validityTime": 1500}
GUST_KEYS = {**WIND_KEYS, "parameterNumber": 23, "stepType": "max", "startStep": 2,
             "typeOfStatisticalProcessing": 2, "indicatorOfUnitForTimeRange": 1,
             "lengthOfTimeRange": 1}


def check_metadata(values, field="u", hour=3):
    with patch("fetch_harmonie.ec.codes_set"), \
         patch("fetch_harmonie.ec.codes_get", side_effect=lambda _, k: values[k]):
        validate(None, field, "2026091312", hour)


def grib_message(number):
    """A minimal GRIB2 message carrying one 10 m parameter, for stream assembly."""
    handle = ec.codes_grib_new_from_samples("GRIB2")
    for key, value in [("discipline", 0), ("parameterCategory", 2), ("parameterNumber", number),
                       ("typeOfLevel", "heightAboveGround"), ("level", 10)]:
        ec.codes_set(handle, key, value)
    message = ec.codes_get_message(handle)
    ec.codes_release(handle)
    return message


def fake_decode(path, run, hour, layout=None, gusts=True):
    """Stand in for real GRIB decoding while keeping the published frame contract."""
    count = GRID["width"] * GRID["height"]
    frame = {"u": [6.0] * count, "v": [-8.0] * count, "gust": None, "gustIntervalHours": None}
    if gusts and hour > 0:
        frame["gust"] = [14.5] * count
        frame["gustIntervalHours"] = gust_window(hour)
    return frame, layout or {"signature": ()}


class HarmonieTests(unittest.TestCase):
    def test_failed_validation_preserves_published_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "public/weather/harmonie.json"
            write_json(target, {"previous": "published snapshot"})
            write_json(root / "public/spots.json", [])
            before = target.read_bytes()
            with patch("fetch_harmonie.ROOT", root), patch("sys.argv", ["fetch_harmonie", "--hours", "3"]), \
                 patch("fetch_harmonie.inventory", return_value=[]), \
                 patch("fetch_harmonie.discover", return_value=("2026091312", {0: "zero", 3: "three"})), \
                 patch("fetch_harmonie.download", return_value=Path("unused")), \
                 patch("fetch_harmonie.has_gust", return_value=True), \
                 patch("fetch_harmonie.decode", side_effect=ValueError("invalid source")):
                with self.assertRaises(ValueError):
                    main()
            self.assertEqual(target.read_bytes(), before)

    def test_discovery_rejects_partial_and_ensemble_runs(self):
        items = [{"name": f"fc{run}+{hour:03d}CONTROL_grib2_ieIoI"}
                 for run, hours in [("2026091312", [0, 3, 6]), ("2026091313", [0, 3])]
                 for hour in hours]
        items.append({"name": "fc2026091313+006grib2_enIoI"})
        run, files = discover(items, [0, 3, 6])
        self.assertEqual(run, "2026091312")
        self.assertEqual(len(files), 3)
        with self.assertRaises(RuntimeError):
            discover(items, [0, 3, 6], "2026091313")

    def test_projection_rotation_matches_independent_geodesic_bearing(self):
        p = Proj(proj="lcc", lat_1=55.5, lat_2=55.5, lat_0=55.499999, lon_0=-8, R=6371229)
        geod = Geod(a=6371229, b=6371229)
        for lon, lat in [(-10.2, 52.1), (-8, 54), (-5.5, 55)]:
            x, y = p(lon, lat)
            next_lon, next_lat = p(x, y + 1, inverse=True)
            bearing, _, _ = geod.inv(lon, lat, next_lon, next_lat)
            east, north = earth_vectors(0, 10, p.get_factors(lon, lat).meridian_convergence)
            self.assertAlmostEqual(np.degrees(np.arctan2(east, north)), bearing, places=5)
            self.assertAlmostEqual(np.hypot(east, north), 10)
        self.assertAlmostEqual(earth_vectors(10, 0, 90)[1], -10)

    def test_bilinear_projection_sampling(self):
        layout = {"indices": np.array([0]), "nx": 2, "tx": np.array([.25]), "ty": np.array([.5])}
        np.testing.assert_allclose(resample(np.array([0, 4, 8, 12]), layout), [5])

    def test_grib_stream_rejects_truncation_and_extra_bytes(self):
        h = ec.codes_grib_new_from_samples("GRIB2")
        data = ec.codes_get_message(h)
        ec.codes_release(h)
        self.assertEqual(list(messages(data + data)), [data, data])
        for invalid in [data[:-1], data + b"x", b"not a grib"]:
            with self.assertRaises(ValueError):
                list(messages(invalid))

    def test_metadata_rejects_member_run_rotation_level_and_time_mismatch(self):
        check_metadata(WIND_KEYS)
        for key, wrong in [("perturbationNumber", 1), ("typeOfProcessedData", "pf"), ("dataTime", 1100),
                           ("uvRelativeToGrid", 0), ("level", 100), ("validityTime", 1600),
                           ("numberOfMissing", 1), ("stepType", "max"), ("parameterNumber", 22)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                check_metadata({**WIND_KEYS, key: wrong})

    def test_gust_components_combine_to_the_published_scalar_gust(self):
        for east, north, scalar in SOURCE_GUSTS:
            with self.subTest(scalar=scalar):
                self.assertAlmostEqual(np.hypot(east, north), scalar, delta=0.002)

    def test_gust_magnitude_is_invariant_under_the_vector_rotation(self):
        east = np.array([e for e, _, _ in SOURCE_GUSTS])
        north = np.array([n for _, n, _ in SOURCE_GUSTS])
        scalar = np.array([s for _, _, s in SOURCE_GUSTS])
        for convergence in [-7.5, -1.0, 0.0, 3.25, 9.0]:
            rotated = earth_vectors(east, north, convergence)
            np.testing.assert_allclose(np.hypot(*rotated), np.hypot(east, north), atol=1e-12)
            self.assertLess(np.abs(np.hypot(*rotated) - scalar).max(), 0.002)

    def test_gust_interval_is_the_hour_ending_at_the_forecast_time(self):
        self.assertEqual([gust_window(h) for h in (0, 1, 3, 60)],
                         [[0, 0], [0, 1], [2, 3], [59, 60]])
        check_metadata(GUST_KEYS, "gustEast")
        check_metadata({**GUST_KEYS, "parameterNumber": 24}, "gustNorth")
        check_metadata({**GUST_KEYS, "startStep": 0, "endStep": 0, "lengthOfTimeRange": 0,
                        "validityTime": 1200, "validityDate": 20260913}, "gustEast", 0)
        for key, wrong in [("lengthOfTimeRange", 3), ("indicatorOfUnitForTimeRange", 13),
                           ("typeOfStatisticalProcessing", 0), ("stepType", "instant"),
                           ("startStep", 0), ("parameterNumber", 2)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                check_metadata({**GUST_KEYS, key: wrong}, "gustEast")

    def test_cache_keeps_both_gust_components_or_neither(self):
        wind = [grib_message(PARAMETERS[f]) for f in ("u", "v")]
        gusts = [grib_message(PARAMETERS[f]) for f in ("gustEast", "gustNorth")]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cached.grib2"
            path.write_bytes(extract(b"".join(wind + gusts)))
            self.assertEqual(len(list(messages(path.read_bytes()))), 4)
            self.assertTrue(has_gust(path))
            # A lone component cannot give a speed, so neither is cached.
            path.write_bytes(extract(b"".join(wind + gusts[:1])))
            self.assertEqual(len(list(messages(path.read_bytes()))), 2)
            self.assertFalse(has_gust(path))
        with self.assertRaises(ValueError):
            extract(b"".join(gusts))
        with self.assertRaises(ValueError):
            extract(b"".join(wind + wind[:1]))

    def publish_run(self, gusts, hours="6"):
        """Publish a fake but contract-shaped run into a scratch root; return its manifest."""
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        write_json(root / "public/spots.json",
                   [{"id": "brandon", "lon": -10.0, "lat": 52.25}])
        names = {h: f"fc2026091312+{h:03d}CONTROL_grib2_ieIoI" for h in (0, 3, 6)}
        for name in names.values():
            (root / name).write_bytes(name.encode())
        with patch("fetch_harmonie.ROOT", root), \
             patch("fetch_harmonie.SPOTS_FILE", root / "public/spots.json"), \
             patch("sys.argv", ["fetch_harmonie", "--hours", hours]), \
             patch("fetch_harmonie.inventory", return_value=[]), \
             patch("fetch_harmonie.discover", return_value=("2026091312", names)), \
             patch("fetch_harmonie.download", side_effect=lambda name: root / name), \
             patch("fetch_harmonie.has_gust", return_value=gusts), \
             patch("fetch_harmonie.decode", side_effect=fake_decode):
            main()
        return root, json.loads((root / "public/weather/harmonie.json").read_text())

    def test_published_gust_run_declares_hourly_maxima_and_satisfies_the_publisher(self):
        root, manifest = self.publish_run(gusts=True)
        self.assertTrue(manifest["gustAvailable"])
        self.assertEqual(manifest["gustMissingHours"], [0])
        self.assertIn("one hour ending at each forecast time", manifest["gustDescription"])
        self.assertEqual([f["gustIntervalHours"] for f in manifest["frames"]],
                         [None, [2, 3], [5, 6]])
        self.assertEqual([s["gust"] for s in manifest["spotForecasts"]["brandon"]],
                         [None, 14.5, 14.5])
        frames = [json.loads((root / "public" / f["url"]).read_text()) for f in manifest["frames"]]
        self.assertIsNone(frames[0]["gust"])
        self.assertEqual(len(frames[2]["gust"]), GRID["width"] * GRID["height"])
        validate_bundle(root / "public", "harmonie", max_age_hours=10**6,
                        now=datetime(2026, 9, 13, 13, tzinfo=timezone.utc))

    def test_a_step_without_gust_components_publishes_an_explicitly_wind_only_run(self):
        root, manifest = self.publish_run(gusts=False)
        self.assertFalse(manifest["gustAvailable"])
        self.assertNotIn("gustMissingHours", manifest)  # An empty list is not a valid declaration.
        self.assertIn("did not supply gust components", manifest["gustDescription"])
        self.assertEqual([f["gustIntervalHours"] for f in manifest["frames"]], [None, None, None])
        self.assertEqual([s["gust"] for s in manifest["spotForecasts"]["brandon"]], [None] * 3)
        for frame in manifest["frames"]:
            self.assertIsNone(json.loads((root / "public" / frame["url"]).read_text())["gust"])
        validate_bundle(root / "public", "harmonie", max_age_hours=10**6,
                        now=datetime(2026, 9, 13, 13, tzinfo=timezone.utc))

    def test_availability_is_decided_from_the_cached_files_not_assumed(self):
        """Real `has_gust` over fabricated caches decides the run's gust availability."""
        wind = [grib_message(PARAMETERS[f]) for f in ("u", "v")]
        gusts = [grib_message(PARAMETERS[f]) for f in GUST_FIELDS]
        for missing, expected in [(None, True), (6, False), (3, False)]:
            with self.subTest(missing=missing):
                directory = tempfile.TemporaryDirectory()
                self.addCleanup(directory.cleanup)
                root = Path(directory.name)
                write_json(root / "public/spots.json", [])
                names = {h: f"cached-{h:03d}" for h in (0, 3, 6)}
                for hour, name in names.items():
                    (root / name).write_bytes(
                        b"".join(wind if hour == missing else wind + gusts))
                with patch("fetch_harmonie.ROOT", root), \
                     patch("fetch_harmonie.SPOTS_FILE", root / "public/spots.json"), \
                     patch("sys.argv", ["fetch_harmonie", "--hours", "6"]), \
                     patch("fetch_harmonie.inventory", return_value=[]), \
                     patch("fetch_harmonie.discover", return_value=("2026091312", names)), \
                     patch("fetch_harmonie.download", side_effect=lambda name: root / name), \
                     patch("fetch_harmonie.decode", side_effect=fake_decode):
                    main()
                manifest = json.loads((root / "public/weather/harmonie.json").read_text())
                self.assertIs(manifest["gustAvailable"], expected)

    def test_gust_and_wind_only_runs_use_distinct_immutable_frame_paths(self):
        _, with_gusts = self.publish_run(gusts=True)
        _, without = self.publish_run(gusts=False)
        self.assertNotEqual(with_gusts["frames"][1]["url"], without["frames"][1]["url"])

    def test_crop_contract_is_regular(self):
        self.assertAlmostEqual(GRID["east"] - GRID["west"], (GRID["width"]-1)*GRID["dx"])
        self.assertAlmostEqual(GRID["north"] - GRID["south"], (GRID["height"]-1)*GRID["dy"])
