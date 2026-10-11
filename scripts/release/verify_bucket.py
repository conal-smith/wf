"""Check a bucket holds everything a worker's local output says it published.

Run inside the worker image, beside the volume it published from, by
scripts/release/acceptance.sh:

    python verify_bucket.py --bucket B --prefix P --endpoint-url URL MODEL...

For each model: the pointer manifest is in the bucket at the registry's path and
names the same run as the local one, and every object it references is there.
This is what a visitor's browser will ask the data domain for, so a missing key
here is a blank map in production.

A run pointer (schemaVersion 2, with a `base`) names its files by template, so
its objects are worked out as status.py works them out for a volume: every tile
its `tiles` block does not call absent at every hour, and every spot square it
lists (status.published_objects). Any other pointer — tides, sea temperature —
lists its files by `url`, and those are what is checked.
"""
import argparse
import json
from pathlib import Path
import sys

# In the worker image the ingest code is at /app, and the acceptance run mounts
# this script at the root (/verify_bucket.py), which has no parents to climb; in
# a checkout it is beside this, two levels up.
HERE = Path(__file__).resolve()
CHECKOUT = HERE.parents[2] / "force5" / "ingest" if len(HERE.parents) > 2 else None
for ingest in (Path("/app/force5/ingest"), CHECKOUT):
    if ingest is not None and ingest.is_dir():
        sys.path.insert(0, str(ingest))
        break

from publish_s3 import make_client, object_prefix  # noqa: E402
from registry import MANIFESTS  # noqa: E402
from status import published_objects  # noqa: E402


def keys(s3, bucket, prefix):
    found = set()
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        found.update(item["Key"] for item in page.get("Contents", []))
    return found


def check(s3, bucket, prefix, models, public):
    """One line per model, `ok   ...` or `FAIL ...`, and whether any failed."""
    prefix = object_prefix(prefix)
    stored = keys(s3, bucket, prefix)
    lines, failed = [], False
    for model in models:
        pointer = MANIFESTS[model]
        local = json.loads((Path(public) / pointer).read_text())
        if prefix + pointer not in stored:
            lines.append(f"FAIL {model}: {prefix + pointer} is not in the bucket")
            failed = True
            continue
        remote = json.loads(s3.get_object(Bucket=bucket, Key=prefix + pointer)["Body"].read())
        if remote.get("run") != local.get("run"):
            lines.append(f"FAIL {model}: the bucket serves run {remote.get('run')}, "
                         f"the worker built {local.get('run')}")
            failed = True
        try:
            expected = published_objects(remote, pointer)
        except (ValueError, KeyError, TypeError) as error:
            lines.append(f"FAIL {model}: the bucket's pointer names no usable objects: {error}")
            failed = True
            continue
        missing = sorted(url for url in expected if prefix + url not in stored)
        if missing:
            lines.append(f"FAIL {model}: {len(missing)} referenced objects missing, "
                         f"e.g. {missing[:3]}")
            failed = True
        else:
            lines.append(f"ok   {model}: run {remote.get('run')}, {len(expected)} objects")
    return lines, failed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("models", nargs="+")
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--prefix", default="")
    parser.add_argument("--endpoint-url")
    parser.add_argument("--public", default="/data/public")
    args = parser.parse_args()

    s3 = make_client(args.endpoint_url, "us-east-1")
    lines, failed = check(s3, args.bucket, args.prefix, args.models, args.public)
    print("\n".join(lines))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
