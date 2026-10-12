"""Fetch and compose tiles in turn: the reads are bound by the network and
composing by the CPU, so each tile is composed while the next one is read.
Resumable: fetch.py skips what it has, compose.py the blocks it has done, and
a tile with its stats.json is not composed again.

    python -I run.py --tiles 29UPV,30UUF [--fetch-workers 24] [--compose-jobs 3]
    python -I run.py --all
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
    p.add_argument("--fetch-workers", type=int, default=24)
    p.add_argument("--compose-jobs", type=int, default=3)
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
                                str(a.fetch_workers)], stdout=fh, stderr=subprocess.STDOUT,
                               start_new_session=True)
        print(f"{t}: fetched ({r.returncode}) in {time.time() - t0:.0f} s", flush=True)
        if composing is not None:
            composing.wait()
        fh = open(os.path.join(logs, f"compose-{t}.log"), "a")
        composing = subprocess.Popen([py, "-I", os.path.join(HERE, "compose.py"), "--tile", t, "--jobs",
                                      str(a.compose_jobs)], stdout=fh, stderr=subprocess.STDOUT,
                                     start_new_session=True)
        print(f"{t}: composing", flush=True)
    if composing is not None:
        composing.wait()
    print("all done", flush=True)


if __name__ == "__main__":
    sys.exit(main())
