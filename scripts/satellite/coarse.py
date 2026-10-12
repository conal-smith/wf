"""The island at 100 m: land, sea, what the layer covers and where the coast is.

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


def accumulate(tile, cat, cfg, tf, shape, crs):
    import rasterio
    from rasterio.warp import reproject, Resampling
    wet_sum = np.zeros(shape, np.uint16)
    valid_sum = np.zeros(shape, np.uint16)
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
            dst = np.zeros(shape, np.uint8)
            reproject(arr.astype(np.uint8), dst, src_transform=src_tf, src_crs=f"EPSG:{cat['epsg']}",
                      dst_transform=tf, dst_crs=crs, resampling=Resampling.nearest, src_nodata=None,
                      init_dest_nodata=False)
            acc += dst
        # Cells outside the tile come back 0 for both: no vote.
    return wet_sum, valid_sum


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
                w_, v_ = f.result()
                wet += w_
                valid += v_
                print(f"  {futs[f]} done", flush=True)
        os.makedirs(common.path("work"), exist_ok=True)
        np.savez_compressed(votes, wet=wet, valid=valid)
    px_km = c["pixelMetres"] / 1000
    water = (wet * 2 >= valid) | (valid < 2)
    lab, n = ndimage.label(water)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    sea = np.isin(lab, edge[edge > 0])
    land = ~sea
    lab, n = ndimage.label(land)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    touching = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
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
    ireland = ndimage.binary_fill_holes(np.isin(lab, keep))
    sea = sea & ~ireland
    sea_to_land = ndimage.distance_transform_edt(~ireland) * px_km
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
