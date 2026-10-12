"""Every adapter must precompute a series for every public riding location."""
import bz2
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import fetch_ecmwf
import fetch_forecast
import fetch_harmonie
from cadence import ECMWF_HOURS
from fetch_forecast import (ORIGINAL_SPOTS_FILE, RIDING_LOCATIONS_FILE, load_spots,
                            sample, spots_file)
from runfixtures import read_whole

# A coarse stand-in for the real Ireland/Atlantic crop: every riding place is inside it.
GRID = {"width": 21, "height": 12, "west": -18.0, "east": 2.0, "north": 59.0, "south": 48.0,
        "dx": 1.0, "dy": 1.0, "order": "north-to-south, west-to-east", "units": "m/s"}


def field(grid, seed):
    return [round((index % grid["width"]) * 0.25 - (index // grid["width"]) * 0.1 + seed, 2)
            for index in range(grid["width"] * grid["height"])]


class CatalogueTests(unittest.TestCase):
    def test_the_default_catalogue_is_every_riding_location(self):
        spots = load_spots()
        self.assertEqual(spots_file(), RIDING_LOCATIONS_FILE)
        self.assertEqual(len(spots), 148)
        original = json.loads(ORIGINAL_SPOTS_FILE.read_text())
        by_id = {spot["id"]: spot for spot in spots}
        # An original spot keeps its coordinate unless the site's owner moved it,
        # and then it sits exactly where they put it (scripts/export-riding-locations.mjs).
        # The worker image carries the two catalogues but not data/, so there only
        # the ids are checked; the repository's own run checks the coordinates.
        owner_file = RIDING_LOCATIONS_FILE.parents[1] / "data/locations/owner-places.json"
        if owner_file.exists():
            owner = json.loads(owner_file.read_text())["overrides"]
            for spot in original:
                moved = owner.get(spot["id"], {})
                want = moved if moved.get("status") == "moved" else spot
                self.assertEqual((by_id[spot["id"]]["lat"], by_id[spot["id"]]["lon"]),
                                 (want["lat"], want["lon"]))
        self.assertEqual([spot["id"] for spot in spots][:len(original)],
                         [spot["id"] for spot in original])

    def test_a_missing_catalogue_falls_back_to_the_original_eight_with_a_warning(self):
        errors = io.StringIO()
        with patch("fetch_forecast.RIDING_LOCATIONS_FILE", Path("/nonexistent/riding.json")), \
             patch("sys.stderr", errors):
            self.assertEqual(spots_file(), ORIGINAL_SPOTS_FILE)
            self.assertEqual(len(load_spots()), 8)
        self.assertIn("npm run spots:export", errors.getvalue())

    def test_the_environment_overrides_the_catalogue(self):
        with patch.dict("os.environ", {"FORCE5_SPOTS_FILE": "/somewhere/else.json"}):
            self.assertEqual(spots_file(), Path("/somewhere/else.json"))

    def test_duplicate_or_impossible_catalogues_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "spots.json"
            for spots in [[], [{"id": "a", "lat": 1, "lon": 1}, {"id": "a", "lat": 2, "lon": 2}],
                          [{"id": "a", "lat": 99, "lon": 1}]]:
                path.write_text(json.dumps(spots))
                with self.subTest(spots=spots), patch.dict("os.environ", {"FORCE5_SPOTS_FILE": str(path)}):
                    with self.assertRaises(ValueError):
                        load_spots()


class AdapterSeriesTests(unittest.TestCase):
    """Each adapter is run with fake source data and its own real publication path."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.spots = load_spots()

    def check(self, manifest_path, hours, fields):
        manifest = read_whole(self.root / manifest_path)
        series = manifest["spotForecasts"]
        self.assertEqual(sorted(series), sorted(spot["id"] for spot in self.spots))
        self.assertEqual(len(series), 148)
        for spot in self.spots:
            self.assertEqual(len(series[spot["id"]]), len(hours))
            for index, hour in enumerate(hours):
                entry = series[spot["id"]][index]
                self.assertEqual(entry["hour"], hour)
                for name, values in fields(hour).items():
                    self.assertEqual(entry[name], sample(GRID, values, spot["lon"], spot["lat"]),
                                     f"{spot['id']} {name} +{hour}h")
        return manifest

    def test_icon_eu_publishes_every_riding_location(self):
        hours = [0, 3]
        values = {hour: {name: field(GRID, hour + seed)
                         for seed, name in enumerate(["u", "v", "gust"])} for hour in hours}
        urls = {(hour, name): f"https://example.invalid/{hour}-{name}" for hour in hours
                for name in fetch_forecast.PARAMS}

        def decode(path, name, run, hour, layout=None):
            return values[hour][name], (("signature",), [], GRID), {"startStep": max(hour - 3, 0), "endStep": hour}

        with patch("fetch_forecast.ROOT", self.root), \
             patch("sys.argv", ["fetch_forecast.py", "--hours", "3", "--step", "3"]), \
             patch("fetch_forecast.discover", return_value=("2026091300", urls)), \
             patch("fetch_forecast.get", return_value=bz2.compress(b"GRIB fake")), \
             patch("fetch_forecast.decode", side_effect=decode):
            fetch_forecast.main()
        self.check("public/weather/latest.json", hours, lambda hour: values[hour])

    def test_harmonie_publishes_every_riding_location(self):
        hours = [0, 3]
        grid = fetch_harmonie.GRID
        values = {hour: {name: field(grid, hour + seed) for seed, name in enumerate(["u", "v"])}
                  for hour in hours}
        with patch("fetch_harmonie.ROOT", self.root), \
             patch("sys.argv", ["fetch_harmonie.py", "--hours", "3", "--step", "3"]), \
             patch("fetch_harmonie.inventory", return_value=[]), \
             patch("fetch_harmonie.discover", return_value=("2026091300", {0: "zero", 3: "three"})), \
             patch("fetch_harmonie.download", return_value=self.root / "unused"), \
             patch("fetch_harmonie.has_gust", return_value=False), \
             patch("fetch_harmonie.decode", side_effect=lambda path, run, hour, layout, gusts=False: ({**values[hour], "gust": None, "gustIntervalHours": None}, None)):
            (self.root / "unused").write_bytes(b"fake")
            fetch_harmonie.main()
        manifest = read_whole(self.root / "public/weather/harmonie.json")
        self.assertEqual(len(manifest["spotForecasts"]), 148)
        for spot in self.spots:
            for index, hour in enumerate(hours):
                entry = manifest["spotForecasts"][spot["id"]][index]
                self.assertIsNone(entry["gust"])
                for name in ("u", "v"):
                    self.assertEqual(entry[name], sample(grid, values[hour][name], spot["lon"], spot["lat"]))

    def test_ecmwf_publishes_every_riding_location(self):
        run = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        values = {hour: {name: field(GRID, hour % 7 + seed)
                         for seed, name in enumerate(["u", "v"])} for hour in ECMWF_HOURS}
        gusts = {hour: (None if hour == 0 else field(GRID, hour % 5 + 3)) for hour in ECMWF_HOURS}
        with patch("fetch_ecmwf.ROOT", self.root), \
             patch("sys.argv", ["fetch_ecmwf.py", "--run", run.strftime("%Y%m%d%H")]), \
             patch("fetch_ecmwf.client") as factory, \
             patch("fetch_ecmwf.decode_wind",
                   side_effect=lambda path, r, hour, layout=None: (values[hour], (("s",), [], GRID))), \
             patch("fetch_ecmwf.download_gust",
                   side_effect=lambda cache, source, r, hour, layout:
                       (gusts[hour], None if hour == 0 else [hour - 3, hour])):
            factory.return_value.retrieve.side_effect = (
                lambda **request: Path(request["target"]).write_bytes(b"GRIB fake"))
            fetch_ecmwf.main()
        manifest = self.check("public/weather/ecmwf.json", list(ECMWF_HOURS),
                              lambda hour: values[hour])
        self.assertEqual(manifest["spotForecasts"]["brandon"][0]["gust"], None)
        for spot in self.spots:
            entry = manifest["spotForecasts"][spot["id"]][1]
            self.assertEqual(entry["gust"], sample(GRID, gusts[3], spot["lon"], spot["lat"]))


if __name__ == "__main__":
    unittest.main()
