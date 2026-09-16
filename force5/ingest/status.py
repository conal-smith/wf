"""Report the age of every published manifest in the work directory.

A freshness check for the local deployment, not a forecast-quality check: it
reads the pointer manifests the website actually serves, reports each run's age
and how far its coverage still reaches, counts objects that are missing from
disk, and exits nonzero when a model is absent, unreadable, incomplete, stale or
already expired. Every registered kind is understood, including a tide manifest
that publishes coverage instead of frames and an ensemble that publishes spot
series without map frames.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys

from prune import manifest_urls
from registry import MANIFESTS, MODELS


def moment(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def horizon(manifest):
    """The last time this bundle claims to cover, whatever shape it publishes."""
    coverage = manifest.get("coverage")
    if isinstance(coverage, dict) and coverage.get("to"):
        return moment(coverage["to"])
    frames = manifest.get("frames")
    if isinstance(frames, list) and frames:
        return moment(frames[-1]["validTime"])
    series = manifest.get("spotMembers") or manifest.get("spotForecasts")
    if isinstance(series, dict) and series:
        # The publisher guarantees only the shortest spot series, so report that.
        return min(moment(steps[-1]["validTime"]) for steps in series.values() if steps)
    raise ValueError("Manifest declares no coverage, frames or spot series")


def describe(public, model, now, override=None):
    """One model's freshness, without raising on missing or malformed output."""
    limit = override if override is not None else float(MODELS[model]["maxAgeHours"])
    published = MANIFESTS[model]
    row = {"model": model, "manifest": published, "kind": MODELS[model]["kind"],
           "maxAgeHours": limit, "ok": False}
    path = public / published
    if not path.is_file():
        return {**row, "state": "absent"}
    try:
        manifest = json.loads(path.read_text())
        run = datetime.strptime(manifest["run"], "%Y%m%d%H").replace(tzinfo=timezone.utc)
        last = horizon(manifest)
        urls = manifest_urls(manifest)
    except (OSError, ValueError, KeyError, IndexError, TypeError, AttributeError) as error:
        return {**row, "state": "unreadable", "error": str(error)}
    missing = sum(1 for url in urls if not (public / str(url).lstrip("/")).is_file())
    age = (now - run).total_seconds() / 3600
    row.update({"run": manifest["run"], "ageHours": round(age, 2),
                "objects": len(urls), "frames": len(manifest.get("frames") or []),
                "missing": missing, "coverageEnds": last.isoformat().replace("+00:00", "Z"),
                "coverageHoursLeft": round((last - now).total_seconds() / 3600, 2)})
    if missing:
        return {**row, "state": "incomplete"}
    if last <= now:
        return {**row, "state": "expired"}
    if age > limit:
        return {**row, "state": "stale"}
    return {**row, "state": "fresh", "ok": True}


def render(rows):
    lines = [f"{'model':<10} {'kind':<5} {'state':<11} {'run':<11} {'age':>8} "
             f"{'objects':>8} {'missing':>8}  coverage ends"]
    for row in rows:
        age = f"{row['ageHours']:.1f} h" if "ageHours" in row else "-"
        lines.append(f"{row['model']:<10} {row['kind']:<5} {row['state']:<11} "
                     f"{row.get('run', '-'):<11} {age:>8} {row.get('objects', '-'):>8} "
                     f"{row.get('missing', '-'):>8}  {row.get('coverageEnds', '-')}")
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--models", nargs="+", default=list(MANIFESTS),
                        help="Models to check; an unknown id is reported, not fatal")
    parser.add_argument("--root", default=os.environ.get(
        "FORCE5_WORK_DIR", str(Path(__file__).resolve().parents[2])),
        help="Work directory holding public/")
    parser.add_argument("--max-age-hours", type=float,
                        help="Override the registry's per-model freshness limit")
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
        print(f"Unknown model id {model!r}; the registry has: {', '.join(MANIFESTS)}",
              file=sys.stderr)
    return 0 if rows and all(row["ok"] for row in rows) and not unknown else 1


if __name__ == "__main__":
    sys.exit(main())
