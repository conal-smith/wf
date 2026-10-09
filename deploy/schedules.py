"""Write the Home Compute and Cloudflare schedules from deploy/local/jobs.toml.

One timetable drives every way the forecast is run: the local Compose scheduler
reads jobs.toml itself, and this script translates it for the other two, so a
model's slots, arguments and timeout are only ever edited in one place.

    .venv/bin/python deploy/schedules.py           # rewrite both files
    .venv/bin/python deploy/schedules.py --check   # fail if either is stale
    .venv/bin/python deploy/schedules.py --list    # the timetable as JSON
    .venv/bin/python deploy/schedules.py --set harmonie --minutes 40 --memory 3Gb

`--set` edits jobs.toml in place, line by line, so its comments survive, then
rewrites both files; the Home Compute Bar app's Timetable tab is built on it.

Jobs are parsed with the local scheduler's own loader, so a job it would reject
is rejected here too. The `status` job is left out of both: it prints a
freshness line for the Compose log, and Home Compute's snapshot (and the menu
bar app reading it) already says when each model last published.
"""
import argparse
import contextlib
import io
import json
from pathlib import Path
import re
import sys
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "force5" / "ingest"))

from scheduler import load_jobs  # noqa: E402

JOBS_FILE = ROOT / "deploy" / "local" / "jobs.toml"
HOME_COMPUTE_FILE = ROOT / "deploy" / "home-compute" / "home-compute.json"
CLOUDFLARE_FILE = ROOT / "deploy" / "cloudflare" / "jobs.json"

DESCRIPTIONS = {
    "harmonie": "HARMONIE-AROME (Met Éireann), hourly DINI cycle",
    "icon-eu": "ICON-EU wind (DWD)",
    "icon-eu-weather": "ICON-EU surface weather (DWD)",
    "ecmwf": "ECMWF IFS 15-day",
    "ecmwf-ens": "ECMWF ensemble (chance it rides)",
    "aifs": "ECMWF AIFS (machine-learned)",
    "ecmwf-wave": "ECMWF waves",
    "gfs": "GFS (NOAA)",
    "gefs": "GEFS ensemble (NOAA)",
    "arpege": "ARPEGE (Météo-France)",
    "arome": "AROME (Météo-France)",
    "harmonie-eps": "HARMONIE ensemble (Met Éireann)",
    "gfs-wave": "GFS-Wave (NOAA)",
    "mi-swan": "Irish Shelf SWAN waves (Marine Institute)",
    "tides": "Tide predictions (Marine Institute)",
    "sea-temperature": "Sea temperature observations",
    "blend": "Every spot's wind blend, for the map's stars",
}

# What a job may use. Bacalhau holds a container to its memory, so these are
# ceilings, not hints: the forecast models get the 4 GB the worker was sized at
# on Fargate, the station feeds a fraction of it. A Mac mini's Colima VM fits
# one large job at a time, and Bacalhau queues the rest rather than overcommit.
LARGE = {"cpu": "2", "memory": "4Gb", "disk": "12Gb"}
ENSEMBLE = {"cpu": "2", "memory": "4Gb", "disk": "20Gb"}
SMALL = {"cpu": "1", "memory": "1Gb", "disk": "2Gb"}
RESOURCES = {
    "ecmwf-ens": ENSEMBLE, "ecmwf-wave": ENSEMBLE, "harmonie-eps": ENSEMBLE, "gefs": ENSEMBLE,
    "tides": SMALL, "sea-temperature": SMALL, "blend": SMALL, "mi-swan": {"cpu": "1", "memory": "2Gb", "disk": "4Gb"},
    "gfs-wave": {"cpu": "1", "memory": "2Gb", "disk": "6Gb"},
}
SWEEP = {"cpu": "0.5", "memory": "512Mb", "disk": "1Gb"}

# Cloudflare sizes, named here and defined in deploy/cloudflare/src/index.ts.
# Memory and disk are billed for the whole run, so each job gets the smallest
# that fits, and only the ensembles pay for a 20 GB disk.
def cloudflare_size(resources):
    if resources["disk"] == "20Gb":
        return "ensemble"
    megabytes = memory_mb(resources["memory"])
    return "small" if megabytes <= 1024 else "medium" if megabytes <= 2048 else "large"


# What `memory = "..."` in jobs.toml may say. The Mac mini's Colima VM gives
# Bacalhau 5.5 GB, so a larger ceiling would queue for ever there.
MEMORY_CHOICES = ["512Mb", "1Gb", "2Gb", "3Gb", "4Gb", "5Gb"]


def memory_mb(value):
    number, unit = re.fullmatch(r"(\d+)(Mb|Gb)", value).groups()
    return int(number) * (1024 if unit == "Gb" else 1)


# The Worker wakes every five minutes and runs the jobs whose slot it is.
CRON_STEP_MINUTES = 5

BUCKET_ENV = ["S3_BUCKET", "S3_ENDPOINT_URL", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]
# FORCE5_SIDECARS=0 is required, not optional: a bucket serves one encoding per
# object, so the .br/.gz sidecars a local Caddy serves would be compressed for nothing.
REQUIRED_ENV = BUCKET_ENV + ["FORCE5_SIDECARS"]
OPTIONAL_ENV = ["S3_PREFIX", "AWS_REGION", "ECMWF_SOURCE", "FORCE5_BROTLI_QUALITY"]
PRUNE_SCRIPT = 'exec python /app/force5/ingest/prune.py --bucket "$S3_BUCKET"'
# Bacalhau starts the clock at submission, so a job queued behind a large one
# still has its whole importer timeout once it starts.
QUEUE_SECONDS = 3600
START_MARGIN_SECONDS = 600


def default_resources(job):
    if job["command"] == "prune":
        return SWEEP
    return max((RESOURCES.get(model, LARGE) for model in job["models"]),
               key=lambda value: memory_mb(value["memory"]))


def resources_for(job):
    """The job's defaults, with the memory jobs.toml sets for it, if any."""
    resources = default_resources(job)
    return {**resources, "memory": job["memory"]} if job.get("memory") else resources


def slots(job):
    """Hours and minutes, with every hour of the day written as no hours at all."""
    hours = {} if job["hours"] == list(range(24)) else {"hours": job["hours"]}
    return {**hours, "minutes": job["minutes"]}


def describe(job):
    if job["command"] == "prune":
        return "Sweep the bucket for objects no manifest references"
    return " + ".join(DESCRIPTIONS.get(model, model) for model in job["models"])


def scheduled(jobs):
    """The jobs both targets run, in timetable order, without `status`."""
    for job in jobs:
        if job["command"] == "status":
            continue
        if job["command"] == "prune":
            # The worker already deletes what a new run supersedes; the sweep only
            # catches what a failed upload left, so once a day is plenty.
            job = {**job, "hours": [2], "minutes": [10]}
        yield job


def home_compute(jobs):
    entries = []
    for job in scheduled(jobs):
        task = {
            "image": "${WINGFOIL_IMAGE}",
            "requiredEnv": REQUIRED_ENV,
            "passEnv": OPTIONAL_ENV,
            "resources": resources_for(job),
            "network": {"type": "Full"},
            "timeouts": {"queueSeconds": QUEUE_SECONDS,
                         "totalSeconds": (job["timeout_seconds"] or 2700) + START_MARGIN_SECONDS},
        }
        if job["command"] == "prune":
            task = {**task, "entrypoint": ["sh", "-c", PRUNE_SCRIPT], "requiredEnv": BUCKET_ENV}
        else:
            task = {**task, "parameters": ["--models", *job["models"], *job["args"]],
                    "report": {"format": "json-lines", "trackEvent": "forecast_complete",
                               "trackBy": "model"}}
        entries.append({
            "id": job["id"],
            **({} if job["enabled"] else {"enabled": False}),
            "description": describe(job),
            "schedule": {"at": slots(job), "timezone": "UTC"},
            "labels": {"application": "wingfoil", "models": ",".join(job["models"]) or job["command"]},
            "task": task,
        })
    return {
        "$comment": "Generated by deploy/schedules.py from deploy/local/jobs.toml. Edit that, then rerun.",
        "pollEvery": "30s",
        "stateFile": "state/state.json",
        "envFile": ".env",
        "api": {"host": "127.0.0.1", "port": 4786, "tokenEnv": "HOME_COMPUTE_API_TOKEN"},
        "bacalhau": {"binary": "bacalhau", "apiHost": "127.0.0.1", "apiPort": 1234},
        "jobs": entries,
    }


def cloudflare(jobs):
    entries = []
    for job in scheduled(jobs):
        off_step = [minute for minute in job["minutes"] if minute % CRON_STEP_MINUTES]
        if off_step:
            raise ValueError(f"{job['id']}: minutes must fall on a {CRON_STEP_MINUTES}-minute mark"
                             f" (Cloudflare's schedule ticks every {CRON_STEP_MINUTES}); {off_step} do not")
        entries.append({
            "id": job["id"],
            "enabled": job["enabled"],
            "description": describe(job),
            **slots(job),
            "size": cloudflare_size(resources_for(job)),
            "timeoutSeconds": job["timeout_seconds"] or 2700,
            **({"entrypoint": ["sh", "-c", PRUNE_SCRIPT]} if job["command"] == "prune"
               else {"args": ["--models", *job["models"], *job["args"]]}),
        })
    return {"$comment": "Generated by deploy/schedules.py from deploy/local/jobs.toml. Edit that, then rerun.",
            "cronStepMinutes": CRON_STEP_MINUTES, "jobs": entries}


def load(path=JOBS_FILE):
    """load_jobs, plus the `memory` it has no use for, validated here."""
    jobs = load_jobs(path)
    with open(path, "rb") as handle:
        raw = {entry.get("id"): entry for entry in tomllib.load(handle).get("jobs", [])}
    for job in jobs:
        memory = raw.get(job["id"], {}).get("memory")
        if memory is not None and memory not in MEMORY_CHOICES:
            raise ValueError(f"{job['id']}: memory must be one of {', '.join(MEMORY_CHOICES)}")
        job["memory"] = memory
    return jobs


def listing(jobs):
    entries = []
    for job in scheduled(jobs):
        entries.append({
            "id": job["id"],
            "description": describe(job),
            "models": job["models"],
            "command": job["command"],
            "enabled": job["enabled"],
            "hours": slots(job).get("hours"),
            "minutes": job["minutes"],
            "memory": resources_for(job)["memory"],
            "defaultMemory": default_resources(job)["memory"],
            "timeoutSeconds": job["timeout_seconds"] or 2700,
            # The sweep's slot is fixed in scheduled(); only its memory and switch apply.
            "scheduleEditable": job["command"] != "prune",
        })
    return {"cronStepMinutes": CRON_STEP_MINUTES, "memoryChoices": MEMORY_CHOICES, "jobs": entries}


def job_block(lines, job_id):
    """The [start, end) line range of the [[jobs]] table whose id is `job_id`."""
    starts = [index for index, line in enumerate(lines) if line.strip() == "[[jobs]]"]
    for position, start in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else len(lines)
        if any(re.match(rf'\s*id\s*=\s*"{re.escape(job_id)}"', line) for line in lines[start:end]):
            # Stop before the comments and blank lines that lead into the next table.
            while end > start + 1 and (not lines[end - 1].strip() or lines[end - 1].lstrip().startswith("#")):
                end -= 1
            return start, end
    raise ValueError(f"No job {job_id!r} in {JOBS_FILE.name}")


def set_key(lines, start, end, key, value):
    """Set, add or (value None) remove `key` in a job's table, keeping its comment."""
    pattern = re.compile(rf"^(\s*{key}\s*=\s*)([^#]*?)(\s*#.*)?$")
    for index in range(start, end):
        match = pattern.match(lines[index])
        if match:
            if value is None:
                comment = (match.group(3) or "").strip()
                lines[index:index + 1] = [comment] if comment else []
                return end - (0 if comment else 1)
            gap = match.group(3) or ""
            lines[index] = f"{match.group(1)}{value}{gap}"
            return end
    if value is None:
        return end
    lines.insert(end, f"{key} = {value}")
    return end + 1


def edit(text, job_id, enabled=None, hours=None, minutes=None, memory=None):
    """jobs.toml's text with one job changed. `hours` may be "every"."""
    lines = text.split("\n")
    start, end = job_block(lines, job_id)
    if enabled is not None:
        end = set_key(lines, start, end, "enabled", None if enabled else "false")
    if hours is not None:
        end = set_key(lines, start, end, "hours", None if hours == "every" else json.dumps(hours))
    if minutes is not None:
        end = set_key(lines, start, end, "minutes", json.dumps(minutes))
    if memory is not None:
        end = set_key(lines, start, end, "memory", json.dumps(memory))
    return "\n".join(lines)


def numbers(value, limit, name):
    try:
        items = sorted({int(item) for item in value.split(",") if item.strip()})
    except ValueError:
        raise ValueError(f"{name} must be whole numbers separated by commas") from None
    if not items or any(not 0 <= item < limit for item in items):
        raise ValueError(f"{name} must be between 0 and {limit - 1}")
    return items


def apply_set(args):
    """Validate an edit against a copy, then write jobs.toml and both generated files."""
    changes = {}
    if args.enabled is not None:
        changes["enabled"] = args.enabled == "true"
    if args.hours is not None:
        changes["hours"] = "every" if args.hours == "every" else numbers(args.hours, 24, "Hours")
    if args.minutes is not None:
        changes["minutes"] = numbers(args.minutes, 60, "Minutes")
    if args.memory is not None:
        if args.memory not in MEMORY_CHOICES:
            raise ValueError(f"Memory must be one of {', '.join(MEMORY_CHOICES)}")
        changes["memory"] = args.memory
    if not changes:
        raise ValueError("Nothing to change")
    current = next((job for job in listing(load())["jobs"] if job["id"] == args.set), None)
    if current is None:
        raise ValueError(f"No job {args.set!r} in the timetable")
    if not current["scheduleEditable"] and ("hours" in changes or "minutes" in changes):
        raise ValueError(f"{args.set} runs at a fixed time; only its switch and memory can change")
    text = edit(JOBS_FILE.read_text(), args.set, **changes)
    with tempfile.NamedTemporaryFile("w", suffix=".toml", delete=False) as handle:
        handle.write(text)
    try:
        jobs = load(Path(handle.name))
        if args.set not in {job["id"] for job in jobs}:
            raise ValueError(f"That change would make {args.set} invalid")
        outputs = generated(jobs)  # Raises on a minute off Cloudflare's tick.
    finally:
        Path(handle.name).unlink()
    JOBS_FILE.write_text(text)
    for path, value in outputs:
        path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def generated(jobs):
    return ((HOME_COMPUTE_FILE, home_compute(jobs)), (CLOUDFLARE_FILE, cloudflare(jobs)))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="Exit 1 if a generated file is out of date")
    parser.add_argument("--list", action="store_true", help="Print the timetable as JSON")
    parser.add_argument("--set", metavar="JOB", help="Change one job in jobs.toml, then regenerate")
    parser.add_argument("--enabled", choices=["true", "false"])
    parser.add_argument("--hours", help='"every" or comma-separated UTC hours')
    parser.add_argument("--minutes", help="Comma-separated minutes past the hour")
    parser.add_argument("--memory", help=f"One of {', '.join(MEMORY_CHOICES)}")
    args = parser.parse_args()
    if args.list or args.set:
        # Machine-readable both ways: the menu bar app reads stdout, exit 2 is a refusal.
        try:
            with contextlib.redirect_stdout(io.StringIO()) as chatter:
                if args.set:
                    apply_set(args)
                    result = {"ok": True, "restartRequired": True}
                else:
                    result = listing(load())
        except ValueError as error:
            print(json.dumps({"ok": False, "error": str(error)}))
            return 2
        warnings = [line for line in chatter.getvalue().splitlines() if '"schedule_' in line]
        if warnings:
            print("\n".join(warnings), file=sys.stderr)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    jobs = load()
    stale = []
    for path, value in generated(jobs):
        text = json.dumps(value, indent=2, ensure_ascii=False) + "\n"
        if args.check:
            if not path.exists() or path.read_text() != text:
                stale.append(str(path.relative_to(ROOT)))
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        print(f"wrote {path.relative_to(ROOT)} ({len(value['jobs'])} jobs)")
    if stale:
        print(f"Out of date: {', '.join(stale)}. Run .venv/bin/python deploy/schedules.py", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
