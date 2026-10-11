"""Build the foilable-depth elevation archives of the pilot areas (areas.json).

One area at a time, from the sources listed for it in areas.json, in order of
increasing trust (a later source wins over an earlier one where it has data):

1. reproject every source onto one Web Mercator grid at the area's max zoom;
2. bring each to metres above LAT, positive up (OD Malin + the station's
   offset; a depth below LAT negated);
3. merge, feathering each source's edge over a few pixels, and for a
   topographic LiDAR not trusting a return that sits well above the bathymetry
   under it (that is the water surface the aircraft saw, not the bed);
4. mask to the sea and the intertidal: ground at or under the dry ceiling
   (HAT + margin) that is connected to water below LAT; everything else is
   written as `landMetres`, which the map draws as nothing;
5. the depth cut: water deeper than `floorMetres` (5 m under LAT) is deep
   enough at every tide, so its height is not kept: it is written as
   `deepMetres`, which the map draws as nothing too (the chart's own tints
   carry it) but a tapped point can still tell from land. Then quantise to
   1/32 m, encode as Terrarium RGB in lossless WebP, pyramid down to the min
   zoom, and pack one PMTiles archive, leaving out the tiles with nothing to
   draw; each of the area's basins (water held up behind a weir, with a level
   of its own) is cut out of it into an archive of its own.

Steps 1-5 are shared with the national regions (national.py), which run them
chunk by chunk with a ceiling and waterline levels per pixel.

It also writes the pilot entries of the index (see national.py for the
index the map loads).

Usage (from anywhere; downloads stay outside the repo):

    python -I build.py --data /tmp/wf-foildepth/data --out /tmp/wf-foildepth/out [--area dublin-north]

Needs numpy, scipy, rasterio, pillow and pmtiles (see README.md).
"""
import argparse
import glob
import io
import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np
import rasterio
from rasterio import features
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.transform import from_origin
from rasterio.windows import Window, from_bounds
from scipy import ndimage
from PIL import Image
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # `python -I` leaves the script's own folder off the path
from waterlines import waterline_surface  # noqa: E402
EARTH = 2 * math.pi * 6378137.0
ORIGIN = EARTH / 2
QUANTUM = 1 / 32  # metres
UNSURVEYED_BELOW = 20.0  # any height under this (and over the deep value) is a surveyed one


def merc(lon, lat):
    x = math.radians(lon) * 6378137.0
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * 6378137.0
    return x, y


def lonlat_of(x, y):
    """Web Mercator metres to lon/lat (arrays or scalars)."""
    return np.degrees(np.asarray(x) / 6378137.0), np.degrees(2 * np.arctan(np.exp(np.asarray(y) / 6378137.0)) - np.pi / 2)


def tile_range(bbox, z):
    """Tiles (x0..x1, y0..y1 inclusive) covering a lon/lat box at zoom z."""
    w, s, e, n = bbox
    n_tiles = 2 ** z

    def tx(lon):
        return int((lon + 180) / 360 * n_tiles)

    def ty(lat):
        r = math.radians(lat)
        return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n_tiles)

    return tx(w), tx(e), ty(n), ty(s)


def tile_grid(x0, x1, y0, y1, z, size):
    """The Mercator grid of whole tiles x0..x1, y0..y1 at zoom z: transform, width, height."""
    span = EARTH / 2 ** z
    px = span / size
    return from_origin(-ORIGIN + x0 * span, ORIGIN - y0 * span, px, px), (x1 - x0 + 1) * size, (y1 - y0 + 1) * size


def grid_for(bbox, z, size):
    """The Mercator grid of whole tiles at zoom z: transform, width, height, tiles."""
    x0, x1, y0, y1 = tile_range(bbox, z)
    transform, width, height = tile_grid(x0, x1, y0, y1, z, size)
    return transform, width, height, (x0, x1, y0, y1)


def grid_lonlat_bounds(transform, shape):
    h, w = shape
    lon0, lat0 = lonlat_of(transform.c, transform.f - h * transform.a)
    lon1, lat1 = lonlat_of(transform.c + w * transform.a, transform.f)
    return float(lon0), float(lat0), float(lon1), float(lat1)


def lonlat_polygon(ring):
    """A lon/lat ring as a GeoJSON polygon in Web Mercator metres."""
    return {"type": "Polygon", "coordinates": [[merc(lon, lat) for lon, lat in ring]]}


def polygon_mask(rings, transform, shape):
    """Pixels of the grid inside any of the lon/lat rings."""
    shapes = [(lonlat_polygon(r), 1) for r in rings if len(r) >= 3]
    if not shapes:
        return np.zeros(shape, dtype=bool)
    return features.rasterize(shapes, out_shape=shape, transform=transform, dtype="uint8").astype(bool)


def ring_overlaps(ring, bounds):
    w, s, e, n = bounds
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs) <= e and max(xs) >= w and min(ys) <= n and max(ys) >= s


def gap_fill_mask(spec, data_dir, transform, shape):
    """Where a gridded source has no survey of its own, only a gap-fill.

    EMODnet's DTM says, per release, which survey or model each cell came
    from (`emodnet:source_references`). Where no survey reached it fills in
    from GEBCO, a global grid that knows nothing of drying flats: off
    Sandymount that fill is a smooth hollow 2–11 m under LAT across sand that
    dries at every low water. Those cells are not a sounding, and go."""
    path = os.path.join(data_dir, spec["file"])
    if not os.path.exists(path):
        print(f"  gap-fill references missing: {path}; the fill is kept", file=sys.stderr)
        return np.zeros(shape, dtype=bool)
    rings = []
    with open(path) as fh:
        refs = json.load(fh)
    for f in refs.get("features", []):
        p = f.get("properties") or {}
        if str(p.get("release")) != str(spec["release"]):
            continue
        if not str(p.get("identifier", "")).startswith(tuple(spec["identifiers"])):
            continue
        g = f.get("geometry") or {}
        polys = [g["coordinates"]] if g.get("type") == "Polygon" else g.get("coordinates", []) if g.get("type") == "MultiPolygon" else []
        rings += [poly[0] for poly in polys]
    # Holes (a survey inside the fill) are rare at this scale; the outer ring is enough.
    bounds = grid_lonlat_bounds(transform, shape)
    rings = [[(x, y) for x, y, *_ in r] for r in rings]
    rings = [r for r in rings if ring_overlaps(r, bounds)]
    mask = polygon_mask(rings, transform, shape)
    print(f"  gap-fill: {len(rings)} {'/'.join(spec['identifiers'])} polygon(s), {mask.mean() * 100:.1f}% of the grid dropped")
    return mask


def read_window(ds, transform, width, height, pad=4):
    """The part of a dataset under the target grid (plus a few of its own
    pixels round it), as (array, its transform), or None if none."""
    left, top = transform.c, transform.f
    right, bottom = left + width * transform.a, top - height * transform.a
    try:
        w, s, e, n = transform_bounds("EPSG:3857", ds.crs, left, bottom, right, top, densify_pts=21)
    except Exception:
        return ds.read(1), ds.transform
    win = from_bounds(w, s, e, n, transform=ds.transform)
    c0 = max(0, int(math.floor(win.col_off)) - pad)
    r0 = max(0, int(math.floor(win.row_off)) - pad)
    c1 = min(ds.width, int(math.ceil(win.col_off + win.width)) + pad)
    r1 = min(ds.height, int(math.ceil(win.row_off + win.height)) + pad)
    if c1 <= c0 or r1 <= r0:
        return None
    win = Window(c0, r0, c1 - c0, r1 - r0)
    return ds.read(1, window=win), ds.window_transform(win)


def read_source(src, data_dir, transform, width, height, offset, gap=None):
    """One source on the target grid, metres above LAT positive up, NaN where none.

    `gap` marks the cells that are only a gap-fill (gap_fill_mask): dropped.
    Only the part of each file under the grid is read, so a source may be a
    folder of tiles or one large mosaic."""
    out = np.full((height, width), np.nan, dtype=np.float32)
    files = sorted({f for pattern in src["files"] for f in glob.glob(os.path.join(data_dir, pattern))})
    if not files:
        print(f"  {src['name']}: no files for {src['files']}, skipped", file=sys.stderr)
        return None
    used = 0
    for path in files:
        with rasterio.open(path) as ds:
            got = read_window(ds, transform, width, height)
            if got is None:
                continue
            band, band_transform = got
            band = band.astype(np.float32)
            nodata = src.get("nodata", ds.nodata)
            if nodata is not None:
                band[band == np.float32(nodata)] = np.nan
            for bad in src.get("invalid", []):
                band[band == np.float32(bad)] = np.nan
            lo, hi = src.get("validRange", [-1000, 1000])
            band[(band < lo) | (band > hi)] = np.nan
            if not np.isfinite(band).any():
                continue
            dest = np.full((height, width), np.nan, dtype=np.float32)
            reproject(
                band, dest,
                src_transform=band_transform, src_crs=src.get("crs", ds.crs),
                dst_transform=transform, dst_crs="EPSG:3857",
                src_nodata=np.nan, dst_nodata=np.nan,
                resampling=Resampling.bilinear if src.get("smooth", True) else Resampling.nearest,
            )
            take = np.isfinite(dest) & ~np.isfinite(out)
            out[take] = dest[take]
            used += 1
    if gap is not None:
        out[gap] = np.nan
    z = out * float(src.get("scale", 1.0))
    if src.get("positive", "up") == "down":
        z = -z
    datum = src.get("datum", "LAT").upper()
    if datum == "MALIN":
        z = z + offset
    elif datum != "LAT":
        raise ValueError(f"{src['name']}: unknown datum {datum}")
    z += float(src.get("shiftMetres", 0.0))
    if not used or not np.isfinite(z).any():
        print(f"  {src['name']}: nothing under the grid")
        return None
    print(f"  {src['name']}: {used} file(s), {np.isfinite(z).mean() * 100:.1f}% of the grid, "
          f"{np.nanmin(z):.2f}..{np.nanmax(z):.2f} m LAT")
    return z


def load_waterlines(src, data_dir, transform, shape):
    """The waterline features under the grid, from one GeoJSON or a folder of
    tiles of them (fetch_national.py), each feature once."""
    files = sorted({f for pattern in src["files"] for f in glob.glob(os.path.join(data_dir, pattern))})
    if not files:
        return None
    w, s, e, n = grid_lonlat_bounds(transform, shape)
    seen, kept = set(), []
    for path in files:
        if src.get("tiled"):
            # Named by their box (fetch_national.name_of): skip the ones elsewhere.
            try:
                bw, bs, be, bn = (float(v) for v in os.path.basename(path)[:-5].split("_"))
            except ValueError:
                continue
            if bw > e or be < w or bs > n or bn < s:
                continue
        with open(path) as fh:
            doc = json.load(fh)
        for f in doc.get("features", []):
            fid = f.get("id")
            if fid is not None:
                if fid in seen:
                    continue
                seen.add(fid)
            kept.append(f)
    return {"type": "FeatureCollection", "features": kept}


def feather_weight(valid, pixels):
    """0 at a source's edge rising to 1 `pixels` inside it."""
    if pixels <= 0:
        return valid.astype(np.float32)
    inside = ndimage.distance_transform_edt(valid)
    return np.clip(inside / pixels, 0, 1).astype(np.float32)


def merge_one(z, src, layer, feather, bathy, surface=None):
    """Lay one source over the merge so far, feathered in from its edges.

    `bathy` is the merge of the bathymetric surveys alone (not the waterline
    estimate), which a topographic LiDAR is checked against. `surface`, where
    finite, is a water level the flight saw there instead of the source's own
    (a lagoon held up above the sea's)."""
    valid = np.isfinite(layer)
    if src.get("kind") == "topo":
        # A topographic LiDAR sees the water's surface, not the bed under it:
        # where a bathymetric survey says the bed is well below the LiDAR, the
        # LiDAR is water and is not taken.
        water = valid & np.isfinite(bathy) & (layer - bathy > src.get("surfaceTolerance", 0.6))
        # Nor at or under the water level the flight is known to have seen.
        if "waterLevelLat" in src:
            water |= valid & (layer <= src["waterLevelLat"])
        if surface is not None:
            with np.errstate(invalid="ignore"):
                water |= valid & (layer <= surface)
        valid &= ~water
    w = feather_weight(valid, feather)
    blend = valid & np.isfinite(z)
    fresh = valid & ~np.isfinite(z)
    z[blend] = w[blend] * layer[blend] + (1 - w[blend]) * z[blend]
    z[fresh] = layer[fresh]
    return z


def sea_mask(z, ceiling, seed_below, min_pixels):
    """Ground at or under the ceiling and connected to water below `seed_below`."""
    with np.errstate(invalid="ignore"):
        low = np.isfinite(z) & (z <= ceiling)
    labels, count = ndimage.label(low, structure=np.ones((3, 3)))
    if not count:
        return low
    seeded = np.unique(labels[np.isfinite(z) & (z < seed_below) & low])
    seeded = seeded[seeded > 0]
    sizes = ndimage.sum(low, labels, index=seeded)
    keep = np.zeros(count + 1, dtype=bool)
    keep[seeded[sizes >= min_pixels]] = True
    return keep[labels]


def merge_sources(sources, cfg, data_dir, transform, shape, offset, levels=None, surface=None):
    """Steps 1-3: every source on the grid, merged, in metres above LAT.

    `levels`, if given, are the waterlines' heights above LAT (scalars or
    per-pixel grids keyed LAT/MSL/MHW) in place of each source's own.
    Returns the merge, the water under the satellite LAT line, the merge of
    the bathymetric surveys alone, the land above the MHW line, and the
    sources that had data here."""
    height, width = shape
    used = []
    z = np.full(shape, np.nan, dtype=np.float32)
    wet_at_lat = np.zeros(shape, dtype=bool)
    bathy = np.full(shape, np.nan, dtype=np.float32)
    above_mhw = np.zeros(shape, dtype=bool)
    # Cells a source only gap-filled: not a sounding, but not land either
    # (EMODnet fills land from a land model, never from GEBCO).
    gap_fill = np.zeros(shape, dtype=bool)
    for src in sources:
        if src.get("kind") == "waterlines":
            geo = load_waterlines(src, data_dir, transform, shape)
            if geo is None:
                print(f"  {src['name']}: no files for {src['files']}, skipped", file=sys.stderr)
                continue
            if not geo["features"]:
                continue
            layer, wet, land3, counts = waterline_surface(geo, levels if levels is not None else src["levels"],
                                                          transform, shape, z, coarsen=src.get("coarsen", 2),
                                                          sea_hint=gap_fill)
            print(f"  {src['name']}: {len(geo['features'])} lines, regions {counts}")
            # Under the LAT line is wet at every tide: an earlier source that
            # puts the bed above LAT there is wrong (EMODnet's fill), and goes.
            z[wet & (z > 0)] = np.nan
            wet_at_lat |= wet
            # Above the MHW line is land: the fallback's heights there (EMODnet
            # fills land with a coarse, low DEM that the sea mask would let
            # through) go; only a survey laid on later can say otherwise.
            z[land3] = np.nan
            above_mhw |= land3
        else:
            gap = gap_fill_mask(src["gapFill"], data_dir, transform, shape) if "gapFill" in src else None
            if gap is not None:
                gap_fill |= gap
            layer = read_source(src, data_dir, transform, width, height, offset, gap)
        if layer is None:
            continue
        if src.get("kind") == "bathy":
            bathy = merge_one(bathy, src, layer, cfg["featherPixels"], bathy)
        z = merge_one(z, src, layer, cfg["featherPixels"], bathy,
                      surface if src.get("kind") == "topo" else None)
        used.append(src)
    return z, wet_at_lat, bathy, above_mhw, used


def finish(z, wet_at_lat, bathy, above_mhw, outside, ceiling, cfg, metres_per_px, mhw=None):
    """Steps 4-5: the sea mask, the depth cut and the reserved values.

    `ceiling` is the dry ceiling, a scalar or one per pixel. Returns the grid
    to tile (heights above LAT from `floorMetres` up to the ceiling, and the
    reserved `deepMetres`, `noSurveyMetres` and `landMetres`) and counts."""
    floor, land, deep = cfg["floorMetres"], cfg["landMetres"], cfg["deepMetres"]
    # Wet at every tide, but nothing says how deep: drawn as its own class.
    unsurveyed = wet_at_lat & ~np.isfinite(z)
    # Beyond the MHW line a topographic LiDAR's low ground (fields and marsh
    # behind a beach, which the earlier prototype drew as foreshore) is not
    # sea either, unless a bathymetric survey has been there.
    z[above_mhw & ~np.isfinite(bathy)] = np.nan
    # And behind it, even a bathymetric survey's ground (a LiDAR flight's land
    # returns) is only foreshore up to a little over mean high water: salt
    # marsh a spring tide covers, not fields up to the dry ceiling.
    if mhw is not None:
        with np.errstate(invalid="ignore"):
            z[above_mhw & (z > mhw + cfg.get("marshAboveMhwMetres", 0.5))] = np.nan
    z[outside] = np.nan
    unsurveyed &= ~outside
    # Small holes of no data inside the water (a coarse fallback pixel thrown
    # out, a gap between survey legs) are water nobody sounded, not islands:
    # an island has a height.
    with np.errstate(invalid="ignore"):
        water = (np.isfinite(z) & (z <= ceiling)) | unsurveyed
    holes = ndimage.binary_fill_holes(water) & ~water & ~np.isfinite(z) & ~outside
    labels, count = ndimage.label(holes)
    if count:
        sizes = ndimage.sum(holes, labels, index=np.arange(1, count + 1))
        small = np.zeros(count + 1, dtype=bool)
        small[1:] = sizes <= cfg.get("maxHolePixels", 4000)
        unsurveyed |= small[labels]
    # Unsurveyed water is low enough to be sea, but cannot seed it: it is sea
    # only where it joins water a survey sounded (a lake the waterlines took
    # for sea would otherwise seed itself).
    zz = np.where(unsurveyed, 0.0, z)
    wet = sea_mask(zz, ceiling, cfg["seedBelowMetres"], cfg["minWaterPixels"])
    if mhw is not None:
        # The sea reaches up through ground that floods at a spring tide (to
        # MHW and a little over); above that, to the dry ceiling, only a
        # narrow upper beach beside it is foreshore. Fields and streets at
        # 3–5 m LAT joined to the shore through a chain of low ground (behind
        # Sandymount, round the Malahide and Rogerstown estuaries; EMODnet's
        # coarse land behind a broken MHW line) are land, not a drying flat.
        core = sea_mask(zz, np.minimum(ceiling, mhw + cfg.get("marshAboveMhwMetres", 0.5)),
                        cfg["seedBelowMetres"], cfg["minWaterPixels"])
        band = cfg.get("upperBeachMetres", 60) / metres_per_px
        wet &= core | (ndimage.distance_transform_edt(~core) <= band)
    surveyed = wet & ~unsurveyed
    with np.errstate(invalid="ignore"):
        kept = surveyed & (z >= floor)
        cut = surveyed & ~kept
    out = np.full(z.shape, land, dtype=np.float32)
    out[kept] = z[kept]
    # The depth cut: deeper than the floor is deep enough at every tide, so
    # its height is not kept, only that it is deep.
    out[cut] = deep
    # Unsurveyed water, by the whole stretch of it: a small one (a lagoon, the
    # strip between a flat's LAT line and the first soundings) is drawn as
    # such; a large one is a gap in the surveys out at sea (GEBCO's fill,
    # dropped), taken for deep and drawn as nothing. No distance from the
    # shore decides it, so no edge is a buffer's circle or a box's side: the
    # edges are the waterlines' and the surveys'.
    lost = wet & unsurveyed
    if lost.any():
        labels, count = ndimage.label(lost, structure=np.ones((3, 3)))
        sizes = ndimage.sum(lost, labels, index=np.arange(1, count + 1)) * metres_per_px ** 2 / 1e6
        small = np.zeros(count + 1, dtype=bool)
        small[1:] = sizes <= cfg.get("maxUnsurveyedKm2", 5.0)
        out[lost & small[labels]] = cfg["noSurveyMetres"]
        out[lost & ~small[labels]] = deep
    out = (np.round(out / QUANTUM) * QUANTUM).astype(np.float32)
    stats = {
        "pixels": int(np.isfinite(z).sum()),
        "intertidal": int((kept & (z > 0)).sum()),
        "subtidal": int((kept & (z <= 0)).sum()),
        "deep": int(cut.sum()),
        "cutOff": int((np.isfinite(z) & (z <= ceiling) & ~wet).sum()),
        "unsurveyed": int((out == cfg["noSurveyMetres"]).sum()),
    }
    return out, stats


def has_content(grid, cfg):
    """Anything to draw: a height from the floor up, or unsurveyed water."""
    return bool(((grid > cfg["deepMetres"] + 1) & (grid < cfg["landMetres"] - 1)).any())


def edge_value(out, cfg):
    """What a pixel left out of an archive (another region's, outside a
    pilot's box) is written as: deep where it is water of any kind, land
    where it is land.

    The map interpolates heights between pixels, and the deep value and land
    side by side would run through every colour between them: a hairline. So
    the two meet only where water meets land anyway, at the top of the shore,
    and the last pixel drawn fades into the deep value (water) or goes
    through the dry colour to nothing (land), as at the top of a beach."""
    deep, land = cfg["deepMetres"], cfg["landMetres"]
    return np.where(out < land - 1, deep, land).astype(np.float32)


def terrarium(tile):
    v = np.clip(tile + 32768.0, 0, 65535.99)
    whole = np.floor(v)
    rgb = np.empty(tile.shape + (3,), dtype=np.uint8)
    rgb[..., 0] = (whole // 256).astype(np.uint8)
    rgb[..., 1] = (whole % 256).astype(np.uint8)
    rgb[..., 2] = np.floor((v - whole) * 256).astype(np.uint8)
    return rgb


def encode(tile, method=6):
    buf = io.BytesIO()
    Image.fromarray(terrarium(tile), "RGB").save(buf, "WEBP", lossless=True, quality=100, method=method, exact=True)
    return buf.getvalue()


def downsample(z, cfg):
    """Half resolution. A heights' block is the mean of its heights (water
    wins over land, so the shore keeps its colours as it narrows); one with
    none is unsurveyed if any of it is, else deep if any of it is, else land.
    The reserved values are never averaged with a height: that would invent one."""
    land, deep, nosurvey = cfg["landMetres"], cfg["deepMetres"], cfg["noSurveyMetres"]
    h, w = z.shape
    blocks = z.reshape(h // 2, 2, w // 2, 2)
    heights = (blocks > deep + 1) & (blocks < UNSURVEYED_BELOW)
    total = np.where(heights, blocks, 0).sum(axis=(1, 3))
    count = heights.sum(axis=(1, 3))
    fallback = np.where((np.abs(blocks - nosurvey) < 0.5).any(axis=(1, 3)), nosurvey,
                        np.where((np.abs(blocks - deep) < 0.5).any(axis=(1, 3)), deep, land))
    mean = total / np.maximum(count, 1)
    return np.where(count > 0, np.round(mean / QUANTUM) * QUANTUM, fallback).astype(np.float32)


def pilot_cfg(cfg):
    """The reserved values, with the deep value for an older config."""
    out = dict(cfg)
    out.setdefault("deepMetres", -20)
    return out


def build_area(area, cfg, data_dir, out_dir, debug_dir=None):
    cfg = pilot_cfg(cfg)
    size = area.get("tileSize", cfg["tileSize"])
    zmax = area.get("maxzoom", cfg["maxzoom"])
    zmin = area.get("minzoom", cfg["minzoom"])
    land = cfg["landMetres"]
    offset = area["odMalinOffsetMetres"]
    # Built a little past the box (the whole tiles round it, and a margin): the
    # national regions take this grid as their most trusted source there, so
    # at the box's edge both archives hold the same heights and the seam
    # between them does not show.
    m_ = cfg.get("marginDegrees", 0.01)
    w_, s_, e_, n_ = area["bbox"]
    transform, width, height, (x0, x1, y0, y1) = grid_for([w_ - m_, s_ - m_, e_ + m_, n_ + m_], zmax, size)
    print(f"{area['id']}: z{zmax} {width}×{height} px ({transform.a:.2f} m Mercator)")

    # Basins: water held up behind a weir, with a level of its own (see
    # README.md). Each is cut out of the area's archive into one of its own.
    basins = area.get("basins", [])
    basin_masks = [polygon_mask([b["polygon"]], transform, (height, width)) for b in basins]
    surface = None
    for b, m in zip(basins, basin_masks):
        if "lidarWaterLat" in b:
            if surface is None:
                surface = np.full((height, width), np.nan, dtype=np.float32)
            surface[m] = b["lidarWaterLat"]

    z, wet_at_lat, bathy, above_mhw, used = merge_sources(area["sources"], cfg, data_dir, transform,
                                                          (height, width), offset, surface=surface)
    if not used:
        raise SystemExit(f"{area['id']}: no source data found under {data_dir}")

    # Only inside the area's box: the grid's whole tiles reach past it.
    cols = np.arange(width) * transform.a + transform.c + transform.a / 2
    rows = transform.f - (np.arange(height) + 0.5) * transform.a
    xw, ys = merc(w_, s_)
    xe, yn = merc(e_, n_)
    outside = (cols[None, :] < xw) | (cols[None, :] > xe) | (rows[:, None] < ys) | (rows[:, None] > yn)

    ceiling = area["dryCeilingMetres"]
    metres_per_px = transform.a * math.cos(math.radians((area["bbox"][1] + area["bbox"][3]) / 2))
    mhw = next((s["levels"]["MHW"] for s in area["sources"] if s.get("kind") == "waterlines"), None)
    out, stats = finish(z, wet_at_lat, bathy, above_mhw, np.zeros_like(outside), ceiling, cfg, metres_per_px, mhw)
    print(f"  mask: {stats}")
    if debug_dir:
        # The merged grid before tiling, past the box too: a look in QGIS, and
        # the national build's pilot source (national.json).
        os.makedirs(debug_dir, exist_ok=True)
        with rasterio.open(os.path.join(debug_dir, f"{area['id']}.tif"), "w", driver="GTiff",
                           width=width, height=height, count=1, dtype="float32", crs="EPSG:3857",
                           transform=transform, compress="deflate", nodata=None) as dst:
            dst.write(out.astype(np.float32), 1)
    # Past the box the regions draw: its water is written as deep, its land
    # as land (edge_value), so the last pixel drawn fades as the region's does.
    edge = edge_value(out, cfg)
    out = np.where(outside, edge, out).astype(np.float32)

    os.makedirs(out_dir, exist_ok=True)
    attribution = "; ".join(s["attribution"] for s in area["sources"] if "attribution" in s)
    sources = [{k: s[k] for k in ("name", "role", "years", "resolution", "licence")} for s in used]
    entries = []
    # Each basin first, so a reader that takes the first box a point is in
    # finds the basin; the area's own archive has the basins cut out.
    for b, m in zip(basins, basin_masks):
        bx0, bx1, by0, by1 = tile_range(b["bbox"], zmax)
        crop = np.where(m, out, edge)[(by0 - y0) * size:(by1 - y0 + 1) * size, (bx0 - x0) * size:(bx1 - x0 + 1) * size]
        mb = write_archive(crop, (bx0, by0, bx1, by1), size, zmin, zmax, b["bbox"],
                           os.path.join(out_dir, f"{b['id']}.pmtiles"), b["id"], cfg, attribution)
        stats[b["id"]] = {"mb": round(mb, 2)}
        entries.append({
            "id": b["id"], "name": b["name"], "url": f"{b['id']}.pmtiles",
            "bounds": b["bbox"], "minzoom": zmin, "maxzoom": zmax, "tileSize": size,
            "station": area["station"], "dryCeilingMetres": ceiling,
            "level": {k: b["level"][k] for k in ("floorLat", "rangeFactor", "lagHours")},
            "sources": sources,
        })
        out[m] = edge[m]
    mb = write_archive(out, (x0, y0, x1, y1), size, zmin, zmax, area["bbox"],
                       os.path.join(out_dir, f"{area['id']}.pmtiles"), area["id"], cfg, attribution)
    entries.append({
        "id": area["id"], "name": area["name"], "url": f"{area['id']}.pmtiles",
        "bounds": area["bbox"], "minzoom": zmin, "maxzoom": zmax, "tileSize": size,
        "station": area["station"], "dryCeilingMetres": ceiling,
        "sources": sources,
    })
    return entries, stats, mb


def pyramid(grid, tiles_at_max, size, zmin, zmax, cfg):
    """(zoom, x, y, tile) for a grid of whole tiles at the max zoom, down to the
    min zoom, padding with land to whole tiles at each. `tiles_at_max` is the
    grid's (x0, y0, x1, y1) tiles."""
    land = cfg["landMetres"]
    x0, y0, x1, y1 = tiles_at_max
    level = grid
    prev_x0 = prev_y0 = None
    for zoom in range(zmax, zmin - 1, -1):
        tx0, tx1, ty0, ty1 = (x0 >> (zmax - zoom), x1 >> (zmax - zoom), y0 >> (zmax - zoom), y1 >> (zmax - zoom))
        if zoom != zmax:
            # Pad to whole tiles at this zoom before halving.
            need_w = (tx1 - tx0 + 1) * size * 2
            need_h = (ty1 - ty0 + 1) * size * 2
            ox = (prev_x0 - tx0 * 2) * size
            oy = (prev_y0 - ty0 * 2) * size
            padded = np.full((need_h, need_w), land, dtype=np.float32)
            padded[oy:oy + level.shape[0], ox:ox + level.shape[1]] = level
            level = downsample(padded, cfg)
        for ty in range(ty0, ty1 + 1):
            for tx in range(tx0, tx1 + 1):
                tile = level[(ty - ty0) * size:(ty - ty0 + 1) * size, (tx - tx0) * size:(tx - tx0 + 1) * size]
                if tile.shape == (size, size):
                    yield zoom, tx, ty, tile
        prev_x0, prev_y0 = tx0, ty0


def write_pmtiles(path, tiles, zmin, zmax, bbox, metadata):
    """Pack (tile id, bytes) into one archive; identical tiles are stored once."""
    tiles = sorted(tiles, key=lambda t: t[0])
    w, s, e, n = bbox
    with open(path, "wb") as fh:
        writer = Writer(fh)
        for tid, data in tiles:
            writer.write_tile(tid, data)
        writer.finalize(
            {"tile_type": TileType.WEBP, "tile_compression": Compression.NONE,
             "min_zoom": zmin, "max_zoom": zmax,
             "min_lon_e7": int(w * 1e7), "min_lat_e7": int(s * 1e7),
             "max_lon_e7": int(e * 1e7), "max_lat_e7": int(n * 1e7),
             "center_zoom": max(zmin, zmax - 2), "center_lon_e7": int((w + e) / 2 * 1e7),
             "center_lat_e7": int((s + n) / 2 * 1e7)},
            metadata,
        )
    return os.path.getsize(path) / 1e6


def archive_metadata(name, cfg, attribution):
    return {"name": f"wingfoil foildepth {name}", "encoding": "terrarium",
            "description": "Seabed and foreshore, metres above LAT (Terrarium), from "
                           f"{cfg['floorMetres']} m up; {cfg['deepMetres']} m is deeper than that, "
                           f"{cfg['noSurveyMetres']} m is water of unsurveyed depth, "
                           f"{cfg['landMetres']} m is not water.",
            "attribution": attribution}


def write_archive(grid, tiles_at_max, size, zmin, zmax, bbox, path, name, cfg, attribution):
    """One PMTiles archive of a grid of whole tiles at the max zoom, pyramided
    down to the min zoom; tiles with nothing to draw are left out."""
    tiles = [(zxy_to_tileid(zoom, tx, ty), encode(tile))
             for zoom, tx, ty, tile in pyramid(grid, tiles_at_max, size, zmin, zmax, cfg)
             if has_content(tile, cfg)]
    mb = write_pmtiles(path, tiles, zmin, zmax, bbox, archive_metadata(name, cfg, attribution))
    print(f"  {name}: {len(tiles)} tiles, {mb:.2f} MB → {path}")
    return mb


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", required=True, help="the download directory (outside the repo)")
    parser.add_argument("--out", required=True, help="where the archives go (outside the repo; see national.py)")
    parser.add_argument("--config", default=os.path.join(HERE, "areas.json"))
    parser.add_argument("--area", action="append", help="only these areas (the index keeps the rest)")
    parser.add_argument("--debug", help="also write each merged grid as a GeoTIFF here (outside the repo)")
    args = parser.parse_args()
    cfg = json.load(open(args.config))
    index_path = os.path.join(args.out, "pilots.json")
    previous = {}
    if os.path.exists(index_path):
        previous = {a["id"]: a for a in json.load(open(index_path)).get("areas", [])}
    areas = []
    for area in cfg["areas"]:
        if args.area and area["id"] not in args.area:
            # Not rebuilt: its entries (its basins', then its own) as they were.
            areas += [previous.get(b["id"]) for b in area.get("basins", [])] + [previous.get(area["id"])]
            continue
        entries, _, _ = build_area(area, cfg, args.data, args.out, args.debug)
        areas += entries
    index = {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "areas": [a for a in areas if a],
    }
    with open(index_path, "w") as fh:
        json.dump(index, fh, indent=2)
        fh.write("\n")
    print(f"pilot entries → {index_path}")


if __name__ == "__main__":
    main()
