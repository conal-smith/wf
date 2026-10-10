from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import eccodes as ec

from cadence import expected_hours
import fetch_aifs
from fetch_aifs import MODEL, STEP, decode_wind, main, parse_args, run_datetime
from publish_s3 import publish, validate_bundle
from registry import UNCHANGED_EXIT
from test_publish_s3 import FakeS3

# The identity the live 0.25° AIFS product carries, read on 17 September 2026.
# `dataType` is ecCodes' alias for `marsType`, so it is set once, not twice.
AIFS_HEADERS = {"centre": "ecmf", "marsClass": "ai", "marsStream": "oper",
                "dataType": "fc"}


class AIFSGribTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def grib(self, params=(165, 166), changes=None, name="wind.grib2", local=True):
        """Two 2 × 2 AIFS wind messages over the north-east Atlantic.

        `local=False` writes them without ECMWF's local definition section, which is
        what a file from another centre looks like: it has no MARS keys at all.
        """
        path = self.root / name
        with path.open("wb") as stream:
            for param in params:
                handle = ec.codes_grib_new_from_samples("regular_ll_sfc_grib2")
                try:
                    # marsClass and its neighbours live in ECMWF's local section, which
                    # the plain sample has not got; every real ECMWF file does.
                    if local:
                        ec.codes_set(handle, "setLocalDefinition", 1)
                    metadata = {**(AIFS_HEADERS if local else {"centre": "ecmf"}),
                                "paramId": param,
                                "dataDate": 20260916, "dataTime": 0, "stepUnits": 1,
                                "forecastTime": 150, "Ni": 2, "Nj": 2,
                                "latitudeOfFirstGridPointInDegrees": 54.25,
                                "latitudeOfLastGridPointInDegrees": 54,
                                "longitudeOfFirstGridPointInDegrees": 352,
                                "longitudeOfLastGridPointInDegrees": 352.25,
                                "iDirectionIncrementInDegrees": 0.25,
                                "jDirectionIncrementInDegrees": 0.25,
                                "uvRelativeToGrid": 0, **(changes or {})}
                    for key, value in metadata.items():
                        ec.codes_set(handle, key, value)
                    ec.codes_set_values(handle, [1, 2, 3, 4])
                    ec.codes_write(handle, stream)
                finally:
                    ec.codes_release(handle)
        return path

    def test_decodes_and_crops_the_ai_model_like_the_control(self):
        fields, layout = decode_wind(self.grib(), "2026091600", 150)
        self.assertEqual(fields, {"u": [1, 2, 3, 4], "v": [1, 2, 3, 4]})
        self.assertEqual(layout[2]["west"], -8)
        self.assertEqual(layout[2]["north"], 54.25)
        self.assertEqual((layout[2]["dx"], layout[2]["dy"]), (0.25, 0.25))

    def test_refuses_the_ifs_control_under_the_ai_model_id(self):
        """AIFS and IFS share centre and dataType; the MARS class separates them."""
        for changes in [{"marsClass": "od"}, {"marsStream": "wave"}, {"dataType": "an"}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                decode_wind(self.grib(changes=changes), "2026091600", 150)

    def test_refuses_another_centres_file_before_reading_its_mars_keys(self):
        """`centre` is checked first, so a file with no MARS section fails cleanly."""
        with self.assertRaises(ValueError) as caught:
            decode_wind(self.grib(changes={"centre": "edzw"}, local=False),
                        "2026091600", 150)
        self.assertIn("centre", str(caught.exception))

    def test_refuses_missing_duplicate_and_foreign_parameters(self):
        for params in [(165,), (166,), (165, 165), (165, 49), (165, 167)]:
            with self.subTest(params=params), self.assertRaises(ValueError):
                decode_wind(self.grib(params), "2026091600", 150)

    def test_refuses_a_wrong_run_step_or_vector_reference(self):
        for changes in [{"dataDate": 20260915}, {"forecastTime": 144},
                        {"uvRelativeToGrid": 1}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                decode_wind(self.grib(changes=changes), "2026091600", 150)

    def test_refuses_a_coarser_grid_than_the_open_data_product(self):
        with self.assertRaises(ValueError):
            decode_wind(self.grib(changes={
                "iDirectionIncrementInDegrees": 0.5, "jDirectionIncrementInDegrees": 0.5,
                "latitudeOfLastGridPointInDegrees": 53.75,
                "longitudeOfLastGridPointInDegrees": 352.5}), "2026091600", 150)


class AIFSArgumentTests(unittest.TestCase):
    def test_all_four_cycles_are_accepted(self):
        for cycle in ("00", "06", "12", "18"):
            self.assertEqual(run_datetime(f"20260916{cycle}").hour, int(cycle))
        for value in ["2026091601", "2026091603", "2026131600", "bad"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                run_datetime(value)

    def test_defaults_to_ecmwfs_own_mirror_and_the_full_horizon(self):
        args = parse_args([])
        self.assertEqual((args.source, args.hours), ("ecmwf", 360))

    def test_refuses_a_step_the_source_does_not_publish(self):
        for argv in [["--hours", "3"], ["--hours", "0"], ["--hours", "366"],
                     ["--hours", "100"], ["--workers", "5"]]:
            with self.subTest(argv=argv), redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    parse_args(argv)


class AIFSBundleTests(unittest.TestCase):
    """The published bundle: uniform 6-hour cadence and a declared absence of gusts."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def bundle(self, hours=None):
        directory = self.root / "weather/aifs-run"
        directory.mkdir(parents=True)
        run = datetime(2026, 9, 16, tzinfo=timezone.utc)
        hours = hours if hours is not None else list(range(0, 361, STEP))
        manifest = {"model": MODEL, "run": "2026091600", "runTime": run.isoformat(),
                    "stepHours": STEP, "gustAvailable": False,
                    "stepRanges": [{"throughHour": hours[-1], "stepHours": STEP}],
                    "grid": {"width": 2, "height": 2}, "frames": [],
                    "spotForecasts": {"brandon": []}}
        for hour in hours:
            valid = (run + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
            manifest["frames"].append({"hour": hour, "validTime": valid,
                                       "url": f"weather/aifs-run/{hour}.json",
                                       "gustIntervalHours": None})
            manifest["spotForecasts"]["brandon"].append(
                {"hour": hour, "validTime": valid, "u": 1, "v": 2, "gust": None})
            (self.root / f"weather/aifs-run/{hour}.json").write_text(json.dumps({
                "model": MODEL, "run": "2026091600", "hour": hour, "validTime": valid,
                "grid": manifest["grid"], "u": [1] * 4, "v": [2] * 4, "gust": None,
                "gustIntervalHours": None}))
        (self.root / f"weather/{MODEL}.json").write_text(json.dumps(manifest))
        return manifest, run + timedelta(hours=1)

    def test_uniform_six_hour_cadence_reaches_fifteen_days(self):
        manifest, _ = self.bundle()
        hours = expected_hours(manifest)
        self.assertEqual(len(hours), 61)
        self.assertEqual((hours[0], hours[1], hours[-1]), (0, 6, 360))
        self.assertNotIn(3, hours)

    def test_publishes_every_frame_with_the_pointer_last(self):
        _, now = self.bundle()
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root, MODEL, "test", max_age_hours=12, now=now),
                         "published")
        self.assertEqual(s3.writes[-1], f"weather/{MODEL}.json")
        self.assertEqual(len(s3.writes), 63)  # 61 frames + archive + pointer

    def test_refuses_a_missing_or_invented_hour_before_uploading_anything(self):
        manifest, now = self.bundle()
        for frames in [manifest["frames"][:-1],
                       manifest["frames"][:5] + manifest["frames"][6:],
                       [{**f, "hour": 7} if i == 1 else f
                        for i, f in enumerate(manifest["frames"])]]:
            (self.root / f"weather/{MODEL}.json").write_text(
                json.dumps({**manifest, "frames": frames}))
            s3 = FakeS3()
            with self.assertRaises(ValueError):
                publish(s3, self.root, MODEL, "test", max_age_hours=12, now=now)
            self.assertEqual(s3.writes, [])

    def test_a_gust_value_cannot_slip_into_a_gustless_product(self):
        manifest, now = self.bundle(hours=[0, 6])
        for change in ({"gust": [1] * 4}, {"gustIntervalHours": [0, 6]}):
            path = self.root / "weather/aifs-run/6.json"
            path.write_text(json.dumps({**json.loads(path.read_text()), **change}))
            with self.assertRaises(ValueError):
                validate_bundle(self.root, MODEL, 12, now)
            path.write_text(json.dumps({
                "model": MODEL, "run": "2026091600", "hour": 6,
                "validTime": manifest["frames"][1]["validTime"],
                "grid": manifest["grid"], "u": [1] * 4, "v": [2] * 4, "gust": None,
                "gustIntervalHours": None}))
        self.assertTrue(validate_bundle(self.root, MODEL, 12, now))

    def test_a_declared_gust_interval_is_refused_on_the_frame_list(self):
        manifest, now = self.bundle(hours=[0, 6])
        manifest["frames"][1]["gustIntervalHours"] = [0, 6]
        (self.root / f"weather/{MODEL}.json").write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            validate_bundle(self.root, MODEL, 12, now)


class AIFSFailureTests(unittest.TestCase):
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
                          hour=now.hour // 6 * 6).strftime("%Y%m%d%H")
        with patch("fetch_aifs.ROOT", self.root), \
             patch("fetch_aifs.client") as factory, redirect_stdout(io.StringIO()):
            factory.return_value.retrieve.side_effect = OSError("mirror unavailable")
            with self.assertRaises(OSError):
                main(["--run", run])
        self.assertEqual(json.loads(output.read_text()), {"run": "last-good"})

    def test_a_stale_cycle_is_refused_without_downloading_anything(self):
        stale = (datetime.now(timezone.utc) - timedelta(hours=30))
        stale = stale.replace(minute=0, second=0, microsecond=0, hour=stale.hour // 6 * 6)
        with patch("fetch_aifs.client") as factory:
            with self.assertRaises(ValueError):
                main(["--run", stale.strftime("%Y%m%d%H")])
            factory.return_value.retrieve.assert_not_called()

    def run_against_the_bucket(self, published, *argv):
        """main() on the newest cycle with the bucket serving `published`."""
        now = datetime.now(timezone.utc)
        latest = now.replace(minute=0, second=0, microsecond=0, hour=now.hour // 6 * 6)
        with patch("fetch_aifs.ROOT", self.root), \
             patch.dict("os.environ", {"FORCE5_PUBLISHED_RUN": published}), \
             patch("fetch_aifs.client") as factory, redirect_stdout(io.StringIO()):
            factory.return_value.latest.return_value = latest
            factory.return_value.retrieve.side_effect = OSError("mirror unavailable")
            try:
                result = main(list(argv))
            except OSError:
                result = "downloaded"
        self.assertFalse((self.root / f"public/weather/{MODEL}.json").exists())
        return result, factory.return_value.retrieve, latest.strftime("%Y%m%d%H")

    def test_the_run_the_bucket_serves_is_not_downloaded_again(self):
        now = datetime.now(timezone.utc)
        run = now.replace(minute=0, second=0, microsecond=0,
                          hour=now.hour // 6 * 6).strftime("%Y%m%d%H")
        result, retrieve, _ = self.run_against_the_bucket(run)
        self.assertEqual(result, UNCHANGED_EXIT)
        retrieve.assert_not_called()

    def test_a_newer_run_or_an_explicit_run_is_downloaded(self):
        self.assertEqual(self.run_against_the_bucket("2026010100")[0], "downloaded")
        run = self.run_against_the_bucket("2026010100")[2]
        self.assertEqual(self.run_against_the_bucket(run, "--run", run)[0], "downloaded")

    def test_the_client_asks_for_the_ai_model_on_the_chosen_mirror(self):
        with patch("fetch_ecmwf.OpenDataClient") as constructor:
            fetch_aifs.client("ecmwf", fetch_aifs.OPENDATA_MODEL)
        self.assertEqual(constructor.call_args.kwargs["model"], "aifs-single")
        self.assertEqual(constructor.call_args.kwargs["source"], "ecmwf")
        self.assertEqual(constructor.call_args.kwargs["resol"], "0p25")


if __name__ == "__main__":
    unittest.main()
