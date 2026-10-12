"""Observed water level (m above LAT) at a Marine Institute tide gauge at each scene's time.

Irish National Tide Gauge Network on the Marine Institute's ERDDAP (CC BY 4.0),
5-minute observations since 2000, QC-flagged. The prediction dataset
(imiTidePrediction) only reaches back to 2026-01-01, so for 2017-2025 scenes the
gauge is the record; it also carries the surge, which is what the waterline sees.

    python -I fetch_gauge.py --scenes <s2>/<area>/scenes.json --station "Howth Water Level 1" --out <dir>/<area>-howth.json
"""
import argparse
import concurrent.futures as cf
import csv
import io
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import requests

ERDDAP = "https://erddap.marine.ie/erddap/tabledap/IrishNationalTideGaugeNetwork.csv"
UA = "wingfoil.ie rocks pilot"


def stamp(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch(station, when, half_minutes=40):
    start, end = when - timedelta(minutes=half_minutes), when + timedelta(minutes=half_minutes)
    url = (f"{ERDDAP}?time,Water_Level_LAT,QC_Flag&station_id={quote(chr(34) + station + chr(34))}"
           f"&time{quote('>=')}{stamp(start)}&time{quote('<=')}{stamp(end)}")
    for attempt in range(4):
        try:
            r = requests.get(url, timeout=(15, 90), headers={"User-Agent": UA})
            if r.status_code == 404:  # ERDDAP: no rows
                return []
            r.raise_for_status()
            rows = list(csv.reader(io.StringIO(r.text)))[2:]
            out = []
            for t, level, flag in rows:
                try:
                    out.append((datetime.fromisoformat(t.replace("Z", "+00:00")), float(level), flag))
                except ValueError:
                    pass
            return out
        except Exception:
            time.sleep(2 ** attempt)
    return None


def level_at(samples, when):
    """Linear interpolation between the samples either side; None if the gap is over 20 minutes."""
    good = [(t, v) for t, v, flag in samples if flag in ("1", "", "0") and -1.5 < v < 7.0]
    if not good:
        good = [(t, v) for t, v, _ in samples if -1.5 < v < 7.0]
    before = [s for s in good if s[0] <= when]
    after = [s for s in good if s[0] >= when]
    if not before or not after:
        return None
    (t0, v0), (t1, v1) = before[-1], after[0]
    if (t1 - t0) > timedelta(minutes=20):
        return None
    if t1 == t0:
        return v0
    f = (when - t0) / (t1 - t0)
    return v0 + f * (v1 - v0)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--scenes", required=True, type=Path)
    p.add_argument("--station", required=True)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--all", action="store_true", help="every scene, not only the kept ones")
    args = p.parse_args()
    meta = json.loads(args.scenes.read_text())
    scenes = [s for s in meta["scenes"] if args.all or s["status"] == "kept"]
    result = {}
    if args.out.exists():
        result = json.loads(args.out.read_text()).get("levels", {})

    def job(scene):
        when = datetime.fromisoformat(scene["datetime"].replace("Z", "+00:00"))
        samples = fetch(args.station, when)
        if samples is None:
            return scene["stamp"], {"error": "fetch failed"}
        level = level_at(samples, when)
        # Rate of change, to say whether the tide was rising or falling.
        later = level_at(samples, when + timedelta(minutes=30))
        earlier = level_at(samples, when - timedelta(minutes=30))
        slope = None if later is None or earlier is None else round(later - earlier, 3)
        return scene["stamp"], {"level": None if level is None else round(level, 3), "change1h": slope,
                                "samples": len(samples)}

    todo = [s for s in scenes if s["stamp"] not in result or result[s["stamp"]].get("error")]
    with cf.ThreadPoolExecutor(4) as pool:
        for n, (key, value) in enumerate(pool.map(job, todo), 1):
            result[key] = value
            if n % 50 == 0:
                print(f"  {n}/{len(todo)}", flush=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"station": args.station, "datum": "LAT", "source": ERDDAP,
                                    "attribution": "Irish National Tide Gauge Network, Marine Institute, CC BY 4.0",
                                    "levels": result}, indent=1))
    ok = [v["level"] for v in result.values() if v.get("level") is not None]
    print(f"{args.station}: {len(ok)}/{len(result)} scenes with a level, range {min(ok):.2f}..{max(ok):.2f} m LAT"
          if ok else "no levels")


if __name__ == "__main__":
    main()
