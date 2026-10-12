"""The foil-depth layer against single scenes: where the layer says water at least 0.3 m deep at
the scene's tide, how much is clearly dry ground in the image (NDWI < -0.1)? And where it says
ground at least 0.3 m above the water, how much is clearly water (NDWI > 0.1)?

Uses the layer on the satellite grid from compare_foildepth.py; the Malahide lagoon is left out.

    python -I check_layer_scenes.py --area dublin --s2 .. --heights <out>/dublin
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from rasterio.features import rasterize  # noqa: E402
from rasterio.warp import transform_geom  # noqa: E402
from scipy import ndimage  # noqa: E402

import common  # noqa: E402
from compare_foildepth import LAGOON  # noqa: E402


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--area", required=True)
    p.add_argument("--s2", required=True, type=Path)
    p.add_argument("--heights", required=True, type=Path)
    args = p.parse_args()
    meta = common.grid(args.s2, args.area)
    with rasterio.open(args.heights / f"{args.area}-foildepth-on-grid.tif") as src:
        lay = src.read(1)
        code = src.read(2)
    lay = np.where(code == 40, -10.0, lay)  # unsurveyed water: always wet
    intertidal = np.load(args.heights / f"{args.area}-intertidal.npy")
    lagoon = rasterize([transform_geom("EPSG:4326", f"EPSG:{meta['epsg']}", {"type": "Polygon", "coordinates": [LAGOON + [LAGOON[0]]]})],
                       out_shape=tuple(meta["shape"]), transform=common.transform(meta)).astype(bool)
    coast = ndimage.binary_dilation(intertidal, iterations=30) & ~lagoon & np.isfinite(lay)
    summary = json.loads((args.heights / f"{args.area}-heights.json").read_text())
    rows = []
    scenes = sorted(summary["kept_scenes"], key=lambda s: s["tide"])
    for s in scenes[:8] + scenes[-8:]:
        scene = common.load_scene(args.s2, args.area, s["stamp"])
        refl = common.reflectance(scene)
        w = common.ndwi(refl)
        ok = coast & ~common.bad_mask(scene)
        says_wet = ok & (lay < s["tide"] - 0.3)
        says_dry = ok & (lay > s["tide"] + 0.3) & (lay < 40)
        row = {"stamp": s["stamp"], "tide": s["tide"],
               "layer_wet_px": int(says_wet.sum()),
               "layer_wet_but_clearly_dry": round(float((says_wet & (w < -0.1)).sum() / max(says_wet.sum(), 1)), 3),
               "layer_dry_px": int(says_dry.sum()),
               "layer_dry_but_clearly_wet": round(float((says_dry & (w > 0.1)).sum() / max(says_dry.sum(), 1)), 3)}
        rows.append(row)
        print(row)
    (args.heights / f"{args.area}-layer-vs-scenes.json").write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
