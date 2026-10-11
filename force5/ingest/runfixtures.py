"""Test support: publish a hand-built manifest as an adapter would.

Test suites build whole manifests in the shape adapters hold them in memory —
every per-spot key inline, frame urls naming files on disk — and need them
published as schemaVersion 2 runs (rundir.py) before the validator, the pruner
or a reader will look at them. `publish_whole` copies the frames those urls
name into a staging directory and calls `rundir.write_run`, so the run
directory, its hash and its spot squares are made by the production code
rather than by a second copy of it here. The frames stay where the test wrote
them, so a test can spoil one and publish again.
"""
import json
from pathlib import Path
import shutil

import rundir

CATALOGUE = Path(__file__).resolve().parents[2] / "public" / "riding-locations.json"


def catalogue():
    """The committed riding locations: the coordinates most suites' spot ids have."""
    return json.loads(CATALOGUE.read_text())


def publish_whole(weather, pointer_name, manifest, spots=None, prefix=None):
    """Publish `manifest` under `weather/` and return the pointer written.

    Frame urls are read relative to the directory above `weather` (`weather/…`,
    as adapters write them). `spots` defaults to the committed catalogue.
    """
    weather = Path(weather)
    prefix = prefix or f"{manifest['model']}-{manifest['run']}-test-v1"
    staging = weather / prefix
    shutil.rmtree(staging, ignore_errors=True)
    frames = []
    for info in manifest.get("frames") or []:
        source = weather.parent / info["url"]
        name = rundir.frame_name(prefix, info["hour"], source.suffix[1:] or "json")
        (weather / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, weather / name)
        frames.append({**info, "url": f"{weather.name}/{name}"})
    return rundir.write_run(weather, pointer_name, {**manifest, "frames": frames}, prefix,
                            catalogue() if spots is None else spots)


def read_whole(pointer):
    """A published pointer with its spot squares merged back in, from its path on disk."""
    from squares import with_spot_data
    pointer = Path(pointer)
    return with_spot_data(json.loads(pointer.read_text()),
                          lambda relative: json.loads((pointer.parent / relative).read_text()))


def frame_path(pointer, index):
    """Where frame `index` of the run a pointer on disk names is published."""
    pointer = Path(pointer)
    manifest = json.loads(pointer.read_text())
    return pointer.parent / manifest["base"] / manifest["frames"][index]["url"]
