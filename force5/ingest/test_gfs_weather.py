"""Offline GFS surface-weather importer tests: no network, no provider credentials."""
from contextlib import redirect_stderr
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import eccodes as ec
import numpy as np

import fetch_gfs
import fetch_gfs_weather
import fetch_icon_weather
from fetch_gfs_weather import (READ, VARIABLES, accumulation_step, decode, derive, filter_url,
                               index_ranges, main, present_weather)
from publish_s3 import validate_bundle
from registry import MODELS, UNCHANGED_EXIT
from runfixtures import read_whole, use_catalogue

RUN = "2026091612"
# One plausible value per field, in GFS's own units.
SOURCE = {"t2m": 283.15, "td2m": 280.15, "rh2m": 81.0, "tp": 4.0, "clct": 90.0, "clcl": 80.0,
          "clcm": 40.0, "clch": 10.0, "pmsl": 101320.0, "vis": 24100.0, "cape": 50.0,
          "tg": 285.15, "prate": 0.0005, "crain": 1.0, "cfrzr": 0.0, "cicep": 0.0, "csnow": 0.0}


def fields(**changes):
    """A decoded step's fields, every cell alike, as `decode` returns them."""
    out = {name: np.full(4, value, dtype=float) for name, value in {**SOURCE, **changes}.items()}
    return {name: (values if name in fetch_gfs_weather.INPUTS
                   else fetch_gfs_weather.convert(name, values)) for name, values in out.items()}


class GfsWeatherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        fetch_gfs.THROTTLE.pause = 0

    def grib(self, hour=6, run=RUN, skip=(), extra=(), changes=None):
        """Real GRIB2 messages shaped like NOMADS' subregion output (0–360° longitudes),
        one per field read, plus the period averages and buckets the filter also sends."""
        path = Path(tempfile.mkstemp(suffix=".grib2", dir=self.root)[1])
        messages = []
        for name, entry in READ.items():
            if name in skip or (name == "tp" and hour == 0):
                continue
            category, number, level_type, level = entry["grib"]
            message = {"parameterCategory": category, "parameterNumber": number,
                       "typeOfLevel": level_type, "level": level, "value": SOURCE[name]}
            if entry.get("accum"):
                message.update(accum=(0, hour))
            messages.append({**message, **(changes or {}).get(name, {})})
        messages.extend(extra)
        with path.open("wb") as stream:
            for message in messages:
                handle = ec.codes_grib_new_from_samples("regular_ll_sfc_grib2")
                try:
                    interval = message.pop("accum", None)
                    value = message.pop("value")
                    if interval:
                        ec.codes_set(handle, "productDefinitionTemplateNumber", 8)
                    values = {"centre": "kwbc", "dataDate": int(run[:8]),
                              "dataTime": int(run[-2:]) * 100, "stepUnits": 1, "discipline": 0,
                              "Ni": 2, "Nj": 2, "latitudeOfFirstGridPointInDegrees": 54.25,
                              "latitudeOfLastGridPointInDegrees": 54,
                              "longitudeOfFirstGridPointInDegrees": 342,
                              "longitudeOfLastGridPointInDegrees": 342.25,
                              "iDirectionIncrementInDegrees": 0.25,
                              "jDirectionIncrementInDegrees": 0.25, **message}
                    if interval:
                        values.update(typeOfStatisticalProcessing=1, startStep=interval[0],
                                      endStep=interval[1])
                    else:
                        values["forecastTime"] = hour
                    for key, item in values.items():
                        ec.codes_set(handle, key, item)
                    ec.codes_set_values(handle, [value] * 4)
                    ec.codes_write(handle, stream)
                finally:
                    ec.codes_release(handle)
        return path

    # --- the published variables ------------------------------------------
    def test_it_publishes_icon_eu_weathers_names_so_the_dock_reads_either_alike(self):
        self.assertEqual(list(VARIABLES), list(fetch_icon_weather.VARIABLES))
        self.assertEqual(VARIABLES["ww"].get("kind"), "code")
        self.assertIn("derived", VARIABLES["ww"]["label"])

    # --- decoding ---------------------------------------------------------
    def test_decode_keeps_every_field_converted_and_passes_over_averages_and_buckets(self):
        bucket = {"parameterCategory": 1, "parameterNumber": 8, "typeOfLevel": "surface",
                  "level": 0, "value": 1.0, "accum": (3, 6)}
        average = {"parameterCategory": 6, "parameterNumber": 1, "typeOfLevel": "atmosphere",
                   "level": 0, "value": 50.0, "accum": (0, 6), "typeOfStatisticalProcessing": 0}
        decoded, layout = decode(self.grib(extra=[bucket, average]), RUN, 6)
        self.assertEqual(set(decoded), set(READ))
        self.assertEqual(decoded["t2m"], [10.0] * 4)
        self.assertEqual(decoded["tp"], [4.0] * 4)        # The run total, not the bucket.
        self.assertEqual(decoded["clct"], [90] * 4)       # The hour's cloud, not the average.
        self.assertEqual(decoded["pmsl"], [1013.2] * 4)
        self.assertEqual(decoded["vis"], [24.1] * 4)
        self.assertEqual((layout[2]["west"], layout[2]["north"]), (-18.0, 54.25))

    def test_there_is_no_accumulation_at_initialization_and_one_everywhere_else(self):
        decoded, _ = decode(self.grib(hour=0), RUN, 0)
        self.assertNotIn("tp", decoded)
        with self.assertRaises(ValueError):
            decode(self.grib(skip=("tp",)), RUN, 6)

    def test_decode_rejects_missing_duplicate_foreign_and_implausible_fields(self):
        duplicate = {"parameterCategory": 0, "parameterNumber": 0, "typeOfLevel": "surface",
                     "level": 0, "value": 280.0}
        for path in [self.grib(skip=("prate",)), self.grib(extra=[duplicate]),
                     self.grib(changes={"t2m": {"centre": "ecmf"}}),
                     self.grib(changes={"pmsl": {"value": 50000.0}}),
                     self.grib(changes={"crain": {"value": -1.0}})]:
            with self.subTest(path=path.name), self.assertRaises(ValueError):
                decode(path, RUN, 6)

    def test_decode_refuses_another_run_or_lead_time(self):
        with self.assertRaises(ValueError):
            decode(self.grib(run="2026091606"), RUN, 6)
        with self.assertRaises(ValueError):
            decode(self.grib(hour=9), RUN, 6)

    # --- derived variables ------------------------------------------------
    def test_present_weather_is_graded_from_gfs_rate_type_visibility_and_cloud(self):
        def code(mm_per_hour=0.0, kind="rain", vis=20.0, cloud=0.0):
            flags = {name: [1.0 if name == kind or (kind == "sleet" and name in ("crain", "csnow"))
                            else 0.0] for name in ("crain", "cfrzr", "cicep", "csnow")}
            return present_weather([mm_per_hour / 3600], flags["crain"], flags["cfrzr"],
                                   flags["cicep"], flags["csnow"], [vis], [cloud])[0]
        self.assertEqual([code(cloud=c) for c in (0, 30, 60, 95)], [0, 1, 2, 3])
        self.assertEqual(code(vis=0.4, cloud=100), 45)
        self.assertEqual([code(r, "crain") for r in (0.5, 4, 10)], [61, 63, 65])
        self.assertEqual([code(r, "csnow") for r in (0.5, 4, 10)], [71, 73, 75])
        self.assertEqual([code(r, "cfrzr") for r in (0.5, 10)], [66, 67])
        self.assertEqual(code(1, "cicep"), 79)
        self.assertEqual(code(1, "sleet"), 68)
        # Precipitation GFS gives no type for is rain; a trace under the threshold is none.
        self.assertEqual(code(1, "none"), 61)
        self.assertEqual(code(0.05, "crain", cloud=100), 3)

    def test_rain_is_the_accumulations_increase_and_the_first_interval_its_first_total(self):
        first = derive(fields(tp=1.2), None)
        self.assertEqual(first["precip"], [1.2] * 4)
        later = derive(fields(tp=1.0), [1.2] * 4)
        self.assertEqual(later["precip"], [0.0] * 4)      # Never negative rain.
        start = {name: value for name, value in fields().items() if name != "tp"}
        initial = derive(start, None)
        self.assertIsNone(initial["tp"])
        self.assertIsNone(initial["precip"])
        self.assertEqual(set(initial), set(VARIABLES))
        self.assertEqual(initial["ww"], [61] * 4)         # 1.8 mm/h of rain.

    # --- source addressing ------------------------------------------------
    def test_filter_request_asks_for_every_field_in_the_ireland_subregion(self):
        url = filter_url(RUN, 6)
        for fragment in ["dir=%2Fgfs.20260916%2F12%2Fatmos", "file=gfs.t12z.pgrb2.0p25.f006",
                         "var_TMP=on", "var_APCP=on", "var_TCDC=on", "var_PRATE=on",
                         "var_CRAIN=on", "lev_2_m_above_ground=on", "lev_entire_atmosphere=on",
                         "lev_low_cloud_layer=on", "lev_mean_sea_level=on", "leftlon=-18.0",
                         "rightlon=2.0", "toplat=59.0", "bottomlat=48.0"]:
            self.assertIn(fragment, url)

    def idx(self, hour, total=True):
        step = "anl" if hour == 0 else f"{hour} hour fcst"
        lines = []
        for name, (record, level) in fetch_gfs_weather.RECORDS.items():
            if name == "tp":
                if hour == 0:
                    continue
                lines.append((record, level, f"{hour - 3}-{hour} hour acc fcst"))
                if total:
                    lines.append((record, level, sorted(accumulation_step(hour))[0]))
            else:
                lines.append((record, level, step))
                lines.append((record, level, f"{max(hour - 3, 0)}-{hour} hour ave fcst"))
        return "".join(f"{i}:{i * 100}:d={RUN}:{record}:{level}:{step}:\n"
                       for i, (record, level, step) in enumerate(lines, 1))

    def test_index_ranges_pick_the_hours_fields_and_the_run_total(self):
        self.assertEqual(accumulation_step(24), {"0-24 hour acc fcst", "0-1 day acc fcst"})
        for hour in (0, 3, 24, 240):
            with self.subTest(hour=hour):
                ranges = index_ranges(self.idx(hour), hour)
                self.assertEqual(len(ranges), len(READ) - (hour == 0))
        with self.assertRaises(ValueError):
            index_ranges(self.idx(6, total=False), 6)
        with self.assertRaises(ValueError):
            index_ranges(self.idx(6), 9)

    def test_invalid_horizons_and_runs_are_refused(self):
        for arguments in [["--hours", "400"], ["--hours", "0"], ["--hours", "10"],
                          ["--run", "2026091613"], ["--source", "ecmwf"]]:
            with self.subTest(arguments=arguments), redirect_stderr(io.StringIO()), \
                 self.assertRaises(SystemExit):
                main(arguments)

    # --- publication ------------------------------------------------------
    def fresh_cycle(self):
        now = datetime.now(timezone.utc)
        return now.replace(minute=0, second=0, microsecond=0, hour=now.hour // 6 * 6).strftime("%Y%m%d%H")

    def test_publishes_a_weather_bundle_the_publisher_accepts(self):
        spots = self.root / "spots.json"
        spots.write_text(json.dumps([{"id": "brandon", "lat": 54.1, "lon": -17.9}]))
        use_catalogue(self, spots)
        run = self.fresh_cycle()

        def stamped(path, run_id, hour, layout=None):
            return decode(self.grib(hour=hour, run=run), run_id, hour, layout)
        with patch("fetch_gfs_weather.ROOT", self.root), \
             patch.dict("os.environ", {"FORCE5_SPOTS_FILE": str(spots)}, clear=True), \
             patch("fetch_gfs.inventory", return_value={0, 3, 6}), \
             patch("fetch_gfs_weather.download", return_value=b"GRIB-stub"), \
             patch("fetch_gfs_weather.decode", side_effect=stamped), \
             patch("sys.stdout", io.StringIO()):
            main(["--hours", "6", "--run", run])
        manifest = read_whole(self.root / "public/weather/gfs-weather.json")
        self.assertEqual((manifest["kind"], manifest["model"], manifest["stepHours"],
                          manifest["horizonHours"], manifest["frames"]),
                         ("weather", "gfs-weather", 3, 6, []))
        series = manifest["spotSeries"]["brandon"]
        self.assertEqual([step["precipIntervalHours"] for step in series], [None, [0, 3], [3, 6]])
        self.assertEqual([step["values"]["precip"] for step in series], [None, 4.0, 0.0])
        self.assertEqual(series[1]["values"]["ww"], 61)
        self.assertEqual(series[1]["values"]["t2m"], 10.0)
        self.assertIn("derived", manifest["presentWeatherNote"])
        validate_bundle(self.root / "public", "gfs-weather",
                        max_age_hours=MODELS["gfs-weather"]["maxAgeHours"])

    def test_the_run_the_bucket_serves_is_not_downloaded_again(self):
        run = self.fresh_cycle()
        with patch("fetch_gfs_weather.ROOT", self.root), \
             patch.dict("os.environ", {"FORCE5_PUBLISHED_RUN": run}), \
             patch("fetch_gfs_weather.discover", return_value=run), \
             patch("fetch_gfs_weather.download") as download, \
             patch("sys.stdout", io.StringIO()):
            self.assertEqual(main(["--hours", "6"]), UNCHANGED_EXIT)
        download.assert_not_called()

    def test_a_stale_run_is_refused_before_any_download(self):
        with patch("fetch_gfs_weather.ROOT", self.root), \
             patch("fetch_gfs_weather.discover", return_value="2020010100"), \
             patch("fetch_gfs_weather.download") as download, \
             self.assertRaises(ValueError):
            main(["--hours", "6"])
        download.assert_not_called()


if __name__ == "__main__":
    unittest.main()
