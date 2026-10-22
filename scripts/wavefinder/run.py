"""Read every tile of a region, one after another, then score each: the VM's
long run. Resumable: a tile with its s2/<tile>/done.json is skipped, and
read.py itself skips the looks in its log.

    python -I run.py --region ireland [--first 29UNA 29UMT ...] [--workers 16]

Detached, logged (on the VM):

    cd /tmp && nohup ~/venv/bin/python -I ~/wf/scripts/wavefinder/run.py --region gb \\
        > ~/wavefinder/run-gb.log 2>&1 &
"""
import argparse
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import wf  # noqa: E402


def with_breaks(plan, region):
    """The plan's tiles with a known break of the region inside their footprint."""
    from pyproj import Transformer
    breaks = [b for b in wf.read_json(os.path.join(HERE, "breaks.json"))["breaks"] if b["region"] == region]
    out = []
    for t, pt in sorted(plan["tiles"].items()):
        tr = Transformer.from_crs(4326, f"EPSG:{pt['epsg']}", always_xy=True)
        l, b, r, tp = pt["bbox"]
        for br in breaks:
            x, y = tr.transform(br["lon"], br["lat"])
            if l + 5000 <= x <= r - 5000 and b + 5000 <= y <= tp - 5000:
                out.append(t)
                break
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", default="ireland")
    p.add_argument("--first", nargs="*", default=[], help="tiles to do before the rest")
    p.add_argument("--only", nargs="*", help="these tiles alone")
    p.add_argument("--breaks-first", action="store_true",
                   help="after --first, the tiles with a known break (breaks.json) in them")
    p.add_argument("--workers", type=int, default=16)
    a = p.parse_args()
    wf.set_region(a.region)
    common = wf.satellite()
    import read
    import score
    plan = common.read_json(common.path("work", "plan.json"))
    first = [t for t in a.first if t in plan["tiles"]]
    if a.breaks_first:
        first += [t for t in with_breaks(plan, a.region) if t not in first]
    tiles = a.only or (first + [t for t in sorted(plan["tiles"]) if t not in first])
    t0 = time.time()
    for n, tile in enumerate(tiles, 1):
        done = wf.rpath("s2", tile, "done.json")
        if os.path.exists(done):
            continue
        if not os.path.exists(wf.rpath("work", "seastate", f"{tile}.json")):
            print(f"{tile}: no sea state (seastate.py tiles)", flush=True)
            continue
        t1 = time.time()
        counts = read.run(tile, a.workers)
        score.run(tile)
        wf.write_json(done, {"tile": tile, "counts": counts, "seconds": round(time.time() - t1)})
        print(f"== {tile} done ({n}/{len(tiles)}) in {time.time() - t1:.0f} s; {time.time() - t0:.0f} s so far", flush=True)
    print("all tiles done", flush=True)


if __name__ == "__main__":
    sys.exit(main())
