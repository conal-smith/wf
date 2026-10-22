"""Build the map's LiDAR layer: the ground's height above LAT, shaded, as raster PMTiles.

Every LiDAR survey we hold (lidar.json's sources, in priority order), brought
to one datum (metres above LAT at each pixel's tide station), merged, and
drawn: a colour per height off lidar.json's ramp (which the index carries,
for the map's key), multiplied by a hillshade lit from the north-west. 512 px WebP tiles (lossy, alpha outside the coverage), z9 to z14.
Beside the archive, coverage.json (each source's outline, GeoJSON, with its
name, year, resolution and licence) and index.json.

Built per z11 tile (4096 px at z14, with a margin so the shade sees past its
edges) in parallel, then the overviews under z11 from the z11 grids.

    python -I build.py --data /Volumes/workdrive/lidar/data --work /Volumes/workdrive/lidar/work \\
        --out /Volumes/workdrive/lidar/out [--jobs 4] [--bbox w,s,e,n]

`--data` holds the downloads (README.md: where each comes from), which are
untrusted: run with `python -I`.
"""
import argparse
import glob
import io
import json
import math
import multiprocessing as mp
import os
import re
import shutil
import sys
import time
import warnings
from datetime import datetime, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
FOILDEPTH = os.path.join(REPO, "scripts", "foildepth")
EARTH = 2 * math.pi * 6378137.0
ORIGIN = EARTH / 2


def load_config(path=None):
    return json.load(open(path or os.path.join(HERE, "lidar.json")))


# ---- the colours -------------------------------------------------------------------


def ramp_stops(cfg):
    """lidar.json's ramp, sorted by height: [(metres, (r, g, b)), ...]."""
    stops = []
    for metres, value in cfg["ramp"]:
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            raise SystemExit(f"ramp: {value} is not a #rrggbb colour")
        stops.append((float(metres), tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))))
    return sorted(stops)


def colour(heights, ramp):
    """Heights (m above LAT, NaN for none) to float RGB (h, w, 3), linear between the stops."""
    xs = np.array([m for m, _ in ramp], np.float32)
    out = np.empty(heights.shape + (3,), np.float32)
    h = np.nan_to_num(heights, nan=xs[0])
    for c in range(3):
        out[..., c] = np.interp(h, xs, np.array([rgb[c] for _, rgb in ramp], np.float32))
    return out


def hillshade(heights, pixel_metres, hs, zoom, zmax):
    """Lambertian shade over the flat ground's (1 on the flat, more facing the
    light, less away), from central differences; a missing neighbour is taken
    at the pixel's own height, so the coverage's edge draws no cliff."""
    valid = np.isfinite(heights)
    h = np.where(valid, heights, 0).astype(np.float32)
    p = np.pad(h, 1, mode="edge")
    pv = np.pad(valid, 1, mode="edge")

    def side(dy, dx):
        v = p[1 + dy:1 + dy + h.shape[0], 1 + dx:1 + dx + h.shape[1]]
        ok = pv[1 + dy:1 + dy + h.shape[0], 1 + dx:1 + dx + h.shape[1]]
        return np.where(ok, v, h)

    k = hs["exaggeration"] * hs["perZoom"] ** (zmax - zoom)
    dzdx = (side(0, 1) - side(0, -1)) / (2 * pixel_metres) * k
    dzdn = (side(-1, 0) - side(1, 0)) / (2 * pixel_metres) * k  # rows run south
    az, alt = math.radians(hs["azimuth"]), math.radians(hs["altitude"])
    lx, ly, lz = math.cos(alt) * math.sin(az), math.cos(alt) * math.cos(az), math.sin(alt)
    shade = (-dzdx * lx - dzdn * ly + lz) / np.sqrt(dzdx ** 2 + dzdn ** 2 + 1)
    return np.clip(shade / lz, 0, 1.6)


def render(heights, pixel_metres, zoom, cfg, ramp):
    """Heights to RGBA uint8 (4, h, w): the colour, shaded; clear where none."""
    hs = cfg["hillshade"]
    valid = np.isfinite(heights)
    rgb = colour(heights, ramp)
    shade = hillshade(heights, pixel_metres, hs, zoom, cfg["maxzoom"])
    f = 1 + hs["strength"] * (shade - 1)
    lit = np.where(f[..., None] > 1, rgb + (255 - rgb) * np.minimum(f - 1, 1)[..., None] * 0.6, rgb * f[..., None])
    out = np.zeros((4,) + heights.shape, np.uint8)
    out[:3] = np.moveaxis(np.clip(np.round(lit), 0, 255).astype(np.uint8), -1, 0)
    out[:3, ~valid] = 0
    out[3] = np.where(valid, 255, 0)
    return out


def encode_webp(rgba, quality):
    from PIL import Image
    buf = io.BytesIO()
    if (rgba[3] == 255).all():
        Image.fromarray(np.moveaxis(rgba[:3], 0, -1), "RGB").save(buf, "WEBP", quality=quality, method=6)
    else:
        # The alpha lossless: the coverage's edge is a hard one, and stays so.
        Image.fromarray(np.moveaxis(rgba, 0, -1), "RGBA").save(buf, "WEBP", quality=quality, method=6,
                                                               alpha_quality=100)
    return buf.getvalue()


# ---- the grid ------------------------------------------------------------------------


def lonlat_of(x, y):
    """Web Mercator metres to lon/lat."""
    return (np.degrees(np.asarray(x) / 6378137.0),
            np.degrees(2 * np.arctan(np.exp(np.asarray(y) / 6378137.0)) - np.pi / 2))


def tile_range(bbox, z):
    """Tiles (x0, x1, y0, y1 inclusive) covering a lon/lat box at zoom z."""
    w, s, e, n = bbox
    k = 2 ** z

    def tx(lon):
        return int((lon + 180) / 360 * k)

    def ty(lat):
        r = math.radians(lat)
        return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * k)

    return tx(w), tx(e), ty(n), ty(s)


def tile_bounds(z, x, y):
    """A tile's Web Mercator box (left, bottom, right, top)."""
    span = EARTH / 2 ** z
    return -ORIGIN + x * span, ORIGIN - (y + 1) * span, -ORIGIN + (x + 1) * span, ORIGIN - y * span


def ground_metres(z, y, size):
    """A pixel's width on the ground at tile row y's middle, zoom z."""
    _, b, _, t = tile_bounds(z, 0, y)
    _, lat = lonlat_of(0, (b + t) / 2)
    return EARTH / 2 ** z / size * math.cos(math.radians(float(lat)))


def down2(heights):
    """Half size: the mean of each 2×2 block's heights where it has any."""
    h, w = heights.shape
    b = heights.reshape(h // 2, 2, w // 2, 2)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # an empty block is NaN, as meant
        return np.nanmean(b, axis=(1, 3)).astype(np.float32)


# ---- the sources ---------------------------------------------------------------------


def source_files(source, data):
    out = []
    for pattern in source["files"]:
        out += sorted(glob.glob(os.path.join(data, pattern)))
    if not out:
        raise SystemExit(f"{source['id']}: no files for {source['files']} under {data}")
    return out


def clean(a, source, nodata, path=""):
    """A source's cells as float32 heights in metres, NaN where none: its
    nodata, its fill values (`invalid`) and anything outside `validRange`. A
    file in another unit is scaled to metres (`scale`, by the file's name)."""
    a = a.astype(np.float32)
    bad = ~np.isfinite(a) | (a < -1e30)
    if nodata is not None and np.isfinite(nodata):
        bad |= a == np.float32(nodata)
    for v in source.get("invalid", []):
        bad |= a == np.float32(v)
    scale = source.get("scale", {}).get(os.path.basename(path)[:-4])
    if scale:
        a = a * np.float32(scale)
    lo, hi = source.get("validRange", [-1e9, 1e9])
    with np.errstate(invalid="ignore"):
        bad |= (a < lo) | (a > hi)
    a[bad] = np.nan
    return a


def file_bounds_lonlat(path, source):
    import rasterio
    from rasterio.warp import transform_bounds
    with rasterio.open(path) as src:
        crs = source.get("crs") or src.crs
        return list(transform_bounds(crs, 4326, *src.bounds, densify_pts=21))


def stations():
    """The tide stations with their land datums' LAT heights (foildepth's)."""
    sys.path.insert(0, FOILDEPTH)
    import national  # noqa: E402
    return national.load_stations(national.load_config()), national.station_cells


def datum_offset(transform, shape, block, datum, kind_cache={}):
    """Per pixel, the LAT height of OD Malin (`datum` MALIN) or OD Belfast
    (BELFAST) at its tide station: decided at each block's centre and
    interpolated between them."""
    from scipy import ndimage
    if "stations" not in kind_cache:
        kind_cache["stations"] = stations()
    st, station_cells = kind_cache["stations"]
    h, w = shape
    nb_y, nb_x = math.ceil(h / block), math.ceil(w / block)
    xs = transform.c + (np.arange(nb_x) + 0.5) * block * transform.a
    ys = transform.f - (np.arange(nb_y) + 0.5) * block * transform.a
    lon, _ = lonlat_of(xs, np.zeros_like(xs))
    _, lat = lonlat_of(np.zeros_like(ys), ys)
    idx, _ = station_cells(lon[None, :], lat[:, None], st)
    key = {"MALIN": "odMalin", "BELFAST": "odBelfast"}[datum]
    per = np.array([np.nan if s[key] is None else s[key] for s in st], np.float32)[idx]
    if np.isnan(per).all():
        raise SystemExit(f"no station near {lon[0]:.2f}, {lat[0]:.2f} gives {key}")
    if np.isnan(per).any():  # a station with no figure takes its neighbours'
        per = np.where(np.isnan(per), np.nanmean(per), per)
    # Block centres to pixel centres, linearly (edge blocks held flat).
    zy = (np.arange(h) + 0.5) / block - 0.5
    zx = (np.arange(w) + 0.5) / block - 0.5
    gy, gx = np.meshgrid(np.clip(zy, 0, nb_y - 1), np.clip(zx, 0, nb_x - 1), indexing="ij")
    return ndimage.map_coordinates(per, [gy, gx], order=1, mode="nearest").astype(np.float32)


def merged(job_sources, data, transform, shape, block):
    """The sources' heights on a Mercator grid, metres above LAT, first source first."""
    import rasterio
    import rasterio.errors
    import rasterio.windows
    from rasterio.warp import Resampling, reproject, transform_bounds
    from rasterio.windows import from_bounds as window_from_bounds
    out = np.full(shape, np.nan, np.float32)
    offsets = {}
    l, t = transform.c, transform.f
    r, b = l + shape[1] * transform.a, t - shape[0] * transform.a
    for source, files in job_sources:
        for path in files:
            with rasterio.open(path) as src:
                crs = source.get("crs") or src.crs
                sl, sb, sr, st = transform_bounds("EPSG:3857", crs, l, b, r, t, densify_pts=21)
                pad = 4 * max(src.res)
                win = window_from_bounds(sl - pad, sb - pad, sr + pad, st + pad, src.transform)
                try:
                    win = win.round_offsets().round_lengths().intersection(
                        rasterio.windows.Window(0, 0, src.width, src.height))
                except rasterio.errors.WindowError:
                    continue
                if win.width < 2 or win.height < 2:
                    continue
                a = clean(src.read(1, window=win), source, src.nodata, path)
                if not np.isfinite(a).any():
                    continue
                dst = np.full(shape, np.nan, np.float32)
                reproject(a, dst, src_transform=src.window_transform(win), src_crs=crs, dst_transform=transform,
                          dst_crs="EPSG:3857", resampling=Resampling.bilinear, src_nodata=np.nan,
                          dst_nodata=np.nan)
            if source["datum"] != "LAT":
                if source["datum"] not in offsets:
                    offsets[source["datum"]] = datum_offset(transform, shape, block, source["datum"])
                dst += offsets[source["datum"]]
            take = np.isnan(out) & np.isfinite(dst)
            out[take] = dst[take]
    return out


# ---- the tiles -----------------------------------------------------------------------


def chunk_job(job):
    """One z`chunkZoom` tile: its tiles at chunkZoom..maxzoom, and its grid at chunkZoom."""
    from pmtiles.tile import zxy_to_tileid
    from rasterio.transform import from_origin
    cx, cy, job_sources, data, tmp, cfg_path = job
    cfg = load_config(cfg_path)
    ramp = ramp_stops(cfg)
    size, zmax, zc, margin = cfg["tileSize"], cfg["maxzoom"], cfg["chunkZoom"], cfg["marginPixels"]
    k = 2 ** (zmax - zc)
    l, _, _, t = tile_bounds(zc, cx, cy)
    px = EARTH / 2 ** zmax / size
    n = k * size + 2 * margin
    transform = from_origin(l - margin * px, t + margin * px, px, px)
    heights = merged(job_sources, data, transform, (n, n), cfg["stationBlockPixels"])
    if not np.isfinite(heights).any():
        return cx, cy, 0
    written = 0
    m = margin
    level = heights
    for zoom in range(zmax, zc - 1, -1):
        span = 2 ** (zoom - zc)
        rgba = render(level, ground_metres(zoom, cy * span + span // 2, size), zoom, cfg, ramp)
        core = rgba[:, m:m + span * size, m:m + span * size]
        for ty in range(span):
            for tx in range(span):
                sub = core[:, ty * size:(ty + 1) * size, tx * size:(tx + 1) * size]
                if not sub[3].any():
                    continue
                with open(os.path.join(tmp, f"{zxy_to_tileid(zoom, cx * span + tx, cy * span + ty)}.webp"), "wb") as fh:
                    fh.write(encode_webp(sub, cfg["quality"]))
                written += 1
        if zoom > zc:
            level = down2(level)
            m //= 2
    grid = level[m:m + size, m:m + size]
    np.save(os.path.join(tmp, f"z{zc}-{cx}-{cy}.npy"), grid)
    return cx, cy, written


def overviews(tmp, cfg, ramp):
    """Under chunkZoom, from the chunks' grids: 2×2 children make a parent."""
    from pmtiles.tile import zxy_to_tileid
    size, zc = cfg["tileSize"], cfg["chunkZoom"]
    level = {}
    for f in os.listdir(tmp):
        if f.startswith(f"z{zc}-") and f.endswith(".npy"):
            _, x, y = f[:-4].split("-")
            level[(int(x), int(y))] = np.load(os.path.join(tmp, f))
    count = 0
    for zoom in range(zc - 1, cfg["minzoom"] - 1, -1):
        parents = {}
        for (x, y), g in level.items():
            parents.setdefault((x // 2, y // 2), {})[(x % 2, y % 2)] = g
        nxt = {}
        for (px, py), kids in parents.items():
            big = np.full((2 * size, 2 * size), np.nan, np.float32)
            for (ox, oy), g in kids.items():
                big[oy * size:(oy + 1) * size, ox * size:(ox + 1) * size] = g
            g = down2(big)
            nxt[(px, py)] = g
            if not np.isfinite(g).any():
                continue
            rgba = render(g, ground_metres(zoom, py, size), zoom, cfg, ramp)
            with open(os.path.join(tmp, f"{zxy_to_tileid(zoom, px, py)}.webp"), "wb") as fh:
                fh.write(encode_webp(rgba, cfg["quality"]))
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
             "max_lat_e7": int(n * 1e7), "center_zoom": max(zmin, 11), "center_lon_e7": int((w + e) / 2 * 1e7),
             "center_lat_e7": int((s + n) / 2 * 1e7)}, metadata)
    os.replace(path + ".part", path)
    return len(ids), os.path.getsize(path)


# ---- the coverage --------------------------------------------------------------------


def coverage_groups(cfg, data):
    """The outline's features: one per source, or per file where `perFile`."""
    out = []
    for s in cfg["sources"]:
        files = source_files(s, data)
        if s.get("perFile"):
            for f in files:
                stem = os.path.basename(f)[:-4]
                year = re.search(r"(\d{4})$", stem)
                out.append((dict(s, id=f"{s['id']}-{stem.split('_')[0].strip('-')}",
                                 name=s.get("places", {}).get(stem, stem),
                                 flown=year.group(1) if year else s["flown"]), [f]))
        else:
            out.append((s, files))
    return out


def coverage_feature(source, files, cfg):
    """One source's valid cells as a lon/lat (Multi)Polygon."""
    import rasterio
    from rasterio import features
    from rasterio.transform import from_origin
    from rasterio.warp import transform_geom
    from scipy import ndimage
    from shapely.geometry import mapping, shape
    from shapely.ops import unary_union
    cell = cfg["coverageCellMetres"]
    boxes, crs = [], None
    for f in files:
        with rasterio.open(f) as src:
            crs = source.get("crs") or src.crs
            boxes.append(src.bounds)
    x0 = math.floor(min(b.left for b in boxes) / cell) * cell
    y1 = math.ceil(max(b.top for b in boxes) / cell) * cell
    x1 = math.ceil(max(b.right for b in boxes) / cell) * cell
    y0 = math.floor(min(b.bottom for b in boxes) / cell) * cell
    W, H = int(round((x1 - x0) / cell)), int(round((y1 - y0) / cell))
    mask = np.zeros((H, W), bool)
    for f in files:
        with rasterio.open(f) as src:
            a = np.isfinite(clean(src.read(1), source, src.nodata, f))
            res = src.res[0]
            fct = max(1, int(round(cell / res)))
            # Each source cell into the coverage cell its centre falls in.
            rows, cols = np.nonzero(a[::max(1, fct // 2), ::max(1, fct // 2)])
            step = max(1, fct // 2)
            xs = src.bounds.left + (cols * step + 0.5) * res
            ys = src.bounds.top - (rows * step + 0.5) * res
            c = np.clip(((xs - x0) // cell).astype(int), 0, W - 1)
            r = np.clip(((y1 - ys) // cell).astype(int), 0, H - 1)
            mask[r, c] = True
    mask = ndimage.binary_closing(np.pad(mask, 2), iterations=1)[2:-2, 2:-2] | mask
    mask = ndimage.binary_fill_holes(mask)
    polys = [shape(g) for g, v in features.shapes(mask.astype(np.uint8), mask=mask,
                                                   transform=from_origin(x0, y1, cell, cell)) if v]
    geom = unary_union(polys).simplify(cfg["coverageSimplifyMetres"], preserve_topology=True)
    parts = [p for p in getattr(geom, "geoms", [geom]) if p.area >= cfg["coverageMinKm2"] * 1e6]
    if not parts:
        return None
    from shapely.geometry import MultiPolygon, Polygon
    geom = MultiPolygon([Polygon(p.exterior) for p in parts])
    g = transform_geom(crs, "EPSG:4326", mapping(geom))

    def rnd(c):
        return [round(c[0], 4), round(c[1], 4)]

    g = {"type": "MultiPolygon", "coordinates": [[[rnd(c) for c in ring] for ring in poly] for poly in g["coordinates"]]}
    km2 = sum(p.area for p in parts) / 1e6
    props = {k: source[k] for k in ("id", "name", "kind", "flown", "resolution", "by", "licence")}
    props["km2"] = round(km2, 1)
    return {"type": "Feature", "id": source["id"], "properties": props, "geometry": g}


# ---- the run -------------------------------------------------------------------------


def build_tiles(cfg, cfg_path, a, chunks, ramp, bounds, t0):
    """Every chunk's tiles, the overviews, and the archive: (tiles, bytes)."""
    by_id = {s["id"]: s for s in cfg["sources"]}
    order = [s["id"] for s in cfg["sources"]]
    jobs = []
    tmp = os.path.join(a.work, "tiles")
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    for (x, y), per in sorted(chunks.items()):
        js = [(by_id[i], per[i]) for i in order if i in per]
        jobs.append((x, y, js, a.data, tmp, cfg_path))
    print(f"{len(jobs)} z{cfg['chunkZoom']} chunks", flush=True)
    tiles = 0
    with mp.get_context("spawn").Pool(a.jobs) as pool:
        for n, (x, y, written) in enumerate(pool.imap_unordered(chunk_job, jobs), 1):
            tiles += written
            if n % 10 == 0 or n == len(jobs):
                print(f"  [{n}/{len(jobs)}] {tiles} tiles, {time.time() - t0:.0f} s", flush=True)
    tiles += overviews(tmp, cfg, ramp)
    meta = {"name": "wingfoil LiDAR", "format": "webp",
            "description": "The ground's height above LAT from LiDAR, coloured (index.json's ramp) and "
                           "hillshaded",
            "attribution": cfg["attribution"]}
    os.makedirs(a.out, exist_ok=True)
    ntiles, nbytes = pack(tmp, os.path.join(a.out, "lidar.pmtiles"), cfg["minzoom"], cfg["maxzoom"], bounds, meta)
    print(f"lidar.pmtiles: {ntiles} tiles, {nbytes / 1e6:.1f} MB ({time.time() - t0:.0f} s)", flush=True)
    shutil.rmtree(tmp, ignore_errors=True)
    return ntiles, nbytes


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", required=True)
    p.add_argument("--work", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--config")
    p.add_argument("--jobs", type=int, default=4)
    p.add_argument("--bbox", help="w,s,e,n: only the chunks in it (a trial)")
    p.add_argument("--coverage-only", action="store_true",
                   help="keep --out's lidar.pmtiles; write coverage.json and index.json again")
    a = p.parse_args()
    cfg = load_config(a.config)
    cfg_path = a.config or os.path.join(HERE, "lidar.json")
    ramp = ramp_stops(cfg)
    t0 = time.time()

    # Every file's box, and the chunks each source meets.
    sources = []
    chunks = {}
    union = [180, 90, -180, -90]
    for s in cfg["sources"]:
        files = source_files(s, a.data)
        boxes = {f: file_bounds_lonlat(f, s) for f in files}
        sb = [min(b[0] for b in boxes.values()), min(b[1] for b in boxes.values()),
              max(b[2] for b in boxes.values()), max(b[3] for b in boxes.values())]
        union = [min(union[0], sb[0]), min(union[1], sb[1]), max(union[2], sb[2]), max(union[3], sb[3])]
        sources.append(dict(s, bounds=[round(v, 4) for v in sb], files=len(files)))
        for f, b in boxes.items():
            x0, x1, y0, y1 = tile_range(b, cfg["chunkZoom"])
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    chunks.setdefault((x, y), {}).setdefault(s["id"], []).append(f)
    if a.bbox:
        bb = [float(v) for v in a.bbox.split(",")]
        x0, x1, y0, y1 = tile_range(bb, cfg["chunkZoom"])
        chunks = {k: v for k, v in chunks.items() if x0 <= k[0] <= x1 and y0 <= k[1] <= y1}
    archive = os.path.join(a.out, "lidar.pmtiles")
    bounds = [round(union[0] - 0.001, 4), round(union[1] - 0.001, 4), round(union[2] + 0.001, 4),
              round(union[3] + 0.001, 4)]
    if a.coverage_only:
        from pmtiles.reader import MmapSource, Reader
        with open(archive, "rb") as fh:
            ntiles = Reader(MmapSource(fh)).header()["addressed_tiles_count"]
        nbytes = os.path.getsize(archive)
    else:
        ntiles, nbytes = build_tiles(cfg, cfg_path, a, chunks, ramp, bounds, t0)
    feats = []
    for s, files in coverage_groups(cfg, a.data):
        f = coverage_feature(s, files, cfg)
        if f:
            feats.append(f)
            print(f"  coverage {f['id']}: {f['properties']['km2']} km²", flush=True)
    with open(os.path.join(a.out, "coverage.json"), "w") as fh:
        json.dump({"type": "FeatureCollection", "features": feats}, fh, separators=(",", ":"))
        fh.write("\n")

    keep = ("id", "name", "kind", "flown", "resolution", "by", "licence", "bounds")
    index = {
        "schemaVersion": 1, "kind": "lidar",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "datum": "LAT",
        "url": "lidar.pmtiles", "coverage": "coverage.json",
        "bounds": bounds, "minzoom": cfg["minzoom"], "maxzoom": cfg["maxzoom"], "tileSize": cfg["tileSize"],
        "ramp": [[m, "#%02x%02x%02x" % rgb] for m, rgb in ramp],
        "sources": [{k: s[k] for k in keep} for s in sources],
        "areaKm2": round(sum(f["properties"]["km2"] for f in feats), 1),
        "stats": {"tiles": ntiles, "bytes": nbytes},
        "attribution": cfg["attribution"],
    }
    with open(os.path.join(a.out, "index.json"), "w") as fh:
        json.dump(index, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print(f"done: {a.out} ({time.time() - t0:.0f} s)")


if __name__ == "__main__":
    sys.exit(main())
