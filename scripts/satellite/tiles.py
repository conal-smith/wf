"""Cut compose.py's tiles into web-map archives.

- imagery: high.pmtiles and low.pmtiles, natural colour WebP (lossy, with
  alpha: the coverage fades out at sea), 512 px, z6 to z13 (5.8 m a pixel at
  53°N, the same as 256 px tiles at z14; the imagery is 10 m). Each Sentinel-2
  tile's pixels are blended by their weight (its share where the tiles
  overlap, times the fade at sea), so no tile edge shows. The colour stretch
  (imagery.white, gamma, saturation) is applied here, the same everywhere.
- intertidal: one archive per tide station's region (the foil-depth regions'
  cells and ids), Terrarium heights in lossless WebP as the foil-depth layer's
  (metres above LAT, 1/32 m), 512 px, z6 to z13; reserved values as in
  config.json's intertidalArchive. A pixel is taken from the Sentinel-2 tile
  with the most weight there, and only if that tile measured it against the
  pixel's own station.

Both are built per z10 tile (4096 px at z13) in parallel, then the overviews
below z10 from the z10 tiles.

    python -I tiles.py imagery [--tiles 29UPV,30UUF] [--bbox w,s,e,n] [--out DIR]
    python -I tiles.py intertidal [--tiles ...] [--out DIR]
"""
import argparse
import io
import math
import multiprocessing as mp
import os
import shutil
import sys
import time
from datetime import datetime, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402
import composite  # noqa: E402

CHUNK_Z = 10


def tile_bounds_merc(z, x, y):
    span = common.EARTH / 2 ** z
    half = common.EARTH / 2
    return -half + x * span, half - (y + 1) * span, -half + (x + 1) * span, half - y * span


def tile_range(bbox, z):
    w, s, e, n = bbox
    n_t = 2 ** z

    def tx(lon):
        return int((lon + 180) / 360 * n_t)

    def ty(lat):
        r = math.radians(lat)
        return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n_t)

    return tx(w), tx(e), ty(n), ty(s)


def sources(tiles=None):
    d = common.path("work", "tiles")
    out = []
    for t in sorted(os.listdir(d)):
        if tiles and t not in tiles:
            continue
        if os.path.exists(os.path.join(d, t, "stats.json")):
            out.append(t)
    return out


def source_bounds_lonlat(tile):
    import rasterio
    from rasterio.warp import transform_bounds
    with rasterio.open(common.path("work", "tiles", tile, "weight.tif")) as src:
        return transform_bounds(src.crs, 4326, *src.bounds, densify_pts=21)


def chunks_for(srcs, bbox=None):
    """The z10 tiles any source covers (and inside bbox, if given), where the coverage is."""
    import rasterio
    from rasterio.warp import reproject, Resampling
    from rasterio.transform import from_bounds
    out = set()
    for t in srcs:
        w, s, e, n = source_bounds_lonlat(t)
        if bbox:
            w, s, e, n = max(w, bbox[0]), max(s, bbox[1]), min(e, bbox[2]), min(n, bbox[3])
            if w >= e or s >= n:
                continue
        x0, x1, y0, y1 = tile_range((w, s, e, n), CHUNK_Z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                out.add((x, y))
    # Only those with coverage in them (the coarse grid, at 512 px a chunk).
    keep = []
    with rasterio.open(common.path("work", "coarse.tif")) as src:
        for x, y in sorted(out):
            l, b, r, t = tile_bounds_merc(CHUNK_Z, x, y)
            dst = np.zeros((64, 64), np.float32)
            reproject(rasterio.band(src, 1), dst, dst_transform=from_bounds(l, b, r, t, 64, 64), dst_crs="EPSG:3857",
                      resampling=Resampling.max)
            if dst.max() > 0:
                keep.append((x, y))
    return keep


def intersects(z, x, y, bbox):
    """Does tile z/x/y touch the lon/lat box?"""
    l, b, r, t = tile_bounds_merc(z, x, y)
    w, s = common.lonlat_of_merc(l, b)
    e, n = common.lonlat_of_merc(r, t)
    return w < bbox[2] and e > bbox[0] and s < bbox[3] and n > bbox[1]


def chunk_grid(x, y, zmax, size):
    from rasterio.transform import from_bounds
    k = 2 ** (zmax - CHUNK_Z)
    l, b, r, t = tile_bounds_merc(CHUNK_Z, x, y)
    n = k * size
    return from_bounds(l, b, r, t, n, n), n, k


def overlapping(srcs_bounds, x, y):
    l, b, r, t = tile_bounds_merc(CHUNK_Z, x, y)
    lw, lb = common.lonlat_of_merc(l, b)
    le, lt = common.lonlat_of_merc(r, t)
    return [tl for tl, (sw, ss, se, sn) in srcs_bounds.items() if sw < le and se > lw and ss < lt and sn > lb]


# ---- imagery -------------------------------------------------------------------


def display(code_rgb, cfg):
    """Codes (3, h, w) float to display RGB uint8: reflectance over the white
    point, saturation about the mean, then gamma."""
    im = cfg["imagery"]
    refl = composite.decode(code_rgb)
    v = refl / im["white"]
    lum = v.mean(axis=0, keepdims=True)
    v = lum + im["saturation"] * (v - lum)
    v = np.clip(v, 0, 1) ** (1 / im["gamma"])
    return np.round(v * 255).astype(np.uint8)


def encode_webp(rgba, quality):
    from PIL import Image
    buf = io.BytesIO()
    alpha = rgba[3]
    if (alpha == 255).all():
        Image.fromarray(np.moveaxis(rgba[:3], 0, -1), "RGB").save(buf, "WEBP", quality=quality, method=6)
    else:
        Image.fromarray(np.moveaxis(rgba, 0, -1), "RGBA").save(buf, "WEBP", quality=quality, method=6,
                                                               alpha_quality=60)
    return buf.getvalue()


def down2(premult):
    """(4, h, w) premultiplied float to half size."""
    c, h, w = premult.shape
    return premult.reshape(c, h // 2, 2, w // 2, 2).mean(axis=(2, 4))


def finish_rgba(premult, cfg):
    a = np.clip(premult[3], 0, 1)
    code = premult[:3] / np.maximum(premult[3], 1e-6)
    rgb = display(code, cfg)
    alpha = np.round(a * 255).astype(np.uint8)
    rgb[:, alpha == 0] = 0
    return np.concatenate([rgb, alpha[None]])


def imagery_chunk(job):
    import rasterio
    import rasterio.errors
    import rasterio.windows
    from rasterio.warp import reproject, Resampling
    option, x, y, srcs, tmp, clip = job
    cfg = common.config()
    im = cfg["imagery"]
    size, zmax = im["tileSize"], im["maxzoom"]
    transform, n, k = chunk_grid(x, y, zmax, size)
    acc = np.zeros((4, n, n), np.float32)
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds as win_from_bounds
    for t in srcs:
        with rasterio.open(common.path("work", "tiles", t, f"{option}.tif")) as src:
            # Only the part of the source under this chunk (and a margin).
            l, b, r, tp = transform_bounds("EPSG:3857", src.crs, *tile_bounds_merc(CHUNK_Z, x, y), densify_pts=21)
            win = win_from_bounds(l - 200, b - 200, r + 200, tp + 200, src.transform).round_offsets().round_lengths()
            try:
                win = win.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
            except rasterio.errors.WindowError:  # the chunk only touches the tile's lon/lat box
                continue
            data = src.read(window=win).astype(np.float32)
            w = data[3] / 255
            if w.max() == 0:
                continue
            pre = np.concatenate([data[:3] * w[None], w[None]])
            # Bilinear on the weight-premultiplied codes, so an edge never blends with "no value".
            dst = np.zeros((4, n, n), np.float32)
            reproject(pre, dst, src_transform=src.window_transform(win), src_crs=src.crs, dst_transform=transform,
                      dst_crs="EPSG:3857", resampling=Resampling.bilinear, src_nodata=None, dst_nodata=0)
            acc += dst
            del data, pre, dst
    written = 0
    level = acc
    for zoom in range(zmax, CHUNK_Z - 1, -1):
        m = 2 ** (zoom - CHUNK_Z)
        for ty in range(m):
            for tx in range(m):
                sub = level[:, ty * size:(ty + 1) * size, tx * size:(tx + 1) * size]
                if sub[3].max() < 1 / 255:
                    continue
                if clip and not intersects(zoom, x * m + tx, y * m + ty, clip):
                    continue
                rgba = finish_rgba(sub, cfg)
                data = encode_webp(rgba, im["quality"])
                from pmtiles.tile import zxy_to_tileid
                tid = zxy_to_tileid(zoom, x * m + tx, y * m + ty)
                with open(os.path.join(tmp, f"{tid}.webp"), "wb") as fh:
                    fh.write(data)
                written += 1
        if zoom > CHUNK_Z:
            level = down2(level)
    np.save(os.path.join(tmp, f"z10-{x}-{y}.npy"), level.astype(np.float32))
    return x, y, written


def overviews(tmp, zmin, size, finisher, down=None):
    """Below z10, from the z10 tiles' premultiplied grids."""
    from pmtiles.tile import zxy_to_tileid
    level = {}
    for f in os.listdir(tmp):
        if f.startswith("z10-"):
            _, x, y = f[:-4].split("-")
            level[(int(x), int(y))] = np.load(os.path.join(tmp, f))
    count = 0
    fill = 0.0 if down is None else common.config()["intertidalArchive"]["landMetres"]
    for zoom in range(CHUNK_Z - 1, zmin - 1, -1):
        parents = {}
        for (x, y), g in level.items():
            parents.setdefault((x // 2, y // 2), {})[(x % 2, y % 2)] = g
        nxt = {}
        for (px, py), kids in parents.items():
            c = next(iter(kids.values())).shape[0]
            big = np.full((c, 2 * size, 2 * size), fill, np.float32)
            for (ox, oy), g in kids.items():
                big[:, oy * size:(oy + 1) * size, ox * size:(ox + 1) * size] = g
            g = (down or down2)(big)
            nxt[(px, py)] = g
            data = finisher(g)
            if data is not None:
                with open(os.path.join(tmp, f"{zxy_to_tileid(zoom, px, py)}.webp"), "wb") as fh:
                    fh.write(data)
                count += 1
        level = nxt
    return count


def pack(tmp, path, zmin, zmax, bbox, metadata):
    from pmtiles.tile import Compression, TileType
    from pmtiles.writer import Writer
    ids = sorted(int(f[:-5]) for f in os.listdir(tmp) if f.endswith(".webp"))
    w, s, e, n = bbox
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".part", "wb") as fh:
        writer = Writer(fh)
        for tid in ids:
            with open(os.path.join(tmp, f"{tid}.webp"), "rb") as t:
                writer.write_tile(tid, t.read())
        writer.finalize(
            {"tile_type": TileType.WEBP, "tile_compression": Compression.NONE, "min_zoom": zmin, "max_zoom": zmax,
             "min_lon_e7": int(w * 1e7), "min_lat_e7": int(s * 1e7), "max_lon_e7": int(e * 1e7),
             "max_lat_e7": int(n * 1e7), "center_zoom": max(zmin, 8), "center_lon_e7": int((w + e) / 2 * 1e7),
             "center_lat_e7": int((s + n) / 2 * 1e7)}, metadata)
    os.replace(path + ".part", path)
    return len(ids), os.path.getsize(path)


def chunks_bbox(chunks):
    xs = [c[0] for c in chunks]
    ys = [c[1] for c in chunks]
    l, _, _, t = tile_bounds_merc(CHUNK_Z, min(xs), min(ys))
    _, b, r, _ = tile_bounds_merc(CHUNK_Z, max(xs), max(ys))
    w, s = common.lonlat_of_merc(l, b)
    e, n = common.lonlat_of_merc(r, t)
    return [round(float(w), 4), round(float(s), 4), round(float(e), 4), round(float(n), 4)]


def build_imagery(tiles, bbox, out_dir, jobs):
    cfg = common.config()
    im = cfg["imagery"]
    srcs = sources(tiles)
    sb = {t: source_bounds_lonlat(t) for t in srcs}
    chunks = chunks_for(srcs, bbox)
    print(f"imagery: {len(srcs)} source tiles, {len(chunks)} z10 chunks", flush=True)
    result = {}
    for option in ("high", "low"):
        t0 = time.time()
        tmp = common.path("work", "pmt", option)
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp)
        jobs_ = [(option, x, y, overlapping(sb, x, y), tmp, bbox) for x, y in chunks]
        jobs_ = [j for j in jobs_ if j[3]]
        with mp.get_context("spawn").Pool(jobs) as pool:
            for n, (x, y, written) in enumerate(pool.imap_unordered(imagery_chunk, jobs_), 1):
                if n % 10 == 0 or n == len(jobs_):
                    print(f"  {option} [{n}/{len(jobs_)}] {time.time() - t0:.0f} s", flush=True)

        def fin(g):
            if g[3].max() < 1 / 255:
                return None
            return encode_webp(finish_rgba(g, cfg), im["quality"])

        overviews(tmp, im["minzoom"], im["tileSize"], fin)
        meta = {"name": f"wingfoil satellite {option} tide", "format": "webp",
                "description": f"Sentinel-2 natural colour at {option} tide (median of the looks in the "
                               f"{'top' if option == 'high' else 'bottom'} 20% of each tide station's levels), "
                               "a shared summer composite inland",
                "attribution": ATTRIBUTION}
        box = chunks_bbox(chunks)
        ntiles, size = pack(tmp, os.path.join(out_dir, f"{option}.pmtiles"), im["minzoom"], im["maxzoom"], box, meta)
        print(f"{option}.pmtiles: {ntiles} tiles, {size / 1e6:.1f} MB ({time.time() - t0:.0f} s)", flush=True)
        result[option] = {"tiles": ntiles, "bytes": size}
        shutil.rmtree(tmp, ignore_errors=True)
    box = chunks_bbox(chunks)
    if bbox:
        box = [round(max(box[0], bbox[0]), 4), round(max(box[1], bbox[1]), 4),
               round(min(box[2], bbox[2]), 4), round(min(box[3], bbox[3]), 4)]
    common.write_json(os.path.join(out_dir, "index.json"), imagery_index(srcs, box, result))
    return result, box


ATTRIBUTION = ("Contains modified Copernicus Sentinel data 2017–2026, composited for wingfoil.ie; tide levels "
               "from the Marine Institute (CC BY 4.0), EOT20 (DGFI-TUM, CC BY 4.0) and UK tide gauges via "
               "Copernicus Marine and EMODnet Physics.")


def imagery_index(srcs, box, result):
    """The imagery's index (publish.py adds its `base`): the archives, and per
    station the median tide of the looks each image is made of there (the
    tile's figures, weighted by their pixels)."""
    cfg = common.config()
    im = cfg["imagery"]
    acc = {}
    for t in srcs:
        stats = common.read_json(common.path("work", "tiles", t, "stats.json"))
        for opt in ("high", "low"):
            for sid, v in stats.get(opt, {}).items():
                if not np.isfinite(v["medianTide"]):
                    continue
                a = acc.setdefault(sid, {"high": [0.0, 0], "low": [0.0, 0], "looks": {"high": [], "low": []}})
                a[opt][0] += v["medianTide"] * v["pixels"]
                a[opt][1] += v["pixels"]
                a["looks"][opt].append(v["looksMedian"])
    stations = []
    for s in common.stations():
        a = acc.get(s["id"])
        if not a or not a["high"][1] or not a["low"][1]:
            continue
        stations.append({"id": s["id"], "name": s["name"], "lonLat": [s["lon"], s["lat"]],
                         "high": round(a["high"][0] / a["high"][1], 2), "low": round(a["low"][0] / a["low"][1], 2),
                         "looks": {o: round(float(np.median(a["looks"][o])), 1) for o in ("high", "low")}})
    return {
        "schemaVersion": 1, "kind": "satellite",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "bounds": box, "minzoom": im["minzoom"], "maxzoom": im["maxzoom"], "tileSize": im["tileSize"],
        "options": {o: {"url": f"{o}.pmtiles"} for o in ("high", "low")},
        "stations": stations,
        "sentinel2Tiles": srcs,
        "stats": result,
        "attribution": ATTRIBUTION,
    }


# ---- intertidal ------------------------------------------------------------------


def terrarium(tile):
    v = np.clip(tile + 32768.0, 0, 65535.99)
    whole = np.floor(v)
    rgb = np.empty(tile.shape + (3,), dtype=np.uint8)
    rgb[..., 0] = (whole // 256).astype(np.uint8)
    rgb[..., 1] = (whole % 256).astype(np.uint8)
    rgb[..., 2] = np.floor((v - whole) * 256).astype(np.uint8)
    return rgb


def encode_heights(tile):
    from PIL import Image
    buf = io.BytesIO()
    Image.fromarray(terrarium(tile), "RGB").save(buf, "WEBP", lossless=True, quality=100, method=4, exact=True)
    return buf.getvalue()


def is_height(v, ia):
    return (v > ia["deepMetres"] + 1) & (v < 20)


def down_heights(z, ia):
    """Half size: the mean of a block's heights where it has any; else, in this
    order, below-the-lowest-tide-seen, no fit, deep, land if any of the block is."""
    h, w = z.shape
    b = z.reshape(h // 2, 2, w // 2, 2)
    hh = is_height(b, ia)
    total = np.where(hh, b, 0).sum(axis=(1, 3))
    count = hh.sum(axis=(1, 3))
    fallback = np.full((h // 2, w // 2), ia["landMetres"], np.float32)
    for v in (ia["deepMetres"], ia["noSurveyMetres"], ia["belowSeenMetres"]):
        fallback = np.where((np.abs(b - v) < 0.5).any(axis=(1, 3)), v, fallback)
    q = ia["quantumMetres"]
    return np.where(count > 0, np.round(total / np.maximum(count, 1) / q) * q, fallback).astype(np.float32)


def edge_value(v, ia):
    """Outside a region: deep where water of any kind, land where land (as the foil-depth layer)."""
    return np.where(v < ia["landMetres"] - 1, ia["deepMetres"], ia["landMetres"]).astype(np.float32)


def intertidal_chunk(job):
    import rasterio
    from rasterio.warp import reproject, Resampling
    x, y, srcs, tmp = job
    cfg = common.config()
    ia = cfg["intertidalArchive"]
    size, zmax = ia["tileSize"], ia["maxzoom"]
    transform, n, k = chunk_grid(x, y, zmax, size)
    best_w = np.zeros((n, n), np.float32)
    value = np.full((n, n), np.nan, np.float32)
    stn = np.full((n, n), -1, np.float32)
    for t in srcs:
        d = common.path("work", "tiles", t)
        w = np.zeros((n, n), np.float32)
        with rasterio.open(os.path.join(d, "weight.tif")) as src:
            reproject(rasterio.band(src, 1), w, dst_transform=transform, dst_crs="EPSG:3857",
                      resampling=Resampling.nearest)
        v = np.full((n, n), np.nan, np.float32)
        s = np.full((n, n), -1, np.float32)
        with rasterio.open(os.path.join(d, "heights.tif")) as src:
            reproject(rasterio.band(src, 1), v, dst_transform=transform, dst_crs="EPSG:3857",
                      resampling=Resampling.nearest, src_nodata=np.nan, dst_nodata=np.nan)
            reproject(rasterio.band(src, 6), s, dst_transform=transform, dst_crs="EPSG:3857",
                      resampling=Resampling.nearest, src_nodata=-99, dst_nodata=-1)
        better = (w > best_w) & np.isfinite(v)
        best_w = np.where(better, w, best_w)
        value = np.where(better, v, value)
        stn = np.where(better, s, stn)
    if not is_height(np.nan_to_num(value, nan=99), ia).any():
        return x, y, {}
    stations = common.stations()
    xs = transform.c + (np.arange(n) + 0.5) * transform.a
    ys = transform.f + (np.arange(n) + 0.5) * transform.e
    lon, _ = common.lonlat_of_merc(xs, np.zeros_like(xs))
    _, lat = common.lonlat_of_merc(np.zeros_like(ys), ys)
    # Per 4×4 block, as national.py: the block centres' station.
    blon, _ = common.region_block_lonlat(lon[::4], np.full(n // 4, lat[0]))
    _, blat = common.region_block_lonlat(np.full(n // 4, lon[0]), lat[::4])
    region = common.nearest_station(blon[None, :], blat[:, None], stations, ia["maxStationKm"])
    region = np.repeat(np.repeat(region, 4, axis=0), 4, axis=1)
    value = np.where(np.isfinite(value), value, ia["landMetres"]).astype(np.float32)
    # compose.py's heights are the raw flip levels: the bias against surveyed
    # ground (validate.py) comes off here, so it can be set after the run.
    q = ia["quantumMetres"]
    value = np.where(is_height(value, ia), np.round((value - cfg["heights"]["biasMetres"]) / q) * q,
                     value).astype(np.float32)
    # Measured against another station (the cells' edges fall a pixel differently in UTM): no fit.
    value = np.where((stn != region) & is_height(value, ia), ia["noSurveyMetres"], value)
    edge = edge_value(value, ia)
    from pmtiles.tile import zxy_to_tileid
    out = {}
    for r in np.unique(region[is_height(value, ia)]):
        grid = np.where(region == r, value, edge)
        rid = stations[r]["id"]
        rdir = os.path.join(tmp, rid)
        os.makedirs(rdir, exist_ok=True)
        level = grid
        written = 0
        for zoom in range(zmax, CHUNK_Z - 1, -1):
            m = 2 ** (zoom - CHUNK_Z)
            for ty in range(m):
                for tx in range(m):
                    sub = level[ty * size:(ty + 1) * size, tx * size:(tx + 1) * size]
                    if not is_height(sub, ia).any():
                        continue
                    with open(os.path.join(rdir, f"{zxy_to_tileid(zoom, x * m + tx, y * m + ty)}.webp"), "wb") as fh:
                        fh.write(encode_heights(sub))
                    written += 1
            if zoom > CHUNK_Z:
                level = down_heights(level, ia)
        np.save(os.path.join(rdir, f"z10-{x}-{y}.npy"), level[None])
        mine = (region == r)
        rows = np.flatnonzero((mine & is_height(value, ia)).any(axis=1))
        cols = np.flatnonzero((mine & is_height(value, ia)).any(axis=0))
        hv = value[mine & is_height(value, ia)]
        out[rid] = {"tiles": written, "bbox": [float(lon[cols[0]]), float(lat[rows[-1]]), float(lon[cols[-1]]),
                                               float(lat[rows[0]])],
                    "observedPixels": int(hv.size),
                    "belowSeenPixels": int((mine & (value == ia["belowSeenMetres"])).sum()),
                    "heightsSum": float(hv.sum())}
    return x, y, out


def build_intertidal(tiles, out_dir, jobs):
    cfg = common.config()
    ia = cfg["intertidalArchive"]
    srcs = sources(tiles)
    sb = {t: source_bounds_lonlat(t) for t in srcs}
    # Coastal chunks only: the coastal blocks are where the heights are.
    chunks = chunks_for(srcs)
    tmp = common.path("work", "pmt", "intertidal")
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    jobs_ = [(x, y, overlapping(sb, x, y), tmp) for x, y in chunks]
    jobs_ = [j for j in jobs_ if j[2]]
    t0 = time.time()
    regions = {}
    with mp.get_context("spawn").Pool(jobs) as pool:
        for n, (x, y, out) in enumerate(pool.imap_unordered(intertidal_chunk, jobs_), 1):
            for rid, r in out.items():
                g = regions.setdefault(rid, {"tiles": 0, "bbox": None, "observedPixels": 0, "belowSeenPixels": 0,
                                             "heightsSum": 0.0})
                b = r["bbox"]
                g["bbox"] = b if g["bbox"] is None else [min(g["bbox"][0], b[0]), min(g["bbox"][1], b[1]),
                                                           max(g["bbox"][2], b[2]), max(g["bbox"][3], b[3])]
                for kk in ("tiles", "observedPixels", "belowSeenPixels", "heightsSum"):
                    g[kk] += r[kk]
            if n % 20 == 0 or n == len(jobs_):
                print(f"  intertidal [{n}/{len(jobs_)}] {time.time() - t0:.0f} s", flush=True)
    stations = {s["id"]: s for s in common.stations()}
    scene_report = common.read_json(common.path("work", "tides", "scenes.json"))["report"]
    cal = common.read_json(common.path("work", "tides", "calibration.json"))["stations"]
    plan = common.read_json(common.path("work", "plan.json"))
    entries = []
    for sid, g in sorted(regions.items()):
        rdir = os.path.join(tmp, sid)

        def fin(gr):
            gr = gr[0]
            return encode_heights(gr) if is_height(gr, ia).any() else None

        overviews(rdir, ia["minzoom"], ia["tileSize"], fin, down=lambda big: down_heights(big[0], ia)[None])
        rid = common.region_id(sid, ia["regionPrefix"])
        st = stations[sid]
        bbox = [round(g["bbox"][0] - 0.001, 4), round(g["bbox"][1] - 0.001, 4), round(g["bbox"][2] + 0.001, 4),
                round(g["bbox"][3] + 0.001, 4)]
        meta = {"name": f"wingfoil intertidal {rid}", "encoding": "terrarium",
                "description": "Intertidal heights from Sentinel-2 at known tides, metres above LAT (Terrarium); "
                               f"{ia['belowSeenMetres']} m is wet at every tide seen, {ia['noSurveyMetres']} m no fit, "
                               f"{ia['landMetres']} m dry at every tide seen or not joined to the sea, "
                               f"{ia['deepMetres']} m another region's water.",
                "attribution": ATTRIBUTION}
        ntiles, nbytes = pack(rdir, os.path.join(out_dir, f"{rid}.pmtiles"), ia["minzoom"], ia["maxzoom"], bbox, meta)
        th = plan["stations"].get(sid, {})
        entries.append({
            "id": rid, "kind": "region", "name": f"Intertidal heights on the {st['name']} tide",
            "url": f"{rid}.pmtiles", "bounds": bbox, "minzoom": ia["minzoom"], "maxzoom": ia["maxzoom"],
            "tileSize": ia["tileSize"], "station": sid, "stationLonLat": [st["lon"], st["lat"]],
            "northernIreland": st["ni"],
            "lowestSeenMetres": th.get("range", [None])[0], "highestSeenMetres": th.get("range", [None, None])[1],
            "tide": {k: cal[sid].get(k) for k in ("reference", "shiftMinutes", "a", "b", "rms")} | {
                "gaugeShare": scene_report[sid]["gaugeShare"]},
            "stats": {"tiles": ntiles, "bytes": nbytes, "observedPixelsZ13": g["observedPixels"],
                      "belowSeenPixelsZ13": g["belowSeenPixels"],
                      "meanHeight": round(g["heightsSum"] / max(g["observedPixels"], 1), 2)},
        })
        print(f"{rid}: {ntiles} tiles, {nbytes / 1e6:.2f} MB, {g['observedPixels']} height pixels at z13", flush=True)
    shutil.rmtree(tmp, ignore_errors=True)
    index = {
        "schemaVersion": 1, "kind": "intertidal",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "datum": "LAT", "encoding": "terrarium", "quantumMetres": ia["quantumMetres"],
        "deepMetres": ia["deepMetres"], "landMetres": ia["landMetres"], "noSurveyMetres": ia["noSurveyMetres"],
        "belowSeenMetres": ia["belowSeenMetres"], "biasRemovedMetres": cfg["heights"]["biasMetres"],
        "meaning": {
            "height": "the station's level (m above LAT) at which the pixel covers and uncovers, from Sentinel-2 "
                      "looks 2017-2026 at known tides, less biasRemovedMetres",
            "belowSeenMetres": "wet in every look: its bed is below the lowest tide seen (lowestSeenMetres)",
            "noSurveyMetres": "looked at, but no height: too few looks, a poor fit, or measured against another "
                              "station at a cell's edge",
            "landMetres": "dry in every look (above the highest tide seen), lush land vegetation, or not joined "
                          "to the sea",
            "deepMetres": "another region's water (the cells' edges, as the foil-depth archives write them)",
        },
        "areas": entries, "attribution": ATTRIBUTION,
    }
    common.write_json(os.path.join(out_dir, "index.json"), index)
    return index


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("what", choices=["imagery", "intertidal"])
    p.add_argument("--tiles", help="comma-separated Sentinel-2 tiles (default: every composed one)")
    p.add_argument("--bbox", help="w,s,e,n: only the z10 tiles in it (imagery)")
    p.add_argument("--out")
    p.add_argument("--jobs", type=int, default=4)
    a = p.parse_args()
    tiles = a.tiles.split(",") if a.tiles else None
    bbox = [float(v) for v in a.bbox.split(",")] if a.bbox else None
    if a.what == "imagery":
        out = a.out or common.path("out", "satellite")
        result, box = build_imagery(tiles, bbox, out, a.jobs)
        print(result, box)
    else:
        out = a.out or common.path("out", "intertidal")
        build_intertidal(tiles, out, a.jobs)


if __name__ == "__main__":
    sys.exit(main())
