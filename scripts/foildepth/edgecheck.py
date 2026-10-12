"""How a foildepth set's water/land edge sits against OpenStreetMap's coastline.

For every tile at each archive's max zoom (regions z13, pilots z14), on the
tile's own grid:

- water = what the archive draws or calls water (a height, an estimate, the
  deep value, an older set's unsurveyed value); land = land and padding;
- OSM = osm.water_mask (sea; shore counted as either);
- in a band within 300 m of OSM's coastline: the share of pixels whose class
  disagrees with OSM, and the area drawn on OSM land / left land in OSM sea;
- the archive's edge pixels' signed distance to OSM's edge (+ landward);
- per tile with enough coast, the shift (-8..8 px each way) that best aligns
  the archive's water with OSM's: a georeferencing offset would show as a
  consistent non-zero shift.

    python -I edgecheck.py <osm dir> <set dir> <out.json> [--compare <old set dir>] [--jobs 6] [--only id,id]

The README's numbers (2026-10) are this, on the set before and after the
mask. Needs what build.py needs.
"""
import io
import json
import math
import multiprocessing as mp
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = None


def init(here):
    global HERE
    HERE = here
    sys.path.insert(0, here)


def decode(data):
    rgb = np.asarray(Image.open(io.BytesIO(data)).convert("RGB")).astype(np.float64)
    return (rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768).astype(np.float32)


def water_of(v, idx):
    pad = idx.get("padMetres", 1e9)
    return (v < idx["landMetres"] - 1) & (v < pad - 0.01)


def tiles_of(path, z):
    from pmtiles.reader import MmapSource, Reader, all_tiles
    with open(path, "rb") as fh:
        r = Reader(MmapSource(fh))
        for (zz, x, y), data in all_tiles(r.get_bytes):
            if zz == z:
                yield x, y, data


def tile_transform(z, x, y, size):
    from rasterio.transform import from_origin
    earth = 2 * math.pi * 6378137.0
    span = earth / 2 ** z
    return from_origin(-earth / 2 + x * span, earth / 2 - y * span, span / size, span / size)


def one(job):
    area_id, z, x, y, data, old_data, osm_dir, idx, size = job
    import osm
    t = tile_transform(z, x, y, size)
    # The mask on the tile and a margin round it (a lagoon joins the sea
    # off the tile), cut back to the tile.
    m = size // 2
    from rasterio.transform import from_origin
    tm = from_origin(t.c - m * t.a, t.f + m * t.a, t.a, t.a)
    sea, shore = osm.water_mask(osm_dir, tm, (size + 2 * m, size + 2 * m))
    sea, shore = sea[m:-m, m:-m], shore[m:-m, m:-m]
    v = decode(data)
    water = water_of(v, idx)
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 0.5) / 2 ** z))))
    mpp = t.a * math.cos(math.radians(lat))
    coast = sea ^ ndimage.binary_erosion(sea, border_value=1)
    if not coast.any():
        return None
    band = ndimage.distance_transform_edt(~coast) * mpp <= 300
    firm = band & ~shore
    res = {"area": area_id, "tile": [z, x, y], "mpp": mpp, "band": int(firm.sum()),
           "disagree": int((firm & (water != sea)).sum()),
           "drawnOnLand": int((water & ~sea & ~shore).sum()),
           "landInSea": int((~water & sea).sum())}
    # Signed distance of the archive's edge to OSM's (+: on OSM's land side).
    edge = water ^ ndimage.binary_erosion(water, border_value=1)
    edge &= band
    d_coast = ndimage.distance_transform_edt(~coast) * mpp
    if edge.any():
        sign = np.where(sea[edge], -1, 1)
        res["edgeDist"] = (sign * d_coast[edge]).astype(np.float32)[::4].round(1).tolist()
    # Best shift.
    if coast.sum() >= 300 and firm.sum() > 2000:
        best, arg = -1, (0, 0)
        core = (slice(8, -8), slice(8, -8))
        for dy in range(-8, 9):
            for dx in range(-8, 9):
                sh = np.roll(np.roll(water, dy, axis=0), dx, axis=1)
                agree = ((sh == sea) & firm)[core].sum()
                if agree > best or (agree == best and abs(dx) + abs(dy) < abs(arg[0]) + abs(arg[1])):
                    best, arg = agree, (dx, dy)
        res["shift"] = [arg[0] * mpp, arg[1] * mpp]
    if old_data is not None:
        ov = decode(old_data)
        ow = water_of(ov, {"landMetres": 50})
        res["changedLandToWater"] = int((~ow & water).sum())
        res["changedWaterToLand"] = int((ow & ~water).sum())
        res["oldDisagree"] = int((firm & (ow != sea)).sum())
    return res


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    osm_dir, set_dir, out = sys.argv[1:4]
    rest = sys.argv[4:]
    old_dir = rest[rest.index("--compare") + 1] if "--compare" in rest else None
    jobs = int(rest[rest.index("--jobs") + 1]) if "--jobs" in rest else 6
    only = rest[rest.index("--only") + 1].split(",") if "--only" in rest else None
    init(here)
    idx = json.load(open(os.path.join(set_dir, "index.json")))
    work = []
    for a in idx["areas"]:
        if only and a["id"] not in only:
            continue
        p = os.path.join(set_dir, a["url"])
        if not os.path.exists(p):
            continue
        old = {}
        if old_dir and os.path.exists(os.path.join(old_dir, a["url"])):
            old = {(x, y): d for x, y, d in tiles_of(os.path.join(old_dir, a["url"]), a["maxzoom"])}
        for x, y, data in tiles_of(p, a["maxzoom"]):
            work.append((a["id"], a["maxzoom"], x, y, data, old.get((x, y)), osm_dir, idx, a["tileSize"]))
    print(f"{len(work)} tiles", flush=True)
    with mp.get_context("spawn").Pool(jobs, initializer=init, initargs=(here,)) as pool:
        results = [r for r in pool.imap_unordered(one, work, chunksize=4) if r]
    per = {}
    for r in results:
        g = per.setdefault(r["area"], {"tiles": 0, "band": 0, "disagree": 0, "drawnOnLandKm2": 0.0, "landInSeaKm2": 0.0,
                                       "edge": [], "shifts": [], "landToWaterKm2": 0.0, "waterToLandKm2": 0.0,
                                       "oldDisagree": 0})
        a2 = r["mpp"] ** 2 / 1e6
        g["tiles"] += 1
        g["band"] += r["band"]
        g["disagree"] += r["disagree"]
        g["drawnOnLandKm2"] += r["drawnOnLand"] * a2
        g["landInSeaKm2"] += r["landInSea"] * a2
        g["edge"] += r.get("edgeDist", [])
        if "shift" in r:
            g["shifts"].append(r["shift"])
        g["landToWaterKm2"] += r.get("changedLandToWater", 0) * a2
        g["waterToLandKm2"] += r.get("changedWaterToLand", 0) * a2
        g["oldDisagree"] += r.get("oldDisagree", 0)
    summary = {}
    allshift, alledge = [], []
    for k, g in sorted(per.items()):
        e = np.array(g["edge"]) if g["edge"] else np.zeros(1)
        s = np.array(g["shifts"]) if g["shifts"] else np.zeros((1, 2))
        allshift += g["shifts"]
        alledge += g["edge"]
        summary[k] = {"tiles": g["tiles"], "disagreeShare": round(g["disagree"] / max(g["band"], 1), 4),
                      "oldDisagreeShare": round(g["oldDisagree"] / max(g["band"], 1), 4) if old_dir else None,
                      "drawnOnLandKm2": round(g["drawnOnLandKm2"], 3), "landInSeaKm2": round(g["landInSeaKm2"], 3),
                      "edgeMetresP10_50_90": [round(float(v), 1) for v in np.percentile(e, [10, 50, 90])],
                      "edgeWithin10m": round(float((np.abs(e) <= 10).mean()), 3),
                      "shiftMedianMetres": [round(float(v), 1) for v in np.median(s, axis=0)],
                      "shiftTiles": len(g["shifts"]),
                      "landToWaterKm2": round(g["landToWaterKm2"], 3), "waterToLandKm2": round(g["waterToLandKm2"], 3)}
    s = np.array(allshift) if allshift else np.zeros((1, 2))
    e = np.array(alledge) if alledge else np.zeros(1)
    tb = sum(g["band"] for g in per.values())
    total = {"tiles": sum(g["tiles"] for g in per.values()),
             "disagreeShare": round(sum(g["disagree"] for g in per.values()) / max(tb, 1), 4),
             "oldDisagreeShare": round(sum(g["oldDisagree"] for g in per.values()) / max(tb, 1), 4) if old_dir else None,
             "drawnOnLandKm2": round(sum(g["drawnOnLandKm2"] for g in per.values()), 2),
             "landInSeaKm2": round(sum(g["landInSeaKm2"] for g in per.values()), 2),
             "edgeMetresP10_50_90": [round(float(v), 1) for v in np.percentile(e, [10, 50, 90])],
             "edgeWithin10m": round(float((np.abs(e) <= 10).mean()), 3),
             "shiftMedianMetres": [round(float(v), 1) for v in np.median(s, axis=0)],
             "shiftP25_75Metres": [[round(float(v), 1) for v in np.percentile(s[:, i], [25, 75])] for i in (0, 1)],
             "shiftZeroShare": round(float((np.abs(s).sum(axis=1) < 1).mean()), 3),
             "shiftTiles": len(allshift),
             "landToWaterKm2": round(sum(g["landToWaterKm2"] for g in per.values()), 2),
             "waterToLandKm2": round(sum(g["waterToLandKm2"] for g in per.values()), 2)}
    json.dump({"total": total, "areas": summary}, open(out, "w"), indent=1)
    print(json.dumps(total, indent=1))


if __name__ == "__main__":
    main()
