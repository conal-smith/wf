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
import os
from pathlib import Path
import shutil
import tempfile
from unittest.mock import patch

import f5bin
import rundir

CATALOGUE = Path(__file__).resolve().parents[2] / "public" / "riding-locations.json"
# Two cells by two on the tile lattice (f5tile.lattice_origin): the smallest grid
# a wind run can publish, as tiles, in the suites' hand-built manifests.
TINY_GRID = {"west": -11.0, "east": -10.5, "north": 56.0, "south": 55.6,
             "dx": 0.5, "dy": 0.4, "width": 2, "height": 2}


def catalogue():
    """The committed riding locations: the coordinates most suites' spot ids have."""
    return json.loads(CATALOGUE.read_text())


def use_catalogue(test, spots):
    """Have the publisher place spots by a test's own catalogue, for the rest of the test.

    The publisher checks every spot a square holds against the catalogue the
    adapters sample (squares.catalogue_file, `FORCE5_SPOTS_FILE`), so a suite
    that published with spots of its own validates with them too. `spots` is
    the catalogue file, or the list of places to write to one.
    """
    if not isinstance(spots, (str, Path)):
        directory = tempfile.TemporaryDirectory()
        test.addCleanup(directory.cleanup)
        path = Path(directory.name) / "spots.json"
        path.write_text(json.dumps(spots))
        spots = path
    patcher = patch.dict(os.environ, {"FORCE5_SPOTS_FILE": str(spots)})
    patcher.start()
    test.addCleanup(patcher.stop)


def publish_whole(weather, pointer_name, manifest, spots=None, prefix=None):
    """Publish `manifest` under `weather/` and return the pointer written.

    Frame urls are read relative to the directory above `weather` (`weather/…`,
    as adapters write them). `spots` defaults to the committed catalogue.
    """
    weather = Path(weather)
    prefix = prefix or f"{manifest['model']}-{manifest['run']}-test-v1"
    staging = weather / prefix
    shutil.rmtree(staging, ignore_errors=True)
    wind = manifest.get("kind", "wind") == "wind"
    frames = []
    for info in manifest.get("frames") or []:
        source = weather.parent / info["url"]
        if wind:
            # A wind frame is published as its tiles, from the grids in the file.
            f5bin.publish_frame(weather, prefix, wind_payload(source, manifest, info))
            frames.append({key: value for key, value in info.items() if key != "url"})
            continue
        name = rundir.frame_name(prefix, info["hour"], source.suffix[1:] or "json")
        (weather / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, weather / name)
        frames.append({**info, "url": f"{weather.name}/{name}"})
    whole = {key: value for key, value in manifest.items() if key != "encoding"}
    return rundir.write_run(weather, pointer_name, {**whole, "frames": frames}, prefix,
                            catalogue() if spots is None else spots)


def wind_payload(source, manifest, info):
    """A wind frame's grids from a test's frame file: JSON, or a whole F5 frame.

    The tiles are written for the hour the manifest lists the file at, and for
    the run the file names (the manifest's when it names none), so a test can
    still publish a frame list with an invented hour, or tiles of another run.
    """
    data = Path(source).read_bytes()
    if data[:4] == f5bin.MAGIC:
        frame = f5bin.decode_frame(data)
    else:
        frame = json.loads(data)
    return {"run": frame.get("run", manifest["run"]), "hour": info["hour"],
            "grid": manifest["grid"], "u": frame["u"], "v": frame["v"],
            "gust": frame.get("gust")}


def read_whole(pointer):
    """A published pointer with its spot squares merged back in, from its path on disk."""
    from squares import with_spot_data
    pointer = Path(pointer)
    return with_spot_data(json.loads(pointer.read_text()),
                          lambda relative: json.loads((pointer.parent / relative).read_text()))


def published_frame(weather, manifest, index):
    """Frame `index` of a published wind run, read back whole from its native tiles.

    `weather` is the directory holding the pointer and its run directory. The
    shape `f5bin.decode_frame` returns, which the adapter suites assert on.
    """
    import f5tile
    info = manifest["frames"][index]
    directory = Path(weather) / manifest["base"]
    frame = f5tile.FrameTiles(manifest, info, lambda relative: (directory / relative).read_bytes())
    values = frame.native()
    headers = {f5tile.read_tile_header((directory / path).read_bytes())["run"]
               for path, (level, _, _, entry) in f5tile.run_tiles(manifest).items()
               if level == 0 and entry is info}
    return {"run": headers.pop() if len(headers) == 1 else None, "hour": info["hour"],
            "width": manifest["grid"]["width"], "height": manifest["grid"]["height"],
            "blockCount": 3 if values["gust"] is not None else 2, **values}


def frame_path(pointer, index):
    """Where frame `index` of the run a pointer on disk names is published."""
    pointer = Path(pointer)
    manifest = json.loads(pointer.read_text())
    return pointer.parent / manifest["base"] / manifest["frames"][index]["url"]
