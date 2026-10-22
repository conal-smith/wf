"""Where to look: the open coast's shallow nearshore band, on the satellite
run's 100 m grid (coarse.tif).

A 100 m cell is searched when it is:

1. **in the band**: sea within band.seaKm of land, or land within
   band.landKm of the sea (the surf zone at a beach can sit on what the
   coarse grid calls land, the shore moving with the tide);
2. **shallow**: the shallowest of EMODnet Bathymetry's DTM (about 115 m,
   metres about LAT where charted, CC BY 4.0; scripts/satellite/bathyguard.py
   fetch) within a cell round it is no deeper than depth.maxMetres. Swell
   breaks in water about 1.3 times its height deep: 15 m keeps every break of
   a 10 m wave, and the outer reefs (Mullaghmore, Aileens) with them. Where
   the DTM has no value (its own land, by the shore) the cell is kept;
3. **not enclosed**: water reachable from the open sea only through a gap
   narrower than 2 x enclosed.gapKm (a sea lough's narrows, a harbour mouth,
   a bar across an estuary) is left out, except within enclosed.keepKm of
   the open water, through the water: the mouths and their bars stay in.
   Found by a morphological opening of the sea with a disc of radius gapKm
   (channels narrower than its diameter vanish), the opened sea joined to the
   grid's edge as the open water, and a walk from it through the sea for
   keepKm. Nothing is ruled out for the way the coast faces: swell wraps
   round headlands and into the Irish Sea, so the imagery decides.

Also the **offshore ring**: sea band.offshoreKm[0] to [1] from land, inside
the same blocks, where whitecaps (not breaking on the bottom) are measured
for each look. And each cell's depth and the way its shore faces.

Writes <root>/<region>/work/search.tif (bands: flags, depth_m, facing_deg,
slope) and search.json (km² searched and left out, by reason).
flags: 1 searched, 2 band but too deep, 4 band but enclosed, 8 offshore ring.

    python -I mask.py [--region ireland|gb]
"""
import argparse
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import wf  # noqa: E402

SEARCH, DEEP, ENCLOSED, RING = 1, 2, 4, 8


def disc(r):
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def enclosed(sea, gap_px, keep_px):
    """Sea cells behind a constriction: not within keep_px (through the sea) of the
    sea that survives an opening by a disc of radius gap_px and touches the grid's edge."""
    from scipy import ndimage
    opened = ndimage.binary_opening(sea, structure=disc(gap_px))
    lab, n = ndimage.label(opened)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    edge = edge[edge > 0]
    if edge.size == 0:  # a box with no open edge: the largest piece is the ocean
        sizes = np.bincount(lab.ravel())
        sizes[0] = 0
        edge = np.array([int(sizes.argmax())])
    reach = np.isin(lab, edge)
    cross = ndimage.generate_binary_structure(2, 1)
    reach = ndimage.binary_dilation(reach, structure=cross, iterations=keep_px, mask=sea)
    return sea & ~reach


def shallowest_on(grid_tf, grid_crs, rows, cols, dtm_path, cell=1):
    """The DTM's shallowest value (highest elevation) within `cell` DTM pixels of each
    grid cell's centre; NaN where it has none."""
    import rasterio
    from pyproj import Transformer
    from scipy import ndimage
    with rasterio.open(dtm_path) as src:
        dtm = src.read(1)
        inv = ~src.transform
        dcrs = src.crs
    filled = np.where(np.isfinite(dtm), dtm, -1e9)
    top = ndimage.maximum_filter(filled, size=2 * cell + 1)
    top = np.where(top <= -1e8, np.nan, top)
    x, y = grid_tf * (cols + 0.5, rows + 0.5)
    lon, lat = Transformer.from_crs(grid_crs, dcrs, always_xy=True).transform(x, y)
    c, r = inv * (lon, lat)
    r, c = np.floor(r).astype(np.int64), np.floor(c).astype(np.int64)
    ok = (r >= 0) & (r < top.shape[0]) & (c >= 0) & (c < top.shape[1])
    out = np.full(rows.shape, np.nan, np.float32)
    out[ok] = top[r[ok], c[ok]]
    return out


def main():
    import rasterio
    from scipy import ndimage
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", default="ireland")
    a = p.parse_args()
    wf.set_region(a.region)
    common = wf.satellite()
    cfg = wf.config()
    band, dep, enc = cfg["band"], cfg["depth"], cfg["enclosed"]
    with rasterio.open(common.path("work", "coarse.tif")) as src:
        coverage, sea = src.read(1) > 0, src.read(3) > 0
        land_d, sea_d = src.read(4), src.read(5)
        tf, crs, prof = src.transform, src.crs, src.profile
    px_km = abs(tf.a) / 1000
    # The region's own coast only (coverage: its land and the sea near it; not Kintyre
    # in Ireland's grid).
    in_band = coverage & ((sea & (sea_d <= band["seaKm"])) | (~sea & (land_d <= band["landKm"])))
    ring = coverage & sea & (sea_d >= band["offshoreKm"][0]) & (sea_d <= band["offshoreKm"][1])
    print(f"band {in_band.sum() * px_km ** 2:.0f} km², ring {ring.sum() * px_km ** 2:.0f} km²", flush=True)

    shut = enclosed(sea, int(round(enc["gapKm"] / px_km)), int(round(enc["keepKm"] / px_km)))
    # Land by enclosed water only (no open sea within band.landKm) is enclosed too.
    open_sea = sea & ~shut
    near_open = ndimage.distance_transform_edt(~open_sea) * px_km <= band["landKm"] + px_km / 2
    shut_band = in_band & ((sea & shut) | (~sea & ~near_open))

    rows, cols = np.nonzero(in_band | ring)
    depth = np.full(sea.shape, np.nan, np.float32)
    depth[rows, cols] = shallowest_on(tf, crs, rows, cols, common.path("work", "emodnet.tif"), dep["cellPixels"])
    deep = in_band & sea & np.isfinite(depth) & (depth < -abs(dep["maxMetres"]))

    flags = np.zeros(sea.shape, np.uint8)
    flags[in_band & ~deep & ~shut_band] |= SEARCH
    flags[deep] |= DEEP
    flags[shut_band] |= ENCLOSED
    flags[ring & ~shut] |= RING

    # The way each searched cell's shore faces (up the sea's distance from land) and the
    # seabed's slope (depth change per km over the cell's neighbours).
    sm = ndimage.gaussian_filter(np.where(sea, sea_d, -land_d).astype(np.float32), 2)
    gy, gx = np.gradient(sm)
    facing = np.full(sea.shape, np.nan, np.float32)
    s = flags & SEARCH > 0
    facing[s] = (np.degrees(np.arctan2(gx[s], -gy[s])) % 360).astype(np.float32)
    dz = np.where(np.isfinite(depth), depth, np.nan)
    gzy, gzx = np.gradient(np.nan_to_num(dz, nan=0.0))
    slope = np.where(np.isfinite(dz), np.hypot(gzx, gzy) / px_km / 1000, np.nan).astype(np.float32)

    out = wf.rpath("work", "search.tif")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    prof.update(count=4, dtype="float32", compress="deflate", tiled=True, blockxsize=512, blockysize=512, nodata=None)
    with rasterio.open(out, "w", **prof) as dst:
        for i, (arr, name) in enumerate(((flags.astype(np.float32), "flags"), (depth, "depth_m"),
                                         (facing, "facing_deg"), (slope, "slope")), 1):
            dst.write(arr.astype(np.float32), i)
            dst.set_band_description(i, name)
    km2 = px_km ** 2
    doc = {"region": a.region, "bandKm2": round(float(in_band.sum() * km2)),
           "searchedKm2": round(float((flags & SEARCH > 0).sum() * km2)),
           "deepKm2": round(float(deep.sum() * km2)), "enclosedKm2": round(float(shut_band.sum() * km2)),
           "ringKm2": round(float((flags & RING > 0).sum() * km2)),
           "settings": {"band": band, "depth": dep, "enclosed": enc}}
    wf.write_json(wf.rpath("work", "search.json"), doc, indent=1)
    print(doc, flush=True)


if __name__ == "__main__":
    sys.exit(main())
