"""Offline GFS importer tests: no network, no provider credentials."""
from contextlib import redirect_stderr
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import eccodes as ec

import f5bin
import fetch_gfs
from fetch_gfs import (decode, discover, filter_url, index_ranges, inventory,
                       main, object_key, run_datetime, validate_metadata)
from publish_s3 import validate_bundle
from registry import UNCHANGED_EXIT

NOW = datetime(2026, 9, 16, 21, 40, tzinfo=timezone.utc)
RUN = "2026091612"


def idx(hour, prefix=(), missing=()):
    """A miniature GFS .idx sidecar in the provider's record order."""
    step = "anl" if hour == 0 else f"{hour} hour fcst"
    records = [name for name in ("UGRD:10 m above ground", "VGRD:10 m above ground",
                                 "GUST:surface") if name not in missing]
    lines = list(prefix)
    for index, record in enumerate(records, len(prefix) + 1):
        lines.append(f"{index}:{index * 1000}:d={RUN}:{record}:{step}:")
    return "\n".join(lines) + "\n"


class GfsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        fetch_gfs.THROTTLE.pause = 0
        self.metadata = {"parameterCategory": 2, "parameterNumber": 2, "units": "m s**-1",
                         "level": 10, "typeOfLevel": "heightAboveGround", "gridType": "regular_ll",
                         "uvRelativeToGrid": 0, "stepUnits": 1, "startStep": 6, "endStep": 6,
                         "dataDate": 20260916, "dataTime": 1200, "validityDate": 20260916,
                         "validityTime": 1800, "stepType": "instant"}

    def grib(self, messages=None):
        """Real GRIB2 messages shaped like NOMADS' subregion output (0–360° longitudes)."""
        defaults = [{"paramId": 165}, {"paramId": 166},
                    {"paramId": 260065, "typeOfLevel": "surface", "level": 0}]
        # A unique name per call keeps concurrent importer threads from colliding.
        path = Path(tempfile.mkstemp(suffix=".grib2", dir=self.root)[1])
        with path.open("wb") as stream:
            for changes in (defaults if messages is None else messages):
                handle = ec.codes_grib_new_from_samples("regular_ll_sfc_grib2")
                try:
                    values = {"centre": "kwbc", "dataDate": 20260916, "dataTime": 1200,
                              "stepUnits": 1, "forecastTime": 6, "Ni": 2, "Nj": 2,
                              "latitudeOfFirstGridPointInDegrees": 54.25,
                              "latitudeOfLastGridPointInDegrees": 54,
                              # 342°E/342.25°E is 18°W/17.75°W once normalised.
                              "longitudeOfFirstGridPointInDegrees": 342,
                              "longitudeOfLastGridPointInDegrees": 342.25,
                              "iDirectionIncrementInDegrees": 0.25,
                              "jDirectionIncrementInDegrees": 0.25,
                              "uvRelativeToGrid": 0, **changes}
                    for key, value in values.items():
                        ec.codes_set(handle, key, value)
                    ec.codes_set_values(handle, [1, 2, 3, 4])
                    ec.codes_write(handle, stream)
                finally:
                    ec.codes_release(handle)
        return path

    # --- decoding -------------------------------------------------------
    def test_decode_normalises_longitudes_and_keeps_all_three_fields(self):
        fields, layout = decode(self.grib(), RUN, 6)
        self.assertEqual(set(fields), {"u", "v", "gust"})
        self.assertEqual(fields["gust"], [1, 2, 3, 4])
        self.assertEqual((layout[2]["west"], layout[2]["east"]), (-18.0, -17.75))
        self.assertEqual(layout[2]["north"], 54.25)
        self.assertEqual(layout[2]["order"], "north-to-south, west-to-east")

    def test_decode_rejects_missing_duplicate_and_foreign_messages(self):
        for messages in [[{"paramId": 165}, {"paramId": 166}],
                         [{"paramId": 165}, {"paramId": 165},
                          {"paramId": 260065, "typeOfLevel": "surface", "level": 0}],
                         [{"paramId": 165, "centre": "ecmf"}]]:
            with self.subTest(messages=messages), self.assertRaises(ValueError):
                decode(self.grib(messages), RUN, 6)

    def test_gust_must_be_the_instantaneous_surface_field(self):
        # A 10 m gust, or one carrying a maximum interval, is not the GFS product.
        for changes in [{"paramId": 260065, "typeOfLevel": "heightAboveGround", "level": 10},
                        {"paramId": 260065, "typeOfLevel": "surface", "level": 0,
                         "stepType": "max", "startStep": 0}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                decode(self.grib([{"paramId": 165}, {"paramId": 166}, changes]), RUN, 6)

    def test_metadata_validation_rejects_wrong_run_time_units_and_orientation(self):
        validate_metadata(self.metadata, "u", RUN, 6)
        validate_metadata({**self.metadata, "parameterNumber": 22, "level": 0,
                           "typeOfLevel": "surface"}, "gust", RUN, 6)
        for key, value in [("uvRelativeToGrid", 1), ("units", "knots"), ("level", 100),
                           ("typeOfLevel", "surface"), ("gridType", "reduced_gg"),
                           ("stepType", "max"), ("endStep", 9), ("startStep", 3),
                           ("dataTime", 0), ("validityTime", 2100)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_metadata({**self.metadata, key: value}, "u", RUN, 6)

    # --- source addressing ----------------------------------------------
    def test_filter_request_asks_only_for_the_ireland_subregion(self):
        url = filter_url(RUN, 6)
        for fragment in ["dir=%2Fgfs.20260916%2F12%2Fatmos", "file=gfs.t12z.pgrb2.0p25.f006",
                         "var_UGRD=on", "var_VGRD=on", "var_GUST=on",
                         "lev_10_m_above_ground=on", "lev_surface=on",
                         "leftlon=-18.0", "rightlon=2.0", "toplat=59.0", "bottomlat=48.0"]:
            self.assertIn(fragment, url)
        self.assertEqual(object_key(RUN, 240), "gfs.20260916/12/atmos/gfs.t12z.pgrb2.0p25.f240")

    def test_index_ranges_cover_each_record_up_to_the_next_offset(self):
        prefix = (f"1:0:d={RUN}:PRMSL:mean sea level:6 hour fcst:",)
        self.assertEqual(index_ranges(idx(6, prefix), 6),
                         [(2000, 2999), (3000, 3999), (4000, "")])
        # Hour 0 records are labelled "anl", not "0 hour fcst".
        self.assertEqual(index_ranges(idx(0), 0)[0], (1000, 1999))

    def test_index_ranges_reject_absent_or_mislabelled_records(self):
        for text, hour in [(idx(6, missing=("GUST:surface",)), 6), (idx(6), 9), (idx(0), 6), ("", 6)]:
            with self.subTest(hour=hour), self.assertRaises(ValueError):
                index_ranges(text, hour)

    def test_s3_download_concatenates_the_three_ranged_records(self):
        calls = []

        def fake(url, headers=None, attempts=4):
            calls.append((url, (headers or {}).get("Range")))
            return idx(6).encode() if url.endswith(".idx") else b"GRIB-part"
        with patch("fetch_gfs.get", side_effect=fake):
            self.assertEqual(fetch_gfs.download("s3", RUN, 6), b"GRIB-part" * 3)
        self.assertEqual([call[1] for call in calls],
                         [None, "bytes=1000-1999", "bytes=2000-2999", "bytes=3000-"])

    # --- discovery ------------------------------------------------------
    def test_discovery_prefers_the_newest_complete_cycle(self):
        # 2026091618 exists but is still publishing; 12 UTC has every requested step.
        pages = {"2026091618": {0, 3, 6}, RUN: {0, 3, 6, 9}, "2026091606": {0, 3, 6, 9}}
        with patch("fetch_gfs.inventory", side_effect=lambda source, run: pages.get(run, set())):
            self.assertEqual(discover("nomads", [0, 3, 6, 9], now=NOW), RUN)

    def test_discovery_skips_unreadable_inventories_and_reports_nothing_complete(self):
        def flaky(source, run):
            if run == "2026091618":
                raise OSError("listing unavailable")
            return {0, 3}
        with patch("fetch_gfs.inventory", side_effect=flaky):
            self.assertEqual(discover("nomads", [0, 3], now=NOW), RUN)
            with self.assertRaises(RuntimeError):
                discover("nomads", [0, 3, 6], now=NOW)

    def test_inventory_reads_the_provider_listing_not_a_release_schedule(self):
        page = ('<option value="gfs.t12z.pgrb2.0p25.f000">'
                '<option value="gfs.t12z.pgrb2.0p25.f003">'
                '<option value="gfs.t06z.pgrb2.0p25.f006">'
                '<option value="gfs.t12z.pgrb2.0p25.f003.idx">')
        with patch("fetch_gfs.get", return_value=page.encode()):
            self.assertEqual(inventory("nomads", RUN), {0, 3})
        listing = ("<ListBucketResult><Contents><Key>gfs.20260916/12/atmos/"
                   "gfs.t12z.pgrb2.0p25.f000.idx</Key></Contents><Contents><Key>"
                   "gfs.20260916/12/atmos/gfs.t12z.pgrb2.0p25.f003</Key></Contents>"
                   "</ListBucketResult>")
        with patch("fetch_gfs.get", return_value=listing.encode()):
            # Only the sidecar proves a complete object we can read by range.
            self.assertEqual(inventory("s3", RUN), {0})

    def test_only_real_gfs_cycles_are_accepted(self):
        self.assertEqual(run_datetime(RUN).hour, 12)
        for value in ["2026091613", "2026131300", "20260916", "bad", None]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                run_datetime(value)

    def test_default_horizon_follows_what_gfs_publishes_at_each_step(self):
        self.assertEqual(fetch_gfs.DEFAULT_HOURS, {3: 240, 1: fetch_gfs.HOURLY_THROUGH})

    def test_invalid_horizon_and_step_combinations_are_refused(self):
        for arguments in [["--hours", "144", "--step", "1"], ["--hours", "400"],
                          ["--hours", "0"], ["--hours", "100", "--step", "3"],
                          ["--step", "2"], ["--source", "ecmwf"]]:
            with self.subTest(arguments=arguments), patch("sys.argv", ["fetch_gfs.py", *arguments]), \
                 redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    main()

    # --- published contract ---------------------------------------------
    def bundle(self, hours=(0, 3, 6), gust_kind="instantaneous"):
        run_time = datetime.strptime(RUN, "%Y%m%d%H").replace(tzinfo=timezone.utc)
        directory = self.root / "weather/gfs-run"
        directory.mkdir(parents=True)
        manifest = {"model": "gfs", "run": RUN, "runTime": run_time.isoformat().replace("+00:00", "Z"),
                    "stepHours": 3, "grid": {"width": 2, "height": 2}, "frames": [],
                    "gustAvailable": True, "gustKind": gust_kind}
        for hour in hours:
            valid = (run_time + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
            info = {"hour": hour, "validTime": valid, "url": f"weather/gfs-run/{hour}.json",
                    "gustIntervalHours": [hour, hour]}
            manifest["frames"].append(info)
            (self.root / info["url"]).write_text(json.dumps(
                {"model": "gfs", "run": RUN, "hour": hour, "validTime": valid,
                 "grid": manifest["grid"], "gustIntervalHours": [hour, hour],
                 "u": [1] * 4, "v": [2] * 4, "gust": [3] * 4}))
        (self.root / "weather/gfs.json").write_text(json.dumps(manifest))
        return manifest, run_time + timedelta(hours=1)

    def test_publisher_accepts_instantaneous_gusts_at_every_hour(self):
        _, now = self.bundle()
        manifest, _, objects = validate_bundle(self.root, "gfs", 24, now)
        self.assertEqual([f["gustIntervalHours"] for f in manifest["frames"]],
                         [[0, 0], [3, 3], [6, 6]])
        self.assertEqual(len(objects), 3)

    def test_publisher_still_rejects_zero_length_maximum_intervals(self):
        manifest, now = self.bundle(gust_kind="maximum")
        with self.assertRaises(ValueError):
            validate_bundle(self.root, "gfs", 24, now)
        # ...and an instantaneous model may not declare a preceding period.
        manifest["gustKind"] = "instantaneous"
        manifest["frames"][1]["gustIntervalHours"] = [0, 3]
        (self.root / "weather/gfs.json").write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            validate_bundle(self.root, "gfs", 24, now)

    def test_publisher_rejects_instantaneous_gusts_declared_missing(self):
        manifest, now = self.bundle()
        manifest["gustMissingHours"] = [0]
        (self.root / "weather/gfs.json").write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            validate_bundle(self.root, "gfs", 24, now)

    def test_download_failure_preserves_the_published_manifest(self):
        output = self.root / "public/weather/gfs.json"
        output.parent.mkdir(parents=True)
        output.write_text('{"run":"last-good"}')
        now = datetime.now(timezone.utc)
        run = now.replace(minute=0, second=0, microsecond=0, hour=now.hour // 6 * 6).strftime("%Y%m%d%H")
        with patch("sys.argv", ["fetch_gfs.py", "--hours", "3", "--run", run]), \
             patch("fetch_gfs.ROOT", self.root), \
             patch("fetch_gfs.inventory", return_value={0, 3}), \
             patch("fetch_gfs.download", side_effect=OSError("provider unavailable")):
            with self.assertRaises(OSError):
                main()
        self.assertEqual(json.loads(output.read_text()), {"run": "last-good"})

    def test_stale_run_is_refused_before_any_download(self):
        with patch("sys.argv", ["fetch_gfs.py", "--hours", "3", "--run", "2020010100"]), \
             patch("fetch_gfs.ROOT", self.root), \
             patch("fetch_gfs.inventory", return_value={0, 3}), \
             patch("fetch_gfs.download") as download:
            with self.assertRaises(ValueError):
                main()
            download.assert_not_called()

    def run_against_the_bucket(self, published, run, *argv):
        """main() resolving `run` with the bucket serving `published`."""
        with patch("sys.argv", ["fetch_gfs.py", "--hours", "3", *argv]), \
             patch("fetch_gfs.ROOT", self.root), \
             patch.dict("os.environ", {"FORCE5_PUBLISHED_RUN": published}), \
             patch("fetch_gfs.discover", return_value=run), \
             patch("fetch_gfs.download", side_effect=OSError("provider unavailable")) as download, \
             patch("sys.stdout", io.StringIO()):
            try:
                result = main()
            except OSError:
                result = "downloaded"
        self.assertFalse((self.root / "public/weather/gfs.json").exists())
        return result, download

    def fresh_cycle(self):
        now = datetime.now(timezone.utc)
        return now.replace(minute=0, second=0, microsecond=0, hour=now.hour // 6 * 6).strftime("%Y%m%d%H")

    def test_the_run_the_bucket_serves_is_not_downloaded_again(self):
        run = self.fresh_cycle()
        result, download = self.run_against_the_bucket(run, run)
        self.assertEqual(result, UNCHANGED_EXIT)
        download.assert_not_called()

    def test_a_newer_run_or_an_explicit_run_is_downloaded(self):
        run = self.fresh_cycle()
        self.assertEqual(self.run_against_the_bucket("2020010100", run)[0], "downloaded")
        self.assertEqual(self.run_against_the_bucket(run, run, "--run", run)[0], "downloaded")

    def test_a_stale_run_fails_even_when_it_is_the_published_one(self):
        # A provider that stopped publishing is a failure to report, not "nothing new".
        with self.assertRaises(ValueError):
            self.run_against_the_bucket("2020010100", "2020010100")

    def restamped(self, run):
        """Decode the sample GRIB re-stamped for each requested run and lead time."""
        def stamp(path, run_id, hour, layout=None):
            date, time = int(run[:8]), int(run[-2:]) * 100
            return decode(self.grib([
                {"paramId": 165, "dataDate": date, "dataTime": time, "forecastTime": hour},
                {"paramId": 166, "dataDate": date, "dataTime": time, "forecastTime": hour},
                {"paramId": 260065, "typeOfLevel": "surface", "level": 0,
                 "dataDate": date, "dataTime": time, "forecastTime": hour}]), run_id, hour, layout)
        return stamp

    def test_publishes_the_full_wind_contract_and_passes_the_publisher(self):
        spots = self.root / "spots.json"
        spots.write_text(json.dumps([{"id": "brandon", "lat": 54.1, "lon": -17.9}]))
        now = datetime.now(timezone.utc)
        run = now.replace(minute=0, second=0, microsecond=0,
                          hour=now.hour // 6 * 6).strftime("%Y%m%d%H")
        with patch("sys.argv", ["fetch_gfs.py", "--hours", "3", "--step", "3", "--run", run]), \
             patch("fetch_gfs.ROOT", self.root), \
             patch.dict("os.environ", {"FORCE5_SPOTS_FILE": str(spots)}, clear=True), \
             patch("fetch_gfs.inventory", return_value={0, 3}), \
             patch("fetch_gfs.download", return_value=b"GRIB-stub"), \
             patch("fetch_gfs.decode", side_effect=self.restamped(run)):
            main()
        manifest = json.loads((self.root / "public/weather/gfs.json").read_text())
        self.assertEqual((manifest["model"], manifest["modelName"], manifest["provider"]),
                         ("gfs", "GFS", "NOAA NCEP"))
        self.assertEqual(manifest["gustKind"], "instantaneous")
        self.assertIs(manifest["gustAvailable"], True)
        self.assertNotIn("gustMissingHours", manifest)
        self.assertNotIn("stepRanges", manifest)
        self.assertEqual(manifest["stepHours"], 3)
        self.assertIsNone(manifest["resolutionKm"])
        self.assertEqual([f["gustIntervalHours"] for f in manifest["frames"]], [[0, 0], [3, 3]])
        self.assertEqual([f["hour"] for f in manifest["spotForecasts"]["brandon"]], [0, 3])
        # The frames are binary; the gust window and the grid geometry they used to
        # repeat now live only in the manifest, which is where they are checked.
        self.assertEqual(manifest["encoding"], f5bin.ENCODING)
        self.assertEqual(manifest["grid"]["order"], "north-to-south, west-to-east")
        frame = f5bin.decode_frame(
            (self.root / "public" / manifest["frames"][0]["url"]).read_bytes())
        self.assertEqual((frame["run"], frame["hour"]), (run, 0))
        self.assertEqual((frame["width"], frame["height"]),
                         (manifest["grid"]["width"], manifest["grid"]["height"]))
        self.assertEqual(len(frame["gust"]), frame["width"] * frame["height"])
        # The importer output must satisfy the shared publisher contract unchanged.
        published, _, objects = validate_bundle(
            self.root / "public", "gfs",
            24, datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc) + timedelta(hours=1))
        self.assertEqual((published["run"], len(objects)), (run, 2))


if __name__ == "__main__":
    unittest.main()
