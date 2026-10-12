"""Unit tests for the satellite pipeline's pure parts.

    python -m unittest discover -s scripts/satellite -p 'test_*.py'
"""
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import composite  # noqa: E402

STATIONS = [
    {"id": "A", "name": "A", "lon": -6.0, "lat": 53.0, "ni": False},
    {"id": "B", "name": "B", "lon": -6.0, "lat": 53.4, "ni": False},
    {"id": "N", "name": "N", "lon": -5.6, "lat": 54.6, "ni": True},
]


class MedianTest(unittest.TestCase):
    def test_odd_and_even_counts(self):
        stack = np.array([[[10]], [[30]], [[20]], [[99]]], dtype=np.uint8)
        valid = np.array([[[1]], [[1]], [[1]], [[0]]], dtype=bool)
        med, n = composite.masked_median(stack, valid)
        self.assertEqual(med[0, 0], 20)
        self.assertEqual(n[0, 0], 3)
        valid[3] = True
        med, n = composite.masked_median(stack, valid)
        self.assertEqual(med[0, 0], 25)  # (20 + 30) / 2

    def test_none_valid_is_nan(self):
        med, n = composite.masked_median(np.ones((3, 2, 2), np.uint8), np.zeros((3, 2, 2), bool))
        self.assertTrue(np.isnan(med).all())
        self.assertEqual(n.max(), 0)

    def test_robust_median_drops_a_missed_cloud(self):
        # Five clear looks of dark water and two bright ones the masks missed (an even count would
        # otherwise average the middle two); the bright pair is far from the first median and goes.
        looks = [60, 62, 61, 63, 59, 200, 210]
        rgb = np.array([[[[v]]] * 3 for v in looks], dtype=np.uint8)
        med, used = composite.robust_rgb_median(rgb, np.ones((7, 1, 1), bool))
        self.assertEqual(used[0, 0], 5)
        self.assertEqual(med[0, 0, 0], 61)

    def test_robust_median_keeps_the_majority(self):
        # When "outliers" are most of the looks they are the scene, not noise.
        looks = [60, 200, 205, 210]
        rgb = np.array([[[[v]]] * 3 for v in looks], dtype=np.uint8)
        med, used = composite.robust_rgb_median(rgb, np.ones((4, 1, 1), bool))
        self.assertGreaterEqual(used[0, 0], 3)


class LevelTest(unittest.TestCase):
    def test_median_level(self):
        levels = np.array([3.0, 1.0, 2.0, 5.0])
        use = np.array([1, 1, 1, 0], bool)[:, None, None]
        self.assertAlmostEqual(float(composite.median_level(levels, use)[0, 0]), 2.0)


class FlipTest(unittest.TestCase):
    def test_flip_between_dry_and_wet(self):
        tides = np.array([0.5, 1.0, 1.5, 2.0, 2.5, 3.0])
        # Pixel 0 covers between 1.5 and 2.0; pixel 1 is always wet; pixel 2 always dry.
        stack = np.array([[[0, 1, 0]], [[0, 1, 0]], [[0, 1, 0]], [[1, 1, 0]], [[1, 1, 0]], [[1, 1, 0]]], np.int8)
        z, misfit, nvalid, state, spread = composite.flip_heights(stack, tides)
        self.assertAlmostEqual(float(z[0, 0]), 1.75)
        self.assertEqual(state[0].tolist(), [1, 2, 3])
        self.assertEqual(float(misfit[0, 0]), 0)
        self.assertEqual(nvalid[0, 0], 6)
        db, wa = composite.below_above_counts(stack, tides, z)
        self.assertEqual((db[0, 0], wa[0, 0]), (3, 3))

    def test_flip_ignores_unseen_and_counts_misfit(self):
        tides = np.array([2.0, 0.5, 1.0, 3.0, 2.5])  # unsorted on purpose
        stack = np.array([[[1]], [[0]], [[-1]], [[1]], [[0]]], np.int8)  # 2.5 dry: one contradiction
        z, misfit, nvalid, state, _ = composite.flip_heights(stack, tides)
        self.assertEqual(nvalid[0, 0], 4)
        self.assertAlmostEqual(float(misfit[0, 0]), 0.25)
        self.assertEqual(state[0, 0], 1)

    def test_scene_qc(self):
        st = np.zeros((2, 4, 4), np.int8)
        st[:, :2] = 1  # top half wet
        st[1, 0, :] = 0  # look 1 sees a quarter of the always-wet as dry
        wet = np.zeros((4, 4), bool)
        wet[:2] = True
        err = composite.scene_errors(st, wet, ~wet, np.ones((4, 4), bool))
        keep = composite.keep_from_errors(err, 0.06, min_ref=4)
        self.assertEqual(keep.tolist(), [True, False])


class EncodingTest(unittest.TestCase):
    def test_round_trip(self):
        r = np.array([0.0, 0.01, 0.03, 0.1, 0.3])
        back = composite.decode(common.encode_refl(r).astype(np.float32))
        self.assertTrue(np.all(np.abs(back - r) < np.maximum(0.002, r * 0.03)))
        self.assertTrue((common.encode_refl(r) >= 1).all())  # 0 stays "no value"


class StationTest(unittest.TestCase):
    def test_republic_within_reach_wins(self):
        idx = common.nearest_station(np.array([-6.0, -6.0]), np.array([53.1, 53.35]), STATIONS, 45)
        self.assertEqual(idx.tolist(), [0, 1])

    def test_northern_ireland_only_past_the_reach_and_nearer(self):
        # 60 km from B, 40 km from N: N. 50 km from A and nowhere near N: still A.
        idx = common.nearest_station(np.array([-5.7, -6.0]), np.array([54.25, 52.55]), STATIONS, 45)
        self.assertEqual(idx.tolist(), [2, 0])

    def test_weights_sum_to_one_and_blend_on_the_bisector(self):
        lon = np.array([-6.0, -6.0, -6.0])
        lat = np.array([53.05, 53.2, 53.35])
        w = common.station_weights(lon, lat, STATIONS, 45, 3.0)
        self.assertTrue(np.allclose(w.sum(axis=0), 1))
        self.assertEqual(w[:, 0].tolist(), [1, 0, 0])
        self.assertAlmostEqual(float(w[0, 1]), 0.5, places=2)

    def test_region_block_matches_national_partition(self):
        # The centre of the 4×4 block a point is in, on the z13 512 px grid (national.py's partition).
        lon, lat = common.region_block_lonlat(np.array([-6.1]), np.array([53.4]))
        x, y = common.merc(lon, lat)
        px = common.EARTH / 2 ** 13 / 512
        col = (x + common.EARTH / 2) / px
        self.assertAlmostEqual(float(col[0] % 4), 2.0, places=6)

    def test_a_basin_takes_its_polygon_and_nothing_else(self):
        lough = {"id": "L", "name": "L", "lon": -5.62, "lat": 54.48, "ni": True,
                 "polygon": [[-5.7, 54.4], [-5.5, 54.4], [-5.5, 54.6], [-5.7, 54.6]]}
        st = STATIONS + [lough]
        lon = np.array([-5.6, -5.45, -5.6])
        lat = np.array([54.5, 54.5, 54.3])
        idx = common.nearest_station(lon, lat, st, 45)
        self.assertEqual(idx.tolist(), [3, 2, 2])  # in the lough; the open coast beside it; south of it
        w = common.station_weights(lon, lat, st, 45, 3.0)
        self.assertEqual(w[:, 0].tolist(), [0, 0, 0, 1])
        self.assertEqual(float(w[3, 1]), 0.0)
        self.assertTrue(np.allclose(w.sum(axis=0), 1))

    def test_region_ids_follow_national(self):
        self.assertEqual(common.region_id("Achill_Island_MODELLED"), "tide-achill-island")
        self.assertEqual(common.region_id("Dublin_Port"), "tide-dublin-port")


if __name__ == "__main__":
    unittest.main()
