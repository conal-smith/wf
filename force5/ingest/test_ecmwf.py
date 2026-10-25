from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import eccodes as ec

from cadence import ECMWF_HOURS, ECMWF_RANGES, expected_hours
import f5tile
import fetch_forecast
from fetch_ecmwf import BBOX, decode_wind, decode_gust, download_gust, gust_parameter, run_datetime, main, ForecastSession
from fetch_forecast import load_spots, sample
from publish_s3 import publish
from test_publish_s3 import FakeS3
from runfixtures import TINY_GRID, publish_whole


class ECMWFTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def grib(self, params=(165, 166), changes=None, values=(1, 2, 3, 4)):
        path = self.root / "wind.grib2"
        with path.open("wb") as stream:
            for param in params:
                handle = ec.codes_grib_new_from_samples("regular_ll_sfc_grib2")
                try:
                    metadata = {"centre": "ecmf", "dataType": "fc", "paramId": param,
                                "dataDate": 20260913, "dataTime": 0, "stepUnits": 1,
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
                    ec.codes_set_values(handle, list(values))
                    ec.codes_write(handle, stream)
                finally:
                    ec.codes_release(handle)
        return path

    def test_native_cadence_has_full_15_days(self):
        self.assertEqual(len(ECMWF_HOURS), 85)
        self.assertEqual(ECMWF_HOURS[48:51], (144, 150, 156))
        self.assertEqual(ECMWF_HOURS[-1], 360)
        self.assertNotIn(147, ECMWF_HOURS)

    def test_network_requests_have_connect_and_read_timeouts(self):
        with patch("requests.Session.request") as request:
            request.return_value.status_code, request.return_value.content = 200, b""
            session = ForecastSession()
            session.get("https://example.invalid", timeout=None)
            self.assertEqual(request.call_args.kwargs["timeout"], (15, 90))
            session.head("https://example.invalid", timeout=5)
            self.assertEqual(request.call_args.kwargs["timeout"], 5)

    def test_only_full_length_cycles_accepted(self):
        self.assertEqual(run_datetime("2026091312").hour, 12)
        for value in ["2026091306", "2026091318", "2026131300", "bad"]:
            with self.assertRaises(ValueError):
                run_datetime(value)

    def test_real_grib_decode_normalises_longitude_and_keeps_vectors(self):
        fields, layout = decode_wind(self.grib(), "2026091300", 150)
        self.assertEqual(fields, {"u": [1, 2, 3, 4], "v": [1, 2, 3, 4]})
        self.assertEqual(layout[2]["west"], -8)
        self.assertEqual(layout[2]["north"], 54.25)

    def wide_grib(self):
        """Wind on the 0.25° lattice from 40°W to 10°E and 70°N to 40°N: more than any crop."""
        width, height = 201, 121
        values = [round((index % width) * 0.03 - (index // width) * 0.05 + 4, 2)
                  for index in range(width * height)]
        return self.grib(changes={"Ni": width, "Nj": height,
                                  "latitudeOfFirstGridPointInDegrees": 70,
                                  "latitudeOfLastGridPointInDegrees": 40,
                                  "longitudeOfFirstGridPointInDegrees": 320,
                                  "longitudeOfLastGridPointInDegrees": 10}, values=values)

    def test_the_control_crops_its_own_box_further_into_the_atlantic(self):
        _, layout = decode_wind(self.wide_grib(), "2026091300", 150)
        grid = layout[2]
        self.assertEqual(BBOX, (-30.0, 44.0, 2.0, 62.0))
        self.assertEqual((grid["west"], grid["south"], grid["east"], grid["north"]), BBOX)
        self.assertEqual((grid["width"], grid["height"]), (129, 73))

    def test_the_other_models_keep_the_shared_box(self):
        """The helper's default is still the shared crop every other adapter publishes."""
        self.assertEqual(fetch_forecast.BBOX, (-18.0, 48.0, 2.0, 59.0))
        with self.wide_grib().open("rb") as stream:
            handle = ec.codes_grib_new_from_file(stream)
        _, layout, _ = fetch_forecast.decode_handle(handle, "u", "2026091300", 150)
        grid = layout[2]
        self.assertEqual((grid["west"], grid["south"], grid["east"], grid["north"]),
                         fetch_forecast.BBOX)
        self.assertEqual((grid["width"], grid["height"]), (81, 45))

    def test_widening_the_box_changes_no_spot_value(self):
        """The same 0.25° points either side of a spot, so the same bilinear answer."""
        path = self.wide_grib()
        wide, layout = decode_wind(path, "2026091300", 150)
        with path.open("rb") as stream:
            handle = ec.codes_grib_new_from_file(stream)
        shared, shared_layout, _ = fetch_forecast.decode_handle(handle, "u", "2026091300", 150)
        spots = load_spots()
        for spot in spots:
            with self.subTest(spot=spot["id"]):
                value = sample(layout[2], wide["u"], spot["lon"], spot["lat"])
                self.assertIsNotNone(value)
                self.assertEqual(value, sample(shared_layout[2], shared, spot["lon"], spot["lat"]))

    def test_the_wider_box_sits_on_the_tile_lattice(self):
        """Whole 0.25° cells from -180°/90°, holding the shared box: four native tiles, one overview."""
        west, south, east, north = BBOX
        shared = fetch_forecast.BBOX
        self.assertTrue(west <= shared[0] and south <= shared[1]
                        and east >= shared[2] and north >= shared[3])
        grid = {"west": west, "north": north, "dx": 0.25, "dy": 0.25,
                "width": round((east - west) / 0.25) + 1, "height": round((north - south) / 0.25) + 1}
        self.assertEqual(f5tile.lattice_origin(grid), (600, 112))
        self.assertEqual([(level["x"], level["y"]) for level in f5tile.levels(grid)],
                         [([4, 5], [0, 1]), ([2, 2], [0, 0])])

    def test_reject_missing_duplicate_and_wrong_fields(self):
        for params in [(165,), (165, 165), (165, 167)]:
            with self.subTest(params=params), self.assertRaises(ValueError):
                decode_wind(self.grib(params), "2026091300", 150)

    def test_scalar_gust_preserves_source_maximum_interval(self):
        _, layout = decode_wind(self.grib(), "2026091300", 150)
        path = self.grib((49,), {"stepType": "max", "startStep": 144, "endStep": 150})
        values, interval = decode_gust(path, "2026091300", 150, layout)
        self.assertEqual(values, [1, 2, 3, 4])
        self.assertEqual(interval, [144, 150])

    def test_gust_rejects_components_wrong_window_run_and_duplicates(self):
        _, layout = decode_wind(self.grib(), "2026091300", 150)
        for params, changes in [((165,), {}), ((49, 49), {}),
                                ((49,), {"startStep": 140, "endStep": 150}),
                                ((49,), {"startStep": 144, "endStep": 150, "dataDate": 20260912})]:
            with self.subTest(params=params, changes=changes), self.assertRaises(ValueError):
                decode_gust(self.grib(params, changes), "2026091300", 150, layout)

    def test_gust_aliases_and_absent_initialization(self):
        self.assertEqual([gust_parameter(h) for h in [3, 90, 93, 144, 150]],
                         ["10fg", "10fg", "10fg3", "10fg3", "10fg"])
        with patch("fetch_ecmwf.client") as factory:
            self.assertEqual(download_gust(self.root, "aws", "2026091300", 0, None), (None, None))
            factory.assert_not_called()

    def test_reject_wrong_provider_run_step_and_vector_reference(self):
        for changes in [{"centre": "edzw"}, {"dataDate": 20260912},
                        {"forecastTime": 144}, {"uvRelativeToGrid": 1},
                        {"dataType": "an"}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                decode_wind(self.grib(changes=changes), "2026091300", 150)

    def test_download_failure_preserves_local_manifest(self):
        output = self.root / "public/weather/ecmwf.json"
        output.parent.mkdir(parents=True)
        output.write_text('{"run":"last-good"}')
        now = datetime.now(timezone.utc)
        run = now.replace(hour=0, minute=0, second=0, microsecond=0).strftime("%Y%m%d%H")
        with patch("sys.argv", ["fetch_ecmwf.py", "--run", run]), \
             patch("fetch_ecmwf.ROOT", self.root), \
             patch("fetch_ecmwf.client") as factory:
            factory.return_value.retrieve.side_effect = OSError("provider unavailable")
            with self.assertRaises(OSError):
                main()
        self.assertEqual(json.loads(output.read_text()), {"run": "last-good"})

    def discover(self, found, published=None, cycle=None):
        """main() with `latest` answering `found`; returns its exit code and the probe."""
        environment = {"FORCE5_PUBLISHED_RUN": published} if published else {}
        argv = ["fetch_ecmwf.py", *(["--cycle", cycle] if cycle else [])]
        with patch("sys.argv", argv), patch("fetch_ecmwf.ROOT", self.root), \
                patch.dict("os.environ", environment), patch("fetch_ecmwf.client") as factory:
            factory.return_value.latest.return_value = found
            factory.return_value.retrieve.side_effect = OSError("no download in this test")
            try:
                code = main()
            except OSError:
                code = "downloaded"
        return code, factory.return_value.latest.call_args.kwargs

    def test_a_cycle_restricts_the_probe_and_nothing_else_does(self):
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        _, probe = self.discover(today, cycle="00")
        self.assertEqual(probe, {"step": 360, "stream": "oper", "type": "fc", "time": 0})
        _, probe = self.discover(today)
        self.assertNotIn("time", probe)

    def test_the_run_already_served_is_unchanged_however_old(self):
        # A morning slot before today's 00 UTC run is complete: the 00-only probe
        # finds yesterday's, which the site serves. That is a no-op, not a stale run.
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1, hours=8)).replace(
            hour=0, minute=0, second=0, microsecond=0)
        run = yesterday.strftime("%Y%m%d%H")
        code, _ = self.discover(yesterday, published=run, cycle="00")
        self.assertEqual(code, 3)

    def test_a_day_old_run_not_yet_served_is_still_imported(self):
        # The age limit is the registry's, which a once-a-day 00 UTC run must fit.
        from fetch_ecmwf import MAX_AGE_HOURS
        from registry import MODELS
        self.assertEqual(MAX_AGE_HOURS, MODELS["ecmwf"]["maxAgeHours"])
        self.assertGreaterEqual(MAX_AGE_HOURS, 36)
        def run_before(hours):
            """The 00 or 12 UTC run at least `hours` and under `hours` + 12 old."""
            moment = datetime.now(timezone.utc) - timedelta(hours=hours)
            return moment.replace(hour=moment.hour // 12 * 12, minute=0, second=0, microsecond=0)

        code, _ = self.discover(run_before(25))
        self.assertEqual(code, "downloaded")
        with self.assertRaisesRegex(ValueError, "stale"):
            self.discover(run_before(MAX_AGE_HOURS + 1))

    def test_a_run_from_the_other_cycle_is_refused(self):
        with patch("sys.argv", ["fetch_ecmwf.py", "--run", "2026091312", "--cycle", "00"]), \
                patch("sys.stderr"), self.assertRaises(SystemExit):
            main()

    def bundle(self):
        directory = self.root / "weather/ecmwf-run"
        directory.mkdir(parents=True)
        run = datetime(2026, 9, 13, tzinfo=timezone.utc)
        manifest = {"model": "ecmwf", "run": "2026091300", "runTime": run.isoformat(),
                    "stepHours": 3, "stepRanges": ECMWF_RANGES, "gustAvailable": False,
                    "grid": dict(TINY_GRID), "frames": [],
                    "spotForecasts": {"brandon": []}}
        for hour in ECMWF_HOURS:
            valid = (run + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
            info = {"hour": hour, "validTime": valid, "url": f"weather/ecmwf-run/{hour}.json"}
            manifest["frames"].append(info)
            (self.root / info["url"]).write_text(json.dumps({"model": "ecmwf", "run": manifest["run"],
                "hour": hour, "validTime": valid, "grid": manifest["grid"], "u": [1]*4, "v": [2]*4, "gust": None}))
        publish_whole(self.root / "weather", "ecmwf.json", manifest)
        return manifest, run + timedelta(hours=18)

    def test_publisher_accepts_mixed_cadence_pointer_last(self):
        manifest, now = self.bundle()
        self.assertEqual(expected_hours(manifest), ECMWF_HOURS)
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root, "ecmwf", "test", max_age_hours=24, now=now), "published")
        self.assertEqual(s3.writes[-1], "weather/ecmwf.json")
        self.assertEqual(len(s3.writes), 87)  # 85 frames, a spot square, the pointer

    def test_publisher_rejects_missing_or_invented_hours_before_upload(self):
        manifest, now = self.bundle()
        for frames in [manifest["frames"][:-1], manifest["frames"][:49] + manifest["frames"][50:],
                       [{**f, "hour": 147} if i == 49 else f for i, f in enumerate(manifest["frames"])]]:
            publish_whole(self.root / "weather", "ecmwf.json", {**manifest, "frames": frames})
            s3 = FakeS3()
            with self.assertRaises(ValueError):
                publish(s3, self.root, "ecmwf", "test", max_age_hours=24, now=now)
            self.assertEqual(s3.writes, [])


if __name__ == "__main__":
    unittest.main()
