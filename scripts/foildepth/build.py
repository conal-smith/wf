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
UNSURVEYED_BELOW = 20.0  # any height under this (and over the deep value) is a height
# An estimated height (water no survey reached, filled from the heights round
# it) is written a 64th of a metre over its 1/32 m step: Terrarium's blue byte
# is then 4 more than a multiple of 8, which a tap reads as "estimated" and the
# map's colours cannot see.
ESTIMATE_OFFSET = 4 / 256
# Land beside drawn water is written at least this high (pad_land), so the
# map's linear sampling runs from the water's height up through the dry
# ceiling and stops: never down through every colour from the land value.
PAD_MIN = 10.0


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


def taken(src, layer, bathy, surface=None):
    """Where a source's heights are taken: where it has one, and for a
    topographic LiDAR, where that is not the water's surface it saw."""
    valid = np.isfinite(layer)
    if src.get("kind") == "topo":
        # A topographic LiDAR sees the water's surface, not the bed under it:
        # where a bathymetric survey says the bed is well below the LiDAR, the
        # LiDAR is water and is not taken.
        with np.errstate(invalid="ignore"):
            water = valid & np.isfinite(bathy) & (layer - bathy > src.get("surfaceTolerance", 0.6))
            # Nor at or under the water level the flight is known to have seen.
            if "waterLevelLat" in src:
                water |= valid & (layer <= src["waterLevelLat"])
            if surface is not None:
                water |= valid & (layer <= surface)
        valid &= ~water
    return valid


def merge_one(z, src, layer, feather, bathy, surface=None):
    """Lay one source over the merge so far, feathered in from its edges.

    `bathy` is the merge of the bathymetric surveys alone (not the waterline
    estimate), which a topographic LiDAR is checked against. `surface`, where
    finite, is a water level the flight saw there instead of the source's own
    (a lagoon held up above the sea's)."""
    valid = taken(src, layer, bathy, surface)
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


_stations = None


def station_levels(station):
    """A tide station's MSL and MHW above LAT (stations.json), by id or name."""
    global _stations
    if _stations is None:
        with open(os.path.join(HERE, "stations.json")) as fh:
            _stations = json.load(fh)["stations"]
    s = _stations.get(station) or next((v for v in _stations.values() if v["name"] == station), None)
    return None if s is None else (s["mslMetres"], s["mhwMetres"])


def to_station(z, src_station, dst_station):
    """A tide level at one station as the same stage of the tide at another:
    the same fraction of the way from MSL to MHW. For a pilot drawn on one
    station's curve whose box takes satellite heights measured against a
    neighbour's (Dublin Port's and Skerries' cells inside the Dublin box)."""
    if not src_station or not dst_station or src_station == dst_station:
        return z
    a, b = station_levels(src_station), station_levels(dst_station)
    if a is None or b is None or b[0] == a[0] and b[1] == a[1]:
        return z
    return b[0] + (z - a[0]) * (b[1] - b[0]) / (a[1] - a[0])


def read_satellite(src, data_dir, transform, shape, station=None):
    """Satellite intertidal heights on the grid (satellite.py's GeoTIFFs):
    the height at which each pixel covers and uncovers, metres above LAT in
    its tide station's terms with the method's bias taken off (the file's
    BIAS_APPLIED), NaN where none; a flag per pixel, 0 nothing known, 1 seen
    both wet and dry (a height), 2 never seen dry (under the lowest tide
    seen), 3 never seen wet (over the highest); and per pixel the lowest and
    highest tides seen, with the same bias, so that "never seen dry" bounds
    the bed. With `station` (a pilot's), heights measured against another
    station are moved to its terms (to_station). Returns (heights, flags,
    lowest, highest) or None. Where files overlap, the first one with a
    value wins."""
    files = sorted({f for pattern in src["files"] for f in glob.glob(os.path.join(data_dir, pattern))})
    if not files:
        print(f"  {src['name']}: no files for {src['files']}, skipped", file=sys.stderr)
        return None
    height, width = shape
    z = np.full(shape, np.nan, dtype=np.float32)
    flag = np.zeros(shape, dtype=np.uint8)
    low = np.full(shape, np.nan, dtype=np.float32)
    high = np.full(shape, np.nan, dtype=np.float32)
    used = 0
    for path in files:
        with rasterio.open(path) as ds:
            got = read_window(ds, transform, width, height)
            if got is None:
                continue
            band, band_transform = got
            win = rasterio.windows.from_bounds(*rasterio.transform.array_bounds(band.shape[0], band.shape[1], band_transform),
                                               transform=ds.transform)
            flags = ds.read(2, window=win.round_offsets().round_lengths(), boundless=True, fill_value=0)
            df = np.zeros(shape, dtype=np.uint8)
            reproject(flags.astype(np.uint8), df, src_transform=band_transform, src_crs=ds.crs,
                      dst_transform=transform, dst_crs="EPSG:3857", src_nodata=0, dst_nodata=0,
                      resampling=Resampling.nearest)
            if not (df > 0).any():
                continue
            dz = np.full(shape, np.nan, dtype=np.float32)
            reproject(band.astype(np.float32), dz, src_transform=band_transform, src_crs=ds.crs,
                      dst_transform=transform, dst_crs="EPSG:3857", src_nodata=np.nan, dst_nodata=np.nan,
                      resampling=Resampling.bilinear)
            tags = ds.tags()
            bias = float(tags.get("BIAS_APPLIED", "0"))
            own = tags.get("STATION")
            lo = float(tags.get("LOWEST_TIDE_SEEN", "nan"))
            hi = float(tags.get("HIGHEST_TIDE_SEEN", "nan"))
            dz = to_station(dz, own, station)
            lo, hi = (float(to_station(np.float32(v), own, station)) for v in (lo, hi))
            take = (df > 0) & (flag == 0)
            flag[take] = df[take]
            low[take] = lo + bias
            high[take] = hi + bias
            # A height only where it is flagged as one (bilinear at a height's
            # edge mixes it with nothing: NaN, so the edge pixel goes).
            hz = take & (df == 1) & np.isfinite(dz)
            z[hz] = dz[hz]
            flag[take & (df == 1) & ~np.isfinite(dz)] = 0
            used += 1
    if not (flag > 0).any():
        print(f"  {src['name']}: nothing under the grid")
        return None
    print(f"  {src['name']}: {used} file(s), heights over {np.isfinite(z).mean() * 100:.1f}% of the grid, "
          f"never dry {(flag == 2).mean() * 100:.1f}%, never wet {(flag == 3).mean() * 100:.1f}%, "
          f"lowest tide seen {np.nanmin(low):.2f}..{np.nanmax(low):.2f} m (less the bias)")
    return z, flag, low, high


def basin_height(level, z_station):
    """A basin pixel's height from the station's tide at which it floods: the
    basin's level then (basinLevel in force5/src/foilDepth.ts, lag aside)."""
    floor = level["floorLat"]
    return floor + level["rangeFactor"] * np.maximum(0, z_station - floor)


def compare(name, a, b, mask):
    """Satellite against a survey where both have a height: the numbers the
    README keeps."""
    both = mask & np.isfinite(a) & np.isfinite(b)
    n = int(both.sum())
    if n < 50:
        return None
    d = (a - b)[both]
    out = {"against": name, "pixels": n, "medianMetres": round(float(np.median(d)), 2),
           "iqrMetres": [round(float(v), 2) for v in np.percentile(d, [25, 75])],
           "over05": round(float((np.abs(d) > 0.5).mean()), 3)}
    print(f"    satellite − {name}: {out}")
    return out


def merge_sources(sources, cfg, data_dir, transform, shape, offset, levels=None, surface=None, basins=(),
                  station=None):
    """Steps 1-3: every source on the grid, merged, in metres above LAT.

    `levels`, if given, are the waterlines' heights above LAT (scalars or
    per-pixel grids keyed LAT/MSL/MHW) in place of each source's own.
    `basins` are (mask, level) pairs: water held up behind a weir, whose
    satellite heights are in the basin's level, not the station's tide.
    `station` (a pilot's) is the tide the heights are drawn on, for the
    satellite's heights measured against a neighbour's (read_satellite).
    Returns the merge, the water under the satellite LAT line, the merge of
    the bathymetric surveys alone, the land above the MHW line, the sources
    that had data here, and hints for water no source gives a height: an
    upper bound on its bed where something says it is always wet (`bound`),
    and the satellite's comparisons with the surveys (`compare`)."""
    height, width = shape
    used = []
    z = np.full(shape, np.nan, dtype=np.float32)
    wet_at_lat = np.zeros(shape, dtype=bool)
    bathy = np.full(shape, np.nan, dtype=np.float32)
    topo = np.full(shape, np.nan, dtype=np.float32)
    above_mhw = np.zeros(shape, dtype=bool)
    hints = {"bound": np.full(shape, np.nan, dtype=np.float32), "compare": [], "satellite": None}
    # Cells a source only gap-filled: not a sounding, but not land either
    # (EMODnet fills land from a land model, never from GEBCO).
    gap_fill = np.zeros(shape, dtype=bool)
    _, lat0, _, lat1 = grid_lonlat_bounds(transform, shape)
    metres_per_px = transform.a * math.cos(math.radians((lat0 + lat1) / 2))
    for src in sources:
        if src.get("kind") == "satellite":
            got = read_satellite(src, data_dir, transform, shape, station)
            if got is None:
                continue
            sat, flag, low, high = got
            # Any further bias the source asks for (the files carry their own).
            bias = float(src.get("biasMetres", 0.0))
            sat, low, high = sat + bias, low + bias, high + bias
            for mask, level in basins:
                # Behind a weir the pixel floods when the basin reaches it,
                # and the basin's level follows the station's tide damped.
                inside = mask & np.isfinite(sat)
                sat[inside] = basin_height(level, sat[inside])
            hints["satellite"] = {"sat": sat, "flag": flag}
            hints["compare"] = [c for c in (compare("LiDAR", sat, topo, flag == 1),
                                            compare("bathymetric surveys", sat, bathy, flag == 1),
                                            compare("waterlines", sat, z, (flag == 1) & ~np.isfinite(topo) & ~np.isfinite(bathy)))
                                if c]
            hints["satMinusLidar"] = np.where(flag == 1, sat - topo, np.nan).astype(np.float32)
            with np.errstate(invalid="ignore"):
                # Where a sonar or bathymetric LiDAR survey has the bed well
                # under the satellite's height, the satellite is the weaker:
                # a 10 m pixel across a wall or a cliff's foot (Howth Head),
                # or a flip at the bottom of the tides seen, where the method
                # reads high. The survey stands there (flag 4: not a gap to
                # fill from the satellite's neighbours either).
                below = sat - bathy
                distrust = (flag == 1) & np.isfinite(bathy) & (
                    (below > src.get("yieldOverMetres", 1.5))
                    | ((below > 0.5) & (sat < low + src.get("lowBandMetres", 0.5))))
            flag[distrust] = 4
            sat[distrust] = np.nan
            hints["satYielded"] = int(distrust.sum())
            with np.errstate(invalid="ignore"):
                # Never seen dry: under the lowest tide seen, whatever a
                # coarser source says; never seen wet: over the highest.
                never_dry = flag == 2
                # Only on the lower shore, near what it saw flood and drain:
                # further out "never dry" says only that it is the sea, and
                # its window's edge would draw a straight line across it.
                near = ndimage.distance_transform_edt(flag != 1) * metres_per_px
                never_dry &= near <= src.get("neverDryMetres", 300)
                lid = low.copy()
                for mask, level in basins:
                    # A basin never drains below its weir: never seen dry
                    # there is under the weir's crest.
                    lid[mask] = level["floorLat"] - 0.1
                # (np.minimum: where no source has a height, it stays none,
                # to be estimated under the bound, not taken as one.)
                z[never_dry] = np.minimum(z[never_dry], lid[never_dry])
                hints["bound"][never_dry] = np.fmin(hints["bound"][never_dry], lid[never_dry])
                for mask, level in basins:
                    # Under a basin that never drains, nothing has sounded the
                    # bed: the waterlines there are the basin's own edge on
                    # the day, read as if it were the sea's, and EMODnet's
                    # cells are coarse. The bed is estimated instead
                    # (finish_masked, from the basin's `bedEstimateLat`).
                    z[never_dry & mask] = np.nan
                never_wet = (flag == 3) & np.isfinite(z)
                z[never_wet] = np.fmax(z[never_wet], high[never_wet])
            # A rejected pixel among accepted ones (a misfit, a look too few)
            # is filled from the satellite's heights round it, not left to
            # the coarser sources under it, which would pit the flat.
            obs = (flag == 1) & np.isfinite(sat)
            gaps = ndimage.binary_fill_holes(obs) & ~obs & (flag == 0)
            if gaps.any():
                labels, count = ndimage.label(gaps)
                sizes = ndimage.sum(gaps, labels, index=np.arange(1, count + 1)) * metres_per_px ** 2
                small = np.zeros(count + 1, dtype=bool)
                small[1:] = sizes <= src.get("maxGapSquareMetres", 2500)
                fill = small[labels]
                if fill.any():
                    sat[fill] = push_pull(np.nan_to_num(sat), obs)[fill]
                    obs |= fill
            # Feathered into the other sources only at the edge of what the
            # satellite saw (its window, a cloud-free gap), not at every
            # pixel it called never wet or never dry beside a height.
            seen = ndimage.binary_closing((flag > 0) | obs, iterations=2) | obs
            w = np.clip(ndimage.distance_transform_edt(seen)
                        / max(1.0, src.get("featherMetres", 80) / metres_per_px), 0, 1).astype(np.float32)
            blend = obs & np.isfinite(z)
            z[blend] = w[blend] * sat[blend] + (1 - w[blend]) * z[blend]
            z[obs & ~blend] = sat[obs & ~blend]
            used.append(src)
            continue
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
        if src.get("kind") == "topo":
            seen = taken(src, layer, bathy, surface)
            topo[seen] = layer[seen]
        z = merge_one(z, src, layer, cfg["featherPixels"], bathy,
                      surface if src.get("kind") == "topo" else None)
        used.append(src)
    if basins:
        # Behind a weir only what saw the bed itself stands: a LiDAR's ground
        # over the basin's water, the satellite's heights. The waterlines there
        # are the basin's own edge on the day, read as if it were the sea's,
        # and EMODnet's cells are coarse: the rest is estimated
        # (finish_masked, from the basin's `bedEstimateLat`).
        seen = np.isfinite(topo)
        if hints["satellite"] is not None:
            seen |= np.isin(hints["satellite"]["flag"], (1, 3))
        for mask, _ in basins:
            z[mask & ~seen] = np.nan
            # Nor is the waterlines' "under LAT" the sea's LAT behind the weir.
            wet_at_lat[mask] = False
    return z, wet_at_lat, bathy, above_mhw, used, hints


def push_pull(z, known):
    """A smooth surface through the known pixels, everywhere: halve the grid
    (a weighted mean of the known) until every cell has a value, then come
    back up, keeping the known and filling the rest from the level below."""
    v = np.where(known, z, 0).astype(np.float64)
    w = known.astype(np.float64)
    levels = []
    while True:
        levels.append((v, w))
        h, wd = v.shape
        if (w > 0).all() or (h <= 1 and wd <= 1):
            break
        ph, pw = h + h % 2, wd + wd % 2
        vp = np.zeros((ph, pw))
        wp = np.zeros((ph, pw))
        vp[:h, :wd] = v
        wp[:h, :wd] = w
        v = vp.reshape(ph // 2, 2, pw // 2, 2).sum(axis=(1, 3))
        w = wp.reshape(ph // 2, 2, pw // 2, 2).sum(axis=(1, 3))
    v, w = levels[-1]
    filled = np.where(w > 0, v / np.maximum(w, 1e-12), 0.0)
    for v, w in reversed(levels[:-1]):
        h, wd = v.shape
        up = np.repeat(np.repeat(filled, 2, axis=0), 2, axis=1)
        up = ndimage.uniform_filter(up, size=2, mode="nearest")[:h, :wd]
        a = np.clip(w, 0, 1)
        filled = a * (v / np.maximum(w, 1e-12)) + (1 - a) * up
    return filled.astype(np.float32)


def quantise(v):
    return (np.round(np.asarray(v, dtype=np.float32) / QUANTUM) * QUANTUM).astype(np.float32)


def mark_estimate(v):
    """Heights written as estimates: quantised, then ESTIMATE_OFFSET over."""
    return (quantise(v) + np.float32(ESTIMATE_OFFSET)).astype(np.float32)


def is_estimate(v):
    """Which heights are estimates (the blue byte 4 over a multiple of 8)."""
    frac = np.mod(np.asarray(v, dtype=np.float64) * 256, 8)
    return np.abs(frac - 4) < 0.5


def finish_masked(z, wet_at_lat, sea, shore, ceiling, cfg, metres_per_px, hints=None, pin=None):
    """Steps 4-5 against OpenStreetMap's land and water (osm.water_mask).

    - Outside the mask is land, whatever a source says (EMODnet's 115 m land
      cells at 0.4-1.1 m LAT in the fields north of the Malahide lagoon).
    - `shore` (a beach, marsh, over the coastline) is drawn where a source's
      height is under the dry ceiling, else land.
    - `sea` is water at every pixel. Where a source has a height under the
      ceiling it is kept (deeper than the floor: the deep value). Where none
      has (the Malahide lagoon's western half, no survey at all), or only one
      over the ceiling (a coarse land cell at the shore), the bed is
      estimated from the heights round it (push_pull), no higher than what
      is known of it (`hints["bound"]`: never seen dry by the satellite,
      under the waterlines' LAT line), and written as an estimate
      (mark_estimate). Far from any height a basin's `pin` (its bed as a
      rider knows it) stands in. A stretch of such water larger than
      `maxUnsurveyedKm2` is too large to fill from its edges (a gap in the
      surveys out at sea, or a whole harbour no survey has crossed): it is
      drawn as nothing, written as the deep value flagged as an estimate, so
      a tap says it is unsurveyed rather than deep.

    Returns the grid (heights from the floor to the ceiling, estimates among
    them, the deep and land values) and counts."""
    floor, land, deep = cfg["floorMetres"], cfg["landMetres"], cfg["deepMetres"]
    shape = z.shape
    ceil = np.broadcast_to(np.asarray(ceiling, dtype=np.float32), shape)
    with np.errstate(invalid="ignore"):
        height = np.isfinite(z) & (z <= ceil)
    shore = shore & ~sea
    known = (sea | shore) & height
    out = np.full(shape, land, dtype=np.float32)
    with np.errstate(invalid="ignore"):
        kept = known & (z >= floor)
    out[kept] = quantise(z[kept])
    out[known & ~kept] = deep
    holes = sea & ~height
    stats = {"pixels": int(np.isfinite(z).sum()), "kept": int(kept.sum()), "deep": int((known & ~kept).sum()),
             "landByMask": int((height & ~sea & ~shore).sum()),
             "shoreOverCeiling": int((shore & ~height).sum()), "estimated": 0, "holesDeep": 0}
    if holes.any():
        labels, count = ndimage.label(holes, structure=np.ones((3, 3)))
        sizes = ndimage.sum(holes, labels, index=np.arange(1, count + 1)) * metres_per_px ** 2 / 1e6
        small = np.zeros(count + 1, dtype=bool)
        small[1:] = sizes <= cfg.get("maxUnsurveyedKm2", 5.0)
        est = holes & small[labels]
        # Drawn as nothing, as deep water is, but flagged as an estimate (a
        # 64th over the deep value): a tap says no survey has sounded it,
        # not that it is deep (Wexford Harbour's flats, with no survey yet).
        out[holes & ~small[labels]] = np.float32(deep + ESTIMATE_OFFSET)
        stats["holesDeep"] = int((holes & ~small[labels]).sum())
        if est.any():
            base = np.where(known, np.clip(z, floor - 1, ceil), np.nan).astype(np.float32)
            anchor = known.copy()
            if pin is not None:
                # Far from every height, a basin's bed as it is known.
                far = ndimage.distance_transform_edt(~known) * metres_per_px > cfg.get("pinMetres", 150)
                p = est & far & np.isfinite(pin)
                base[p] = pin[p]
                anchor |= p
            if anchor.any():
                v = push_pull(np.nan_to_num(base), anchor)
            else:
                v = np.zeros(shape, dtype=np.float32)
            bound = np.full(shape, np.nan, dtype=np.float32) if hints is None else hints["bound"].copy()
            # Under the waterlines' LAT line: under LAT.
            bound[wet_at_lat] = np.fmin(bound[wet_at_lat], 0.0)
            with np.errstate(invalid="ignore"):
                v = np.where(np.isfinite(bound), np.minimum(v, bound), v)
                v = np.minimum(v, ceil)
                to_deep = est & (v < floor)
            out[to_deep] = deep
            fill = est & ~to_deep
            out[fill] = mark_estimate(v[fill])
            stats["estimated"] = int(fill.sum())
    stats["intertidal"] = int((kept & (z > 0)).sum())
    stats["subtidal"] = int((kept & (z <= 0)).sum())
    return out, stats


def finish(z, wet_at_lat, bathy, above_mhw, outside, ceiling, cfg, metres_per_px, mhw=None,
           sea=None, shore=None, hints=None, pin=None):
    """Steps 4-5: the sea mask, the depth cut and the reserved values.

    With OpenStreetMap's mask (`sea`, `shore`), finish_masked; without, the
    older rules below (the sea reaches up through low ground joined to water
    a survey sounded under LAT), kept for a build with no mask.

    `ceiling` is the dry ceiling, a scalar or one per pixel. Returns the grid
    to tile (heights above LAT from `floorMetres` up to the ceiling, and the
    reserved `deepMetres`, `noSurveyMetres` and `landMetres`) and counts."""
    if sea is not None:
        z = np.where(outside, np.nan, z).astype(np.float32)
        return finish_masked(z, wet_at_lat & ~outside, sea & ~outside,
                             (shore if shore is not None else np.zeros_like(sea)) & ~outside,
                             ceiling, cfg, metres_per_px, hints, pin)
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
    """Anything to draw: a height from the floor up, or unsurveyed water
    (an older build's reserved value); not land's padding (pad_land)."""
    g = grid
    nosurvey = cfg.get("noSurveyMetres", 40)
    return bool((((g > cfg["deepMetres"] + 1) & (g < PAD_MIN)) | (np.abs(g - nosurvey) < 0.5)).any())


def pad_land(level, cfg, ceiling):
    """Land beside anything drawn, written so the map's linear sampling
    passes cleanly from one to the other.

    MapLibre interpolates the heights between pixels and colours the result.
    From a water pixel at h to land at 50 m it would run through every colour
    from h to the dry ceiling within the first tenth of the gap: a fringe at
    every shore. The land pixel beside it is written as 2 x ceiling - h
    instead (at least PAD_MIN), so the interpolated height reaches the
    ceiling, where nothing is drawn, well into the gap, towards the mask's
    edge. Over PAD_MIN nothing is a height, so a tap reads it as land and
    has_content does not count it."""
    land = cfg["landMetres"]
    is_land = level >= land - 1
    if not is_land.any() or is_land.all():
        return level
    drawn = np.where(is_land, -np.inf, level).astype(np.float32)
    hmax = ndimage.maximum_filter(drawn, size=3, mode="nearest")
    ring = is_land & np.isfinite(hmax)
    if not ring.any():
        return level
    out = level.copy()
    ceil = np.broadcast_to(np.asarray(ceiling, dtype=np.float32), level.shape)
    out[ring] = np.clip(2 * ceil[ring] - hmax[ring], PAD_MIN, land - 5)
    return out


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


def osm_mask(osm_cfg, data_dir, transform, shape, quiet=False):
    """OpenStreetMap's sea and shore on the grid (osm.py), and how much of it."""
    import osm
    sea, shore = osm.water_mask(os.path.join(data_dir, osm_cfg["dir"]), transform, shape,
                                join_pixels=osm_cfg.get("joinPixels", 3))
    if not quiet:
        print(f"  OSM: sea {sea.mean() * 100:.1f}%, shore {shore.mean() * 100:.1f}% of the grid")
    return sea, shore


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

    z, wet_at_lat, bathy, above_mhw, used, hints = merge_sources(
        area["sources"], cfg, data_dir, transform, (height, width), offset, surface=surface,
        basins=[(m, b["level"]) for b, m in zip(basins, basin_masks)], station=area["station"])
    if not used:
        raise SystemExit(f"{area['id']}: no source data found under {data_dir}")
    # A basin's bed as a rider knows it, far from any height (finish_masked).
    pin = None
    for b, m in zip(basins, basin_masks):
        if "bedEstimateLat" in b:
            if pin is None:
                pin = np.full((height, width), np.nan, dtype=np.float32)
            pin[m] = b["bedEstimateLat"]
    sea = shore = None
    if cfg.get("osm"):
        sea, shore = osm_mask(cfg["osm"], data_dir, transform, (height, width))

    # Only inside the area's box: the grid's whole tiles reach past it.
    cols = np.arange(width) * transform.a + transform.c + transform.a / 2
    rows = transform.f - (np.arange(height) + 0.5) * transform.a
    xw, ys = merc(w_, s_)
    xe, yn = merc(e_, n_)
    outside = (cols[None, :] < xw) | (cols[None, :] > xe) | (rows[:, None] < ys) | (rows[:, None] > yn)

    ceiling = area["dryCeilingMetres"]
    metres_per_px = transform.a * math.cos(math.radians((area["bbox"][1] + area["bbox"][3]) / 2))
    mhw = next((s["levels"]["MHW"] for s in area["sources"] if s.get("kind") == "waterlines"), None)
    out, stats = finish(z, wet_at_lat, bathy, above_mhw, np.zeros_like(outside), ceiling, cfg, metres_per_px, mhw,
                        sea=sea, shore=shore, hints=hints, pin=pin)
    stats["satellite"] = hints["compare"]
    print(f"  mask: {stats}")
    if debug_dir:
        # The merged grid before tiling, past the box too: a look in QGIS, and
        # the national build's pilot source (national.json).
        os.makedirs(debug_dir, exist_ok=True)
        with rasterio.open(os.path.join(debug_dir, f"{area['id']}.tif"), "w", driver="GTiff",
                           width=width, height=height, count=1, dtype="float32", crs="EPSG:3857",
                           transform=transform, compress="deflate", nodata=None) as dst:
            dst.write(out.astype(np.float32), 1)
        if "satMinusLidar" in hints:
            # Where the satellite and the LiDAR disagree (README: by more than 0.5 m).
            with rasterio.open(os.path.join(debug_dir, f"{area['id']}-sat-minus-lidar.tif"), "w", driver="GTiff",
                               width=width, height=height, count=1, dtype="float32", crs="EPSG:3857",
                               transform=transform, compress="deflate", nodata=np.nan) as dst:
                dst.write(hints["satMinusLidar"], 1)
        with open(os.path.join(debug_dir, f"{area['id']}-stats.json"), "w") as fh:
            json.dump(stats, fh, indent=1)
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
                           os.path.join(out_dir, f"{b['id']}.pmtiles"), b["id"], cfg, attribution, ceiling)
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
                       os.path.join(out_dir, f"{area['id']}.pmtiles"), area["id"], cfg, attribution, ceiling)
    entries.append({
        "id": area["id"], "name": area["name"], "url": f"{area['id']}.pmtiles",
        "bounds": area["bbox"], "minzoom": zmin, "maxzoom": zmax, "tileSize": size,
        "station": area["station"], "dryCeilingMetres": ceiling,
        "sources": sources,
    })
    return entries, stats, mb


def pyramid(grid, tiles_at_max, size, zmin, zmax, cfg, ceiling=None, raw=False):
    """(zoom, x, y, tile) for a grid of whole tiles at the max zoom, down to the
    min zoom, padding with land to whole tiles at each. `tiles_at_max` is the
    grid's (x0, y0, x1, y1) tiles. With a `ceiling`, each level's land beside
    water is padded (pad_land) before it is cut into tiles, so a tile's edge
    sees its neighbour's water; the overviews are made from the unpadded
    level. With `raw`, the unpadded tile is yielded too, last."""
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
            # Past the grid, its own edge carried on (the deep value at sea,
            # land on land): land beside deep water out at sea would draw a
            # line of every colour along the grid's edge at the lower zooms.
            padded = np.pad(level, ((oy, need_h - oy - level.shape[0]), (ox, need_w - ox - level.shape[1])),
                            mode="edge").astype(np.float32)
            level = downsample(padded, cfg)
        drawn = level if ceiling is None else pad_land(level, cfg, ceiling)
        for ty in range(ty0, ty1 + 1):
            for tx in range(tx0, tx1 + 1):
                cut = (slice((ty - ty0) * size, (ty - ty0 + 1) * size), slice((tx - tx0) * size, (tx - tx0 + 1) * size))
                tile = drawn[cut]
                if tile.shape == (size, size):
                    yield (zoom, tx, ty, tile, level[cut]) if raw else (zoom, tx, ty, tile)
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
                           f"{cfg['floorMetres']} m up; {cfg['deepMetres']} m is deeper than that; "
                           "a height whose blue byte is 4 over a multiple of 8 is estimated, not surveyed; "
                           f"{PAD_MIN:g} m and over is not water ({cfg['landMetres']} m, or land beside water "
                           "padded for smooth sampling).",
            "attribution": attribution}


def write_archive(grid, tiles_at_max, size, zmin, zmax, bbox, path, name, cfg, attribution, ceiling=None):
    """One PMTiles archive of a grid of whole tiles at the max zoom, pyramided
    down to the min zoom; tiles with nothing to draw are left out."""
    tiles = [(zxy_to_tileid(zoom, tx, ty), encode(tile))
             for zoom, tx, ty, tile in pyramid(grid, tiles_at_max, size, zmin, zmax, cfg, ceiling)
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
