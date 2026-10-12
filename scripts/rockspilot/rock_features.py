"""Per-pixel surface features of the exposed foreshore, from the low-tide scenes.

For every kept scene at or below --max-tide, each pixel that is dry and clear
in it contributes. Per pixel (medians over those looks):

- vis: mean of blue, green and red reflectance (rock and weed are dark; sand is bright);
- ndvi: (NIR - red)/(NIR + red); wrack and kelp exposed at low water are clearly positive;
- swir: B11 (20 m);
- veg_share: share of looks with NDVI > 0.25;
- veg_years: share of years (with at least one look) whose median NDVI > 0.25: weed on rock is
  there every year, an Ulva bloom or a seagrass bed on mud comes and goes;
- vis_cv: the looks' brightness spread over their median (sand changes with wetness and
  ripples, rock stays dark);
- texture: the 3x3 spread of the median brightness (a rocky shore is patchy at 10 m,
  a flat is smooth);
- n_looks;
- ndvi_summer, ndvi_winter: median NDVI over every dry look (any tide) in May-Aug and
  Nov-Feb. Saltmarsh browns off in winter; wrack on rock does not.

    python -I rock_features.py --area down --s2 .. --heights <out>/down --out <out>/down [--max-tide 2.2]
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
from scipy import ndimage  # noqa: E402

import common  # noqa: E402


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--area", required=True)
    p.add_argument("--s2", required=True, type=Path)
    p.add_argument("--heights", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--max-tide", type=float, default=2.2)
    args = p.parse_args()
    meta = common.grid(args.s2, args.area)
    summary = json.loads((args.heights / f"{args.area}-heights.json").read_text())
    scenes = [s for s in summary["kept_scenes"] if s["tide"] <= args.max_tide]
    print(f"{args.area}: {len(scenes)} scenes at or below {args.max_tide} m", flush=True)
    shape = tuple(meta["shape"])
    n = len(scenes)
    vis = np.full((n,) + shape, np.nan, np.float16)
    ndvi = np.full((n,) + shape, np.nan, np.float16)
    swir = np.full((n,) + shape, np.nan, np.float16)
    years = np.array([int(s["stamp"][:4]) for s in scenes])
    for i, s in enumerate(scenes):
        scene = common.load_scene(args.s2, args.area, s["stamp"])
        refl = common.reflectance(scene)
        dry = (common.ndwi(refl) <= 0) & ~common.bad_mask(scene)
        vis[i] = np.where(dry, (refl["B02"] + refl["B03"] + refl["B04"]) / 3, np.nan)
        ndvi[i] = np.where(dry, common.ndvi(refl), np.nan)
        swir[i] = np.where(dry, refl["B11"], np.nan)
    with np.errstate(all="ignore"):
        looks = np.isfinite(vis).sum(0)
        med_vis = np.nanmedian(vis.astype(np.float32), 0)
        med_ndvi = np.nanmedian(ndvi.astype(np.float32), 0)
        med_swir = np.nanmedian(swir.astype(np.float32), 0)
        veg = np.where(np.isfinite(ndvi), ndvi.astype(np.float32) > 0.25, np.nan)
        veg_share = np.nanmean(veg, 0)
        q1, q3 = np.nanpercentile(vis.astype(np.float32), [25, 75], axis=0)
        vis_cv = (q3 - q1) / np.maximum(med_vis, 1e-3)
        year_hits, year_count = np.zeros(shape, np.float32), np.zeros(shape, np.float32)
        for y in np.unique(years):
            sel = years == y
            m = np.nanmedian(ndvi[sel].astype(np.float32), 0)
            ok = np.isfinite(m)
            year_hits += ok & (m > 0.25)
            year_count += ok
        veg_years = np.where(year_count > 0, year_hits / np.maximum(year_count, 1), np.nan)
        filled = np.where(np.isfinite(med_vis), med_vis, np.nanmedian(med_vis))
        mean = ndimage.uniform_filter(filled, 3)
        texture = np.sqrt(np.maximum(ndimage.uniform_filter(filled ** 2, 3) - mean ** 2, 0)) / np.maximum(mean, 1e-3)
        texture[~np.isfinite(med_vis)] = np.nan
    # Season: over every kept scene where the pixel is dry (any tide). Saltmarsh browns off
    # in winter; wrack on rock stays green-brown all year.
    seasonal = {}
    for season, months in (("summer", (5, 6, 7, 8)), ("winter", (11, 12, 1, 2))):
        picks = [s for s in summary["kept_scenes"] if int(s["stamp"][4:6]) in months]
        stack = np.full((len(picks),) + shape, np.nan, np.float16)
        for i, s in enumerate(picks):
            scene = common.load_scene(args.s2, args.area, s["stamp"])
            refl = common.reflectance(scene)
            dry = (common.ndwi(refl) <= 0) & ~common.bad_mask(scene)
            stack[i] = np.where(dry, common.ndvi(refl), np.nan)
        with np.errstate(all="ignore"):
            seasonal[season] = np.nanmedian(stack.astype(np.float32), 0)
    names = ["vis", "ndvi", "swir", "veg_share", "veg_years", "vis_cv", "texture", "n_looks", "ndvi_summer", "ndvi_winter"]
    common.write_tif(args.out / f"{args.area}-rock-features.tif",
                     [med_vis, med_ndvi, med_swir, veg_share, veg_years, vis_cv, texture, looks.astype(np.float32),
                      seasonal["summer"], seasonal["winter"]],
                     meta, names)
    (args.out / f"{args.area}-rock-features.json").write_text(json.dumps(
        {"max_tide": args.max_tide, "scenes": [s["stamp"] for s in scenes], "bands": names,
         "months": np.bincount([int(s["stamp"][4:6]) for s in scenes], minlength=13)[1:].tolist()}, indent=1))
    print("  done; months", np.bincount([int(s["stamp"][4:6]) for s in scenes], minlength=13)[1:].tolist())


if __name__ == "__main__":
    main()
