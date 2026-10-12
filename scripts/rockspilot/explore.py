"""A first look: scene tides by month and hour, and the lowest and highest scenes' RGB and NDWI."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import common  # noqa: E402


def rgb(scene, gain=3.5):
    r = common.reflectance(scene)
    img = np.dstack([r["B04"], r["B03"], r["B02"]]) * gain
    return (np.clip(img, 0, 1) ** (1 / 1.6) * 255).astype(np.uint8)


def main(s2, tide, out_tide, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    for area in ("down", "dublin"):
        levels = common.tide_levels(area, tide, out_tide)
        items = sorted((v[0], k) for k, v in levels.items() if v[0] is not None)
        z = np.array([i[0] for i in items])
        print(area, len(z), "scenes; tide min %.2f p10 %.2f median %.2f p90 %.2f max %.2f" %
              (z.min(), *np.percentile(z, [10, 50, 90]), z.max()))
        print("   below 1.2: %d, 1.2-1.8: %d, 1.8-2.5: %d, 2.5-3.5: %d, above 3.5: %d" % (
            (z < 1.2).sum(), ((z >= 1.2) & (z < 1.8)).sum(), ((z >= 1.8) & (z < 2.5)).sum(),
            ((z >= 2.5) & (z < 3.5)).sum(), (z >= 3.5).sum()))
        for tag, (level, stamp) in [("low", items[0]), ("low2", items[1]), ("high", items[-1])]:
            scene = common.load_scene(s2, area, stamp)
            Image.fromarray(rgb(scene)).save(out / f"{area}-{tag}-{stamp}-{level:.2f}m.png")
            w = common.ndwi(common.reflectance(scene))
            bad = common.bad_mask(scene)
            hist, edges = np.histogram(w[~bad], bins=24, range=(-0.6, 0.6))
            print(f"   {tag} {stamp} {level:.2f} m, bad {bad.mean():.2f}; NDWI hist:",
                  " ".join(f"{e:+.2f}:{h}" for e, h in zip(edges[:-1], hist) if h > 500))


if __name__ == "__main__":
    main(*sys.argv[1:5])
