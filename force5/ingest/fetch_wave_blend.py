#!/usr/bin/env python3
"""Work out the wave blend: every riding place's sea state from every wave model.

The wave counterpart of fetch_blend.py, and like it not an importer: it reads
what the wave importers have already published and writes a run of its own for
the worker to validate and publish, the pointer weather/wave-blend.json and
beside it a run directory named for its content holding each riding place's
sea state in its 2° spot square,
`wave-blend-<run>-<hours>h-v2-<hash>/spots/<square>.json`. The arithmetic and
the writing are the site's own, in TypeScript (force5/src/waveBlend.ts, run by
force5/blend/waves.ts); this gathers its inputs and starts it.

With a bucket the inputs are the wave pointers the bucket serves right now,
each with every spot square of its run, read into a scratch directory laid out
as the site is. A pointer past its model's `maxAgeHours` is left out before its
squares are read: a retired model's last run, still in the bucket, is no
member. Without a bucket they are the manifests already under public/. Which
of them the blend reads, and in what order their partitions lead, is
`WAVE_BLEND_MODELS` in force5/src/waveBlend.ts.
"""
import argparse
from datetime import datetime, timezone
import subprocess
import sys
import tempfile
from pathlib import Path

from fetch_blend import builder, read_bucket
from fetch_forecast import PROJECT_ROOT, ROOT, spots_file
from publish_s3 import make_client
from registry import MANIFESTS, MODELS
import timing

BUNDLE = Path(__file__).resolve().parents[1] / "blend" / "dist" / "wave-blend.mjs"
SOURCE = PROJECT_ROOT / "force5" / "blend" / "waves.ts"


def wave_models():
    return [model for model, entry in MODELS.items() if entry["kind"] == "wave"]


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--bucket", help="Read the wave manifests the bucket serves")
    parser.add_argument("--prefix", default="")
    parser.add_argument("--endpoint-url")
    parser.add_argument("--region")
    args = parser.parse_args()
    out = ROOT / "public" / MANIFESTS["wave-blend"]
    out.parent.mkdir(parents=True, exist_ok=True)
    catalogue = ["--spots", str(spots_file())]
    command = builder(BUNDLE, SOURCE)
    if not args.bucket:
        timing.start("decode")
        subprocess.run([*command, "--root", str(ROOT / "public"), "--out", str(out),
                        *catalogue], check=True, cwd=PROJECT_ROOT)
        return
    s3 = make_client(args.endpoint_url, args.region)
    with tempfile.TemporaryDirectory(prefix="wave-blend-") as scratch:
        timing.start("download")
        found = read_bucket(s3, args.bucket, args.prefix, Path(scratch), models=wave_models(),
                            now=datetime.now(timezone.utc))
        if not found:
            raise RuntimeError("The bucket serves no current wave manifests: nothing to blend")
        print(f"Blending the waves the bucket serves: {', '.join(found)}", flush=True)
        timing.start("decode")
        subprocess.run([*command, "--root", scratch, "--out", str(out), *catalogue],
                       check=True, cwd=PROJECT_ROOT)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Wave blend failed: {error}. Last published wave blend preserved.",
              file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
