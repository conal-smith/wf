import math
import unittest

import numpy as np

from rain_chance import KM_PER_DEGREE, RADIUS_KM, WET_MM, chance, neighbourhood

# ICON-EU weather's own crop, 0.0625° from 18°W / 59°N.
ICON = {"west": -18.0, "north": 59.0, "dx": 0.0625, "dy": 0.0625, "width": 321, "height": 177}
# GFS's 0.25° crop of the same box.
GFS = {"west": -18.0, "north": 59.0, "dx": 0.25, "dy": 0.25, "width": 81, "height": 45}
KILCREA = (-6.1755, 53.469)


def centre(grid, index):
    row, column = divmod(int(index), grid["width"])
    return grid["west"] + column * grid["dx"], grid["north"] - row * grid["dy"]


def km(lon, lat, other_lon, other_lat):
    return math.hypot((other_lon - lon) * KM_PER_DEGREE * math.cos(math.radians(lat)),
                      (other_lat - lat) * KM_PER_DEGREE)


class NeighbourhoodTest(unittest.TestCase):
    def test_takes_every_cell_within_the_radius_and_none_beyond(self):
        cells = set(neighbourhood(ICON, *KILCREA).tolist())
        # About 70 ICON-EU cells of some 4 × 7 km at Irish latitudes.
        self.assertTrue(60 <= len(cells) <= 80, len(cells))
        for index in range(ICON["width"] * ICON["height"]):
            lon, lat = centre(ICON, index)
            if abs(lat - KILCREA[1]) > 0.5 or abs(lon - KILCREA[0]) > 0.8:
                continue
            self.assertEqual(index in cells, km(*KILCREA, lon, lat) <= RADIUS_KM, (lon, lat))

    def test_a_coarse_grid_still_has_a_few_cells(self):
        cells = neighbourhood(GFS, *KILCREA)
        self.assertTrue(3 <= len(cells) <= 6, len(cells))

    def test_a_place_off_the_grid_has_none(self):
        self.assertEqual(len(neighbourhood(ICON, -30.0, 53.0)), 0)

    def test_the_grid_edge_cuts_the_circle(self):
        corner = neighbourhood(ICON, -18.0, 59.0)
        self.assertTrue(0 < len(corner) < len(neighbourhood(ICON, *KILCREA)) / 2)


class ChanceTest(unittest.TestCase):
    def test_is_the_share_of_wet_cells_in_whole_per_cent(self):
        precip = np.array([0.0, 0.1, 0.0, 2.4, 0.0, 0.0, 0.05, 0.0])
        self.assertEqual(chance(precip, np.array([0, 1, 2, 3])), 50)
        self.assertEqual(chance(precip, np.array([0, 1, 2])), 33)
        # Under the threshold is dry: the published rain shows 0.0 there.
        self.assertEqual(chance(precip, np.array([6])), 0)
        self.assertEqual(WET_MM, 0.1)

    def test_is_none_without_rain_or_cells(self):
        self.assertIsNone(chance(None, np.array([0, 1])))
        self.assertIsNone(chance(np.zeros(4), np.zeros(0, dtype=int)))

    def test_a_shower_beside_the_spot_is_a_chance_not_a_certainty(self):
        cells = neighbourhood(ICON, *KILCREA)
        precip = np.zeros(ICON["width"] * ICON["height"])
        # Rain over the cells east of the spot only: the spot's own cell is dry.
        for index in cells:
            if centre(ICON, index)[0] > KILCREA[0]:
                precip[index] = 1.2
        self.assertTrue(30 <= chance(precip, cells) <= 70)
        precip[cells] = 0.3
        self.assertEqual(chance(precip, cells), 100)


if __name__ == "__main__":
    unittest.main()
