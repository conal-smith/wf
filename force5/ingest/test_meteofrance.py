"""The Météo-France client: listings, package selection, message identity, crops.

Nothing here touches the network. GRIB2 headers are assembled byte by byte from
the templates the real ARPEGE and AROME packages use, so a change in what the
importer accepts fails here rather than on the next live run.
"""
import atexit
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

import numpy as np

import fetch_arome
import fetch_arpege
import meteofrance
from meteofrance import SPECS
from publish_s3 import validate_bundle
from registry import UNCHANGED_EXIT
from runfixtures import catalogue, publish_whole, read_whole

ARPEGE, AROME = SPECS["arpege"], SPECS["arome"]
RUN = "2026091618"
SCRATCH = Path(tempfile.mkdtemp(prefix="force5-meteofrance-"))
atexit.register(shutil.rmtree, SCRATCH, ignore_errors=True)


def key(spec, start, end, run=RUN):
    return (f"pnt/{meteofrance.run_key(run)}/{spec['family']}/{spec['resolution']}/"
            f"{spec['package']}/{spec['family']}__{spec['resolution']}__{spec['package']}__"
            f"{start:03d}H{end:03d}H__{meteofrance.run_key(run)}.grib2")


def arpege_groups(run=RUN, ranges=((0, 12), (13, 24), (25, 36), (37, 48), (49, 60),
                                   (61, 72), (73, 84), (85, 96), (97, 102))):
    return {key(ARPEGE, start, end, run): 70_000_000 for start, end in ranges}


def bucket_listing(keys, truncated_after=None):
    """The S3 ListObjectsV2 body shape the importer parses."""
    contents = "".join(
        f"<Contents><Key>{name}</Key><LastModified>2026-09-16T22:21:07.000Z</LastModified>"
        f"<ETag>&quot;x&quot;</ETag><Size>{size}</Size></Contents>"
        for name, size in keys.items())
    follow = (f"<NextContinuationToken>{truncated_after}</NextContinuationToken>"
              if truncated_after else "")
    return (f"<?xml version='1.0' encoding='UTF-8'?><ListBucketResult>"
            f"<Name>meteofrance-pnt</Name>{follow}{contents}</ListBucketResult>").encode()


class FakeSession:
    """Answers listings from a script; never opens a socket."""

    def __init__(self, pages):
        self.pages, self.paths, self.requests, self.bytes = list(pages), [], 0, 0

    def get(self, path, byte_range=None, attempts=4):
        self.paths.append(path)
        self.requests += 1
        if not self.pages:
            raise AssertionError(f"Unexpected request for {path}")
        return self.pages.pop(0)

    def close(self):
        pass


class FakePool:
    """The SessionPool surface `index` uses, running serially."""

    def __init__(self, session):
        self.session, self.workers = session, 1

    def map(self, work, items):
        return [work(self.session, item) for item in items]

    @property
    def requests(self):
        return self.session.requests


# --- GRIB2 header construction -------------------------------------------------

def section(number, body):
    return (len(body) + 5).to_bytes(4, "big") + bytes([number]) + body


def grib_header(*, discipline=0, category=2, number=2, template=4, level=(103, 10),
                forecast_time=0, unit=1, statistic=2, range_unit=1, range_length=1,
                ni=741, nj=521, packing=42, body=b"", trailing=b""):
    """One GRIB2 message whose sections 0–5 are real and whose data is filler.

    `template` is the product definition template: 0 for an instantaneous field
    and 8 for a statistically processed one, exactly as the packages use them."""
    identification = section(1, (85).to_bytes(2, "big") + b"\x00\x00" + bytes([15, 0, 1])
                             + (2026).to_bytes(2, "big") + bytes([9, 16, 18, 0, 0, 0, 1]))
    grid = section(3, bytes([0, 0, 0, 0, 0]) + (0).to_bytes(2, "big")
                   + bytes(19) + ni.to_bytes(4, "big") + nj.to_bytes(4, "big")
                   + bytes(24))
    product = bytes([0, 0]) + template.to_bytes(2, "big") + bytes([
        category, number, 2, 0, 211, 0, 0, 0, unit])
    product += forecast_time.to_bytes(4, "big") + bytes([level[0], 0])
    product += level[1].to_bytes(4, "big") + bytes([255, 0]) + (0).to_bytes(4, "big")
    if template == 8:
        product += ((2026).to_bytes(2, "big") + bytes([9, 16, 19, 0, 0, 1])
                    + (0).to_bytes(4, "big") + bytes([statistic, 2, range_unit])
                    + range_length.to_bytes(4, "big") + bytes([255]) + (0).to_bytes(4, "big"))
    representation = section(5, (ni * nj).to_bytes(4, "big") + packing.to_bytes(2, "big")
                             + bytes(10))
    head = identification + grid + section(4, product) + representation
    total = 16 + len(head) + len(body) + len(trailing)
    return (b"GRIB\xff\xff" + bytes([discipline, 2]) + total.to_bytes(8, "big")
            + head + body + trailing)


class ListingTest(unittest.TestCase):
    def test_reads_keys_and_sizes_and_follows_continuation(self):
        first = bucket_listing({"pnt/a": 1}, truncated_after="tok")
        session = FakeSession([first, bucket_listing({"pnt/b": 2})])
        self.assertEqual(meteofrance.listing(session, "pnt/"), {"pnt/a": 1, "pnt/b": 2})
        self.assertIn("continuation-token=tok", session.paths[1])

    def test_a_listing_that_never_ends_is_refused(self):
        session = FakeSession([bucket_listing({"pnt/a": 1}, truncated_after="t")] * 9)
        with self.assertRaisesRegex(RuntimeError, "Unexpectedly long"):
            meteofrance.listing(session, "pnt/")


class PackageSelectionTest(unittest.TestCase):
    def test_parses_time_groups_and_ignores_other_models(self):
        keys = arpege_groups()
        keys[key(AROME, 0, 6)] = 5  # A neighbouring dataset in the same run directory.
        keys["pnt/2026-09-16T18:00:00Z/arpege/01/SP1/README.txt"] = 1
        groups = meteofrance.parse_packages(ARPEGE, RUN, list(keys), keys)
        self.assertEqual([(g["start"], g["end"]) for g in groups],
                         [(0, 12), (13, 24), (25, 36), (37, 48), (49, 60), (61, 72),
                          (73, 84), (85, 96), (97, 102)])

    def test_another_run_in_the_same_listing_is_not_mixed_in(self):
        keys = {**arpege_groups(), **arpege_groups("2026091612", ranges=((0, 12),))}
        groups = meteofrance.parse_packages(ARPEGE, RUN, list(keys), keys)
        self.assertEqual(len(groups), 9)
        self.assertTrue(all(meteofrance.run_key(RUN) in g["key"] for g in groups))

    def test_a_gap_between_time_groups_is_a_fault(self):
        keys = arpege_groups(ranges=((0, 12), (25, 36)))
        with self.assertRaisesRegex(ValueError, "Gap or overlap"):
            meteofrance.parse_packages(ARPEGE, RUN, list(keys), keys)

    def test_every_field_of_an_hour_lives_in_the_group_holding_that_hour(self):
        keys = arpege_groups()
        groups = meteofrance.parse_packages(ARPEGE, RUN, list(keys), keys)
        # The +13h gust is the maximum over [12,13] and is filed by its end hour.
        self.assertEqual(meteofrance.group_for(13, groups)["start"], 13)
        self.assertEqual(meteofrance.group_for(12, groups)["start"], 0)
        self.assertEqual(meteofrance.group_for(102, groups)["start"], 97)
        self.assertIsNone(meteofrance.group_for(103, groups))

    def test_candidates_only_offer_this_model_cycles_within_the_age_limit(self):
        now = datetime(2026, 9, 16, 23, 30, tzinfo=timezone.utc)
        self.assertEqual(meteofrance.candidates(ARPEGE, None, now),
                         ["2026091618", "2026091612"])
        self.assertEqual(meteofrance.candidates(AROME, None, now),
                         ["2026091621", "2026091618", "2026091615", "2026091612"])
        self.assertEqual(meteofrance.candidates(ARPEGE, "2026091600", now), ["2026091600"])

    def test_discovery_skips_a_run_whose_packages_are_still_publishing(self):
        newest = arpege_groups("2026091700", ranges=((0, 12),))
        session = FakeSession([bucket_listing(newest), bucket_listing(arpege_groups())])
        now = datetime(2026, 9, 17, 4, 50, tzinfo=timezone.utc)
        hours = list(range(0, 103, 3))
        run, groups = meteofrance.discover("s3", session, ARPEGE, hours, None, now)
        self.assertEqual(run, RUN)
        self.assertEqual(len(groups), 9)

    def test_discovery_refuses_rather_than_publishing_a_partial_run(self):
        session = FakeSession([bucket_listing(arpege_groups(ranges=((0, 12),)))])
        now = datetime(2026, 9, 16, 23, 0, tzinfo=timezone.utc)
        with self.assertRaisesRegex(RuntimeError, "No complete requested ARPEGE run"):
            meteofrance.discover("s3", session, ARPEGE, list(range(0, 103, 3)),
                                 RUN, now)

    def test_the_data_gouv_catalogue_is_the_other_route_to_the_same_files(self):
        name = key(ARPEGE, 0, 12).split(f"pnt/{meteofrance.run_key(RUN)}/")[1]
        body = json.dumps({"resources": [
            {"url": f"{meteofrance.BUCKET}/pnt/{meteofrance.run_key(RUN)}/{name}",
             "filesize": 71_000_000},
            # A resource still pointing at the previous run must not be counted.
            {"url": f"{meteofrance.BUCKET}/pnt/2026-09-16T12:00:00Z/{name}",
             "filesize": 71_000_000},
            {"url": "https://static.data.gouv.fr/resources/description.pdf",
             "filesize": 1000},
        ]}).encode()
        with mock.patch.object(meteofrance, "get", return_value=body):
            groups = meteofrance.packages("datagouv", None, ARPEGE, RUN)
        self.assertEqual([(g["start"], g["end"], g["size"]) for g in groups],
                         [(0, 12, 71_000_000)])
        self.assertEqual(groups[0]["key"], key(ARPEGE, 0, 12))

    def test_a_run_identifier_must_be_one_of_the_model_cycles(self):
        self.assertEqual(meteofrance.run_datetime(ARPEGE, RUN),
                         datetime(2026, 9, 16, 18, tzinfo=timezone.utc))
        with self.assertRaisesRegex(ValueError, "runs at"):
            meteofrance.run_datetime(ARPEGE, "2026091615")
        # AROME does run at 15 UTC; ARPEGE does not.
        self.assertEqual(meteofrance.run_datetime(AROME, "2026091615").hour, 15)
        with self.assertRaisesRegex(ValueError, "YYYYMMDDHH"):
            meteofrance.run_datetime(ARPEGE, "2026-09-16T18")


class MessageIdentityTest(unittest.TestCase):
    """Identification is by discipline/category/number/template, never by name."""

    def test_accepts_the_three_fields_we_publish(self):
        u = meteofrance.header(grib_header(category=2, number=2, template=0))
        v = meteofrance.header(grib_header(category=2, number=3, template=0))
        gust = meteofrance.header(grib_header(category=2, number=22, template=8,
                                             forecast_time=5))
        self.assertEqual((u["field"], u["hour"]), ("u", 0))
        self.assertEqual((v["field"], v["hour"]), ("v", 0))
        # A statistically processed gust is filed by the END of its window.
        self.assertEqual((gust["field"], gust["hour"]), ("gust", 6))
        self.assertEqual(u["packing"], 42)

    def test_rejects_the_packages_other_parameters(self):
        for category, number, template in ((2, 0, 0), (2, 1, 0), (0, 0, 0), (1, 52, 8),
                                           (2, 23, 8), (2, 24, 8), (6, 1, 0)):
            info = meteofrance.header(grib_header(category=category, number=number,
                                                  template=template))
            self.assertIsNone(info["field"], (category, number, template))

    def test_a_10_m_field_at_another_level_is_not_ours(self):
        info = meteofrance.header(grib_header(category=2, number=2, template=0,
                                              level=(100, 85000)))
        self.assertIsNone(info["field"])

    def test_a_differently_processed_gust_is_refused(self):
        for statistic, unit, length in ((1, 1, 1), (2, 0, 1), (2, 1, 3)):
            info = meteofrance.header(grib_header(
                category=2, number=22, template=8, statistic=statistic,
                range_unit=unit, range_length=length))
            self.assertIsNone(info["field"], (statistic, unit, length))

    def test_a_lead_time_in_other_units_is_refused(self):
        info = meteofrance.header(grib_header(category=2, number=2, template=0, unit=0))
        self.assertIsNone(info["field"])

    def test_length_and_grid_come_from_the_message_itself(self):
        message = grib_header(body=b"\x00" * 64, trailing=b"7777")
        info = meteofrance.header(message)
        self.assertEqual(info["length"], len(message))
        self.assertEqual(info["points"], 741 * 521)

    def test_a_non_grib2_boundary_stops_the_walk(self):
        with self.assertRaisesRegex(ValueError, "GRIB2 message boundary"):
            meteofrance.header(b"BUFR\xff\xff\x00\x02" + bytes(64))
        with self.assertRaisesRegex(ValueError, "GRIB2 message boundary"):
            meteofrance.header(b"GRIB\xff\xff\x00\x01" + bytes(64))

    def test_a_window_too_small_to_identify_is_an_error_not_a_guess(self):
        with self.assertRaisesRegex(ValueError, "header window is too small"):
            meteofrance.header(grib_header()[:40])


class ScanTest(unittest.TestCase):
    def test_walks_headers_and_stops_once_everything_wanted_is_found(self):
        messages = [grib_header(category=2, number=2, template=0, forecast_time=hour,
                                body=bytes(32), trailing=b"7777") for hour in range(3)]
        messages += [grib_header(category=2, number=3, template=0, forecast_time=hour,
                                 body=bytes(48), trailing=b"7777") for hour in range(3)]
        messages += [grib_header(category=0, number=0, template=0, body=bytes(2048),
                                 trailing=b"7777")]
        stream = b"".join(messages)
        group = {"key": "pnt/x", "size": len(stream)}

        class Ranged(FakeSession):
            def get(self, path, byte_range=None, attempts=4):
                self.requests += 1
                return stream[byte_range[0]:byte_range[1] + 1]

        session = Ranged([])
        found = meteofrance.scan(session, group, {("u", 1), ("v", 0)})
        self.assertEqual(sorted(found), [("u", 1), ("v", 0)])
        self.assertEqual(found[("u", 1)], (len(messages[0]), len(messages[1])))
        # Four headers read: it stopped at the first v rather than reading on.
        self.assertEqual(session.requests, 4)

    def test_a_missing_message_names_what_was_absent(self):
        stream = grib_header(category=2, number=2, template=0, body=bytes(16),
                             trailing=b"7777")
        group = {"key": "pnt/x", "size": len(stream)}

        class Ranged(FakeSession):
            def get(self, path, byte_range=None, attempts=4):
                self.requests += 1
                return stream[byte_range[0]:byte_range[1] + 1]

        with self.assertRaisesRegex(ValueError, r"gust\+003h"):
            meteofrance.scan(Ranged([]), group, {("u", 0), ("gust", 3)})


class IndexCacheTest(unittest.TestCase):
    def test_a_cached_index_spares_the_second_run_every_header_read(self):
        cache = SCRATCH / "index"
        cache.mkdir(parents=True, exist_ok=True)
        keys = arpege_groups(ranges=((0, 12),))
        groups = meteofrance.parse_packages(ARPEGE, RUN, list(keys), keys)
        located = {("u", 0): (0, 10), ("v", 0): (10, 10), ("u", 3): (20, 10),
                   ("v", 3): (30, 10), ("gust", 3): (40, 10)}
        with mock.patch.object(meteofrance, "scan", return_value=located) as scan:
            first = meteofrance.index(FakePool(FakeSession([])), ARPEGE, RUN, groups,
                                      [0, 3], cache)
            self.assertEqual(scan.call_count, 1)
        with mock.patch.object(meteofrance, "scan") as scan:
            again = meteofrance.index(FakePool(FakeSession([])), ARPEGE, RUN, groups,
                                      [0, 3], cache)
            scan.assert_not_called()
        self.assertEqual(first, again)
        self.assertEqual(again[groups[0]["key"]][("gust", 3)], (40, 10))

    def test_an_index_from_another_run_is_ignored_not_reused(self):
        cache = SCRATCH / "index-other"
        cache.mkdir(parents=True, exist_ok=True)
        keys = arpege_groups(ranges=((0, 12),))
        groups = meteofrance.parse_packages(ARPEGE, RUN, list(keys), keys)
        (cache / "index.json").write_text(json.dumps({
            "model": "arpege", "run": "2026091612",
            "messages": {groups[0]["key"]: {json.dumps(["u", 0]): [0, 10]}}}))
        with mock.patch.object(meteofrance, "scan", return_value={("u", 0): (0, 10)}) as scan:
            meteofrance.index(FakePool(FakeSession([])), ARPEGE, RUN, groups, [0], cache)
            self.assertEqual(scan.call_count, 1)

    def test_initialization_asks_for_no_gust(self):
        self.assertEqual(meteofrance.fields_for(0), ("u", "v"))
        self.assertEqual(meteofrance.fields_for(3), ("u", "v", "gust"))


class LayoutTest(unittest.TestCase):
    """The crop, taken on lattice indices rather than on drifting floats."""

    def layout(self, spec, ni, nj, lon0, lat0, present=None, overrides=None):
        keys = {"Ni": ni, "Nj": nj, "iDirectionIncrementInDegrees": spec["spacing"],
                "jDirectionIncrementInDegrees": spec["spacing"],
                "longitudeOfFirstGridPointInDegrees": lon0 % 360,
                "latitudeOfFirstGridPointInDegrees": lat0,
                **meteofrance.SCANNING, **(overrides or {})}
        lons = lon0 + np.arange(ni) * spec["spacing"]
        lats = lat0 - np.arange(nj) * spec["spacing"]
        arrays = {"longitudes": np.tile(lons % 360, nj),
                  "latitudes": np.repeat(lats, ni)}
        with mock.patch.object(meteofrance.ec, "codes_get", lambda h, k: keys[k]), \
                mock.patch.object(meteofrance.ec, "codes_get_array",
                                  lambda h, k: arrays[k]):
            return meteofrance.make_layout(object(), spec)

    def test_arpege_crops_the_shared_ireland_box_exactly(self):
        layout = self.layout(ARPEGE, 741, 521, -32.0, 72.0)
        self.assertEqual(layout["grid"], {
            "width": 201, "height": 111, "west": -18.0, "east": 2.0, "north": 59.0,
            "south": 48.0, "dx": 0.1, "dy": 0.1,
            "order": "north-to-south, west-to-east", "units": "m/s"})
        self.assertEqual(len(layout["selected"]), 201 * 111)
        # First selected cell is the north-west corner of the crop, row-major.
        self.assertEqual(layout["selected"][0], 130 * 741 + 140)

    def test_arome_crops_its_native_quarter_degree_box_exactly(self):
        layout = self.layout(AROME, 1121, 717, -12.0, 55.4)
        self.assertEqual(layout["grid"], {
            "width": 237, "height": 151, "west": -10.9, "east": -5.0, "north": 54.75,
            "south": 51.0, "dx": 0.025, "dy": 0.025,
            "order": "north-to-south, west-to-east", "units": "m/s"})

    def test_published_bounds_satisfy_the_browser_grid_check(self):
        for spec, ni, nj, lon0, lat0 in ((ARPEGE, 741, 521, -32.0, 72.0),
                                         (AROME, 1121, 717, -12.0, 55.4)):
            grid = self.layout(spec, ni, nj, lon0, lat0)["grid"]
            self.assertLess(abs(grid["east"] - grid["west"]
                                - (grid["width"] - 1) * grid["dx"]), 1e-5)
            self.assertLess(abs(grid["north"] - grid["south"]
                                - (grid["height"] - 1) * grid["dy"]), 1e-5)

    def test_every_riding_location_of_the_arpege_box_is_sampleable(self):
        grid = self.layout(ARPEGE, 741, 521, -32.0, 72.0)["grid"]
        values = [0.0] * (grid["width"] * grid["height"])
        spots = json.loads((Path(meteofrance.__file__).resolve().parents[2]
                            / "public" / "riding-locations.json").read_text())
        self.assertTrue(all(meteofrance.sample(grid, values, s["lon"], s["lat"]) is not None
                            for s in spots))

    def test_the_north_coast_spots_fall_outside_the_arome_box(self):
        # AROME stops short of the north coast: west Donegal to the Causeway
        # Coast is read from the other models in the blend.
        north_coast = [
            "bloody-foreland", "browns-bay", "bunbeg", "carrickfinn", "dooey",
            "downings", "dunfanaghy", "fi-pollan-bay", "marble-hill",
            "port-arthur", "portballintrae", "portnoo", "portrush", "portsalon",
            "portstewart", "web-benone-strand", "web-magheraroarty",
            "whiterocks",
        ]
        grid = self.layout(AROME, 1121, 717, -12.0, 55.4)["grid"]
        values = [0.0] * (grid["width"] * grid["height"])
        spots = json.loads((Path(meteofrance.__file__).resolve().parents[2]
                            / "public" / "riding-locations.json").read_text())
        inside, outside = meteofrance.coverage(spots, grid, values)
        self.assertEqual(sorted(outside), north_coast)
        self.assertEqual(len(inside), len(spots) - len(north_coast))

    def test_an_unexpected_domain_is_refused(self):
        with self.assertRaisesRegex(ValueError, "Unexpected ARPEGE domain"):
            self.layout(ARPEGE, 741, 521, -20.0, 72.0)

    def test_a_grid_relative_or_rescanned_grid_is_refused(self):
        for override, message in (({"uvRelativeToGrid": 1}, "uvRelativeToGrid"),
                                  ({"jScansPositively": 1}, "jScansPositively"),
                                  ({"gridType": "lambert"}, "gridType")):
            with self.assertRaisesRegex(ValueError, message):
                self.layout(ARPEGE, 741, 521, -32.0, 72.0, overrides=override)

    def test_a_different_spacing_is_refused(self):
        with self.assertRaisesRegex(ValueError, "Expected the 0.1"):
            self.layout(ARPEGE, 741, 521, -32.0, 72.0,
                        overrides={"iDirectionIncrementInDegrees": 0.25})

    def test_coordinates_that_disagree_with_the_lattice_are_refused(self):
        spec = ARPEGE
        keys = {"Ni": 741, "Nj": 521, "iDirectionIncrementInDegrees": 0.1,
                "jDirectionIncrementInDegrees": 0.1,
                "longitudeOfFirstGridPointInDegrees": 328.0,
                "latitudeOfFirstGridPointInDegrees": 72.0, **meteofrance.SCANNING}
        arrays = {"longitudes": np.zeros(741 * 521), "latitudes": np.zeros(741 * 521)}
        with mock.patch.object(meteofrance.ec, "codes_get", lambda h, k: keys[k]), \
                mock.patch.object(meteofrance.ec, "codes_get_array",
                                  lambda h, k: arrays[k]), \
                self.assertRaisesRegex(ValueError, "disagrees with the decoded"):
            meteofrance.make_layout(object(), spec)


class GustSemanticsTest(unittest.TestCase):
    def test_the_window_is_the_hour_ending_at_the_frame(self):
        self.assertEqual(meteofrance.GUST_WINDOW_HOURS, 1)
        # Published as [h-1, h], which is what the wind contract requires of an
        # interval gust, and initialization therefore has none at all.
        self.assertEqual(meteofrance.fields_for(0), ("u", "v"))


class PublisherAcceptanceTest(unittest.TestCase):
    """A manifest built the way `refresh` builds one must pass the publisher."""

    def bundle(self, model, hours, width=4, height=3, outside=()):
        spec = SPECS[model]
        root = SCRATCH / model
        output = root / "public" / "weather"
        grid = {"width": width, "height": height, "west": -10.0, "east": -10.0 + 3 * 0.1,
                "north": 54.0, "south": 54.0 - 2 * 0.1, "dx": 0.1, "dy": 0.1,
                "order": "north-to-south, west-to-east", "units": "m/s"}
        run_time = datetime(2026, 9, 16, 18, tzinfo=timezone.utc)
        cells = width * height
        frames, series = [], {"inside": [], **{name: [] for name in outside}}
        for hour in hours:
            interval = None if hour == 0 else [hour - 1, hour]
            valid = (run_time + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
            payload = {"model": model, "run": RUN, "hour": hour, "validTime": valid,
                       "grid": grid, "gustIntervalHours": interval,
                       "u": [5.0] * cells, "v": [1.0] * cells,
                       "gust": None if hour == 0 else [9.0] * cells}
            name = f"{model}-{RUN}-{hours[-1]}h-v1/{hour:03d}-test.json"
            meteofrance.write_json(output / name, payload)
            frames.append({"hour": hour, "validTime": valid, "url": f"weather/{name}",
                           "gustIntervalHours": interval})
            series["inside"].append({"hour": hour, "validTime": valid, "u": 5.0,
                                     "v": 1.0, "gust": None if hour == 0 else 9.0})
            for name in outside:
                series[name].append({"hour": hour, "validTime": valid, "u": None,
                                     "v": None, "gust": None})
        manifest = {
            "schemaVersion": 1, "model": model, "modelName": spec["modelName"],
            "provider": spec["provider"], "modelDetail": spec["modelDetail"],
            "resolutionKm": spec["resolutionKm"],
            "resolutionLabel": spec["resolutionLabel"], "run": RUN,
            "runTime": run_time.isoformat().replace("+00:00", "Z"),
            "generatedAt": "2026-09-16T23:00:00+00:00", "stepHours": 3, "grid": grid,
            "frames": frames, "spotForecasts": series, "gustAvailable": True,
            "gustMissingHours": [0], "coverageNote": "note",
            "gustDescription": "d", "processing": "p",
            "sourceUrl": meteofrance.SOURCE_URL, "attribution": meteofrance.ATTRIBUTION,
            "licenseUrl": meteofrance.LICENCE_URL}
        # "inside" is a made-up place on the crop; the others are real riding locations.
        spots = catalogue() + [{"id": "inside", "lat": 53.9, "lon": -9.9}]
        publish_whole(output, f"{model}.json", manifest, spots=spots)
        return root / "public", manifest

    def test_an_arpege_bundle_passes_the_shared_wind_validator(self):
        public, manifest = self.bundle("arpege", list(range(0, 13, 3)))
        pointer, _, objects = validate_bundle(public, "arpege", 12,
                                              now=datetime(2026, 9, 16, 19, tzinfo=timezone.utc))
        self.assertEqual(len(objects), len(manifest["frames"]) + len(pointer["spots"]["squares"]))

    def test_an_arome_bundle_with_uncovered_spots_passes_too(self):
        public, _ = self.bundle("arome", list(range(0, 13, 3)),
                                outside=("fi-pollan-bay", "web-benone-strand"))
        manifest, _, objects = validate_bundle(
            public, "arome", 12, now=datetime(2026, 9, 16, 19, tzinfo=timezone.utc))
        self.assertEqual(len(objects), 5 + len(manifest["spots"]["squares"]))
        manifest = read_whole(public / "weather/arome.json")
        self.assertTrue(all(step["u"] is None
                            for step in manifest["spotForecasts"]["fi-pollan-bay"]))
        self.assertIn("note", manifest["coverageNote"])

    def test_the_registry_and_the_specs_agree(self):
        from registry import MODELS
        for model, spec in SPECS.items():
            self.assertEqual(MODELS[model]["manifest"], f"weather/{model}.json")
            self.assertEqual(MODELS[model]["kind"], "wind")
            self.assertEqual(MODELS[model]["maxAgeHours"], meteofrance.MAX_AGE_HOURS)
            self.assertEqual(MODELS[model]["script"], f"fetch_{model}.py")
            self.assertEqual(spec["horizon"] % 3, 0)


class PublishedRunTest(unittest.TestCase):
    """Discovery falls back to the previous cycle while the newest is still
    publishing, and that cycle is usually the one already published. The package
    listing alone decides: no header is walked and no message is downloaded."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def newest(self, spec):
        now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        while now.hour not in spec["cycles"]:
            now -= timedelta(hours=1)
        return now.strftime("%Y%m%d%H")

    def refresh(self, spec, published, run=None):
        """refresh() resolving the newest cycle with the bucket serving `published`."""
        args = SimpleNamespace(hours=3, step=3, run=run, source="s3", workers=1)
        with mock.patch.object(meteofrance, "ROOT", self.root), \
             mock.patch.dict(os.environ, {"FORCE5_PUBLISHED_RUN": published}), \
             mock.patch.object(meteofrance, "discover", return_value=(self.newest(spec), [])), \
             mock.patch.object(meteofrance, "index", side_effect=OSError("bucket")) as index, \
             redirect_stdout(io.StringIO()):
            try:
                result = meteofrance.refresh(spec, args, {})
            except OSError:
                result = "downloaded"
        self.assertFalse((self.root / f"public/weather/{spec['model']}.json").exists())
        return result, index

    def test_the_cycle_the_bucket_serves_is_not_downloaded_again(self):
        for spec in (ARPEGE, AROME):
            with self.subTest(model=spec["model"]):
                result, index = self.refresh(spec, self.newest(spec))
                self.assertEqual(result, UNCHANGED_EXIT)
                index.assert_not_called()

    def test_a_newer_cycle_or_an_explicit_run_is_downloaded(self):
        for spec in (ARPEGE, AROME):
            with self.subTest(model=spec["model"]):
                self.assertEqual(self.refresh(spec, "2020010100")[0], "downloaded")
                run = self.newest(spec)
                self.assertEqual(self.refresh(spec, run, run=run)[0], "downloaded")

    def test_both_scripts_hand_the_answer_back_to_their_exit_status(self):
        for module, name in ((fetch_arpege, "fetch_arpege.py"), (fetch_arome, "fetch_arome.py")):
            with self.subTest(script=name), mock.patch("sys.argv", [name]), \
                    mock.patch.object(meteofrance, "refresh", return_value=UNCHANGED_EXIT):
                self.assertEqual(module.main(), UNCHANGED_EXIT)


class BundledSnapshotTest(unittest.TestCase):
    """The committed ARPEGE-shaped sample bundle must stay self-consistent.

    No forecast output is committed (.gitignore: public/weather/), so the bundle
    read here is the synthetic one in tests/fixtures/weather, written by
    scripts/sample-weather.mjs and shared with the browser test suite. It is in
    exactly the published format, which is the point: an ARPEGE bundle that the
    publisher would refuse — a misordered frame, a gust interval that does not
    match its frame file, a spot missing from the catalogue — fails here.
    """

    def test_the_repository_snapshot_validates(self):
        root = Path(meteofrance.__file__).resolve().parents[2]
        bundles = root / "tests" / "fixtures"
        manifest, _, objects = validate_bundle(
            bundles, "arpege", 12, now=datetime(2026, 9, 16, 19, tzinfo=timezone.utc))
        self.assertEqual(manifest["stepHours"], 3)
        self.assertEqual(len(objects), len(manifest["frames"]) + len(manifest["spots"]["squares"]))
        manifest = read_whole(bundles / "weather/arpege.json")
        # The real crop is 201 x 111 cells of 0.05°; the sample bundle is coarse
        # on purpose and rectangular on purpose (dx != dy, as the real HARMONIE
        # grid is), so the shape is stated outright. Re-deriving it from the
        # bundle's own bounds and spacing would assert only that arithmetic is
        # arithmetic, and would pass whatever grid the generator wrote.
        self.assertEqual(manifest["grid"], {
            "width": 13, "height": 14, "west": -11.0, "east": -5.0, "north": 56.0,
            "south": 50.8, "dx": 0.5, "dy": 0.4,
            "order": "north-to-south, west-to-east"})
        self.assertEqual(manifest["gustMissingHours"], [0])
        self.assertIsNone(manifest["frames"][0]["gustIntervalHours"])
        self.assertEqual(manifest["frames"][1]["gustIntervalHours"], [2, 3])
        # The real bundle credits Météo-France under Etalab; a sample bundle must
        # never claim a source, and says so where the attribution would be.
        self.assertIn("not a forecast", manifest["attribution"])
        spots = json.loads((root / "public" / "riding-locations.json").read_text())
        self.assertEqual(sorted(manifest["spotForecasts"]), sorted(s["id"] for s in spots))


if __name__ == "__main__":
    unittest.main()
