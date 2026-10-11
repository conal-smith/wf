"""Offline GEFS ensemble tests: fake GRIB, fake listings, no network access."""
from contextlib import redirect_stderr
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import MagicMock, patch

import eccodes as ec
import requests

from cadence import expected_hours
import f5bin
import fetch_gefs as gefs
from fetch_gefs import (average, decode_member, decode_step, discover, file_name, filter_url,
                        inventory, main, member_name, object_key, run_datetime)
from fetch_gfs import index_ranges
from publish_s3 import publish, validate_bundle
from registry import UNCHANGED_EXIT
from test_publish_s3 import FakeS3
from runfixtures import read_whole

NOW = datetime(2026, 9, 16, 23, 40, tzinfo=timezone.utc)
RUN = "2026091618"
# The three messages we accept, in the provider's own .idx order.
RECORDS = ("GUST:surface", "UGRD:10 m above ground", "VGRD:10 m above ground")


def label(member):
    return "low-res ctl" if member == 0 else f"+{member}"


def idx(hour, member=0, missing=()):
    """A miniature GEFS .idx sidecar, including its ENS member suffix."""
    step = "anl" if hour == 0 else f"{hour} hour fcst"
    lines = []
    for index, record in enumerate([r for r in RECORDS if r not in missing], 1):
        lines.append(f"{index}:{index * 1000}:d={RUN}:{record}:{step}:ENS={label(member)}")
    return "\n".join(lines) + "\n"


class GefsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        gefs.fetch_gfs.THROTTLE.pause = 0
        gefs.Meter.total = 0
        self.spots = self.root / "spots.json"
        self.spots.write_text(json.dumps([
            {"id": "brandon", "name": "Brandon Bay", "lat": 54.1, "lon": -17.9},
            {"id": "offgrid", "name": "Elsewhere", "lat": 10.0, "lon": 10.0}]))

    def message(self, member, hour, field, run=RUN, changes=None):
        """One GEFS member message shaped like the cropped pgrb2sp25 product."""
        levels = {"u": {"paramId": 165}, "v": {"paramId": 166},
                  "gust": {"paramId": 260065, "typeOfLevel": "surface", "level": 0}}
        values = {"centre": "kwbc",
                  "productDefinitionTemplateNumber": 1,
                  "typeOfProcessedData": 3 if member == 0 else 4,
                  "typeOfEnsembleForecast": 1 if member == 0 else 3,
                  "perturbationNumber": member, "numberOfForecastsInEnsemble": gefs.PERTURBED,
                  "dataDate": int(run[:8]), "dataTime": int(run[-2:]) * 100,
                  "stepUnits": 1, "forecastTime": hour, "Ni": 2, "Nj": 2,
                  "latitudeOfFirstGridPointInDegrees": 54.25,
                  "latitudeOfLastGridPointInDegrees": 54,
                  # 342°E/342.25°E is 18°W/17.75°W once normalised.
                  "longitudeOfFirstGridPointInDegrees": 342,
                  "longitudeOfLastGridPointInDegrees": 342.25,
                  "iDirectionIncrementInDegrees": 0.25,
                  "jDirectionIncrementInDegrees": 0.25,
                  "uvRelativeToGrid": 0, **levels[field], **(changes or {})}
        # u = member, v = -member, gust = 10 + member, so a mean is easy to read.
        value = {"u": member, "v": -member, "gust": 10 + member}[field]
        handle = ec.codes_grib_new_from_samples("regular_ll_sfc_grib2")
        try:
            centre = values.pop("centre")
            for key, item in values.items():
                ec.codes_set(handle, key, item)
            ec.codes_set(handle, "centre", centre)
            ec.codes_set_values(handle, [value] * 4)
            return ec.codes_get_message(handle)
        finally:
            ec.codes_release(handle)

    def grib(self, member=1, hour=6, run=RUN, fields=("gust", "u", "v"), changes=None,
             duplicate=False):
        body = b"".join(self.message(member, hour, field, run, changes) for field in fields)
        if duplicate:
            body += self.message(member, hour, fields[0], run, changes)
        path = Path(tempfile.mkstemp(suffix=".grib2", dir=self.root)[1])
        path.write_bytes(body)
        return path

    # --- source addressing ----------------------------------------------
    def test_member_names_cover_the_control_and_thirty_perturbations(self):
        self.assertEqual(member_name(0), "c00")
        self.assertEqual((member_name(1), member_name(30)), ("p01", "p30"))
        for bad in (-1, 31, True, "1", None):
            with self.subTest(member=bad), self.assertRaises(ValueError):
                member_name(bad)
        self.assertEqual(file_name(RUN, 0, 6), "gec00.t18z.pgrb2s.0p25.f006")
        self.assertEqual(file_name(RUN, 7, 240), "gep07.t18z.pgrb2s.0p25.f240")
        self.assertEqual(object_key(RUN, 0, 0),
                         "gefs.20260916/18/atmos/pgrb2sp25/gec00.t18z.pgrb2s.0p25.f000")

    def test_filter_request_asks_only_for_the_ireland_subregion(self):
        url = filter_url(RUN, 3, 12)
        for fragment in ["dir=%2Fgefs.20260916%2F18%2Fatmos%2Fpgrb2sp25",
                         "file=gep03.t18z.pgrb2s.0p25.f012",
                         "var_UGRD=on", "var_VGRD=on", "var_GUST=on",
                         "lev_10_m_above_ground=on", "lev_surface=on",
                         "leftlon=-18.0", "rightlon=2.0", "toplat=59.0", "bottomlat=48.0"]:
            self.assertIn(fragment, url)
        self.assertIn("filter_gefs_atmos_0p25s.pl", url)

    def test_index_ranges_read_the_member_sidecar_in_file_order(self):
        # The GEFS sidecar appends an ENS=... field the GFS parser must tolerate.
        self.assertEqual(index_ranges(idx(6, member=1), 6),
                         [(2000, 2999), (3000, ""), (1000, 1999)])
        self.assertEqual(index_ranges(idx(0, member=0), 0)[0], (2000, 2999))
        for text, hour in [(idx(6, missing=("GUST:surface",)), 6), (idx(6), 9), (idx(0), 6)]:
            with self.subTest(hour=hour), self.assertRaises(ValueError):
                index_ranges(text, hour)

    def test_s3_download_reads_the_three_records_in_two_ranges(self):
        calls = []
        source = bytes(range(256)) * 20  # Stands in for the whole-globe object.

        def fake(url, headers=None, attempts=4):
            calls.append((url, (headers or {}).get("Range")))
            if url.endswith(".idx"):
                return idx(6, member=2).encode()
            start, _, end = headers["Range"].removeprefix("bytes=").partition("-")
            return source[int(start):int(end) + 1 if end else None]
        with patch.object(gefs, "bucket_get", side_effect=fake):
            data = gefs.download("s3", RUN, 2, 6)
        # UGRD and VGRD are neighbours in the file, so they are one request; the
        # stream is still u, v, gust, exactly as three separate ranges gave it.
        self.assertEqual([call[1] for call in calls], [None, "bytes=2000-", "bytes=1000-1999"])
        self.assertEqual(data, source[2000:3000] + source[3000:] + source[1000:2000])
        self.assertIn("gep02.t18z.pgrb2s.0p25.f006.idx", calls[0][0])
        # Every ranged byte plus the sidecar is metered for the run report.
        self.assertEqual(gefs.Meter.total, len(idx(6, member=2)) + len(data))

    def test_bucket_reads_reuse_one_connection_per_thread_and_retry_faults(self):
        responses = []

        def reply(status, body=b""):
            response = requests.Response()
            response.status_code, response._content = status, body
            return response

        session = MagicMock()
        session.get.side_effect = lambda url, **kwargs: responses.pop(0)
        with patch.object(gefs, "CONNECTIONS", threading.local()), \
             patch.object(gefs.requests, "Session", return_value=session) as opened, \
             patch.object(gefs.time, "sleep"):
            responses[:] = [reply(503), reply(206, b"GRIB-u-v")]
            self.assertEqual(gefs.bucket_get("https://bucket/key", {"Range": "bytes=0-7"}),
                             b"GRIB-u-v")
            responses[:] = [reply(200, b"idx")]
            self.assertEqual(gefs.bucket_get("https://bucket/key.idx"), b"idx")
            responses[:] = [reply(404)]
            with self.assertRaises(requests.HTTPError):
                gefs.bucket_get("https://bucket/missing")
        self.assertEqual(opened.call_count, 1)  # One connection for all four requests.
        self.assertEqual(session.get.call_count, 4)
        self.assertEqual(session.get.call_args_list[1].kwargs["headers"]["Range"], "bytes=0-7")

    def test_contiguous_ranges_join_without_reordering(self):
        self.assertEqual(gefs.contiguous([(2000, 2999), (3000, 3999), (1000, 1999)]),
                         [(2000, 3999), (1000, 1999)])
        self.assertEqual(gefs.contiguous([(2000, 2999), (3000, ""), (1000, 1999)]),
                         [(2000, ""), (1000, 1999)])
        # Neighbours in the wrong order, or with a gap, stay separate requests.
        self.assertEqual(gefs.contiguous([(3000, 3999), (2000, 2999)]),
                         [(3000, 3999), (2000, 2999)])
        self.assertEqual(gefs.contiguous([(0, 9), (11, 20)]), [(0, 9), (11, 20)])
        self.assertEqual(gefs.contiguous([]), [])

    def test_filter_download_is_metered(self):
        with patch.object(gefs.fetch_gfs, "get", return_value=b"GRIB-body"):
            self.assertEqual(gefs.download("nomads", RUN, 0, 0), b"GRIB-body")
        self.assertEqual(gefs.Meter.total, 9)

    # --- discovery ------------------------------------------------------
    def test_inventory_reads_the_provider_listing_per_member(self):
        page = ('<option value="gec00.t18z.pgrb2s.0p25.f000">'
                '<option value="gec00.t18z.pgrb2s.0p25.f006">'
                '<option value="gep01.t18z.pgrb2s.0p25.f000">'
                '<option value="gep30.t18z.pgrb2s.0p25.f006">'
                '<option value="gec00.t12z.pgrb2s.0p25.f012">')
        with patch.object(gefs.fetch_gfs, "get", return_value=page.encode()):
            self.assertEqual(inventory("nomads", RUN),
                             {"c00": {0, 6}, "p01": {0}, "p30": {6}})
        listing = ("<ListBucketResult><Contents><Key>gefs.20260916/18/atmos/pgrb2sp25/"
                   "gec00.t18z.pgrb2s.0p25.f000.idx</Key></Contents><Contents><Key>"
                   "gefs.20260916/18/atmos/pgrb2sp25/gep01.t18z.pgrb2s.0p25.f003</Key>"
                   "</Contents></ListBucketResult>")
        with patch.object(gefs.fetch_gfs, "get", return_value=listing.encode()):
            # Only the sidecar proves a complete object we can read by range.
            self.assertEqual(inventory("s3", RUN), {"c00": {0}})

    def test_discovery_needs_every_step_of_every_requested_member(self):
        # 18 UTC has the control but is still writing gep02; 12 UTC is complete.
        pages = {RUN: {"c00": {0, 6}, "p01": {0, 6}, "p02": {0}},
                 "2026091612": {"c00": {0, 6}, "p01": {0, 6}, "p02": {0, 6}}}
        with patch.object(gefs, "inventory", side_effect=lambda source, run: pages.get(run, {})):
            self.assertEqual(discover("nomads", [0, 6], [0, 1, 2], now=NOW), "2026091612")
            # A smaller member request is satisfied by the newer cycle.
            self.assertEqual(discover("nomads", [0, 6], [0, 1], now=NOW), RUN)
            with self.assertRaises(RuntimeError):
                discover("nomads", [0, 6, 12], [0, 1], now=NOW)

    def test_discovery_skips_an_unreadable_listing(self):
        def flaky(source, run):
            if run == RUN:
                raise OSError("listing unavailable")
            return {"c00": {0, 6}, "p01": {0, 6}}
        with patch.object(gefs, "inventory", side_effect=flaky), redirect_stderr(io.StringIO()):
            self.assertEqual(discover("nomads", [0, 6], [0, 1], now=NOW), "2026091612")

    def test_only_real_gefs_cycles_are_accepted(self):
        self.assertEqual(run_datetime(RUN).hour, 18)
        for value in ["2026091613", "2026131300", "20260916", "bad", None]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                run_datetime(value)

    # --- decoding and validation ----------------------------------------
    def test_a_member_decodes_all_three_fields_and_normalises_longitudes(self):
        fields, layout = decode_member(self.grib(member=4), RUN, 6, 4)
        self.assertEqual(set(fields), {"u", "v", "gust"})
        self.assertEqual((fields["u"], fields["v"], fields["gust"]),
                         ([4] * 4, [-4] * 4, [14] * 4))
        self.assertEqual((layout[2]["west"], layout[2]["east"]), (-18.0, -17.75))
        self.assertEqual((layout[2]["dx"], layout[2]["dy"]), (0.25, 0.25))
        self.assertEqual(layout[2]["order"], "north-to-south, west-to-east")

    def test_the_control_is_member_zero_and_carries_the_cf_type(self):
        fields, _ = decode_member(self.grib(member=0), RUN, 6, 0)
        self.assertEqual(fields["gust"], [10] * 4)
        # A perturbed message may not stand in for the control, or the reverse.
        with self.assertRaisesRegex(ValueError, "Expected member 0, found 1"):
            decode_member(self.grib(member=1), RUN, 6, 0)
        with self.assertRaisesRegex(ValueError, "Expected member 2, found 0"):
            decode_member(self.grib(member=0), RUN, 6, 2)
        with self.assertRaisesRegex(ValueError, "not a GEFS pf message"):
            decode_member(self.grib(member=1, changes={"typeOfProcessedData": 3}), RUN, 6, 1)
        with self.assertRaisesRegex(ValueError, "not a GEFS cf message"):
            decode_member(self.grib(member=0, changes={"typeOfProcessedData": 4}), RUN, 6, 0)

    def test_member_messages_must_be_complete_unique_and_from_ncep(self):
        cases = [
            ({"fields": ("gust", "u")}, "missing a wind or gust component"),
            ({"duplicate": True}, "Unexpected or duplicate"),
            ({"changes": {"centre": "ecmf"}}, "kwbc"),
            ({"changes": {"numberOfForecastsInEnsemble": 20}}, "30 perturbed"),
            ({"changes": {"iDirectionIncrementInDegrees": 0.5,
                          "longitudeOfLastGridPointInDegrees": 342.5}}, "0.25-degree"),
        ]
        for kwargs, message in cases:
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(ValueError, message):
                decode_member(self.grib(member=1, **kwargs), RUN, 6, 1)

    def test_gusts_must_be_the_instantaneous_surface_field(self):
        # A period maximum, or a gust at 10 m, is not the GEFS product.
        for changes in [{"stepType": "max", "startStep": 0},
                        {"typeOfLevel": "heightAboveGround", "level": 10}]:
            body = (self.message(1, 6, "u") + self.message(1, 6, "v")
                    + self.message(1, 6, "gust", changes=changes))
            path = Path(tempfile.mkstemp(suffix=".grib2", dir=self.root)[1])
            path.write_bytes(body)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                decode_member(path, RUN, 6, 1)
        # Initialization carries a gust like every other hour.
        fields, _ = decode_member(self.grib(member=1, hour=0), RUN, 0, 1)
        self.assertEqual(fields["gust"], [11] * 4)

    def test_lead_time_and_run_mismatches_are_refused(self):
        with self.assertRaises(ValueError):
            decode_member(self.grib(member=1, hour=9), RUN, 6, 1)
        with self.assertRaises(ValueError):
            decode_member(self.grib(member=1, run="2026091612"), RUN, 6, 1)

    def test_the_grid_may_not_change_within_a_run(self):
        _, layout = decode_member(self.grib(member=1), RUN, 6, 1)
        moved = self.grib(member=2, changes={"latitudeOfFirstGridPointInDegrees": 55,
                                             "latitudeOfLastGridPointInDegrees": 54.75})
        with self.assertRaisesRegex(ValueError, "Grid changed"):
            decode_member(moved, RUN, 6, 2, layout)

    def test_a_step_needs_its_whole_member_set(self):
        cache = self.root / "cache"
        cache.mkdir()
        for member in (0, 1, 2):
            (cache / f"006-ge{member_name(member)}.grib2").write_bytes(
                self.grib(member=member).read_bytes())
        fields, _ = decode_step(cache, "nomads", RUN, 6, [0, 1, 2])
        self.assertEqual(sorted(fields["u"]), [0, 1, 2])
        self.assertEqual(fields["gust"][2], [12] * 4)
        # An absent member is never silently averaged away.
        with patch.object(gefs, "decode_member", side_effect=lambda *a, **k: (None, None)):
            with self.assertRaisesRegex(ValueError, "Incomplete ensemble at \\+006h"):
                decode_step(cache, "nomads", RUN, 6, [0, 1, 2])

    def test_a_corrupt_cache_entry_is_refetched_once(self):
        cache = self.root / "cache"
        cache.mkdir()
        good = self.grib(member=0).read_bytes()
        (cache / "006-gec00.grib2").write_bytes(b"GRIBnot-a-message")
        with patch.object(gefs, "download", return_value=good) as download:
            fields, _ = decode_step(cache, "nomads", RUN, 6, [0])
        download.assert_called_once()
        self.assertEqual(fields["u"][0], [0] * 4)

    def test_mean_is_the_member_average(self):
        self.assertEqual(average([[1, 2], [2, 3], [6, 7]]), [3.0, 4.0])
        self.assertEqual(average([[1, 1], [2, 2]]), [1.5, 1.5])

    # --- cadence --------------------------------------------------------
    def test_the_default_ladder_is_forty_one_six_hourly_steps(self):
        manifest = {"model": "gefs", "stepHours": 6,
                    "stepRanges": [{"throughHour": 240, "stepHours": 6}]}
        hours = expected_hours(manifest)
        self.assertEqual((len(hours), hours[0], hours[-1]), (41, 0, 240))
        # A uniform frame count describes the same ladder.
        self.assertEqual(expected_hours({"model": "gefs", "stepHours": 6, "frames": [None] * 41}),
                         hours)
        three = expected_hours({"model": "gefs", "stepHours": 3,
                                "stepRanges": [{"throughHour": 240, "stepHours": 3}]})
        self.assertEqual((len(three), three[-1]), (81, 240))
        self.assertEqual((gefs.STEP, gefs.HOURS, gefs.MEMBERS, gefs.MAX_HOURS),
                         (6, 240, 31, 240))

    # --- end to end, offline --------------------------------------------
    def refresh(self, *extra, members=(0, 1, 2), hours=(0, 6), run=None, changes=None):
        run = run or self.fresh_run()
        bodies = {(member, hour): b"".join(
            self.message(member, hour, field, run, changes if member else None)
            for field in ("gust", "u", "v")) for member in members for hour in hours}
        argv = ["fetch_gefs.py", "--run", run, "--members", str(len(members)),
                "--step", "6", "--hours", str(max(hours)), *extra]
        with patch("sys.argv", argv), patch.object(gefs, "ROOT", self.root), \
             patch.dict("os.environ", {"FORCE5_SPOTS_FILE": str(self.spots)}, clear=True), \
             patch.object(gefs, "inventory", return_value={
                 member_name(m): set(hours) for m in members}), \
             patch.object(gefs, "download",
                          side_effect=lambda source, r, member, hour: bodies[(member, hour)]):
            main()
        return read_whole(self.root / "public/weather/gefs.json"), run

    def fresh_run(self):
        now = datetime.now(timezone.utc)
        return now.replace(minute=0, second=0, microsecond=0,
                           hour=now.hour // 6 * 6).strftime("%Y%m%d%H")

    def test_publishes_mean_frames_and_per_spot_member_series(self):
        manifest, run = self.refresh()
        self.assertEqual((manifest["model"], manifest["modelName"], manifest["provider"]),
                         ("gefs", "GEFS", "NOAA NCEP"))
        self.assertEqual(manifest["schemaVersion"], 2)
        self.assertEqual(manifest["ensemble"]["members"], 3)
        self.assertEqual(manifest["ensemble"]["control"], 0)
        self.assertIn("gec00", manifest["ensemble"]["description"])
        self.assertEqual(manifest["stepHours"], 6)
        self.assertEqual(manifest["stepRanges"], [{"throughHour": 6, "stepHours": 6}])
        self.assertEqual(expected_hours(manifest), (0, 6))
        self.assertIsNone(manifest["resolutionKm"])
        # Instantaneous gusts: a zero-length interval at every hour, zero included.
        self.assertEqual(manifest["gustKind"], "instantaneous")
        self.assertIs(manifest["gustAvailable"], True)
        self.assertNotIn("gustMissingHours", manifest)
        self.assertEqual([f["gustIntervalHours"] for f in manifest["frames"]], [[0, 0], [6, 6]])
        # Members 0..2 hold u = member, v = -member, gust = 10 + member.
        frame = f5bin.decode_frame(
            (self.root / "public/weather" / manifest["base"] / manifest["frames"][1]["url"]).read_bytes())
        self.assertEqual((frame["u"], frame["v"], frame["gust"]),
                         ([1.0] * 4, [-1.0] * 4, [11.0] * 4))
        self.assertEqual((frame["run"], frame["hour"]), (run, 6))
        mean = manifest["spotForecasts"]["brandon"][1]
        self.assertEqual((mean["u"], mean["v"], mean["gust"]), (1.0, -1.0, 11.0))
        series = manifest["spotMembers"]["brandon"]
        self.assertEqual([entry["hour"] for entry in series], [0, 6])
        self.assertEqual(series[1]["u"], [0, 1, 2])
        self.assertEqual(series[1]["v"], [0, -1, -2])
        self.assertEqual(series[1]["gust"], [10, 11, 12])
        self.assertEqual(series[1]["validTime"], manifest["frames"][1]["validTime"])
        # A spot the grid cannot sample keeps its mean series of nulls, like every
        # other wind adapter, but gets no member series: the ensemble contract
        # requires a number per member, so nulls there would be unpublishable.
        self.assertNotIn("offgrid", manifest["spotMembers"])
        self.assertIn("offgrid", manifest["spotForecasts"])
        self.assertIsNone(manifest["spotForecasts"]["offgrid"][1]["u"])
        self.assertIsNone(manifest["spotForecasts"]["offgrid"][1]["gust"])

    def test_the_published_bundle_satisfies_the_shared_publisher(self):
        manifest, run = self.refresh()
        run_time = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
        published, _, objects = validate_bundle(
            self.root / "public", "gefs", 24, run_time + timedelta(hours=1))
        squares = len(published["spots"]["squares"])
        self.assertEqual((published["run"], len(objects)), (run, 2 + squares))
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root / "public", "gefs", "test", max_age_hours=24,
                                 now=run_time + timedelta(hours=1)), "published")
        self.assertEqual(s3.writes[-1], "weather/gefs.json")
        self.assertEqual(len(s3.writes), 3 + squares)  # 2 frames, the squares, the pointer

    def test_frames_live_under_a_run_and_horizon_specific_prefix(self):
        manifest, run = self.refresh()
        self.assertRegex(manifest["base"], rf"^gefs-{run}-6h-v1-[0-9a-f]{{8}}/$")
        self.assertEqual([f["url"] for f in manifest["frames"]],
                         ["frames/000.bin", "frames/006.bin"])

    def test_a_broken_member_preserves_the_previous_manifest(self):
        published = self.root / "public/weather/gefs.json"
        published.parent.mkdir(parents=True)
        published.write_text('{"run":"last-good"}')
        for changes in [{"centre": "ecmf"}, {"perturbationNumber": 9},
                        {"numberOfForecastsInEnsemble": 20},
                        {"typeOfProcessedData": 3}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.refresh(changes=changes)
            self.assertEqual(json.loads(published.read_text()), {"run": "last-good"})

    def test_a_download_failure_preserves_the_previous_manifest(self):
        published = self.root / "public/weather/gefs.json"
        published.parent.mkdir(parents=True)
        published.write_text('{"run":"last-good"}')
        run = self.fresh_run()
        with patch("sys.argv", ["fetch_gefs.py", "--run", run, "--members", "2",
                                "--hours", "6", "--step", "6"]), \
             patch.object(gefs, "ROOT", self.root), \
             patch.dict("os.environ", {"FORCE5_SPOTS_FILE": str(self.spots)}, clear=True), \
             patch.object(gefs, "inventory", return_value={"c00": {0, 6}, "p01": {0, 6}}), \
             patch.object(gefs, "download", side_effect=OSError("provider unavailable")):
            with self.assertRaises(OSError):
                main()
        self.assertEqual(json.loads(published.read_text()), {"run": "last-good"})

    def test_a_stale_run_is_refused_before_any_download(self):
        with patch("sys.argv", ["fetch_gefs.py", "--run", "2020010100", "--hours", "6",
                                "--step", "6", "--members", "2"]), \
             patch.object(gefs, "ROOT", self.root), \
             patch.object(gefs, "inventory", return_value={"c00": {0, 6}, "p01": {0, 6}}), \
             patch.object(gefs, "download") as download:
            with self.assertRaises(ValueError):
                main()
            download.assert_not_called()

    def run_against_the_bucket(self, published, *argv):
        """main() on the newest cycle with the bucket serving `published`."""
        with patch("sys.argv", ["fetch_gefs.py", "--members", "2", "--hours", "6",
                                "--step", "6", *argv]), \
             patch.object(gefs, "ROOT", self.root), \
             patch.dict("os.environ", {"FORCE5_PUBLISHED_RUN": published}), \
             patch.object(gefs, "discover", return_value=self.fresh_run()), \
             patch.object(gefs, "download", side_effect=OSError("provider unavailable")) as download, \
             patch("sys.stdout", io.StringIO()):
            try:
                result = main()
            except OSError:
                result = "downloaded"
        self.assertFalse((self.root / "public/weather/gefs.json").exists())
        return result, download

    def test_the_cycle_the_bucket_serves_is_not_downloaded_again(self):
        # The newest cycle is often still publishing at its slot, so discovery falls
        # back to the previous one: usually the one already published.
        result, download = self.run_against_the_bucket(self.fresh_run())
        self.assertEqual(result, UNCHANGED_EXIT)
        download.assert_not_called()

    def test_a_newer_cycle_or_an_explicit_run_is_downloaded(self):
        self.assertEqual(self.run_against_the_bucket("2020010100")[0], "downloaded")
        run = self.fresh_run()
        self.assertEqual(self.run_against_the_bucket(run, "--run", run)[0], "downloaded")

    def test_each_source_downloads_at_its_own_concurrency_and_pace(self):
        for argv, workers in [([], 2), (["--source", "s3"], gefs.WORKERS["s3"]),
                              (["--source", "s3", "--workers", "16"], 16)]:
            source = "s3" if "s3" in argv else "nomads"
            with self.subTest(argv=argv), \
                 patch("sys.argv", ["fetch_gefs.py", "--members", "2", "--hours", "6",
                                    "--step", "6", *argv]), \
                 patch.object(gefs, "ROOT", self.root), \
                 patch.object(gefs, "discover", return_value=self.fresh_run()), \
                 patch.object(gefs, "ThreadPoolExecutor",
                              side_effect=RuntimeError("stop before downloading")) as pool, \
                 patch("sys.stdout", io.StringIO()):
                with self.assertRaises(RuntimeError):
                    main()
                self.assertEqual(pool.call_args.kwargs["max_workers"], workers)
                self.assertEqual(gefs.fetch_gfs.THROTTLE.pause, gefs.PAUSE[source])
        # NOMADS keeps the two-connection, 0.6-second pace it asks clients for.
        self.assertEqual((gefs.WORKERS["nomads"], gefs.MAX_WORKERS["nomads"]), (2, 2))
        self.assertEqual(gefs.PAUSE["nomads"], gefs.fetch_gfs.PAUSE["nomads"])

    def test_unusable_arguments_are_refused_without_downloading(self):
        for arguments in [["--members", "1"], ["--members", "32"], ["--hours", "246"],
                         ["--hours", "0"], ["--hours", "100", "--step", "6"],
                         ["--step", "1"], ["--source", "ecmwf"], ["--workers", "4"],
                         ["--workers", "0"], ["--source", "s3", "--workers", "17"]]:
            with self.subTest(arguments=arguments), \
                 patch("sys.argv", ["fetch_gefs.py", *arguments]), \
                 redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    main()

    # --- publisher contract ---------------------------------------------
    def test_the_publisher_rejects_an_interval_gust_on_an_instantaneous_model(self):
        manifest, run = self.refresh()
        run_time = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
        now = run_time + timedelta(hours=1)
        pointer = self.root / "public/weather/gefs.json"
        for mutate in ({"gustMissingHours": [0]}, {"gustKind": "interval"}):
            with self.subTest(mutate=mutate):
                pointer.write_text(json.dumps({**manifest, **mutate}))
                with self.assertRaises(ValueError):
                    validate_bundle(self.root / "public", "gefs", 24, now)
        broken = json.loads(json.dumps(manifest))
        broken["frames"][1]["gustIntervalHours"] = [0, 6]
        pointer.write_text(json.dumps(broken))
        with self.assertRaises(ValueError):
            validate_bundle(self.root / "public", "gefs", 24, now)

    def test_the_publisher_rejects_a_broken_member_series(self):
        manifest, run = self.refresh()
        run_time = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
        now = run_time + timedelta(hours=1)
        pointer = self.root / "public/weather/gefs.json"

        def drop_member(m):
            m["spotMembers"]["brandon"][1]["u"] = [0, 1]

        def bad_value(m):
            m["spotMembers"]["brandon"][1]["gust"] = [10, 11, -1]

        def no_series(m):
            del m["spotMembers"]

        def misaligned(m):
            m["spotMembers"]["brandon"][1]["hour"] = 9

        def lost_control(m):
            m["ensemble"]["control"] = 3

        for mutate in (drop_member, bad_value, no_series, misaligned, lost_control):
            with self.subTest(case=mutate.__name__):
                broken = json.loads(json.dumps(manifest))
                mutate(broken)
                pointer.write_text(json.dumps(broken))
                s3 = FakeS3()
                with self.assertRaises(ValueError):
                    publish(s3, self.root / "public", "gefs", "test", max_age_hours=24, now=now)
                self.assertEqual(s3.writes, [])


if __name__ == "__main__":
    unittest.main()
