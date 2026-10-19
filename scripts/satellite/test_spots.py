"""Unit tests for the spot pictures (spots.py) and their publishing.

    python -m unittest discover -s scripts/satellite -p 'test_*.py'
"""
import io
import json
import math
import os
import sys
import tempfile
import unittest

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import publish  # noqa: E402
import spots  # noqa: E402

AREA = {"id": "ireland", "maxzoom": 13, "tileSize": 512, "bounds": [-11, 51, -5, 56],
        "cover": [[-11, 51, -8, 53]]}
# A corner shared by four of the archive's deepest tiles (z13 at 512 px).
X, Y = 3870, 2680
LON = X / 2 ** 13 * 360 - 180
LAT = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * Y / 2 ** 13))))
QUARTERS = {(X - 1, Y - 1): (255, 0, 0), (X, Y - 1): (0, 0, 255),
            (X - 1, Y): (0, 255, 0), (X, Y): (255, 255, 0)}


def png(colour, alpha=255):
    buf = io.BytesIO()
    Image.new("RGBA", (512, 512), colour + (alpha,)).save(buf, "PNG")
    return buf.getvalue()


class GeometryTest(unittest.TestCase):
    def test_world_pixels(self):
        self.assertEqual(spots.world_px(0, 0, 0), (128, 128))
        x, y = spots.world_px(LON, LAT, 14)
        self.assertAlmostEqual(x, X * 512, places=4)
        self.assertAlmostEqual(y, Y * 512, places=4)

    def test_native_zoom(self):
        self.assertEqual(spots.native_zoom(AREA), 14)
        self.assertEqual(spots.native_zoom(dict(AREA, tileSize=256)), 13)

    def test_window_is_centred_and_scaled(self):
        x0, y0, x1, y1 = spots.window(LON, LAT, 14.5, 1200, 600, 14)
        self.assertAlmostEqual((x0 + x1) / 2, X * 512, places=4)
        self.assertAlmostEqual((y0 + y1) / 2, Y * 512, places=4)
        # Half a zoom closer: the picture covers 1/√2 of its size in the archive's pixels.
        self.assertAlmostEqual(x1 - x0, 1200 / math.sqrt(2), places=6)

    def test_tiles_under_a_box(self):
        self.assertEqual(spots.tiles_for((500, 10, 530, 20), 512), [(0, 0), (1, 0)])
        self.assertEqual(spots.tiles_for((10, 500, 20, 1100), 512), [(0, 0), (0, 1), (0, 2)])

    def test_area_by_cover_then_bounds(self):
        self.assertEqual(spots.area_for([AREA], -9, 52)["id"], "ireland")
        # In the box but not the cover: Great Britain's box holds Dublin, its cover does not.
        self.assertIsNone(spots.area_for([AREA], -6, 54))
        self.assertEqual(spots.area_for([dict(AREA, cover=None)], -6, 54)["id"], "ireland")


class PictureTest(unittest.TestCase):
    def test_centred_on_the_place(self):
        tiles = {k: png(c) for k, c in QUARTERS.items()}
        image, cover = spots.picture(lambda z, x, y: tiles.get((x, y)), AREA, LON, LAT, 14, 200, 100)
        self.assertEqual(image.size, (200, 100))
        self.assertEqual(cover, 1)
        self.assertEqual(image.getpixel((97, 47)), (255, 0, 0))
        self.assertEqual(image.getpixel((102, 47)), (0, 0, 255))
        self.assertEqual(image.getpixel((97, 52)), (0, 255, 0))
        self.assertEqual(image.getpixel((102, 52)), (255, 255, 0))

    def test_no_image_is_paper(self):
        image, cover = spots.picture(lambda z, x, y: None, AREA, LON, LAT, 14.5, 120, 60)
        self.assertEqual(cover, 0)
        self.assertEqual(image.getpixel((60, 30)), spots.PAPER)

    def test_the_fading_sea_edge_is_laid_on_paper(self):
        tiles = {k: png((0, 0, 0), alpha=0) for k in QUARTERS}
        tiles[(X, Y)] = png((0, 0, 0), alpha=128)
        image, cover = spots.picture(lambda z, x, y: tiles.get((x, y)), AREA, LON, LAT, 14, 200, 100)
        self.assertAlmostEqual(cover, 0.25 * 128 / 255, places=2)
        self.assertEqual(image.getpixel((10, 10)), spots.PAPER)
        r, g, b = image.getpixel((190, 90))
        self.assertTrue(abs(r - 0xF3 / 2) < 3 and abs(b - 0xE3 / 2) < 3)


class PublishTest(unittest.TestCase):
    def write_set(self, folder, names):
        entries = []
        for place in names:
            entry = {"id": place, "lonLat": [-6, 53]}
            for tide in ("high", "low"):
                entry[tide] = f"{place}-{tide}.webp"
                Image.new("RGB", (4, 2)).save(os.path.join(folder, entry[tide]), "WEBP")
            entries.append(entry)
        with open(os.path.join(folder, "spots.json"), "w") as fh:
            json.dump({"schemaVersion": 1, "kind": "satellite-spots", "spots": entries}, fh)

    def test_set_versioned_by_its_pictures(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.write_set(tmp, ["portrane", "brandon"])
            index, files = publish.spots_set(tmp)
            self.assertEqual(sorted(files), ["brandon-high.webp", "brandon-low.webp",
                                             "portrane-high.webp", "portrane-low.webp"])
            base = f"satellite/{publish.version_of(files)}/"
            site = os.path.join(tmp, "site", "spots.json")
            publish.write_site_spots(site, index, base)
            written = json.load(open(site))
            self.assertEqual(written["base"], base)
            self.assertEqual([s["id"] for s in written["spots"]], ["portrane", "brandon"])

    def test_a_missing_picture_stops_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.write_set(tmp, ["portrane"])
            os.remove(os.path.join(tmp, "portrane-low.webp"))
            with self.assertRaises(SystemExit):
                publish.spots_set(tmp)

    def test_a_name_outside_the_folder_stops_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.write_set(tmp, ["portrane"])
            doc = json.load(open(os.path.join(tmp, "spots.json")))
            doc["spots"][0]["high"] = "../index.json"
            json.dump(doc, open(os.path.join(tmp, "spots.json"), "w"))
            with self.assertRaises(SystemExit):
                publish.spots_set(tmp)


if __name__ == "__main__":
    unittest.main()
