"""Marine Institute ROMS currents adapter tests against a fake ERDDAP; no network access."""
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

import fetch_currents
from fetch_currents import DATASET, discover, main
from publish_s3 import publish, validate_bundle
from registry import MODELS, UNCHANGED_EXIT
from test_publish_s3 import FakeS3
from runfixtures import read_whole, use_catalogue

HINDCAST_HOURS = 168  # A week of hindcast precedes the model day in the aggregate.
FORECAST_HOURS = 72
# IMI_NEATL's regular grid, as ERDDAP describes it: origin, step, count.
AXES = {"lat": (48.00625, 0.0125, 800), "lon": (-17.99375, 0.0125, 1360)}
SPOTS = [
    # Its own cell is land, so the closest cell with water is used.
    {"id": "malahide", "name": "Malahide", "lat": 53.455, "lon": -6.150},
    # Open water: its own cell.
    {"id": "dollymount", "name": "Dollymount", "lat": 53.36, "lon": -6.10},
    # Deep inside a dry block: nothing within the search limit.
    {"id": "inland", "name": "Inland lake", "lat": 53.5, "lon": -8.5},
]
BLOCK = re.compile(r"^(\w+)"
                   r"\[\(([^)]+)\):1:\(([^)]+)\)\]"
                   r"\[\(([^)]+)\):(\d+):\(([^)]+)\)\]"
                   r"\[\(([^)]+)\):(\d+):\(([^)]+)\)\]$")
SMALL_BOX = (-6.2, 53.3, -6.0, 53.5)


def dry(lat, lon):
    """Land west of 6.14° W near Malahide, and a large dry block inland."""
    return ((lon < -6.14 and 53.40 < lat < 53.50)
            or (abs(lat - 53.5) < 0.2 and abs(lon + 8.5) < 0.2))


def source_value(name, hour, lat, lon):
    """A tide-like current turning every half day, stronger to the north."""
    speed = 0.4 + 0.2 * (lat - 53.0)
    angle = 2 * math.pi * hour / 12.42
    if name == "sea_surface_x_velocity":
        return round(0.1 * speed * math.cos(angle), 6)
    return round(speed * math.sin(angle), 6)


class Response:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        return None


class FakeErddap:
    """Enough griddap and info-page behaviour to drive the whole importer."""

    def __init__(self, day, end=None, licence="Creative Commons Attribution 4.0 "
                 "(https://creativecommons.org/licenses/by/4.0/)", replace=None):
        self.day = day
        self.start = day - timedelta(hours=HINDCAST_HOURS)
        self.end = end or day + timedelta(hours=FORECAST_HOURS)
        self.licence = licence
        self.replace = replace  # (variable, value): every cell of one variable reads this.
        self.requests = []

    def axis(self, key, low, high, stride):
        origin, spacing, count = AXES[key]
        first = math.ceil(round((low - origin) / spacing, 6))
        last = math.floor(round((high - origin) / spacing, 6))
        first, last = max(first, 0), min(last, count - 1)
        return [round(origin + index * spacing, 10) for index in range(first, last + 1, stride)]

    def times(self, low, high):
        first = round((low - self.start).total_seconds() / 3600)
        last = round((high - self.start).total_seconds() / 3600)
        if first < 0 or last > round((self.end - self.start).total_seconds() / 3600):
            raise ValueError("fake ERDDAP: time out of range")
        return [self.start + timedelta(hours=hour) for hour in range(first, last + 1)]

    def info(self):
        attributes = {
            "license": self.licence,
            "time_coverage_start": fetch_currents.stamp(self.start),
            "time_coverage_end": fetch_currents.stamp(self.end),
            "geospatial_lat_min": AXES["lat"][0],
            "geospatial_lat_max": round(AXES["lat"][0] + (AXES["lat"][2] - 1) * AXES["lat"][1], 10),
            "geospatial_lon_min": AXES["lon"][0],
            "geospatial_lon_max": round(AXES["lon"][0] + (AXES["lon"][2] - 1) * AXES["lon"][1], 10),
            "geospatial_lat_resolution": AXES["lat"][1],
            "geospatial_lon_resolution": AXES["lon"][1],
        }
        lines = ["Row Type,Variable Name,Attribute Name,Data Type,Value"]
        for name, value in attributes.items():
            lines.append(f'attribute,NC_GLOBAL,{name},String,"{value}"')
        for name in ["time", "latitude", "longitude"]:
            lines.append(f'dimension,{name},,,"nValues=1"')
        for name in list(fetch_currents.SOURCE_VARIABLES.values()) + ["sea_surface_height"]:
            lines.append(f'variable,{name},,double,"time, latitude, longitude"')
        return "\n".join(lines) + "\n"

    def grid(self, query):
        specs = [BLOCK.match(part) for part in query.split(",")]
        if any(spec is None for spec in specs):
            raise ValueError(f"fake ERDDAP: unparsed query {query}")
        names = [spec.group(1) for spec in specs]
        first = specs[0].groups()
        if any(spec.groups()[1:] != first[1:] for spec in specs):
            raise ValueError("fake ERDDAP: variables must share one index block")
        moments = self.times(fetch_currents.moment(first[1]), fetch_currents.moment(first[2]))
        latitudes = self.axis("lat", float(first[3]), float(first[5]), int(first[4]))
        longitudes = self.axis("lon", float(first[6]), float(first[8]), int(first[7]))
        lines = ["time,latitude,longitude," + ",".join(names),
                 "UTC,degrees_north,degrees_east," + ",".join("m/s" for _ in names)]
        for when in moments:
            hour = round((when - self.day).total_seconds() / 3600)
            for lat in latitudes:
                for lon in longitudes:
                    cells = []
                    for name in names:
                        value = source_value(name, hour, lat, lon)
                        if self.replace and self.replace[0] == name:
                            value = self.replace[1]
                        cells.append("NaN" if dry(lat, lon) else str(value))
                    lines.append(f"{fetch_currents.stamp(when)},{lat},{lon}," + ",".join(cells))
        return "\n".join(lines) + "\n"

    def get(self, url, timeout=None, headers=None):
        self.requests.append(url)
        if "/info/" in url:
            return Response(self.info())
        query = url.split("?", 1)[1].replace("%20", " ")
        if query == "time[last]":
            return Response(f"time\nUTC\n{fetch_currents.stamp(self.end)}\n")
        return Response(self.grid(query))


class CurrentsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        # A run dated today keeps the freshness and horizon checks meaningful forever.
        self.day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    def run_main(self, *argv, erddap=None, spots=SPOTS, published=None):
        self.erddap = erddap or FakeErddap(self.day)
        use_catalogue(self, spots)
        environment = {"FORCE5_PUBLISHED_RUN": published} if published else {}
        with patch("fetch_currents.ROOT", self.root), \
             patch("fetch_currents.FRAME_BOX", SMALL_BOX), \
             patch("fetch_currents.load_spots", return_value=spots), \
             patch.dict(os.environ, environment), \
             patch.object(fetch_currents.SESSION, "get", side_effect=self.erddap.get):
            manifest = main(list(argv))
        if manifest == UNCHANGED_EXIT:
            return manifest
        published = read_whole(self.root / "public/weather/currents.json")
        self.assertEqual(published, manifest)
        return manifest

    # --- discovery --------------------------------------------------------
    def test_the_run_is_the_axis_end_less_three_days(self):
        end = datetime(2026, 10, 25, tzinfo=timezone.utc)
        self.assertEqual(discover(end, end), datetime(2026, 10, 22, tzinfo=timezone.utc))

    def test_an_axis_that_does_not_end_on_a_model_day_is_refused(self):
        end = datetime(2026, 10, 25, 6, tzinfo=timezone.utc)
        with self.assertRaises(ValueError):
            discover(end, end)

    def test_a_model_day_in_the_future_is_refused(self):
        end = datetime(2026, 10, 25, tzinfo=timezone.utc)
        with self.assertRaises(ValueError):
            discover(end, datetime(2026, 10, 21, 12, tzinfo=timezone.utc))

    def test_a_mid_update_aggregate_publishes_nothing(self):
        with self.assertRaises(ValueError):
            self.run_main("--hours", "3",
                          erddap=FakeErddap(self.day, end=self.day + timedelta(hours=60)))
        self.assertFalse((self.root / "public/weather/currents.json").exists())

    def test_a_changed_licence_is_refused(self):
        with self.assertRaises(ValueError):
            self.run_main("--hours", "3", erddap=FakeErddap(self.day, licence="All rights reserved"))

    # --- the bundle -------------------------------------------------------
    def test_a_run_satisfies_the_current_contract_and_publishes(self):
        # Long enough that the horizon has not passed at any hour of the day.
        manifest = self.run_main("--hours", "48")
        self.assertEqual((manifest["kind"], manifest["model"], manifest["stepHours"]),
                         ("current", "currents", 1))
        self.assertEqual(manifest["run"], self.day.strftime("%Y%m%d%H"))
        self.assertEqual(manifest["horizonHours"], 48)
        self.assertEqual([frame["hour"] for frame in manifest["frames"]], list(range(49)))
        self.assertEqual(manifest["frameVariables"], ["u", "v"])
        self.assertIn("not for safety-critical", manifest["attribution"])
        self.assertIn("safety-critical", manifest["caveat"])
        self.assertEqual(MODELS["currents"]["kind"], manifest["kind"])
        _, _, objects = validate_bundle(self.root / "public", "currents",
                                        max_age_hours=MODELS["currents"]["maxAgeHours"])
        self.assertEqual(len(objects), 49 + len(manifest["spots"]["squares"]))
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root / "public", "currents", "test",
                                 max_age_hours=36), "published")
        self.assertEqual(s3.writes[-1], "weather/currents.json")

    def test_frames_take_every_fourth_cell_north_to_south(self):
        manifest = self.run_main("--hours", "3")
        grid = manifest["grid"]
        self.assertEqual((grid["dx"], grid["dy"]), (0.05, 0.05))
        # 53.30625 is the first source latitude inside the box; every fourth after it.
        self.assertEqual((grid["south"], grid["north"]), (53.30625, 53.45625))
        self.assertEqual((grid["west"], grid["east"]), (-6.19375, -6.04375))
        self.assertEqual((grid["width"], grid["height"]), (4, 4))
        frame = json.loads((self.root / "public/weather" / manifest["base"]
                            / manifest["frames"][3]["url"]).read_text())
        self.assertEqual(len(frame["u"]), 16)
        # Row 0 is the northern edge: its first cells are the dry land west of 6.14° W.
        self.assertIsNone(frame["u"][0])
        self.assertIsNone(frame["v"][0])
        # The southern row is all water, and slower than the row above it.
        self.assertTrue(all(value is not None for value in frame["v"][12:]))
        self.assertLess(abs(frame["v"][12]), abs(frame["v"][8]))
        self.assertEqual(frame["v"][15], round(source_value(
            "sea_surface_y_velocity", 3, 53.30625, -6.04375), 2))

    def test_a_land_cell_takes_the_closest_cell_with_water(self):
        manifest = self.run_main("--hours", "3")
        record = manifest["spotCells"]["malahide"]
        self.assertEqual(record["cellLon"], -6.13125)
        self.assertGreater(record["offsetKm"], 1)
        self.assertLessEqual(record["offsetKm"], fetch_currents.SEARCH_KM)
        series = manifest["spotSeries"]["malahide"]
        self.assertEqual([step["hour"] for step in series], [0, 1, 2, 3])
        self.assertEqual(series[3]["values"]["v"], round(source_value(
            "sea_surface_y_velocity", 3, record["cellLat"], record["cellLon"]), 2))
        self.assertLess(manifest["spotCells"]["dollymount"]["offsetKm"], 1)

    def test_a_location_with_no_water_in_range_is_nulls_with_a_reason(self):
        manifest = self.run_main("--hours", "3")
        record = manifest["spotCells"]["inland"]
        self.assertIsNone(record["cellLat"])
        self.assertIn("within 5 km", record["reason"])
        self.assertTrue(all(value is None for step in manifest["spotSeries"]["inland"]
                            for value in step["values"].values()))

    def test_an_implausible_current_fails_the_run(self):
        with self.assertRaises(ValueError):
            self.run_main("--hours", "3",
                          erddap=FakeErddap(self.day, replace=("sea_surface_y_velocity", 9.5)))

    def test_half_a_vector_fails_the_run(self):
        with self.assertRaises(ValueError):
            self.run_main("--hours", "3",
                          erddap=FakeErddap(self.day, replace=("sea_surface_x_velocity", "NaN")))

    # --- one run a day, checked three times --------------------------------
    def test_the_model_day_the_bucket_serves_is_not_downloaded_again(self):
        code = self.run_main("--hours", "3", published=self.day.strftime("%Y%m%d%H"))
        self.assertEqual(code, UNCHANGED_EXIT)
        self.assertTrue(all("/info/" in url or "time[last]" in url
                            for url in self.erddap.requests))
        self.assertFalse((self.root / "public/weather/currents.json").exists())

    def test_a_new_model_day_is_downloaded(self):
        yesterday = (self.day - timedelta(days=1)).strftime("%Y%m%d%H")
        manifest = self.run_main("--hours", "3", published=yesterday)
        self.assertEqual(manifest["run"], self.day.strftime("%Y%m%d%H"))

    def test_impossible_horizons_are_refused(self):
        for argv in (["--hours", "0"], ["--hours", "73"]):
            with self.subTest(argv=argv), self.assertRaises(SystemExit):
                self.run_main(*argv)

    def test_the_dataset_is_named_in_every_request(self):
        self.run_main("--hours", "1")
        self.assertTrue(all(DATASET in url for url in self.erddap.requests))


if __name__ == "__main__":
    unittest.main()
