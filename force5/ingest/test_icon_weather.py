"""Offline ICON-EU surface weather tests: no network, real GRIB headers where it matters.

The metadata fixtures below are the headers DWD's own 18 UTC files carry at +3 h,
read from the live open-data index on 17 September 2026, so a change in what the
provider publishes shows up here as a failing expectation rather than as a silent
unit error in the published bundle.
"""
import bz2
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import eccodes as ec
import numpy as np

import fetch_icon_weather
from fetch_icon_weather import (DIRECTORIES, VARIABLES, convert, decode, derive_precip, discover,
                               main, parse_args, sample_variable, validate_metadata)
from publish_s3 import validate_bundle
from registry import UNCHANGED_EXIT

RUN = "2026091618"
HOUR = 3
# Keys every ICON-EU single-level message shares at +3 h of the 18 UTC run.
SHARED = {"gridType": "regular_ll", "uvRelativeToGrid": 0, "stepUnits": 1, "startStep": HOUR,
          "endStep": HOUR, "stepType": "instant", "dataDate": 20260916, "dataTime": 1800,
          "validityDate": 20260916, "validityTime": 2100}
# The parameter, surface and units of each published field, as DWD writes them.
HEADERS = {
    "t2m": {"parameterCategory": 0, "parameterNumber": 0, "units": "K", "level": 2,
            "typeOfLevel": "heightAboveGround"},
    "td2m": {"parameterCategory": 0, "parameterNumber": 6, "units": "K", "level": 2,
             "typeOfLevel": "heightAboveGround"},
    "rh2m": {"parameterCategory": 1, "parameterNumber": 1, "units": "%", "level": 2,
             "typeOfLevel": "heightAboveGround"},
    # The only accumulation: it runs from initialization, so its start step is 0.
    "tp": {"parameterCategory": 1, "parameterNumber": 52, "units": "kg m**-2", "level": 0,
           "typeOfLevel": "surface", "stepType": "accum", "startStep": 0},
    "clct": {"parameterCategory": 6, "parameterNumber": 1, "units": "%", "level": 0,
             "typeOfLevel": "surface"},
    # ecCodes cannot name the ground-to-800 hPa layer, and does name the other two.
    "clcl": {"parameterCategory": 6, "parameterNumber": 22, "units": "%", "level": 800,
             "typeOfLevel": "unknown"},
    "clcm": {"parameterCategory": 6, "parameterNumber": 22, "units": "%", "level": 400,
             "typeOfLevel": "isobaricLayer"},
    "clch": {"parameterCategory": 6, "parameterNumber": 22, "units": "%", "level": 0,
             "typeOfLevel": "isobaricLayer"},
    "pmsl": {"parameterCategory": 3, "parameterNumber": 1, "units": "Pa", "level": 0,
             "typeOfLevel": "meanSea"},
    "vis": {"parameterCategory": 19, "parameterNumber": 0, "units": "m", "level": 0,
            "typeOfLevel": "surface"},
    "cape": {"parameterCategory": 7, "parameterNumber": 6, "units": "J kg-1", "level": 0,
             "typeOfLevel": "unknown"},
    "ww": {"parameterCategory": 19, "parameterNumber": 25, "units": "Numeric", "level": 0,
           "typeOfLevel": "surface"},
    "tg": {"parameterCategory": 0, "parameterNumber": 0, "units": "K", "level": 0,
           "typeOfLevel": "surface"},
}
# Constructing a message needs a level ecCodes can write; the real cloud layers and
# mean-layer CAPE cannot be round-tripped through a sample, so they are built on the
# nearest level type the validator also accepts.
BUILDABLE = {"clcl": {"typeOfLevel": "isobaricLayer"}, "clcm": {}, "clch": {},
             "cape": {"typeOfLevel": "surface"},
             "tp": {"productDefinitionTemplateNumber": 8, "typeOfStatisticalProcessing": 1}}


def header(field, **changes):
    return {**SHARED, **HEADERS[field], **changes}


class MetadataTests(unittest.TestCase):
    def test_every_published_parameter_matches_its_real_dwd_header(self):
        self.assertEqual(set(HEADERS), set(DIRECTORIES))
        for field in DIRECTORIES:
            with self.subTest(field=field):
                validate_metadata(header(field), field, RUN, HOUR)

    def test_a_foreign_parameter_surface_or_unit_is_refused(self):
        cases = [
            # T_G is the same parameter as T_2M at a different surface, and the pair
            # is the easiest confusion this importer could publish.
            ("t2m", {"typeOfLevel": "surface", "level": 0}),
            ("tg", {"typeOfLevel": "heightAboveGround", "level": 2}),
            ("clcl", {"level": 400}),          # That is CLCM.
            ("clch", {"parameterNumber": 1}),  # That is CLCT.
            ("t2m", {"units": "C"}),
            ("td2m", {"parameterNumber": 0}),
            ("rh2m", {"units": "1"}),
            ("pmsl", {"units": "hPa"}),
            ("vis", {"units": "km"}),
            ("cape", {"parameterCategory": 6}),
            ("ww", {"units": "%"}),
            ("t2m", {"gridType": "reduced_gg"}),
        ]
        for field, changes in cases:
            with self.subTest(field=field, changes=changes), self.assertRaises(ValueError):
                validate_metadata(header(field, **changes), field, RUN, HOUR)

    def test_accumulations_must_run_from_initialization(self):
        for field, changes in [("tp", {"startStep": HOUR}), ("tp", {"stepType": "instant"}),
                               ("t2m", {"stepType": "accum"}), ("t2m", {"startStep": 0}),
                               ("tp", {"endStep": 6}), ("tp", {"stepUnits": 0})]:
            with self.subTest(field=field, changes=changes), self.assertRaises(ValueError):
                validate_metadata(header(field, **changes), field, RUN, HOUR)

    def test_a_mixed_run_or_valid_time_is_refused(self):
        for changes in [{"dataTime": 1200}, {"dataDate": 20260915}, {"validityTime": 2200},
                        {"validityDate": 20260917}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_metadata(header("t2m", **changes), "t2m", RUN, HOUR)


class ConversionTests(unittest.TestCase):
    def convert(self, field, values):
        return convert(field, np.asarray(values, dtype=float))

    def test_kelvin_pascals_and_metres_become_the_units_the_site_shows(self):
        self.assertEqual(self.convert("t2m", [273.15, 283.25, 291.049]), [0.0, 10.1, 17.9])
        self.assertEqual(self.convert("td2m", [280.15]), [7.0])
        self.assertEqual(self.convert("tg", [288.4529]), [15.3])
        self.assertEqual(self.convert("pmsl", [101325.0, 97605.79]), [1013.2, 976.1])
        self.assertEqual(self.convert("vis", [77578.0, 250.0]), [77.6, 0.2])
        self.assertEqual(self.convert("cape", [3185.875, 0.4]), [3186, 0])
        self.assertEqual(self.convert("tp", [0.0, 24.147]), [0.0, 24.1])

    def test_percentages_are_whole_numbers_clipped_into_range(self):
        # DWD publishes 100.0006 % humidity; that is rounding, not supersaturation.
        self.assertEqual(self.convert("rh2m", [6.2154, 74.6839, 100.0006]), [6, 75, 100])
        self.assertEqual(self.convert("clct", [0.0, 64.7915, 100.0]), [0, 65, 100])
        for field in ("clcl", "clcm", "clch"):
            self.assertEqual(self.convert(field, [-0.2, 99.6]), [0, 100])
        self.assertTrue(all(isinstance(value, int) for value in self.convert("clct", [50.4])))

    def test_present_weather_stays_a_whole_code(self):
        self.assertEqual(self.convert("ww", [0.0, 45.0, 95.0, 96.0]), [0, 45, 95, 96])
        self.assertTrue(all(isinstance(value, int) for value in self.convert("ww", [61.0])))
        for values in ([12.5], [-1.0], [120.0]):
            with self.subTest(values=values), self.assertRaises(ValueError):
                self.convert("ww", values)

    def test_an_implausible_value_fails_the_run_rather_than_publishing(self):
        for field, values in [("t2m", [400.0]), ("t2m", [100.0]), ("pmsl", [50000.0]),
                              ("vis", [-600.0]), ("cape", [-10.0]), ("tp", [-5.0]),
                              ("rh2m", [-8.0]), ("clct", [140.0])]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.convert(field, values)


class PrecipitationTests(unittest.TestCase):
    def test_the_interval_amount_is_the_accumulation_increase(self):
        self.assertEqual(derive_precip([1.4, 2.0, 0.0, 12.5], [0.0, 2.0, 0.0, 10.1]),
                         [1.4, 0.0, 0.0, 2.4])

    def test_a_decrease_is_clamped_to_zero_not_published_as_negative_rain(self):
        self.assertEqual(derive_precip([0.9, 0.0], [1.0, 3.4]), [0.0, 0.0])

    def test_sampling_is_bilinear_except_for_the_code_table(self):
        grid = {"width": 2, "height": 2, "west": -10.0, "north": 54.0, "dx": 1.0, "dy": 1.0}
        self.assertEqual(sample_variable(grid, [0.0, 10.0, 20.0, 30.0], -9.5, 53.5, "t2m"), 15.0)
        self.assertEqual(sample_variable(grid, [0, 10, 20, 30], -9.5, 53.5, "clct"), 15)
        # A code is read from the cell the spot is in: 45 (fog) never averages to 23.
        self.assertEqual(sample_variable(grid, [0, 45, 0, 0], -9.4, 53.9, "ww"), 45)
        self.assertEqual(sample_variable(grid, [0, 45, 0, 0], -9.9, 53.9, "ww"), 0)
        self.assertIsNone(sample_variable(grid, [0, 45, 0, 0], -30.0, 53.9, "ww"))
        self.assertIsNone(sample_variable(grid, [0.0] * 4, -30.0, 53.9, "t2m"))


class DecodeTests(unittest.TestCase):
    """Real GRIB2 messages, built from an ecCodes sample with DWD's own tables."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def grib(self, field, values, hour=HOUR, **changes):
        entry = VARIABLES[field]
        handle = ec.codes_grib_new_from_samples("regular_ll_sfc_grib2")
        try:
            # 342°E/342.25°E is 18°W/17.75°W once normalised, inside the Ireland crop.
            keys = {"centre": "edzw", "localTablesVersion": 1, "dataDate": 20260916,
                    "dataTime": 1800, "stepUnits": 1, "Ni": 2, "Nj": 2,
                    "latitudeOfFirstGridPointInDegrees": 54.25,
                    "latitudeOfLastGridPointInDegrees": 54.1875,
                    "longitudeOfFirstGridPointInDegrees": 342.0,
                    "longitudeOfLastGridPointInDegrees": 342.0625,
                    "iDirectionIncrementInDegrees": 0.0625,
                    "jDirectionIncrementInDegrees": 0.0625,
                    "parameterCategory": entry["category"], "parameterNumber": entry["number"],
                    "typeOfLevel": HEADERS[field]["typeOfLevel"], "level": entry["level"],
                    **BUILDABLE.get(field, {}), **changes}
            for key, value in keys.items():
                ec.codes_set(handle, key, value)
            if entry["stepType"] == "accum":
                ec.codes_set(handle, "startStep", 0)
                ec.codes_set(handle, "endStep", hour)
            else:
                ec.codes_set(handle, "forecastTime", hour)
            ec.codes_set_values(handle, values)
            message = ec.codes_get_message(handle)
        finally:
            ec.codes_release(handle)
        path = Path(tempfile.mkstemp(suffix=".grib2.bz2", dir=self.root)[1])
        path.write_bytes(bz2.compress(message))
        return path

    def test_each_field_decodes_through_the_shared_crop_in_published_units(self):
        cases = {"t2m": ([273.15, 274.15, 275.15, 276.15], [0.0, 1.0, 2.0, 3.0]),
                 "rh2m": ([80.4, 90.6, 100.0006, 12.0], [80, 91, 100, 12]),
                 "pmsl": ([101325.0] * 4, [1013.2] * 4),
                 "vis": ([1000.0, 2000.0, 3000.0, 77578.0], [1.0, 2.0, 3.0, 77.6]),
                 "ww": ([0.0, 61.0, 95.0, 3.0], [0, 61, 95, 3]),
                 "tp": ([0.0, 1.2, 2.5, 0.0], [0.0, 1.2, 2.5, 0.0])}
        layout = None
        for field, (raw, published) in cases.items():
            with self.subTest(field=field):
                values, layout, metadata = decode(self.grib(field, raw), field, RUN, HOUR, layout)
                self.assertEqual(values, published)
                self.assertEqual(metadata["endStep"], HOUR)
        grid = layout[2]
        self.assertEqual((grid["width"], grid["height"]), (2, 2))
        self.assertEqual((grid["west"], grid["east"], grid["north"]), (-18.0, -17.9375, 54.25))
        self.assertEqual((grid["dx"], grid["dy"]), (0.0625, 0.0625))
        self.assertEqual(grid["order"], "north-to-south, west-to-east")

    def test_a_foreign_centre_or_wrong_field_never_decodes(self):
        with self.assertRaises(ValueError):  # An ECMWF message is not ICON-EU.
            decode(self.grib("t2m", [273.15] * 4, centre="ecmf"), "t2m", RUN, HOUR)
        with self.assertRaises(ValueError):  # T_G read as if it were T_2M.
            decode(self.grib("tg", [288.0] * 4), "t2m", RUN, HOUR)
        with self.assertRaises(ValueError):  # The wrong lead time.
            decode(self.grib("t2m", [273.15] * 4, hour=6), "t2m", RUN, HOUR)
        with self.assertRaises(ValueError):  # Kelvin masquerading as Celsius.
            decode(self.grib("t2m", [400.0] * 4), "t2m", RUN, HOUR)


class DiscoveryTests(unittest.TestCase):
    def test_the_newest_run_with_every_field_at_every_hour_wins(self):
        def inventory(cycle, directory):
            if cycle == "12":
                return {("2026091612", hour): f"url/{directory}/{hour}" for hour in (0, 3)}
            if cycle == "18":
                # 18 UTC is still publishing: ww has arrived only at hour 0.
                hours = (0,) if directory == "ww" else (0, 3)
                return {("2026091618", hour): f"url/{directory}/{hour}" for hour in hours}
            return {}
        with patch("fetch_icon_weather.listing", side_effect=inventory), \
             redirect_stdout(io.StringIO()):
            run, urls = discover([0, 3])
        self.assertEqual(run, "2026091612")
        self.assertEqual(len(urls), 2 * len(DIRECTORIES))

    def test_an_unreadable_index_is_reported_and_skipped(self):
        def flaky(cycle, directory):
            if cycle == "18":
                raise OSError("index unavailable")
            return {("2026091612", hour): "url" for hour in (0, 3)} if cycle == "12" else {}
        errors = io.StringIO()
        with patch("fetch_icon_weather.listing", side_effect=flaky), redirect_stderr(errors), \
             redirect_stdout(io.StringIO()):
            self.assertEqual(discover([0, 3])[0], "2026091612")
            with self.assertRaises(RuntimeError):
                discover([0, 3, 6])
        self.assertIn("Inventory unavailable", errors.getvalue())

    def test_horizon_step_and_frame_variable_arguments_are_checked(self):
        args = parse_args([])
        self.assertEqual((args.hours, args.step), (72, 3))
        self.assertEqual(args.frame_variables, ["t2m", "precip", "clct", "pmsl", "ww"])
        self.assertEqual(parse_args(["--frame-variables", "all"]).frame_variables, list(VARIABLES))
        for arguments in [["--hours", "0"], ["--hours", "96"], ["--hours", "10", "--step", "3"],
                          ["--step", "2"], ["--run", "2026091613"], ["--run", "nonsense"],
                          ["--frame-variables", "t2m,t2m"], ["--frame-variables", "swh"],
                          ["--frame-variables", ""]]:
            with self.subTest(arguments=arguments), redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    parse_args(arguments)


class BundleTests(unittest.TestCase):
    """The published bundle, end to end, against the shared publisher contract."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.spots = self.root / "spots.json"
        # brandon sits in the north-west cell of the fake crop; faraway is off it.
        self.spots.write_text(json.dumps([{"id": "brandon", "lat": 54.24, "lon": -17.99},
                                          {"id": "faraway", "lat": 40.0, "lon": 20.0}]))
        now = datetime.now(timezone.utc)
        self.run = now.replace(minute=0, second=0, microsecond=0,
                               hour=now.hour // 6 * 6).strftime("%Y%m%d%H")
        self.run_time = datetime.strptime(self.run, "%Y%m%d%H").replace(tzinfo=timezone.utc)

    def fake_decode(self, path, field, run, hour, layout=None):
        """Two-by-two fields whose values depend on the field and the lead time."""
        grid = {"width": 2, "height": 2, "west": -18.0, "east": -17.9375, "north": 54.25,
                "south": 54.1875, "dx": 0.0625, "dy": 0.0625,
                "order": "north-to-south, west-to-east", "units": "m/s"}
        base = {"t2m": 14.2, "td2m": 9.1, "rh2m": 82, "clct": 65, "clcl": 40, "clcm": 30,
                "clch": 20, "pmsl": 1013.2, "vis": 24.5, "cape": 120}
        values = [base.get(field, 12.0)] * 4
        if field == "tp":
            values = [round(1.5 * hour / 3, 1)] * 4  # 1.5 mm in every three-hour step.
        if field == "ww":
            # Fog in the north-west cell only: a code is read, never interpolated.
            values = [45, 0, 0, 0]
        return values, (("signature",), None, grid), {"endStep": hour}

    def run_main(self, argv=(), decode=None):
        with patch("sys.argv", ["fetch_icon_weather.py", "--hours", "6", "--step", "3",
                               "--run", self.run, *argv]), \
             patch("fetch_icon_weather.ROOT", self.root), \
             patch.dict("os.environ", {"FORCE5_SPOTS_FILE": str(self.spots)}, clear=True), \
             patch("fetch_icon_weather.discover",
                   return_value=(self.run, {(hour, field): f"url/{field}/{hour}"
                                            for hour in (0, 3, 6) for field in DIRECTORIES})), \
             patch("fetch_icon_weather.get", return_value=bz2.compress(b"GRIB-stub")), \
             patch("fetch_icon_weather.decode", side_effect=decode or self.fake_decode), \
             patch("sys.stdout", io.StringIO()):
            main()
        return json.loads((self.root / "public/weather/icon-eu-weather.json").read_text())

    def test_publishes_the_variables_contract_and_passes_the_publisher(self):
        manifest = self.run_main()
        self.assertEqual((manifest["kind"], manifest["model"], manifest["provider"]),
                         ("weather", "icon-eu-weather", "DWD"))
        self.assertEqual(manifest["stepHours"], 3)
        self.assertNotIn("stepRanges", manifest)
        self.assertEqual(set(manifest["variables"]), set(VARIABLES))
        self.assertEqual(manifest["variables"]["ww"]["kind"], "code")
        self.assertNotIn("kind", manifest["variables"]["t2m"])
        self.assertEqual(manifest["frameVariables"], ["t2m", "precip", "clct", "pmsl", "ww"])
        # A weather frame carries many units, so the grid declares none.
        self.assertNotIn("units", manifest["grid"])
        self.assertEqual([frame["hour"] for frame in manifest["frames"]], [0, 3, 6])
        self.assertEqual([frame["precipIntervalHours"] for frame in manifest["frames"]],
                         [None, [0, 3], [3, 6]])
        published, _, objects = validate_bundle(self.root / "public", "icon-eu-weather", 12,
                                                self.run_time + timedelta(hours=1))
        self.assertEqual((published["run"], len(objects)), (self.run, 3))

    def test_precipitation_is_null_at_initialization_and_differenced_after_it(self):
        manifest = self.run_main()
        series = manifest["spotSeries"]["brandon"]
        self.assertEqual([step["values"]["precip"] for step in series], [None, 1.5, 1.5])
        self.assertEqual([step["values"]["tp"] for step in series], [0.0, 1.5, 3.0])
        self.assertEqual([step["precipIntervalHours"] for step in series],
                         [None, [0, 3], [3, 6]])
        first, second = (json.loads((self.root / "public" / info["url"]).read_text())
                         for info in manifest["frames"][:2])
        self.assertEqual(first["precip"], [None] * 4)      # Nulls, never a zeroed field.
        self.assertEqual(second["precip"], [1.5] * 4)
        self.assertEqual(first["ww"], [45, 0, 0, 0])

    def test_every_variable_is_sampled_for_every_spot_including_one_off_the_grid(self):
        manifest = self.run_main()
        for spot, expected in (("brandon", 14.2), ("faraway", None)):
            with self.subTest(spot=spot):
                values = manifest["spotSeries"][spot][1]["values"]
                self.assertEqual(set(values), set(VARIABLES))
                self.assertEqual(values["t2m"], expected)
        # Codes are read from the containing cell, never interpolated between cells.
        self.assertEqual(manifest["spotSeries"]["brandon"][0]["values"]["ww"], 45)
        self.assertIsNone(manifest["spotSeries"]["faraway"][0]["values"]["ww"])

    def test_frames_may_carry_every_variable_when_asked(self):
        manifest = self.run_main(["--frame-variables", "all"])
        self.assertEqual(manifest["frameVariables"], list(VARIABLES))
        frame = json.loads((self.root / "public" / manifest["frames"][2]["url"]).read_text())
        for name in VARIABLES:
            self.assertEqual(len(frame[name]), 4, name)
        validate_bundle(self.root / "public", "icon-eu-weather", 12,
                        self.run_time + timedelta(hours=1))

    def test_a_stale_run_is_refused_before_anything_is_downloaded(self):
        output = self.root / "public/weather/icon-eu-weather.json"
        output.parent.mkdir(parents=True)
        output.write_text('{"run":"last-good"}')
        with patch("sys.argv", ["fetch_icon_weather.py", "--hours", "6", "--run", "2020010100"]), \
             patch("fetch_icon_weather.ROOT", self.root), \
             patch("fetch_icon_weather.discover",
                   return_value=("2020010100", {(0, "t2m"): "url"})), \
             patch("fetch_icon_weather.get") as get:
            with self.assertRaises(ValueError):
                main()
            get.assert_not_called()
        self.assertEqual(json.loads(output.read_text()), {"run": "last-good"})

    def test_a_download_that_is_not_grib_preserves_the_published_manifest(self):
        output = self.root / "public/weather/icon-eu-weather.json"
        output.parent.mkdir(parents=True)
        output.write_text('{"run":"last-good"}')
        with patch("sys.argv", ["fetch_icon_weather.py", "--hours", "6", "--run", self.run]), \
             patch("fetch_icon_weather.ROOT", self.root), \
             patch("fetch_icon_weather.discover",
                   return_value=(self.run, {(0, "t2m"): "url"})), \
             patch("fetch_icon_weather.get",
                   return_value=bz2.compress(b"<html>error</html>")), \
             patch("sys.stdout", io.StringIO()):
            with self.assertRaises(ValueError):
                main()
        self.assertEqual(json.loads(output.read_text()), {"run": "last-good"})

    def run_against_the_bucket(self, published, *argv):
        """main() with the bucket serving `published`; downloads fail if attempted."""
        with patch("sys.argv", ["fetch_icon_weather.py", "--hours", "6", *argv]), \
             patch("fetch_icon_weather.ROOT", self.root), \
             patch.dict("os.environ", {"FORCE5_PUBLISHED_RUN": published}), \
             patch("fetch_icon_weather.discover",
                   return_value=(self.run, {(0, "t2m"): "url"})), \
             patch("fetch_icon_weather.get", side_effect=OSError("DWD")) as get, \
             patch("sys.stdout", io.StringIO()):
            try:
                result = main()
            except OSError:
                result = "downloaded"
        self.assertFalse((self.root / "public/weather/icon-eu-weather.json").exists())
        return result, get

    def test_the_run_the_bucket_serves_is_not_downloaded_again(self):
        result, get = self.run_against_the_bucket(self.run)
        self.assertEqual(result, UNCHANGED_EXIT)
        get.assert_not_called()

    def test_a_newer_run_or_an_explicit_run_is_downloaded(self):
        older = (self.run_time - timedelta(hours=6)).strftime("%Y%m%d%H")
        self.assertEqual(self.run_against_the_bucket(older)[0], "downloaded")
        self.assertEqual(self.run_against_the_bucket(self.run, "--run", self.run)[0], "downloaded")

    def test_the_registry_entry_points_at_this_importer(self):
        from registry import MODELS
        self.assertEqual(MODELS["icon-eu-weather"],
                         {"script": "fetch_icon_weather.py",
                          "manifest": "weather/icon-eu-weather.json",
                          "kind": "weather", "maxAgeHours": 30, "cache": "grib",
                          "readsPublishedRun": True})
        self.assertEqual(fetch_icon_weather.MODEL, "icon-eu-weather")


if __name__ == "__main__":
    unittest.main()
