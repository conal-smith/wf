"""Met Office North-West Shelf wave adapter tests, against a fake bucket; no network.

The files are built here with h5py in the layout the Met Office publishes
(checked against the 12 UTC run of 4 November 2026): one NetCDF4 file per
parameter per day of forecast, one gzip chunk per hourly field, values packed as
int16 with a scale factor and -32767 for land. Only the grid is smaller.
"""
from datetime import datetime, timedelta, timezone
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import h5py
import numpy as np

import fetch_met_office_wave as wave
from fetch_met_office_wave import FORECAST_HOURS, SOURCES, main
from publish_s3 import validate_bundle
from registry import MODELS, PUBLISHED_RUN_ENV, UNCHANGED_EXIT
from runfixtures import read_whole, use_catalogue

ROWS, COLUMNS = 40, 30
LAT0, LON0 = 52.0, -10.5
D_LAT, D_LON = 1 / 74, 1 / 33
FILL = -32767
LAND_FROM = 20  # Columns from here east are land.
SPOTS = [
    # Open water, a few cells from any land.
    {"id": "sea", "name": "Open bay", "lat": 52.2, "lon": -10.3},
    # On the first land column: the nearest wet cell is the coastline's.
    {"id": "beach", "name": "Beach", "lat": 52.2, "lon": LON0 + LAND_FROM * D_LON + 0.005},
    # More than 8 km of land from the nearest water.
    {"id": "inland", "name": "Inland lake", "lat": 52.2, "lon": LON0 + 29 * D_LON},
    # Inside the model's domain but not this small grid.
    {"id": "north", "name": "Far north", "lat": 60.0, "lon": -5.0},
]
COAST_DIRECTION = 135.0


def wet(row, column):
    return column < LAND_FROM


def value(name, hour, row, column):
    """Plausible, distinguishable numbers; the third swell is absent everywhere."""
    kind = SOURCES[name][3]
    if name.startswith("swell3"):
        return 0.0
    if kind == wave.HEIGHT:
        return 1.0 + 0.01 * hour + 0.001 * column
    if kind == wave.PERIOD:
        return 9.0 + 0.1 * (hour % 10)
    # A coastline cell's bearing points out to sea whatever the wind does.
    return COAST_DIRECTION if column == LAND_FROM - 1 else 270.0 + 0.5 * (hour % 20)


PACKING = {wave.HEIGHT: (0.002, 32000), wave.PERIOD: (0.01, 10000), wave.DIRECTION: (0.1, 3600)}


def netcdf(name, run, start, hours=FORECAST_HOURS, *, reference=None, units=None,
           shift=0.0, overrides=None):
    """One parameter file, as bytes."""
    parameter, variable, standard, kind = SOURCES[name][:4]
    scale, top = PACKING[kind]
    steps = list(range(start, min(start + 23, hours) + 1))
    buffer = io.BytesIO()
    with h5py.File(buffer, "w") as handle:
        handle.attrs["title"] = np.bytes_("Wave Model Forecast on UK 1.5km Wave Standard Grid")
        handle["latitude"] = LAT0 + shift + D_LAT * np.arange(ROWS)
        handle["longitude"] = LON0 + D_LON * np.arange(COLUMNS)
        frt = handle.create_dataset("forecast_reference_time",
                                    data=np.int64(int((reference or run).timestamp())))
        frt.attrs["units"] = np.bytes_("seconds since 1970-01-01T00:00:00")
        handle["forecast_period"] = np.array([3600 * h for h in steps], dtype=np.int32)
        handle["time"] = np.array([int(run.timestamp()) + 3600 * h for h in steps],
                                  dtype=np.int64)
        packed = np.full((len(steps), ROWS, COLUMNS), FILL, dtype=np.int16)
        for index, hour in enumerate(steps):
            for row in range(ROWS):
                for column in range(COLUMNS):
                    if wet(row, column):
                        number = (overrides or {}).get((hour, row, column))
                        number = value(name, hour, row, column) if number is None else number
                        packed[index, row, column] = round(number / scale)
        dataset = handle.create_dataset(variable, data=packed, chunks=(1, ROWS, COLUMNS),
                                        compression="gzip", compression_opts=1, shuffle=True)
        attributes = {"standard_name": np.bytes_(standard),
                      "units": np.bytes_(units or wave.UNITS[kind][0]),
                      "scale_factor": np.array([scale], dtype=np.float32),
                      "add_offset": np.array([0.0], dtype=np.float32),
                      "_FillValue": np.array([FILL], dtype=np.int16),
                      "valid_min": np.array([0], dtype=np.int16),
                      "valid_max": np.array([top], dtype=np.int16)}
        for key, item in attributes.items():
            dataset.attrs[key] = item
    return buffer.getvalue()


def key_for(run, start, parameter, grid=wave.GRID_NAME):
    begin = run + timedelta(hours=start)
    return (f"{wave.run_prefix(run)}b{wave.compact(run)}_hi{wave.compact(begin)}-"
            f"{grid}-{parameter}.nc")


class Response:
    def __init__(self, content):
        self.content = content


class FakeBucket:
    """A ListObjectsV2 listing and the objects themselves."""

    def __init__(self):
        self.objects, self.requests = {}, []

    def add_run(self, run, skip=(), grid=wave.GRID_NAME, changes=None):
        for name, (parameter, *_) in SOURCES.items():
            for start in (0, 24, 48):
                if (parameter, start) in skip:
                    continue
                body = netcdf(name, run, start, **((changes or {}).get((name, start)) or {}))
                self.objects[key_for(run, start, parameter, grid)] = body
        # Files nothing reads are in the run's directory too.
        self.objects[key_for(run, 0, "wave_grid_depth")] = b"depth"

    def get(self, url):
        self.requests.append(url)
        if "/?list-type=2" in url:
            prefix = url.split("prefix=", 1)[1].split("&", 1)[0]
            items = "".join(f"<Contents><Key>{key}</Key><Size>{len(body)}</Size></Contents>"
                            for key, body in sorted(self.objects.items())
                            if key.startswith(prefix))
            return Response(('<?xml version="1.0" encoding="UTF-8"?><ListBucketResult '
                             'xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                             f"{items}<IsTruncated>false</IsTruncated></ListBucketResult>")
                            .encode())
        key = url.split(".amazonaws.com/", 1)[1]
        return Response(self.objects[key])


class MetOfficeWaveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        # The newest cycle at least three hours old, as the 03/09/15/21 UTC slots find it.
        newest = now - timedelta(hours=3)
        self.run = newest - timedelta(hours=newest.hour % 6)
        self.now = self.run + timedelta(hours=3, minutes=5)
        for patcher in (patch.object(wave, "EXPECTED_SHAPE", (ROWS, COLUMNS)),
                        patch("fetch_met_office_wave.ROOT", self.root),
                        patch("fetch_met_office_wave.load_spots", return_value=SPOTS)):
            patcher.start()
            self.addCleanup(patcher.stop)
        use_catalogue(self, SPOTS)

    def run_main(self, *argv, bucket=None, now=None):
        self.bucket = bucket
        if bucket is None:
            self.bucket = FakeBucket()
            self.bucket.add_run(self.run)
        with patch("fetch_met_office_wave.get", side_effect=self.bucket.get):
            result = main(list(argv), now=now or self.now)
        if result == UNCHANGED_EXIT:
            return result
        return read_whole(self.root / "public/weather/met-office-wave.json")

    def test_a_run_publishes_a_valid_hourly_wave_bundle(self):
        manifest = self.run_main()
        self.assertEqual((manifest["kind"], manifest["model"]), ("wave", "met-office-wave"))
        self.assertEqual(manifest["run"], self.run.strftime("%Y%m%d%H"))
        self.assertEqual((manifest["stepHours"], manifest["horizonHours"]), (1, 60))
        self.assertEqual(manifest["frames"], [])
        self.assertEqual(set(manifest["variables"]), set(SOURCES))
        series = manifest["spotSeries"]["sea"]
        self.assertEqual([step["hour"] for step in series], list(range(61)))
        self.assertEqual(series[-1]["validTime"], wave.stamp(self.run + timedelta(hours=60)))
        self.assertIn("CC BY-SA 4.0", manifest["attribution"])
        self.assertEqual(manifest["licenseUrl"], "https://creativecommons.org/licenses/by-sa/4.0/")
        validate_bundle(self.root / "public", "met-office-wave",
                        MODELS["met-office-wave"]["maxAgeHours"], now=self.now)

    def test_values_are_unpacked_from_the_files_hour_by_hour(self):
        manifest = self.run_main()
        coverage = manifest["spotCoverage"]["sea"]
        column = round((coverage["cellLon"] - LON0) / D_LON)
        for step in manifest["spotSeries"]["sea"]:
            hour, values = step["hour"], step["values"]
            self.assertAlmostEqual(values["swh"], 1.0 + 0.01 * hour + 0.001 * column, places=2)
            self.assertAlmostEqual(values["swell1_p"], 9.0 + 0.1 * (hour % 10), places=2)
            self.assertAlmostEqual(values["mwd"], 270.0 + 0.5 * (hour % 20), places=1)

    def test_an_absent_partition_has_no_period_or_direction(self):
        for step in self.run_main()["spotSeries"]["sea"]:
            self.assertEqual(step["values"]["swell3_h"], 0.0)
            self.assertIsNone(step["values"]["swell3_p"])
            self.assertIsNone(step["values"]["swell3_d"])
            self.assertIsNotNone(step["values"]["swell1_d"])

    def test_a_spot_in_open_water_reads_its_own_cell(self):
        coverage = self.run_main()["spotCoverage"]["sea"]
        self.assertFalse(coverage["landMasked"])
        self.assertTrue(coverage["resolved"])
        self.assertLess(coverage["nearestOffsetKm"], 1.0)
        self.assertEqual(coverage["directionCell"]["lat"], coverage["cellLat"])

    def test_a_land_cell_reads_the_nearest_wet_one_and_directions_from_open_water(self):
        manifest = self.run_main()
        coverage = manifest["spotCoverage"]["beach"]
        self.assertTrue(coverage["landMasked"])
        self.assertTrue(coverage["resolved"])
        self.assertAlmostEqual(coverage["cellLon"], round(LON0 + 19 * D_LON, 5))
        self.assertAlmostEqual(coverage["directionCell"]["lon"], round(LON0 + 18 * D_LON, 5))
        self.assertIn("land in the wave model", coverage["note"])
        for step in manifest["spotSeries"]["beach"]:
            self.assertAlmostEqual(step["values"]["swh"], 1.0 + 0.01 * step["hour"] + 0.019, 2)
            self.assertNotEqual(step["values"]["mwd"], COAST_DIRECTION)

    def test_no_cell_within_the_limit_publishes_nulls_with_a_reason(self):
        manifest = self.run_main()
        for spot, words in (("inland", "within 8 km"), ("north", "outside")):
            coverage = manifest["spotCoverage"][spot]
            self.assertFalse(coverage["resolved"])
            self.assertIsNone(coverage["nearestOffsetKm"])
            self.assertIn(words, coverage["note"])
            self.assertTrue(all(value is None for step in manifest["spotSeries"][spot]
                                for value in step["values"].values()))

    def test_an_incomplete_newest_run_falls_back_to_the_one_before(self):
        bucket = FakeBucket()
        bucket.add_run(self.run - timedelta(hours=6))
        bucket.add_run(self.run, skip={("wave_significant_height", 48)})
        manifest = self.run_main(bucket=bucket)
        self.assertEqual(manifest["run"], (self.run - timedelta(hours=6)).strftime("%Y%m%d%H"))

    def test_a_new_grid_version_is_not_read(self):
        bucket = FakeBucket()
        bucket.add_run(self.run, grid="wave_uk_standard_v2-level_1")
        with self.assertRaises(RuntimeError):
            self.run_main(bucket=bucket)

    def test_a_run_the_bucket_already_serves_downloads_nothing(self):
        bucket = FakeBucket()
        bucket.add_run(self.run)
        with patch.dict("os.environ", {PUBLISHED_RUN_ENV: self.run.strftime("%Y%m%d%H")}):
            self.assertEqual(self.run_main(bucket=bucket), UNCHANGED_EXIT)
        self.assertTrue(all("list-type" in url for url in bucket.requests))

    def test_a_stale_run_is_refused(self):
        with self.assertRaises(ValueError):
            self.run_main(now=self.run + timedelta(hours=13))

    def test_a_file_from_another_run_is_refused(self):
        bucket = FakeBucket()
        bucket.add_run(self.run, changes={("pp1d", 24): {"reference": self.run - timedelta(hours=6)}})
        with self.assertRaisesRegex(ValueError, "is not the"):
            self.run_main(bucket=bucket)

    def test_changed_units_are_refused(self):
        bucket = FakeBucket()
        bucket.add_run(self.run, changes={("swell2_h", 0): {"units": "cm"}})
        with self.assertRaisesRegex(ValueError, "units"):
            self.run_main(bucket=bucket)

    def test_a_file_on_a_different_grid_is_refused(self):
        bucket = FakeBucket()
        bucket.add_run(self.run, changes={("mdww", 48): {"shift": 0.5}})
        with self.assertRaisesRegex(ValueError, "different grid"):
            self.run_main(bucket=bucket)

    def test_an_implausible_value_is_refused(self):
        # Row 15, column 7 is the cell the open-bay spot reads: only cells read are checked.
        bucket = FakeBucket()
        bucket.add_run(self.run, changes={("swh", 24): {"overrides": {(30, 15, 7): 45.0}}})
        with self.assertRaises(ValueError):
            self.run_main(bucket=bucket)

    def test_a_shorter_horizon_reads_only_the_files_it_needs(self):
        manifest = self.run_main("--hours", "12")
        self.assertEqual(manifest["horizonHours"], 12)
        downloaded = [url for url in self.bucket.requests if "list-type" not in url]
        self.assertEqual(len(downloaded), len(SOURCES))

    def test_every_source_name_is_a_publishable_variable(self):
        for name, meta in wave.VARIABLES.items():
            self.assertRegex(name, r"^[a-z][a-z0-9_]{0,31}$")
            self.assertTrue(all(meta[key] for key in ("units", "label", "description")))


if __name__ == "__main__":
    unittest.main()
