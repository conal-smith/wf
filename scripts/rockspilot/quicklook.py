"""Quick-look PNG of a raster band (development aid)."""
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import rasterio  # noqa: E402

path, band, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
vmin, vmax = (float(sys.argv[4]), float(sys.argv[5])) if len(sys.argv) > 5 else (None, None)
with rasterio.open(path) as src:
    a = src.read(band)
fig, ax = plt.subplots(figsize=(9, 9), dpi=100)
im = ax.imshow(np.ma.masked_invalid(a), cmap="viridis", vmin=vmin, vmax=vmax, interpolation="nearest")
fig.colorbar(im, ax=ax, shrink=0.6)
ax.set_axis_off()
fig.savefig(out, bbox_inches="tight")
