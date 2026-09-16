"""Marine Institute SWAN adapter tests against a fake ERDDAP; no network access."""
from datetime import datetime, timedelta, timezone
import json
import math
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

import fetch_mi_swan
from fetch_mi_swan import NEST, SHELF, discover, main, wind_sea
from publish_s3 import publish, validate_bundle
from test_publish_s3 import FakeS3

HINDCAST_HOURS = 192  # Eight days of hindcast precede the run hour in the aggregate.
FORECAST_HOURS = 144
SPOTS = [
    # Its own cell is dry, so a neighbour must be found.
    {"id": "brandon", "name": "Brandon Bay", "lat": 52.276, "lon": -10.024},
    # Inside the Connemara nest.
    {"id": "rusheen", "name": "Rusheen Bay", "lat": 53.251, "lon": -9.121},
    # Deep inside a dry block: no wet cell within the search limit.
    {"id": "inland", "name": "Inland lake", "lat": 53.5, "lon": -8.5},
]
AXES = {
    SHELF: {"lat": (49.0125, 0.025, 280), "lon": (-14.9875, 0.025, 480)},
    NEST: {"lat": (52.95089447171561, 0.0017727272226800055, 440),
           "lon": (-10.79851171874996, 0.002976562500000001, 640)},
}
BLOCK = re.compile(r"^(\w+)"
                   r"\[\(([^)]+)\):(\d+):\(([^)]+)\)\]"
                   r"\[\(([^)]+)\):1:\(([^)]+)\)\]"
                   r"\[\(([^)]+)\):1:\(([^)]+)\)\]$")


def dry(lat, lon):
    """A single dry cell at Brandon Bay and a large dry block inland."""
    return ((abs(lat - 52.2875) < 0.02 and abs(lon + 10.0125) < 0.02)
            or (abs(lat - 53.5) < 0.2 and abs(lon + 8.5) < 0.2))


def source_value(variable, dataset, hour, lat, lon):
    """Deterministic, plausible values; the nest reads slightly higher than the shelf."""
    base = 1.4 + 0.3 * math.sin(hour / 6.0) + 0.4 * (lat - 52.0)
    offset = 0.2 if dataset == NEST else 0.0
    return {"significant_wave_height": round(base + offset, 4),
            "sea_surface_swell_wave_significant_height": round(0.6 * base, 4),
            "mean_wave_period_tm02": round(7.0 + 0.5 * math.cos(hour / 5.0), 4),
            "peak_wave_period": round(11.0 + 0.5 * math.cos(hour / 5.0), 4),
            "mean_wave_direction_from": round(280.0 + 0.1 * hour, 4),
            "peak_wave_direction_from": round(285.0 + 0.1 * hour, 4),
            "directional_spread": 24.5}[variable]


class Response:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        return None


class FakeErddap:
    """Enough griddap and info-page behaviour to drive the whole importer."""

    def __init__(self, day, published=True, holes=(), history=None):
        self.day = day
        self.start = day - timedelta(hours=HINDCAST_HOURS)
        self.end = day + timedelta(hours=FORECAST_HOURS if published else FORECAST_HOURS - 24)
        self.holes = set(holes)  # (variable, hour) pairs returned as NaN.
        self.history = history or (f"{day:%a %b %d} 08:58:08 {day:%Y}: cdo -seltimestep,145/168 "
                                   "/home/SWAN/OUTPUT/irish_shelf/FC/is_spatial.nc")
        self.requests = []

    # --- axes -------------------------------------------------------------
    def axis(self, dataset, key, low, high):
        origin, spacing, count = AXES[dataset][key]
        first = min(max(round((low - origin) / spacing), 0), count - 1)
        last = min(max(round((high - origin) / spacing), 0), count - 1)
        return [round(origin + index * spacing, 10) for index in range(min(first, last),
                                                                       max(first, last) + 1)]

    def times(self, low, high, stride):
        first = round((low - self.start).total_seconds() / 3600)
        last = round((high - self.start).total_seconds() / 3600)
        if first < 0 or last > round((self.end - self.start).total_seconds() / 3600):
            raise ValueError("fake ERDDAP: time out of range")
        return [self.start + timedelta(hours=hour) for hour in range(first, last + 1, stride)]

    # --- responses --------------------------------------------------------
    def info(self, dataset):
        attributes = {
            "date": self.day.strftime("%Y%m%d"),
            "Directional_convention": "meteorological",
            "history": self.history,
            "license": "Creative Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/)",
            "time_coverage_start": fetch_mi_swan.stamp(self.start),
            "time_coverage_end": fetch_mi_swan.stamp(self.end),
            "geospatial_lat_min": AXES[dataset]["lat"][0],
            "geospatial_lat_max": round(AXES[dataset]["lat"][0]
                                        + (AXES[dataset]["lat"][2] - 1) * AXES[dataset]["lat"][1], 10),
            "geospatial_lon_min": AXES[dataset]["lon"][0],
            "geospatial_lon_max": round(AXES[dataset]["lon"][0]
                                        + (AXES[dataset]["lon"][2] - 1) * AXES[dataset]["lon"][1], 10),
            "geospatial_lat_resolution": AXES[dataset]["lat"][1],
            "geospatial_lon_resolution": AXES[dataset]["lon"][1],
        }
        lines = ["Row Type,Variable Name,Attribute Name,Data Type,Value"]
        for name, value in attributes.items():
            lines.append(f'attribute,NC_GLOBAL,{name},String,"{value}"')
        for name in ["time", "latitude", "longitude"]:
            lines.append(f'dimension,{name},,,"nValues=1"')
        for name in list(fetch_mi_swan.SOURCE_VARIABLES.values()) + ["orbital_velocity"]:
            lines.append(f'variable,{name},,float,"time, latitude, longitude"')
        return "\n".join(lines) + "\n"

    def grid(self, dataset, query):
        specs = [BLOCK.match(part) for part in query.split(",")]
        if any(spec is None for spec in specs):
            raise ValueError(f"fake ERDDAP: unparsed query {query}")
        names = [spec.group(1) for spec in specs]
        first = specs[0].groups()
        if any(spec.groups()[1:] != first[1:] for spec in specs):
            raise ValueError("fake ERDDAP: variables must share one index block")
        moments = self.times(fetch_mi_swan.moment(first[1]), fetch_mi_swan.moment(first[3]),
                             int(first[2]))
        latitudes = self.axis(dataset, "lat", float(first[4]), float(first[5]))
        longitudes = self.axis(dataset, "lon", float(first[6]), float(first[7]))
        lines = ["time,latitude,longitude," + ",".join(names),
                 "UTC,degrees_north,degrees_east," + ",".join("m" for _ in names)]
        for when in moments:
            hour = round((when - self.day).total_seconds() / 3600)
            for lat in latitudes:
                for lon in longitudes:
                    cells = []
                    for name in names:
                        key = next(k for k, v in fetch_mi_swan.SOURCE_VARIABLES.items() if v == name)
                        cells.append("NaN" if dry(lat, lon) or (key, hour) in self.holes
                                     else str(source_value(name, dataset, hour, lat, lon)))
                    lines.append(f"{fetch_mi_swan.stamp(when)},{lat},{lon}," + ",".join(cells))
        return "\n".join(lines) + "\n"

    def get(self, url, timeout=None, headers=None):
        self.requests.append(url)
        dataset = SHELF if SHELF in url else NEST
        if "/info/" in url:
            return Response(self.info(dataset))
        query = url.split("?", 1)[1].replace("%20", " ")
        if query == "time[last]":
            return Response(f"time\nUTC\n{fetch_mi_swan.stamp(self.end)}\n")
        return Response(self.grid(dataset, query))


class SwanTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        # A run dated today keeps the freshness and horizon checks meaningful forever.
        self.day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    def run_main(self, *argv, erddap=None, spots=SPOTS):
        self.erddap = erddap or FakeErddap(self.day)
        with patch("fetch_mi_swan.ROOT", self.root), \
             patch("fetch_mi_swan.load_spots", return_value=spots), \
             patch.object(fetch_mi_swan.SESSION, "get", side_effect=self.erddap.get):
            manifest = main(list(argv))
        published = json.loads((self.root / "public/weather/mi-swan.json").read_text())
        self.assertEqual(published, manifest)
        return manifest

    # --- discovery and run mapping ---------------------------------------
    def test_run_is_the_model_day_at_midnight_not_the_hindcast_start(self):
        erddap = FakeErddap(datetime(2026, 9, 16, tzinfo=timezone.utc))
        info = {"attributes": {"date": "20260916"}}
        self.assertEqual(discover(info, erddap.end),
                         datetime(2026, 9, 16, tzinfo=timezone.utc))

    def test_a_model_day_that_does_not_match_the_axis_is_refused(self):
        axis = datetime(2026, 9, 22, tzinfo=timezone.utc)
        for day in ("20260915", "20260917", "", "2026-09-16", "bogus"):
            with self.subTest(day=day), self.assertRaises(ValueError):
                discover({"attributes": {"date": day}}, axis)

    def test_a_late_aggregate_is_refused_rather_than_published_short(self):
        with self.assertRaises(ValueError):
            self.run_main(erddap=FakeErddap(self.day, published=False))

    def test_the_manifest_dates_the_run_from_the_first_forecast_hour(self):
        manifest = self.run_main("--hours", "6")
        self.assertEqual(manifest["run"], self.day.strftime("%Y%m%d%H"))
        self.assertEqual(manifest["runTime"], fetch_mi_swan.stamp(self.day))
        self.assertEqual(manifest["sourceDate"], self.day.strftime("%Y%m%d"))
        self.assertEqual(manifest["sourceUpdated"],
                         self.day.replace(hour=8, minute=58, second=8, tzinfo=None).isoformat())
        self.assertEqual(manifest["spotSeries"]["brandon"][0]["validTime"], manifest["runTime"])
        self.assertEqual(manifest["spotSeries"]["brandon"][-1]["validTime"],
                         fetch_mi_swan.stamp(self.day + timedelta(hours=6)))

    def test_an_unparsable_history_timestamp_leaves_sourceupdated_null(self):
        manifest = self.run_main("--hours", "3",
                                 erddap=FakeErddap(self.day, history="unknown provenance"))
        self.assertIsNone(manifest["sourceUpdated"])
        self.assertEqual(manifest["sourceHistory"], "unknown provenance")

    # --- nearest valid point ---------------------------------------------
    def test_a_dry_home_cell_falls_back_to_the_nearest_wet_neighbour(self):
        record = self.run_main("--hours", "3")["spots"]["brandon"]
        self.assertTrue(record["neighbourSearch"])
        self.assertEqual(record["dataset"], SHELF)
        # The cell containing the spot is dry; the closest wet cell is one step west.
        self.assertEqual((record["cellLat"], record["cellLon"]), (52.2875, -10.0375))
        self.assertAlmostEqual(record["nearestOffsetKm"], 1.58, places=1)
        self.assertLess(record["nearestOffsetKm"], record["searched"][SHELF]["searchKm"])

    def test_a_wet_home_cell_records_no_neighbour_search(self):
        record = self.run_main("--hours", "3")["spots"]["rusheen"]
        self.assertFalse(record["neighbourSearch"])

    def test_a_location_with_no_wet_cell_is_published_as_nulls_with_a_reason(self):
        manifest = self.run_main("--hours", "3")
        record = manifest["spots"]["inland"]
        self.assertIsNone(record["dataset"])
        self.assertIsNone(record["nearestOffsetKm"])
        self.assertIn("No wet Irish Shelf SWAN cell within 8 km", record["reason"])
        series = manifest["spotSeries"]["inland"]
        self.assertEqual(len(series), 4)
        self.assertEqual(set(series[0]["values"]), set(manifest["variables"]))
        self.assertTrue(all(value is None for step in series for value in step["values"].values()))

    def test_the_search_stays_inside_the_declared_limit(self):
        self.run_main("--hours", "3")
        masks = [url for url in self.erddap.requests if "significant_wave_height" in url
                 and "mean_wave_period_tm02" not in url]
        self.assertTrue(masks)
        for url in masks:
            latitudes = re.findall(r"\[\((-?[\d.]+)\):1:\((-?[\d.]+)\)\]", url)
            south, north = float(latitudes[0][0]), float(latitudes[0][1])
            self.assertLess(north - south, 2 * 8.0 / 111.195 + 2e-6)

    # --- nest preference --------------------------------------------------
    def test_the_connemara_nest_wins_for_a_spot_inside_it(self):
        record = self.run_main("--hours", "3")["spots"]["rusheen"]
        self.assertEqual(record["dataset"], NEST)
        self.assertTrue(record["nest"])
        self.assertLess(record["nearestOffsetKm"], 0.3)
        self.assertEqual(record["comparedWith"]["dataset"], SHELF)
        self.assertAlmostEqual(record["comparedWith"]["meanAbsSwhDifferenceM"], 0.2, places=1)
        self.assertGreater(record["comparedWith"]["offsetKm"], record["nearestOffsetKm"])

    def test_outside_the_nest_only_the_shelf_grid_is_queried(self):
        record = self.run_main("--hours", "3")["spots"]["brandon"]
        self.assertEqual(list(record["searched"]), [SHELF])
        self.assertNotIn("comparedWith", record)

    def test_no_nest_uses_the_shelf_grid_everywhere(self):
        manifest = self.run_main("--hours", "3", "--no-nest")
        self.assertEqual(manifest["spots"]["rusheen"]["dataset"], SHELF)
        self.assertFalse(manifest["spots"]["rusheen"]["nest"])
        self.assertIsNone(manifest["nest"])
        self.assertNotIn(NEST, manifest["source"])
        self.assertTrue(all(NEST not in url for url in self.erddap.requests))

    def test_a_nest_on_another_model_day_is_refused(self):
        class Mixed(FakeErddap):
            def info(self, dataset):
                text = super().info(dataset)
                if dataset == NEST:
                    text = text.replace(self.day.strftime("%Y%m%d"),
                                        (self.day - timedelta(days=1)).strftime("%Y%m%d"), 1)
                return text
        with self.assertRaises(ValueError):
            self.run_main("--hours", "3", erddap=Mixed(self.day))

    # --- values -----------------------------------------------------------
    def test_wind_sea_height_is_derived_and_clamped(self):
        self.assertEqual(wind_sea(2.0, 1.2), 1.6)
        self.assertEqual(wind_sea(1.0, 2.0), 0.0)  # Never a negative square root.
        self.assertIsNone(wind_sea(None, 1.0))
        self.assertIsNone(wind_sea(1.0, None))

    def test_the_published_series_derives_wind_sea_from_its_own_heights(self):
        series = self.run_main("--hours", "6")["spotSeries"]["brandon"]
        for step in series:
            values = step["values"]
            self.assertEqual(values["shww"],
                             round(math.sqrt(values["swh"] ** 2 - values["hswe"] ** 2), 2))
            self.assertGreater(values["swh"], values["hswe"])
            self.assertEqual(values["spread"], 24.5)

    def test_a_missing_source_value_becomes_null_without_losing_the_step(self):
        manifest = self.run_main("--hours", "6",
                                 erddap=FakeErddap(self.day, holes=[("mwp", 3), ("swh", 3)]))
        step = manifest["spotSeries"]["brandon"][3]
        self.assertEqual(step["hour"], 3)
        self.assertIsNone(step["values"]["mwp"])
        self.assertIsNone(step["values"]["swh"])
        self.assertIsNone(step["values"]["shww"])  # Derived only from present inputs.
        self.assertIsNotNone(step["values"]["pp1d"])
        self.assertIsNotNone(manifest["spotSeries"]["brandon"][2]["values"]["mwp"])

    def test_an_implausible_source_value_fails_the_run(self):
        class Silly(FakeErddap):
            def grid(self, dataset, query):
                return super().grid(dataset, query).replace(",24.5", ",999.0")
        with self.assertRaises(ValueError):
            self.run_main("--hours", "3", erddap=Silly(self.day))

    # --- contract ---------------------------------------------------------
    def test_a_frameless_run_satisfies_the_wave_contract(self):
        manifest = self.run_main("--hours", "48", "--step", "3")
        self.assertEqual((manifest["kind"], manifest["model"], manifest["stepHours"]),
                         ("wave", "mi-swan", 3))
        self.assertEqual(manifest["frames"], [])
        self.assertEqual(manifest["horizonHours"], 48)
        self.assertNotIn("grid", manifest)
        self.assertEqual(manifest["attribution"], fetch_mi_swan.ATTRIBUTION)
        self.assertEqual(manifest["licenseUrl"], "https://creativecommons.org/licenses/by/4.0/")
        _, _, objects = validate_bundle(self.root / "public", "mi-swan", max_age_hours=36)
        self.assertEqual(objects, [])
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root / "public", "mi-swan", "test", max_age_hours=36),
                         "published")
        self.assertEqual(s3.writes[-1], "weather/mi-swan.json")
        self.assertIn("weather/manifests/mi-swan/", s3.writes[-2])
        self.assertEqual(len(s3.writes), 2)  # The archived manifest, then the pointer.

    def test_frames_are_optional_and_published_north_to_south(self):
        with patch("fetch_mi_swan.FRAME_BOX", (-10.0, 53.0, -9.9, 53.1)):
            manifest = self.run_main("--hours", "48", "--step", "3", "--frames")
        grid = manifest["grid"]
        self.assertEqual((grid["width"], grid["height"]), (4, 4))
        self.assertEqual((grid["north"], grid["south"]), (53.0875, 53.0125))
        self.assertEqual(len(manifest["frames"]), 17)
        self.assertEqual(manifest["frameVariables"], ["swh", "mwp", "mwd"])
        frame = json.loads((self.root / "public" / manifest["frames"][0]["url"]).read_text())
        self.assertEqual(sorted(k for k in frame if isinstance(frame[k], list)),
                         ["mwd", "mwp", "swh"])
        self.assertEqual(len(frame["swh"]), 16)
        # Row 0 is the northern edge, so its heights exceed the southern row's.
        self.assertGreater(frame["swh"][0], frame["swh"][12])
        _, _, objects = validate_bundle(self.root / "public", "mi-swan", max_age_hours=36)
        self.assertEqual(len(objects), 17)

    def test_every_riding_location_gets_a_series_of_every_variable(self):
        manifest = self.run_main("--hours", "24", "--step", "3")
        self.assertEqual(sorted(manifest["spotSeries"]), sorted(spot["id"] for spot in SPOTS))
        for steps in manifest["spotSeries"].values():
            self.assertEqual([step["hour"] for step in steps], list(range(0, 25, 3)))
            for step in steps:
                self.assertEqual(set(step["values"]), set(manifest["variables"]))
        for meta in manifest["variables"].values():
            self.assertTrue(all(meta[key].strip() for key in ("units", "label", "description")))

    def test_raw_responses_are_cached_per_run_and_not_refetched(self):
        self.run_main("--hours", "3")
        cache = self.root / ".cache" / "mi-swan" / self.day.strftime("%Y%m%d%H")
        self.assertTrue(any(cache.glob("*-mask-brandon.csv")))
        before = len(self.erddap.requests)
        with patch("fetch_mi_swan.ROOT", self.root), \
             patch("fetch_mi_swan.load_spots", return_value=SPOTS), \
             patch.object(fetch_mi_swan.SESSION, "get", side_effect=self.erddap.get):
            main(["--hours", "3"])
        self.assertEqual(len(self.erddap.requests), before)

    def test_a_failed_run_preserves_the_last_published_manifest(self):
        published = self.root / "public/weather/mi-swan.json"
        published.parent.mkdir(parents=True)
        published.write_text('{"run":"last-good"}')
        with self.assertRaises(ValueError):
            self.run_main("--hours", "3", erddap=FakeErddap(self.day, published=False))
        self.assertEqual(json.loads(published.read_text()), {"run": "last-good"})

    def test_impossible_horizons_are_refused(self):
        for argv in (["--hours", "0"], ["--hours", "168"], ["--hours", "7", "--step", "3"]):
            with self.subTest(argv=argv), self.assertRaises(SystemExit):
                self.run_main(*argv)


if __name__ == "__main__":
    unittest.main()
