"""How much foreshore each coastal block holds, from a handful of looks, before
fetch.py reads hundreds of them.

Per station of the tile, the scout.looks least cloudy acquisitions (tile cloud
under scout.maxTileCloud) at the lowest and at the highest levels it was seen
at; their B03, B08 and SCL at 40 m, from the COGs' overviews (a sixteenth of
the 10 m bytes). A 40 m pixel is foreshore when it is dry (NDWI <= 0) in most
of the clear low looks and wet in most of the clear high ones: ground the tide
covers and uncovers. Each coastal block takes the looks of its nearest station
among the tile's. On a steep coast the tide only climbs the rock: the block
has almost no foreshore, and run.py can leave it out (scout.minKm2).

Writes <root>/work/scout/<tile>.json: per block, its station, foreshore km²
and how many clear low and high looks it had.

    python -I scout.py --tile 29UPV [--tile ...] [--workers 16]
"""
import argparse
import concurrent.futures as cf
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402
from fetch import Scene  # noqa: E402

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "6")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "3")

STEP = 4  # 40 m pixels of the 10 m grid


def read_state(item, n):
    """-1 not usable, 0 dry, 1 wet, at 40 m (n × n over the tile)."""
    from rasterio.enums import Resampling
    scene = Scene(item)
    try:
        scl = scene.open("SCL").read(1, out_shape=(n, n), resampling=Resampling.nearest)
        g, w = (scene.open(b).read(1, out_shape=(n, n), resampling=Resampling.average).astype(np.float32)
                for b in ("B03", "B08"))
    finally:
        scene.close()
    bad = np.isin(scl, common.SCL_BAD) | (g <= 0) | (w <= 0)
    return np.where(bad, -1, ((g - w) > 0).astype(np.int8)).astype(np.int8)


def majority(states, want):
    """Pixels in `want` state (0 dry, 1 wet) in most of their clear looks, and clear in at least two."""
    s = np.stack(states)
    clear = (s >= 0).sum(0)
    hit = (s == want).sum(0)
    return (clear >= 2) & (hit * 2 > clear), clear


def run(tile, workers):
    cfg = common.config()
    sc = cfg["scout"]
    plan = common.read_json(common.path("work", "plan.json"))
    pt = plan["tiles"][tile]
    size = plan["blockSize"]
    items = {it["stamp"]: it for it in common.read_json(common.path("downloads", "catalog", f"{tile}.json"))["items"]}
    levels = common.read_json(common.path("work", "tides", "scenes.json"))["levels"]
    clear_enough = [it for it in items.values() if it["cloud"] is not None and it["cloud"] <= sc["maxTileCloud"]]

    looks = {}
    for s in pt["stations"]:
        lv = sorted((levels[s][it["stamp"]][0], it["stamp"]) for it in clear_enough if it["stamp"] in levels[s])
        looks[s] = {"low": [st for _, st in lv[:sc["looks"]]], "high": [st for _, st in lv[::-1][:sc["looks"]]]}
    stamps = sorted({st for v in looks.values() for k in v.values() for st in k})

    n = -(-pt_px(pt) // STEP)
    print(f"{tile}: {len(stamps)} looks to read at {STEP * 10} m", flush=True)
    with cf.ThreadPoolExecutor(workers) as pool:
        states = dict(zip(stamps, pool.map(lambda st: retry(read_state, items[st], n), stamps)))

    # Each coastal block takes its nearest station among the tile's.
    from pyproj import Transformer
    tr = Transformer.from_crs(f"EPSG:{pt['epsg']}", 4326, always_xy=True)
    stns = {s["id"]: s for s in common.stations()}
    l, b, r, t = pt["bbox"]
    half = size * 10 / 2
    out = {"tile": tile, "metresPerPixel": STEP * 10, "looks": looks, "blocks": {}}
    masks = {}
    for s in pt["stations"]:
        dry, n_low = majority([states[st] for st in looks[s]["low"] if states.get(st) is not None], 0)
        wet, n_high = majority([states[st] for st in looks[s]["high"] if states.get(st) is not None], 1)
        masks[s] = (dry & wet, n_low, n_high)
    bpx = size // STEP
    km2 = (STEP * 10 / 1000) ** 2
    for i, j in pt["coastalBlocks"]:
        lon, lat = tr.transform(l + j * size * 10 + half, t - i * size * 10 - half)
        d = common.station_distances(lon, lat, [stns[s] for s in pt["stations"]])
        s = pt["stations"][int(np.argmin(d))]
        fs, n_low, n_high = masks[s]
        sl = (slice(i * bpx, (i + 1) * bpx), slice(j * bpx, (j + 1) * bpx))
        out["blocks"][f"{i:02d}_{j:02d}"] = {
            "station": s, "foreshoreKm2": round(float(fs[sl].sum()) * km2, 3),
            "lowLooks": int(np.median(n_low[sl])), "highLooks": int(np.median(n_high[sl]))}
    common.write_json(common.path("work", "scout", f"{tile}.json"), out)
    tot = sum(v["foreshoreKm2"] for v in out["blocks"].values())
    small = sum(1 for v in out["blocks"].values() if common.scout_skips(v, sc["minKm2"]))
    print(f"{tile}: {tot:.1f} km² foreshore over {len(out['blocks'])} coastal blocks; "
          f"{small} left out (under {sc['minKm2']} km², seen clear at both ends of the tide)", flush=True)


def pt_px(pt):
    l, b, r, t = pt["bbox"]
    return int(round((r - l) / 10))


def retry(fn, *args):
    for attempt in range(4):
        try:
            return fn(*args)
        except Exception as e:  # network trouble, an expired signature: wait, re-sign, retry
            err = e
            import time
            time.sleep(5 * (attempt + 1))
    print(f"  not read: {err!r}"[:200], flush=True)
    return None


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--tile", required=True, action="append")
    p.add_argument("--workers", type=int, default=16)
    a = p.parse_args()
    for t in a.tile:
        run(t, a.workers)


if __name__ == "__main__":
    sys.exit(main())
