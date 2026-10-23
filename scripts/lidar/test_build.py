"""build.py's drawing, on small grids. Run with the README's venv:

    python -I -m unittest discover -s scripts/lidar -p 'test_*.py'
"""
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build  # noqa: E402

CFG = build.load_config()


class RampTest(unittest.TestCase):
    def test_the_stops_are_sorted_colours(self):
        ramp = build.ramp_stops(CFG)
        self.assertEqual([m for m, _ in ramp], sorted(m for m, _ in ramp))
        self.assertLess(ramp[0][0], 0)
        self.assertGreater(ramp[-1][0], 5)

    def test_a_height_takes_its_stop_and_between_two_the_mean(self):
        ramp = [(0.0, (0, 0, 0)), (2.0, (200, 100, 50))]
        c = build.colour(np.array([[0.0, 1.0, 2.0, 9.0]], np.float32), ramp)
        np.testing.assert_allclose(c[0], [[0, 0, 0], [100, 50, 25], [200, 100, 50], [200, 100, 50]])


class ShadeTest(unittest.TestCase):
    def test_flat_ground_keeps_its_colour(self):
        h = np.full((8, 8), 3.0, np.float32)
        np.testing.assert_allclose(build.hillshade(h, 3.0, CFG["hillshade"], 14, 14), 1.0, atol=1e-6)
        rgba = build.render(h, 3.0, 14, CFG, build.ramp_stops(CFG))
        want = np.round(build.colour(h, build.ramp_stops(CFG))[0, 0])
        np.testing.assert_array_equal(rgba[:3, 4, 4], want)
        self.assertTrue((rgba[3] == 255).all())

    def test_a_slope_facing_the_north_west_is_lit_and_one_facing_away_shaded(self):
        y, x = np.mgrid[0:8, 0:8].astype(np.float32)
        faces_nw = x + y  # rows run south: higher to the south-east, so it faces north-west
        self.assertGreater(build.hillshade(faces_nw, 3.0, CFG["hillshade"], 14, 14)[4, 4], 1)
        self.assertLess(build.hillshade(-faces_nw, 3.0, CFG["hillshade"], 14, 14)[4, 4], 1)

    def test_the_edge_of_the_coverage_draws_no_cliff(self):
        h = np.full((8, 8), 30.0, np.float32)
        h[:, :4] = np.nan
        shade = build.hillshade(h, 3.0, CFG["hillshade"], 14, 14)
        np.testing.assert_allclose(shade[:, 4:], 1.0, atol=1e-6)
        rgba = build.render(h, 3.0, 14, CFG, build.ramp_stops(CFG))
        self.assertTrue((rgba[:, :, :4] == 0).all())


class GridTest(unittest.TestCase):
    def test_fill_values_and_heights_out_of_range_are_none(self):
        a = np.array([[0, -9999, 1.5, 2000, -3.4e38, np.nan]], np.float32)
        out = build.clean(a, {"invalid": [0, -9999], "validRange": [-5, 1100]}, None)
        self.assertEqual(np.isfinite(out).tolist(), [[False, False, True, False, False, False]])

    def test_halving_takes_the_mean_of_the_heights_there(self):
        h = np.array([[1, 3, np.nan, np.nan], [np.nan, 2, np.nan, np.nan]], np.float32)
        out = build.down2(h)
        self.assertEqual(out[0, 0], 2)
        self.assertTrue(np.isnan(out[0, 1]))


if __name__ == "__main__":
    unittest.main()
