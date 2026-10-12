"""Sensitivity of the flip heights to the water rule and to the tide's direction.

Re-fits heights over the satellite intertidal with: NDWI > 0 (the default),
NDWI > -0.1, NDWI > 0.1, MNDWI > 0 (green/SWIR, 20 m), and with only rising
or only falling tides; reports each against a reference raster band (the foil
layer, or LiDAR) as the median and IQR of the difference.

    python -I experiments.py --area dublin --s2 .. --tide .. --model-tide .. --heights <out>/dublin \
        --reference <out>/dublin/dublin-foildepth-on-grid.tif --band 1 [--band-min 1.7]
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
import rasterio  # noqa: E402

import build_heights  # noqa: E402
import common  # noqa: E402


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--area", required=True)
    p.add_argument("--s2", required=True, type=Path)
    p.add_argument("--tide", required=True, type=Path)
    p.add_argument("--model-tide", required=True, type=Path)
    p.add_argument("--heights", required=True, type=Path)
    p.add_argument("--reference", required=True, type=Path)
    p.add_argument("--band", type=int, default=1)
    p.add_argument("--band-min", type=float, default=-99)
    p.add_argument("--out", type=Path)
    args = p.parse_args()
    summary = json.loads((args.heights / f"{args.area}-heights.json").read_text())
    stamps = [s["stamp"] for s in summary["kept_scenes"]]
    tides = np.array([s["tide"] for s in summary["kept_scenes"]], np.float32)
    gauge = {}
    if args.area != "down":
        gauge = json.loads((args.tide / "dublin-howth.json").read_text())["levels"]
    change = np.array([gauge.get(s, {}).get("change1h") or 0.0 for s in stamps])
    intertidal = np.load(args.heights / f"{args.area}-intertidal.npy")
    with rasterio.open(args.reference) as src:
        ref = src.read(args.band)
    ref = np.where(ref >= args.band_min, ref, np.nan)
    sel = intertidal & np.isfinite(ref)
    print(f"{sel.sum()} pixels with a reference height")

    indices = {}
    for i, stamp in enumerate(stamps):
        scene = common.load_scene(args.s2, args.area, stamp)
        refl = common.reflectance(scene)
        bad = common.bad_mask(scene)
        for name, index in (("ndwi", common.ndwi(refl)), ("mndwi", common.mndwi(refl))):
            if name not in indices:
                indices[name] = np.empty((len(stamps),) + index.shape, np.float16)
            indices[name][i] = np.where(bad, np.nan, index)

    def run(label, index, threshold, which):
        stack = np.where(np.isnan(index[which]), -1, index[which] > threshold).astype(np.int8)
        z, misfit, *_ = build_heights.flip_heights(stack, tides[which])
        d = (z - ref)[sel]
        d = d[np.isfinite(d)]
        q1, med, q3 = np.percentile(d, [25, 50, 75])
        row = {"variant": label, "n": int(len(d)), "median": round(float(med), 3), "iqr": [round(float(q1), 3), round(float(q3), 3)],
               "within_0.5m": round(float((np.abs(d) <= 0.5).mean()), 3),
               "misfit_median": round(float(np.nanmedian(misfit[sel])), 3)}
        print(row, flush=True)
        return row

    every = np.ones(len(stamps), bool)
    rows = [
        run("NDWI > 0, all scenes", indices["ndwi"], 0.0, every),
        run("NDWI > -0.1", indices["ndwi"], -0.1, every),
        run("NDWI > 0.1", indices["ndwi"], 0.1, every),
        run("MNDWI > 0 (SWIR, 20 m)", indices["mndwi"], 0.0, every),
    ]
    if gauge:
        rows += [run("NDWI > 0, rising tide only", indices["ndwi"], 0.0, change > 0.05),
                 run("NDWI > 0, falling tide only", indices["ndwi"], 0.0, change < -0.05)]
    if args.out:
        args.out.write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
