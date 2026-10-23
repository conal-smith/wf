"""Read one Sentinel-2 tile's looks over the search mask, and keep the foam.

Per tile (the satellite run's plan: its coastal 512-pixel blocks, and each
point given to the tile with the most weight there, so the tiles' overlaps
are read once):

1. **Masks** (once): each coastal block's 10 m pixels in the search mask
   (mask.py) and the offshore ring, sampled from the 100 m grid; blocks with
   no searched pixel are not read. Each block takes the sea-state point
   nearest its searched pixels.
2. **Looks**: every acquisition with tile cloud under select.maxTileCloud
   where some block's point had Hs >= seaState.readHs, and the
   select.calmLooks least cloudy calm ones (every point Hs <= calmHs, wind
   <= calmWind).
3. **Reading** each look: the whole SCL (20 m, 3 MB); a look whose searched
   pixels are more than select.maxBadShare no data, cloud, shadow or cirrus
   stops there. Else B02, B03, B04, B08 (10 m) and B11 (20 m) over the
   blocks, and per searched pixel one byte: 0 unusable, 1 clear water or
   shore with no foam, 2-255 foam (wf.foam; the value is wf.foam_score).
   Unusable: SCL no data or saturated; SCL's cloud, shadow, cirrus or snow
   unless the pixel passes the foam test (SCL often calls surf cloud); and
   anything cloud-like in B11 (wf.cloud_like); and SCL's snow on land (snow
   is white and dark in B11, like foam: winter's big-swell days brought it
   onto the dunes behind Rossnowlagh). Per block it also counts the
   offshore ring's clear and foam pixels (whitecaps, haze) and its SCL cloud.

Writes <root>/<region>/work/looks/<tile>.json (the masks' blocks and points,
and the looks chosen with their sea state), <root>/<region>/s2/<tile>/masks.npz,
<root>/<region>/s2/<tile>/<stamp>.npz (a member per block) and log.jsonl (per
look: status, and per block [searched clear, searched foam, ring clear, ring
foam, ring SCL cloud]). Resumable: a look in the log is not read again.

    python -I read.py --region ireland --tile 29UNA [--tile ...] [--workers 16]
"""
import argparse
import concurrent.futures as cf
import json
import os
import sys
import threading
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import wf  # noqa: E402

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "6")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "3")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
os.environ.setdefault("GDAL_CACHEMAX", "512")
os.environ.setdefault("VSI_CACHE", "FALSE")

LOCK = threading.Lock()
SCL_HARD = (0, 1)
SCL_SOFT = (3, 8, 9, 10, 11)
SCL_CLOUDISH = (0, 1, 3, 8, 9, 10)
SEARCHED, RING, LAND = 1, 2, 4


def tile_masks(tile, pt, size):
    """{block 'ii_jj': uint8 (size, size) of SEARCHED | RING | LAND} over the blocks with a
    searched pixel this tile owns, and each such block's searched pixels' centre (lon, lat)."""
    import rasterio
    from pyproj import Transformer
    common = wf.satellite()
    from plan import Ownership, footprints
    cfg = common.config()
    own = Ownership(footprints(), cfg)
    with rasterio.open(wf.rpath("work", "search.tif")) as src:
        flags = src.read(1).astype(np.uint8)
        inv, crs = ~src.transform, src.crs
    with rasterio.open(common.path("work", "coarse.tif")) as src:
        flags |= np.where(src.read(3) > 0, 0, 16).astype(np.uint8)  # land on the 100 m grid
    to_grid = Transformer.from_crs(f"EPSG:{pt['epsg']}", crs, always_xy=True)
    to_own = Transformer.from_crs(f"EPSG:{pt['epsg']}", cfg["coarse"]["crs"], always_xy=True)
    to_wgs = Transformer.from_crs(f"EPSG:{pt['epsg']}", 4326, always_xy=True)
    l, b, r, t = pt["bbox"]
    masks, centres = {}, {}
    for i, j in pt["coastalBlocks"]:
        # The grid's flags at 20 m (each 100 m cell is 5 x 5 of them), then 10 m.
        step = 2
        cc = np.arange(j * size, (j + 1) * size, step) + step / 2
        rr = np.arange(i * size, (i + 1) * size, step) + step / 2
        xx, yy = np.meshgrid(l + cc * 10, t - rr * 10)
        gx, gy = to_grid.transform(xx, yy)
        c, rw = inv * (gx, gy)
        rw, c = np.floor(rw).astype(np.int64), np.floor(c).astype(np.int64)
        ok = (rw >= 0) & (rw < flags.shape[0]) & (c >= 0) & (c < flags.shape[1])
        f = np.zeros(xx.shape, np.uint8)
        f[ok] = flags[rw[ok], c[ok]]
        m = np.where(f & 1, SEARCHED, 0) | np.where(f & 8, RING, 0) | np.where(f & 16, LAND, 0)
        if not (m & SEARCHED).any():
            continue
        # This tile's share: where its weight is the largest (8 x 8 pixels at a time).
        ox, oy = to_own.transform(xx[::4, ::4], yy[::4, ::4])
        w = own.weights(ox, oy)
        mine = w.get(tile)
        if mine is None:
            continue
        best = np.maximum.reduce(list(w.values()))
        owned = np.repeat(np.repeat(mine >= best - 1e-6, 4, 0), 4, 1)[:m.shape[0], :m.shape[1]] & (mine.max() > 0)
        m = np.where(owned, m, 0).astype(np.uint8)
        if not (m & SEARCHED).any():
            continue
        m10 = np.repeat(np.repeat(m, step, 0), step, 1)
        key = f"{i:02d}_{j:02d}"
        masks[key] = m10
        sr, sc_ = np.nonzero(m & SEARCHED)
        lon, lat = to_wgs.transform(float(xx[sr, sc_].mean()), float(yy[sr, sc_].mean()))
        centres[key] = [round(lon, 5), round(lat, 5)]
    return masks, centres


def nearest_point(lon, lat, points):
    d = [float(wf.haversine_km(lon, lat, p["lon"], p["lat"])) for p in points]
    return points[int(np.argmin(d))]["id"]


def choose(items, seastate, block_points, cfg):
    """The looks to read: [(stamp, why)], why 'swell' or 'calm'."""
    s, sel = cfg["seaState"], cfg["select"]
    pids = sorted(set(block_points.values()))
    swell, calm = [], []
    for it in items:
        st = it["stamp"]
        ss = seastate.get(st)
        if ss is None or (it["cloud"] or 100) > sel["maxTileCloud"] or (it["nodata"] or 0) > 90:
            continue
        vals = [ss[p] for p in pids if ss.get(p) and None not in ss[p]]
        if not vals:
            continue
        if max(v[0] for v in vals) >= s["readHs"]:
            swell.append((st, "swell"))
        elif all(v[0] <= s["calmHs"] and v[3] <= s["calmWind"] for v in vals):
            calm.append((it["cloud"] or 0, st))
    calm = [(st, "calm") for _, st in sorted(calm)[:sel["calmLooks"] * 3]]
    return swell, calm


def read_look(item, masks, size, max_bad):
    """(status, {block: counts}, {block: codes})."""
    from rasterio.windows import Window  # noqa: F401  (Scene.read uses it)
    wf.satellite()
    from fetch import Scene, row_runs
    sc = Scene(item)
    try:
        scl = sc.read("SCL", (0, 0, 5490, 5490), size)
        half = size // 2
        tot = bad = 0
        for key, m in masks.items():
            i, j = int(key[:2]), int(key[3:])
            s20 = scl[i * half:(i + 1) * half, j * half:(j + 1) * half]
            ms = (m[::2, ::2] & SEARCHED) > 0
            ms = ms[:s20.shape[0], :s20.shape[1]]
            tot += int(ms.sum())
            bad += int((np.isin(s20, SCL_CLOUDISH) & ms).sum())
        share = bad / max(tot, 1)
        if share > max_bad:
            return "cloudy", {"bad": round(share, 3)}, {}
        counts, codes = {"bad": round(share, 3)}, {}
        blocks = [(int(k[:2]), int(k[3:])) for k in masks]
        for i, runs in sorted(row_runs(blocks).items()):
            for j0, j1 in runs:
                win = (i * size, j0 * size, size, (j1 - j0 + 1) * size)
                win20 = (i * half, j0 * half, half, (j1 - j0 + 1) * half)
                b = {bd: sc.read(bd, win, size) for bd in ("B02", "B03", "B04", "B08")}
                w = b["B03"].shape[1]
                b11 = sc.read("B11", win20, half)
                b["B11"] = np.repeat(np.repeat(b11, 2, 0), 2, 1)[:size, :w]
                s20 = np.zeros((half, w // 2), np.uint8)
                part = scl[i * half:(i + 1) * half, j0 * half:(j1 + 1) * half]
                s20[:part.shape[0], :part.shape[1]] = part
                s10 = np.repeat(np.repeat(s20, 2, 0), 2, 1)[:size, :w]
                f = wf.foam(b["B02"], b["B03"], b["B04"], b["B08"], b["B11"], CFG["foam"])
                hard = np.isin(s10, SCL_HARD) | (b["B03"] <= 0) | (b["B08"] <= 0) | (b["B11"] <= 0)
                soft = np.isin(s10, SCL_SOFT)
                unusable = hard | (soft & ~f) | wf.cloud_like(b["B03"], b["B11"], CFG["foam"])
                # Snow is white and dark in B11 too: on the land side of the band, SCL's snow
                # is not foam.
                land = np.concatenate([(masks[f"{i:02d}_{j:02d}"] & LAND) > 0 for j in range(j0, j1 + 1)], axis=1)
                unusable |= (s10 == 11) & land
                score = np.maximum(wf.foam_score(b["B03"], b["B11"]), 2)
                code = np.where(unusable, 0, np.where(f, score, 1)).astype(np.uint8)
                cloud = np.isin(s10, (8, 9, 10))
                for k, j in enumerate(range(j0, j1 + 1)):
                    key = f"{i:02d}_{j:02d}"
                    sl = slice(k * size, (k + 1) * size)
                    m = masks[key]
                    c = code[:, sl]
                    ms, mr = (m & SEARCHED) > 0, (m & RING) > 0
                    counts[key] = [int(((c > 0) & ms).sum()), int(((c >= 2) & ms).sum()),
                                   int(((c > 0) & mr).sum()), int(((c >= 2) & mr).sum()),
                                   int((cloud[:, sl] & mr).sum())]
                    codes[key] = np.where(ms, c, 0).astype(np.uint8)
        return "kept", counts, codes
    finally:
        sc.close()


CFG = None


def run(tile, workers):
    global CFG
    CFG = cfg = wf.config()
    common = wf.satellite()
    plan = common.read_json(common.path("work", "plan.json"))
    pt = plan["tiles"][tile]
    size = plan["blockSize"]
    base = wf.rpath("s2", tile)
    os.makedirs(base, exist_ok=True)
    mpath = os.path.join(base, "masks.npz")
    lpath = wf.rpath("work", "looks", f"{tile}.json")
    t0 = time.time()
    if os.path.exists(mpath) and os.path.exists(lpath):
        with np.load(mpath) as z:
            masks = {k: z[k] for k in z.files}
        centres = wf.read_json(lpath)["blocks"]
    else:
        masks, centres = tile_masks(tile, pt, size)
        np.savez_compressed(mpath, **masks)
    # The looks are chosen again each time from the sea state as it is now (cheap); the
    # log keeps the reads already done.
    points = wf.read_json(wf.rpath("work", "seastate", "points.json"))["points"]
    block_points = {k: nearest_point(*c, points) for k, c in centres.items()}
    seastate = wf.read_json(wf.rpath("work", "seastate", f"{tile}.json"))["looks"]
    cat = common.read_json(common.path("downloads", "catalog", f"{tile}.json"))
    swell, calm = choose(cat["items"], seastate, block_points, cfg)
    pids = sorted(set(block_points.values()))
    cloud = {i["stamp"]: i["cloud"] for i in cat["items"]}
    doc = {"tile": tile, "epsg": pt["epsg"], "bbox": pt["bbox"], "blockSize": size, "blocks": centres,
           "blockPoints": block_points,
           "looks": [{"stamp": st, "why": why, "cloud": cloud[st], "sea": {p: seastate[st][p] for p in pids}}
                     for st, why in swell + calm]}
    wf.write_json(lpath, doc)
    print(f"{tile}: masks {len(masks)} blocks, {sum(int((m & SEARCHED).sum()) for m in masks.values()) / 1e4:.1f} km² "
          f"searched, {len(swell)} swell and {len(calm)} calm candidates ({time.time() - t0:.0f} s)", flush=True)
    if not masks:
        print(f"{tile}: nothing to search", flush=True)
        return {}
    log_path = os.path.join(base, "log.jsonl")
    done = {}
    if os.path.exists(log_path):
        with open(log_path) as fh:
            for line in fh:
                r = json.loads(line)
                done[r["stamp"]] = r
    cat = {i["stamp"]: i for i in common.read_json(common.path("downloads", "catalog", f"{tile}.json"))["items"]}
    looks = doc["looks"]
    want_calm = cfg["select"]["calmLooks"]
    kept_calm = sum(1 for lk in looks if lk["why"] == "calm" and done.get(lk["stamp"], {}).get("status") == "kept")
    calm_queue = [lk for lk in looks if lk["why"] == "calm" and lk["stamp"] not in done]
    need = max(want_calm - kept_calm, 0)
    jobs = [lk for lk in looks if lk["why"] == "swell" and lk["stamp"] not in done] + calm_queue[:need]
    calm_queue = calm_queue[need:]

    def one(lk):
        item = dict(cat[lk["stamp"]])
        item.setdefault("bbox10", pt["bbox"])
        for attempt in range(4):
            try:
                status, counts, codes = read_look(item, masks, size, cfg["select"]["maxBadShare"])
                if codes:
                    p = os.path.join(base, f"{lk['stamp']}.npz")
                    np.savez_compressed(p + ".part.npz", **codes)
                    os.replace(p + ".part.npz", p)
                return {"stamp": lk["stamp"], "why": lk["why"], "status": status, "blocks": counts}
            except Exception as e:  # network trouble, an expired signature: wait, re-sign, retry
                err = repr(e)[:300]
                time.sleep(5 * (attempt + 1))
        return {"stamp": lk["stamp"], "why": lk["why"], "status": "error", "error": err}

    t0 = time.time()
    counts = {}
    n = 0
    with cf.ThreadPoolExecutor(workers) as pool:
        while jobs:
            for rec in pool.map(one, jobs):
                n += 1
                with LOCK, open(log_path, "a") as fh:
                    fh.write(json.dumps(rec) + "\n")
                counts[rec["status"]] = counts.get(rec["status"], 0) + 1
                if rec["why"] == "calm" and rec["status"] == "kept":
                    kept_calm += 1
                if n % 25 == 0:
                    print(f"  {tile} [{n}] {counts} {time.time() - t0:.0f} s", flush=True)
            # Calm looks in rounds, the least cloudy first, until calmLooks are kept.
            need = want_calm - kept_calm
            jobs, calm_queue = calm_queue[:max(need, 0)], calm_queue[max(need, 0):]
    print(f"{tile}: {counts} in {time.time() - t0:.0f} s", flush=True)
    return counts


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", default="ireland")
    p.add_argument("--tile", required=True, action="append")
    p.add_argument("--workers", type=int, default=16)
    a = p.parse_args()
    wf.set_region(a.region)
    for t in a.tile:
        run(t, a.workers)


if __name__ == "__main__":
    sys.exit(main())
