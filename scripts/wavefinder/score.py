"""Where a tile's water breaks: per pixel, how often it foams in big swell and in
calm, and the candidate breaks that come out of it.

Each look is classed per block (wf.sea_class: big, calm or mid) by the sea
state blended from the three points nearest the block's searched pixels
(inverse-square distance, wf.blend), so blocks either side of the line between
two points do not jump. A big or mid look counts as **clean** in a
block when the offshore ring (2-5 km out) in it and the blocks within about
10 km has under score.maxWhitecap of its clear pixels foaming and under 30%
SCL cloud: foam out there is whitecaps
(an onshore gale) or haze, and the same would be counted as breaking near the
shore. Per pixel:

- P(foam | big): foamed in the clean big looks it was seen clear in;
- P(foam | calm): the same in the calm looks;
- lift: their ratio, with a pseudo-look at a small base rate (wf.lift);
- P(foam | mid): the moderate swells (consistency).

A pixel is a **candidate** when it was seen in score.minBigLooks big and
score.minCalmLooks calm looks, foamed in score.minFoamBig of the big ones and
its lift is over score.minLift. Candidates within score.clusterConnect
pixels join into clusters (under score.clusterMinPixels dropped), and each
cluster is cut into ~1 km pieces (score.segmentKm), each a **candidate
break**: its centre (weighted by P big), area, the probabilities, the seabed
under it (search.tif: shallowest depth, slope) and the way its shore faces.
Then the looks again, per candidate: the share of its pixels foaming in each
look clear over most of it, with the look's swell and wind: its **swell
window** (lit = over 30% foaming).

Writes <root>/<region>/work/score/<tile>.json (candidates with their looks)
and <tile>.tif (P big, P calm, lift and big looks at 10 m over the tile's
blocks, for the maps), and a quick-look PNG.

    python -I score.py --region ireland --tile 29UNA
"""
import argparse
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import wf  # noqa: E402

LIT = 0.3


def block_class(v, cfg, p75):
    """A block's class in a look from its blended sea state v ([hs, tp, dir, wind, wind from])."""
    if not v or None in (v[0], v[1], v[3]):
        return "none"
    return wf.sea_class(v[0], v[1], v[3], cfg["seaState"], p75)


def pooled(counts, key, radius=2):
    """A block's ring counts pooled with its neighbours' within `radius` blocks (about 10 km),
    so a block with little ring of its own (an inner bay) is judged by the sea outside it,
    and neighbouring blocks are not judged apart."""
    i, j = int(key[:2]), int(key[3:])
    tot = [0, 0, 0, 0, 0]
    for k, c in counts.items():
        if k == "bad" or not isinstance(c, list):
            continue
        if abs(int(k[:2]) - i) <= radius and abs(int(k[3:]) - j) <= radius:
            tot = [a + b for a, b in zip(tot, c)]
    return tot


def clean(counts, cfg):
    """A block-look's offshore ring (counts pooled by `pooled`) says no whitecaps or haze
    (or there is no ring)."""
    rv, rf, rc = counts[2], counts[3], counts[4]
    if rv < 2000:
        return rc < 2000
    return rf / rv <= cfg["score"]["maxWhitecap"] and rc / max(rv + rc, 1) < 0.3


def looks_of(tile):
    doc = wf.read_json(wf.rpath("work", "looks", f"{tile}.json"))
    log = {}
    with open(wf.rpath("s2", tile, "log.jsonl")) as fh:
        for line in fh:
            r = json.loads(line)
            log[r["stamp"]] = r
    return doc, log


def run(tile):
    import rasterio
    from rasterio.transform import from_origin
    from scipy import ndimage
    from pyproj import Transformer
    cfg = wf.config()
    sc = cfg["score"]
    t0 = time.time()
    doc, log = looks_of(tile)
    size = doc["blockSize"]
    points = {p["id"]: p for p in wf.read_json(wf.rpath("work", "seastate", "points.json"))["points"]}
    # Each block's sea state blended from the three points nearest its searched pixels
    # (wf.blend_weights), from the tile's sea state at every acquisition.
    seastate = wf.read_json(wf.rpath("work", "seastate", f"{tile}.json"))["looks"]
    weights = {k: wf.blend_weights(lon, lat, list(points.values())) for k, (lon, lat) in doc["blocks"].items()}
    p75 = {k: sum(w * (points[p].get("hsPercentiles", {}).get("75") or 0) for p, w in ws.items())
           for k, ws in weights.items()}
    sea_of = {}

    def sea_at(st, k):
        if (st, k) not in sea_of:
            sea_of[(st, k)] = wf.blend(seastate.get(st, {}), weights[k])
        return sea_of[(st, k)]
    with np.load(wf.rpath("s2", tile, "masks.npz")) as z:
        masks = {k: (z[k] & 1) > 0 for k in z.files}
    keys = sorted(masks)
    acc = {k: np.zeros((8, size, size), np.uint16) for k in keys}  # nb fb nc fc nm fm nbd fbd
    kept = [lk for lk in doc["looks"] if log.get(lk["stamp"], {}).get("status") == "kept"]
    classes = {}
    for lk in kept:
        st = lk["stamp"]
        path = wf.rpath("s2", tile, f"{st}.npz")
        if not os.path.exists(path):
            continue
        counts = log[st]["blocks"]
        with np.load(path) as z:
            for k in keys:
                if k not in z.files or k not in counts:
                    continue
                cls = block_class(sea_at(st, k), cfg, p75[k])
                ok = clean(pooled(counts, k), cfg)
                classes[(st, k)] = (cls, ok)
                row = {"big": 0, "calm": 2, "mid": 4}.get(cls)
                if row is None:
                    continue
                if cls != "calm" and not ok:
                    row = 6 if cls == "big" else None
                if row is None:
                    continue
                c = z[k]
                acc[k][row] += c > 0
                acc[k][row + 1] += c >= 2
    print(f"{tile}: {len(kept)} looks summed ({time.time() - t0:.0f} s)", flush=True)

    # Per-pixel probabilities and candidates, block by block, onto the tile's grid.
    rows = sorted({int(k[:2]) for k in keys})
    cols = sorted({int(k[3:]) for k in keys})
    r0, c0 = rows[0], cols[0]
    H, W = (rows[-1] - r0 + 1) * size, (cols[-1] - c0 + 1) * size
    pb_img = np.zeros((H, W), np.float32)
    pc_img = np.zeros((H, W), np.float32)
    pm_img = np.zeros((H, W), np.float32)
    nb_img = np.zeros((H, W), np.uint16)
    nc_img = np.zeros((H, W), np.uint16)
    cand = np.zeros((H, W), bool)
    for k in keys:
        a = acc[k]
        pb, pc, lf = wf.lift(a[1], a[0], a[3], a[2])
        pm = (a[5] + 0.002) / np.maximum(a[4] + 1, 1)
        i, j = int(k[:2]) - r0, int(k[3:]) - c0
        sl = (slice(i * size, (i + 1) * size), slice(j * size, (j + 1) * size))
        m = masks[k]
        seen = m & (a[0] > 0)
        pb_img[sl] = np.where(seen, pb, 0)
        pc_img[sl] = np.where(m & (a[2] > 0), pc, 0)
        pm_img[sl] = np.where(m & (a[4] > 0), pm, 0)
        nb_img[sl] = np.where(m, a[0], 0)
        nc_img[sl] = np.where(m, a[2], 0)
        cand[sl] = (m & (a[0] >= sc["minBigLooks"]) & (a[2] >= sc["minCalmLooks"])
                    & (a[1] >= sc["minFoamBig"] * a[0]) & (lf >= sc["minLift"]))
    l, b, r, t = doc["bbox"]
    tf = from_origin(l + c0 * size * 10, t - r0 * size * 10, 10, 10)
    out_dir = wf.rpath("work", "score")
    os.makedirs(out_dir, exist_ok=True)
    prof = dict(driver="GTiff", width=W, height=H, count=5, dtype="float32", crs=f"EPSG:{doc['epsg']}",
                transform=tf, compress="deflate", tiled=True, blockxsize=512, blockysize=512, predictor=3)
    with rasterio.open(os.path.join(out_dir, f"{tile}.tif"), "w", **prof) as dst:
        for n, (arr, name) in enumerate(((pb_img, "p_big"), (pc_img, "p_calm"), (pm_img, "p_mid"),
                                         (nb_img, "n_big"), (nc_img, "n_calm")), 1):
            dst.write(arr.astype(np.float32), n)
            dst.set_band_description(n, name)

    # Clusters, cut into pieces about segmentKm across.
    grown = ndimage.binary_dilation(cand, iterations=sc["clusterConnect"])
    lab, n = ndimage.label(grown, structure=np.ones((3, 3)))
    lab = np.where(cand, lab, 0)
    sizes = np.bincount(lab.ravel(), minlength=n + 1)
    seg_px = int(sc["segmentKm"] * 100)
    rr, cc = np.nonzero(lab)
    good = sizes[lab[rr, cc]] >= sc["clusterMinPixels"]
    rr, cc = rr[good], cc[good]
    key = lab[rr, cc].astype(np.int64) * 10 ** 8 + (rr // seg_px) * 10 ** 4 + (cc // seg_px)
    uniq, inv = np.unique(key, return_inverse=True)
    to_wgs = Transformer.from_crs(f"EPSG:{doc['epsg']}", 4326, always_xy=True)
    with rasterio.open(wf.rpath("work", "search.tif")) as src:
        sflags, sdepth, sfacing, sslope = src.read(1), src.read(2), src.read(3), src.read(4)
        sinv, scrs = ~src.transform, src.crs
    with rasterio.open(wf.satellite().path("work", "coarse.tif")) as src:
        sea_km = src.read(5)
    to_s = Transformer.from_crs(f"EPSG:{doc['epsg']}", scrs, always_xy=True)
    segs = []
    for s_id in range(len(uniq)):
        sel = inv == s_id
        if sel.sum() < sc["clusterMinPixels"]:
            continue
        pr, pcol = rr[sel], cc[sel]
        w = pb_img[pr, pcol]
        x = tf.c + (pcol.astype(np.float64) + 0.5) * 10
        y = tf.f - (pr.astype(np.float64) + 0.5) * 10
        cx, cy = float(np.average(x, weights=w)), float(np.average(y, weights=w))
        lon, lat = to_wgs.transform(cx, cy)
        gx, gy = to_s.transform(x, y)
        gc, gr = sinv * (gx, gy)
        gr = np.clip(np.floor(gr).astype(int), 0, sdepth.shape[0] - 1)
        gc = np.clip(np.floor(gc).astype(int), 0, sdepth.shape[1] - 1)
        # The DTM's elevation as depth below its datum, where it has sea (by the shore its
        # 115 m cells are often land).
        dep = np.where(np.isfinite(sdepth[gr, gc]) & (sdepth[gr, gc] < 0), -sdepth[gr, gc], np.nan)
        off = sea_km[gr, gc] * 1000
        fac = sfacing[gr, gc]
        fac = fac[np.isfinite(fac)]
        segs.append({
            "id": f"{tile}-{len(segs) + 1:03d}", "tile": tile, "lon": round(lon, 5), "lat": round(lat, 5),
            "pixels": int(sel.sum()), "areaHa": round(sel.sum() * 0.01, 2),
            "pBig": round(float(pb_img[pr, pcol].mean()), 3), "pCalm": round(float(pc_img[pr, pcol].mean()), 4),
            "pMid": round(float(pm_img[pr, pcol].mean()), 3),
            "nBig": int(np.median(nb_img[pr, pcol])), "nCalm": int(np.median(nc_img[pr, pcol])),
            "depthMin": None if not np.isfinite(dep).any() else round(float(np.nanmin(dep)), 1),
            "depthMedian": None if not np.isfinite(dep).any() else round(float(np.nanmedian(dep)), 1),
            "depthMax": None if not np.isfinite(dep).any() else round(float(np.nanmax(dep)), 1),
            "offshoreM": round(float(np.median(off))), "offshoreP90M": round(float(np.percentile(off, 90))),
            "slope": None if not np.isfinite(sslope[gr, gc]).any() else round(float(np.nanmedian(sslope[gr, gc])), 4),
            "facing": None if fac.size == 0 else round(wf.circular_mean(fac)[0]),
            "point": doc["blockPoints"][f"{(pr[0] // size) + r0:02d}_{(pcol[0] // size) + c0:02d}"],
            "_px": (pr, pcol)})
    print(f"{tile}: {int(cand.sum())} candidate pixels, {len(segs)} pieces ({time.time() - t0:.0f} s)", flush=True)

    # The looks again: each piece's foaming share per look.
    seg_of = np.zeros((H, W), np.int32)
    for n_, s in enumerate(segs, 1):
        seg_of[s["_px"]] = n_
    per = {s["id"]: [] for s in segs}
    seg_blocks = {}
    for n_, s in enumerate(segs, 1):
        pr, pcol = s["_px"]
        for bi, bj in set(zip((pr // size).tolist(), (pcol // size).tolist())):
            seg_blocks.setdefault(f"{bi + r0:02d}_{bj + c0:02d}", set()).add(n_)
    for lk in kept:
        st = lk["stamp"]
        path = wf.rpath("s2", tile, f"{st}.npz")
        if not os.path.exists(path):
            continue
        valid = np.zeros(len(segs) + 1, np.int64)
        foamy = np.zeros(len(segs) + 1, np.int64)
        with np.load(path) as z:
            for k, ids in seg_blocks.items():
                if k not in z.files:
                    continue
                i, j = int(k[:2]) - r0, int(k[3:]) - c0
                so = seg_of[i * size:(i + 1) * size, j * size:(j + 1) * size]
                c = z[k]
                valid += np.bincount(so[c > 0], minlength=len(segs) + 1)
                foamy += np.bincount(so[c >= 2], minlength=len(segs) + 1)
        for n_, s in enumerate(segs, 1):
            if valid[n_] < 0.5 * s["pixels"]:
                continue
            bk = f"{(s['_px'][0][0] // size) + r0:02d}_{(s['_px'][1][0] // size) + c0:02d}"
            cls, ok = classes.get((st, bk), ("none", False))
            v = sea_at(st, bk)
            per[s["id"]].append([st, cls, bool(ok), round(foamy[n_] / valid[n_], 3), round(valid[n_] / s["pixels"], 2)]
                                + list(v) + [lk["cloud"]])
    for s in segs:
        s.pop("_px")
        s["looks"] = per[s["id"]]
        s.update(window(s["looks"], s["facing"]))
    wf.write_json(os.path.join(out_dir, f"{tile}.json"),
                  {"tile": tile, "fields": ["stamp", "class", "clean", "foamShare", "seenShare", "hs", "tp", "dir",
                                            "wind", "windFrom", "tileCloud"], "lit": LIT, "candidates": segs})
    quicklook(pb_img, pc_img, cand, os.path.join(out_dir, f"{tile}.png"))
    print(f"{tile}: scored in {time.time() - t0:.0f} s", flush=True)
    return segs


def window(looks, facing):
    """A candidate's swell window from its looks: what lights it up."""
    out = {"nLooks": len(looks)}
    sw = [lk for lk in looks if lk[1] in ("big", "mid") and lk[5] is not None]
    lit = [lk for lk in sw if lk[3] >= LIT and lk[2]]
    dark = [lk for lk in sw if lk[3] < LIT]
    out["nLit"], out["nSwell"] = len(lit), len(sw)
    if lit:
        hs, tp, d = (np.array([lk[k] for lk in lit], float) for k in (5, 6, 7))
        mean, rlen = wf.circular_mean(d)
        pw = wf.swell_power(hs, tp)
        out["lit"] = {"hs": [round(float(np.percentile(hs, 10)), 1), round(float(np.percentile(hs, 90)), 1)],
                      "powerKw": [round(float(np.percentile(pw, 10))), round(float(np.percentile(pw, 90)))],
                      "tp": [round(float(np.percentile(tp, 10)), 1), round(float(np.percentile(tp, 90)), 1)],
                      "dir": round(mean), "dirSpread": round(float(rlen), 2)}
    # Lit share by direction sector (where the swell comes from), period and size.
    sectors = {}
    for lk in sw:
        if lk[7] is None:
            continue
        s = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][int(((lk[7] + 22.5) % 360) // 45)]
        a = sectors.setdefault(s, [0, 0])
        a[0] += 1
        a[1] += lk[3] >= LIT
    out["bySector"] = sectors
    bins = {}
    for lk in sw:
        b = "<9" if lk[6] < 9 else "9-11" if lk[6] < 11 else "11-13" if lk[6] < 13 else "13-15" if lk[6] < 15 else "15+"
        a = bins.setdefault(b, [0, 0])
        a[0] += 1
        a[1] += lk[3] >= LIT
    out["byPeriod"] = bins
    hb = {}
    for lk in sw:
        b = "<1" if lk[5] < 1 else "1-2" if lk[5] < 2 else "2-3" if lk[5] < 3 else "3-4" if lk[5] < 4 else "4+"
        a = hb.setdefault(b, [0, 0])
        a[0] += 1
        a[1] += lk[3] >= LIT
    out["bySize"] = hb
    winds = {}
    for lk in lit:
        if facing is None:
            break
        k = wf.wind_kind(lk[8] if lk[8] is not None else np.nan, lk[9] if lk[9] is not None else np.nan, facing)
        winds[k] = winds.get(k, 0) + 1
    out["litWinds"] = winds
    out["nDark"] = len(dark)
    return out


def quicklook(pb, pc, cand, p):
    from PIL import Image
    s = 4
    h, w = pb.shape[0] // s * s, pb.shape[1] // s * s
    a = pb[:h, :w].reshape(h // s, s, w // s, s).max(axis=(1, 3))
    c = cand[:h, :w].reshape(h // s, s, w // s, s).any(axis=(1, 3))
    img = np.full(a.shape + (3,), 255, np.uint8)
    v = np.clip(a / 0.6, 0, 1)
    img[..., 0] = (255 * (1 - v)).astype(np.uint8)
    img[..., 1] = (255 * (1 - v * 0.6)).astype(np.uint8)
    img[c] = (220, 30, 30)
    Image.fromarray(img).save(p)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", default="ireland")
    p.add_argument("--tile", required=True, action="append")
    a = p.parse_args()
    wf.set_region(a.region)
    for t in a.tile:
        run(t)


if __name__ == "__main__":
    sys.exit(main())
