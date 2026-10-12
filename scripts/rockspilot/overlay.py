"""Development aid: a scene's RGB with a boolean mask (.npy) tinted over it.

    python -I overlay.py <s2-dir> <area> <stamp> <mask.npy> <out.png> [crop r0 r1 c0 c1]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import common  # noqa: E402

s2, area, stamp, mask_path, out = sys.argv[1:6]
scene = common.load_scene(s2, area, stamp)
r = common.reflectance(scene)
img = np.clip(np.dstack([r["B04"], r["B03"], r["B02"]]) * 3.5, 0, 1) ** (1 / 1.6)
mask = np.load(mask_path)
img[mask] = img[mask] * 0.5 + np.array([1.0, 0.1, 0.6]) * 0.5
img = (img * 255).astype(np.uint8)
if len(sys.argv) > 9:
    r0, r1, c0, c1 = map(int, sys.argv[6:10])
    img = img[r0:r1, c0:c1]
im = Image.fromarray(img)
if im.width < 600:
    im = im.resize((im.width * 2, im.height * 2), Image.NEAREST)
im.save(out)
