"""Small pictures of one place in one acquisition: natural colour, and the foam
the detector sees, for eyeballing the detector and for the report.

Reads a box round a point from the acquisition's COGs (Planetary Computer,
signed per read, no account): B02, B03, B04, B08 at 10 m, B11 and SCL at
20 m. Writes a PNG of the colour (the satellite imagery's stretch: over a
white point, gamma 2) and, with --foam, a second with the foam in red.

    python -I chips.py --region ireland --tile 29UNA --stamp 20220301T114349 \\
        --lon -8.30 --lat 54.47 --km 4 --out chip.png [--foam]
"""
import argparse
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import wf  # noqa: E402

BANDS10 = ("B02", "B03", "B04", "B08")


def read_box(item, epsg, lon, lat, km):
    """{band: reflectance (h, w) at 10 m}, 'SCL' as classes; the box km across round the point."""
    from pyproj import Transformer
    wf.satellite()
    from fetch import Scene
    x, y = Transformer.from_crs(4326, f"EPSG:{epsg}", always_xy=True).transform(lon, lat)
    l, b, r, t = item["bbox10"]
    half = int(km * 1000 / 2 / 10)
    col, row = int((x - l) / 10), int((t - y) / 10)
    r0, c0 = row - half, col - half
    n = 2 * half
    sc = Scene(item)
    try:
        out = {bd: sc.read(bd, (r0, c0, n, n), n) for bd in BANDS10}
        win20 = (r0 // 2, c0 // 2, n // 2, n // 2)
        for bd in ("B11", "SCL"):
            a = sc.read(bd, win20, n // 2)
            out[bd] = np.repeat(np.repeat(a, 2, 0), 2, 1)[:n, :n]
    finally:
        sc.close()
    return out


def rgb(bands, white=0.26, gamma=2.0):
    a = np.stack([bands["B04"], bands["B03"], bands["B02"]], -1)
    return (np.clip(a / white, 0, 1) ** (1 / gamma) * 255).astype(np.uint8)


def foam_overlay(bands, cfg):
    img = rgb(bands)
    f = wf.foam(bands["B02"], bands["B03"], bands["B04"], bands["B08"], bands["B11"], cfg["foam"])
    img[f] = (255, 40, 40)
    return img, f


def freq_box(tif, lon, lat, km):
    """(P big, P calm) round a point from score.py's tile raster (10 m), km across."""
    import rasterio
    from pyproj import Transformer
    with rasterio.open(tif) as src:
        x, y = Transformer.from_crs(4326, src.crs, always_xy=True).transform(lon, lat)
        c, r = ~src.transform * (x, y)
        half = int(km * 1000 / 2 / 10)
        from rasterio.windows import Window
        win = Window(int(c) - half, int(r) - half, 2 * half, 2 * half)
        pb = src.read(1, window=win, boundless=True, fill_value=0)
        pc = src.read(2, window=win, boundless=True, fill_value=0)
    return pb, pc


RAMP = np.array([[255, 255, 204], [161, 218, 180], [65, 182, 196], [44, 127, 184], [37, 52, 148], [8, 29, 88]],
                np.float32)


def freq_image(pb, base=None, vmax=0.8):
    """P(foam | big) on a ramp from pale yellow to deep blue, over a faded picture (or white)."""
    img = (np.full(pb.shape + (3,), 255, np.float32) if base is None
           else 255 - (255 - base.astype(np.float32)) * 0.35)
    v = np.clip(pb / vmax, 0, 1) * (len(RAMP) - 1)
    k = np.minimum(v.astype(int), len(RAMP) - 2)
    col = RAMP[k] + (RAMP[k + 1] - RAMP[k]) * (v - k)[..., None]
    on = pb >= 0.05
    img[on] = col[on]
    return img.astype(np.uint8)


def save(img, p, scale=1):
    from PIL import Image
    im = Image.fromarray(img)
    if scale != 1:
        im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True)
    im.save(p, optimize=True) if p.endswith(".png") else im.save(p, quality=82)


def item_of(tile, stamp):
    common = wf.satellite()
    cat = common.read_json(common.path("downloads", "catalog", f"{tile}.json"))
    it = next(i for i in cat["items"] if i["stamp"] == stamp)
    return dict(it, bbox10=it.get("bbox10") or cat["bbox10"]), cat["epsg"]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", default="ireland")
    p.add_argument("--tile", required=True)
    p.add_argument("--stamp", required=True)
    p.add_argument("--lon", type=float, required=True)
    p.add_argument("--lat", type=float, required=True)
    p.add_argument("--km", type=float, default=4)
    p.add_argument("--out", required=True)
    p.add_argument("--foam", action="store_true")
    a = p.parse_args()
    wf.set_region(a.region)
    item, epsg = item_of(a.tile, a.stamp)
    bands = read_box(item, epsg, a.lon, a.lat, a.km)
    save(rgb(bands), a.out)
    if a.foam:
        img, f = foam_overlay(bands, wf.config())
        save(img, a.out.replace(".png", "-foam.png"))
        print(f"foam pixels {int(f.sum())}")


if __name__ == "__main__":
    sys.exit(main())
