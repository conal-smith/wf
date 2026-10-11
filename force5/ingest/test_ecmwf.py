from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import eccodes as ec

from cadence import ECMWF_HOURS, ECMWF_RANGES, expected_hours
from fetch_ecmwf import decode_wind, decode_gust, download_gust, gust_parameter, run_datetime, main, ForecastSession
from publish_s3 import publish
from test_publish_s3 import FakeS3
from runfixtures import publish_whole


class ECMWFTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def grib(self, params=(165, 166), changes=None):
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
                    ec.codes_set_values(handle, [1, 2, 3, 4])
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

    def bundle(self):
        directory = self.root / "weather/ecmwf-run"
        directory.mkdir(parents=True)
        run = datetime(2026, 9, 13, tzinfo=timezone.utc)
        manifest = {"model": "ecmwf", "run": "2026091300", "runTime": run.isoformat(),
                    "stepHours": 3, "stepRanges": ECMWF_RANGES, "gustAvailable": False,
                    "grid": {"width": 2, "height": 2}, "frames": [],
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
