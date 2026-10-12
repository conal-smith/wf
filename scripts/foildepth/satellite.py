"""Satellite intertidal heights, in the one form the builds read.

Sentinel-2 sees each foreshore pixel wet or dry at hundreds of known tides;
the tide at which it flips is its height. Because they come from the
imagery, they line up with it; they read about 0.25 m over the OPW LiDAR,
which is taken off. The builds read them as a source of `kind: "satellite"`
(build.read_satellite), ahead of the waterline interpolation and the older
surveys in the band the tides seen cover.

Two producers:

- the national run (`scripts/satellite` on the `satellite-layer` branch):
  one PMTiles archive per tide station's region, as the foil regions are cut,
  Terrarium at z13, with reserved values for "below the lowest tide seen"
  (30), "no fit" (40) and "dry in every look" (50), its bias already off
  (`biasRemovedMetres`): `from-archives`;
- the rocks pilot (`scripts/rockspilot` on `rocks-pilot`: Donabate to
  Portmarnock), whose heights are as observed: `from-rockspilot`, which takes
  the bias off (`--bias`, −0.25).

The form: a GeoTIFF in any CRS, two bands,

1. the height, metres above LAT in its tide station's terms (the station's
   level when the pixel floods), the bias off, NaN where none;
2. a flag: 0 nothing known, 1 seen wet and dry (a height), 2 never seen dry
   (under the lowest tide seen), 3 never seen wet (over the highest);

and tags `STATION`, `LOWEST_TIDE_SEEN` and `HIGHEST_TIDE_SEEN` (the tides
as they were, metres above LAT) and `BIAS_APPLIED` (what was added to the
heights, which the build adds to the tides seen as well).

    python -I satellite.py from-archives --set <intertidal set> --out <data>/satellite
    python -I satellite.py from-rockspilot --heights <out>/dublin/dublin-heights.tif \\
        --state <out>/dublin/dublin-state.npy --summary <out>/dublin/dublin-heights.json \\
        --station Howth --out <data>/satellite/dublin.tif
"""
import argparse
import json
import os
import sys

import numpy as np
import rasterio

NONE, HEIGHT, NEVER_DRY, NEVER_WET = 0, 1, 2, 3


def flags_from_rockspilot(intertidal, state, wet_frequency, n_valid, min_valid=30):
    """The pilot's per-pixel results as flags.

    `intertidal` is its accepted height (NaN unless the pixel passed every
    test: seen dry below and wet above at least 3 times each, misfit under
    0.2, joined to the sea, not lush land); `state` 1 flips, 2 always wet,
    3 always dry (build_heights.flip_heights). A pixel that flips but failed
    a test is not known; always wet or dry counts only with enough looks."""
    flag = np.zeros(state.shape, dtype=np.uint8)
    enough = n_valid >= min_valid
    flag[np.isfinite(intertidal)] = HEIGHT
    with np.errstate(invalid="ignore"):
        flag[(flag == NONE) & enough & (state == 2) & (wet_frequency > 0.9)] = NEVER_DRY
        flag[(flag == NONE) & enough & (state == 3) & (wet_frequency < 0.1)] = NEVER_WET
    return flag


def write(path, height, flag, profile, station, low, high, source, bias=0.0):
    """One file in the form the builds read: the heights with `bias` already
    added (the method's offset against LiDAR, negative), the flags, and the
    tides seen as they were (the build adds BIAS_APPLIED to them too)."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    prof = dict(profile)
    prof.update(driver="GTiff", count=2, dtype="float32", nodata=None, compress="deflate",
                tiled=True, blockxsize=512, blockysize=512)
    with rasterio.open(path, "w", **prof) as dst:
        dst.write(np.where(flag == HEIGHT, height, np.nan).astype(np.float32), 1)
        dst.write(flag.astype(np.float32), 2)
        dst.update_tags(STATION=station, LOWEST_TIDE_SEEN=f"{low:.3f}", HIGHEST_TIDE_SEEN=f"{high:.3f}",
                        BIAS_APPLIED=f"{bias:.3f}", SOURCE=source)
        dst.set_band_description(1, "height_m_LAT")
        dst.set_band_description(2, "flag_0none_1height_2neverdry_3neverwet")
    counts = {k: int((flag == v).sum()) for k, v in (("height", HEIGHT), ("neverDry", NEVER_DRY), ("neverWet", NEVER_WET))}
    print(f"{path}: {counts}, tides seen {low:.2f}..{high:.2f} m, bias {bias:+.2f} m")


def from_rockspilot(a):
    with rasterio.open(a.heights) as ds:
        intertidal = ds.read(1)
        wet_frequency = ds.read(6)
        n_valid = ds.read(4)
        profile = ds.profile
    state = np.load(a.state, allow_pickle=False)
    with open(a.summary) as fh:
        summary = json.load(fh)
    low, high = summary["tide_range_kept"]
    flag = flags_from_rockspilot(intertidal, state, wet_frequency, n_valid)
    write(a.out, intertidal + a.bias, flag, profile, a.station, low, high,
          "Sentinel-2 L2A 2017-2026, rocks pilot (contains modified Copernicus Sentinel data)", a.bias)


def flags_from_archive(v, index):
    """An intertidal archive's values (scripts/satellite on `satellite-layer`)
    as flags: a height; `belowSeenMetres` never seen dry; `landMetres` dry in
    every look (or lush, or not joined to the sea: never wet, where OSM says
    it is sea); the no-fit value, another region's water and no tile, nothing."""
    flag = np.zeros(v.shape, dtype=np.uint8)
    heights = (v > index["deepMetres"] + 1) & (v < 20)
    flag[heights] = HEIGHT
    flag[np.abs(v - index["belowSeenMetres"]) < 0.5] = NEVER_DRY
    flag[np.abs(v - index["landMetres"]) < 0.5] = NEVER_WET
    return flag


def from_archives(a):
    """Each region of an intertidal set (index.json and one PMTiles archive
    per tide station's region, Terrarium, z13) as one file on the archive's
    own Web Mercator grid at its max zoom. Its heights already have the
    method's bias taken off (`biasRemovedMetres`)."""
    import io
    import math

    from PIL import Image
    from pmtiles.reader import MmapSource, Reader, all_tiles
    from rasterio.transform import from_origin

    with open(os.path.join(a.set, "index.json")) as fh:
        index = json.load(fh)
    bias = -float(index.get("biasRemovedMetres", 0.0))
    earth = 2 * math.pi * 6378137.0
    for area in index["areas"]:
        if a.only and area["id"] not in a.only:
            continue
        z, size = area["maxzoom"], area["tileSize"]
        tiles = {}
        with open(os.path.join(a.set, area["url"]), "rb") as fh:
            reader = Reader(MmapSource(fh))
            for (zz, x, y), data in all_tiles(reader.get_bytes):
                if zz == z:
                    tiles[(x, y)] = data
        if not tiles:
            continue
        xs = [k[0] for k in tiles]
        ys = [k[1] for k in tiles]
        x0, y0 = min(xs), min(ys)
        w, h = (max(xs) - x0 + 1) * size, (max(ys) - y0 + 1) * size
        v = np.full((h, w), np.nan, dtype=np.float32)
        for (x, y), data in tiles.items():
            rgb = np.asarray(Image.open(io.BytesIO(data)).convert("RGB")).astype(np.float64)
            v[(y - y0) * size:(y - y0 + 1) * size, (x - x0) * size:(x - x0 + 1) * size] = \
                rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768
        span = earth / 2 ** z
        profile = {"width": w, "height": h, "crs": "EPSG:3857",
                   "transform": from_origin(-earth / 2 + x0 * span, earth / 2 - y0 * span, span / size, span / size)}
        flag = flags_from_archive(v, index)
        write(os.path.join(a.out, area["id"] + ".tif"), v, flag, profile, area["station"],
              area["lowestSeenMetres"], area["highestSeenMetres"], index.get("attribution", ""), bias)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="step", required=True)
    r = sub.add_parser("from-rockspilot")
    r.add_argument("--heights", required=True)
    r.add_argument("--state", required=True)
    r.add_argument("--summary", required=True)
    r.add_argument("--station", required=True)
    r.add_argument("--bias", type=float, default=-0.25, help="added to the heights (the pilot read 0.26 m over LiDAR)")
    r.add_argument("--out", required=True)
    x = sub.add_parser("from-archives")
    x.add_argument("--set", required=True, help="an intertidal set: index.json and its archives")
    x.add_argument("--out", required=True)
    x.add_argument("--only", action="append", help="only these region ids")
    a = p.parse_args()
    if a.step == "from-rockspilot":
        from_rockspilot(a)
    elif a.step == "from-archives":
        from_archives(a)


if __name__ == "__main__":
    sys.exit(main())
