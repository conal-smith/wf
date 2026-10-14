"""The island at 100 m: land, sea, what the layer covers and where the coast is.
(Great Britain's, with config-gb.json: its land is coarse.landPolygon's, below.)

From Sentinel-2 itself, so nothing else's licence comes into it: for every
tile, the clearest acquisitions (tile cloud under coarse.maxTileCloud) read at
the COGs' 1/16 overview (160 m): NDWI > 0 is water, SCL's clouds are left out,
and each 100 m cell of an Irish Transverse Mercator grid is water if most of
its clear looks say so. Then:

- sea: water joined to the edge of the box;
- Ireland: the land not joined to the box's edge (Kintyre is) and within 15 km
  of the main island by a chain of islands (Tory, the Skelligs, Rathlin...;
  Sanda, off Kintyre, is not), its lakes filled in;
- coverage: Ireland and the sea within coarse.seaKm of it;
- the coastal zone, where every acquisition is read for the tide-sorted
  images and the intertidal heights: land within coarse.coastalLandKm of the
  sea and sea within coarse.coastalSeaKm of land.

Writes <root>/work/coarse.tif (bands: coverage, coastal, sea, land distance to
sea km, sea distance to land km) and coarse.json.

    python -I coarse.py
"""
import concurrent.futures as cf
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "5")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")


def grid(cfg):
    """The ITM grid over the box: transform, shape, crs."""
    from pyproj import Transformer
    from rasterio.transform import from_origin
    c = cfg["coarse"]
    to = Transformer.from_crs(4326, c["crs"], always_xy=True)
    w, s, e, n = cfg["bbox"]
    xs, ys = zip(*[to.transform(x, y) for x in np.linspace(w, e, 30) for y in (s, n)] +
                 [to.transform(x, y) for x in (w, e) for y in np.linspace(s, n, 30)])
    px = c["pixelMetres"]
    left, right = np.floor(min(xs) / px) * px, np.ceil(max(xs) / px) * px
    bottom, top = np.floor(min(ys) / px) * px, np.ceil(max(ys) / px) * px
    shape = (int((top - bottom) / px), int((right - left) / px))
    return from_origin(left, top, px, px), shape, c["crs"]


def tile_catalogs():
    d = common.path("downloads", "catalog")
    return {f[:-5]: common.read_json(os.path.join(d, f)) for f in sorted(os.listdir(d))
            if f.endswith(".json") and len(f) == 10}


def pick(items, n, max_cloud):
    """The clearest acquisitions, spread over the years and seasons."""
    clear = sorted((it for it in items if (it["cloud"] or 100) <= max_cloud and (it["nodata"] or 0) < 50),
                   key=lambda it: it["cloud"])
    out, seen = [], set()
    for it in clear:
        key = (it["stamp"][:4], (int(it["stamp"][4:6]) - 1) // 3)
        if key not in seen:
            out.append(it)
            seen.add(key)
        if len(out) == n:
            return out
    for it in clear:
        if it not in out:
            out.append(it)
        if len(out) == n:
            break
    return out


def read_coarse(it):
    """(wet, valid) at 160 m on the tile's own grid, and that grid's transform."""
    import planetary_computer
    import rasterio
    from rasterio.enums import Resampling
    hrefs = {b: planetary_computer.sign(it["href"][b]) for b in ("B03", "B08", "SCL")}
    with rasterio.open(hrefs["SCL"]) as src:
        size = int(round(src.width / 8))
        scl = src.read(1, out_shape=(size, size), resampling=Resampling.nearest)
        transform = src.transform * src.transform.scale(src.width / size, src.height / size)
    bands = {}
    for b in ("B03", "B08"):
        with rasterio.open(hrefs[b]) as src:
            bands[b] = src.read(1, out_shape=(size, size), resampling=Resampling.nearest).astype(np.float32)
    g, n = bands["B03"], bands["B08"]
    valid = ~np.isin(scl, common.SCL_BAD) & (g > 0) & (n > 0)
    wet = ((g - n) / np.maximum(g + n, 1)) > 0
    return wet & valid, valid, transform


def tile_window(cat, tf, shape, crs, pad=20):
    """The grid's rows and columns the tile covers (with a margin)."""
    from rasterio.warp import transform_bounds
    l, b, r, t = transform_bounds(f"EPSG:{cat['epsg']}", crs, *cat["bbox10"], densify_pts=21)
    c0, r0 = ~tf * (l, t)
    c1, r1 = ~tf * (r, b)
    r0, c0 = max(int(r0) - pad, 0), max(int(c0) - pad, 0)
    r1, c1 = min(int(r1) + pad, shape[0]), min(int(c1) + pad, shape[1])
    return slice(r0, r1), slice(c0, c1)


def accumulate(tile, cat, cfg, tf, shape, crs):
    """(window, wet votes, valid votes) over the tile's part of the grid."""
    import rasterio
    from rasterio.warp import reproject, Resampling
    win = tile_window(cat, tf, shape, crs)
    wshape = (win[0].stop - win[0].start, win[1].stop - win[1].start)
    wtf = tf * tf.translation(win[1].start, win[0].start)
    wet_sum = np.zeros(wshape, np.uint16)
    valid_sum = np.zeros(wshape, np.uint16)
    if min(wshape) <= 0:
        return win, wet_sum, valid_sum
    for it in pick(cat["items"], cfg["coarse"]["scenesPerTile"], cfg["coarse"]["maxTileCloud"]):
        for attempt in range(3):
            try:
                wet, valid, src_tf = read_coarse(it)
                break
            except Exception as e:
                print(f"  {tile} {it['stamp']}: retry {attempt + 1}: {e!r}"[:200], flush=True)
        else:
            continue
        for arr, acc in ((wet, wet_sum), (valid, valid_sum)):
            dst = np.zeros(wshape, np.uint8)
            reproject(arr.astype(np.uint8), dst, src_transform=src_tf, src_crs=f"EPSG:{cat['epsg']}",
                      dst_transform=wtf, dst_crs=crs, resampling=Resampling.nearest, src_nodata=None,
                      init_dest_nodata=False)
            acc += dst
        # Cells outside the tile come back 0 for both: no vote.
    return win, wet_sum, valid_sum


def chained(lab, land, touching, px_km):
    """Ireland: the biggest land not joined to the box's edge, and the land
    within 15 km of it by a chain of islands, twice over."""
    from scipy import ndimage
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    sizes_ok = sizes.copy()
    sizes_ok[touching] = 0
    main_island = lab == sizes_ok.argmax()
    near = ndimage.distance_transform_edt(~main_island) * px_km <= 15
    keep = np.unique(lab[near & land])
    keep = keep[(keep > 0) & ~np.isin(keep, touching)]
    ireland = np.isin(lab, keep)
    # Chain once more, so an island off an island comes in (Fastnet off Cape Clear).
    near = ndimage.distance_transform_edt(~ireland) * px_km <= 15
    keep = np.unique(lab[near & land])
    keep = keep[(keep > 0) & ~np.isin(keep, touching)]
    return keep


def in_polygon(lab, land, sure, ring, min_sure, tf, shape, crs):
    """Great Britain: every piece of land mostly inside coarse.landPolygon (lon,
    lat), a line drawn through the seas between it and Ireland and the
    continent: the Hebrides, Orkney, Shetland, Scilly and Man come in, which
    no chain of islands 15 km apart reaches, and Rathlin and Alderney stay out.
    A piece needs min_sure cells dry in four fifths of at least four clear
    looks: the open sea's specks, a cloud or glint the masks missed in a
    handful of looks (dry in about half), are left out, and so are most oil
    platforms; St Kilda, North Rona and Sule Skerry have dozens."""
    from pyproj import Transformer
    from rasterio.features import rasterize
    to = Transformer.from_crs(4326, crs, always_xy=True)
    pts = []
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        for f in np.linspace(0, 1, 50, endpoint=False):
            pts.append(to.transform(x0 + f * (x1 - x0), y0 + f * (y1 - y0)))
    inside = rasterize([({"type": "Polygon", "coordinates": [pts + pts[:1]]}, 1)], out_shape=shape,
                       transform=tf, fill=0, dtype="uint8").astype(bool)
    n = lab.max() + 1
    total = np.bincount(lab[land], minlength=n)
    within = np.bincount(lab[land & inside], minlength=n)
    certain = np.bincount(lab[land & sure], minlength=n)
    keep = np.flatnonzero((within * 2 > total) & (total > 0) & (certain >= min_sure))
    return keep[keep > 0]


def main():
    import rasterio
    from scipy import ndimage
    cfg = common.config()
    c = cfg["coarse"]
    tf, shape, crs = grid(cfg)
    cats = tile_catalogs()
    print(f"coarse grid {shape} at {c['pixelMetres']} m, {len(cats)} tiles", flush=True)
    votes = common.path("work", "coarse-votes.npz")
    if os.path.exists(votes):
        z = np.load(votes)
        wet, valid = z["wet"], z["valid"]
    else:
        wet = np.zeros(shape, np.uint32)
        valid = np.zeros(shape, np.uint32)
        with cf.ThreadPoolExecutor(8) as pool:
            futs = {pool.submit(accumulate, t, cat, cfg, tf, shape, crs): t for t, cat in cats.items()}
            for f in cf.as_completed(futs):
                win, w_, v_ = f.result()
                wet[win] += w_
                valid[win] += v_
                print(f"  {futs[f]} done", flush=True)
        os.makedirs(common.path("work"), exist_ok=True)
        np.savez_compressed(votes, wet=wet, valid=valid)
    px_km = c["pixelMetres"] / 1000
    water = (wet * 2 >= valid) | (valid < 2)
    sure = (valid >= 4) & (wet * 5 <= valid)
    del wet, valid
    lab, n = ndimage.label(water)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    sea = np.isin(lab, edge[edge > 0])
    del water
    land = ~sea
    lab, n = ndimage.label(land)
    touching = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    if c.get("landPolygon"):
        keep = in_polygon(lab, land, sure, c["landPolygon"], c.get("minSureCells", 5), tf, shape, crs)
    else:
        keep = chained(lab, land, touching, px_km)
    ireland = ndimage.binary_fill_holes(np.isin(lab, keep))
    del lab
    sea = sea & ~ireland
    sea_to_land = ndimage.distance_transform_edt(~ireland) * px_km
    # Smoothed (σ 300 m): on a 100 m grid the distance's contours are steps,
    # and the imagery's fade at sea follows them.
    sea_to_land = ndimage.gaussian_filter(sea_to_land, 3)
    land_to_sea = ndimage.distance_transform_edt(~sea) * px_km
    coverage = ireland | (sea_to_land <= c["seaKm"])
    coastal = (ireland & (land_to_sea <= c["coastalLandKm"])) | (sea & (sea_to_land <= c["coastalSeaKm"]))
    profile = {"driver": "GTiff", "width": shape[1], "height": shape[0], "count": 5, "dtype": "float32",
               "crs": crs, "transform": tf, "compress": "deflate", "tiled": True}
    with rasterio.open(common.path("work", "coarse.tif"), "w", **profile) as dst:
        for i, (a, name) in enumerate([(coverage, "coverage"), (coastal, "coastal"), (sea, "sea"),
                                       (np.where(ireland, land_to_sea, 0), "land_to_sea_km"),
                                       (np.where(sea, sea_to_land, 0), "sea_to_land_km")], 1):
            dst.write(a.astype(np.float32), i)
            dst.set_band_description(i, name)
    km2 = (c["pixelMetres"] / 1000) ** 2
    doc = {"shape": list(shape), "pixelMetres": c["pixelMetres"], "irelandKm2": round(float(ireland.sum() * km2)),
           "coverageKm2": round(float(coverage.sum() * km2)), "coastalKm2": round(float(coastal.sum() * km2)),
           "islands": int(len(keep))}
    common.write_json(common.path("work", "coarse.json"), doc)
    print(doc)


if __name__ == "__main__":
    sys.exit(main())
