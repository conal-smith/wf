"""Check a bucket holds everything a worker's local output says it published.

Run inside the worker image, beside the volume it published from, by
scripts/release/acceptance.sh:

    python verify_bucket.py --bucket B --prefix P --endpoint-url URL MODEL...

For each model: the pointer manifest is in the bucket at the registry's path and
names the same run as the local one, and every object it references is there.
This is what a visitor's browser will ask the data domain for, so a missing key
here is a blank map in production.
"""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, "/app/force5/ingest")

from prune import manifest_urls  # noqa: E402
from publish_s3 import make_client, object_prefix  # noqa: E402
from registry import MANIFESTS  # noqa: E402


def keys(s3, bucket, prefix):
    found = set()
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        found.update(item["Key"] for item in page.get("Contents", []))
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("models", nargs="+")
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--prefix", default="")
    parser.add_argument("--endpoint-url")
    parser.add_argument("--public", default="/data/public")
    args = parser.parse_args()

    s3 = make_client(args.endpoint_url, "us-east-1")
    prefix = object_prefix(args.prefix)
    stored = keys(s3, args.bucket, prefix)
    failed = False
    for model in args.models:
        pointer = MANIFESTS[model]
        local = json.loads((Path(args.public) / pointer).read_text())
        if prefix + pointer not in stored:
            print(f"FAIL {model}: {prefix + pointer} is not in the bucket")
            failed = True
            continue
        remote = json.loads(s3.get_object(Bucket=args.bucket, Key=prefix + pointer)["Body"].read())
        if remote.get("run") != local.get("run"):
            print(f"FAIL {model}: the bucket serves run {remote.get('run')}, the worker built {local.get('run')}")
            failed = True
        missing = sorted(url for url in manifest_urls(remote) if prefix + url not in stored)
        if missing:
            print(f"FAIL {model}: {len(missing)} referenced objects missing, e.g. {missing[:3]}")
            failed = True
        else:
            print(f"ok   {model}: run {remote.get('run')}, {len(manifest_urls(remote))} objects")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
