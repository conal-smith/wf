"""Each scene's waterline against the tide it was given.

For every kept scene, the "implied tide" is the level t that best splits the intertidal
pixels' flip heights into wet (z < t) and dry (z >= t) as the scene shows them. The spread of
implied minus assigned tide is the scene-to-scene noise of the whole chain: the tide (a gauge
for Dublin, the calibrated EOT20 model for Co. Down), surge and waves, and the water masks.
If Co. Down's spread is close to Dublin's, the model tide is as good as a gauge for this.

    python -I tide_consistency.py --s2 .. --out <out> --areas dublin down portmarnock
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
import rasterio  # noqa: E402

import common  # noqa: E402


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--s2", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--areas", nargs="+", default=["dublin", "down"])
    args = p.parse_args()
    result = {}
    for area in args.areas:
        d = args.out / area
        with rasterio.open(d / f"{area}-heights.tif") as src:
            z = src.read(1)
        inter = np.load(d / f"{area}-intertidal.npy") & np.isfinite(z)
        summary = json.loads((d / f"{area}-heights.json").read_text())
        zs = z[inter]
        cand = np.arange(0.6, 5.6, 0.02)
        rows = []
        for s in summary["kept_scenes"]:
            scene = common.load_scene(args.s2, area, s["stamp"])
            refl = common.reflectance(scene)
            ok = ~common.bad_mask(scene)[inter]
            if ok.mean() < 0.5:
                continue
            wet = (common.ndwi(refl) > 0)[inter][ok]
            zz = zs[ok]
            order = np.argsort(zz)
            zz, wet = zz[order], wet[order]
            # errors(t) = dry pixels below t + wet pixels at or above t
            idx = np.searchsorted(zz, cand)
            dry_below = np.concatenate([[0], np.cumsum(~wet)])[idx]
            wet_above = wet.sum() - np.concatenate([[0], np.cumsum(wet)])[idx]
            t = float(cand[np.argmin(dry_below + wet_above)])
            rows.append((s["tide"], t, s["source"]))
        a = np.array([(r[0], r[1]) for r in rows])
        inside = (a[:, 0] > a[:, 0].min() + 0.3) & (a[:, 0] < a[:, 0].max() - 0.3)  # away from the ends, where it saturates
        diff = a[inside, 1] - a[inside, 0]
        result[area] = {"scenes": len(rows), "median_implied_minus_assigned": round(float(np.median(diff)), 3),
                        "rmse": round(float(np.sqrt(np.mean(diff ** 2))), 3),
                        "robust_sd": round(float(1.4826 * np.median(np.abs(diff - np.median(diff)))), 3),
                        "p90_abs": round(float(np.percentile(np.abs(diff), 90)), 3),
                        "correlation": round(float(np.corrcoef(a[:, 0], a[:, 1])[0, 1]), 3)}
        print(area, result[area])
    (args.out / "tide-consistency.json").write_text(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
