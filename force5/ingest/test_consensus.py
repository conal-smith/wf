"""The Python replica against the hours the TypeScript rates its stars from.

fixtures/blend-consensus.json carries fixed inputs and the values src/ratings.ts
`placeConsensus` computes from them for each choice of models in `leads`
(force5/src/consensusReplica.test.ts checks that half). If these fail, the site's
rule and the one verify.py scores have drifted apart: bring consensus.py back into
line rather than editing `expected`.
"""
import json
import math
from pathlib import Path
import unittest

from consensus import (BLEND_MODELS, STARS_FROM, direction, lead_order,
                       place_consensus)

FIXTURE = json.loads((Path(__file__).with_name("fixtures") / "blend-consensus.json").read_text())
AXIS = FIXTURE["axis"]


def manifest(model):
    return next(m for m in FIXTURE["manifests"] if m["model"] == model)


def consensus(spot, stars_from=STARS_FROM, blend_ids=None):
    return place_consensus(FIXTURE["manifests"], FIXTURE["blendIds"] if blend_ids is None else blend_ids,
                           spot, AXIS, tuple(stars_from))


class ReplicaTests(unittest.TestCase):
    def test_every_choice_and_place_matches_the_typescript_value_for_value(self):
        for model, then in FIXTURE["leads"]:
            for spot in FIXTURE["spots"]:
                got = consensus(spot, (model, then))
                want = FIXTURE["expected"][f"{model}>{then}"][spot]
                self.assertEqual(got["model"], want["model"], (model, then, spot))
                for key in ("median", "gust", "from"):
                    self.assertEqual(len(got[key]), len(want[key]))
                    for column, (mine, theirs) in enumerate(zip(got[key], want[key])):
                        with self.subTest(lead=(model, then), spot=spot, key=key, column=AXIS[column]):
                            if theirs is None:
                                self.assertIsNone(mine)
                            else:
                                self.assertAlmostEqual(mine, theirs, places=9)

    def test_the_fixture_exercises_the_awkward_cases(self):
        # A column before every run, a half-hour column between steps, and ECMWF's
        # gap from 00:00 to 09:00 that is too wide to bridge.
        default = FIXTURE["expected"]["harmonie>ecmwf"]["a"]["median"]
        at = dict(zip(AXIS, default))
        self.assertIsNone(at["2026-09-13T11:00:00Z"])
        self.assertIsNotNone(at["2026-09-13T13:30:00Z"])
        self.assertIsNone(at["2026-09-14T02:00:00Z"])

    def test_the_default_is_harmonie_then_ecmwf(self):
        self.assertEqual(STARS_FROM, ("harmonie", "ecmwf"))
        self.assertEqual(lead_order(("gfs", "gfs")), ["gfs"])


class OneModelTests(unittest.TestCase):
    def test_harmonie_rates_every_hour_it_reaches_with_its_own_figures(self):
        got = consensus("b")
        for point in manifest("harmonie")["spotForecasts"]["b"]:
            column = AXIS.index(point["validTime"])
            with self.subTest(time=point["validTime"]):
                self.assertEqual(got["model"][column], "harmonie")
                self.assertAlmostEqual(got["median"][column], math.hypot(point["u"], point["v"]))
                self.assertAlmostEqual(got["gust"][column], point["gust"])
                self.assertAlmostEqual(got["from"][column], direction(point["u"], point["v"]))

    def test_past_harmonie_ecmwf_alone_takes_over(self):
        got = consensus("a")
        column = AXIS.index("2026-09-13T21:00:00Z")
        self.assertEqual(got["model"][column], "ecmwf")
        self.assertAlmostEqual(got["median"][column], math.hypot(3.1, -1.8))
        self.assertAlmostEqual(got["gust"][column], 7.0)
        # Between its steps, ECMWF interpolated, no other model mixed in.
        between = AXIS.index("2026-09-13T19:00:00Z")
        self.assertEqual(got["model"][between], "ecmwf")
        self.assertAlmostEqual(got["median"][between],
                               math.hypot(4.4 + (3.1 - 4.4) / 3, 0.9 + (-1.8 - 0.9) / 3))

    def test_no_other_model_fills_an_hour_neither_reaches(self):
        # GFS has 03:00, but the stars come from HARMONIE then ECMWF, and neither has it.
        got = consensus("a")
        column = AXIS.index("2026-09-14T03:00:00Z")
        self.assertIsNone(got["median"][column])
        self.assertIsNone(got["model"][column])
        chosen = consensus("a", ("gfs", "ecmwf"))
        self.assertEqual(chosen["model"][column], "gfs")

    def test_a_model_without_a_gust_gives_none(self):
        # HARMONIE gives no gust at "a" at 14:00: the hour stays HARMONIE's, gustless.
        got = consensus("a")
        column = AXIS.index("2026-09-13T14:00:00Z")
        self.assertEqual(got["model"][column], "harmonie")
        self.assertAlmostEqual(got["median"][column], math.hypot(6.85, 4.11))
        self.assertIsNone(got["gust"][column])

    def test_the_blend_models_never_move_the_hours(self):
        self.assertEqual(consensus("b"), consensus("b", blend_ids=["gfs"]))

    def test_a_place_harmonie_does_not_reach_is_ecmwf_from_the_start(self):
        got = consensus("c")
        self.assertEqual(got["model"][AXIS.index("2026-09-13T12:00:00Z")], "ecmwf")
        # Too light to have a direction.
        self.assertIsNone(got["from"][AXIS.index("2026-09-13T18:00:00Z")])

    def test_the_replica_reads_the_models_the_site_does(self):
        self.assertEqual(list(BLEND_MODELS), FIXTURE["blendModels"])


class PieceTests(unittest.TestCase):
    def test_direction_is_where_the_wind_blows_from(self):
        self.assertAlmostEqual(direction(0, -5), 0)       # Blowing south: from the north.
        self.assertAlmostEqual(direction(-5, 0), 90)      # Blowing west: from the east.
        self.assertAlmostEqual(direction(5, 0), 270)
        self.assertTrue(0 <= direction(1e-9, 5) < 360)
        self.assertFalse(math.isnan(direction(0, 0)))


if __name__ == "__main__":
    unittest.main()
