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
                mb = build.write_archive(g, (8000, 5000, 8001, 5000), size, 13, 14, land,
                                         [-6.2, 53.3, -6.1, 53.4], os.path.join(d, f"{name}.pmtiles"),
                                         name, -6, "test")
                self.assertGreater(mb, 0)
            from pmtiles.reader import MmapSource, Reader
            from PIL import Image
            import io

            def height(name, x):
                with open(os.path.join(d, f"{name}.pmtiles"), "rb") as fh:
                    img = np.asarray(Image.open(io.BytesIO(Reader(MmapSource(fh)).get(14, x, 5000))).convert("RGB"))
                r, g, b = img[0, 0].astype(float)
                return r * 256 + g + b / 256 - 32768

            self.assertEqual(height("area", 8000), -2.0)
            self.assertEqual(height("area", 8001), land)
            self.assertEqual(height("basin", 8000), land)
            self.assertEqual(height("basin", 8001), -2.0)


if __name__ == "__main__":
    unittest.main()
