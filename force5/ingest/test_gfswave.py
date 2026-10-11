"""Offline GFS-Wave importer tests: no network, no provider credentials."""
from contextlib import redirect_stderr
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import eccodes as ec
import numpy as np
from pyproj import CRS, Transformer

import fetch_gfs
import fetch_gfswave
from fetch_gfswave import (GRID, VARIABLES, block_origin, decode, discover, filter_url,
                           inventory, main, object_key, parent_origin, resample,
                           sample_wave, validate_metadata)
from fetch_forecast import sample
from publish_s3 import validate_bundle
from registry import UNCHANGED_EXIT
from runfixtures import read_whole

NOW = datetime(2026, 9, 16, 21, 40, tzinfo=timezone.utc)
RUN = "2026091612"
# Measured against the whole-grid message on 16 September 2026: the two Ireland
# cut-outs NOMADS returns are these blocks of the 1006 × 1006 arctic.9km grid,
# matched by identical values rather than by re-deriving the coordinates.
CUT_OUTS = {(-10.820228, 50.542584, 56, 72): (409, 18),
            (-11.742405, 49.371878, 75, 100): (398, 4)}
BLOCK = (-11.742405, 49.371878, 75, 100)  # Covers the published display grid.
SPOTS = [{"id": "brandon", "name": "Brandon Bay", "lat": 52.276, "lon": -10.024},
         {"id": "dollymount", "name": "Dollymount", "lat": 53.365, "lon": -6.135}]


def idx(hour, prefix=(), missing=()):
    """A miniature GFS-Wave .idx sidecar in the provider's record order."""
    step = "anl" if hour == 0 else f"{hour} hour fcst"
    records = [f"{name}:{level}" for name, level in
               (entry["record"] for entry in VARIABLES.values())
               if f"{name}:{level}" not in missing]
    lines = list(prefix)
    for index, record in enumerate(records, len(prefix) + 1):
        lines.append(f"{index}:{index * 1000}:d={RUN}:{record}:{step}:")
    return "\n".join(lines) + "\n"


class GfsWaveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        fetch_gfs.THROTTLE.pause = 0
        self.metadata = {"discipline": 10, "parameterCategory": 0, "parameterNumber": 3,
                         "units": "m", "typeOfFirstFixedSurface": 1,
                         "scaledValueOfFirstFixedSurface": 1, "scaleFactorOfFirstFixedSurface": 0,
                         "stepType": "instant", "stepUnits": 1, "startStep": 6, "endStep": 6,
                         "dataDate": 20260916, "dataTime": 1200, "validityDate": 20260916,
                         "validityTime": 1800}

    # --- fake source data ------------------------------------------------
    def values(self, name, nx, ny, land_rows=0):
        """A field with a plausible range and `land_rows` northern rows masked."""
        kind = VARIABLES[name]["kind"]
        base = {"height": 1.5, "period": 9.0, "direction": 250.0}[kind]
        grid = np.full((ny, nx), base) + np.arange(nx) * 0.01
        if land_rows:
            grid[ny - land_rows:] = 9999.0
        return grid.ravel()

    def grib(self, run=RUN, hour=6, block=BLOCK, land_rows=0, changes=None, omit=()):
        """Nine real GRIB2 messages shaped like a NOMADS arctic.9km cut-out."""
        lon, lat, nx, ny = block
        path = Path(tempfile.mkstemp(suffix=".grib2", dir=self.root)[1])
        with path.open("wb") as stream:
            for name, entry in VARIABLES.items():
                if name in omit:
                    continue
                overrides = dict((changes or {}).get(name, {}))
                replacement = overrides.pop("values", None)
                handle = ec.codes_grib_new_from_samples("polar_stereographic_pl_grib2")
                try:
                    settings = {"centre": "kwbc", "discipline": 10, "parameterCategory": 0,
                                "parameterNumber": entry["number"],
                                "typeOfFirstFixedSurface": entry["level"][0],
                                "typeOfSecondFixedSurface": 255,
                                "scaleFactorOfFirstFixedSurface": 0,
                                "scaledValueOfFirstFixedSurface": entry["level"][1],
                                "shapeOfTheEarth": 5, "Nx": nx, "Ny": ny,
                                "latitudeOfFirstGridPointInDegrees": lat,
                                "longitudeOfFirstGridPointInDegrees": lon % 360,
                                "LaDInDegrees": 70.0, "orientationOfTheGridInDegrees": 0.0,
                                "DxInMetres": 9000, "DyInMetres": 9000,
                                "projectionCentreFlag": 0, "iScansNegatively": 0,
                                "jScansPositively": 1, "jPointsAreConsecutive": 0,
                                "dataDate": int(run[:8]), "dataTime": int(run[-2:]) * 100,
                                "stepUnits": 1, "forecastTime": hour, **overrides}
                    for key, value in settings.items():
                        ec.codes_set(handle, key, value)
                    ec.codes_set(handle, "missingValue", 9999)
                    ec.codes_set(handle, "bitmapPresent", 1)
                    ec.codes_set_values(handle, self.values(name, settings["Nx"], settings["Ny"],
                                        land_rows) if replacement is None else replacement)
                    ec.codes_write(handle, stream)
                finally:
                    ec.codes_release(handle)
        return path

    # --- geometry --------------------------------------------------------
    def test_parent_lattice_is_the_pole_centred_grid_the_header_declares(self):
        expected = -(fetch_gfswave.PARENT_POINTS - 1) / 2 * fetch_gfswave.SPACING
        self.assertAlmostEqual(parent_origin(), expected, places=6)
        # Independently: the published corner of the whole grid projects there.
        crs = CRS.from_proj4("+proj=stere +lat_0=90 +lat_ts=70 +lon_0=0 +ellps=WGS84 "
                            "+units=m +no_defs")
        x, y = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform(-45.0, 35.349744)
        self.assertLess(max(abs(x - expected), abs(y - expected)), 1.0)

    def test_cut_out_corners_resolve_to_the_measured_parent_cells(self):
        for (lon, lat, nx, ny), block in CUT_OUTS.items():
            with self.subTest(lon=lon):
                self.assertEqual(block_origin(lon, lat, nx, ny), block)

    def test_corners_off_the_lattice_or_outside_the_grid_are_refused(self):
        lon, lat, nx, ny = BLOCK
        for arguments in [(lon, lat + 0.04, nx, ny), (lon + 0.06, lat, nx, ny),
                          (lon, lat, 1006, ny), (lon, lat, nx, 1006)]:
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                block_origin(*arguments)

    def test_display_stencil_matches_an_independent_pyproj_calculation(self):
        fields, layout, _ = decode(self.grib(), RUN, 6, SPOTS)
        nx, ny = layout["size"]
        i0, j0 = layout["block"]
        self.assertEqual((nx, ny), BLOCK[2:])
        self.assertEqual((i0, j0), CUT_OUTS[BLOCK])
        crs = CRS.from_proj4("+proj=stere +lat_0=90 +lat_ts=70 +lon_0=0 +ellps=WGS84 "
                            "+units=m +no_defs")
        forward = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        origin = -(fetch_gfswave.PARENT_POINTS - 1) / 2 * fetch_gfswave.SPACING
        for row, column in [(0, 0), (50, 60), (GRID["height"] - 1, GRID["width"] - 1), (17, 99)]:
            cell = row * GRID["width"] + column
            x, y = forward.transform(GRID["west"] + column * GRID["dx"],
                                     GRID["north"] - row * GRID["dy"])
            gx = (x - (origin + i0 * 9000.0)) / 9000.0
            gy = (y - (origin + j0 * 9000.0)) / 9000.0
            ix, iy = min(int(np.floor(gx)), nx - 2), min(int(np.floor(gy)), ny - 2)
            self.assertEqual(layout["corners"][0][cell], iy * nx + ix)
            self.assertAlmostEqual(layout["weights"][3][cell], (gx - ix) * (gy - iy), places=9)
        self.assertEqual(len(fields["swh"]), GRID["width"] * GRID["height"])
        self.assertEqual(GRID["width"] * GRID["height"], 121 * 101)

    def test_a_block_that_misses_the_display_grid_is_refused(self):
        with self.assertRaises(ValueError) as caught:
            decode(self.grib(block=(-10.820228, 50.542584, 56, 72)), RUN, 6, SPOTS)
        self.assertIn("Display grid", str(caught.exception))

    def test_grid_must_not_change_inside_a_run(self):
        _, layout, _ = decode(self.grib(), RUN, 6, SPOTS)
        wider = (-11.742405, 49.371878, 76, 100)
        with self.assertRaises(ValueError):
            decode(self.grib(block=wider), RUN, 6, SPOTS, layout)

    # --- resampling ------------------------------------------------------
    def layout(self, weights=(0.25, 0.25, 0.25, 0.25)):
        return {"corners": np.array([[0], [1], [2], [3]]),
                "weights": np.array([[w] for w in weights])}

    def test_land_cells_are_null_and_partial_stencils_renormalise(self):
        values = np.array([2.0, 4.0, 0.0, 0.0])
        both = np.array([True, True, False, False])
        self.assertEqual(resample(values, both, "height", self.layout()), [3.0])
        self.assertEqual(resample(values, np.array([True, False, False, False]),
                                  "height", self.layout()), [2.0])
        # No water in reach is null, never zero.
        self.assertEqual(resample(values, np.zeros(4, bool), "height", self.layout()), [None])

    def test_directions_average_as_vectors_across_the_wrap(self):
        values = np.array([350.0, 10.0, 0.0, 0.0])
        valid = np.array([True, True, False, False])
        self.assertEqual(resample(values, valid, "direction", self.layout()), [0.0])
        # A degree mean would answer 180° here; the vector mean answers 0°.
        opposite = resample(np.array([90.0, 270.0, 0.0, 0.0]), valid, "direction", self.layout())
        self.assertIsNotNone(opposite[0])
        self.assertEqual(resample(np.array([100.0, 140.0, 0.0, 0.0]), valid,
                                  "direction", self.layout()), [120.0])

    def test_published_directions_stay_inside_one_turn(self):
        for degrees in (359.97, 360.0, 0.0, 179.94):
            with self.subTest(degrees=degrees):
                value = resample(np.array([degrees] * 4), np.ones(4, bool),
                                 "direction", self.layout())[0]
                self.assertGreaterEqual(value, 0.0)
                self.assertLess(value, 360.0)

    def test_spot_sampling_is_the_shared_bilinear_with_null_propagation(self):
        grid = {"width": 3, "height": 3, "west": -11.0, "north": 56.0, "dx": 0.05, "dy": 0.05}
        values = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, None]
        self.assertEqual(sample_wave(grid, values, -10.975, 55.975),
                         sample(grid, values, -10.975, 55.975))
        self.assertIsNone(sample_wave(grid, values, -10.92, 55.92))  # Touches the null.
        self.assertIsNone(sample_wave(grid, values, -20.0, 55.0))    # Outside the grid.

    # --- decoding --------------------------------------------------------
    def test_decode_keeps_every_declared_variable_and_nulls_the_land(self):
        fields, _, land = decode(self.grib(land_rows=60), RUN, 6, SPOTS)
        self.assertEqual(set(fields), set(VARIABLES))
        for name, values in fields.items():
            with self.subTest(name=name):
                self.assertEqual(len(values), GRID["width"] * GRID["height"])
                self.assertTrue(any(value is None for value in values))
                self.assertTrue(any(value is not None for value in values))
                self.assertNotIn(0.0, [v for v in values if v is not None])
        # The masked rows are the northern ones, so the north is null.
        self.assertIsNone(fields["swh"][0])
        self.assertIsNotNone(fields["swh"][-1])
        self.assertEqual(set(land), {"brandon", "dollymount"})

    def test_decode_rejects_missing_duplicate_and_foreign_messages(self):
        with self.assertRaises(ValueError):
            decode(self.grib(omit=("mwd",)), RUN, 6, SPOTS)
        with self.assertRaises(ValueError):
            decode(self.grib(changes={"pp1d": {"parameterNumber": 3}}), RUN, 6, SPOTS)
        with self.assertRaises(ValueError):
            decode(self.grib(changes={"swh": {"centre": "ecmf"}}), RUN, 6, SPOTS)

    def test_decode_rejects_a_swell_partition_in_place_of_a_surface_field(self):
        # SWELL level 2 is a different wave train; it must not pass as level 1.
        with self.assertRaises(ValueError):
            decode(self.grib(changes={"swell1_h": {"scaledValueOfFirstFixedSurface": 2}}),
                   RUN, 6, SPOTS)

    def test_decode_rejects_implausible_values(self):
        cases = {"swh": {"values": np.full(7500, 40.0)},
                 "pp1d": {"values": np.full(7500, 0.0)},
                 "mwd": {"values": np.full(7500, 400.0)},
                 "swell1_p": {"values": np.full(7500, 31.0)}}
        for name, change in cases.items():
            with self.subTest(name=name), self.assertRaises(ValueError):
                decode(self.grib(changes={name: change}), RUN, 6, SPOTS)

    def test_decode_rejects_a_field_with_no_water_at_all(self):
        with self.assertRaises(ValueError):
            decode(self.grib(land_rows=100), RUN, 6, SPOTS)

    def test_metadata_validation_rejects_wrong_parameter_level_and_time(self):
        validate_metadata(self.metadata, "swh", RUN, 6)
        validate_metadata({**self.metadata, "parameterNumber": 8, "units": "m",
                           "typeOfFirstFixedSurface": 241}, "swell1_h", RUN, 6)
        for key, value in [("discipline", 0), ("parameterCategory", 2), ("parameterNumber", 5),
                           ("units", "ft"), ("typeOfFirstFixedSurface", 241),
                           ("scaledValueOfFirstFixedSurface", 2),
                           ("scaleFactorOfFirstFixedSurface", 1), ("stepType", "max"),
                           ("stepUnits", 0), ("startStep", 3), ("endStep", 9),
                           ("dataTime", 0), ("validityTime", 2100)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_metadata({**self.metadata, key: value}, "swh", RUN, 6)

    # --- source addressing ----------------------------------------------
    def test_filter_request_asks_only_for_the_nine_published_fields(self):
        url = filter_url(RUN, 6)
        for fragment in ["dir=%2Fgfs.20260916%2F12%2Fwave%2Fgridded",
                         "file=gfswave.t12z.arctic.9km.f006.grib2",
                         "var_HTSGW=on", "var_PERPW=on", "var_DIRPW=on", "var_WVHGT=on",
                         "var_WVPER=on", "var_WVDIR=on", "var_SWELL=on", "var_SWPER=on",
                         "var_SWDIR=on", "lev_surface=on", "lev_1_in_sequence=on",
                         "leftlon=-12.0", "rightlon=-4.0", "toplat=57.0", "bottomlat=50.0"]:
            self.assertIn(fragment, url)
        # Partitions 2 and 3 are not published, so they are not downloaded.
        self.assertNotIn("lev_2_in_sequence", url)
        self.assertNotIn("var_UGRD", url)
        self.assertEqual(object_key(RUN, 240),
                         "gfs.20260916/12/wave/gridded/gfswave.t12z.arctic.9km.f240.grib2")

    def test_s3_download_concatenates_every_wave_record_by_range(self):
        calls = []

        def fake(url, headers=None, attempts=4):
            calls.append((url, (headers or {}).get("Range")))
            return idx(6).encode() if url.endswith(".idx") else b"GRIB-part"
        with patch("fetch_gfswave.get", side_effect=fake):
            self.assertEqual(fetch_gfswave.download("s3", RUN, 6), b"GRIB-part" * 9)
        self.assertEqual(calls[0][1], None)
        self.assertEqual([call[1] for call in calls[1:]],
                         [f"bytes={n * 1000}-{(n + 1) * 1000 - 1}" for n in range(1, 9)]
                         + ["bytes=9000-"])

    def test_index_reading_refuses_absent_or_mislabelled_records(self):
        for text, hour in [(idx(6, missing=("SWELL:1 in sequence",)), 6), (idx(6), 9),
                           (idx(0), 6), ("", 6)]:
            with self.subTest(hour=hour), self.assertRaises(ValueError):
                fetch_gfs.index_ranges(text, hour, fetch_gfswave.RECORDS)

    # --- discovery -------------------------------------------------------
    def test_discovery_prefers_the_newest_complete_cycle(self):
        pages = {"2026091618": {0, 3}, RUN: {0, 3, 6}, "2026091606": {0, 3, 6}}
        with patch("fetch_gfswave.inventory", side_effect=lambda source, run: pages.get(run, set())):
            self.assertEqual(discover("nomads", [0, 3, 6], now=NOW), RUN)

    def test_discovery_skips_unreadable_inventories_and_reports_nothing_complete(self):
        def flaky(source, run):
            if run == "2026091618":
                raise OSError("listing unavailable")
            return {0, 3}
        with patch("fetch_gfswave.inventory", side_effect=flaky):
            self.assertEqual(discover("nomads", [0, 3], now=NOW), RUN)
            with self.assertRaises(RuntimeError):
                discover("nomads", [0, 3, 6], now=NOW)

    def test_inventory_reads_the_provider_listing_not_a_release_schedule(self):
        page = ('<option value="gfswave.t12z.arctic.9km.f000.grib2">'
                '<option value="gfswave.t12z.arctic.9km.f003.grib2">'
                '<option value="gfswave.t12z.global.0p25.f006.grib2">'
                '<option value="gfswave.t06z.arctic.9km.f006.grib2">')
        with patch("fetch_gfswave.get", return_value=page.encode()):
            self.assertEqual(inventory("nomads", RUN), {0, 3})
        listing = ("<ListBucketResult><Contents><Key>gfs.20260916/12/wave/gridded/"
                   "gfswave.t12z.arctic.9km.f000.grib2.idx</Key></Contents><Contents><Key>"
                   "gfs.20260916/12/wave/gridded/gfswave.t12z.arctic.9km.f003.grib2"
                   "</Key></Contents></ListBucketResult>")
        with patch("fetch_gfswave.get", return_value=listing.encode()):
            # Only the sidecar proves a complete object we can read by range.
            self.assertEqual(inventory("s3", RUN), {0})

    def test_invalid_horizon_and_step_combinations_are_refused(self):
        for arguments in [["--hours", "144", "--step", "1"], ["--hours", "400"],
                          ["--hours", "0"], ["--hours", "100", "--step", "3"],
                          ["--step", "2"], ["--source", "ecmwf"]]:
            with self.subTest(arguments=arguments), redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    fetch_gfswave.parse_args(arguments)
        self.assertEqual(fetch_gfswave.DEFAULT_HOURS, {3: 240, 1: 120})

    # --- published contract ----------------------------------------------
    def published(self, hours="3", step="3"):
        """Run the importer against fake downloads and return its output root."""
        spots = self.root / "spots.json"
        spots.write_text(json.dumps(SPOTS))
        now = datetime.now(timezone.utc)
        run = now.replace(minute=0, second=0, microsecond=0,
                          hour=now.hour // 6 * 6).strftime("%Y%m%d%H")

        def fake_decode(path, run_id, hour, spot_list, layout=None):
            return decode(self.grib(run=run, hour=hour), run_id, hour, spot_list, layout)
        with patch("sys.argv", ["fetch_gfswave.py", "--hours", hours, "--step", step,
                                "--run", run]), \
             patch("fetch_gfswave.ROOT", self.root), \
             patch.dict("os.environ", {"FORCE5_SPOTS_FILE": str(spots)}, clear=True), \
             patch("fetch_gfswave.inventory", return_value=set(range(0, 400))), \
             patch("fetch_gfswave.download", return_value=b"GRIB-stub"), \
             patch("fetch_gfswave.decode", side_effect=fake_decode):
            main()
        return run, read_whole(self.root / "public/weather/gfs-wave.json")

    def test_publishes_the_wave_contract_and_passes_the_shared_publisher(self):
        run, manifest = self.published(hours="6")
        self.assertEqual((manifest["kind"], manifest["model"], manifest["modelName"]),
                         ("wave", "gfs-wave", "GFS-Wave"))
        self.assertEqual((manifest["provider"], manifest["resolutionKm"]), ("NOAA NCEP", 9))
        self.assertEqual(manifest["modelDetail"],
                         "WAVEWATCH III global wave model, 9 km Arctic grid")
        self.assertEqual(manifest["sourceUrl"], "https://polar.ncep.noaa.gov/waves/")
        self.assertIn("public domain", manifest["attribution"])
        self.assertIn("FROM", manifest["directionConvention"])
        self.assertIn("never zero", manifest["processing"])
        self.assertEqual(manifest["stepHours"], 3)
        self.assertNotIn("stepRanges", manifest)
        self.assertEqual(set(manifest["variables"]), set(VARIABLES))
        self.assertEqual(set(manifest["grid"]), set(GRID))
        # No map frames: the spot series is the product, and the horizon is stated.
        self.assertEqual((manifest["frames"], manifest["horizonHours"]), ([], 6))
        self.assertEqual([step["hour"] for step in manifest["spotSeries"]["brandon"]], [0, 3, 6])
        self.assertEqual(set(manifest["spotCoverage"]), {"brandon", "dollymount"})
        for entry in manifest["spotCoverage"].values():
            self.assertIsInstance(entry["landMasked"], bool)
            self.assertTrue(entry["note"].strip())
        published, _, objects = validate_bundle(
            self.root / "public", "gfs-wave", 24,
            datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc) + timedelta(hours=1))
        self.assertEqual((published["run"], len(objects)),
                         (run, len(published["spots"]["squares"])))

    def test_the_run_directory_holds_only_its_spot_squares(self):
        _, manifest = self.published()
        self.assertRegex(manifest["base"], r"^gfs-wave-\d{10}-\d+h-v1-[0-9a-f]{8}/$")
        directory = self.root / "public/weather" / manifest["base"]
        self.assertEqual(sorted(path.parent.name for path in directory.rglob("*.json")),
                         ["spots"] * len(manifest["spots"]["squares"]))

    def test_download_failure_preserves_the_published_manifest(self):
        output = self.root / "public/weather/gfs-wave.json"
        output.parent.mkdir(parents=True)
        output.write_text('{"run":"last-good"}')
        now = datetime.now(timezone.utc)
        run = now.replace(minute=0, second=0, microsecond=0, hour=now.hour // 6 * 6).strftime("%Y%m%d%H")
        with patch("sys.argv", ["fetch_gfswave.py", "--hours", "3", "--run", run]), \
             patch("fetch_gfswave.ROOT", self.root), \
             patch("fetch_gfswave.inventory", return_value={0, 3}), \
             patch("fetch_gfswave.download", side_effect=OSError("provider unavailable")):
            with self.assertRaises(OSError):
                main()
        self.assertEqual(json.loads(output.read_text()), {"run": "last-good"})

    def test_stale_run_is_refused_before_any_download(self):
        with patch("sys.argv", ["fetch_gfswave.py", "--hours", "3", "--run", "2020010100"]), \
             patch("fetch_gfswave.ROOT", self.root), \
             patch("fetch_gfswave.inventory", return_value={0, 3}), \
             patch("fetch_gfswave.download") as download:
            with self.assertRaises(ValueError):
                main()
            download.assert_not_called()

    def run_against_the_bucket(self, published, run, *argv):
        """main() resolving `run` with the bucket serving `published`."""
        with patch("sys.argv", ["fetch_gfswave.py", "--hours", "3", *argv]), \
             patch("fetch_gfswave.ROOT", self.root), \
             patch.dict("os.environ", {"FORCE5_PUBLISHED_RUN": published}), \
             patch("fetch_gfswave.discover", return_value=run), \
             patch("fetch_gfswave.download", side_effect=OSError("provider unavailable")) as download, \
             patch("sys.stdout", io.StringIO()):
            try:
                result = main()
            except OSError:
                result = "downloaded"
        self.assertFalse((self.root / "public/weather/gfs-wave.json").exists())
        return result, download

    def test_the_run_the_bucket_serves_is_not_downloaded_again(self):
        now = datetime.now(timezone.utc)
        run = now.replace(minute=0, second=0, microsecond=0, hour=now.hour // 6 * 6).strftime("%Y%m%d%H")
        result, download = self.run_against_the_bucket(run, run)
        self.assertEqual(result, UNCHANGED_EXIT)
        download.assert_not_called()
        self.assertEqual(self.run_against_the_bucket("2020010100", run)[0], "downloaded")
        self.assertEqual(self.run_against_the_bucket(run, run, "--run", run)[0], "downloaded")


if __name__ == "__main__":
    unittest.main()
