import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
import numpy as np
from pyproj import Proj, Geod
import eccodes as ec

from fetch_harmonie import discover, earth_vectors, resample, messages, validate, GRID
from fetch_harmonie import main
from fetch_forecast import write_json


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
        metadata = {"discipline": 0, "parameterCategory": 2, "parameterNumber": 2,
            "typeOfLevel": "heightAboveGround", "level": 10, "gridType": "lambert", "uvRelativeToGrid": 1,
            "shapeOfTheEarth": 6, "centre": "eidb", "typeOfProcessedData": "cf", "perturbationNumber": 0,
            "stepType": "instant", "startStep": 3, "endStep": 3, "iScansNegatively": 0,
            "jScansPositively": 1, "jPointsAreConsecutive": 0, "alternativeRowScanning": 0,
            "DxInMetres": 2000, "DyInMetres": 2000, "units": "m s**-1", "numberOfMissing": 0,
            "dataDate": 20260913, "dataTime": 1200, "validityDate": 20260913, "validityTime": 1500}
        def check(values):
            with patch("fetch_harmonie.ec.codes_set"), patch("fetch_harmonie.ec.codes_get", side_effect=lambda _, k: values[k]):
                validate(None, "u", "2026091312", 3)
        check(metadata)
        for key, wrong in [("perturbationNumber", 1), ("typeOfProcessedData", "pf"), ("dataTime", 1100),
                           ("uvRelativeToGrid", 0), ("level", 100), ("validityTime", 1600), ("numberOfMissing", 1)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                check({**metadata, key: wrong})

    def test_crop_contract_is_regular(self):
        self.assertAlmostEqual(GRID["east"] - GRID["west"], (GRID["width"]-1)*GRID["dx"])
        self.assertAlmostEqual(GRID["north"] - GRID["south"], (GRID["height"]-1)*GRID["dy"])
