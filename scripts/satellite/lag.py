"""A basin's tide lag, from the imagery itself.

Behind a narrow entrance (Strangford Lough behind the Narrows) the water
rises and falls hours after the open coast, so the open-coast station's
levels sort the looks wrongly and the basin's flats get no fit. The flip fit
depends only on the order of the looks' levels, so the lag that best explains
the basin's wet and dry looks can be read off the looks: for each candidate
lag, the station's (fitted EOT20) levels at the looks' times shifted by it,
and the median misfit over the basin's pixels that are wet in some looks and
dry in others. No tide table comes into it. The amplitude cannot be had this
way (a scale keeps the order), so the station keeps its parent's.

    python -I lag.py --station Strangford_MODELLED --tile 30UUF [--lags 0:240:10]
"""
import argparse
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402
import composite  # noqa: E402
import compose  # noqa: E402
import tides  # noqa: E402


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--station", required=True)
    p.add_argument("--tile", required=True)
    p.add_argument("--lags", default="0:241:10", help="minutes, start:stop:step")
    p.add_argument("--step", type=int, default=4, help="every n-th pixel each way")
    a = p.parse_args()
    st = {s["id"]: s for s in common.stations(include_inactive=True)}[a.station]
    parent = st["lagOf"]
    cal = common.read_json(common.path("work", "tides", "calibration.json"))["stations"][parent]
    ctx = compose.Ctx(a.tile)
    looks = compose.Looks([p for _, p, _ in ctx.coast])
    ring = st["polygon"]
    stacks = []
    for i, j in ctx.pt["coastalBlocks"]:
        (lon, lat), _ = compose.block_lonlat(ctx.pt, i, j, ctx.size, step=a.step)
        mine = common.in_polygon(lon, lat, ring)
        if not mine.any():
            continue
        codes = looks.stack(range(len(ctx.coast)), f"c{i:02d}_{j:02d}", (ctx.size, ctx.size))[:, ::a.step, ::a.step]
        s = np.where(codes == 0, -1, np.where((codes & 3) == 2, 1, 0)).astype(np.int8)
        seen = (s >= 0).sum(0)
        freq = (s == 1).sum(0) / np.maximum(seen, 1)
        pick = mine & (seen >= 30) & (freq > 0.1) & (freq < 0.9)
        if pick.any():
            stacks.append(s[:, pick])
        print(f"block {i},{j}: {int(pick.sum())} pixels", flush=True)
    stack = np.concatenate(stacks, axis=1)[:, None, :]
    when = np.array([common.time_of(s).timestamp() for s in ctx.stamps])
    lon, lat = cal["model"]
    results = []
    lags = range(*[int(v) for v in a.lags.split(":")])
    for lag in lags:
        lv = cal["a"] + cal["b"] * tides.model(lon, lat, when + (cal["shiftMinutes"] + lag) * 60)
        z, misfit, nvalid, state, _ = composite.flip_heights(stack, lv)
        m = float(np.nanmedian(misfit[state == 1]))
        results.append((lag, m, float((state == 1).mean())))
        print(f"lag {lag:4d} min: median misfit {m:.3f}, flipping {results[-1][2]:.2f}", flush=True)
    best = min(results, key=lambda r: r[1])
    print(f"{a.station}: best lag {best[0]} min after {parent} (median misfit {best[1]:.3f}, "
          f"{stack.shape[2]} pixels)")
    common.write_json(common.path("work", "tides", f"lag-{a.station}.json"),
                      {"station": a.station, "parent": parent, "pixels": int(stack.shape[2]),
                       "results": [{"lagMinutes": l, "medianMisfit": round(m, 4), "flipping": round(f, 3)}
                                   for l, m, f in results],
                       "bestLagMinutes": best[0]})


if __name__ == "__main__":
    sys.exit(main())
