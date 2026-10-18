"""The e2e suite's fixture region: a small synthetic archive, built as the
national regions are, so the map can be tested with no download.

    python -I fixture.py [out.pmtiles]

Writes e2e/foildepth/tide-galway.pmtiles (and prints its index entry): a box
round Rusheen Bay, z7 to z12, whose bed is a flat 1.0 m above LAT within
4 km of the spot, falling west to the depth cut and rising east to land, so
that at Galway's low water (under 1 m) the spot is dry and at high water
(4.5 m) it has 3.5 m of water. The archive is the national build's own
encoding: Terrarium in lossless WebP, deeper than 5 m under LAT written as
the deep value, the land beside the water padded over Galway's dry ceiling
(6.1 m) as build.pad_land writes it for the map's linear sampling, empty
tiles left out. The spec's index carries the set's `estimateBlue` and
`padMetres`.
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # `python -I` leaves the script's own folder off the path
import build  # noqa: E402
from pmtiles.tile import zxy_to_tileid  # noqa: E402

BOX = [-9.25, 53.2, -9.0, 53.3]
SPOT = (-9.121, 53.251)  # Rusheen, public/spots.json
CFG = {"floorMetres": -5, "deepMetres": -20, "landMetres": 50, "noSurveyMetres": 40}
CEILING = 6.1  # Galway's dry ceiling (stations.json HAT + the margin), as the spec's index says


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "e2e", "foildepth", "tide-galway.pmtiles")
    size, zmin, zmax = 512, 7, 12
    x0, x1, y0, y1 = build.tile_range(BOX, zmax)
    transform, width, height = build.tile_grid(x0, x1, y0, y1, zmax, size)
    xs = transform.c + (np.arange(width) + 0.5) * transform.a
    ys = transform.f - (np.arange(height) + 0.5) * transform.a
    lon, _ = build.lonlat_of(xs, np.zeros_like(xs))
    _, lat = build.lonlat_of(np.zeros_like(ys), ys)
    km_x = (lon[None, :] - SPOT[0]) * 111.32 * math.cos(math.radians(SPOT[1]))
    km_y = (lat[:, None] - SPOT[1]) * 111.32
    r = np.hypot(km_x, km_y)
    # 1 m flat round the spot; west of it the bed falls 3 m a km, east it rises.
    z = np.where(r <= 4.0, 1.0, 1.0 + 3.0 * np.sign(km_x) * (r - 4.0)).astype(np.float32)
    grid = np.where(z > 6.5, CFG["landMetres"], np.where(z < CFG["floorMetres"], CFG["deepMetres"], z))
    inside = ((lon[None, :] >= BOX[0]) & (lon[None, :] <= BOX[2]) & (lat[:, None] >= BOX[1]) & (lat[:, None] <= BOX[3]))
    grid = np.where(inside, grid, CFG["landMetres"]).astype(np.float32)
    grid = (np.round(grid * 32) / 32).astype(np.float32)
    tiles = [(zxy_to_tileid(zz, tx, ty), build.encode(t))
             for zz, tx, ty, t in build.pyramid(grid, (x0, y0, x1, y1), size, zmin, zmax, CFG, CEILING)
             if build.has_content(t, CFG)]
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    mb = build.write_pmtiles(out, tiles, zmin, zmax, BOX,
                             build.archive_metadata("tide-galway (e2e fixture)", CFG, "synthetic"))
    print(f"{out}: {len(tiles)} tiles, {mb * 1000:.0f} kB")
    print(json.dumps({"id": "tide-galway", "kind": "region", "bounds": BOX, "minzoom": zmin, "maxzoom": zmax}))


if __name__ == "__main__":
    main()
