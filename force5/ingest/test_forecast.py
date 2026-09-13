import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fetch_forecast import discover, sample, validate_metadata, write_json


class ForecastTests(unittest.TestCase):
    def setUp(self):
        self.metadata = {"parameterCategory": 2, "parameterNumber": 2, "units": "m s**-1", "level": 10,
                         "typeOfLevel": "heightAboveGround", "gridType": "regular_ll", "uvRelativeToGrid": 0,
                         "stepUnits": 1, "startStep": 3, "endStep": 3, "dataDate": 20260913, "dataTime": 600,
                         "validityDate": 20260913, "validityTime": 900, "stepType": "instant"}

    def test_valid_metadata(self):
        validate_metadata(self.metadata, "u", "2026091306", 3)

    def test_reject_wrong_vector_orientation_units_time(self):
        for key, value in [("uvRelativeToGrid", 1), ("units", "knots"), ("validityTime", 1200), ("dataTime", 0), ("level", 100), ("parameterNumber", 3), ("stepType", "avg")]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_metadata({**self.metadata, key: value}, "u", "2026091306", 3)

    def test_interpolation_orientation_and_boundaries(self):
        grid = {"width": 2, "height": 2, "west": -10, "north": 54, "dx": 1, "dy": 1}
        self.assertEqual(sample(grid, [0,10,20,30], -9.5, 53.5), 15)
        self.assertEqual(sample(grid, [0,10,20,30], -9, 53), 30)
        self.assertIsNone(sample(grid, [0,10,20,30], -11, 53))

    def test_discovery_skips_incomplete_newer_run(self):
        def inventory(cycle, field):
            if cycle == "06":
                return {("2026091306", h): f"url/{field}/{h}" for h in [0,3]}
            if cycle == "12":
                return {("2026091312", h): f"url/{field}/{h}" for h in ([0] if field=="vmax_10m" else [0,3])}
            return {}
        with patch("fetch_forecast.listing", side_effect=inventory):
            run, urls = discover([0,3])
        self.assertEqual(run, "2026091306")
        self.assertEqual(len(urls), 6)

    def test_atomic_publish_preserves_previous_manifest_on_error(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"latest.json"
            write_json(path, {"run":"last-good"})
            with patch("fetch_forecast.os.replace", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    write_json(path, {"run":"incomplete"})
            self.assertEqual(json.loads(path.read_text())["run"], "last-good")


if __name__ == "__main__":
    unittest.main()
