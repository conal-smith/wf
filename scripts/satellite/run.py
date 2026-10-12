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
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--tiles")
    p.add_argument("--all", action="store_true")
    p.add_argument("--fetch-workers", type=int, default=5)
    p.add_argument("--compose-jobs", type=int, default=1)
    p.add_argument("--overlap", action="store_true", help="compose a tile while the next one is read")
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
            continue
        t0 = time.time()
        with open(os.path.join(logs, f"fetch-{t}.log"), "a") as fh:
            r = subprocess.run([py, "-I", os.path.join(HERE, "fetch.py"), "--tile", t, "--workers",
                                str(a.fetch_workers)], stdout=fh, stderr=subprocess.STDOUT)
        print(f"{t}: fetched ({r.returncode}) in {time.time() - t0:.0f} s", flush=True)
        if composing is not None:
            composing.wait()
        fh = open(os.path.join(logs, f"compose-{t}.log"), "a")
        t1 = time.time()
        composing = subprocess.Popen([py, "-I", os.path.join(HERE, "compose.py"), "--tile", t, "--jobs",
                                      str(a.compose_jobs)], stdout=fh, stderr=subprocess.STDOUT)
        print(f"{t}: composing", flush=True)
        if not a.overlap:
            composing.wait()
            print(f"{t}: composed ({composing.returncode}) in {time.time() - t1:.0f} s", flush=True)
            composing = None
    if composing is not None:
        composing.wait()
    print("all done", flush=True)


if __name__ == "__main__":
    sys.exit(main())
