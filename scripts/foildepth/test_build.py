"""Checks of build.py's gap-fill and basin pieces on toy grids.

    python -I test_build.py

Needs what build.py needs (README.md); no downloads.
"""
import json
import os
import sys
import tempfile
import unittest

import numpy as np
from rasterio.transform import from_origin

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # `python -I` leaves the script's own folder off the path
import build  # noqa: E402

# A 100 × 100 grid of 10 m pixels with its top-left corner at 6.2° W, 53.34° N.
X0, Y0 = build.merc(-6.2, 53.34)
T = from_origin(X0, Y0, 10, 10)
SHAPE = (100, 100)


def lonlat(col, row):
    """The lon/lat of a pixel corner of the toy grid."""
    import math
    x, y = X0 + col * 10, Y0 - row * 10
    return math.degrees(x / 6378137.0), math.degrees(2 * math.atan(math.exp(y / 6378137.0)) - math.pi / 2)


def square(c0, r0, c1, r1):
    return [lonlat(c0, r0), lonlat(c1, r0), lonlat(c1, r1), lonlat(c0, r1)]


class PolygonMask(unittest.TestCase):
    def test_inside_only(self):
        m = build.polygon_mask([square(20, 30, 60, 70)], T, SHAPE)
        self.assertTrue(m[50, 40])
        self.assertFalse(m[10, 10])
        self.assertFalse(m[80, 80])
        self.assertAlmostEqual(m.sum(), 40 * 40, delta=80)


class GapFill(unittest.TestCase):
    def test_drops_only_the_release_and_sources_asked(self):
        def feature(identifier, release, ring):
            return {"type": "Feature", "properties": {"identifier": identifier, "release": release},
                    "geometry": {"type": "Polygon", "coordinates": [[list(p) for p in ring + ring[:1]]]}}

        refs = {"type": "FeatureCollection", "features": [
            feature("GEBCO2024", "2024", square(0, 0, 30, 30)),
            feature("GEBCO2022", "2022", square(60, 60, 90, 90)),
            feature("KY_10_01_DN_5M_WGS84", "2024", square(60, 0, 90, 30)),
        ]}
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "refs.json"), "w") as fh:
                json.dump(refs, fh)
            m = build.gap_fill_mask({"file": "refs.json", "release": "2024", "identifiers": ["GEBCO"]},
                                    d, T, SHAPE)
            self.assertTrue(m[15, 15])  # GEBCO 2024
            self.assertFalse(m[75, 75])  # an older release's GEBCO
            self.assertFalse(m[15, 75])  # a survey
            # No references on disk: nothing dropped, rather than everything.
            self.assertFalse(build.gap_fill_mask({"file": "none.json", "release": "2024", "identifiers": ["GEBCO"]},
                                                 d, T, SHAPE).any())


class BasinSurface(unittest.TestCase):
    def test_lidar_at_or_under_a_basins_surface_is_water(self):
        src = {"kind": "topo", "waterLevelLat": 1.65}
        layer = np.full(SHAPE, 3.9, dtype=np.float32)  # a flat water surface
        layer[:, 50:] = 4.5  # ground above it
        surface = np.full(SHAPE, np.nan, dtype=np.float32)
        surface[:, :] = 4.0  # all of it inside the basin
        bathy = np.full(SHAPE, np.nan, dtype=np.float32)
        z = build.merge_one(np.full(SHAPE, np.nan, dtype=np.float32), src, layer, 0, bathy, surface)
        self.assertTrue(np.isnan(z[:, :50]).all())
        self.assertTrue((z[:, 50:] == 4.5).all())
        # Outside a basin only the flight's sea level counts.
        z = build.merge_one(np.full(SHAPE, np.nan, dtype=np.float32), src, layer, 0, bathy, None)
        self.assertTrue((z[:, :50] == np.float32(3.9)).all())


class Archive(unittest.TestCase):
    def test_a_basin_and_its_area_share_no_water(self):
        # Two whole z14 tiles side by side, the right one a basin.
        size, land = 64, 50.0
        grid = np.full((size, 2 * size), -2.0, dtype=np.float32)
        mask = np.zeros_like(grid, dtype=bool)
        mask[:, size:] = True
        with tempfile.TemporaryDirectory() as d:
            for name, g in (("area", np.where(mask, land, grid)), ("basin", np.where(mask, grid, land))):
                mb = build.write_archive(g, (8000, 5000, 8001, 5000), size, 13, 14,
                                         [-6.2, 53.3, -6.1, 53.4], os.path.join(d, f"{name}.pmtiles"),
                                         name, {**CFG, "landMetres": land}, "test")
                self.assertGreater(mb, 0)
            from pmtiles.reader import MmapSource, Reader
            from PIL import Image
            import io

            def height(name, x):
                with open(os.path.join(d, f"{name}.pmtiles"), "rb") as fh:
                    data = Reader(MmapSource(fh)).get(14, x, 5000)
                if data is None:
                    return None  # a tile with nothing to draw is left out
                img = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))
                r, g, b = img[0, 0].astype(float)
                return r * 256 + g + b / 256 - 32768

            self.assertEqual(height("area", 8000), -2.0)
            self.assertIsNone(height("area", 8001))
            self.assertIsNone(height("basin", 8000))
            self.assertEqual(height("basin", 8001), -2.0)


CFG = {"floorMetres": -5, "deepMetres": -20, "landMetres": 50, "noSurveyMetres": 40,
       "seedBelowMetres": -0.3, "minWaterPixels": 10, "maxHolePixels": 50, "seaBandMetres": 200}


class DepthCut(unittest.TestCase):
    """Only the bed from the dry ceiling down to 5 m under LAT is kept."""

    def finish(self, z, wet_at_lat=None, ceiling=5.0, mhw=None, above=None):
        shape = z.shape
        return build.finish(z.astype(np.float32), np.zeros(shape, bool) if wet_at_lat is None else wet_at_lat,
                            np.full(shape, np.nan, np.float32), np.zeros(shape, bool) if above is None else above,
                            np.zeros(shape, bool), ceiling, CFG, 10.0, mhw)

    def test_deeper_than_the_floor_is_the_deep_value_and_the_shore_is_kept(self):
        # A beach: 8 m at the top, falling 0.25 m a pixel out to sea.
        z = np.tile(8 - 0.25 * np.arange(100, dtype=np.float32), (20, 1))
        out, stats = self.finish(z)
        row = out[10]
        self.assertTrue((row[z[10] > 5.0] == 50).all())  # above the ceiling: land
        kept = (z[10] <= 5.0) & (z[10] >= -5.0)
        np.testing.assert_allclose(row[kept], z[10][kept], atol=1 / 64)
        self.assertTrue((row[z[10] < -5.0] == -20).all())
        self.assertGreater(stats["deep"], 0)
        self.assertGreater(stats["intertidal"], 0)

    def test_a_ceiling_per_pixel(self):
        z = np.full((10, 40), 4.0, np.float32)
        z[:, :5] = -3.0  # the sea that seeds it
        ceiling = np.full(z.shape, 5.0, np.float32)
        ceiling[:, 20:] = 3.5  # a station with a smaller range
        out, _ = self.finish(z, ceiling=ceiling)
        self.assertTrue((out[:, 10:20] == 4.0).all())
        self.assertTrue((out[:, 20:] == 50).all())

    def test_a_large_unsurveyed_stretch_is_taken_for_deep_by_its_size_not_its_distance(self):
        z = np.full((200, 200), 20.0, np.float32)
        z[:, :8] = -3.0
        wet = np.zeros(z.shape, bool)
        z[10:20, 8:20] = np.nan  # 120 px of 10 m: 0.012 km2
        wet[10:20, 8:20] = True
        z[40:190, 8:190] = np.nan  # 27300 px: 2.7 km2
        wet[40:190, 8:190] = True
        cfg = dict(CFG, maxUnsurveyedKm2=1.0)
        out, _ = build.finish(z, wet, np.full(z.shape, np.nan, np.float32), np.zeros(z.shape, bool),
                              np.zeros(z.shape, bool), 5.0, cfg, 10.0)
        self.assertTrue((out[10:20, 8:20] == 40).all())
        self.assertTrue((out[40:190, 8:190] == -20).all())  # all of it, however near the shore

    def test_unsurveyed_water_must_join_sounded_sea(self):
        z = np.full((40, 40), 20.0, np.float32)
        z[:, :8] = -3.0  # sea
        wet = np.zeros(z.shape, bool)
        # Water "under LAT" with no survey: one joined to the sea, one a lake.
        z[5:15, 8:20] = np.nan
        wet[5:15, 8:20] = True
        z[25:35, 25:35] = np.nan
        wet[25:35, 25:35] = True
        out, _ = self.finish(z, wet)
        self.assertTrue((out[5:15, 8:20] == 40).all())
        self.assertTrue((out[25:35, 25:35] == 50).all())

    def test_behind_the_mhw_line_only_marsh_is_kept(self):
        z = np.full((10, 40), 4.6, np.float32)
        z[:, :5] = -3.0
        z[:, 30:] = 3.9
        above = np.zeros(z.shape, bool)
        above[:, 20:] = True  # behind the satellite MHW line
        out, _ = self.finish(z, above=above, mhw=3.6, ceiling=5.5)
        # In front of the line, over MHW + 0.5: an upper beach, kept within
        # 60 m (6 pixels) of ground the sea floods, and no further.
        self.assertTrue((out[:, 5:11] == np.float32(4.59375)).all())
        self.assertTrue((out[:, 12:20] == 50).all())
        self.assertTrue((out[:, 20:30] == 50).all())  # fields over MHW + 0.5
        # Low marsh behind the line is kept only where it still joins the sea.
        self.assertTrue(((out[:, 30:] == 50) | (out[:, 30:] == np.float32(3.90625))).all())


class UpperBeach(unittest.TestCase):
    def test_fields_joined_to_the_shore_through_low_ground_are_land(self):
        # The sea, a beach rising to 3.5 m, then 2 km of fields at 4-4.8 m
        # (under the 5.2 m dry ceiling) behind it, then a hollow at 3 m.
        z = np.full((20, 300), 4.4, np.float32)
        z[:, :10] = -3.0
        z[:, 10:20] = np.linspace(-1, 3.5, 10)
        z[:, 250:270] = 3.0
        out, _ = build.finish(z, np.zeros(z.shape, bool), np.full(z.shape, np.nan, np.float32),
                              np.zeros(z.shape, bool), np.zeros(z.shape, bool), 5.2, CFG, 10.0, 3.9)
        self.assertTrue((out[:, 10:20] < 20).all())  # the beach
        self.assertTrue((out[:, 20:26] < 20).all())  # its top, within 60 m
        self.assertTrue((out[:, 40:] == 50).all())  # the fields and the hollow behind them


class Reserved(unittest.TestCase):
    def test_downsample_never_averages_a_reserved_value(self):
        z = np.array([[-3, -20, 50, 50, 40, 50, -20, 50],
                      [-1, -20, 50, 50, 50, 50, 50, 50]], np.float32)
        z = np.vstack([z, z])
        half = build.downsample(z, CFG)
        self.assertEqual(half[0, 0], -2.0)  # the heights' mean, the deep one left out
        self.assertEqual(half[0, 1], 50)
        self.assertEqual(half[0, 2], 40)  # unsurveyed over land
        self.assertEqual(half[0, 3], -20)  # deep over land

    def test_edge_values_are_deep_for_any_water_and_land_for_land(self):
        # Deep and land side by side would run through every colour: they
        # meet only where water meets land.
        out = np.array([-2.0, 1.5, 40, -20, 50], np.float32)
        np.testing.assert_array_equal(build.edge_value(out, CFG), [-20, -20, -20, -20, 50])

    def test_has_content(self):
        self.assertFalse(build.has_content(np.array([-20, 50], np.float32), CFG))
        self.assertTrue(build.has_content(np.array([-20, -5], np.float32), CFG))
        self.assertTrue(build.has_content(np.array([40, 50], np.float32), CFG))


class Partition(unittest.TestCase):
    STATIONS = [{"id": "A", "lon": -6.0, "lat": 53.4}, {"id": "B", "lon": -6.2, "lat": 53.6}]

    def test_nearest_station_and_its_distance(self):
        import national
        idx, km = national.nearest_station(np.array([-6.01, -6.19, -6.0]), np.array([53.41, 53.59, 52.0]),
                                           self.STATIONS)
        self.assertEqual(idx.tolist(), [0, 1, 0])
        self.assertLess(km[0], 2)
        self.assertGreater(km[2], 150)

    def test_a_pixel_gets_the_same_station_in_any_chunk(self):
        import national
        # The same z13 tiles, reached from two chunks' grids.
        t1, w1, h1 = build.tile_grid(3950, 3953, 2650, 2653, 13, 512)
        t2, w2, h2 = build.tile_grid(3952, 3955, 2652, 2655, 13, 512)
        i1, _ = national.partition(t1, (h1, w1), self.STATIONS)
        i2, _ = national.partition(t2, (h2, w2), self.STATIONS)
        np.testing.assert_array_equal(i1[1024:, 1024:], i2[:1024, :1024])

    def test_region_ids_and_ceilings(self):
        import national
        cfg = {"regionPrefix": "tide-", "ceilingMarginMetres": 0.3}
        self.assertEqual(national.region_id(cfg, "Achill_Island_MODELLED"), "tide-achill-island")
        self.assertEqual(national.region_id(cfg, "Dublin_Port"), "tide-dublin-port")
        self.assertEqual(national.round_up(4.86 + 0.3), 5.2)
        self.assertEqual(national.round_up(5.0), 5.0)


class Lakes(unittest.TestCase):
    def test_a_lake_traced_with_every_waterline_is_land_not_sea(self):
        from waterlines import waterline_surface
        # The sea on the left (surveyed deep); a lake inland, its shore traced
        # as LAT, MSL and MHW at one place, with no seabed in it.
        survey = np.full(SHAPE, np.nan, np.float32)
        survey[:, :20] = -5.0
        survey[:, 25:] = 12.0
        survey[40:60, 60:80] = 5.0  # EMODnet's land heights over the lake
        sea_line = [lonlat(22, -1), lonlat(22, 101)]
        lake = [lonlat(60, 40), lonlat(80, 40), lonlat(80, 60), lonlat(60, 60), lonlat(60, 40)]

        def line(kind, coords):
            return {"type": "Feature", "properties": {"type": kind},
                    "geometry": {"type": "LineString", "coordinates": [list(c) for c in coords]}}
        geo = {"type": "FeatureCollection", "features": [
            line("LAT", sea_line), line("MSL", [lonlat(23, -1), lonlat(23, 101)]),
            line("MHW", [lonlat(24, -1), lonlat(24, 101)]),
            line("LAT", lake), line("MSL", lake), line("MHW", lake)]}
        z, wet, land, counts = waterline_surface(geo, {"LAT": 0, "MSL": 2.5, "MHW": 3.8}, T, SHAPE, survey,
                                                 coarsen=1)
        self.assertTrue(wet[50, 5])  # the sea is under LAT
        self.assertFalse(wet[50, 70])  # the lake is not
        self.assertTrue(land[50, 70])


class Index(unittest.TestCase):
    def test_the_index_lists_pilots_first_and_agrees_on_the_reserved_values(self):
        import national
        with tempfile.TemporaryDirectory() as d:
            out, pilots = os.path.join(d, "out"), os.path.join(d, "pilots")
            os.makedirs(out)
            os.makedirs(pilots)
            region = {"id": "tide-howth", "kind": "region", "url": "tide-howth.pmtiles", "station": "Howth",
                      "bounds": [-6.3, 53.3, -6.0, 53.5], "minzoom": 7, "maxzoom": 13, "tileSize": 512,
                      "stationLonLat": [-6.07, 53.39], "dryCeilingMetres": 5.2, "sources": [], "stats": {}}
            json.dump({"regions": [region]}, open(os.path.join(out, "regions.json"), "w"))
            json.dump({"areas": [{"id": "dublin-north", "url": "dublin-north.pmtiles"}]},
                      open(os.path.join(pilots, "pilots.json"), "w"))
            open(os.path.join(pilots, "dublin-north.pmtiles"), "wb").write(b"PMTiles")
            index = national.write_index(national.load_config(), out, pilots)
            self.assertEqual([a["id"] for a in index["areas"]], ["dublin-north", "tide-howth"])
            self.assertEqual(index["areas"][0]["kind"], "pilot")
            self.assertNotIn("stats", index["areas"][1])
            self.assertEqual((index["schemaVersion"], index["floorMetres"], index["deepMetres"]), (2, -5, -20))
            self.assertTrue(os.path.exists(os.path.join(out, "dublin-north.pmtiles")))

    def test_publish_versions_by_content(self):
        import publish
        with tempfile.TemporaryDirectory() as d:
            a, b = os.path.join(d, "a"), os.path.join(d, "b")
            open(a, "wb").write(b"one")
            open(b, "wb").write(b"two")
            v = publish.version_of({"x.pmtiles": a, "y.pmtiles": b})
            self.assertRegex(v, r"^v[0-9a-f]{12}$")
            self.assertEqual(v, publish.version_of({"y.pmtiles": b, "x.pmtiles": a}))
            open(b, "wb").write(b"three")
            self.assertNotEqual(v, publish.version_of({"x.pmtiles": a, "y.pmtiles": b}))

    def test_publish_points_the_repo_and_keeps_the_copy_it_reads_from(self):
        import publish
        with tempfile.TemporaryDirectory() as repo:
            for d in ("public/foildepth", "force5/src", "public-data/bathy/vaaaa", "public-data/foildepth/vold"):
                os.makedirs(os.path.join(repo, d))
            bathy = os.path.join(repo, "public-data/bathy/vaaaa/ireland.pmtiles")
            open(bathy, "wb").write(b"bathy")
            open(os.path.join(repo, "public-data/foildepth/vold/x.pmtiles"), "wb").write(b"old")
            open(os.path.join(repo, "force5/src/chartStyle.ts"), "w").write(
                'export const BATHY_PATH = "bathy/ireland.pmtiles";\n')
            pilot = os.path.join(repo, "dublin-north.pmtiles")
            open(pilot, "wb").write(b"pilot")
            index = {"areas": [{"id": "dublin-north", "kind": "pilot", "url": "dublin-north.pmtiles"},
                               {"id": "tide-howth", "kind": "region", "url": "tide-howth.pmtiles"}]}
            publish.point_repo("foildepth/vnew/", index, {"dublin-north.pmtiles": pilot},
                               "bathy/vaaaa/ireland.pmtiles", bathy, repo)
            self.assertEqual(open(bathy, "rb").read(), b"bathy")  # still there
            self.assertFalse(os.path.exists(os.path.join(repo, "public-data/foildepth/vold")))
            self.assertTrue(os.path.exists(os.path.join(repo, "public-data/foildepth/vnew/dublin-north.pmtiles")))
            self.assertFalse(os.path.exists(os.path.join(repo, "public-data/foildepth/vnew/tide-howth.pmtiles")))
            self.assertIn('"bathy/vaaaa/ireland.pmtiles"', open(os.path.join(repo, "force5/src/chartStyle.ts")).read())
            self.assertEqual(json.load(open(os.path.join(repo, "public/foildepth/index.json")))["base"],
                             "foildepth/vnew/")

    def test_publish_never_writes_outside_the_static_prefixes_or_over_an_object(self):
        import publish

        class S3:
            def __init__(self):
                self.objects = {"foildepth/v1/x.pmtiles": 3}

            def head_object(self, Bucket, Key):
                if Key not in self.objects:
                    e = Exception("404")
                    e.response = {"Error": {"Code": "404"}}
                    raise e
                return {"ContentLength": self.objects[Key]}

            def put_object(self, Bucket, Key, Body, **kw):
                self.objects[Key] = len(Body)

        s3 = S3()
        self.assertEqual(publish.put_new(s3, "b", "foildepth/v1/x.pmtiles", body=b"abc"), "kept")
        with self.assertRaises(SystemExit):
            publish.put_new(s3, "b", "foildepth/v1/x.pmtiles", body=b"abcd")
        with self.assertRaises(SystemExit):
            publish.put_new(s3, "b", "weather/harmonie.json", body=b"{}")
        self.assertEqual(publish.put_new(s3, "b", "foildepth/v1/index.json", body=b"{}"), "put")


if __name__ == "__main__":
    unittest.main()
