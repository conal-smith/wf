"""Shared pieces of the rocks pilot: areas, scenes, tide levels, indices, raster output."""
import json
from datetime import datetime
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SCL_BAD = (0, 1, 3, 8, 9, 10)


def areas():
    return json.loads((HERE / "areas.json").read_text())["areas"]


def grid(s2, area):
    meta = json.loads((Path(s2) / area / "scenes.json").read_text())
    return meta


def transform(meta):
    from rasterio.transform import from_origin
    left, bottom, right, top = meta["bounds"]
    return from_origin(left, top, 10, 10)


def tide_levels(area, tide_dir, out_tide_dir):
    """Scene stamp -> (level m above LAT/CD, source)."""
    tide_dir, out_tide_dir = Path(tide_dir), Path(out_tide_dir)
    levels = {}
    if area != "down":
        howth = json.loads((tide_dir / f"{area}-howth.json").read_text())["levels"]
        model_path = out_tide_dir / f"{area}-eot20.json"
        model = json.loads(model_path.read_text()) if model_path.exists() else {}
        for stamp in set(howth) | set(model):
            obs = howth.get(stamp, {}).get("level")
            if obs is not None:
                levels[stamp] = (obs, "Howth gauge")
            elif stamp in model:
                levels[stamp] = (model[stamp], "EOT20 at Howth")
    else:
        model = json.loads((out_tide_dir / "down-tide.json").read_text())["levels"]
        for stamp, v in model.items():
            levels[stamp] = (v["level"], "EOT20 calibrated to UKHO Killard Point")
    return levels


def load_scene(s2, area, stamp):
    with np.load(Path(s2) / area / f"{stamp}.npz") as z:
        return {k: z[k] for k in z.files}


def reflectance(scene):
    return {b: scene[b].astype(np.float32) / 10000.0 for b in ("B02", "B03", "B04", "B08", "B11")}


def bad_mask(scene):
    """SCL's clouds, shadow, cirrus, saturation and no data, plus our own: haze/cloud the SCL missed
    (very bright blue), and zero-filled edges."""
    r = scene["B02"].astype(np.float32) / 10000.0
    return np.isin(scene["SCL"], SCL_BAD) | (r > 0.22) | (scene["B03"] == 0) | (scene["B08"] == 0)


def ndwi(refl):
    g, n = refl["B03"], refl["B08"]
    return (g - n) / np.maximum(g + n, 1e-4)


def mndwi(refl):
    g, s = refl["B03"], refl["B11"]
    return (g - s) / np.maximum(g + s, 1e-4)


def ndvi(refl):
    r, n = refl["B04"], refl["B08"]
    return (n - r) / np.maximum(n + r, 1e-4)


def write_tif(path, arrays, meta, names, nodata=np.nan, dtype="float32"):
    import rasterio
    arrays = [np.asarray(a, dtype=dtype) for a in arrays]
    h, w = arrays[0].shape
    with rasterio.open(path, "w", driver="GTiff", height=h, width=w, count=len(arrays), dtype=dtype,
                       crs=f"EPSG:{meta['epsg']}", transform=transform(meta), nodata=nodata,
                       compress="deflate", predictor=3 if dtype.startswith("float") else 2, tiled=True) as dst:
        for i, (a, name) in enumerate(zip(arrays, names), 1):
            dst.write(a, i)
            dst.set_band_description(i, name)


def stamp_time(stamp):
    return datetime.strptime(stamp, "%Y%m%dT%H%M%S")
