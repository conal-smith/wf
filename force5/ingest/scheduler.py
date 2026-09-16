"""Run the one-shot forecast worker on per-model cadences, one job at a time.

A deliberately small replacement for cron in the local deployment: no daemon, no
Docker socket, no overlapping jobs. Schedules are read from an editable TOML file
(see deploy/local/jobs.toml) in UTC, because model cycles are published in UTC.
Jobs run sequentially, so the worker's workspace lock is never contended; a job
whose slot passed while an earlier job was still running is skipped and logged
rather than queued up. An unknown model id disables only its own job.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import tomllib

from registry import MODELS

DEFAULT_JOBS_FILE = "/app/deploy/local/jobs.toml"
KNOWN_COMMANDS = {"worker": "worker.py", "prune": "prune.py", "status": "status.py"}
JOB_KEYS = {"id", "enabled", "command", "models", "args", "hours", "minutes", "timeout_seconds"}
HORIZON_MINUTES = 8 * 24 * 60  # Furthest ahead a schedule search looks.


def log(event, **fields):
    print(json.dumps({"event": event, "time": datetime.now(timezone.utc)
                      .isoformat(timespec="seconds"), **fields}), flush=True)


def minute_list(value, limit, default):
    if value is None:
        return default
    if not isinstance(value, list) or not value or not all(
            isinstance(item, int) and not isinstance(item, bool) and 0 <= item < limit
            for item in value):
        raise ValueError(f"Expected a list of integers in 0..{limit - 1}, got {value!r}")
    return sorted(set(value))


def load_jobs(path):
    """Parse and validate the schedule; a bad job is skipped, not fatal."""
    with open(path, "rb") as handle:
        config = tomllib.load(handle)
    entries = config.get("jobs")
    if not isinstance(entries, list):
        raise ValueError("Schedule file must contain a [[jobs]] array")
    jobs, seen = [], set()
    for index, entry in enumerate(entries):
        identity = entry.get("id") if isinstance(entry, dict) else None
        label = identity if isinstance(identity, str) and identity else f"jobs[{index}]"
        try:
            if not isinstance(entry, dict) or not isinstance(identity, str) or not identity:
                raise ValueError("Every job needs a string id")
            if identity in seen:
                raise ValueError("Duplicate job id")
            command = entry.get("command", "worker")
            if command not in KNOWN_COMMANDS:
                raise ValueError(f"Unknown command {command!r};"
                                 f" expected one of {', '.join(KNOWN_COMMANDS)}")
            models = entry.get("models", [])
            if not isinstance(models, list) or not all(isinstance(m, str) for m in models):
                raise ValueError("models must be a list of model ids")
            if command == "worker" and not models:
                raise ValueError("A worker job needs at least one model")
            unknown = [model for model in models if model not in MODELS]
            if unknown:
                raise ValueError(f"No importer for {', '.join(unknown)};"
                                 f" the registry has: {', '.join(MODELS)}")
            extra = entry.get("args", [])
            if not isinstance(extra, list) or not all(isinstance(a, str) for a in extra):
                raise ValueError("args must be a list of strings")
            timeout = entry.get("timeout_seconds")
            if timeout is not None and (not isinstance(timeout, int) or timeout <= 0):
                raise ValueError("timeout_seconds must be a positive integer")
            job = {"id": identity, "command": command, "models": models, "args": extra,
                   "hours": minute_list(entry.get("hours"), 24, list(range(24))),
                   "minutes": minute_list(entry.get("minutes"), 60, [0]),
                   "timeout_seconds": timeout,
                   "enabled": entry.get("enabled", True) is not False}
            for key in set(entry) - JOB_KEYS:
                log("schedule_warning", job=identity, warning=f"Ignoring unknown key {key!r}")
            seen.add(identity)
            jobs.append(job)
        except ValueError as error:
            log("schedule_rejected", job=label, error=str(error))
    if not jobs:
        raise ValueError(f"No usable jobs in {path}")
    return jobs


def next_due(job, after):
    """First scheduled minute strictly after `after`, in UTC."""
    moment = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(HORIZON_MINUTES):
        if moment.hour in job["hours"] and moment.minute in job["minutes"]:
            return moment
        moment += timedelta(minutes=1)
    return None


def command_for(job):
    script = str(Path(__file__).with_name(KNOWN_COMMANDS[job["command"]]))
    models = ["--models", *job["models"]] if job["models"] else []
    return [sys.executable, script, *models, *job["args"]]


def run_job(job):
    """Run one job to completion. Its own stdout/stderr stream between the log lines."""
    argv = command_for(job)
    started = time.monotonic()
    log("job_started", job=job["id"], command=argv[1:])
    try:
        code = subprocess.run(argv, timeout=job["timeout_seconds"], check=False).returncode
    except subprocess.TimeoutExpired:
        code = -1
        log("job_timeout", job=job["id"], seconds=job["timeout_seconds"])
    except OSError as error:
        code = -1
        log("job_failed", job=job["id"], error=str(error))
    log("job_finished", job=job["id"], exitCode=code, seconds=round(time.monotonic() - started))
    return code


def describe(jobs, now):
    lines = [f"{'job':<12} {'command':<8} {'models':<18} {'utc hours':<26} "
             f"{'minutes':<10} next (UTC)"]
    for job in jobs:
        due = next_due(job, now) if job["enabled"] else None
        hours = "every hour" if len(job["hours"]) == 24 else ",".join(map(str, job["hours"]))
        lines.append(f"{job['id']:<12} {job['command']:<8} "
                     f"{','.join(job['models']) or '-':<18} {hours:<26} "
                     f"{','.join(map(str, job['minutes'])):<10} "
                     f"{due.isoformat(timespec='minutes') if due else 'disabled'}")
    return "\n".join(lines)


def serve(jobs, sleep=time.sleep, now=lambda: datetime.now(timezone.utc), run=run_job):
    """Sleep until the earliest slot, then run the jobs that are due, in file order."""
    due = {job["id"]: next_due(job, now()) for job in jobs if job["enabled"]}
    due = {identity: slot for identity, slot in due.items() if slot}
    while due:
        delay = (min(due.values()) - now()).total_seconds()
        if delay > 0:
            sleep(min(delay, 60))
            continue
        for job in (job for job in jobs if due.get(job["id"]) and due[job["id"]] <= now()):
            missed = due[job["id"]]
            run(job)
            following = next_due(job, now())
            if following is None:
                del due[job["id"]]
                continue
            due[job["id"]] = following
            if (skipped := next_due(job, missed)) and skipped < following:
                log("job_slot_skipped", job=job["id"], reason="Previous job overran",
                    skipped=skipped.isoformat(timespec="minutes"))


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--jobs", default=os.environ.get("FORCE5_JOBS_FILE", DEFAULT_JOBS_FILE),
                        help="Editable TOML schedule (default %(default)s)")
    parser.add_argument("--list", action="store_true", help="Print the resolved schedule and exit")
    parser.add_argument("--once", action="store_true",
                        help="Run every enabled job immediately, then exit")
    parser.add_argument("--run-at-start", action="store_true",
                        default=os.environ.get("FORCE5_RUN_AT_START", "") not in ("", "0", "false"),
                        help="Also run every enabled job on startup")
    args = parser.parse_args(argv)
    try:
        jobs = load_jobs(args.jobs)
    except (OSError, ValueError, tomllib.TOMLDecodeError) as error:
        log("schedule_failed", file=args.jobs, error=str(error))
        return 1
    enabled = [job for job in jobs if job["enabled"]]
    if args.list:
        print(describe(jobs, datetime.now(timezone.utc)))
        return 0
    log("scheduler_started", jobs=[job["id"] for job in enabled],
        disabled=[job["id"] for job in jobs if not job["enabled"]], file=args.jobs)
    print(describe(jobs, datetime.now(timezone.utc)), flush=True)
    failures = 0
    if args.once or args.run_at_start:
        failures = sum(1 for job in enabled if run_job(job) != 0)
    if args.once:
        return 1 if failures else 0
    serve(jobs)
    log("scheduler_stopped", reason="No enabled job has a future slot")
    return 1


if __name__ == "__main__":
    sys.exit(main())
