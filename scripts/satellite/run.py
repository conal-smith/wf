"""Fetch and compose tiles in turn, one step at a time: a tile is read, then
composed, then the next one is read. Never both at once: on a 16 GB machine
shared with other work, reading with many threads beside a compose took it
out of memory (`--overlap` composes a tile while the next is read, on a
machine with room for both). Resumable: fetch.py skips what it has,
compose.py the blocks it has done, and a tile with its stats.json is not
composed again.

    nice -n 15 python -I run.py --tiles 29UPV,30UUF [--fetch-workers 5] [--compose-jobs 1]
    nice -n 15 python -I run.py --all
"""
import argparse
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402


OUTPUTS = ("stats.json", "high.tif", "low.tif", "heights.tif", "weight.tif", "lowir.tif")


def drop_downloads(tile):
    """A composed tile's Sentinel-2 reads, once its outputs are all there
    (2-25 GB a tile; the island's would be about 250 GB). Its log.jsonl stays,
    the record of what was read. Everything after compose (tiles.py,
    validate.py, publish.py) reads only work/tiles/<tile>/."""
    out = common.path("work", "tiles", tile)
    if not all(os.path.exists(os.path.join(out, f)) for f in OUTPUTS):
        print(f"{tile}: outputs missing, downloads kept", flush=True)
        return
    base = common.path("downloads", "s2", tile)
    for kind in ("coast", "summer"):
        shutil.rmtree(os.path.join(base, kind), ignore_errors=True)
    print(f"{tile}: downloads dropped", flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--tiles")
    p.add_argument("--all", action="store_true")
    p.add_argument("--fetch-workers", type=int, default=5)
    p.add_argument("--compose-jobs", type=int, default=1)
    p.add_argument("--overlap", action="store_true", help="compose a tile while the next one is read")
    p.add_argument("--keep-downloads", action="store_true", help="keep a composed tile's Sentinel-2 reads")
    p.add_argument("--every-look", action="store_true", help="read every acquisition, not fetch.py's selection")
    p.add_argument("--no-scout", action="store_true", help="read every coastal block, without scout.py first")
    a = p.parse_args()
    plan = common.read_json(common.path("work", "plan.json"))
    if a.all:
        # Most coast first: those take longest to compose.
        tiles = sorted(plan["tiles"], key=lambda t: -len(plan["tiles"][t]["coastalBlocks"]))
    else:
        tiles = a.tiles.split(",")
    py = sys.executable
    logs = common.path("logs")
    os.makedirs(logs, exist_ok=True)
    composing = None
    for t in tiles:
        if os.path.exists(common.path("work", "tiles", t, "stats.json")):
            print(f"{t}: already composed", flush=True)
            if not a.keep_downloads:
                drop_downloads(t)
            continue
        t0 = time.time()
        if not a.no_scout and not os.path.exists(common.path("work", "scout", f"{t}.json")):
            # A few looks at 40 m first: fetch.py and compose.py then leave out
            # the coastal blocks with next to no foreshore (common.scouted).
            with open(os.path.join(logs, f"scout-{t}.log"), "a") as fh:
                r = subprocess.run([py, "-I", os.path.join(HERE, "scout.py"), "--tile", t, "--workers",
                                    str(a.fetch_workers)], stdout=fh, stderr=subprocess.STDOUT)
            print(f"{t}: scouted ({r.returncode}) in {time.time() - t0:.0f} s", flush=True)
        with open(os.path.join(logs, f"fetch-{t}.log"), "a") as fh:
            r = subprocess.run([py, "-I", os.path.join(HERE, "fetch.py"), "--tile", t, "--workers",
                                str(a.fetch_workers)] + (["--every-look"] if a.every_look else []),
                               stdout=fh, stderr=subprocess.STDOUT)
        print(f"{t}: fetched ({r.returncode}) in {time.time() - t0:.0f} s", flush=True)
        if composing is not None:
            # --overlap: the tile before, composed while this one was read.
            composing.wait()
            print(f"{prev}: composed ({composing.returncode}) in {time.time() - t1:.0f} s", flush=True)
            if not a.keep_downloads:
                drop_downloads(prev)
        fh = open(os.path.join(logs, f"compose-{t}.log"), "a")
        t1 = time.time()
        composing = subprocess.Popen([py, "-I", os.path.join(HERE, "compose.py"), "--tile", t, "--jobs",
                                      str(a.compose_jobs)], stdout=fh, stderr=subprocess.STDOUT)
        print(f"{t}: composing", flush=True)
        prev = t
        if not a.overlap:
            composing.wait()
            print(f"{t}: composed ({composing.returncode}) in {time.time() - t1:.0f} s", flush=True)
            composing = None
            if not a.keep_downloads:
                drop_downloads(t)
    if composing is not None:
        composing.wait()
        print(f"{prev}: composed ({composing.returncode}) in {time.time() - t1:.0f} s", flush=True)
        if not a.keep_downloads:
            drop_downloads(prev)
    print("all done", flush=True)


if __name__ == "__main__":
    sys.exit(main())
