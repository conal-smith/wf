"""The satellite's intertidal heights against surveyed ground, per region.

Where a composed tile's observed heights (compose.py's heights.tif, class 1,
the raw flip level before the bias is taken off) overlap a survey:

- INFOMAR's merged 10 m inshore grid (metres above LAT, positive up; the
  foil-depth build's download, fetch_national.py `infomar`): multibeam and
  bathymetric LiDAR, sparse on the foreshore;
- the OPW/TII LiDAR mosaics of the foil-depth pilots (2 m, OD Malin, brought
  to LAT with the pilot's own offset), only above 1.7 m LAT: below the
  water at the flight they see the water, as the rocks pilot found.

Each survey is averaged onto the tile's 10 m grid. Reported per region and
source: pixels, and the median and quartiles of satellite minus survey,
before and after the bias (heights.biasMetres) is taken off. Writes
<root>/out/intertidal/validation.json.

    python -I validate.py --infomar /tmp/wf-foildepth-national/data/infomar10 \\
        --lidar dub:2.561:/tmp/wf-foildepth/data/lidar/dub/mosaic_DTM_dub_ITM_ODMalin_2m.tif ...
"""
import argparse
import glob
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

LIDAR_ABOVE = 1.7


def survey_on(tile_profile, path, offset=0.0):
    """A survey raster averaged onto the tile's grid (NaN where none)."""
    import rasterio
    from rasterio.warp import reproject, Resampling, transform_bounds
    with rasterio.open(path) as src:
        tb = transform_bounds(tile_profile["crs"], src.crs, *tile_profile["bounds"])
        sb = src.bounds
        if tb[0] > sb.right or tb[2] < sb.left or tb[1] > sb.top or tb[3] < sb.bottom:
            return None
        dst = np.full((tile_profile["height"], tile_profile["width"]), np.nan, np.float32)
        reproject(rasterio.band(src, 1), dst, dst_transform=tile_profile["transform"], dst_crs=tile_profile["crs"],
                  src_nodata=src.nodata, dst_nodata=np.nan, resampling=Resampling.average)
    if not np.isfinite(dst).any():
        return None
    return dst + offset


def summarise(diff, bias):
    if diff.size == 0:
        return None
    q = np.percentile(diff, [25, 50, 75])
    qa = q - bias
    return {"pixels": int(diff.size), "medianRaw": round(float(q[1]), 3),
            "iqrRaw": [round(float(q[0]), 3), round(float(q[2]), 3)],
            "median": round(float(qa[1]), 3), "iqr": [round(float(qa[0]), 3), round(float(qa[2]), 3)],
            "within05": round(float((np.abs(diff - bias) <= 0.5).mean()), 3)}


def main():
    import rasterio
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--infomar", help="folder of INFOMAR 10 m LAT tiles")
    p.add_argument("--lidar", action="append", default=[], help="name:odMalinOffset:path")
    a = p.parse_args()
    cfg = common.config()
    bias = cfg["heights"]["biasMetres"]
    stations = common.stations()
    plan = common.read_json(common.path("work", "plan.json"))
    infomar = sorted(glob.glob(os.path.join(a.infomar, "*.tif"))) if a.infomar else []
    pairs = {}
    tiles_dir = common.path("work", "tiles")
    for tile in sorted(os.listdir(tiles_dir)):
        hp = os.path.join(tiles_dir, tile, "heights.tif")
        if not os.path.exists(hp):
            continue
        with rasterio.open(hp) as src:
            prof = {"crs": src.crs, "transform": src.transform, "width": src.width, "height": src.height,
                    "bounds": src.bounds}
            raw = src.read(2)
            cls = src.read(5)
            stn = src.read(6)
        with rasterio.open(os.path.join(tiles_dir, tile, "weight.tif")) as src:
            own = src.read(1) > 127
        observed = (cls == 1) & np.isfinite(raw) & own
        sources = [("INFOMAR", f, 0.0, None) for f in infomar]
        sources += [(f"LiDAR {n}", path, float(off), LIDAR_ABOVE) for n, off, path in
                    (s.split(":", 2) for s in a.lidar)]
        for name, path, off, above in sources:
            sv = survey_on(prof, path, off)
            if sv is None:
                continue
            ok = observed & np.isfinite(sv) & (sv > -2) & (sv < 8)
            if above is not None:
                ok &= sv >= above
            if not ok.any():
                continue
            kind = name.split(" ")[0]
            for k in np.unique(stn[ok]).astype(int):
                # Only ground above the station's low-tide threshold: below the lowest
                # tides seen a pixel cannot flip lower than they are, so it reads high.
                low = plan["stations"].get(stations[k]["id"], {}).get("low", 0.0)
                sel = ok & (stn == k) & (sv >= low)
                key = (stations[k]["id"], kind)
                pairs.setdefault(key, []).append((raw[sel] - sv[sel]).astype(np.float32))
        print(f"{tile}: {sum(v.size for vs in pairs.values() for v in vs)} pairs so far", flush=True)
    out = {"biasMetres": bias, "lidarAboveMetres": LIDAR_ABOVE, "regions": {}, "all": {}}
    for (sid, kind), parts in sorted(pairs.items()):
        d = np.concatenate(parts)
        out["regions"].setdefault(sid, {})[kind] = summarise(d, bias)
    for kind in {k for _, k in pairs}:
        d = np.concatenate([np.concatenate(v) for (s, k), v in pairs.items() if k == kind])
        out["all"][kind] = summarise(d, bias)
    common.write_json(common.path("out", "intertidal", "validation.json"), out)
    print(out["all"])


if __name__ == "__main__":
    sys.exit(main())
