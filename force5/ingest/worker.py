"""One-shot forecast job: ingest, validate, optionally publish to a bucket, then exit.

The bucket is AWS S3 or any S3-compatible store; `--endpoint-url` points it at
Cloudflare R2 instead. Credentials come from the standard environment chain and
are never read or logged here. Run as a batch container with an empty disk, the
bucket is also the only record of what has already been imported, so for each
adapter that declares `readsPublishedRun` the current manifest is read first and
its run passed on: if that is the run the adapter resolves, it exits
UNCHANGED_EXIT, this job logs `forecast_unchanged` and stops there having
downloaded nothing. That exit code is only read as success for an adapter we
actually told, so it can never launder an ordinary failure into a clean run.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

from prune import prune_published
from publish_s3 import make_client, object_prefix, publish, read_current, validate_bundle
from registry import MANIFESTS, MODELS, PUBLISHED_RUN_ENV, UNCHANGED_EXIT
from workspace import workspace_lock

# Adapters that read ECMWF's open data and so take a mirror rather than a step.
ECMWF_MODELS = ("ecmwf", "ecmwf-ens", "aifs", "ecmwf-wave")


def drop_superseded(public):
    """Delete every run no manifest points at, now that the new one is published.

    Only the newest run of a model is ever served, so the one it replaced is
    junk the moment the new manifest is in place. This runs under the workspace
    lock, so no other import can be half-way through writing a run directory.
    A failure here is logged and never fails the forecast that just landed.
    """
    try:
        return len(prune_published(public, 0)["removed"])
    except (OSError, ValueError) as error:
        print(json.dumps({"event": "prune_failed", "error": str(error)}), file=sys.stderr, flush=True)
        return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", choices=list(MODELS), default=["harmonie"])
    parser.add_argument("--step", type=int, choices=[1, 3], default=1,
                        help="HARMONIE/ICON cadence; ECMWF always uses native 3/6-hour steps")
    parser.add_argument("--run", help="Optional available run; normally discover automatically")
    parser.add_argument("--ecmwf-source", choices=["aws", "ecmwf", "google"],
                        default=os.environ.get("ECMWF_SOURCE", "ecmwf"),
                        help="ECMWF-hosted by default; the AWS mirror throttles with 503 SlowDown")
    parser.add_argument("--bucket", default=os.environ.get("S3_BUCKET"), help="Omit for local-only output")
    parser.add_argument("--prefix", default=os.environ.get("S3_PREFIX", ""))
    parser.add_argument("--endpoint-url", default=os.environ.get("S3_ENDPOINT_URL"),
                        help="S3-compatible endpoint (Cloudflare R2); omit for AWS S3")
    parser.add_argument("--region", default=os.environ.get("AWS_REGION"),
                        help="Defaults to 'auto' when an endpoint URL is given, as R2 wants")
    parser.add_argument("--publish-only", action="store_true", help="Validate and publish existing local output")
    parser.add_argument("--max-age-hours", type=float,
                        help="Default: the registry limit per model (12 regional, 24 ECMWF, 30 tides, 48 observations)")
    parser.add_argument("--timeout-seconds", type=int, default=2700)
    args = parser.parse_args()
    if (args.max_age_hours is not None and args.max_age_hours <= 0) or args.timeout_seconds <= 0:
        parser.error("Age limit and timeout must be positive")
    root = Path(os.environ.get("FORCE5_WORK_DIR", str(Path(__file__).resolve().parents[2])))
    s3 = make_client(args.endpoint_url, args.region) if args.bucket else None
    try:
        with workspace_lock(root):
            return run_models(args, root, s3)
    except BlockingIOError:
        print('{"event":"forecast_failed","error":"Workspace is already in use"}', file=sys.stderr)
        return 1


def drop_downloads(root, model):
    """Delete the model's raw downloads: a published run never reads them again.

    They are whole-domain source files, gigabytes for an ensemble, and keeping
    them only saved a re-download after a failure. A failed job downloads afresh.
    """
    cache = MODELS[model].get("cache")
    if cache:
        shutil.rmtree(root / ".cache" / cache, ignore_errors=True)


def published_run(s3, bucket, prefix, model):
    """The run the bucket serves for this model right now, or None.

    A one-shot container starts on an empty disk, so the bucket is the only record
    of what has already been imported. Every forecast adapter is scheduled at least
    sometimes before its source has a newer run (ECMWF hourly against a twice-daily
    run, a fallback to the previous cycle that is still the published one), so they
    read this and download nothing when it matches. Not knowing is never fatal:
    the adapter then does what it always did and simply fetches the run.
    """
    if not s3:
        return None
    try:
        current, _ = read_current(s3, bucket, object_prefix(prefix) + MANIFESTS[model])
    except Exception as error:
        print(json.dumps({"event": "published_run_unknown", "model": model,
                          "error": str(error)}), file=sys.stderr, flush=True)
        return None
    return (current or {}).get("run")


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
                # The blend, the archive and the verification read what the bucket
                # serves, so they are told where that is; the credentials stay in the
                # environment they inherit.
                if MODELS[model].get("readsBucket") and args.bucket:
                    command += ["--bucket", args.bucket, "--prefix", args.prefix]
                    if args.endpoint_url:
                        command += ["--endpoint-url", args.endpoint_url]
                    if args.region:
                        command += ["--region", args.region]
                environment = dict(os.environ)
                environment.pop(PUBLISHED_RUN_ENV, None)  # Never inherited; we set it or nobody does.
                current = (published_run(s3, args.bucket, args.prefix, model)
                           if MODELS[model].get("readsPublishedRun") else None)
                if current:
                    environment[PUBLISHED_RUN_ENV] = current
                code = subprocess.run(command, timeout=args.timeout_seconds, check=False,
                                      env=environment).returncode
                # UNCHANGED_EXIT only means "nothing new" if we actually told this
                # adapter what the bucket serves. From any other adapter, or when the
                # pointer could not be read, exit 3 is just a nonzero exit status.
                if code == UNCHANGED_EXIT and current:
                    print(json.dumps({"event": "forecast_unchanged", "model": model,
                                      "run": current, "seconds": round(time.monotonic() - started),
                                      "time": datetime.now(timezone.utc).isoformat()}), flush=True)
                    continue
                if code:
                    raise subprocess.CalledProcessError(code, command)
            max_age = args.max_age_hours if args.max_age_hours is not None else MODELS[model]["maxAgeHours"]
            manifest, _, objects = validate_bundle(root / "public", model, max_age)
            status = publish(s3, root / "public", model, args.bucket, args.prefix, max_age) if s3 else "local-only"
            pruned = drop_superseded(root / "public")
            print(json.dumps({"event": "forecast_complete", "model": model,
                              "kind": MODELS[model]["kind"], "run": manifest["run"],
                              "objects": len(objects), "frames": len(manifest.get("frames", [])),
                              "status": status, "pruned": pruned,
                              "seconds": round(time.monotonic() - started),
                              "time": datetime.now(timezone.utc).isoformat()}), flush=True)
        except Exception as error:
            failures += 1
            print(json.dumps({"event": "forecast_failed", "model": model, "error": str(error)}), file=sys.stderr, flush=True)
        finally:
            drop_downloads(root, model)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
