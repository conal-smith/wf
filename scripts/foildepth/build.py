"""Build the foilable-depth elevation archives: public/foildepth/<area>.pmtiles.

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
5. clamp anything deeper than `floorMetres` to it (always deep enough, and far
   smaller to store), quantise to 1/32 m, encode as Terrarium RGB in lossless
   WebP, pyramid down to the min zoom, and pack one PMTiles archive; each of
   the area's basins (water held up behind a weir, with a level of its own)
   is cut out of it into an archive of its own.

It also writes public/foildepth/index.json, the map's index of the areas.

Usage (from anywhere; downloads stay outside the repo):

    python -I build.py --data /tmp/wf-foildepth/data --out ../../public/foildepth [--area dublin-north]

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
from rasterio.warp import Resampling, reproject
from rasterio.transform import from_origin
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
UNSURVEYED_BELOW = 20.0  # any height under this is a surveyed one


def merc(lon, lat):
    x = math.radians(lon) * 6378137.0
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * 6378137.0
    return x, y


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


def grid_for(bbox, z, size):
    """The Mercator grid of whole tiles at zoom z: transform, width, height, tiles."""
    x0, x1, y0, y1 = tile_range(bbox, z)
    span = EARTH / 2 ** z
    px = span / size
    left = -ORIGIN + x0 * span
    top = ORIGIN - y0 * span
    width = (x1 - x0 + 1) * size
    height = (y1 - y0 + 1) * size
    return from_origin(left, top, px, px), width, height, (x0, x1, y0, y1)


def lonlat_polygon(ring):
    """A lon/lat ring as a GeoJSON polygon in Web Mercator metres."""
    return {"type": "Polygon", "coordinates": [[merc(lon, lat) for lon, lat in ring]]}


def polygon_mask(rings, transform, shape):
    """Pixels of the grid inside any of the lon/lat rings."""
    shapes = [(lonlat_polygon(r), 1) for r in rings if len(r) >= 3]
    if not shapes:
        return np.zeros(shape, dtype=bool)
    return features.rasterize(shapes, out_shape=shape, transform=transform, dtype="uint8").astype(bool)


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
    mask = polygon_mask([[(x, y) for x, y, *_ in r] for r in rings], transform, shape)
    print(f"  gap-fill: {len(rings)} {'/'.join(spec['identifiers'])} polygon(s), {mask.mean() * 100:.1f}% of the grid dropped")
    return mask


def read_source(src, data_dir, transform, width, height, offset, gap=None):
    """One source on the target grid, metres above LAT positive up, NaN where none.

    `gap` marks the cells that are only a gap-fill (gap_fill_mask): dropped."""
    out = np.full((height, width), np.nan, dtype=np.float32)
    files = sorted({f for pattern in src["files"] for f in glob.glob(os.path.join(data_dir, pattern))})
    if not files:
        print(f"  {src['name']}: no files for {src['files']}, skipped", file=sys.stderr)
        return None
    for path in files:
        with rasterio.open(path) as ds:
            band = ds.read(1).astype(np.float32)
            nodata = src.get("nodata", ds.nodata)
            if nodata is not None:
                band[band == np.float32(nodata)] = np.nan
            for bad in src.get("invalid", []):
                band[band == np.float32(bad)] = np.nan
            lo, hi = src.get("validRange", [-1000, 1000])
            band[(band < lo) | (band > hi)] = np.nan
            dest = np.full((height, width), np.nan, dtype=np.float32)
            reproject(
                band, dest,
                src_transform=ds.transform, src_crs=src.get("crs", ds.crs),
                dst_transform=transform, dst_crs="EPSG:3857",
                src_nodata=np.nan, dst_nodata=np.nan,
                resampling=Resampling.bilinear if src.get("smooth", True) else Resampling.nearest,
            )
            take = np.isfinite(dest) & ~np.isfinite(out)
            out[take] = dest[take]
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
    print(f"  {src['name']}: {len(files)} file(s), {np.isfinite(z).mean() * 100:.1f}% of the grid, "
          f"{np.nanmin(z) if np.isfinite(z).any() else 'n/a'}..{np.nanmax(z) if np.isfinite(z).any() else 'n/a'} m LAT")
    return z


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


def terrarium(tile):
    v = np.clip(tile + 32768.0, 0, 65535.99)
    whole = np.floor(v)
    rgb = np.empty(tile.shape + (3,), dtype=np.uint8)
    rgb[..., 0] = (whole // 256).astype(np.uint8)
    rgb[..., 1] = (whole % 256).astype(np.uint8)
    rgb[..., 2] = np.floor((v - whole) * 256).astype(np.uint8)
    return rgb


def encode(tile):
    buf = io.BytesIO()
    Image.fromarray(terrarium(tile), "RGB").save(buf, "WEBP", lossless=True, quality=100, method=6, exact=True)
    return buf.getvalue()


def downsample(z, land):
    """Half resolution: the mean of the water in each 2×2, land where all four are.

    "Water" is any surveyed height; the unsurveyed value is kept as it is
    where a block has nothing else (it is far above the dry ceiling, and
    averaging it with a height would invent one)."""
    h, w = z.shape
    blocks = z.reshape(h // 2, 2, w // 2, 2)
    water = blocks < UNSURVEYED_BELOW
    total = np.where(water, blocks, 0).sum(axis=(1, 3))
    count = water.sum(axis=(1, 3))
    unknown = (blocks < land - 1).any(axis=(1, 3))
    fallback = np.where(unknown, blocks.min(axis=(1, 3)), land)
    return np.where(count > 0, total / np.maximum(count, 1), fallback).astype(np.float32)


def build_area(area, cfg, data_dir, out_dir, debug_dir=None):
    size = area.get("tileSize", cfg["tileSize"])
    zmax = area.get("maxzoom", cfg["maxzoom"])
    zmin = area.get("minzoom", cfg["minzoom"])
    floor, land = cfg["floorMetres"], cfg["landMetres"]
    offset = area["odMalinOffsetMetres"]
    transform, width, height, (x0, x1, y0, y1) = grid_for(area["bbox"], zmax, size)
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

    used = []
    z = np.full((height, width), np.nan, dtype=np.float32)
    wet_at_lat = np.zeros((height, width), dtype=bool)
    bathy = np.full((height, width), np.nan, dtype=np.float32)
    above_mhw = np.zeros((height, width), dtype=bool)
    # Cells a source only gap-filled: not a sounding, but not land either
    # (EMODnet fills land from a land model, never from GEBCO).
    gap_fill = np.zeros((height, width), dtype=bool)
    for src in area["sources"]:
        if src.get("kind") == "waterlines":
            path = os.path.join(data_dir, src["files"][0])
            if not os.path.exists(path):
                print(f"  {src['name']}: missing {path}, skipped", file=sys.stderr)
                continue
            layer, wet, land3, counts = waterline_surface(json.load(open(path)), src["levels"], transform,
                                                   (height, width), z, coarsen=src.get("coarsen", 2),
                                                   sea_hint=gap_fill)
            print(f"  {src['name']}: regions {counts}")
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
            gap = gap_fill_mask(src["gapFill"], data_dir, transform, (height, width)) if "gapFill" in src else None
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
    if not used:
        raise SystemExit(f"{area['id']}: no source data found under {data_dir}")
    layers = [(s, None) for s in used]
    # Wet at every tide, but nothing says how deep: drawn as its own class.
    unsurveyed = wet_at_lat & ~np.isfinite(z)
    # Beyond the MHW line a topographic LiDAR's low ground (fields and marsh
    # behind a beach, which the earlier prototype drew as foreshore) is not
    # sea either, unless a bathymetric survey has been there.
    z[above_mhw & ~np.isfinite(bathy)] = np.nan

    # Only inside the area's box: the grid's whole tiles reach past it.
    cols = np.arange(width) * transform.a + transform.c + transform.a / 2
    rows = transform.f - (np.arange(height) + 0.5) * transform.a
    w_, s_, e_, n_ = area["bbox"]
    xw, ys = merc(w_, s_)
    xe, yn = merc(e_, n_)
    outside = (cols[None, :] < xw) | (cols[None, :] > xe) | (rows[:, None] < ys) | (rows[:, None] > yn)
    z[outside] = np.nan

    ceiling = area["dryCeilingMetres"]
    unsurveyed &= ~outside
    # Small holes of no data inside the water (a coarse fallback pixel thrown
    # out, a gap between survey legs) are water nobody sounded, not islands:
    # an island has a height.
    water = (np.isfinite(z) & (z <= ceiling)) | unsurveyed
    holes = ndimage.binary_fill_holes(water) & ~water & ~np.isfinite(z) & ~outside
    labels, count = ndimage.label(holes)
    if count:
        sizes = ndimage.sum(holes, labels, index=np.arange(1, count + 1))
        small = np.zeros(count + 1, dtype=bool)
        small[1:] = sizes <= cfg.get("maxHolePixels", 4000)
        unsurveyed |= small[labels]
    wet = sea_mask(np.where(unsurveyed, cfg["seedBelowMetres"] - 1, z), ceiling,
                   cfg["seedBelowMetres"], cfg["minWaterPixels"])
    # Only the water a rider launches into: within a band of the shore and the
    # intertidal. The open sea beyond is deep at any tide, and drawn solid it
    # would end in the area's box out at sea; the chart's own tints carry it.
    shore = (~wet & ~outside) | (wet & np.isfinite(z) & (z > 0))
    metres_per_px = transform.a * math.cos(math.radians((area["bbox"][1] + area["bbox"][3]) / 2))
    offshore = ndimage.distance_transform_edt(~shore) * metres_per_px
    wet &= ~(offshore > cfg.get("seaBandMetres", 1500))
    stats = {
        "pixels": int(np.isfinite(z).sum()),
        "intertidal": int((wet & (z > 0)).sum()),
        "subtidal": int((wet & (z <= 0)).sum()),
        "cutOff": int((np.isfinite(z) & (z <= ceiling) & ~wet).sum()),
        "unsurveyed": int((wet & unsurveyed).sum()),
    }
    print(f"  mask: {stats}")
    out = np.where(wet, np.maximum(z, floor), land).astype(np.float32)
    out[wet & unsurveyed] = cfg["noSurveyMetres"]
    out = np.round(out / QUANTUM) * QUANTUM
    if debug_dir:
        # The merged grid before tiling, for a look in QGIS or a quick render.
        os.makedirs(debug_dir, exist_ok=True)
        with rasterio.open(os.path.join(debug_dir, f"{area['id']}.tif"), "w", driver="GTiff",
                           width=width, height=height, count=1, dtype="float32", crs="EPSG:3857",
                           transform=transform, compress="deflate", nodata=None) as dst:
            dst.write(np.where(outside, np.nan, out).astype(np.float32), 1)

    os.makedirs(out_dir, exist_ok=True)
    attribution = "; ".join(s["attribution"] for s in area["sources"] if "attribution" in s)
    sources = [{k: s[k] for k in ("name", "role", "years", "resolution", "licence")} for s, _ in layers]
    entries = []
    # Each basin first, so a reader that takes the first box a point is in
    # finds the basin; the area's own archive has the basins cut out.
    for b, m in zip(basins, basin_masks):
        bx0, bx1, by0, by1 = tile_range(b["bbox"], zmax)
        crop = np.where(m, out, land)[(by0 - y0) * size:(by1 - y0 + 1) * size, (bx0 - x0) * size:(bx1 - x0 + 1) * size]
        mb = write_archive(crop, (bx0, by0, bx1, by1), size, zmin, zmax, land, b["bbox"],
                           os.path.join(out_dir, f"{b['id']}.pmtiles"), b["id"], floor, attribution)
        stats[b["id"]] = {"pixels": int((m & wet).sum()), "unsurveyed": int((m & wet & unsurveyed).sum()),
                          "mb": round(mb, 2)}
        entries.append({
            "id": b["id"], "name": b["name"], "url": f"foildepth/{b['id']}.pmtiles",
            "bounds": b["bbox"], "minzoom": zmin, "maxzoom": zmax, "tileSize": size,
            "station": area["station"], "dryCeilingMetres": ceiling,
            "level": {k: b["level"][k] for k in ("floorLat", "rangeFactor", "lagHours")},
            "sources": sources,
        })
        out[m] = land
    mb = write_archive(out, (x0, y0, x1, y1), size, zmin, zmax, land, area["bbox"],
                       os.path.join(out_dir, f"{area['id']}.pmtiles"), area["id"], floor, attribution)
    entries.append({
        "id": area["id"], "name": area["name"], "url": f"foildepth/{area['id']}.pmtiles",
        "bounds": area["bbox"], "minzoom": zmin, "maxzoom": zmax, "tileSize": size,
        "station": area["station"], "dryCeilingMetres": ceiling,
        "sources": sources,
    })
    return entries, stats, mb


def write_archive(grid, tiles_at_max, size, zmin, zmax, land, bbox, path, name, floor, attribution):
    """One PMTiles archive of a grid of whole tiles at the max zoom, pyramided
    down to the min zoom. `tiles_at_max` is the grid's (x0, y0, x1, y1) tiles."""
    x0, y0, x1, y1 = tiles_at_max
    tiles = []
    level = grid
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
            level = downsample(padded, land)
        for ty in range(ty0, ty1 + 1):
            for tx in range(tx0, tx1 + 1):
                tile = level[(ty - ty0) * size:(ty - ty0 + 1) * size, (tx - tx0) * size:(tx - tx0 + 1) * size]
                if tile.shape != (size, size):
                    continue
                tiles.append((zxy_to_tileid(zoom, tx, ty), encode(tile)))
        prev_x0, prev_y0 = tx0, ty0
    tiles.sort(key=lambda t: t[0])
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
             "center_zoom": zmax - 2, "center_lon_e7": int((w + e) / 2 * 1e7),
             "center_lat_e7": int((s + n) / 2 * 1e7)},
            {"name": f"wingfoil foildepth {name}", "encoding": "terrarium",
             "description": "Seabed and foreshore, metres above LAT (Terrarium). "
                            f"Clamped at {floor} m; {land} m is not water.",
             "attribution": attribution},
        )
    mb = os.path.getsize(path) / 1e6
    print(f"  {name}: {len(tiles)} tiles, {mb:.2f} MB → {path}")
    return mb


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", required=True, help="the download directory (outside the repo)")
    parser.add_argument("--out", default=os.path.join(HERE, "..", "..", "public", "foildepth"))
    parser.add_argument("--config", default=os.path.join(HERE, "areas.json"))
    parser.add_argument("--area", action="append", help="only these areas (the index keeps the rest)")
    parser.add_argument("--debug", help="also write each merged grid as a GeoTIFF here (outside the repo)")
    args = parser.parse_args()
    cfg = json.load(open(args.config))
    index_path = os.path.join(args.out, "index.json")
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
        "schemaVersion": 1, "kind": "foildepth",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "datum": "LAT", "encoding": "terrarium",
        "floorMetres": cfg["floorMetres"], "landMetres": cfg["landMetres"],
        "noSurveyMetres": cfg["noSurveyMetres"],
        "areas": [a for a in areas if a],
        "attribution": cfg["attribution"],
    }
    with open(index_path, "w") as fh:
        json.dump(index, fh, indent=2)
        fh.write("\n")
    print(f"index → {index_path}")


if __name__ == "__main__":
    main()
