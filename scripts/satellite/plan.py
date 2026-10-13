"""Which tile reads what: blocks, stations, tide thresholds.

The Sentinel-2 tiles overlap (about 10 km between neighbours, more across the
UTM zone line), so every point is given to the tiles round it by weight: 1
well inside the nearest tile's share (the tiles' centres' Voronoi cells),
falling to 0 over coarse.tileBlendKm either side of the line between two
shares, and to 0 towards a tile's own edge. A tile reads only its 512-pixel
blocks (the COGs' own) where its weight is above 0 and the coverage is: every
acquisition in the coastal zone, the summer scenes over all of it.

Each station's tide thresholds are the low and high percentiles of its levels
at the acquisitions of the tiles it is in: a look is "low tide" for a pixel
if its station's level was in the bottom composite.lowPercentile then.

Writes <root>/work/plan.json.

    python -I plan.py
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

TILE_PX = 10980


def footprints():
    """Each tile's EPSG and 10 m bounds, from catalog.py's lists."""
    d = common.path("downloads", "catalog")
    out = {}
    for f in sorted(os.listdir(d)):
        if f.endswith(".json") and len(f) == 10:
            c = common.read_json(os.path.join(d, f))
            out[c["tile"]] = {"epsg": int(c["epsg"]), "bbox": c["bbox10"]}
    return out


class Ownership:
    """Tile weights at any points given in one CRS."""

    def __init__(self, fps, cfg, crs=None):
        from pyproj import Transformer
        crs = crs or cfg["coarse"]["crs"]
        self.fps = fps
        self.names = sorted(fps)
        self.blend = cfg["coarse"]["tileBlendKm"] * 1000
        self.margin = cfg["coarse"]["tileMarginKm"] * 1000
        self.to = {}
        for e in {fp["epsg"] for fp in fps.values()}:
            self.to[e] = Transformer.from_crs(crs, f"EPSG:{e}", always_xy=True)
        back = {e: Transformer.from_crs(f"EPSG:{e}", crs, always_xy=True) for e in self.to}
        self.centre = {}
        for t, fp in fps.items():
            l, b, r, tp = fp["bbox"]
            self.centre[t] = back[fp["epsg"]].transform((l + r) / 2, (b + tp) / 2)

    def weights(self, x, y):
        """{tile: weight array} for the tiles with any weight at these points; they sum to 1 where any does."""
        x, y = np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64)
        proj = {e: tr.transform(x, y) for e, tr in self.to.items()}
        raw, dist = {}, {}
        for t in self.names:
            fp = self.fps[t]
            ux, uy = proj[fp["epsg"]]
            l, b, r, tp = fp["bbox"]
            edge = np.minimum.reduce([ux - l, r - ux, uy - b, tp - uy]) - self.margin
            if not (edge > 0).any():
                continue
            cx, cy = self.centre[t]
            dist[t] = np.where(edge > 0, np.hypot(x - cx, y - cy), np.inf)
            raw[t] = np.clip(edge / (2 * self.blend), 0, 1)
        if not dist:
            return {}
        dmin = np.minimum.reduce(list(dist.values()))
        w = {t: np.where(np.isfinite(dist[t]), raw[t] * np.clip(1 - (dist[t] - np.where(np.isfinite(dmin), dmin, 0))
                                                                 / (2 * self.blend), 0, 1), 0) for t in dist}
        total = np.maximum(sum(w.values()), 1e-9)
        return {t: (v / total).astype(np.float32) for t, v in w.items() if (v > 0).any()}


def block_grid(fp, size):
    """(row, col) of every block, and the block's 10 m transform."""
    from rasterio.transform import from_origin
    l, b, r, t = fp["bbox"]
    n = -(-TILE_PX // size)
    return [(i, j) for i in range(n) for j in range(n)], lambda i, j: from_origin(l + j * size * 10, t - i * size * 10, 10, 10)


def sample_points(fp, i, j, size, step=8):
    """Points every `step` pixels over block (i, j), in the tile's CRS (inside the tile only)."""
    l, b, r, t = fp["bbox"]
    cols = np.arange(j * size, min((j + 1) * size, TILE_PX), step) + step / 2
    rows = np.arange(i * size, min((i + 1) * size, TILE_PX), step) + step / 2
    xx, yy = np.meshgrid(l + cols * 10, t - rows * 10)
    return xx, yy


def main():
    import rasterio
    from pyproj import Transformer
    cfg = common.config()
    size = cfg["blockSize"]
    fps = footprints()
    own = Ownership(fps, cfg)
    stations = common.stations()
    max_km = cfg["intertidalArchive"]["maxStationKm"]
    with rasterio.open(common.path("work", "coarse.tif")) as src:
        coverage, coastal = src.read(1) > 0, src.read(2) > 0
        inv = ~src.transform
    plan = {"blockSize": size, "tiles": {}, "stations": {}}
    tide_doc = common.read_json(common.path("work", "tides", "scenes.json"))["levels"]
    to_wgs = {}
    station_tiles = {}
    for tile, fp in sorted(fps.items()):
        to_itm = Transformer.from_crs(f"EPSG:{fp['epsg']}", cfg["coarse"]["crs"], always_xy=True)
        to_wgs[tile] = Transformer.from_crs(f"EPSG:{fp['epsg']}", 4326, always_xy=True)
        blocks, _ = block_grid(fp, size)
        cblocks, vblocks, sts = [], [], set()
        for i, j in blocks:
            xx, yy = sample_points(fp, i, j, size)
            ix, iy = to_itm.transform(xx, yy)
            w = own.weights(ix, iy).get(tile)
            if w is None:
                continue
            c, r = inv * (ix, iy)
            r, c = np.floor(r).astype(int), np.floor(c).astype(int)
            ok = (r >= 0) & (r < coverage.shape[0]) & (c >= 0) & (c < coverage.shape[1])
            r, c = np.clip(r, 0, coverage.shape[0] - 1), np.clip(c, 0, coverage.shape[1] - 1)
            mine = (w > 0) & ok
            if (mine & coverage[r, c]).any():
                vblocks.append([i, j])
            if (mine & coastal[r, c]).any():
                cblocks.append([i, j])
                lon, lat = to_wgs[tile].transform(xx[mine & coastal[r, c]], yy[mine & coastal[r, c]])
                wts = common.station_weights(lon, lat, stations, max_km, cfg["composite"]["stationBlendKm"])
                sts |= {stations[k]["id"] for k in np.flatnonzero((wts > 0).any(axis=1))}
                sts |= {stations[k]["id"] for k in np.unique(common.nearest_station(lon, lat, stations, max_km))}
        if not vblocks:
            continue
        plan["tiles"][tile] = {"epsg": fp["epsg"], "bbox": fp["bbox"], "coastalBlocks": cblocks,
                               "coverageBlocks": vblocks, "stations": sorted(sts)}
        for s in sts:
            station_tiles.setdefault(s, []).append(tile)
        print(f"{tile}: {len(cblocks)} coastal and {len(vblocks)} coverage blocks, stations {sorted(sts)}", flush=True)
    # Each station's thresholds, over the acquisitions of its tiles.
    cats = {t: common.read_json(common.path("downloads", "catalog", f"{t}.json")) for t in plan["tiles"]}
    lo_p, hi_p = cfg["composite"]["lowPercentile"], cfg["composite"]["highPercentile"]
    for s, tiles in sorted(station_tiles.items()):
        stamps = {it["stamp"] for t in tiles for it in cats[t]["items"]}
        lv = np.array([tide_doc[s][k][0] for k in stamps if k in tide_doc[s]])
        plan["stations"][s] = {"tiles": tiles, "acquisitions": int(len(lv)),
                               "low": round(float(np.percentile(lv, lo_p)), 3),
                               "high": round(float(np.percentile(lv, hi_p)), 3),
                               "range": [round(float(lv.min()), 3), round(float(lv.max()), 3)]}
        print(f"{s}: {plan['stations'][s]}", flush=True)
    total_c = sum(len(t["coastalBlocks"]) for t in plan["tiles"].values())
    total_v = sum(len(t["coverageBlocks"]) for t in plan["tiles"].values())
    print(f"{len(plan['tiles'])} tiles, {total_c} coastal blocks, {total_v} coverage blocks")
    common.write_json(common.path("work", "plan.json"), plan)


if __name__ == "__main__":
    sys.exit(main())
