"""Copernicus Marine IBI wave adapter tests, against recorded objects; no network access.

fixtures/ibi-wave-20261104.json holds what the adapter read from the Marine Data
Store for the run of 4 November 2026, recorded on 5 November: the catalogue, the
day files' listing, the stores' consolidated metadata and coordinates, and the
land-sea mask. The wave chunks themselves (about 90 MB) are not kept. The fake
store makes them up, encoded with the store's own codec and packing, and puts back
the real series of three spots' cells, so the values those spots publish are the
model's own. fixtures/ibi-wave-listing-mixed-20261104.xml is the November listing
between the two halves of a run, recorded on 4 November at 19:00 UTC.
"""
import base64
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

import numcodecs
import numpy as np

import fetch_ibi_wave
from fetch_ibi_wave import (DATASET, HOURS, SOURCE_VARIABLES, Marine, check_store,
                            choose_cell, complete_run, main, months_to_list, parse_listing,
                            value_of)
from fetch_forecast import load_spots
from publish_s3 import validate_bundle
from registry import MODELS, PUBLISHED_RUN_ENV, UNCHANGED_EXIT
from runfixtures import read_whole

FIXTURES = Path(__file__).with_name("fixtures")
RECORDED = json.loads((FIXTURES / "ibi-wave-20261104.json").read_text())
MIXED = (FIXTURES / "ibi-wave-listing-mixed-20261104.xml").read_text()
RUN = date(2026, 11, 4)
RUN_TIME = datetime(2026, 11, 4, tzinfo=timezone.utc)
# When the recorded run was whole and newest: 03:00 UTC the day after it.
NOW = datetime.fromisoformat(RECORDED["now"])
SERIES_STORE = re.compile(r"/geoChunked\.zarr/(\w+)/(\d+)\.(\d+)\.(\d+)$")
DEPTH = re.compile(r"/static\.zarr/deptho/0\.0$")


class Response:
    def __init__(self, status, body):
        self.status_code, self.content = status, body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def synthetic(name, hours):
    """A plausible sea everywhere, in the source's units, before packing."""
    t = np.arange(hours, dtype=float)
    kind = {"VHM0": 1.5 + 0.5 * np.sin(t / 10), "VTPK": 11 + 0 * t, "VTM02": 7 + 0 * t,
            "VMDR": 275 + 0 * t, "VHM0_WW": 0.4 + 0 * t, "VTM01_WW": 3.5 + 0 * t,
            "VMDR_WW": 200 + 0 * t, "VHM0_SW1": 1.2 + 0 * t, "VTM01_SW1": 10 + 0 * t,
            "VMDR_SW1": 280 + 0 * t, "VHM0_SW2": 0.3 + 0 * t, "VTM01_SW2": 6 + 0 * t,
            "VMDR_SW2": 320 + 0 * t}[name]
    return kind


class FakeStore:
    """The recorded objects, and wave chunks made up on the store's own terms."""

    def __init__(self, objects=None, changes=None, holes=()):
        self.objects = dict(RECORDED["objects"] if objects is None else objects)
        self.changes = changes or {}
        self.holes = set(holes)  # (spot, source variable, hour): a value the store lacks
        self.requests = []
        meta = json.loads(next(entry["text"] for url, entry in self.objects.items()
                               if url.endswith("geoChunked.zarr/.zmetadata")))["metadata"]
        self.meta = meta
        self.cache = {}

    def get(self, url, timeout=None, headers=None):
        self.requests.append(url)
        if url in self.changes:
            body = self.changes[url]
            return Response(200, body if isinstance(body, bytes) else body.encode())
        match = SERIES_STORE.search(url)
        if match and match.group(1) in SOURCE_VARIABLES:
            return Response(200, self.chunk(match.group(1), *map(int, match.groups()[1:])))
        if DEPTH.search(url):
            return Response(200, self.depth())
        entry = self.objects.get(url)
        if entry is None:
            return Response(404, b"")
        body = (entry["text"].encode() if "text" in entry
                else base64.b64decode(entry["base64"]))
        return Response(entry["status"], body)

    def chunk(self, name, t, y, x):
        layout, attributes = self.meta[f"{name}/.zarray"], self.meta[f"{name}/.zattrs"]
        steps, rows, columns = layout["chunks"]
        epoch = datetime(1950, 1, 1, tzinfo=timezone.utc)
        run_index = int((RUN_TIME - epoch).total_seconds() // 3600) - first_hour(self.meta)
        values = np.empty((steps, rows, columns))
        values[:] = synthetic(name, steps)[:, None, None]
        for spot, cell in RECORDED["cells"].items():
            if cell["row"] // rows != y or cell["column"] // columns != x:
                continue
            for hour, value in enumerate(cell["values"][name]):
                index = run_index + hour - t * steps
                if 0 <= index < steps:
                    missing = value is None or (spot, name, hour) in self.holes
                    values[index, cell["row"] % rows, cell["column"] % columns] = (
                        np.nan if missing else value)
        scale, offset = attributes.get("scale_factor", 1.0), attributes.get("add_offset", 0.0)
        packed = np.where(np.isnan(values), layout["fill_value"],
                          np.round((values - offset) / scale)).astype(layout["dtype"])
        return numcodecs.get_codec(layout["compressor"]).encode(packed.tobytes())

    def depth(self):
        if "depth" not in self.cache:
            static = next(json.loads(entry["text"])["metadata"]
                          for url, entry in self.objects.items()
                          if url.endswith("static.zarr/.zmetadata"))
            layout = static["deptho/.zarray"]
            values = np.full(layout["chunks"], 20.0, dtype=layout["dtype"])
            for cell in RECORDED["cells"].values():
                values[cell["row"], cell["column"]] = cell["depth"]
            self.cache["depth"] = numcodecs.get_codec(layout["compressor"]).encode(
                values.tobytes())
        return self.cache["depth"]


def first_hour(meta):
    """Hours since 1950 at the store's first time step (its time axis is hourly)."""
    times = [url for url in RECORDED["objects"] if url.endswith("geoChunked.zarr/time/0")]
    entry = RECORDED["objects"][times[0]]
    layout = meta["time/.zarray"]
    raw = numcodecs.get_codec(layout["compressor"]).decode(base64.b64decode(entry["base64"]))
    return int(np.frombuffer(raw, dtype=layout["dtype"])[0])


def listing_url(objects):
    return next(url for url in objects if "list-type=2" in url and "2026%2F11" in url)


class ListingTests(unittest.TestCase):
    """Which run the day files say is whole."""

    def files(self, xml):
        store = FakeStore(changes={listing_url(RECORDED["objects"]): xml})
        marine = Marine(session=store)
        return marine.listing(marine.describe(NOW), ["2026/11"])

    def test_the_recorded_listing_names_the_whole_run_and_its_ten_days(self):
        state = Marine(session=FakeStore()).describe(NOW)
        files = Marine(session=FakeStore()).listing(state, months_to_list(NOW.date()))
        run, days = complete_run(parse_listing(files))
        self.assertEqual(run, RUN)
        self.assertEqual([entry["number"] for entry in days], list(range(1, 11)))
        self.assertTrue(days[0]["name"].endswith("_20261104_20261104_R20261104_FC01.nc"))
        self.assertTrue(days[-1]["name"].endswith("_20261113_20261113_R20261104_FC10.nc"))

    def test_between_the_halves_of_a_run_nothing_is_whole(self):
        # 19:00 UTC on 4 November: the new run's first five days beside the last
        # four of the day before's.
        with self.assertRaisesRegex(ValueError, "more than one run") as caught:
            complete_run(parse_listing(self.files(MIXED)))
        self.assertIn("08 Nov R20261104 FC05", str(caught.exception))
        self.assertIn("09 Nov R20261103 FC07", str(caught.exception))

    def test_a_day_listed_twice_or_a_file_of_two_days_is_a_layout_change(self):
        one = {"name": "X_20261104_20261104_R20261104_FC01.nc", "modified": "2026-11-04T11:23:00Z"}
        with self.assertRaisesRegex(ValueError, "Two IBI wave files"):
            parse_listing([one, {**one, "name": "Y_20261104_20261104_R20261103_FC02.nc"}])
        with self.assertRaisesRegex(ValueError, "more than one day"):
            parse_listing([{**one, "name": "X_20261104_20261105_R20261104_FC01.nc"}])

    def test_other_objects_in_the_folder_are_ignored(self):
        self.assertEqual(parse_listing([{"name": "index.json", "modified": "2026-11-04"}]), {})

    def test_the_months_listed_reach_a_whole_run_across_the_year_end(self):
        self.assertEqual(months_to_list(date(2026, 12, 30)), ["2026/12", "2027/01"])
        self.assertEqual(months_to_list(date(2026, 11, 2)), ["2026/10", "2026/11"])
        self.assertEqual(months_to_list(date(2026, 11, 15)), ["2026/11"])


class CatalogueTests(unittest.TestCase):
    def test_the_served_version_is_the_newest_released_and_not_retired(self):
        marine = Marine(session=FakeStore())
        state = marine.describe(NOW)
        # 202611 is listed but not released until 24 November 2026.
        self.assertEqual(state["version"], "202411")
        self.assertIn(f"{DATASET}_202411/geoChunked.zarr", state["series"])
        self.assertIn("static_202411--ext--bathy/static.zarr", state["static"])
        self.assertIsNone(state["updating"])
        # Released on 24 November, it takes over with no code change.
        later = marine.describe(datetime(2026, 11, 25, tzinfo=timezone.utc))
        self.assertEqual(later["version"], "202611")
        self.assertIn(f"{DATASET}_202611/geoChunked.zarr", later["series"])

    def test_a_store_mid_update_or_older_than_the_run_is_refused(self):
        files = [{"modified": datetime(2026, 11, 5, 0, 9, tzinfo=timezone.utc)}]
        check_store({"updated": "2026-11-05T00:20:00Z", "updating": None}, files, "now")
        with self.assertRaisesRegex(ValueError, "being updated"):
            check_store({"updated": "2026-11-05T00:20:00Z",
                         "updating": "2026-11-05T00:30:00Z"}, files, "now")
        with self.assertRaisesRegex(ValueError, "does not hold that run yet"):
            check_store({"updated": "2026-11-04T11:43:42Z", "updating": None}, files, "now")


class CellTests(unittest.TestCase):
    """Where each riding location is read, on the model's own land-sea mask."""

    @classmethod
    def setUpClass(cls):
        marine = Marine(session=FakeStore())
        state = marine.describe(NOW)
        static = marine.grid(state)
        cls.spots = {spot["id"]: spot for spot in load_spots()}
        rows, columns = fetch_ibi_wave.spot_box(list(cls.spots.values()), static.latitudes,
                                                static.longitudes)
        cls.latitudes = static.latitudes[rows[0]:rows[1]]
        cls.longitudes = static.longitudes[columns[0]:columns[1]]
        cls.sea, cls.depth = static.read(rows, columns)

    def cell(self, spot_id):
        return choose_cell(self.spots[spot_id], self.latitudes, self.longitudes,
                           self.sea, self.depth)

    def test_the_read_box_is_on_the_store_tiles(self):
        self.assertEqual(self.sea.shape[0] % 16, 0)
        self.assertEqual(self.sea.shape[1] % 16, 0)

    def test_the_northern_coast_is_inside_the_domain_and_read_from_open_water(self):
        # The domain ends at 56.0009°N; Inishowen and the north coast are the
        # nearest riding places to that edge.
        for spot_id in ("fi-pollan-bay", "portrush", "downings", "portsalon"):
            with self.subTest(spot=spot_id):
                cell, reason = self.cell(spot_id)
                self.assertIsNone(reason)
                self.assertTrue(cell["openWater"])
                self.assertLess(cell["offsetKm"], fetch_ibi_wave.SEARCH_KM)
                self.assertLess(self.latitudes[cell["row"]], 56.0)

    def test_an_inland_lake_has_no_cell_and_says_why(self):
        for spot_id in ("lough-neagh-antrim", "fi-mountshannon-lough-derg", "blessington"):
            with self.subTest(spot=spot_id):
                cell, reason = self.cell(spot_id)
                self.assertIsNone(cell)
                self.assertIn("no sea within 8 km", reason)

    def test_a_place_outside_the_domain_says_so(self):
        cell, reason = choose_cell({"id": "x", "lat": 57.0, "lon": -7.0}, self.latitudes,
                                   self.longitudes, self.sea, self.depth)
        self.assertIsNone(cell)
        self.assertIn("outside", reason)

    def test_the_coastline_is_used_only_when_no_open_water_is_in_reach(self):
        # A sea cell with land on one side, and land all round it otherwise.
        sea = np.zeros((5, 5), dtype=bool)
        sea[2, 2] = sea[2, 3] = True
        latitudes = np.array([54.0, 54.02, 54.04, 54.06, 54.08])
        longitudes = np.array([-8.0, -7.97, -7.94, -7.91, -7.88])
        cell, _ = choose_cell({"id": "x", "lat": 54.04, "lon": -7.94}, latitudes, longitudes,
                              sea, np.full((5, 5), 4.0))
        self.assertFalse(cell["openWater"])
        self.assertTrue(cell["own"])
        self.assertEqual(cell["depthM"], 4.0)


class ValueTests(unittest.TestCase):
    def test_values_are_rounded_and_directions_normalised(self):
        self.assertEqual(value_of(1.23456, "swh"), 1.23)
        self.assertEqual(value_of(359.97, "mwd"), 0.0)
        self.assertEqual(value_of(-0.004, "swell2_h"), 0.0)
        self.assertIsNone(value_of(float("nan"), "swell2_p"))

    def test_an_implausible_value_fails_the_run(self):
        with self.assertRaises(ValueError):
            value_of(31.0, "swh")
        with self.assertRaises(ValueError):
            value_of(-1.0, "pp1d")


class AdapterTests(unittest.TestCase):
    """The whole adapter against the recorded store: the published bundle's contract."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        environment = patch.dict(os.environ, {}, clear=False)
        environment.start()
        self.addCleanup(environment.stop)
        os.environ.pop(PUBLISHED_RUN_ENV, None)

    def run_main(self, store=None, now=NOW):
        self.store = store or FakeStore()
        with patch("fetch_ibi_wave.ROOT", self.root):
            return main([], marine=Marine(session=self.store), now=now)

    def test_a_whole_run_publishes_every_spot_hourly_and_passes_the_validator(self):
        manifest = self.run_main()
        self.assertEqual(manifest["run"], "2026110400")
        self.assertEqual(manifest["horizonHours"], HOURS)
        self.assertEqual(manifest["stepHours"], 1)
        self.assertEqual(manifest["frames"], [])
        spots = load_spots()
        self.assertEqual(set(manifest["spotSeries"]), {spot["id"] for spot in spots})
        self.assertEqual(set(manifest["spotCoverage"]), {spot["id"] for spot in spots})
        portrush = manifest["spotSeries"]["portrush"]
        self.assertEqual(len(portrush), HOURS + 1)
        self.assertEqual(portrush[0]["validTime"], "2026-11-04T00:00:00Z")
        self.assertEqual(portrush[-1]["validTime"], "2026-11-13T23:00:00Z")
        self.assertEqual(set(portrush[0]["values"]), set(fetch_ibi_wave.VARIABLES))
        published = read_whole(self.root / "public/weather/ibi-wave.json")
        self.assertEqual(published["spotSeries"], manifest["spotSeries"])
        bundle, _, objects = validate_bundle(self.root / "public", "ibi-wave",
                                             MODELS["ibi-wave"]["maxAgeHours"], NOW)
        self.assertEqual(bundle["run"], "2026110400")
        self.assertTrue(objects)

    def test_the_recorded_cells_publish_the_models_own_values(self):
        manifest = self.run_main()
        for spot_id, cell in RECORDED["cells"].items():
            series = manifest["spotSeries"][spot_id]
            for name, entry in fetch_ibi_wave.VARIABLES.items():
                # Packed to hundredths by the store, so a direction may round
                # either way at its last tenth.
                places = 0.051 if entry["kind"] == fetch_ibi_wave.DIRECTION else 0.006
                for step, value in zip(series, cell["values"][entry["source"]]):
                    found = step["values"][name]
                    if value is None:
                        self.assertIsNone(found, f"{spot_id} {name} +{step['hour']}h")
                    else:
                        difference = abs((found - value + 180) % 360 - 180
                                         if entry["kind"] == fetch_ibi_wave.DIRECTION
                                         else found - value)
                        self.assertLessEqual(difference, places,
                                             f"{spot_id} {name} +{step['hour']}h")
            coverage = manifest["spotCoverage"][spot_id]
            self.assertTrue(coverage["resolved"])
            self.assertTrue(coverage["openWater"])
            self.assertEqual(coverage["depthM"], round(cell["depth"], 1))
            self.assertTrue(coverage["note"])

    def test_partitions_come_under_the_names_the_site_reads(self):
        variables = self.run_main()["variables"]
        for name in ("swh", "pp1d", "mwp", "mwd", "shww", "mpww", "mdww",
                     "swell1_h", "swell1_p", "swell1_d", "swell2_h", "swell2_p", "swell2_d"):
            self.assertIn(name, variables)

    def test_a_spot_with_no_sea_is_all_nulls_with_its_reason(self):
        manifest = self.run_main()
        coverage = manifest["spotCoverage"]["lough-neagh-antrim"]
        self.assertFalse(coverage["resolved"])
        self.assertIsNone(coverage["nearestOffsetKm"])
        self.assertTrue(all(value is None for step in manifest["spotSeries"]["lough-neagh-antrim"]
                            for value in step["values"].values()))

    def test_only_the_tiles_holding_a_spots_cell_are_read_once_each(self):
        self.run_main()
        chunks = [url for url in self.store.requests if SERIES_STORE.search(url)
                  and SERIES_STORE.search(url).group(1) in SOURCE_VARIABLES]
        self.assertEqual(len(chunks), len(set(chunks)))
        tiles = {SERIES_STORE.search(url).groups()[1:] for url in chunks}
        self.assertEqual(len(chunks), len(tiles) * len(SOURCE_VARIABLES))
        self.assertLess(len(tiles), 60)

    def test_the_credit_and_licence_are_published(self):
        manifest = self.run_main()
        self.assertTrue(manifest["attribution"].startswith(
            "Generated using E.U. Copernicus Marine Service Information; "
            "https://doi.org/10.48670/moi-00025"))
        self.assertEqual(manifest["doi"], "https://doi.org/10.48670/moi-00025")
        self.assertIn("service-commitments-and-licence", manifest["licenseUrl"])

    def test_the_run_the_bucket_serves_downloads_nothing(self):
        os.environ[PUBLISHED_RUN_ENV] = "2026110400"
        self.assertEqual(self.run_main(), UNCHANGED_EXIT)
        self.assertFalse([url for url in self.store.requests if SERIES_STORE.search(url)])

    def test_a_cell_the_store_has_not_filled_fails_the_run(self):
        store = FakeStore(holes={("portrush", "VHM0", HOURS)})
        with self.assertRaisesRegex(ValueError, "store is incomplete"):
            self.run_main(store)
        self.assertFalse((self.root / "public/weather/ibi-wave.json").exists())

    def test_a_store_that_changes_during_the_read_is_refused(self):
        store = FakeStore()
        item = next(url for url in store.objects
                    if url.endswith(f"{DATASET}_202411/dataset.stac.json"))
        original = store.get

        def updating_after_first_chunk(url, **kwargs):
            if SERIES_STORE.search(url) and item not in store.changes:
                document = json.loads(store.objects[item]["text"])
                document["properties"]["admp_updated_data"] = "2026-11-05T03:00:01.000Z"
                store.changes[item] = json.dumps(document)
            return original(url, **kwargs)

        store.get = updating_after_first_chunk
        with self.assertRaisesRegex(ValueError, "changed while it was read"):
            self.run_main(store)

    def test_a_run_too_old_is_refused(self):
        with self.assertRaisesRegex(ValueError, "refusing a run"):
            self.run_main(now=NOW + timedelta(hours=60))


if __name__ == "__main__":
    unittest.main()
