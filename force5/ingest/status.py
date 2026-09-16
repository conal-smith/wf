"""Report the age of every published forecast manifest in the work directory.

This is a freshness check for the local deployment, not a forecast-quality check:
it reads the pointer manifests the website actually serves, reports each run's age
and horizon, counts frame files that are missing from disk, and exits nonzero when
a model is absent, stale or already expired.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys

from publish_s3 import MANIFESTS

DEFAULT_MAX_AGE_HOURS = {"ecmwf": 24.0}  # Twice-daily full-horizon product.
FALLBACK_MAX_AGE_HOURS = 12.0


def max_age_hours(model, override=None):
    if override is not None:
        return override
    return DEFAULT_MAX_AGE_HOURS.get(model, FALLBACK_MAX_AGE_HOURS)


def describe(public, model, now, override=None):
    """One model's freshness, without raising on missing or malformed output."""
    limit = max_age_hours(model, override)
    path = public / "weather" / MANIFESTS[model]
    row = {"model": model, "manifest": MANIFESTS[model], "maxAgeHours": limit, "ok": False}
    if not path.is_file():
        return {**row, "state": "absent"}
    try:
        manifest = json.loads(path.read_text())
        run = datetime.strptime(manifest["run"], "%Y%m%d%H").replace(tzinfo=timezone.utc)
        frames = manifest["frames"]
        last = datetime.fromisoformat(frames[-1]["validTime"].replace("Z", "+00:00"))
    except (OSError, ValueError, KeyError, IndexError, TypeError) as error:
        return {**row, "state": "unreadable", "error": str(error)}
    missing = sum(1 for frame in frames if not (public / frame["url"]).is_file())
    age = (now - run).total_seconds() / 3600
    row.update({"run": manifest["run"], "ageHours": round(age, 2), "frames": len(frames),
                "missingFrames": missing, "horizonEnds": frames[-1]["validTime"],
                "horizonHoursLeft": round((last - now).total_seconds() / 3600, 2)})
    if missing:
        return {**row, "state": "incomplete"}
    if last <= now:
        return {**row, "state": "expired"}
    if age > limit:
        return {**row, "state": "stale"}
    return {**row, "state": "fresh", "ok": True}


def render(rows):
    lines = [f"{'model':<9} {'state':<11} {'run':<11} {'age':>8} {'frames':>7} "
             f"{'missing':>8}  horizon ends"]
    for row in rows:
        age = f"{row['ageHours']:.1f} h" if "ageHours" in row else "-"
        lines.append(f"{row['model']:<9} {row['state']:<11} {row.get('run', '-'):<11} "
                     f"{age:>8} {row.get('frames', '-'):>7} "
                     f"{row.get('missingFrames', '-'):>8}  {row.get('horizonEnds', '-')}")
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--models", nargs="+", default=list(MANIFESTS),
                        help="Models to check; unknown ids are reported, not fatal")
    parser.add_argument("--root", default=os.environ.get(
        "FORCE5_WORK_DIR", str(Path(__file__).resolve().parents[2])),
        help="Work directory holding public/weather")
    parser.add_argument("--max-age-hours", type=float,
                        help="Override the per-model freshness limit")
    parser.add_argument("--json", action="store_true", help="Emit one JSON object per line")
    args = parser.parse_args(argv)
    public = Path(args.root) / "public"
    now = datetime.now(timezone.utc)
    rows, unknown = [], []
    for model in dict.fromkeys(args.models):
        if model not in MANIFESTS:
            unknown.append(model)
            continue
        rows.append(describe(public, model, now, args.max_age_hours))
    if args.json:
        for row in rows:
            print(json.dumps(row), flush=True)
    else:
        print(f"Forecast status at {now.isoformat(timespec='seconds')} for {args.root}")
        print(render(rows))
    for model in unknown:
        print(f"Unknown model id {model!r}; known ids: {', '.join(MANIFESTS)}", file=sys.stderr)
    return 0 if rows and all(row["ok"] for row in rows) and not unknown else 1


if __name__ == "__main__":
    sys.exit(main())
