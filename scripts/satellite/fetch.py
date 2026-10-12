"""Read one Sentinel-2 tile's acquisitions over the blocks the plan gives it.

For every acquisition, its SCL first (the whole 20 m band is about 3 MB);
one whose coastal blocks are more than `maxBadFraction` cloud, shadow or no
data stops there. Otherwise, over the coastal blocks:

- every acquisition: B03 and B08, made into one byte a pixel: 0 not usable
  (SCL's cloud, shadow, cirrus, snow, saturation and no data, its clouds and
  shadows grown by 40 m, or bright haze, B03 > 0.22), 1 dry, 2 wet
  (NDWI = (B03 - B08)/(B03 + B08) > 0, as the rocks pilot and DEA Intertidal
  use), +4 for a dry pixel of lush land vegetation (NDVI > 0.7) where B04 was read;
- the acquisitions in the bottom or top tide percentiles at one of the
  tile's stations (the composite candidates) also B02 and B04: natural colour,
  in the working files' 8-bit square-root encoding (common.encode_refl), 0
  where not usable or hazy (B02 > 0.22).

And the summer scenes (the clearest of summer.months in summer.years), over
all the tile's blocks: natural colour as above.

Only windows of the bands are read (HTTP ranges on the COGs, signed per read
by planetary_computer; no account), and nothing but these bytes is kept:
<root>/downloads/s2/<tile>/{coast,summer}/<stamp>.npz, one member per block
(c<row>_<col> codes, (512, 512); r<row>_<col> colour, (3, 512, 512)), and
log.jsonl. A scene already written is not read again.

    python -I fetch.py --tile 29UPV [--workers 24] [--summer-only]
"""
import argparse
import concurrent.futures as cf
import json
import os
import sys
import threading
import time
import zipfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "6")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "3")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
os.environ.setdefault("GDAL_CACHEMAX", "512")
os.environ.setdefault("VSI_CACHE", "FALSE")

LOG_LOCK = threading.Lock()


def offset_of(item):
    try:
        return 1000 if float(item.get("baseline") or 0) >= 4.0 else 0
    except ValueError:
        return 0


def row_runs(blocks):
    """{row: [(first col, last col), ...]} of contiguous blocks."""
    out = {}
    for i, j in sorted(map(tuple, blocks)):
        runs = out.setdefault(i, [])
        if runs and runs[-1][1] == j - 1:
            runs[-1] = (runs[-1][0], j)
        else:
            runs.append((j, j))
    return out


class Scene:
    """The signed bands of one acquisition, opened on demand."""

    def __init__(self, item):
        self.item = item
        self.off = offset_of(item)
        self.ds = {}

    def open(self, band):
        import planetary_computer
        import rasterio
        if band not in self.ds:
            self.ds[band] = rasterio.open(planetary_computer.sign(self.item["href"][band]))
        return self.ds[band]

    def read(self, band, window, size):
        from rasterio.windows import Window
        r0, c0, h, w = window
        ds = self.open(band)
        a = ds.read(1, window=Window(c0, r0, w, h), boundless=True, fill_value=0)
        if band == "SCL":
            return a
        a = a.astype(np.float32)
        if self.off:
            a = np.where(a > 0, np.maximum(a - self.off, 1), 0)
        return a / 10000.0

    def close(self):
        for d in self.ds.values():
            d.close()
        self.ds = {}


def scl_bad(scl):
    """SCL's unusable classes, its clouds and shadows grown by 2 pixels (40 m), at 20 m."""
    from scipy import ndimage
    cloud = np.isin(scl, common.SCL_CLOUD)
    grown = ndimage.binary_dilation(cloud, iterations=2) if cloud.any() else cloud
    return np.isin(scl, common.SCL_BAD) | grown


def up2(a, shape):
    """A 20 m array onto the 10 m pixels (each 20 m pixel is 2×2 of them)."""
    return np.repeat(np.repeat(a, 2, axis=0), 2, axis=1)[:shape[0], :shape[1]]


def block_fraction(bad20, blocks, size):
    """Share of the blocks' 20 m pixels that are bad (the padding past the tile counts as bad)."""
    half = size // 2
    tot = bad = 0
    for i, j in blocks:
        sub = bad20[i * half:(i + 1) * half, j * half:(j + 1) * half]
        tot += half * half
        bad += int(sub.sum()) + (half * half - sub.size)
    return bad / max(tot, 1)


class NpzWriter:
    """An .npz written member by member, so a scene never sits whole in memory."""

    def __init__(self, path):
        self.path = path
        self.tmp = path + ".part"
        self.zf = zipfile.ZipFile(self.tmp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=3)

    def add(self, name, array):
        with self.zf.open(name + ".npy", "w", force_zip64=True) as fh:
            np.lib.format.write_array(fh, np.ascontiguousarray(array), allow_pickle=False)

    def close(self):
        self.zf.close()
        os.replace(self.tmp, self.path)

    def abort(self):
        self.zf.close()
        if os.path.exists(self.tmp):
            os.remove(self.tmp)


def read_rows(scene, blocks, size, bands, scl20):
    """Yield (row, cols, {band: array (n blocks, size, size)}, bad (n, size, size)) per row of blocks."""
    for i, runs in sorted(row_runs(blocks).items()):
        parts = {b: [] for b in bands}
        bad_parts = []
        for j0, j1 in runs:
            win = (i * size, j0 * size, size, (j1 - j0 + 1) * size)
            got = {b: scene.read(b, win, size) for b in bands}
            half = size // 2
            s20 = scl20[i * half:(i + 1) * half, j0 * half:(j1 + 1) * half]
            pad = np.ones((half, (j1 - j0 + 1) * half), dtype=bool)
            pad[:s20.shape[0], :s20.shape[1]] = s20
            bad = up2(pad, (size, (j1 - j0 + 1) * size))
            for k in range(j1 - j0 + 1):
                sl = slice(k * size, (k + 1) * size)
                for b in bands:
                    parts[b].append(got[b][:, sl])
                bad_parts.append(bad[:, sl])
        cols = [j for j0, j1 in runs for j in range(j0, j1 + 1)]
        yield i, cols, {b: np.stack(v) for b, v in parts.items()}, np.stack(bad_parts)


def coast_scene(item, plan_tile, size, candidate, out_dir, max_bad):
    path = os.path.join(out_dir, f"{item['stamp']}.npz")
    rec = {"stamp": item["stamp"], "kind": "coast", "candidate": candidate}
    if os.path.exists(path):
        return dict(rec, status="kept")
    blocks = plan_tile["coastalBlocks"]
    scene = Scene(item)
    writer = None
    try:
        scl = scene.read("SCL", (0, 0, 5490, 5490), size)
        bad20 = scl_bad(scl)
        frac = block_fraction(bad20, blocks, size)
        rec["bad"] = round(frac, 3)
        if frac > max_bad:
            return dict(rec, status="cloudy")
        bands = ["B03", "B08"] + (["B02", "B04"] if candidate else [])
        writer = NpzWriter(path)
        for i, cols, b, bad in read_rows(scene, blocks, size, bands, bad20):
            g, n = b["B03"], b["B08"]
            bad = bad | (g <= 0) | (n <= 0) | (g > 0.22)
            if candidate:
                bad |= b["B02"] > 0.22
            wet = (g - n) > 0
            code = np.where(bad, 0, np.where(wet, 2, 1)).astype(np.uint8)
            if candidate:
                r = b["B04"]
                lush = ~wet & ~bad & ((n - r) / np.maximum(n + r, 1e-4) > 0.7)
                code[lush] |= 4
                rgb = np.stack([common.encode_refl(b["B04"]), common.encode_refl(g), common.encode_refl(b["B02"])], axis=1)
                rgb[np.broadcast_to(bad[:, None], rgb.shape)] = 0
                for k, j in enumerate(cols):
                    writer.add(f"r{i:02d}_{j:02d}", rgb[k])
            for k, j in enumerate(cols):
                writer.add(f"c{i:02d}_{j:02d}", code[k])
        writer.close()
        writer = None
        return dict(rec, status="kept")
    finally:
        if writer is not None:
            writer.abort()
        scene.close()


def summer_scene(item, plan_tile, size, out_dir, max_bad=0.9):
    path = os.path.join(out_dir, f"{item['stamp']}.npz")
    rec = {"stamp": item["stamp"], "kind": "summer"}
    if os.path.exists(path):
        return dict(rec, status="kept")
    blocks = plan_tile["coverageBlocks"]
    scene = Scene(item)
    writer = None
    try:
        scl = scene.read("SCL", (0, 0, 5490, 5490), size)
        bad20 = scl_bad(scl)
        frac = block_fraction(bad20, blocks, size)
        rec["bad"] = round(frac, 3)
        if frac > max_bad:
            return dict(rec, status="cloudy")
        writer = NpzWriter(path)
        for i, cols, b, bad in read_rows(scene, blocks, size, ["B02", "B03", "B04"], bad20):
            bad = bad | (b["B03"] <= 0) | (b["B02"] > 0.22)
            rgb = np.stack([common.encode_refl(b["B04"]), common.encode_refl(b["B03"]), common.encode_refl(b["B02"])], axis=1)
            rgb[np.broadcast_to(bad[:, None], rgb.shape)] = 0
            for k, j in enumerate(cols):
                writer.add(f"r{i:02d}_{j:02d}", rgb[k])
        writer.close()
        writer = None
        return dict(rec, status="kept")
    finally:
        if writer is not None:
            writer.abort()
        scene.close()


def summer_items(items, cfg):
    s = cfg["summer"]
    y0, y1 = s["years"]
    pool = [it for it in items if int(it["stamp"][4:6]) in s["months"] and y0 <= int(it["stamp"][:4]) <= y1
            and (it["nodata"] or 0) < 60]
    best = sorted((it for it in pool if (it["cloud"] or 100) <= s["maxTileCloud"]), key=lambda it: it["cloud"])
    if len(best) < s["maxScenes"] // 2:
        best = sorted(pool, key=lambda it: it["cloud"] or 100)
    return best[:s["maxScenes"]]


def candidates(items, stations, plan, tide_levels):
    """Which acquisitions are in a tide tail at one of the tile's stations."""
    out = {}
    for it in items:
        c = False
        for s in stations:
            lv = tide_levels[s].get(it["stamp"])
            th = plan["stations"].get(s)
            if lv is not None and th and (lv[0] <= th["low"] or lv[0] >= th["high"]):
                c = True
                break
        out[it["stamp"]] = c
    return out


def run(tile, workers, summer_only=False):
    cfg = common.config()
    plan = common.read_json(common.path("work", "plan.json"))
    pt = plan["tiles"][tile]
    size = plan["blockSize"]
    cat = common.read_json(common.path("downloads", "catalog", f"{tile}.json"))
    items = cat["items"]
    base = common.path("downloads", "s2", tile)
    os.makedirs(os.path.join(base, "coast"), exist_ok=True)
    os.makedirs(os.path.join(base, "summer"), exist_ok=True)
    log_path = os.path.join(base, "log.jsonl")
    done = {}
    if os.path.exists(log_path):
        with open(log_path) as fh:
            for line in fh:
                r = json.loads(line)
                if r.get("status") in ("kept", "cloudy"):
                    done[(r["kind"], r["stamp"])] = r
    jobs = []
    if pt["coastalBlocks"] and not summer_only:
        tide_levels = common.read_json(common.path("work", "tides", "scenes.json"))["levels"]
        cand = candidates(items, pt["stations"], plan, tide_levels)
        for it in items:
            r = done.get(("coast", it["stamp"]))
            # A look kept without its colour that is now a candidate (a station
            # added to the tile, a basin's lag) is read again, colour and all.
            if r and r["status"] == "kept" and cand[it["stamp"]] and not r.get("candidate"):
                p = os.path.join(base, "coast", f"{it['stamp']}.npz")
                if os.path.exists(p):
                    os.remove(p)
                r = None
            if r is None:
                jobs.append(("coast", it, cand[it["stamp"]]))
    for it in summer_items(items, cfg):
        if ("summer", it["stamp"]) not in done:
            jobs.append(("summer", it, None))
    print(f"{tile}: {len(jobs)} reads to do ({len(pt['coastalBlocks'])} coastal, "
          f"{len(pt['coverageBlocks'])} coverage blocks)", flush=True)
    t0 = time.time()

    def one(job):
        kind, it, cand_ = job
        for attempt in range(4):
            try:
                if kind == "coast":
                    return coast_scene(it, pt, size, cand_, os.path.join(base, "coast"), cfg["maxBadFraction"])
                return summer_scene(it, pt, size, os.path.join(base, "summer"))
            except Exception as e:  # network trouble, an expired signature: wait, re-sign, retry
                err = repr(e)[:300]
                time.sleep(5 * (attempt + 1))
        return {"stamp": it["stamp"], "kind": kind, "status": "error", "error": err}

    counts = {}
    with cf.ThreadPoolExecutor(workers) as pool:
        for n, rec in enumerate(pool.map(one, jobs), 1):
            with LOG_LOCK, open(log_path, "a") as fh:
                fh.write(json.dumps(rec) + "\n")
            counts[rec["status"]] = counts.get(rec["status"], 0) + 1
            if n % 50 == 0 or n == len(jobs):
                print(f"  {tile} [{n}/{len(jobs)}] {counts} {time.time() - t0:.0f} s", flush=True)
    return counts


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--tile", required=True, action="append")
    p.add_argument("--workers", type=int, default=24)
    p.add_argument("--summer-only", action="store_true")
    a = p.parse_args()
    for t in a.tile:
        run(t, a.workers, a.summer_only)


if __name__ == "__main__":
    sys.exit(main())
