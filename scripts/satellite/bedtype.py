"""How likely the observed foreshore is rock or weed rather than sand or mud.

The low tide's bed (compose.py's lowir.tif and the tide zone's colour,
lowrgb.tif) and the heights' own texture, against the roughness of the
OPW/TII LiDAR where it reaches: the 2 m DTM's RMS about its own 10 m
smoothing, on the tile's grid. Rock and weed are rough (over 0.10 m), sand and
mud smooth (under 0.04 m); only ground above 1.7 m LAT, which the flights saw
dry. A logistic model of the features (standardised):

- log(B11 / red), NDVI, NDWI (green against B08), log B08, log red: weed
  and rock read bright in the infrared against their colour;
- the flip heights' spread over 3×3 and 5×5 pixels: a rocky shore's heights
  jump from pixel to pixel, a flat's change smoothly.

`fit` trains on every region given and tests each region on a model from the
others (work/bed_model.json); `apply` writes each tile's rocky.tif: percent
likelihood over the observed foreshore, 255 elsewhere. A likelihood, not a
map of rocks: at 10 m a boulder or a narrow reef is lost in its pixel.

    python -I bedtype.py fit --region dub:29UPV:2.561:<mosaic> --region bran:29UMT:2.677:<mosaic> ...
    python -I bedtype.py apply [--tile 29UPV ...]
"""
import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

ROUGH, SMOOTH, LIDAR_ABOVE = 0.10, 0.04, 1.7
NAMES = ["log(B11/red)", "NDVI", "NDWI", "log B08", "log red", "height spread 3x3", "height spread 5x5"]


def decode(code):
    return np.where(code > 0, (code.astype(np.float32) / 255) ** 2 * common.REFL_MAX, np.nan)


def tile_features(tile):
    """(features (h, w, n), observed foreshore mask, raster profile) for a composed tile."""
    import rasterio
    from scipy import ndimage
    d = common.path("work", "tiles", tile)
    with rasterio.open(os.path.join(d, "lowir.tif")) as s:
        b08, b11 = decode(s.read(1)), decode(s.read(2))
    with rasterio.open(os.path.join(d, "lowrgb.tif")) as s:
        red, grn = decode(s.read(1)), decode(s.read(2))
    with rasterio.open(os.path.join(d, "heights.tif")) as s:
        cls, z, prof = s.read(5), s.read(2), s.profile
    obs = (cls == 1) & np.isfinite(z)

    def nmean(a, k):
        ok = np.isfinite(a) & obs
        tot = ndimage.uniform_filter(np.where(ok, a, 0).astype(np.float32), k)
        n = ndimage.uniform_filter(ok.astype(np.float32), k)
        return np.where(n > 0, tot / np.maximum(n, 1e-6), np.nan)

    spread = [np.sqrt(np.maximum(nmean(z ** 2, k) - nmean(z, k) ** 2, 0)) for k in (3, 5)]
    with np.errstate(divide="ignore", invalid="ignore"):
        f = np.stack([np.log(b11 / red), (b08 - red) / (b08 + red), (grn - b08) / (grn + b08),
                      np.log(b08), np.log(red)] + spread, -1).astype(np.float32)
    return f, obs & np.isfinite(f).all(-1), prof


def lidar_roughness(path, offset, prof):
    """The DTM's RMS about its 10 m smoothing, and its height in LAT, averaged onto the tile's grid."""
    import rasterio
    from rasterio.warp import reproject, Resampling
    from scipy import ndimage
    with rasterio.open(path) as s:
        z = s.read(1).astype(np.float32)
        ok = z != s.nodata
        tr, crs = s.transform, s.crs
    w = ndimage.gaussian_filter(ok.astype(np.float32), 2.5)
    smooth = ndimage.gaussian_filter(np.where(ok, z, 0), 2.5) / np.maximum(w, 1e-6)
    out = []
    for a in (np.where(ok & (w > 0.9), (z - smooth) ** 2, np.nan), np.where(ok, z + offset, np.nan)):
        dst = np.full((prof["height"], prof["width"]), np.nan, np.float32)
        reproject(a.astype(np.float32), dst, src_transform=tr, src_crs=crs, src_nodata=np.nan,
                  dst_transform=prof["transform"], dst_crs=prof["crs"], dst_nodata=np.nan,
                  resampling=Resampling.average)
        out.append(dst)
    return np.sqrt(out[0]), out[1]


def logistic(x, t, steps=3000):
    """Class-balanced logistic regression on standardised features: (mean, sd, weights with the bias last)."""
    w = np.where(t == 1, (t == 0).sum() / max((t == 1).sum(), 1), 1.0)
    mu, sd = x.mean(0), x.std(0)
    z1 = np.c_[(x - mu) / sd, np.ones(len(x))]
    b = np.zeros(z1.shape[1])
    for _ in range(steps):
        p = 1 / (1 + np.exp(-z1 @ b))
        b -= 0.5 * (z1.T @ ((p - t) * w)) / w.sum()
    return mu, sd, b


def likelihood(x, model):
    mu, sd, b = (np.asarray(model[k]) for k in ("mean", "sd", "weights"))
    return 1 / (1 + np.exp(-(np.c_[(x - mu) / sd, np.ones(len(x))] @ b)))


def auc(p, t):
    order = np.argsort(p)
    r = np.empty(len(p))
    r[order] = np.arange(len(p))
    n1 = t.sum()
    return float((r[t == 1].sum() - n1 * (n1 - 1) / 2) / (n1 * (len(t) - n1)))


def fit(regions):
    # A region's mosaics on one tile overlap: merged first (the first given wins), so a pixel counts once.
    groups = {}
    for spec in regions:
        name, tile, offset, path = spec.split(":", 3)
        groups.setdefault((name, tile), []).append((float(offset), path))
    data = {}
    for (name, tile), mosaics in groups.items():
        f, ok, prof = tile_features(tile)
        rough = np.full(ok.shape, np.nan, np.float32)
        lat = rough.copy()
        for offset, path in mosaics:
            r, la = lidar_roughness(path, offset, prof)
            new = np.isfinite(r) & np.isnan(rough)
            rough[new], lat[new] = r[new], la[new]
        sel = ok & np.isfinite(rough) & (lat > LIDAR_ABOVE) & ((rough > ROUGH) | (rough < SMOOTH))
        x, t = f[sel], (rough[sel] > ROUGH).astype(float)
        if name in data:
            x, t = np.r_[data[name][0], x], np.r_[data[name][1], t]
        data[name] = (x, t)
        print(f"{name} ({tile}): {len(t)} labelled pixels, {t.mean():.0%} rough", flush=True)
    tests = {}
    for name, (x, t) in data.items():
        others = [v for k, v in data.items() if k != name]
        if not others:
            continue
        mu, sd, b = logistic(np.concatenate([o[0] for o in others]), np.concatenate([o[1] for o in others]))
        p = likelihood(x, {"mean": mu, "sd": sd, "weights": b})
        # The precision where the flag finds 60% of the rough ground.
        flag = p > np.quantile(p[t == 1], 0.4)
        tests[name] = {"auc": round(auc(p, t), 3), "precisionAt60Recall": round(float((flag & (t == 1)).sum() / flag.sum()), 3),
                       "roughShare": round(float(t.mean()), 3), "pixels": int(len(t))}
        print(f"  {name} from the others: {tests[name]}", flush=True)
    mu, sd, b = logistic(np.concatenate([v[0] for v in data.values()]), np.concatenate([v[1] for v in data.values()]))
    model = {"features": NAMES, "mean": mu.tolist(), "sd": sd.tolist(), "weights": b.tolist(),
             "roughMetres": ROUGH, "smoothMetres": SMOOTH, "lidarAboveMetres": LIDAR_ABOVE,
             "regions": regions, "heldOut": tests}
    common.write_json(common.path("work", "bed_model.json"), model)


def apply(tiles):
    import rasterio
    model = common.read_json(common.path("work", "bed_model.json"))
    for tile in tiles:
        d = common.path("work", "tiles", tile)
        if not all(os.path.exists(os.path.join(d, f)) for f in ("lowir.tif", "lowrgb.tif", "heights.tif")):
            print(f"{tile}: no lowir.tif or lowrgb.tif, skipped", flush=True)
            continue
        f, ok, prof = tile_features(tile)
        out = np.full(ok.shape, 255, np.uint8)
        out[ok] = np.round(likelihood(f[ok], model) * 100).astype(np.uint8)
        p = dict(prof, count=1, dtype="uint8", nodata=255, compress="deflate", tiled=True, blockxsize=512, blockysize=512)
        with rasterio.open(os.path.join(d, "rocky.tif"), "w", **p) as dst:
            dst.write(out, 1)
            dst.set_band_description(1, "rock_or_weed_percent")
        print(f"{tile}: {ok.sum() * 1e-4:.1f} km² rated, {(out[ok] >= 50).sum() * 1e-4:.1f} km² likelier rock or weed", flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fit")
    f.add_argument("--region", action="append", required=True, help="name:tile:odMalinOffset:lidar mosaic")
    a_ = sub.add_parser("apply")
    a_.add_argument("--tile", action="append")
    a = p.parse_args()
    if a.cmd == "fit":
        fit(a.region)
    else:
        tiles = a.tile or sorted(t for t in os.listdir(common.path("work", "tiles"))
                                 if os.path.exists(common.path("work", "tiles", t, "stats.json")))
        apply(tiles)


if __name__ == "__main__":
    sys.exit(main())
