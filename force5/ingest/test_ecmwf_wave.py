from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import eccodes as ec

from cadence import ECMWF_HOURS, ECMWF_RANGES, expected_hours
import fetch_ecmwf_wave
from fetch_ecmwf_wave import (ALL_VARIABLES, BANDS, DIRECTION, MODEL, NEAREST_LIMIT_KM, SEA,
                              cadence_for, coverage_for, crop_values, decode, main,
                              manifest_for, parse_args, read_spot, run_datetime, spot_plans)
from publish_s3 import publish, validate_bundle
from test_publish_s3 import FakeS3

# The identity the live 0.25° wave stream carries, read on 17 September 2026.
WAVE_HEADERS = {"centre": "ecmf", "marsClass": "od", "marsStream": "wave", "dataType": "fc"}
MISSING = 9999.0
# A 3 × 3 grid over 54.25–53.75°N / 8–7.5°W, rows north-to-south. Cell 1 — the
# middle of the top row — is the one the model did not solve:
#   row 0 (54.25°N): wet  LAND wet
#   row 1 (54.00°N): wet  wet  wet
#   row 2 (53.75°N): wet  wet  wet
LAND = (1,)
SPOTS = [{"id": "wet", "lon": -8.0, "lat": 53.75},      # its four cells are all solved
         {"id": "dry", "lon": -7.875, "lat": 54.25},    # its stencil includes cell 1
         {"id": "far", "lon": 2.0, "lat": 48.0}]        # nowhere near the grid


def wave_values(kind, size=9, base=2.0):
    values = [base + index / 10 for index in range(size)]
    for index in LAND:
        values[index] = MISSING
    return values


class WaveGribTests(unittest.TestCase):
    """Real GRIB messages, bitmap and all, decoded by the shipped importer."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def message(self, stream, name, changes=None, values=None):
        entry = ALL_VARIABLES[name]
        handle = ec.codes_grib_new_from_samples("regular_ll_sfc_grib2")
        try:
            # The MARS keys live in ECMWF's local section; every real file has one.
            ec.codes_set(handle, "setLocalDefinition", 1)
            metadata = {**WAVE_HEADERS, "discipline": 10, "parameterCategory": 0,
                        "parameterNumber": entry["number"],
                        "typeOfFirstFixedSurface": 1 if entry["level"] == "surface" else 101,
                        "dataDate": 20260916, "dataTime": 0, "stepUnits": 1,
                        "forecastTime": 6, "Ni": 3, "Nj": 3,
                        "latitudeOfFirstGridPointInDegrees": 54.25,
                        "latitudeOfLastGridPointInDegrees": 53.75,
                        "longitudeOfFirstGridPointInDegrees": 352,
                        "longitudeOfLastGridPointInDegrees": 352.5,
                        "iDirectionIncrementInDegrees": 0.25,
                        "jDirectionIncrementInDegrees": 0.25,
                        "uvRelativeToGrid": 0, **(changes or {})}
            for key, value in metadata.items():
                ec.codes_set(handle, key, value)
            ec.codes_set(handle, "paramId", entry["id"])
            ec.codes_set(handle, "missingValue", MISSING)
            if "bitmapPresent" not in metadata:
                ec.codes_set(handle, "bitmapPresent", 1)
            ec.codes_set_values(handle, values if values is not None
                                else wave_values(entry["kind"]))
            ec.codes_write(handle, stream)
        finally:
            ec.codes_release(handle)

    def grib(self, names=None, changes=None, values=None, name="wave.grib2"):
        path = self.root / name
        with path.open("wb") as stream:
            for variable in names if names is not None else list(ALL_VARIABLES):
                self.message(stream, variable, changes, (values or {}).get(variable))
        return path

    def test_decodes_every_variable_and_nulls_the_land(self):
        fields, masks, layout = decode(self.grib(), "2026091600", 6, list(ALL_VARIABLES))
        self.assertEqual(set(fields), set(ALL_VARIABLES))
        self.assertEqual(layout[2]["width"] * layout[2]["height"], 9)
        for name in ALL_VARIABLES:
            with self.subTest(name=name):
                # Land is null, never zero: a zero would read as a measured calm.
                self.assertIsNone(fields[name][1])
                self.assertEqual([bool(masks[name][i]) for i in LAND], [False])
                self.assertIsNotNone(fields[name][0])
                self.assertIsNotNone(fields[name][4])

    def test_publishes_no_wind_units_on_a_wave_grid(self):
        """The shared crop labels its grid m/s; a wave grid declares units per variable."""
        _, _, layout = decode(self.grib(), "2026091600", 6, list(ALL_VARIABLES))
        self.assertNotIn("units", layout[2])

    def test_refuses_a_field_with_no_land_bitmap(self):
        path = self.root / "nobitmap.grib2"
        with path.open("wb") as stream:
            self.message(stream, "swh", changes={"bitmapPresent": 0})
        with self.assertRaises(ValueError) as caught:
            decode(path, "2026091600", 6, ["swh"])
        self.assertIn("bitmap", str(caught.exception))

    def test_tells_a_band_height_from_the_total_sea(self):
        """They share category 0 / number 3; only the paramId separates them."""
        self.assertEqual(SEA["swh"]["number"], BANDS["h2530"]["number"])
        fields, _, _ = decode(self.grib(["swh", "h2530"]), "2026091600", 6,
                              ["swh", "h2530"])
        self.assertEqual(set(fields), {"swh", "h2530"})

    def test_refuses_the_wrong_stream_class_or_centre(self):
        for changes in [{"marsStream": "oper"}, {"marsClass": "ai"}, {"dataType": "an"}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                decode(self.grib(["swh"], changes), "2026091600", 6, ["swh"])

    def test_refuses_a_missing_duplicate_or_unrequested_variable(self):
        with self.assertRaises(ValueError):  # swh absent
            decode(self.grib(["mwd"]), "2026091600", 6, ["swh", "mwd"])
        with self.assertRaises(ValueError):  # swh twice
            decode(self.grib(["swh", "swh"]), "2026091600", 6, ["swh"])
        with self.assertRaises(ValueError):  # a band arrived that was not asked for
            decode(self.grib(["swh", "h1012"]), "2026091600", 6, ["swh"])

    def test_refuses_a_wrong_run_or_lead_time(self):
        for changes in [{"dataDate": 20260915}, {"forecastTime": 9}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                decode(self.grib(["swh"], changes), "2026091600", 6, ["swh"])

    def test_refuses_an_implausible_height_or_a_dead_period(self):
        with self.assertRaises(ValueError):
            decode(self.grib(["swh"], values={"swh": [40.0] * 9}), "2026091600", 6, ["swh"])
        with self.assertRaises(ValueError):
            decode(self.grib(["pp1d"], values={"pp1d": [0.0] * 9}), "2026091600", 6, ["pp1d"])

    def test_refuses_a_field_that_is_all_land(self):
        with self.assertRaises(ValueError) as caught:
            decode(self.grib(["swh"], values={"swh": [MISSING] * 9}), "2026091600", 6, ["swh"])
        self.assertIn("No water", str(caught.exception))


class WaveCroppingTests(unittest.TestCase):
    def test_a_direction_just_over_a_full_turn_is_normalised_not_rejected(self):
        """The source writes 360.001; a bare 0–360 range check would fail the run."""
        import numpy as np
        values, wet = crop_values("mwd", np.array([360.001, 0.0, 359.9]), MISSING)
        self.assertEqual(values, [0.0, 0.0, 359.9])
        self.assertTrue(all(wet))

    def test_land_is_null_and_water_keeps_two_decimals(self):
        import numpy as np
        values, wet = crop_values("swh", np.array([1.234, MISSING, 2.0]), MISSING)
        self.assertEqual(values, [1.23, None, 2.0])
        self.assertEqual(list(wet), [True, False, True])


class WaveSpotTests(unittest.TestCase):
    """Reading a riding location: bilinear, nearest solved cell, or nothing."""

    GRID = {"width": 3, "height": 3, "west": -8.0, "east": -7.5, "north": 54.25,
            "south": 53.75, "dx": 0.25, "dy": 0.25}

    def plans(self):
        import numpy as np
        wet = np.array([index not in LAND for index in range(9)])
        return spot_plans(self.GRID, wet, SPOTS), wet

    def test_a_spot_in_open_water_is_read_from_its_own_four_cells(self):
        plans, _ = self.plans()
        self.assertEqual(plans["wet"]["mode"], "bilinear")
        self.assertEqual(plans["wet"]["offsetKm"], 0.0)

    def test_a_spot_over_land_reaches_the_nearest_cell_the_model_solved(self):
        plans, _ = self.plans()
        self.assertEqual(plans["dry"]["mode"], "nearest")
        self.assertGreater(plans["dry"]["offsetKm"], 0)
        self.assertLessEqual(plans["dry"]["offsetKm"], NEAREST_LIMIT_KM)
        self.assertNotIn(plans["dry"]["cell"], LAND)

    def test_a_spot_with_nothing_within_the_limit_gets_no_values_at_all(self):
        plans, wet = self.plans()
        self.assertEqual(plans["far"]["mode"], "none")
        self.assertIsNone(plans["far"]["offsetKm"])
        self.assertIsNone(read_spot(plans["far"], [1.0] * 9, wet, "height"))

    def test_a_bilinear_read_falls_to_null_when_its_stencil_loses_a_cell(self):
        """Sea ice moves and pp1d has its own mask; a partial stencil is not averaged."""
        import numpy as np
        plans, wet = self.plans()
        values = [1.0] * 9
        self.assertEqual(read_spot(plans["wet"], values, wet, "height"), 1.0)
        lost = np.array(wet)
        lost[plans["wet"]["corners"][0]] = False
        self.assertIsNone(read_spot(plans["wet"], values, lost, "height"))

    def test_directions_are_interpolated_as_unit_vectors_across_the_seam(self):
        import numpy as np
        wet = np.ones(9, dtype=bool)
        plans = spot_plans(self.GRID, wet, [{"id": "mid", "lon": -7.875, "lat": 54.125}])
        # Halfway between 350° and 10°: 0°, not 180°.
        values = [0.0] * 9
        for corner, bearing in zip(plans["mid"]["corners"], (350.0, 10.0, 350.0, 10.0)):
            values[corner] = bearing
        self.assertEqual(read_spot(plans["mid"], values, wet, DIRECTION), 0.0)

    def test_the_nearest_cell_value_is_taken_unchanged(self):
        import numpy as np
        plans, wet = self.plans()
        values = [float(index) for index in range(9)]
        cell = plans["dry"]["cell"]
        self.assertEqual(read_spot(plans["dry"], values, wet, "height"), values[cell])

    def test_coverage_says_which_cells_a_spot_was_read_from(self):
        plans, _ = self.plans()
        direct = coverage_for(plans["wet"], True)
        self.assertEqual((direct["landMasked"], direct["resolved"]), (False, True))
        self.assertEqual(direct["nearestOffsetKm"], 0.0)
        offset = coverage_for(plans["dry"], True)
        self.assertTrue(offset["landMasked"])
        self.assertIn("nearest cell", offset["note"])
        self.assertIn(f"{plans['dry']['offsetKm']:.1f} km", offset["note"])
        blind = coverage_for(plans["far"], False)
        self.assertEqual((blind["landMasked"], blind["resolved"]), (True, False))
        self.assertIn("cannot say anything", blind["note"])


class WaveCadenceTests(unittest.TestCase):
    def test_the_full_run_declares_the_ifs_ladder(self):
        self.assertEqual(cadence_for(list(ECMWF_HOURS)), ECMWF_RANGES)

    def test_a_short_run_declares_a_prefix_of_the_same_ladder(self):
        for hours in (24, 144, 150, 240, 360):
            with self.subTest(hours=hours):
                prefix = [hour for hour in ECMWF_HOURS if hour <= hours]
                manifest = {"model": MODEL, "stepHours": 3,
                            "stepRanges": cadence_for(prefix)}
                self.assertEqual(expected_hours(manifest), tuple(prefix))

    def test_a_resampled_or_invented_cadence_is_refused_under_this_model_id(self):
        for ranges in [[{"throughHour": 360, "stepHours": 3}],
                       [{"throughHour": 144, "stepHours": 4},
                        {"throughHour": 360, "stepHours": 6}],
                       [{"throughHour": 120, "stepHours": 3},
                        {"throughHour": 360, "stepHours": 6}]]:
            with self.subTest(ranges=ranges), self.assertRaises(ValueError):
                expected_hours({"model": MODEL, "stepHours": 3, "stepRanges": ranges})

    def test_the_declared_step_must_be_the_sources_finest(self):
        with self.assertRaises(ValueError):
            expected_hours({"model": MODEL, "stepHours": 6, "stepRanges": ECMWF_RANGES})

    def test_argument_defaults_and_refusals(self):
        args = parse_args([])
        self.assertEqual((args.source, args.hours, args.bands), ("ecmwf", 360, True))
        self.assertFalse(parse_args(["--no-bands"]).bands)
        for argv in [["--hours", "1"], ["--hours", "147"], ["--hours", "0"],
                     ["--hours", "400"], ["--workers", "0"]]:
            with self.subTest(argv=argv), redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    parse_args(argv)

    def test_only_the_full_length_cycles_are_accepted(self):
        self.assertEqual(run_datetime("2026091612").hour, 12)
        for value in ["2026091606", "2026091618", "2026131600", "bad"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                run_datetime(value)


class WaveBundleTests(unittest.TestCase):
    """The published bundle, through the shipped wave validator."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.run_time = datetime(2026, 9, 16, tzinfo=timezone.utc)

    def bundle(self, hours=(0, 3, 6), variables=None):
        variables = variables if variables is not None else list(ALL_VARIABLES)
        grid = {"width": 3, "height": 3, "west": -8.0, "east": -7.5, "north": 54.25,
                "south": 53.75, "dx": 0.25, "dy": 0.25}
        (self.root / "weather/run").mkdir(parents=True)
        frames, series = [], {"wet": [], "dry": []}
        for hour in hours:
            valid = (self.run_time + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
            fields = {name: [1.5 if index not in LAND else None for index in range(9)]
                      for name in variables}
            (self.root / f"weather/run/{hour}.json").write_text(json.dumps({
                "model": MODEL, "run": "2026091600", "hour": hour, "validTime": valid,
                "grid": grid, **fields}))
            frames.append({"hour": hour, "validTime": valid,
                           "url": f"weather/run/{hour}.json"})
            series["wet"].append({"hour": hour, "validTime": valid,
                                  "values": {name: 1.5 for name in variables}})
            # A location the model cannot see publishes nulls, not an absent series.
            series["dry"].append({"hour": hour, "validTime": valid,
                                  "values": {name: None for name in variables}})
        coverage = {"wet": coverage_for({"mode": "bilinear", "offsetKm": 0.0}, True),
                    "dry": coverage_for({"mode": "none", "offsetKm": None}, False)}
        manifest = manifest_for("2026091600", self.run_time, list(hours), variables,
                                grid, frames, series, coverage)
        (self.root / f"weather/{MODEL}.json").write_text(json.dumps(manifest))
        return manifest, self.run_time + timedelta(hours=1)

    def test_the_manifest_declares_ten_variables_and_the_wave_contract(self):
        manifest, _ = self.bundle()
        self.assertEqual(manifest["kind"], "wave")
        self.assertEqual(len(manifest["variables"]), 10)
        self.assertEqual(set(manifest["variables"]["swh"]),
                         {"units", "label", "description"})
        self.assertIn("FROM", manifest["directionConvention"])
        self.assertIn("only swell information", manifest["partitionNote"])

    def test_the_bundle_validates_and_publishes_with_the_pointer_last(self):
        _, now = self.bundle()
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root, MODEL, "test", max_age_hours=24, now=now),
                         "published")
        self.assertEqual(s3.writes[-1], f"weather/{MODEL}.json")
        self.assertEqual(len(s3.writes), 5)  # 3 frames + archive + pointer

    def test_a_band_only_manifest_still_validates(self):
        _, now = self.bundle(variables=list(SEA))
        self.assertTrue(validate_bundle(self.root, MODEL, 24, now))

    def test_a_missing_or_misordered_hour_stops_the_upload(self):
        manifest, now = self.bundle()
        for frames in [manifest["frames"][:-1],
                       [{**f, "hour": 4} if i == 1 else f
                        for i, f in enumerate(manifest["frames"])]]:
            (self.root / f"weather/{MODEL}.json").write_text(
                json.dumps({**manifest, "frames": frames}))
            s3 = FakeS3()
            with self.assertRaises(ValueError):
                publish(s3, self.root, MODEL, "test", max_age_hours=24, now=now)
            self.assertEqual(s3.writes, [])

    def test_a_spot_series_missing_a_variable_is_refused(self):
        manifest, now = self.bundle()
        del manifest["spotSeries"]["wet"][1]["values"]["h1721"]
        (self.root / f"weather/{MODEL}.json").write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            validate_bundle(self.root, MODEL, 24, now)

    def test_the_manifest_refuses_to_claim_a_ladder_it_did_not_publish(self):
        """`manifest_for` checks its own hours against the cadence it declares."""
        with self.assertRaises(ValueError):
            manifest_for("2026091600", self.run_time, [0, 4, 8], ["swh"], {},
                         [], {"wet": []}, {})


class WaveFailureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_a_download_failure_preserves_the_last_published_snapshot(self):
        output = self.root / f"public/weather/{MODEL}.json"
        output.parent.mkdir(parents=True)
        output.write_text('{"run":"last-good"}')
        now = datetime.now(timezone.utc)
        run = now.replace(minute=0, second=0, microsecond=0,
                          hour=now.hour // 12 * 12).strftime("%Y%m%d%H")
        with patch("fetch_ecmwf_wave.ROOT", self.root), \
             patch("fetch_ecmwf_wave.client") as factory, redirect_stdout(io.StringIO()):
            factory.return_value.retrieve.side_effect = OSError("mirror unavailable")
            with self.assertRaises(OSError):
                main(["--run", run, "--hours", "3"])
        self.assertEqual(json.loads(output.read_text()), {"run": "last-good"})

    def test_a_stale_cycle_is_refused_without_downloading_anything(self):
        stale = datetime.now(timezone.utc) - timedelta(hours=40)
        stale = stale.replace(minute=0, second=0, microsecond=0, hour=stale.hour // 12 * 12)
        with patch("fetch_ecmwf_wave.client") as factory:
            with self.assertRaises(ValueError):
                main(["--run", stale.strftime("%Y%m%d%H")])
            factory.return_value.retrieve.assert_not_called()

    def test_the_client_asks_the_wave_stream_of_the_chosen_mirror(self):
        with patch("fetch_ecmwf.Client") as constructor:
            fetch_ecmwf_wave.client("ecmwf")
        self.assertEqual(constructor.call_args.kwargs["model"], "ifs")
        self.assertEqual(constructor.call_args.kwargs["source"], "ecmwf")
        self.assertEqual(constructor.call_args.kwargs["resol"], "0p25")


if __name__ == "__main__":
    unittest.main()
