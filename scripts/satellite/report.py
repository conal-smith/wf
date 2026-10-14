"""The run's numbers, as Markdown tables for the README: per Sentinel-2 tile
(looks read, kept, intertidal), and per tide station's region (acquisitions,
the tide range seen, the thresholds, the images' median tides and looks, the
heights' coverage and the validation).

    python -I report.py [--imagery <out>/satellite] [--intertidal <out>/intertidal]
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402


def fetch_counts(tile):
    p = common.path("downloads", "s2", tile, "log.jsonl")
    last = {}
    if os.path.exists(p):
        with open(p) as fh:
            for line in fh:
                r = json.loads(line)
                last[(r["kind"], r["stamp"])] = r
    coast = [r for (k, _), r in last.items() if k == "coast"]
    return len(coast), sum(r["status"] == "kept" for r in coast)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--imagery", default=common.path("out", "satellite"))
    p.add_argument("--intertidal", default=common.path("out", "intertidal"))
    a = p.parse_args()
    plan = common.read_json(common.path("work", "plan.json"))
    print("| Tile | Coastal / all blocks | Acquisitions read | Kept (≤ 75% cloud) | Observed intertidal |")
    print("| --- | --- | --- | --- | --- |")
    for t, pt in sorted(plan["tiles"].items()):
        stats_p = common.path("work", "tiles", t, "stats.json")
        st = common.read_json(stats_p) if os.path.exists(stats_p) else {}
        n, kept = fetch_counts(t)
        print(f"| {t} | {len(pt['coastalBlocks'])} / {len(pt['coverageBlocks'])} | {n} | {kept} | "
              f"{st.get('intertidalKm2', '–')} km² |")
    print()
    img = common.read_json(os.path.join(a.imagery, "index.json")) if os.path.exists(
        os.path.join(a.imagery, "index.json")) else {"stations": []}
    tid = common.read_json(os.path.join(a.intertidal, "index.json")) if os.path.exists(
        os.path.join(a.intertidal, "index.json")) else {"areas": []}
    val_p = os.path.join(a.intertidal, "validation.json")
    val = common.read_json(val_p)["regions"] if os.path.exists(val_p) else {}
    images = {s["id"]: s for s in img["stations"]}
    areas = {x["station"]: x for x in tid["areas"]}
    print("| Station | Acquisitions | Tide seen (m LAT) | Low ≤ / high ≥ | Low image | High image | "
          "Intertidal (z13) | Archive | Satellite − LiDAR (median, IQR) |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for s in common.stations():
        sid = s["id"]
        th = plan["stations"].get(sid)
        if not th:
            continue
        im = images.get(sid, {})
        ar = areas.get(sid, {})
        km2 = "–"
        if ar:
            px = 2 * math.pi * 6378137 / 2 ** 13 / 512 * math.cos(math.radians(s["lat"]))
            km2 = f"{ar['stats']['observedPixelsZ13'] * px * px * 1e-6:.1f} km²"
        lv = (val.get(sid) or {}).get("LiDAR")
        lid = f"{lv['medianRaw']:+.2f} ({lv['iqrRaw'][0]:+.2f} to {lv['iqrRaw'][1]:+.2f}), {lv['pixels']} px" if lv else "–"
        low = f"≈{im['low']:.1f} m ({im['looks']['low']:.0f} looks)" if im else "–"
        high = f"≈{im['high']:.1f} m ({im['looks']['high']:.0f} looks)" if im else "–"
        size = f"{ar['stats']['bytes'] / 1e6:.2f} MB" if ar else "–"
        print(f"| {s['name']} | {th['acquisitions']} | {th['range'][0]:.1f}–{th['range'][1]:.1f} | "
              f"{th['low']:.1f} / {th['high']:.1f} | {low} | {high} | {km2} | {size} | {lid} |")


if __name__ == "__main__":
    sys.exit(main())
