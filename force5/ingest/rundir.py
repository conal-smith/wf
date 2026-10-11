"""Run directories: every published run in one directory named for its content.

    weather/harmonie.json                               the pointer, a few KB
    weather/harmonie-2026101106-61h-v2-1a2b3c4d/frames/000.bin
    weather/harmonie-2026101106-61h-v2-1a2b3c4d/spots/n52w010.json

The directory name is the adapter's own prefix (`<model>-<run>-<hours>h-v<N>`)
and the first 8 hex digits of a sha256 over everything inside it: the sorted
lines `<relative path> <sha256 of the file's bytes>\\n`, sidecars left out. So a
run republished with the same content lands in the same directory, changed
content lands in a new one, and nothing inside a directory is ever rewritten.
Files inside need no hash of their own: `frames/<HHH>.bin`, or `.json` for a
wave or weather frame, and `spots/<square>.json` (squares.py).
scripts/sample-weather.mjs writes the same names and the same hash.

Adapters write their frames into `<prefix>/` as they go (`frame_name`,
`f5bin.publish_frame`) and finish with one call, `write_run`, instead of writing
the pointer themselves. It moves the spot data into squares, removes anything
the run does not reference, hashes the directory, renames it and only then
writes the pointer, so an interrupted import leaves at most an unreferenced
staging directory for the pruner. `rewrite_run` is the same for a run that is
already published and whose spot data has been recomputed (backfill_spots.py).
"""
import hashlib
import json
import os
from pathlib import Path
import shutil

import f5bin
from squares import RUN_DIRECTORY, SQUARE_URL, check_base, run_path, split_spot_data
import timing

HASH_LENGTH = 8
FRAMES = "frames"
SPOTS = "spots"
# Compressed copies of a file for the local Caddy deployment: not content, never hashed.
SIDECAR_SUFFIXES = f5bin.SIDECARS


def frame_name(prefix, hour, suffix="bin"):
    """Where a frame is written inside a run's staging directory."""
    return f"{prefix}/{FRAMES}/{hour:03d}.{suffix}"


def json_body(value):
    """The bytes a JSON file of a run holds: compact, and refusing NaN."""
    return json.dumps(value, separators=(",", ":"), allow_nan=False).encode()


def is_sidecar(name):
    return name.endswith(SIDECAR_SUFFIXES)


def content_files(directory):
    """{relative path: bytes} for every file in a run directory but the sidecars."""
    directory = Path(directory)
    files = {}
    for base, _, names in os.walk(directory):
        for name in names:
            if is_sidecar(name):
                continue
            path = Path(base, name)
            files[path.relative_to(directory).as_posix()] = path.read_bytes()
    return files


def digest(files):
    """The directory's content hash, from {relative path: bytes}."""
    lines = "".join(f"{path} {hashlib.sha256(files[path]).hexdigest()}\n"
                    for path in sorted(files))
    return hashlib.sha256(lines.encode()).hexdigest()[:HASH_LENGTH]


def directory_name(prefix, files):
    name = f"{prefix}-{digest(files)}"
    if not RUN_DIRECTORY.fullmatch(name):
        raise ValueError(f"Unusable run directory name {name!r}")
    return name


def hash_of(base):
    """The content hash a run directory's name claims."""
    return check_base(base)[:-1].rsplit("-", 1)[1]


def write_file(path, body):
    """One file of the run, atomically, with the sidecars Caddy serves."""
    f5bin.write_with_sidecars(path, body)


def write_json(path, value):
    """The pointer: replaced atomically, the only mutable file of a run."""
    with timing.phase("write"):
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_bytes(json_body(value))
        os.replace(temporary, path)


def write_run(output, pointer_name, manifest, prefix, spots):
    """Finish a run the adapter has written into `output/prefix/`; returns the pointer.

    `manifest` is the whole manifest as adapters have always built it, frame
    urls and all (`weather/<prefix>/frames/000.bin`), with every per-spot key
    inline. `spots` are the catalogue entries the adapter sampled, which give
    each spot its square. The pointer written is schemaVersion 2: frame urls
    relative to `base`, the spot data replaced by its square index.
    """
    output = Path(output)
    staging = output / prefix
    owner = f"{output.name}/{prefix}/"
    frames = []
    for frame in manifest.get("frames") or []:
        url = str(frame.get("url", ""))
        if not url.startswith(owner):
            raise ValueError(f"Frame {url!r} is not inside the run directory {owner}")
        relative = url[len(owner):]
        run_path(f"{prefix}-00000000/", relative)  # The same path rules a reader applies.
        frames.append({**frame, "url": relative})
    pointer, squares = split_spot_data(manifest, spots)
    pointer["frames"] = frames
    with timing.phase("write"):
        staging.mkdir(parents=True, exist_ok=True)
        shutil.rmtree(staging / SPOTS, ignore_errors=True)
        for square, document in squares.items():
            write_file(staging / SQUARE_URL.replace("{square}", square), json_body(document))
        wanted = {frame["url"] for frame in frames} | {
            SQUARE_URL.replace("{square}", square) for square in squares}
        _keep_only(staging, wanted)
        files = content_files(staging)
        if set(files) != wanted:
            missing = sorted(wanted - set(files))
            raise ValueError(f"Run directory {staging} is missing {missing[:3]}")
        name = directory_name(prefix, files)
        final = output / name
        if final.is_dir():
            # The same content, published before: keep that one and drop the copy.
            # A directory whose files no longer hash to its name is replaced.
            if digest(content_files(final)) == hash_of(name + "/") \
                    and set(content_files(final)) == wanted:
                shutil.rmtree(staging)
            else:
                shutil.rmtree(final)
                os.replace(staging, final)
        else:
            os.replace(staging, final)
    pointer["base"] = f"{name}/"
    write_json(output / pointer_name, pointer)
    return pointer


def _keep_only(directory, wanted):
    """Delete anything in a staging directory the run does not reference.

    A staging directory survives an interrupted import, so it can hold a frame
    for an hour this run does not publish; left there it would change the hash
    and be uploaded with a run that never mentions it.
    """
    if not directory.is_dir():
        return
    for base, _, names in os.walk(directory):
        for name in names:
            path = Path(base, name)
            relative = path.relative_to(directory).as_posix()
            plain = relative
            for suffix in SIDECAR_SUFFIXES:
                if plain.endswith(suffix):
                    plain = plain[:-len(suffix)]
                    break
            if plain not in wanted:
                path.unlink()
    for base, names, _ in os.walk(directory, topdown=False):
        for name in names:
            try:
                Path(base, name).rmdir()
            except OSError:
                pass  # Still holds files the run references.


def staging_prefix(base):
    """The adapter prefix a run directory was named from: its name without the hash."""
    return check_base(base)[:-1].rsplit("-", 1)[0]


def rewrite_run(output, pointer_name, manifest, spots):
    """Publish an already published run again with new spot data; returns the pointer.

    `manifest` is the current pointer with its spot data merged in and changed.
    The frames are hard-linked (or copied) from the run directory it names into
    a fresh staging directory and `write_run` does the rest, so the new run
    directory is named for its new content and the old one is left whole for the
    pruner: a reader holding the old pointer can still read everything it names.
    """
    output = Path(output)
    base = check_base(manifest["base"])
    source = output / base[:-1]
    prefix = staging_prefix(base)
    staging = output / prefix
    shutil.rmtree(staging, ignore_errors=True)
    frames = []
    for frame in manifest.get("frames") or []:
        relative = frame["url"]
        run_path(base, relative)
        for suffix in ("",) + SIDECAR_SUFFIXES:
            origin = source / (relative + suffix)
            if not origin.is_file():
                continue
            target = staging / (relative + suffix)
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.link(origin, target)
            except OSError:
                shutil.copy2(origin, target)
        frames.append({**frame, "url": f"{output.name}/{prefix}/{relative}"})
    whole = {key: value for key, value in manifest.items() if key not in ("base", "spots")}
    whole["frames"] = frames
    return write_run(output, pointer_name, whole, prefix, spots)
