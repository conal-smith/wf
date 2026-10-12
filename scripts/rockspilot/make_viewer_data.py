"""Data for the local Leaflet viewer (viewer.html): one JS file (file:// pages cannot fetch JSON)
and PNG overlays reprojected to Web Mercator.

    python -I make_viewer_data.py --s2 <dl>/s2 --out <out> --viewer <dir with viewer.html>
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import matplotlib  # noqa: E402
matplotlib.use("Agg")
import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from matplotlib import colormaps  # noqa: E402
from matplotlib.colors import Normalize, TwoSlopeNorm  # noqa: E402
from PIL import Image  # noqa: E402
from pyproj import Transformer  # noqa: E402
from rasterio.warp import Resampling, calculate_default_transform, reproject  # noqa: E402

import common  # noqa: E402

HERE = Path(__file__).resolve().parent


def to_mercator(arrays, meta, resampling):
    left, bottom, right, top = meta["bounds"]
    h, w = meta["shape"]
    src_crs = f"EPSG:{meta['epsg']}"
    tr, width, height = calculate_default_transform(src_crs, "EPSG:3857", w, h, left, bottom, right, top, resolution=8)
    out = []
    for a in arrays:
        dst = np.full((height, width), np.nan, np.float32)
        reproject(a.astype(np.float32), dst, src_transform=common.transform(meta), src_crs=src_crs, src_nodata=np.nan,
                  dst_transform=tr, dst_crs="EPSG:3857", dst_nodata=np.nan, resampling=resampling)
        out.append(dst)
    x0, y0 = tr * (0, height)
    x1, y1 = tr * (width, 0)
    to_ll = Transformer.from_crs(3857, 4326, always_xy=True)
    (lon0, lat0), (lon1, lat1) = to_ll.transform(x0, y0), to_ll.transform(x1, y1)
    return out, [[lat0, lon0], [lat1, lon1]]


def save_rgba(path, rgba):
    Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA").save(path, optimize=True)


def colourise(a, cmap, norm, alpha=0.85):
    rgba = colormaps[cmap](norm(np.nan_to_num(a)))
    rgba[..., 3] = np.where(np.isfinite(a), alpha, 0)
    return rgba


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--s2", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--viewer", required=True, type=Path)
    args = p.parse_args()
    data_dir = args.viewer / "viewer-data"
    data_dir.mkdir(parents=True, exist_ok=True)
    payload = {"areas": {}}
    for area in ("down", "dublin"):
        a = common.areas()[area]
        meta = common.grid(args.s2, area)
        d = args.out / area
        summary = json.loads((d / f"{area}-heights.json").read_text())
        figs = json.loads((d / f"{area}-figures.json").read_text())
        overlays = {}
        for tag in ("lowtide", "hightide"):
            s = figs[tag]
            r = common.reflectance(common.load_scene(args.s2, area, s["stamp"]))
            bands, bounds = to_mercator([r["B04"], r["B03"], r["B02"]], meta, Resampling.bilinear)
            img = np.clip(np.dstack(bands) * 3.5, 0, 1) ** (1 / 1.6)
            alpha = np.isfinite(bands[0]).astype(np.float32)[..., None]
            save_rgba(data_dir / f"{area}-{tag}.png", np.concatenate([np.nan_to_num(img), alpha], 2))
            st = s["stamp"]
            overlays[tag] = {"url": f"viewer-data/{area}-{tag}.png", "bounds": bounds,
                             "label": f"Sentinel-2 {st[:4]}-{st[4:6]}-{st[6:8]}, tide {s['tide']:.2f} m"}
        with rasterio.open(d / f"{area}-heights.tif") as src:
            z = src.read(1)
        (zm,), bounds = to_mercator([z], meta, Resampling.nearest)
        lo, hi = summary["tide_range_kept"]
        save_rgba(data_dir / f"{area}-heights.png", colourise(zm, "viridis", Normalize(lo, hi)))
        overlays["heights"] = {"url": f"viewer-data/{area}-heights.png", "bounds": bounds,
                               "label": f"Intertidal height (flip level), {lo:.1f}-{hi:.1f} m", "range": [lo, hi]}
        if area == "dublin":
            with rasterio.open(d / f"{area}-foildepth-on-grid.tif") as src:
                diff = src.read(4)
            (dm,), bounds = to_mercator([diff], meta, Resampling.nearest)
            save_rgba(data_dir / f"{area}-diff.png", colourise(dm, "RdBu_r", TwoSlopeNorm(0, -1.5, 1.5)))
            overlays["diff"] = {"url": f"viewer-data/{area}-diff.png", "bounds": bounds,
                                "label": "Satellite minus foil-depth layer (red: satellite higher, +-1.5 m)"}
        rocks = json.loads((d / f"{area}-rocks.geojson").read_text())
        osm = json.loads((d / f"{area}-osm.geojson").read_text())
        osm["features"] = [f for f in osm["features"] if f["properties"]["class"] in ("rock", "soft")]
        vs_osm = json.loads((d / f"{area}-rocks-vs-osm.json").read_text())
        w, s_, e, n = a["bbox"]
        payload["areas"][area] = {"name": a["name"], "bounds": [[s_, w], [n, e]], "spots": a["spots"],
                                  "datum": "m above LAT (Howth gauge)" if area != "down" else "m above chart datum (EOT20 calibrated to UKHO Killard Point)",
                                  "rocks": rocks, "osm": osm, "overlays": overlays, "summary": {
                                      "scenes": summary["scenes_kept"], "tideRange": summary["tide_range_kept"],
                                      "rockPolygons": vs_osm["polygons"], "rockKm2": vs_osm["rock_km2"]}}
    (data_dir / "data.js").write_text("window.PILOT = " + json.dumps(payload, separators=(",", ":")) + ";\n")
    shutil.copy(HERE / "viewer.html", args.viewer / "viewer.html")
    print("wrote", args.viewer / "viewer.html", (data_dir / "data.js").stat().st_size, "bytes of data")


if __name__ == "__main__":
    main()
