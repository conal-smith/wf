"""Satellite-derived intertidal heights against the foil-depth layer and the LiDAR under it.

The foil-depth archive (public/foildepth/dublin-north.pmtiles, Terrarium, m above
LAT; 50 = not water, 40 = water of unsurveyed depth) is decoded at z14 (~2.9 m),
put on the satellite's 10 m UTM grid (median of the heights in each cell; the
codes by majority), and compared:

- heights where both have one (median and IQR of satellite minus layer),
  split by what the layer is built from there: the OPW/TII LiDAR (2 m, OD Malin
  + 2.561 m to LAT, only above the flight's water, 1.65 m LAT) or not (the
  EMODnet waterlines' interpolation, INFOMAR);
- wet/dry agreement at three tide levels over the coastal strip;
- the Malahide lagoon (a basin with its own level, not Howth's tide) is left out.

    python -I compare_foildepth.py --heights <out>/dublin --pmtiles public/foildepth/dublin-north.pmtiles \
        --lidar <foildepth-data>/lidar/mal/mosaic_DTM_mal_ITM_ODMalin_2m.tif --s2 <dl>/s2 --out <out>/dublin
"""
import argparse
import io
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import matplotlib  # noqa: E402
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from matplotlib.colors import TwoSlopeNorm  # noqa: E402
from PIL import Image  # noqa: E402
from pmtiles.reader import MmapSource, Reader  # noqa: E402
from rasterio.features import rasterize  # noqa: E402
from rasterio.transform import from_bounds  # noqa: E402
from rasterio.warp import Resampling, reproject, transform_geom  # noqa: E402
from scipy import ndimage  # noqa: E402

import common  # noqa: E402

ODM_TO_LAT = 2.561  # Howth: LAT height - OD Malin height
LIDAR_WATER_LAT = 1.65  # the 2011 flight saw the sea's surface about here
LAGOON = [[-6.1551, 53.4594], [-6.155, 53.4604], [-6.1545, 53.4634], [-6.1539, 53.4672], [-6.1537, 53.4691],
          [-6.154, 53.47], [-6.155, 53.476], [-6.26, 53.476], [-6.26, 53.445], [-6.1567, 53.445],
          [-6.1566, 53.4527], [-6.1562, 53.4554], [-6.156, 53.4563], [-6.1559, 53.4573], [-6.1558, 53.4578]]
R = 6378137.0


def tile_bounds_3857(z, x, y):
    n = 2 ** z
    size = 2 * math.pi * R / n
    left = -math.pi * R + x * size
    top = math.pi * R - y * size
    return left, top - size, left + size, top


def lonlat_tile(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def decode_archive(path, bbox, z=14):
    """Mosaic of Terrarium heights over bbox at zoom z, EPSG:3857."""
    w, s, e, n = bbox
    x0, y0 = lonlat_tile(w, n, z)
    x1, y1 = lonlat_tile(e, s, z)
    with open(path, "rb") as f:
        reader = Reader(MmapSource(f))
        size = None
        tiles = {}
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                data = reader.get(z, x, y)
                if data:
                    a = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"), dtype=np.float64)
                    tiles[(x, y)] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
                    size = a.shape[0]
    mosaic = np.full(((y1 - y0 + 1) * size, (x1 - x0 + 1) * size), np.nan, np.float32)
    for (x, y), a in tiles.items():
        mosaic[(y - y0) * size:(y - y0 + 1) * size, (x - x0) * size:(x - x0 + 1) * size] = a
    left, _, _, top = tile_bounds_3857(z, x0, y0)
    _, bottom, right, _ = tile_bounds_3857(z, x1, y1)
    return mosaic, from_bounds(left, bottom, right, top, mosaic.shape[1], mosaic.shape[0])


def to_grid(src, src_transform, src_crs, meta, resampling, nodata=np.nan):
    h, w = meta["shape"]
    dst = np.full((h, w), np.nan, np.float32)
    reproject(src, dst, src_transform=src_transform, src_crs=src_crs, src_nodata=nodata,
              dst_transform=common.transform(meta), dst_crs=f"EPSG:{meta['epsg']}", dst_nodata=np.nan,
              resampling=resampling)
    return dst


def stats(d):
    d = d[np.isfinite(d)]
    if not len(d):
        return None
    q1, med, q3 = np.percentile(d, [25, 50, 75])
    return {"n": int(len(d)), "median": round(float(med), 3), "iqr": [round(float(q1), 3), round(float(q3), 3)],
            "mean": round(float(d.mean()), 3), "mae": round(float(np.abs(d).mean()), 3),
            "within_0.5m": round(float((np.abs(d) <= 0.5).mean()), 3)}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--heights", required=True, type=Path)
    p.add_argument("--pmtiles", required=True, type=Path)
    p.add_argument("--lidar", required=True, type=Path)
    p.add_argument("--s2", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--area", default="dublin")
    args = p.parse_args()
    meta = common.grid(args.s2, args.area)
    area = common.areas()[args.area]
    with rasterio.open(args.heights / f"{args.area}-heights.tif") as src:
        zsat = src.read(1)
        zall = src.read(2)
    state = np.load(args.heights / f"{args.area}-state.npy")
    intertidal = np.load(args.heights / f"{args.area}-intertidal.npy")

    mosaic, mtr = decode_archive(args.pmtiles, area["bbox"])
    heights = np.where(mosaic < 39, mosaic, np.nan).astype(np.float32)
    code = np.where(np.isnan(mosaic), 0, np.where(mosaic >= 49, 50, np.where(mosaic >= 39, 40, 1))).astype(np.float32)
    zfoil = to_grid(heights, mtr, "EPSG:3857", meta, Resampling.med)
    cfoil = to_grid(code, mtr, "EPSG:3857", meta, Resampling.mode, nodata=0)  # 1 height, 40 unsurveyed, 50 land, nan outside

    with rasterio.open(args.lidar) as src:
        lid = src.read(1).astype(np.float32)
        lid[lid == src.nodata] = np.nan
        lid += ODM_TO_LAT
        zlid = to_grid(lid, src.transform, src.crs, meta, Resampling.med)

    lagoon = rasterize([transform_geom("EPSG:4326", f"EPSG:{meta['epsg']}", {"type": "Polygon", "coordinates": [LAGOON + [LAGOON[0]]]})],
                       out_shape=tuple(meta["shape"]), transform=common.transform(meta)).astype(bool)

    both = intertidal & np.isfinite(zfoil) & ~lagoon
    lidar_ok = np.isfinite(zlid) & (zlid > LIDAR_WATER_LAT + 0.05)
    d = zsat - zfoil
    d_lidar = zsat - zlid
    result = {
        "satellite_minus_layer_all": stats(d[both]),
        "satellite_minus_layer_where_layer_is_lidar": stats(d[both & lidar_ok & (np.abs(zfoil - zlid) < 0.3)]),
        "satellite_minus_layer_elsewhere": stats(d[both & ~lidar_ok]),
        "satellite_minus_lidar_direct": stats(d_lidar[intertidal & lidar_ok & ~lagoon]),
        "layer_pixels_in_satellite_intertidal": int(both.sum()),
        "satellite_intertidal_pixels_outside_lagoon": int((intertidal & ~lagoon).sum()),
        "satellite_intertidal_where_layer_says_land": int((intertidal & ~lagoon & (cfoil == 50)).sum()),
        "satellite_intertidal_where_layer_says_unsurveyed": int((intertidal & ~lagoon & (cfoil == 40)).sum()),
    }
    # Wet/dry agreement. Satellite: intertidal height, else below every tide seen (state 2), else above (3).
    # Layer: height, 50 = never wet (land), 40 = always wet.
    sat_z = np.where(intertidal, zsat, np.where(state == 2, -10.0, np.where(state == 3, 10.0, np.nan)))
    # The flips the satellite saw outside the cleaned intertidal (noise, inland) are not used.
    sat_z[(state == 1) & ~intertidal] = np.nan
    lay_z = np.where(cfoil == 50, 50.0, np.where(cfoil == 40, -10.0, zfoil))
    coast = ndimage.binary_dilation(intertidal, iterations=30) & ~lagoon  # within 300 m of the satellite intertidal
    comp = coast & np.isfinite(sat_z) & np.isfinite(lay_z)
    agreement = {}
    for t in (1.5, 2.5, 3.5):
        sw, lw = sat_z[comp] < t, lay_z[comp] < t
        agreement[f"{t}"] = {"agree": round(float((sw == lw).mean()), 3),
                             "satellite_wet_layer_dry": round(float((sw & ~lw).mean()), 3),
                             "satellite_dry_layer_wet": round(float((~sw & lw).mean()), 3),
                             "n": int(comp.sum()),
                             "agree_where_either_intertidal": round(float((sw == lw)[(np.abs(sat_z[comp]) < 9) | (lay_z[comp] < 9) & (lay_z[comp] > -9)].mean()), 3)}
    result["wet_dry_agreement"] = agreement
    (args.out / f"{args.area}-vs-foildepth.json").write_text(json.dumps(result, indent=1))
    print(json.dumps(result, indent=1))
    common.write_tif(args.out / f"{args.area}-foildepth-on-grid.tif", [zfoil, cfoil, zlid, np.where(both, d, np.nan)], meta,
                     ["foildepth_height_m_LAT", "foildepth_code", "lidar_m_LAT", "satellite_minus_layer_m"])

    # Figures: satellite heights, layer heights, difference, and a 2D histogram.
    fig, axes = plt.subplots(1, 3, figsize=(18, 7), dpi=110)
    show = lambda a: np.ma.masked_invalid(a)  # noqa: E731
    vmin, vmax = 0.8, 4.8
    axes[0].imshow(show(np.where(intertidal & ~lagoon, zsat, np.nan)), cmap="viridis", vmin=vmin, vmax=vmax)
    axes[0].set_title("Sentinel-2 flip height (m LAT, Howth)")
    im = axes[1].imshow(show(np.where(intertidal & ~lagoon, zfoil, np.nan)), cmap="viridis", vmin=vmin, vmax=vmax)
    axes[1].set_title("Foil-depth layer height, same pixels (m LAT)")
    fig.colorbar(im, ax=axes[:2], shrink=0.6, label="m above LAT")
    im2 = axes[2].imshow(show(np.where(both, d, np.nan)), cmap="RdBu_r", norm=TwoSlopeNorm(0, -1.5, 1.5))
    axes[2].set_title("Satellite minus layer (m): red = satellite higher")
    fig.colorbar(im2, ax=axes[2], shrink=0.6)
    for ax in axes:
        ax.set_axis_off()
    fig.savefig(args.out / f"{args.area}-heights-vs-foildepth.png", bbox_inches="tight")
    plt.close(fig)

    fig, axes = plt.subplots(1, 2, figsize=(12, 5.5), dpi=110)
    for ax, (mask, label) in zip(axes, [(both & lidar_ok & (np.abs(zfoil - zlid) < 0.3), "where the layer is LiDAR"),
                                        (both & ~lidar_ok, "where the layer is waterlines / INFOMAR")]):
        if mask.sum() > 10:
            ax.hexbin(zfoil[mask], zsat[mask], gridsize=40, extent=(0, 5.5, 0, 5.5), mincnt=1, cmap="Blues", bins="log")
        ax.plot([0, 5.5], [0, 5.5], color="#c0392b", lw=1)
        ax.set_xlabel("foil-depth layer (m LAT)")
        ax.set_ylabel("Sentinel-2 flip height (m LAT)")
        ax.set_title(f"{label} (n={int(mask.sum())})")
    fig.savefig(args.out / f"{args.area}-heights-scatter.png", bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    main()
