"""One-shot forecast job: ingest, validate, optionally publish to S3, then exit."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import fcntl
import os
from pathlib import Path
import subprocess
import sys
import time

from publish_s3 import publish, validate_bundle
from registry import MODELS

# Adapters that read ECMWF's open data and so take a mirror rather than a step.
ECMWF_MODELS = ("ecmwf", "ecmwf-ens", "aifs", "ecmwf-wave")


@contextmanager
def workspace_lock(root):
    directory = root / ".cache"
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "worker.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", choices=list(MODELS), default=["harmonie"])
    parser.add_argument("--step", type=int, choices=[1, 3], default=1,
                        help="HARMONIE/ICON cadence; ECMWF always uses native 3/6-hour steps")
    parser.add_argument("--run", help="Optional available run; normally discover automatically")
    parser.add_argument("--ecmwf-source", choices=["aws", "ecmwf", "google"],
                        default=os.environ.get("ECMWF_SOURCE", "aws"), help="Official ECMWF public mirror")
    parser.add_argument("--bucket", default=os.environ.get("S3_BUCKET"), help="Omit for local-only output")
    parser.add_argument("--prefix", default=os.environ.get("S3_PREFIX", ""))
    parser.add_argument("--publish-only", action="store_true", help="Validate and publish existing local output")
    parser.add_argument("--max-age-hours", type=float,
                        help="Default: the registry limit per model (12 regional, 24 ECMWF, 30 tides, 48 observations)")
    parser.add_argument("--timeout-seconds", type=int, default=2700)
    args = parser.parse_args()
    if (args.max_age_hours is not None and args.max_age_hours <= 0) or args.timeout_seconds <= 0:
        parser.error("Age limit and timeout must be positive")
    root = Path(os.environ.get("FORCE5_WORK_DIR", str(Path(__file__).resolve().parents[2])))
    s3 = None
    if args.bucket:
        import boto3
        from botocore.config import Config
        s3 = boto3.client("s3", config=Config(retries={"mode": "standard", "max_attempts": 5},
                                            connect_timeout=15, read_timeout=90))
    try:
        with workspace_lock(root):
            return run_models(args, root, s3)
    except BlockingIOError:
        print('{"event":"forecast_failed","error":"Workspace is already in use"}', file=sys.stderr)
        return 1


def run_models(args, root, s3):
    failures = 0
    for model in dict.fromkeys(args.models):
        started = time.monotonic()
        try:
            if not args.publish_only:
                command = [sys.executable, str(Path(__file__).with_name(MODELS[model]["script"]))]
                if model in ECMWF_MODELS:
                    command += ["--source", args.ecmwf_source]
                elif MODELS[model]["kind"] == "wind" and MODELS[model].get("workerStep", True):
                    command += ["--step", str(args.step)]
                if args.run and MODELS[model]["kind"] == "wind":
                    command += ["--run", args.run]
                subprocess.run(command, check=True, timeout=args.timeout_seconds)
            max_age = args.max_age_hours if args.max_age_hours is not None else MODELS[model]["maxAgeHours"]
            manifest, _, objects = validate_bundle(root / "public", model, max_age)
            status = publish(s3, root / "public", model, args.bucket, args.prefix, max_age) if s3 else "local-only"
            print(json.dumps({"event": "forecast_complete", "model": model,
                              "kind": MODELS[model]["kind"], "run": manifest["run"],
                              "objects": len(objects), "frames": len(manifest.get("frames", [])),
                              "status": status,
                              "seconds": round(time.monotonic() - started),
                              "time": datetime.now(timezone.utc).isoformat()}), flush=True)
        except Exception as error:
            failures += 1
            print(json.dumps({"event": "forecast_failed", "model": model, "error": str(error)}), file=sys.stderr, flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
