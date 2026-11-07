"""The faint glow along the coast, where the tidal depth's tiles are not read.

One small picture, made once from the regions' z8 overviews
(coast_glow_tiles.mjs writes them): the shallows and only them, with a hair of
softness at their edge, in one blue, with nothing on the land. It holds
no tide: the map lays it under the marks below the zoom the real layer starts
at (FOIL_MIN_ZOOM, force5/src/foilDepth.ts), for what it costs to show one
image.

    python3 scripts/foildepth/coast_glow.py --tiles .cache/coast-glow

Prints the corners for COAST_GLOW_CORNERS in force5/src/foilDepth.ts.
"""
import argparse
import io
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter

TILE = 512
#: The water's level the shallows are read at, metres above LAT: about half tide.
LEVEL = 2.5
#: Reserved heights are written at and over this, or at the deep marker.
DRY = 6.0
FLOOR = -5.0
DEEP = -20.0
#: Half the overview's pixels are plenty for a soft image.
SCALE = 2
BLUE = (64, 168, 218)
#: The glow past the shallows: its strength, and how far it reaches in z8 pixels,
#: about 300 m each. It stays on the shallows themselves, not out over the sea.
HALO = 0.22
REACH = 3
BANDS = 0.5


def heights(raw: bytes) -> np.ndarray:
    image = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"), dtype=np.float64)
    return image[..., 0] * 256 + image[..., 1] + image[..., 2] / 256 - 32768


def lon_of(px: float, zoom: int) -> float:
    return px / (TILE * 2**zoom) * 360 - 180


def lat_of(py: float, zoom: int) -> float:
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * py / (TILE * 2**zoom)))))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tiles", default=".cache/coast-glow")
    parser.add_argument("--out", default="public/foildepth/coast-glow.webp")
    args = parser.parse_args()

    tiles = []
    for path in Path(args.tiles).glob("*.bin"):
        match = re.search(r"__(\d+)_(\d+)_(\d+)\.bin$", path.name)
        tiles.append((int(match[1]), int(match[2]), int(match[3]), path))
    zoom = tiles[0][0]
    x0, x1 = min(t[1] for t in tiles), max(t[1] for t in tiles)
    y0, y1 = min(t[2] for t in tiles), max(t[2] for t in tiles)
    width, height = (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE

    # The shallowest water any region says each pixel holds; land where a
    # region covers the pixel and none says water.
    bed = np.full((height, width), np.nan)
    land = np.zeros((height, width), dtype=bool)
    water = np.zeros((height, width), dtype=bool)
    for _, x, y, path in tiles:
        z = heights(path.read_bytes())
        left, top = (x - x0) * TILE, (y - y0) * TILE
        wet = (z >= FLOOR) & (z <= DRY)
        deep = z <= DEEP + 1
        slot = (slice(top, top + TILE), slice(left, left + TILE))
        here = bed[slot]
        take = wet & (np.isnan(here) | (z > here))
        here[take] = z[take]
        water[slot] |= wet | deep
        land[slot] |= ~(wet | deep)
    land &= ~water

    shallow = np.where(np.isnan(bed), 0.0, np.clip(1 - (LEVEL - bed) / (LEVEL - FLOOR), 0, 1))
    near = shallow > 0
    sea = ~land
    # On the shallows, a hair soft at their edge, and masked by the sea, so
    # nothing of it is drawn on the land.
    halo = HALO * np.exp(-distance_transform_edt(~near) / REACH)
    bands = BANDS * gaussian_filter(shallow, 2)
    alpha = np.clip(halo + bands, 0, 0.55)
    alpha = gaussian_filter(alpha, 1.5) * gaussian_filter(sea.astype(np.float64), 1.2)
    alpha = alpha[::SCALE, ::SCALE]

    rgba = np.zeros((*alpha.shape, 4), dtype=np.uint8)
    rgba[..., :3] = BLUE
    rgba[..., 3] = np.round(alpha * 255).astype(np.uint8)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(out, quality=60, alpha_quality=55, method=6)

    west, east = lon_of(x0 * TILE, zoom), lon_of((x1 + 1) * TILE, zoom)
    north, south = lat_of(y0 * TILE, zoom), lat_of((y1 + 1) * TILE, zoom)
    print(f"{rgba.shape[1]}x{rgba.shape[0]}, {out.stat().st_size} bytes")
    print(f"[[{west:.5f}, {north:.5f}], [{east:.5f}, {north:.5f}], [{east:.5f}, {south:.5f}], [{west:.5f}, {south:.5f}]]")


if __name__ == "__main__":
    main()
