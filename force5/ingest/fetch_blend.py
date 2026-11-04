#!/usr/bin/env python3
"""Work out the blend every riding place's stars are rated from (src/spotBlend.ts).

Not an importer: it reads what the wind importers have already published and
writes a run of its own for the worker to validate and publish like any other:
the pointer weather/blend.json, and beside it a run directory named for its
content holding each riding place's blend in its 2° spot square,
`blend-<run>-<hours>h-v2-<hash>/spots/<square>.json` (docs/TILING_DESIGN.md,
decision 6). The arithmetic and the writing are the site's own, in TypeScript,
run by Node (force5/blend/build.ts, through scripts/runs.mjs); this only gathers
its inputs, hands it the spot catalogue that places each spot in its square, and
starts it.

With a bucket the inputs are the wind pointers the bucket serves right now, and
every spot square of the runs they name, read into a scratch directory laid out
as the site is, so that a persistent work directory's own manifests are never
overwritten. Without one they are the manifests already under public/. Either
way the blend reads the squares through the site's own loader
(force5/src/spotData.ts).

Today's earlier hours are kept from the blend this one replaces (the ruling of
25 October 2026, src/spotBlend.ts `carryToday`): with a bucket, the blend it
serves, read with its squares into the scratch directory's `previous/`; without
one, the blend already under public/.
"""
import argparse
from datetime import datetime, timezone
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from fetch_forecast import PROJECT_ROOT, ROOT, spots_file
from prune import read_object
from publish_s3 import make_client, object_prefix, read_current
from registry import MANIFESTS, MODELS
from squares import SCHEMA_VERSION, square_index, square_path
import timing

# The bundle force5/Dockerfile builds; in a checkout the source runs through tsx.
BUNDLE = Path(__file__).resolve().parents[1] / "blend" / "dist" / "blend.mjs"
SOURCE = PROJECT_ROOT / "force5" / "blend" / "build.ts"


def wind_models():
    return [model for model, entry in MODELS.items() if entry["kind"] == "wind"]


def read_bucket(s3, bucket, prefix, directory, models=None, now=None):
    """Copy every wind pointer the bucket serves, and its squares, into `directory`.

    Returns the models found. The squares go first and the pointer last, so a
    pointer in the scratch directory always has the squares it names beside it.
    `models` reads others instead (the wave blend's, fetch_wave_blend.py).

    A model with no pointer is skipped, and so is one whose pointer is not a
    run pointer (an old version 1 pointer from before an upgrade, until that
    model's next run replaces it), named in the log: one model's stale pointer
    must not stop every other model's blend. force5/blend/build.ts leaves out
    the same pointers (force5/blend/inputs.ts). With `now`, so is a run older
    than its model's `maxAgeHours`, before any of its squares are read: a
    retired model's last pointer, left in the bucket, costs one small read.
    """
    found = []
    prefix = object_prefix(prefix)
    for model in (wind_models() if models is None else models):
        manifest, _ = read_current(s3, bucket, prefix + MANIFESTS[model])
        if manifest is None:
            continue
        try:
            version = manifest.get("schemaVersion") if isinstance(manifest, dict) else None
            if version != SCHEMA_VERSION:
                raise ValueError(f"Not a run pointer (schemaVersion {version!r})")
            if now is not None and too_old(manifest, MODELS[model]["maxAgeHours"], now):
                raise ValueError(f"Run {manifest.get('run')!r} is past its "
                                 f"{MODELS[model]['maxAgeHours']} h limit")
            relatives = [square_path(manifest, square)
                         for square in square_index(manifest)["squares"]]
        except ValueError as error:
            print(json.dumps({"event": "blend_input_refused", "model": model,
                              "error": str(error)}), flush=True)
            continue
        path = directory / MANIFESTS[model]
        for relative in relatives:
            target = path.parent / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            published = f"{Path(MANIFESTS[model]).parent.as_posix()}/{relative}"
            target.write_bytes(read_object(s3, bucket, prefix + published))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(manifest, separators=(",", ":")))
        found.append(model)
    return found


def too_old(manifest, hours, now):
    """Whether a pointer's run began more than `hours` before `now`."""
    try:
        run = datetime.strptime(str(manifest.get("run")), "%Y%m%d%H").replace(tzinfo=timezone.utc)
    except ValueError as error:
        raise ValueError(f"Not a run: {manifest.get('run')!r}") from error
    return (now - run).total_seconds() / 3600 > hours


# Where the blend the bucket serves is read to, apart from the wind pointers so
# nothing takes it for an input: the blend this run replaces, which today's
# earlier hours are kept from (src/spotBlend.ts `carryToday`).
PREVIOUS = "previous"


def read_previous_blend(s3, bucket, prefix, directory):
    """Copy the blend the bucket serves, and its squares, under `directory`/previous.

    Returns the path of its pointer there, or None: when the bucket serves none,
    or it cannot be read whole, this blend starts today afresh, named in the log,
    and still publishes. Squares first and the pointer last, as for the models.
    """
    prefix = object_prefix(prefix)
    try:
        manifest, _ = read_current(s3, bucket, prefix + MANIFESTS["blend"])
        if manifest is None:
            return None
        if not isinstance(manifest, dict) or manifest.get("schemaVersion") != SCHEMA_VERSION:
            raise ValueError("Not a run pointer")
        relatives = [square_path(manifest, square)
                     for square in square_index(manifest)["squares"]]
        path = directory / PREVIOUS / MANIFESTS["blend"]
        for relative in relatives:
            target = path.parent / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            published = f"{Path(MANIFESTS['blend']).parent.as_posix()}/{relative}"
            target.write_bytes(read_object(s3, bucket, prefix + published))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(manifest, separators=(",", ":")))
        return path
    except Exception as error:  # Never fatal: the blend is still worth publishing.
        print(json.dumps({"event": "blend_previous_unread", "error": str(error)}), flush=True)
        return None


def builder(bundle=BUNDLE, source=SOURCE):
    if bundle.exists():
        return [shutil.which("node") or "node", str(bundle)]
    if source.exists():
        return ["npx", "--no-install", "tsx", str(source)]
    raise RuntimeError(f"Neither the bundle {bundle.name} nor its source is here")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--bucket", help="Read the wind manifests the bucket serves")
    parser.add_argument("--prefix", default="")
    parser.add_argument("--endpoint-url")
    parser.add_argument("--region")
    args = parser.parse_args()
    out = ROOT / "public" / MANIFESTS["blend"]
    out.parent.mkdir(parents=True, exist_ok=True)
    # The same catalogue the models were split by, so each place lands in the
    # square the browser computes from its own copy of it.
    catalogue = ["--spots", str(spots_file())]
    if not args.bucket:
        timing.start("decode")
        subprocess.run([*builder(), "--root", str(ROOT / "public"), "--out", str(out),
                        *catalogue], check=True, cwd=PROJECT_ROOT)
        return
    s3 = make_client(args.endpoint_url, args.region)
    with tempfile.TemporaryDirectory(prefix="blend-") as scratch:
        timing.start("download")
        found = read_bucket(s3, args.bucket, args.prefix, Path(scratch))
        if not found:
            raise RuntimeError("The bucket serves no wind manifests: nothing to blend")
        print(f"Blending what the bucket serves: {', '.join(found)}", flush=True)
        # Always named, even where there is none: the bucket's blend is the one
        # this replaces, never whatever a persistent work directory last wrote.
        previous = (read_previous_blend(s3, args.bucket, args.prefix, Path(scratch))
                    or Path(scratch) / PREVIOUS / MANIFESTS["blend"])
        timing.start("decode")
        subprocess.run([*builder(), "--root", scratch, "--out", str(out), *catalogue,
                        "--previous", str(previous)],
                       check=True, cwd=PROJECT_ROOT)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Blend failed: {error}. Last published blend preserved.", file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
