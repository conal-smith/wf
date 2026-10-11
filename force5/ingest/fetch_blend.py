#!/usr/bin/env python3
"""Work out the blend every riding place's stars are rated from (src/spotBlend.ts).

Not an importer: it reads what the wind importers have already published and
writes one file, weather/blend.json, for the worker to validate and publish like
any other bundle. The arithmetic is the site's own, in TypeScript, run by Node
(force5/blend/build.ts); this only gathers its inputs and starts it.

With a bucket the inputs are the wind pointers the bucket serves right now, and
every spot square of the runs they name, read into a scratch directory laid out
as the site is, so that a persistent work directory's own manifests are never
overwritten. Without one they are the manifests already under public/. Either
way the blend reads the squares through the site's own loader
(force5/src/spotData.ts).
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from fetch_forecast import PROJECT_ROOT, ROOT
from prune import read_object
from publish_s3 import make_client, object_prefix, read_current
from registry import MANIFESTS, MODELS
from squares import square_index, square_path
import timing

# The bundle force5/Dockerfile builds; in a checkout the source runs through tsx.
BUNDLE = Path(__file__).resolve().parents[1] / "blend" / "dist" / "blend.mjs"
SOURCE = PROJECT_ROOT / "force5" / "blend" / "build.ts"


def wind_models():
    return [model for model, entry in MODELS.items() if entry["kind"] == "wind"]


def read_bucket(s3, bucket, prefix, directory):
    """Copy every wind pointer the bucket serves, and its squares, into `directory`.

    Returns the models found. The squares go first and the pointer last, so a
    pointer in the scratch directory always has the squares it names beside it.
    """
    found = []
    prefix = object_prefix(prefix)
    for model in wind_models():
        manifest, _ = read_current(s3, bucket, prefix + MANIFESTS[model])
        if manifest is None:
            continue
        path = directory / MANIFESTS[model]
        for square in square_index(manifest)["squares"]:
            relative = square_path(manifest, square)
            target = path.parent / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            published = f"{Path(MANIFESTS[model]).parent.as_posix()}/{relative}"
            target.write_bytes(read_object(s3, bucket, prefix + published))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(manifest, separators=(",", ":")))
        found.append(model)
    return found


def builder():
    if BUNDLE.exists():
        return [shutil.which("node") or "node", str(BUNDLE)]
    if SOURCE.exists():
        return ["npx", "--no-install", "tsx", str(SOURCE)]
    raise RuntimeError("Neither the blend bundle nor its source is here")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--bucket", help="Read the wind manifests the bucket serves")
    parser.add_argument("--prefix", default="")
    parser.add_argument("--endpoint-url")
    parser.add_argument("--region")
    args = parser.parse_args()
    out = ROOT / "public" / MANIFESTS["blend"]
    out.parent.mkdir(parents=True, exist_ok=True)
    if not args.bucket:
        timing.start("decode")
        subprocess.run([*builder(), "--root", str(ROOT / "public"), "--out", str(out)],
                       check=True, cwd=PROJECT_ROOT)
        return
    s3 = make_client(args.endpoint_url, args.region)
    with tempfile.TemporaryDirectory(prefix="blend-") as scratch:
        timing.start("download")
        found = read_bucket(s3, args.bucket, args.prefix, Path(scratch))
        if not found:
            raise RuntimeError("The bucket serves no wind manifests: nothing to blend")
        print(f"Blending what the bucket serves: {', '.join(found)}", flush=True)
        timing.start("decode")
        subprocess.run([*builder(), "--root", scratch, "--out", str(out)],
                       check=True, cwd=PROJECT_ROOT)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Blend failed: {error}. Last published blend preserved.", file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
