"""The "F5 int16" binary wind frame: encode, decode, and publish with sidecars.

A wind frame used to be JSON: 55,000 doubles per field printed as text, 926 KB
for one HARMONIE step and 225 KB once gzipped. The same numbers as little-endian
int16 at 0.1 m/s, row-delta-encoded and brotli-compressed, are about 71 KB — and
the display rounds to whole knots, so nothing a reader can see is lost.

Layout of `frames/HHH.bin`, a 24-byte header then one block per variable:

    0   4  magic "F5F1"
    4   1  version (1)
    5   1  blockCount    (2 = u,v; 3 = u,v,gust)
    6   2  width         uint16
    8   2  height        uint16
    10  2  scale         uint16 (10 → values are tenths of a metre per second)
    12  2  hour          uint16 (forecast hour)
    14  4  run           uint32 (YYYYMMDDHH as a decimal number)
    18  6  reserved      (zero, and every reader refuses a frame that is not)
    24  …  u, v[, gust]: width × height int16 each, little-endian

The header length is even because the browser views the payload as an
`Int16Array` at that offset, and an odd offset throws. It carries only what makes
a frame from the wrong run or the wrong hour recognisable on its own; the grid
geometry, valid time, gust window and model stay in the manifest, which is where
they always were, and the run directory the frame sits in is named for the hash
of everything inside it (rundir.py), so every published object is still
immutable.

Two rules the encoder and both decoders (Python here, TypeScript in
`force5/src/f5bin.ts` and `scripts/f5bin.mjs`) must agree on exactly:

- **Rounding is half-away-from-zero**, written out as
  `floor(abs(x × 10) + 0.5) × sign(x × 10)`, not numpy's `round` (half to even)
  and not a language's own rounding. 0.05 m/s encodes to 1 and -0.05 m/s to -1
  on every side.
- **Delta arithmetic wraps in int16.** The encoder writes
  `(current - previous) mod 2¹⁶` and the decoder returns
  `(previous + delta) mod 2¹⁶`, both folded back into [-32768, 32767]. Wrapping
  is what lets the missing marker -32768 sit in the middle of a delta run
  without overflowing it, and it makes -32768 as a *delta* an ordinary value
  rather than a second marker.

Deltas run **along a row** (west to east), the axis that measured smallest over
the real HARMONIE, ICON-EU, ECMWF and GFS runs of 17 September 2026; see
docs/FORECAST_DATA_PLAN.md for the numbers.
"""
import os
from pathlib import Path
import struct

import numpy as np

import timing

MAGIC = b"F5F1"
VERSION = 1
HEADER_BYTES = 24
# The reserved bytes are read rather than skipped (`6s`, not `6x`), because a
# reader that ignores them cannot later be given a meaning for them: a file
# written by some future encoder would be accepted and silently misread. They
# must be zero today, so whatever fills them next is a change every reader
# notices. `RESERVED_BYTES` is what "unused" looks like on the wire.
HEADER_FORMAT = "<4sBBHHHHI6s"
RESERVED_BYTES = b"\0" * 6
SCALE = 10  # Stored values are tenths of a metre per second.
MISSING = -32768
ENCODING = "f5-int16-v1"  # What a manifest puts in its `encoding` field.
FIELDS = ("u", "v", "gust")
MAX_SPEED = 150.0  # The same range check the JSON frames have always had.
MAX_SCALED = int(MAX_SPEED * SCALE)
MAX_DIMENSION = 65535  # Width and height are uint16.
DEFAULT_BROTLI_QUALITY = 9
QUALITY_ENV = "FORCE5_BROTLI_QUALITY"
SIDECARS_ENV = "FORCE5_SIDECARS"
GZIP_LEVEL = 6
SIDECARS = (".br", ".gz")


def brotli_quality():
    """The compression level for every brotli body this pipeline writes.

    9 is the default because it costs about what writing the JSON frame it
    replaces cost (see docs/FORECAST_DATA_PLAN.md), which is what keeps ingest
    time inside its budget; 10 and 11 buy 9% and 12% more compression for four
    and eleven times the encode time. `FORCE5_BROTLI_QUALITY` raises it on a
    machine with time to spare, and is read here rather than at import so a typo
    is a sentence about the setting instead of a traceback out of every adapter.
    """
    value = os.environ.get(QUALITY_ENV)
    if value is None:
        return DEFAULT_BROTLI_QUALITY
    try:
        quality = int(value)
    except ValueError:
        raise ValueError(f"{QUALITY_ENV} must be a whole number 0-11, not {value!r}") from None
    if not 0 <= quality <= 11:
        raise ValueError(f"{QUALITY_ENV} must be 0-11, not {quality}")
    return quality


def sidecars_wanted():
    """Whether to write `.bin.br`/`.bin.gz` beside each frame. Default: yes.

    The sidecars are what the local Caddy deployment serves, so they are on by
    default. A job that only uploads to the bucket serves none of them — the
    bucket stores one encoding per object — and should set `FORCE5_SIDECARS=0`
    so it does not spend a brotli and a gzip per frame producing bytes nothing
    will ever read. The uploader then compresses once, at upload time.
    """
    value = (os.environ.get(SIDECARS_ENV) or "").strip().lower()
    if not value:  # Unset, or set to nothing, both mean the default.
        return True
    if value in ("0", "false", "no", "off"):
        return False
    if value in ("1", "true", "yes", "on"):
        return True
    raise ValueError(f"{SIDECARS_ENV} must be 0 or 1, not {value!r}")


def _fold(values):
    """Fold int32 arithmetic back into int16, the way the decoders do."""
    return ((values + 32768) & 0xFFFF) - 32768


def quantise(values, count, field):
    """One field as int16 tenths, with missing values marked rather than dropped."""
    array = np.asarray(values, dtype=np.float64)
    if array.shape != (count,):
        raise ValueError(f"{field} has {array.size} values, not {count}")
    scaled = array * SCALE
    present = np.isfinite(scaled)
    safe = np.where(present, scaled, 0.0)
    # Half away from zero, spelled out so numpy, JavaScript and the browser all
    # produce the same integer for a value that lands exactly on .5.
    rounded = np.floor(np.abs(safe) + 0.5) * np.sign(safe)
    if np.any(np.abs(rounded[present]) > MAX_SCALED):
        raise ValueError(f"Implausible {field} value beyond ±{MAX_SPEED} m/s")
    if field == "gust" and np.any(rounded[present] < 0):
        raise ValueError("Negative gust speed")
    out = np.full(count, MISSING, dtype=np.int16)
    out[present] = rounded[present].astype(np.int64).astype(np.int16)
    return out


def delta_encode(quantised, width, height):
    """Differences along each row, wrapping, with the first column left absolute."""
    rows = quantised.reshape(height, width)
    out = np.empty_like(rows)
    out[:, 0] = rows[:, 0]
    if width > 1:
        out[:, 1:] = _fold(rows[:, 1:].astype(np.int32) - rows[:, :-1].astype(np.int32))
    return out.reshape(-1)


def delta_decode(deltas, width, height):
    """The inverse: a running sum along each row, folded back into int16.

    Summing first and folding once is the same answer as folding at every step,
    because wrapping is modular arithmetic; int64 keeps the running sum exact.
    """
    running = np.cumsum(deltas.reshape(height, width).astype(np.int64), axis=1)
    return _fold(running).astype(np.int16).reshape(-1)


def encode_frame(payload):
    """One published wind frame's bytes, from the dict the adapters already build."""
    grid = payload["grid"]
    width, height = grid["width"], grid["height"]
    if not (2 <= width <= MAX_DIMENSION and 2 <= height <= MAX_DIMENSION):
        raise ValueError("Grid dimensions do not fit a binary frame header")
    count = width * height
    hour, run = payload["hour"], payload["run"]
    if not isinstance(hour, int) or not 0 <= hour <= 65535:
        raise ValueError("Forecast hour does not fit a binary frame header")
    if not (isinstance(run, str) and len(run) == 10 and run.isdigit()):
        raise ValueError("A binary frame header carries the run as YYYYMMDDHH")
    blocks = [payload[field] for field in FIELDS if payload.get(field) is not None]
    if len(blocks) not in (2, 3) or payload.get("u") is None or payload.get("v") is None:
        raise ValueError("A wind frame carries u and v, and gust or nothing")
    header = struct.pack(HEADER_FORMAT, MAGIC, VERSION, len(blocks), width, height,
                         SCALE, hour, int(run), RESERVED_BYTES)
    body = [delta_encode(quantise(values, count, field), width, height).astype("<i2").tobytes()
            for field, values in zip(FIELDS, blocks)]
    return header + b"".join(body)


def read_header(data):
    """Just the header, for a caller that wants the identity without the grids."""
    if len(data) < HEADER_BYTES:
        raise ValueError("Binary frame is shorter than its header")
    magic, version, blocks, width, height, scale, hour, run, reserved = struct.unpack(
        HEADER_FORMAT, data[:HEADER_BYTES])
    if magic != MAGIC:
        raise ValueError("Not an F5 binary frame")
    if version != VERSION:
        raise ValueError(f"Unsupported binary frame version {version}")
    if reserved != RESERVED_BYTES:
        raise ValueError("Binary frame header uses reserved bytes")
    if blocks not in (2, 3):
        raise ValueError("A wind frame carries u and v, and gust or nothing")
    if scale != SCALE:
        raise ValueError(f"Unsupported binary frame scale {scale}")
    if width < 2 or height < 2:
        raise ValueError("Invalid binary frame grid")
    return {"version": version, "blockCount": blocks, "width": width, "height": height,
            "scale": scale, "hour": hour, "run": f"{run:010d}"}


def decode_frame(data):
    """Header fields plus u/v/gust in metres per second; missing values are None.

    Truncated and oversized buffers are both refused: the block count and the
    grid in the header say exactly how many bytes must follow it.
    """
    header = read_header(data)
    count = header["width"] * header["height"]
    expected = HEADER_BYTES + header["blockCount"] * count * 2
    if len(data) != expected:
        raise ValueError(f"Binary frame is {len(data)} bytes, not the {expected} "
                         "its header describes")
    frame = dict(header, gust=None)
    for index, field in enumerate(FIELDS[:header["blockCount"]]):
        start = HEADER_BYTES + index * count * 2
        deltas = np.frombuffer(data, dtype="<i2", count=count,
                               offset=start).astype(np.int16)
        values = delta_decode(deltas, header["width"], header["height"])
        present = values != MISSING
        if np.any(np.abs(values[present]) > MAX_SCALED):
            raise ValueError(f"Implausible {field} value beyond ±{MAX_SPEED} m/s")
        if field == "gust" and np.any(values[present] < 0):
            raise ValueError("Negative gust speed")
        metres = (values.astype(np.float64) / SCALE).tolist()
        frame[field] = [None if flag else value
                        for value, flag in zip(metres, (~present).tolist())]
    return frame


def brotli_body(data, quality=None):
    import brotli
    return brotli.compress(data, quality=brotli_quality() if quality is None else quality)


def gzip_body(data):
    import gzip
    return gzip.compress(data, GZIP_LEVEL, mtime=0)


def compress(data, quality=None):
    """The two sidecar bodies, by suffix. Brotli is what a browser actually gets."""
    return {".br": brotli_body(data, quality), ".gz": gzip_body(data)}


def write_with_sidecars(path, data, quality=None, sidecars=None):
    """`name.bin`, and `name.bin.br`/`name.bin.gz` unless they are turned off.

    The sidecars are for the local Caddy deployment, which serves whichever of
    them the browser asked for (`file_server { precompressed br gzip }`). They
    are never uploaded as objects of their own: the bucket stores one encoding
    per object, chosen by `publish_s3.put_immutable` — which reuses the `.br`
    sidecar when one is here, rather than compressing the same bytes twice.

    Each file is replaced atomically, and the frame itself is written first, so
    a job killed part way leaves a readable frame with no sidecar rather than a
    sidecar that does not match the frame beside it. Caddy falls back to the
    plain file when a sidecar is absent, so that state serves correctly too.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    wanted = sidecars_wanted() if sidecars is None else sidecars
    bodies = {"": data, **(compress(data, quality) if wanted else {})}
    for suffix, body in bodies.items():
        target = Path(str(path) + suffix)
        temporary = target.with_name(target.name + ".tmp")
        temporary.write_bytes(body)
        os.replace(temporary, target)


def frame_name(prefix, hour):
    """Where a frame is written inside its run's staging directory (rundir.py).

    The name carries only the hour. The run directory is named for the hash of
    everything inside it once the run is complete, which is what makes each
    frame immutable and checkable; see rundir.py.
    """
    return f"{prefix}/frames/{hour:03d}.bin"


def publish_frame(output, prefix, payload):
    """Encode and write one wind frame. Returns its name under `output`.

    Every wind adapter calls this where it used to hash a JSON payload and call
    `write_json`, so the frame format lives in one place rather than ten.
    """
    with timing.phase("write"):
        data = encode_frame(payload)
        name = frame_name(prefix, payload["hour"])
        write_with_sidecars(Path(output) / name, data)
    return name
