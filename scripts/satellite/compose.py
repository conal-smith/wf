"""One tile's high- and low-tide images and intertidal heights, from fetch.py's reads.

1. Scene QC, per block: each look is checked against the pixels that are wet
   or dry in nearly every look, summed over the 3×3 blocks round it (about
   15 km), and dropped there if it contradicts more than heights.maxSceneError
   of them (haze, glint, a cloud the masks missed, surf) or sees under 30% of
   the coast (the rocks pilot's QC, made local).
2. Per coastal block, with the looks that pass:
   - the flip level of every pixel against its station's tide (the regions'
     cells), its misfit, looks, wet share and lush share;
   - per station whose cell is within composite.stationBlendKm, the high- and
     low-tide colour: the robust median of the clean looks in its tide tails
     (all seasons: a per-pixel choice of season made the sea blotchy), blended
     across the cells' edges by
     common.station_weights.
3. Per coverage block: the summer colour (robust median of the summer scenes).
4. The whole tile: the pixels joined to the sea, the intertidal heights and
   their classes, the tide zone (where water ever reaches, and a margin), and
   the two images: tide-sorted in the tide zone, feathered into the summer
   colour beyond it, so the land is the same in both.

Writes <root>/work/tiles/<tile>/: high.tif and low.tif (colour codes, then the
pixel's weight: the tile's share of it times the coverage's fade at sea),
heights.tif and stats.json.

    python -I compose.py --tile 29UPV [--jobs 3]
"""
import argparse
import json
import math
import multiprocessing as mp
import os
import sys
import time
import zipfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402
import composite  # noqa: E402
import plan as planmod  # noqa: E402

TILE_PX = planmod.TILE_PX
# Heights' class per pixel in heights.tif.
OBSERVED, BELOW_SEEN, ABOVE_SEEN, NOT_FITTED = 1, 2, 3, 4


class Looks:
    """Lazy per-block reads from fetch.py's npz files."""

    def __init__(self, paths):
        self.paths = paths
        self.zf = {}

    def member(self, k, name):
        if k not in self.zf:
            self.zf[k] = zipfile.ZipFile(self.paths[k])
        try:
            with self.zf[k].open(name + ".npy") as fh:
                return np.lib.format.read_array(fh, allow_pickle=False)
        except KeyError:
            return None

    def stack(self, ks, name, shape, dtype=np.uint8, rows=None):
        """The looks' arrays for one block, stacked; only `rows` (a slice of the
        last-but-one axis) of each if given, so a part of a block costs a part
        of the memory."""
        rows = rows or slice(None)
        h = len(range(*rows.indices(shape[-2])))
        out = np.zeros((len(ks),) + shape[:-2] + (h, shape[-1]), dtype=dtype)
        for n, k in enumerate(ks):
            a = self.member(k, name)
            if a is not None:
                out[n] = a[..., rows, :]
        return out

    def close(self):
        for z in self.zf.values():
            z.close()
        self.zf = {}


def load_scenes(tile, kind):
    base = common.path("downloads", "s2", tile)
    kept = {}
    with open(os.path.join(base, "log.jsonl")) as fh:
        for line in fh:
            r = json.loads(line)
            if r["kind"] == kind and r["status"] == "kept":
                kept[r["stamp"]] = r
    out = []
    for stamp in sorted(kept):
        p = os.path.join(base, kind, f"{stamp}.npz")
        if os.path.exists(p):
            out.append((stamp, p, kept[stamp]))
    return out


def block_lonlat(pt, i, j, size, step=1):
    from pyproj import Transformer
    l, b, r, t = pt["bbox"]
    cols = j * size + np.arange(0, size, step) + step / 2
    rows = i * size + np.arange(0, size, step) + step / 2
    xx, yy = np.meshgrid(l + cols * 10, t - rows * 10)
    tr = Transformer.from_crs(f"EPSG:{pt['epsg']}", 4326, always_xy=True)
    return tr.transform(xx, yy), (xx, yy)


def upsample(a, factor, size):
    from scipy import ndimage
    return ndimage.zoom(a, factor, order=1, mode="nearest", grid_mode=True)[:size, :size]


class Ctx:
    """What every block of a tile needs."""

    def __init__(self, tile):
        self.tile = tile
        self.cfg = common.config()
        self.plan = common.read_json(common.path("work", "plan.json"))
        self.pt = common.scouted(self.plan["tiles"][tile], tile)
        self.size = self.plan["blockSize"]
        self.stations = common.stations()
        self.sid = [s["id"] for s in self.stations]
        self.tile_st = [self.sid.index(s) for s in self.pt["stations"]]
        levels = common.read_json(common.path("work", "tides", "scenes.json"))["levels"]
        self.coast = load_scenes(tile, "coast")
        self.summer = load_scenes(tile, "summer")
        self.stamps = [s for s, _, _ in self.coast]
        self.cand = np.array([r.get("candidate", False) for _, _, r in self.coast])
        self.month = np.array([int(s[4:6]) for s in self.stamps])
        self.levels = {k: np.array([levels[self.sid[k]].get(s, [np.nan])[0] for s in self.stamps], dtype=np.float64)
                       for k in self.tile_st}
        self.out = common.path("work", "tiles", tile)
        os.makedirs(self.out, exist_ok=True)


# ---- pass 1: scene QC ----------------------------------------------------------


def qc_block(ctx, looks, i, j):
    from scipy import ndimage
    size = ctx.size
    codes = looks.stack(range(len(ctx.coast)), f"c{i:02d}_{j:02d}", (size, size))
    st = np.where(codes == 0, -1, np.where((codes & 3) == 2, 1, 0)).astype(np.int8)
    seen = (st >= 0).sum(0)
    freq = (st == 1).sum(0) / np.maximum(seen, 1)
    ok = seen >= ctx.cfg["heights"]["minValid"]
    always_wet = ok & (freq > 0.97)
    always_dry = ok & (freq < 0.03)
    near = ndimage.binary_dilation(always_wet, iterations=60) if always_wet.any() else always_wet
    return composite.scene_errors(st, always_wet & near, always_dry & near, near)


def qc(ctx, jobs):
    path = os.path.join(ctx.out, "qc.npz")
    blocks = [tuple(b) for b in ctx.pt["coastalBlocks"]]
    if os.path.exists(path):
        z = np.load(path)
        if list(z["stamps"]) == ctx.stamps:
            return {tuple(b): k for b, k in zip(z["blocks"], z["keep"].T)}
    errs = {}
    with mp.get_context("spawn").Pool(jobs) as pool:
        for b, e in pool.imap_unordered(_qc_worker, [(ctx.tile, b) for b in blocks]):
            errs[b] = e
    keep = {}
    h = ctx.cfg["heights"]
    for (i, j) in blocks:
        tot = sum(errs[(i + di, j + dj)] for di in (-1, 0, 1) for dj in (-1, 0, 1) if (i + di, j + dj) in errs)
        keep[(i, j)] = composite.keep_from_errors(tot, h["maxSceneError"])
    np.savez(path, stamps=np.array(ctx.stamps), blocks=np.array(blocks),
             keep=np.stack([keep[b] for b in blocks], axis=1))
    return keep


_CTX = {}


def _ctx(tile):
    if tile not in _CTX:
        _CTX.clear()
        _CTX[tile] = Ctx(tile)
    return _CTX[tile]


def _qc_worker(job):
    tile, b = job
    ctx = _ctx(tile)
    looks = Looks([p for _, p, _ in ctx.coast])
    try:
        return tuple(b), qc_block(ctx, looks, *b)
    finally:
        looks.close()


# ---- pass 2: per block -----------------------------------------------------------


def coastal_block(ctx, i, j, keep, parts=4):
    """A coastal block's fields, in `parts` strips of rows (the looks' stacks
    for a strip only, so the memory is a part of a whole block's)."""
    size = ctx.size
    step = size // parts
    pieces = [coastal_part(ctx, i, j, keep, slice(r0, r0 + step)) for r0 in range(0, size, step)]
    return {k: np.concatenate([pc[k] for pc in pieces], axis=-2) for k in pieces[0]}


def coastal_part(ctx, i, j, keep, rows):
    size, cfg = ctx.size, ctx.cfg
    c = cfg["composite"]
    max_km = cfg["intertidalArchive"]["maxStationKm"]
    hh = rows.stop - rows.start
    looks = Looks([p for _, p, _ in ctx.coast])
    try:
        ks = np.flatnonzero(keep)
        codes = looks.stack(ks, f"c{i:02d}_{j:02d}", (size, size), rows=rows)
        st = np.where(codes == 0, -1, np.where((codes & 3) == 2, 1, 0)).astype(np.int8)
        cand = ctx.cand[ks]
        (lon, lat), _ = block_lonlat(ctx.pt, i, j, size)
        blon, blat = common.region_block_lonlat(lon[rows], lat[rows])
        nearest = common.nearest_station(blon, blat, ctx.stations, max_km)
        res = {}
        # Heights against each station's tide, kept where the pixel is that station's.
        z = np.full((hh, size), np.nan, np.float32)
        misfit = np.full((hh, size), np.nan, np.float32)
        nvalid = np.zeros((hh, size), np.int16)
        state = np.zeros((hh, size), np.int8)
        drybelow = np.zeros((hh, size), np.int16)
        wetabove = np.zeros((hh, size), np.int16)
        for k in np.unique(nearest):
            if k not in ctx.levels:
                continue
            lv = ctx.levels[k][ks]
            have = np.isfinite(lv)
            mine = nearest == k
            zz, mf, nv, sst, _ = composite.flip_heights(st[have], lv[have])
            db, wa = composite.below_above_counts(st[have], lv[have], zz)
            for arr, v in ((z, zz), (misfit, mf), (nvalid, nv), (state, sst), (drybelow, db), (wetabove, wa)):
                arr[mine] = v[mine]
        seen = (st >= 0).sum(0)
        res["station"] = nearest.astype(np.int8)
        res["z"], res["misfit"], res["nvalid"], res["state"] = z, misfit, nvalid, state
        res["drybelow"], res["wetabove"] = drybelow, wetabove
        res["freq"] = ((st == 1).sum(0) / np.maximum(seen, 1)).astype(np.float32)
        cdry = (st[cand] == 0)
        res["lush"] = (((codes[cand] & 4) > 0).sum(0) / np.maximum(cdry.sum(0), 1)).astype(np.float32)
        res["seen"] = seen.astype(np.int16)
        # Colour, per station near enough to have weight here.
        sub = 8
        (slon, slat), _ = block_lonlat(ctx.pt, i, j, size, step=sub)
        wts = common.station_weights(slon, slat, ctx.stations, max_km, c["stationBlendKm"])
        cks = ks[cand]
        rgb = looks.stack(cks, f"r{i:02d}_{j:02d}", (3, size, size), rows=rows)
        clean = rgb.min(axis=1) > 0
        # The low looks' near and shortwave infrared, where fetch.py kept it (0 elsewhere).
        ir = looks.stack(cks, f"x{i:02d}_{j:02d}", (2, size, size), rows=rows)
        ir_acc = np.zeros((2, hh, size), np.float32)
        ir_wsum = np.zeros((hh, size), np.float32)
        for opt in ("high", "low"):
            acc = np.zeros((3, hh, size), np.float32)
            wsum = np.zeros((hh, size), np.float32)
            tide_acc = np.zeros((hh, size), np.float32)
            count_acc = np.zeros((hh, size), np.float32)
            for k in np.flatnonzero((wts > 0).any(axis=(1, 2))):
                if k not in ctx.levels:
                    continue
                th = ctx.plan["stations"].get(ctx.sid[k])
                if th is None:
                    continue
                lv = ctx.levels[k][cks]
                sel = (lv >= th["high"]) if opt == "high" else (lv <= th["low"])
                sel &= np.isfinite(lv)
                use = clean & sel[:, None, None]
                med, used = composite.robust_rgb_median(rgb, use)
                w = upsample(wts[k], sub, size)[rows] * (used >= c["minScenes"])
                good = np.isfinite(med[0]) & (w > 0)
                acc += np.where(good[None], med * w[None], 0)
                wsum += np.where(good, w, 0)
                tide_acc += np.where(good, composite.median_level(lv, use) * w, 0)
                count_acc += np.where(good, used * w, 0)
                if opt == "low":
                    # The same looks as the colour, those that kept their infrared.
                    use_ir = use & (ir.min(axis=1) > 0)
                    w_ir = w * (use_ir.sum(axis=0) >= c["minScenes"])
                    for band in range(2):
                        med_ir, _ = composite.masked_median(ir[:, band], use_ir)
                        ir_acc[band] += np.where(np.isfinite(med_ir) & (w_ir > 0), med_ir * w_ir, 0)
                    ir_wsum += np.where(np.isfinite(med_ir) & (w_ir > 0), w_ir, 0)
            have = wsum > 0
            res[opt] = np.where(have[None], acc / np.maximum(wsum, 1e-6)[None], np.nan).astype(np.float32)
            res[opt + "_tide"] = np.where(have, tide_acc / np.maximum(wsum, 1e-6), np.nan).astype(np.float32)
            res[opt + "_n"] = np.where(have, count_acc / np.maximum(wsum, 1e-6), 0).astype(np.float32)
        res["low_ir"] = np.where((ir_wsum > 0)[None], ir_acc / np.maximum(ir_wsum, 1e-6)[None], np.nan).astype(np.float32)
        return res
    finally:
        looks.close()


def summer_block(ctx, i, j):
    looks = Looks([p for _, p, _ in ctx.summer])
    try:
        rgb = looks.stack(range(len(ctx.summer)), f"r{i:02d}_{j:02d}", (3, ctx.size, ctx.size))
        med, used = composite.robust_rgb_median(rgb, (rgb > 0).all(axis=1))
        return med, used
    finally:
        looks.close()


def _block_worker(job):
    tile, kind, i, j, keep = job
    ctx = _ctx(tile)
    t0 = time.time()
    if kind == "coast":
        res = coastal_block(ctx, i, j, keep)
    else:
        med, used = summer_block(ctx, i, j)
        res = {"summer": med, "summer_n": used.astype(np.float32)}
    path = os.path.join(ctx.out, "blocks", f"{kind}-{i:02d}-{j:02d}.npz")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    np.savez(path + ".part.npz", **res)
    os.replace(path + ".part.npz", path)
    return kind, i, j, time.time() - t0


# ---- pass 3: the whole tile ------------------------------------------------------


FIELDS = {"z": (np.float32, np.nan), "misfit": (np.float32, np.nan), "nvalid": (np.int16, 0),
          "state": (np.int8, 0), "drybelow": (np.int16, 0), "wetabove": (np.int16, 0),
          "freq": (np.float32, np.nan), "lush": (np.float32, np.nan), "seen": (np.int16, 0),
          "station": (np.int8, -1), "high_tide": (np.float32, np.nan), "low_tide": (np.float32, np.nan),
          "high_n": (np.float32, 0), "low_n": (np.float32, 0)}


def mosaic(ctx, names):
    """Tile-sized arrays from the blocks' files (memory-mapped in the work folder)."""
    size = ctx.size
    n = -(-TILE_PX // size)
    full = n * size
    arrs = {}
    for name in names:
        dtype, fill = FIELDS.get(name, (np.float32, np.nan))
        shape = (3, full, full) if name in ("high", "low", "summer") else (2, full, full) if name == "low_ir" \
            else (full, full)
        a = np.lib.format.open_memmap(os.path.join(ctx.out, f"m-{name}.npy"), mode="w+", dtype=dtype, shape=shape)
        a[...] = fill
        arrs[name] = a
    bdir = os.path.join(ctx.out, "blocks")
    for f in sorted(os.listdir(bdir)):
        if not f.endswith(".npz"):
            continue
        kind, i, j = f[:-4].split("-")
        i, j = int(i), int(j)
        with np.load(os.path.join(bdir, f)) as z:
            for name in names:
                if name in z.files:
                    a = arrs[name]
                    if a.ndim == 3:
                        a[:, i * size:(i + 1) * size, j * size:(j + 1) * size] = z[name]
                    else:
                        a[i * size:(i + 1) * size, j * size:(j + 1) * size] = z[name]
    return arrs


def coarse_on_tile(ctx, band, resampling):
    import rasterio
    from rasterio.warp import reproject
    from rasterio.transform import from_origin
    size = ctx.size
    full = -(-TILE_PX // size) * size
    l, b, r, t = ctx.pt["bbox"]
    # At 40 m, then up to 10 m (the coarse grid is 100 m anyway).
    small = full // 4
    dst = np.zeros((small, small), np.float32)
    with rasterio.open(common.path("work", "coarse.tif")) as src:
        reproject(rasterio.band(src, band), dst, dst_transform=from_origin(l, t, 40, 40),
                  dst_crs=f"EPSG:{ctx.pt['epsg']}", resampling=resampling)
    return dst


def finish(ctx, strip=1024):
    """The whole tile: the sea's connectivity needs all of it at once (as
    bits and one label array); everything else goes a strip of rows at a time,
    from the memory-mapped block fields, so the pass fits beside a fetch."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_origin
    from rasterio.windows import Window
    from scipy import ndimage
    cfg, h, c, ia = ctx.cfg, ctx.cfg["heights"], ctx.cfg["composite"], ctx.cfg["intertidalArchive"]
    size = ctx.size
    full = -(-TILE_PX // size) * size
    names = list(FIELDS) + ["high", "low", "summer", "low_ir"]
    m = mosaic(ctx, names)
    l, b, r, t = ctx.pt["bbox"]
    profile = {"driver": "GTiff", "width": TILE_PX, "height": TILE_PX, "crs": f"EPSG:{ctx.pt['epsg']}",
               "transform": from_origin(l, t, 10, 10), "compress": "deflate", "tiled": True,
               "blockxsize": 512, "blockysize": 512, "BIGTIFF": "IF_SAFER"}

    # The coarse grid's fields at 40 m, and the tile's share at 80 m: both
    # small, brought to 10 m a strip at a time.
    own = planmod.Ownership(planmod.footprints(), cfg, crs=f"EPSG:{ctx.pt['epsg']}")
    step = 8
    xs = l + (np.arange(0, full, step) + step / 2) * 10
    ys = t - (np.arange(0, full, step) + step / 2) * 10
    xx, yy = np.meshgrid(xs, ys)
    w80 = np.nan_to_num(own.weights(xx, yy).get(ctx.tile, np.zeros_like(xx, dtype=np.float32))).astype(np.float32)
    del xx, yy
    sea40 = coarse_on_tile(ctx, 3, Resampling.nearest) > 0.5
    km40 = coarse_on_tile(ctx, 5, Resampling.bilinear)
    cov40 = coarse_on_tile(ctx, 1, Resampling.bilinear)
    fade = cfg["imagery"]["edgeFadeKm"]
    alpha40 = np.where(sea40, np.clip((cfg["coarse"]["seaKm"] - km40) / fade, 0, 1),
                       np.clip(cov40 * 2, 0, 1)).astype(np.float32)
    w_full = ndimage.zoom(w80, step, order=1)[:full, :full]
    a_full = ndimage.zoom(alpha40, 4, order=1)[:full, :full]
    weight8 = np.round(np.clip(w_full * a_full, 0, 1) * 255).astype(np.uint8)
    del w_full, a_full, w80, km40, alpha40

    def up4(a, r0, r1):
        """Rows r0..r1 of a 40 m array brought to 10 m by repetition."""
        return np.repeat(np.repeat(a[r0 // 4:-(-r1 // 4)], 4, axis=0), 4, axis=1)[r0 % 4:r0 % 4 + (r1 - r0), :full]

    # Joined to the sea, over the whole tile at once.
    ok_min = h["minValid"]
    sea_seed = np.zeros((full, full), bool)
    ever = np.zeros((full, full), bool)
    for r0 in range(0, full, strip):
        r1 = min(full, r0 + strip)
        ok = m["seen"][r0:r1] >= ok_min
        freq = np.nan_to_num(m["freq"][r0:r1], nan=0)
        sea_seed[r0:r1] = ok & (freq > h["alwaysWetShare"]) & up4(sea40, r0, r1)
        ever[r0:r1] = (ok & (freq > 0.03)) | sea_seed[r0:r1]
    lab, _ = ndimage.label(ever)
    del ever
    seeds = np.unique(lab[sea_seed])
    del sea_seed
    connected = np.isin(lab, seeds[seeds > 0])
    del lab

    # Heights, classes and the tide zone, a strip at a time.
    tz = np.zeros((full, full), bool)
    counts = {v: 0 for v in (OBSERVED, BELOW_SEEN, ABOVE_SEEN, NOT_FITTED)}
    q = ia["quantumMetres"]
    hp = dict(profile, count=6, dtype="float32", nodata=None)
    with rasterio.open(os.path.join(ctx.out, "heights.tif"), "w", **hp) as dst:
        for k, name in enumerate(["archive_metres_lat", "flip_level_raw", "misfit", "looks", "class",
                                  "station_index"], 1):
            dst.set_band_description(k, name)
        for r0 in range(0, TILE_PX, strip):
            r1 = min(TILE_PX, r0 + strip)
            rows = slice(r0, r1)
            ok = m["seen"][rows] >= ok_min
            freq = np.nan_to_num(m["freq"][rows], nan=0)
            con = connected[rows]
            lush_ok = np.nan_to_num(m["lush"][rows], nan=0) < h["maxLushShare"]
            state = np.asarray(m["state"][rows])
            z = np.asarray(m["z"][rows])
            misfit = np.asarray(m["misfit"][rows])
            inter = (con & lush_ok & (state == 1) & (m["drybelow"][rows] >= h["minDryBelow"])
                     & (m["wetabove"][rows] >= h["minWetAbove"]) & (np.nan_to_num(misfit, nan=1) < h["maxMisfit"])
                     & ok)
            cls = np.zeros(ok.shape, np.uint8)
            cls[ok] = NOT_FITTED
            cls[ok & ((state == 3) | ~con | ~lush_ok)] = ABOVE_SEEN
            cls[ok & con & (state == 2)] = BELOW_SEEN
            cls[inter] = OBSERVED
            out = np.full(ok.shape, ia["noSurveyMetres"], np.float32)
            out[cls == ABOVE_SEEN] = ia["landMetres"]
            out[cls == BELOW_SEEN] = ia["belowSeenMetres"]
            out[inter] = np.round(z[inter] / q) * q  # the bias comes off in tiles.py
            out[cls == 0] = np.nan
            mine = weight8[rows] > 127
            for v in counts:
                counts[v] += int(((cls == v) & mine)[:, :TILE_PX].sum())
            win = Window(0, r0, TILE_PX, r1 - r0)
            dst.write(out[:, :TILE_PX], 1, window=win)
            dst.write(z[:, :TILE_PX].astype(np.float32), 2, window=win)
            dst.write(np.where(ok, misfit, np.nan)[:, :TILE_PX].astype(np.float32), 3, window=win)
            dst.write(m["nvalid"][rows][:, :TILE_PX].astype(np.float32), 4, window=win)
            dst.write(cls[:, :TILE_PX].astype(np.float32), 5, window=win)
            dst.write(m["station"][rows][:, :TILE_PX].astype(np.float32), 6, window=win)
            # The tide zone: where the water ever reaches, joined to the sea, not lush land; and the sea.
            tz[rows] = (con & (freq >= c["tideZoneMinWetShare"]) & lush_ok) | (
                up4(sea40, r0, r1) & ~ok & up4(cov40 > 0, r0, r1))
    del connected
    stats = {"tile": ctx.tile, "coastLooks": len(ctx.coast), "summerLooks": len(ctx.summer),
             "intertidalKm2": round(counts[OBSERVED] * 1e-4, 2),
             "classesKm2": {name: round(counts[v] * 1e-4, 2) for name, v in
                            (("observed", OBSERVED), ("belowSeen", BELOW_SEEN), ("aboveSeen", ABOVE_SEEN),
                             ("notFitted", NOT_FITTED))}}
    with rasterio.open(os.path.join(ctx.out, "weight.tif"), "w", **dict(profile, count=1, dtype="uint8")) as dst:
        dst.write(weight8[:TILE_PX, :TILE_PX], 1)

    # The feather: the tide zone grown, then blurred, at 20 m (σ 80 m is 4 pixels there).
    tz = ndimage.binary_dilation(tz, iterations=c["tideZoneDilatePixels"])
    tz20 = tz.reshape(full // 2, 2, full // 2, 2).mean(axis=(1, 3), dtype=np.float32)
    w20 = ndimage.gaussian_filter(tz20, c["tideZoneFeatherPixels"] / 2)
    del tz20

    stn_all = m["station"]
    for opt in ("high", "low"):
        tide, summer = m[opt], m["summer"]
        tide_sum = {}
        with rasterio.open(os.path.join(ctx.out, f"{opt}.tif"), "w", count=4, dtype="uint8", nodata=None,
                           **profile) as dst:
            for r0 in range(0, TILE_PX, strip):
                r1 = min(TILE_PX, r0 + strip)
                rows = slice(r0, r1)
                win = Window(0, r0, TILE_PX, r1 - r0)
                tb = np.asarray(tide[:, rows])
                sb = np.asarray(summer[:, rows])
                have_t = np.isfinite(tb[0])
                have_s = np.isfinite(sb[0])
                wz = np.repeat(np.repeat(w20[r0 // 2:-(-r1 // 2)], 2, axis=0), 2, axis=1)[r0 % 2:r0 % 2 + (r1 - r0)]
                wt = np.where(have_s, np.where(have_t, wz, 0), have_t.astype(np.float32)).astype(np.float32)
                any_ = have_t | have_s
                for band in range(3):
                    v = np.nan_to_num(composite.decode(tb[band]), nan=0) * wt
                    v += np.nan_to_num(composite.decode(sb[band]), nan=0) * (1 - wt)
                    code = common.encode_refl(v)
                    code[~any_] = 0
                    dst.write(code[:, :TILE_PX], band + 1, window=win)
                dst.write(np.where(any_, weight8[rows], 0)[:, :TILE_PX].astype(np.uint8), 4, window=win)
                # The station's median tide over the looks the image used, in the tide zone.
                sel_px = tz[rows] & have_t & (weight8[rows] > 127)
                stn = stn_all[rows]
                for k in np.unique(stn[sel_px]):
                    if k < 0:
                        continue
                    sel = sel_px & (stn == k)
                    acc = tide_sum.setdefault(int(k), {"tides": [], "n": []})
                    vals = m[opt + "_tide"][rows][sel]
                    # A sample is enough for a median over millions of pixels.
                    pick = slice(None, None, max(1, vals.size // 20000))
                    acc["tides"].append(vals[pick])
                    acc["n"].append(m[opt + "_n"][rows][sel][pick])
                    acc["pixels"] = acc.get("pixels", 0) + int(sel.sum())
        stats[opt] = {ctx.sid[k]: {"pixels": a["pixels"],
                                   "medianTide": round(float(np.nanmedian(np.concatenate(a["tides"]))), 2),
                                   "looksMedian": round(float(np.median(np.concatenate(a["n"]))), 1)}
                      for k, a in tide_sum.items()}

    # The low tide's near and shortwave infrared (B08, B11) in the tide zone, for
    # telling the bed's rock, weed, sand and mud apart (encode_refl codes, 0 none).
    with rasterio.open(os.path.join(ctx.out, "lowir.tif"), "w", count=2, dtype="uint8", nodata=0,
                       **profile) as dst:
        dst.set_band_description(1, "B08_low")
        dst.set_band_description(2, "B11_low")
        for r0 in range(0, TILE_PX, strip):
            r1 = min(TILE_PX, r0 + strip)
            win = Window(0, r0, TILE_PX, r1 - r0)
            zone = tz[r0:r1]
            for band in range(2):
                v = np.asarray(m["low_ir"][band, r0:r1])
                code = np.where(zone & np.isfinite(v), np.clip(np.round(np.nan_to_num(v)), 1, 255), 0)
                dst.write(code[:, :TILE_PX].astype(np.uint8), band + 1, window=win)
    common.write_json(os.path.join(ctx.out, "stats.json"), stats)
    del m
    for name in names:
        os.remove(os.path.join(ctx.out, f"m-{name}.npy"))
    print(json.dumps(stats)[:1500], flush=True)
    return stats


def run(tile, jobs, only_finish=False):
    t0 = time.time()
    ctx = Ctx(tile)
    print(f"{tile}: {len(ctx.coast)} coastal looks ({int(ctx.cand.sum())} with colour), "
          f"{len(ctx.summer)} summer looks", flush=True)
    todo = []
    if not only_finish:
        keep = qc(ctx, jobs) if ctx.pt["coastalBlocks"] else {}
        kept = np.mean([k.mean() for k in keep.values()]) if keep else 0
        print(f"  QC: {kept:.0%} of looks kept per block on average ({time.time() - t0:.0f} s)", flush=True)
        bdir = os.path.join(ctx.out, "blocks")
        for i, j in ctx.pt["coastalBlocks"]:
            if not os.path.exists(os.path.join(bdir, f"coast-{i:02d}-{j:02d}.npz")):
                todo.append((tile, "coast", i, j, keep[(i, j)]))
        for i, j in ctx.pt["coverageBlocks"]:
            if not os.path.exists(os.path.join(bdir, f"summer-{i:02d}-{j:02d}.npz")):
                todo.append((tile, "summer", i, j, None))
        with mp.get_context("spawn").Pool(jobs, maxtasksperchild=20) as pool:
            for n, (kind, i, j, dt) in enumerate(pool.imap_unordered(_block_worker, todo), 1):
                if n % 20 == 0 or n == len(todo):
                    print(f"  [{n}/{len(todo)}] {kind} {i},{j} {dt:.0f} s ({time.time() - t0:.0f} s)", flush=True)
    finish(ctx)
    print(f"{tile}: done in {time.time() - t0:.0f} s", flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--tile", required=True, action="append")
    p.add_argument("--jobs", type=int, default=3)
    p.add_argument("--finish", action="store_true", help="only the whole-tile pass (the blocks are done)")
    a = p.parse_args()
    for t in a.tile:
        run(t, a.jobs, a.finish)


if __name__ == "__main__":
    sys.exit(main())
