"""The climate build's arithmetic, on made-up series: numpy only, no downloads.

    python -m unittest discover -s scripts/climate -p 'test_*.py'
"""
import os
import sys
import unittest
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import build_climate as b  # noqa: E402

STEP = 3 * 3600


def series(days=365 * 2, start=datetime(2001, 1, 1, tzinfo=timezone.utc)):
    t0 = int(start.timestamp())
    return t0 + np.arange(days * 8) * STEP


class Lasting(unittest.TestCase):
    def test_a_single_reading_is_not_a_swell(self):
        t = np.arange(6) * STEP
        got = b.lasting([False, True, False, True, True, False], t)
        self.assertEqual(got.tolist(), [False, False, False, True, True, False])

    def test_a_gap_in_the_record_breaks_the_run(self):
        t = np.array([0, STEP, 3 * STEP, 4 * STEP])
        self.assertEqual(b.lasting([False, True, True, False], t).tolist(), [False] * 4)

    def test_nothing_flagged(self):
        self.assertFalse(b.lasting([False, False], np.array([0, STEP])).any())


class SwellInBand(unittest.TestCase):
    def test_only_the_partitions_in_the_band_count_added_as_energy(self):
        heights = [np.array([0.6, 0.6, 0.0]), np.array([0.8, 0.8, np.nan])]
        periods = [np.array([10.0, 7.0, 0.0]), np.array([11.0, 11.0, np.nan])]
        got = b.swell_in_band(heights, periods, 9, 12)
        np.testing.assert_allclose(got, [1.0, 0.8, 0.0])


class WaveSummary(unittest.TestCase):
    def test_wind_sea_alone_is_no_swell(self):
        t = series()
        n = len(t)
        hs = np.full(n, 1.5)              # a big, steady sea, all of it wind waves
        tp = np.full(n, 7.0)
        frm = np.full(n, 90.0)
        none = [np.zeros(n), np.zeros(n)]
        w = b.wave_summary(t, hs, tp, frm, none, none)
        self.assertEqual(w["height"][0], [1.5, 1.5, 1.5])
        self.assertTrue(all(c[0] == 0 for row in w["candles"] for c in row))
        self.assertTrue(all(v == 0 for size in w["swell"] for row in size for v in row))

    def test_a_lasting_swell_is_counted_and_sized_by_its_own_height(self):
        t = series()
        n = len(t)
        hs = np.full(n, 2.0)
        tp = np.full(n, 8.0)
        frm = np.full(n, 270.0)
        sw1 = np.zeros(n)
        tm1 = np.zeros(n)
        # One January day in each year with an 11 s swell of 0.9 m all day.
        for year in (2001, 2002):
            day0 = int(datetime(year, 1, 10, tzinfo=timezone.utc).timestamp())
            k = (t >= day0) & (t < day0 + 86400)
            sw1[k], tm1[k] = 0.9, 11.0
        # And a single reading of it in February: gone by the next, so no day.
        lone = int(np.searchsorted(t, int(datetime(2001, 2, 10, tzinfo=timezone.utc).timestamp())))
        sw1[lone], tm1[lone] = 1.5, 11.0
        w = b.wave_summary(t, hs, tp, frm, [sw1, np.zeros(n)], [tm1, np.zeros(n)])
        mid = w["candles"][1]                       # 9 to 12 s
        self.assertEqual(mid[0][0], 1.0)            # a day a January
        self.assertEqual(mid[1][0], 0.0)            # none in February
        self.assertEqual(w["swell"][1][1][0], 1.0)  # sized 0.6 to 1.2 m
        self.assertEqual(w["swell"][2][1][0], 0.0)
        self.assertEqual(w["candles"][0][0][0], 0.0)  # and no 6 to 9 s swell for the 8 s wind sea


class Overrides(unittest.TestCase):
    def test_no_spot_is_both_sheltered_and_open(self):
        self.assertFalse(set(b.SHELTERED) & set(b.OPEN))

    def test_every_named_spot_is_a_spot(self):
        import json
        path = os.path.join(os.path.dirname(__file__), "..", "..", "public", "riding-locations.json")
        ids = {s["id"] for s in json.load(open(path))}
        self.assertEqual(set(b.SHELTERED) - ids, set())
        self.assertEqual(set(b.OPEN) - ids, set())


if __name__ == "__main__":
    unittest.main()
