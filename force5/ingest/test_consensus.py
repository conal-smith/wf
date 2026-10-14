"""The Python blend replica against the numbers the TypeScript blend produces.

fixtures/blend-consensus.json carries fixed inputs and the values src/ratings.ts
`placeConsensus` computes from them (force5/src/consensusReplica.test.ts checks
that half). If these fail, the site's blend and the one verify.py scores have
drifted apart: bring consensus.py back into line rather than editing `expected`.
"""
import json
import math
from pathlib import Path
import unittest

from consensus import (BLEND_MODELS, LEAD_MODEL, blend_weight, direction,
                       place_consensus, weighted_median)

FIXTURE = json.loads((Path(__file__).with_name("fixtures") / "blend-consensus.json").read_text())


class ReplicaTests(unittest.TestCase):
    def test_every_place_matches_the_typescript_value_for_value(self):
        for spot in FIXTURE["spots"]:
            got = place_consensus(FIXTURE["manifests"], FIXTURE["blendIds"], spot, FIXTURE["axis"])
            for key in ("median", "gust", "from"):
                want = FIXTURE["expected"][spot][key]
                self.assertEqual(len(got[key]), len(want))
                for column, (mine, theirs) in enumerate(zip(got[key], want)):
                    with self.subTest(spot=spot, key=key, column=FIXTURE["axis"][column]):
                        if theirs is None:
                            self.assertIsNone(mine)
                        else:
                            self.assertAlmostEqual(mine, theirs, places=9)

    def test_the_fixture_exercises_the_awkward_cases(self):
        # Columns outside every run, a gap too wide to bridge (GFS from +6 h to +15 h,
        # with nothing else left by +13 h) and a half-hour column between steps: the
        # fixture is only a check if the replica has to get these right.
        median = dict(zip(FIXTURE["axis"], FIXTURE["expected"]["c"]["median"]))
        self.assertIsNone(median["2026-09-13T11:00:00Z"])
        self.assertIsNone(median["2026-09-14T01:00:00Z"])
        self.assertIsNotNone(median["2026-09-14T03:00:00Z"])
        self.assertIsNotNone(median["2026-09-13T13:30:00Z"])

    def test_harmonie_is_the_headline_while_it_reaches_the_hour(self):
        harmonie = next(m for m in FIXTURE["manifests"] if m["model"] == LEAD_MODEL)
        got = place_consensus(FIXTURE["manifests"], FIXTURE["blendIds"], "b", FIXTURE["axis"])
        without = place_consensus(FIXTURE["manifests"],
                                  [m for m in FIXTURE["blendIds"] if m != LEAD_MODEL],
                                  "b", FIXTURE["axis"])
        for point in harmonie["spotForecasts"]["b"]:
            column = FIXTURE["axis"].index(point["validTime"]) \
                if point["validTime"] in FIXTURE["axis"] else None
            if column is None:
                continue
            with self.subTest(time=point["validTime"]):
                self.assertAlmostEqual(got["median"][column], math.hypot(point["u"], point["v"]))
                self.assertAlmostEqual(got["gust"][column], point["gust"])
                self.assertAlmostEqual(got["from"][column], direction(point["u"], point["v"]))
        # Past HARMONIE's last hour the headline is the other models' blend.
        last = FIXTURE["axis"].index(harmonie["spotForecasts"]["b"][-1]["validTime"])
        for column in range(last + 1, len(FIXTURE["axis"])):
            self.assertEqual(got["median"][column], without["median"][column])

    def test_a_harmonie_hour_without_a_gust_takes_the_blends_gust(self):
        # HARMONIE gives no gust at "a" at 14:00: its wind leads, the gust is the blend's.
        got = place_consensus(FIXTURE["manifests"], FIXTURE["blendIds"], "a", FIXTURE["axis"])
        without = place_consensus(FIXTURE["manifests"],
                                  [m for m in FIXTURE["blendIds"] if m != LEAD_MODEL],
                                  "a", FIXTURE["axis"])
        column = FIXTURE["axis"].index("2026-09-13T14:00:00Z")
        self.assertAlmostEqual(got["median"][column], math.hypot(6.85, 4.11))
        self.assertNotAlmostEqual(got["median"][column], without["median"][column])
        self.assertIsNotNone(got["gust"][column])
        self.assertEqual(got["gust"][column], without["gust"][column])

    def test_a_place_harmonie_does_not_reach_is_the_blend(self):
        got = place_consensus(FIXTURE["manifests"], FIXTURE["blendIds"], "c", FIXTURE["axis"])
        without = place_consensus(FIXTURE["manifests"],
                                  [m for m in FIXTURE["blendIds"] if m != LEAD_MODEL],
                                  "c", FIXTURE["axis"])
        self.assertEqual(got, without)

    def test_the_replica_blends_the_models_the_site_does(self):
        self.assertEqual(list(BLEND_MODELS), FIXTURE["blendModels"])


class PieceTests(unittest.TestCase):
    def test_grid_weights(self):
        self.assertEqual([blend_weight(x) for x in (2, 3, 3.01, 6.5, 8, 9, None, float("nan"))],
                         [3, 3, 2, 2, 2, 1, 1, 1])

    def test_weighted_median_takes_the_midpoint_at_exactly_half(self):
        self.assertEqual(weighted_median([1, 3], [1, 1]), 2)
        self.assertEqual(weighted_median([1, 3, 10], [3, 1, 1]), 1)
        self.assertEqual(weighted_median([5, 1, 3], [1, 1, 1]), 3)
        self.assertEqual(weighted_median([1, 3], [2, 2]), 2)

    def test_direction_is_where_the_wind_blows_from(self):
        self.assertAlmostEqual(direction(0, -5), 0)       # Blowing south: from the north.
        self.assertAlmostEqual(direction(-5, 0), 90)      # Blowing west: from the east.
        self.assertAlmostEqual(direction(5, 0), 270)
        self.assertTrue(0 <= direction(1e-9, 5) < 360)
        self.assertFalse(math.isnan(direction(0, 0)))


if __name__ == "__main__":
    unittest.main()
