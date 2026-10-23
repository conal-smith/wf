"""Unit tests for Wave Finder's pure parts (numpy only; the enclosed-water test needs scipy).

    python -m unittest discover -s scripts/wavefinder -p 'test_*.py'
"""
import json
import math
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rank  # noqa: E402
import report  # noqa: E402
import score  # noqa: E402
import wf  # noqa: E402

CFG = wf.config()
SEA = CFG["seaState"]
FOAM = CFG["foam"]

try:
    import scipy  # noqa: F401
except ImportError:
    scipy = None


class SeaState(unittest.TestCase):
    def test_power(self):
        # 2 m at 12 s: about 21 kW per metre of crest; doubling the height quadruples it.
        self.assertAlmostEqual(float(wf.swell_power(2, 12)), 21.2, delta=0.3)
        self.assertAlmostEqual(float(wf.swell_power(4, 12) / wf.swell_power(2, 12)), 4.0)

    def test_big_is_relative_where_the_sea_is_small(self):
        self.assertEqual(wf.big_hs(SEA), SEA["bigHs"])
        self.assertEqual(wf.big_hs(SEA, 3.1), SEA["bigHs"])
        self.assertEqual(wf.big_hs(SEA, 1.5), 1.5)
        # Never down into calm: at least 0.3 m over the calm limit.
        self.assertAlmostEqual(wf.big_hs(SEA, 0.4), SEA["calmHs"] + 0.3)

    def test_classes(self):
        self.assertEqual(wf.sea_class(2.5, 13, 4, SEA), "big")
        self.assertEqual(wf.sea_class(2.5, 8, 4, SEA), "mid")  # short period: wind sea
        self.assertEqual(wf.sea_class(0.6, 9, 3, SEA), "calm")
        self.assertEqual(wf.sea_class(0.6, 9, 12, SEA), "mid")  # small but windy
        self.assertEqual(wf.sea_class(1.6, 12, 4, SEA, hs_p75=1.4), "big")  # the Irish Sea's big
        self.assertEqual(wf.sea_class(None, 12, 4, SEA), "none")
        self.assertEqual(wf.sea_class(2.5, float("nan"), 4, SEA), "none")

    def test_interpolation(self):
        t = np.array([0.0, 1.0, 2.0])
        v = np.array([1.0, 3.0, np.nan])
        self.assertAlmostEqual(wf.at_time(t, v, 0.5), 2.0)
        self.assertTrue(math.isnan(wf.at_time(t, v, 1.5)))
        self.assertTrue(math.isnan(wf.at_time(t, v, -1)))
        np.testing.assert_allclose(wf.at_time(t, v, np.array([0.0, 0.25])), [1.0, 1.5])

    def test_angles_interpolate_across_north(self):
        t = np.array([0.0, 1.0])
        self.assertAlmostEqual(wf.at_time_angle(t, np.array([350.0, 10.0]), 0.5) % 360, 0.0, places=6)
        self.assertAlmostEqual(wf.at_time_angle(t, np.array([80.0, 100.0]), 0.5), 90.0, places=6)

    def test_angle_diff(self):
        self.assertAlmostEqual(float(wf.angle_diff(10, 350)), 20)
        self.assertAlmostEqual(float(wf.angle_diff(350, 10)), -20)


class Blend(unittest.TestCase):
    PTS = [{"id": "a", "lon": -9.0, "lat": 54.0}, {"id": "b", "lon": -10.0, "lat": 54.0},
           {"id": "c", "lon": -6.0, "lat": 54.0}]

    def test_weights(self):
        w = wf.blend_weights(-9.0, 54.0, self.PTS)
        self.assertAlmostEqual(sum(w.values()), 1.0)
        self.assertNotIn("c", w)  # 200 km away
        self.assertGreater(w["a"], 0.9)
        mid = wf.blend_weights(-9.5, 54.0, self.PTS)
        self.assertAlmostEqual(mid["a"], mid["b"], places=6)

    def test_blend(self):
        v = wf.blend({"a": [2.0, 12, 350, 4, 90], "b": [4.0, 14, 10, 6, None]}, {"a": 0.5, "b": 0.5})
        self.assertAlmostEqual(v[0], 3.0)
        self.assertAlmostEqual(v[1], 13.0)
        self.assertAlmostEqual(v[2] % 360, 0.0, places=6)
        self.assertAlmostEqual(v[4], 90.0)
        self.assertEqual(wf.blend({"a": [None] * 5}, {"a": 1.0}), [None] * 5)


class Wind(unittest.TestCase):
    def test_onshore_offshore(self):
        # A west-facing shore (the sea to the west): a westerly blows onshore.
        self.assertAlmostEqual(float(wf.onshore(270, 270)), 1.0)
        self.assertAlmostEqual(float(wf.onshore(90, 270)), -1.0)
        self.assertAlmostEqual(float(wf.onshore(0, 270)), 0.0, places=9)

    def test_kinds(self):
        self.assertEqual(wf.wind_kind(3, 270, 270), "light")
        self.assertEqual(wf.wind_kind(9, 270, 270), "onshore")
        self.assertEqual(wf.wind_kind(9, 100, 270), "offshore")
        self.assertEqual(wf.wind_kind(9, 0, 270), "cross")
        self.assertEqual(wf.wind_kind(float("nan"), 0, 270), "none")

    def test_circular_mean(self):
        m, r = wf.circular_mean([350, 10])
        self.assertAlmostEqual(m % 360, 0.0, places=6)
        self.assertAlmostEqual(r, math.cos(math.radians(10)), places=6)
        m, r = wf.circular_mean([0, 180])
        self.assertLess(r, 1e-9)
        self.assertTrue(math.isnan(wf.circular_mean([])[0]))


class Foam(unittest.TestCase):
    #               B02   B03   B04   B08   B11
    SURF = (0.30, 0.29, 0.27, 0.20, 0.03)
    WATER = (0.04, 0.035, 0.02, 0.01, 0.005)
    SAND = (0.12, 0.16, 0.20, 0.25, 0.30)
    CLOUD = (0.40, 0.40, 0.40, 0.42, 0.30)
    WEED = (0.05, 0.07, 0.07, 0.25, 0.10)

    def test_surf_only(self):
        for name, px, want in (("surf", self.SURF, True), ("water", self.WATER, False), ("sand", self.SAND, False),
                               ("cloud", self.CLOUD, False), ("weed", self.WEED, False)):
            self.assertEqual(bool(wf.foam(*px, FOAM)), want, name)

    def test_arrays(self):
        a = np.array([self.SURF, self.WATER, self.SAND]).T
        np.testing.assert_array_equal(wf.foam(*a, FOAM), [True, False, False])

    def test_cloud_like_is_never_foam(self):
        rng = np.random.default_rng(0)
        b = rng.uniform(0, 0.5, size=(5, 2000))
        both = wf.foam(*b, FOAM) & wf.cloud_like(b[1], b[4], FOAM)
        self.assertFalse(both.any())
        self.assertTrue(bool(wf.cloud_like(self.CLOUD[1], self.CLOUD[4], FOAM)))
        self.assertFalse(bool(wf.cloud_like(self.SURF[1], self.SURF[4], FOAM)))

    def test_score(self):
        s = wf.foam_score([0.0, 0.05, 0.3, 0.9], [0.0, 0.0, 0.0, 0.0])
        self.assertEqual(s.dtype, np.uint8)
        self.assertEqual(int(s[0]), 1)
        self.assertEqual(int(s[-1]), 255)
        self.assertTrue(np.all(np.diff(s.astype(int)) > 0))


class Lift(unittest.TestCase):
    def test_lift(self):
        pb, pc, lf = wf.lift([10, 0], [20, 20], [0, 0], [30, 30])
        self.assertAlmostEqual(float(pb[0]), (10 + 0.002) / 21)
        self.assertGreater(float(lf[0]), 100)
        self.assertAlmostEqual(float(lf[1]), (0.002 / 21) / (0.002 / 31))

    def test_unseen_calm_is_not_infinite(self):
        pb, pc, lf = wf.lift([5], [10], [0], [0])
        self.assertTrue(np.isfinite(lf).all())


class Validation(unittest.TestCase):
    def test_haversine(self):
        self.assertAlmostEqual(float(wf.haversine_km(-8, 54, -8, 55)), 111.2, delta=0.2)

    def test_recall(self):
        breaks = [{"name": "a", "lon": -8.0, "lat": 54.0}, {"name": "b", "lon": -9.0, "lat": 53.0}]
        cands = [{"id": "x", "lon": -8.005, "lat": 54.0}]
        out = wf.recall(breaks, cands, 1.5)
        self.assertEqual(out[0][1]["id"], "x")
        self.assertIsNone(out[1][1])
        self.assertLess(out[0][2], 0.5)

    def test_breaks_file(self):
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "breaks.json")) as fh:
            doc = json.load(fh)
        for b in doc["breaks"]:
            self.assertIn(b["region"], CFG["regions"])
            w, s, e, n = CFG["regions"][b["region"]]["box"]
            self.assertTrue(w <= b["lon"] <= e and s <= b["lat"] <= n, b["name"])


class Ranking(unittest.TestCase):
    def piece(self, **kw):
        c = {"id": "t-1", "lon": -8.0, "lat": 54.0, "pBig": 0.5, "pCalm": 0.02, "pMid": 0.2, "areaHa": 5,
             "offshoreM": 100}
        c.update(kw)
        return c

    def test_score_is_extra_white_water(self):
        self.assertAlmostEqual(rank.piece_score(self.piece(areaHa=10)), (0.5 - 0.02) * 10)
        self.assertGreater(rank.piece_score(self.piece(areaHa=10)), rank.piece_score(self.piece(areaHa=2)))
        self.assertEqual(rank.piece_score(self.piece(pCalm=0.5)), 0)

    def test_kinds(self):
        self.assertEqual(rank.kind_of(self.piece(), 300), "shore")
        self.assertEqual(rank.kind_of(self.piece(offshoreM=600), 300), "outer")
        self.assertEqual(rank.kind_of(self.piece(offshoreM=600, pMid=0.1), 300), "bigwave")

    def test_places_join_near_pieces(self):
        cs = [self.piece(id="a", score=3.0), self.piece(id="b", lon=-8.01, score=2.0, kind="shore"),
              self.piece(id="c", lon=-8.5, score=1.0, kind="shore")]
        for c in cs:
            c.setdefault("kind", "shore")
        pl = rank.places(cs, 1.5)
        self.assertEqual([p["id"] for p in pl], ["a", "c"])
        self.assertEqual(sorted(pl[0]["pieces"]), ["a", "b"])


class Windows(unittest.TestCase):
    # stamp, class, clean, foamShare, seenShare, hs, tp, dir, wind, windFrom, tileCloud
    LOOKS = [["s1", "big", True, 0.6, 1.0, 3.0, 14, 280, 3, 90, 5],
             ["s2", "big", True, 0.5, 1.0, 2.5, 12, 300, 9, 270, 10],
             ["s3", "mid", True, 0.1, 1.0, 1.4, 9, 200, 6, 200, 20],
             ["s4", "calm", True, 0.0, 1.0, 0.5, 8, 280, 2, 0, 1],
             ["s5", "big", False, 0.9, 1.0, 4.0, 12, 270, 18, 270, 30]]

    def test_window(self):
        w = score.window(self.LOOKS, 270)
        self.assertEqual(w["nLit"], 2)  # s5 lit but not clean
        self.assertEqual(w["nSwell"], 4)
        self.assertEqual(w["bySector"]["W"], [2, 2])
        self.assertEqual(w["bySector"]["S"], [1, 0])
        self.assertEqual(w["litWinds"], {"light": 1, "onshore": 1})
        self.assertEqual(w["lit"]["hs"][0] <= w["lit"]["hs"][1], True)
        self.assertGreater(w["lit"]["powerKw"][1], 0)

    def test_pooled_ring(self):
        counts = {"bad": 0.1, "05_05": [10, 1, 0, 0, 0], "05_06": [10, 1, 5000, 400, 0], "09_09": [1, 1, 9000, 9000, 0]}
        self.assertEqual(score.pooled(counts, "05_05"), [20, 2, 5000, 400, 0])
        self.assertFalse(score.clean(score.pooled(counts, "05_05"), CFG))  # 8% whitecaps next door
        self.assertTrue(score.clean([10, 1, 0, 0, 0], CFG))  # no ring, no cloud: clean

    def test_report_picks_clean_big_and_clear_calm(self):
        fields = ["stamp", "class", "clean", "foamShare", "seenShare", "hs", "tp", "dir", "wind", "windFrom",
                  "tileCloud"]
        big, calm = report.best_looks(self.LOOKS, fields, facing=270)
        self.assertEqual(big[0], "s1")  # light wind beats the bigger onshore look
        self.assertEqual(calm[0], "s4")

    def test_rose(self):
        svg = report.sector_svg({"W": [4, 3], "N": [2, 0]})
        self.assertIn("from W: 3/4", svg)
        self.assertIn("<svg", svg)


@unittest.skipIf(scipy is None, "scipy")
class Enclosed(unittest.TestCase):
    def test_lough_behind_narrows(self):
        import mask
        sea = np.zeros((60, 60), bool)
        sea[:, :20] = True                # the open sea along the west edge
        sea[28:31, 20:30] = True          # a narrows 3 cells wide, 10 long
        sea[15:45, 30:55] = True          # the lough behind it
        shut = mask.enclosed(sea, gap_px=3, keep_px=5)
        self.assertFalse(shut[:, :20].any())        # the open sea is open
        self.assertFalse(shut[29, 20:25].any())     # the mouth is kept
        self.assertTrue(shut[30, 45])               # the lough is enclosed
        self.assertTrue(shut[29, 32])               # and so is the narrows, deep in


if __name__ == "__main__":
    unittest.main()
