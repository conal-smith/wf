"""Tiled wind frames ("F5T1"): one frame cut into fixed tiles on a global lattice.

A whole-frame `F5F1` file covers a model's whole box, so a phone looking at one
bay downloads the country. This module cuts the same int16 numbers into tiles of
`TILE_SIZE` × `TILE_SIZE` cells, adds overview levels averaged 2×2 at a time
until one tile holds the whole domain, and writes each tile as its own small
file. docs/TILING_DESIGN.md (decisions 1-3 and 7) is the why; this is the how.

**The lattice.** Every tile is anchored to a global origin, never to our crop
box, so growing a domain only adds tiles. Global column c sits at longitude
-180 + c·dx and global row r at latitude 90 - r·dy, the grid's own points. A
grid is accepted only when its west and north edges are whole numbers of cells
from that origin (`lattice_origin`).

**The levels.** Level k has cells of dx·2^k by dy·2^k. Level-k cell (C, R)
covers the native cells [C·2^k, (C+1)·2^k) × [R·2^k, (R+1)·2^k), and tile
(x, y) at level k owns the level-k cells [x·size, (x+1)·size) × [y·size,
(y+1)·size). Levels run from 0 (native) until the domain fits one tile.

**An overview cell** is the mean of the non-missing native cells of the domain
inside its block, field by field, so u and v together are a vector mean. It is
computed from exact integer sums of the *stored* tenths, so the answer is the
same whatever order the levels are built in, and is exactly what averaging the
published level-0 tiles would give. Overviews are for drawing only: spot series,
the dock and the blend always read the native grid.

Layout of `t/{level}/{x}/{y}/{hour:03d}.bin`, a 24-byte header then one block per
variable:

    0   4  magic "F5T1"
    4   1  version    u8 (1)
    5   1  blockCount u8 (2 = u,v; 3 = u,v,gust)
    6   1  level      u8
    7   1  border     u8 (1)
    8   2  size       uint16 (owned cells per side; stored side = size + 2·border)
    10  2  scale      uint16 (10 → tenths of a metre per second)
    12  2  hour       uint16 (forecast hour)
    14  4  run        uint32 (YYYYMMDDHH as a decimal number)
    18  2  x          uint16 (tile column on the global lattice at this level)
    20  2  y          uint16 (tile row)
    22  2  reserved   (zero, and every reader refuses a tile that is not)
    24  …  u, v[, gust]: side × side int16 each, little-endian

Each block holds level-k global columns [x·size - border, (x+1)·size + border)
and rows likewise, north to south, each row west to east, delta-encoded along
the row exactly as `f5bin` does: same rounding, same int16 wrap, same missing
marker. The border repeats the neighbouring tiles' edge cells, so a bilinear
sample anywhere in a tile's owned area needs no other tile. A cell outside the
domain is missing. Longitude wraps only for a global grid (width·dx = 360°). A grid
reaching -90° keeps that row, in every level. A grid running past 180° — a
global one that repeats its first column there, width·dx = 360° + dx, or a
regional one crossing the date line — is refused rather than cut twice over.

**A tile that is not there is all missing.** `levels` gives each level's x and
y as the bounding ranges of the domain, but a tile inside those ranges whose
owned cells are all missing (all land, say) need not be written. A run decides
that once for all its hours (`rundir.write_run`) and lists such tiles in its
manifest as `absent` (`manifest_tiles`, below); every other tile in the ranges
exists for every hour, so a reader never asks for an absent tile and treats a
missing file that is not listed as the error it is.

The browser's reader and the same lattice arithmetic are in
`force5/src/f5tile.ts`; tests/fixtures/f5tile holds the golden pyramids both
suites decode.
"""
import hashlib
import math
from pathlib import Path
import struct

import numpy as np

import f5bin
from f5bin import MAX_SCALED, MAX_SPEED, MISSING, SCALE

MAGIC = b"F5T1"
VERSION = 1
HEADER_BYTES = 24
# Reserved bytes are read, not skipped, for the reason f5bin gives for its own.
HEADER_FORMAT = "<4sBBBBHHHIHH2s"
RESERVED_BYTES = b"\0" * 2
ENCODING = "f5-tile-v1"  # What a manifest puts in `tiles.encoding`.
FIELDS = f5bin.FIELDS
TILE_SIZE = 128
BORDER = 1
MAX_LEVELS = 15
# How far, in cells, a grid's edge may sit from the lattice and still be on it.
# Edges are decimals like -10.9 that binary floating point cannot hold exactly.
LATTICE_TOLERANCE = 1e-6
TILE_PATH = "t/{level}/{x}/{y}/{hour:03d}.bin"
# The same path as a manifest's `tiles.url` spells it: `{hour}` is the forecast
# hour zero-padded to three digits, as in TILE_PATH.
TILE_URL = "t/{level}/{x}/{y}/{hour}.bin"
TILES_DIRECTORY = "t"


def lattice_origin(grid):
    """The grid's first column and row on the global lattice, or a ValueError.

    A grid whose west or north edge is not a whole number of cells from -180°
    and 90° would need its values resampled to fit any tile, and tiles carry the
    model's own numbers, so such a grid is refused rather than shifted.
    """
    dx, dy = grid["dx"], grid["dy"]
    if not (dx > 0 and dy > 0):
        raise ValueError("Grid spacing must be positive")
    columns = (grid["west"] + 180) / dx
    rows = (90 - grid["north"]) / dy
    column, row = round(columns), round(rows)
    if abs(columns - column) > LATTICE_TOLERANCE or abs(rows - row) > LATTICE_TOLERANCE:
        raise ValueError(f"Grid at west {grid['west']}, north {grid['north']} is not on the "
                         f"global {dx} × {dy} lattice")
    if column < 0 or row < 0:
        raise ValueError("Grid starts west of -180° or north of 90°")
    # Beyond the circle the lattice's columns would name cells a second time:
    # a global grid that repeats its first column at 180° (width·dx = 360 + dx)
    # would be cut as a regional one, the copy in a tile past the date line, and
    # a regional grid running past 180° likewise. Neither is supported; say so
    # rather than tile it wrongly. A global grid is width·dx = 360 exactly.
    circle = 360 / dx
    if "width" in grid and (column if around(grid) is None else 0) \
            + grid["width"] > circle + LATTICE_TOLERANCE:
        raise ValueError("Grid runs past 180° of longitude: a global grid must not repeat "
                         "its first column at 180°, and a regional one must not cross it")
    if "height" in grid and row + grid["height"] - 1 > 180 / dy + LATTICE_TOLERANCE:
        raise ValueError("Grid runs south of -90°")
    return column, row


def around(grid):
    """Native columns around the globe when the grid is global, else None.

    Only a grid that is a whole circle of longitude wraps; a regional grid's
    cells beyond its edges are simply missing.
    """
    circle = 360 / grid["dx"]
    if abs(grid["width"] - circle) > LATTICE_TOLERANCE:
        return None
    return grid["width"]


def _columns_at(native, level):
    """Level-k columns around the globe: ceil(native / 2^k), the last maybe partial.

    Not round(360 / dx_k): when 360/dx is not a multiple of 2^k the last block
    is part-filled, and rounding would drop or invent a column.
    """
    return -(-native >> level)


def levels(grid, size=TILE_SIZE):
    """Every level of the pyramid: cell size, domain cells and tile ranges.

    Each entry is `{"level", "dx", "dy", "columns", "rows", "x", "y"}`, the last
    four as inclusive [first, last] pairs. `columns` and `rows` are the level's
    global cells that hold any of the domain; `x` and `y` are the tiles that own
    them, which is what a manifest's `tiles.levels` publishes. A tile inside
    these ranges can still be absent, when every cell it owns is missing.

    Levels stop at the first that fits one tile, or at `MAX_LEVELS`.
    """
    if size < 1:
        raise ValueError("Tile size must be positive")
    column0, row0 = lattice_origin(grid)
    native = around(grid)
    out = []
    for level in range(MAX_LEVELS):
        if native:
            columns = [0, _columns_at(native, level) - 1]
        else:
            columns = [column0 >> level, (column0 + grid["width"] - 1) >> level]
        rows = [row0 >> level, (row0 + grid["height"] - 1) >> level]
        x = [columns[0] // size, columns[1] // size]
        y = [rows[0] // size, rows[1] // size]
        out.append({"level": level, "dx": grid["dx"] * 2 ** level,
                    "dy": grid["dy"] * 2 ** level, "columns": columns, "rows": rows,
                    "x": x, "y": y})
        if x[0] == x[1] and y[0] == y[1]:
            break
    return out


def tile_path(level, x, y, hour):
    """A tile's path under its run directory; the hour is zero-padded like frames."""
    return TILE_PATH.format(level=level, x=x, y=y, hour=hour)


def _check_identity(level, x, y, hour, run, size, border):
    if not (isinstance(level, int) and 0 <= level <= 255):
        raise ValueError("Tile level does not fit a tile header")
    if not (isinstance(x, int) and isinstance(y, int) and 0 <= x <= 65535 and 0 <= y <= 65535):
        raise ValueError("Tile position does not fit a tile header")
    if not (isinstance(hour, int) and 0 <= hour <= 65535):
        raise ValueError("Forecast hour does not fit a tile header")
    if not (isinstance(run, str) and len(run) == 10 and run.isdigit()):
        raise ValueError("A tile header carries the run as YYYYMMDDHH")
    if not (isinstance(border, int) and 0 <= border <= 255):
        raise ValueError("Tile border does not fit a tile header")
    if not (isinstance(size, int) and 1 <= size <= 65535 and size + 2 * border >= 2):
        raise ValueError("Tile size does not fit a tile header")


def _encode_quantised(level, x, y, hour, run, blocks, size, border):
    """A tile's bytes from its blocks already in int16 tenths, missing marked."""
    _check_identity(level, x, y, hour, run, size, border)
    if len(blocks) not in (2, 3):
        raise ValueError("A wind tile carries u and v, and gust or nothing")
    side = size + 2 * border
    header = struct.pack(HEADER_FORMAT, MAGIC, VERSION, len(blocks), level, border, size,
                         SCALE, hour, int(run), x, y, RESERVED_BYTES)
    body = [f5bin.delta_encode(np.asarray(block, dtype=np.int16).reshape(-1), side, side)
            .astype("<i2").tobytes() for block in blocks]
    return header + b"".join(body)


def encode_tile(level, x, y, hour, run, u, v, gust=None, size=TILE_SIZE, border=BORDER):
    """One tile's bytes from its stored cells in m/s; None or NaN is missing.

    `u`, `v` and `gust` each hold (size + 2·border)² values, rows north to
    south, each row west to east, border included. The range checks and the
    rounding are f5bin's own.
    """
    if u is None or v is None:
        raise ValueError("A wind tile carries u and v, and gust or nothing")
    side = size + 2 * border
    fields = [("u", u), ("v", v)] + ([("gust", gust)] if gust is not None else [])
    blocks = [f5bin.quantise([np.nan if value is None else value for value in values],
                             side * side, field) for field, values in fields]
    return _encode_quantised(level, x, y, hour, run, blocks, size, border)


def read_tile_header(data):
    """Just the header, for a caller that wants the identity without the cells."""
    if len(data) < HEADER_BYTES:
        raise ValueError("Tile is shorter than its header")
    (magic, version, blocks, level, border, size, scale, hour, run, x, y,
     reserved) = struct.unpack(HEADER_FORMAT, data[:HEADER_BYTES])
    if magic != MAGIC:
        raise ValueError("Not an F5 tile")
    if version != VERSION:
        raise ValueError(f"Unsupported tile version {version}")
    if reserved != RESERVED_BYTES:
        raise ValueError("Tile header uses reserved bytes")
    if blocks not in (2, 3):
        raise ValueError("A wind tile carries u and v, and gust or nothing")
    if scale != SCALE:
        raise ValueError(f"Unsupported tile scale {scale}")
    if size < 1 or size + 2 * border < 2:
        raise ValueError("Invalid tile size")
    return {"version": version, "blockCount": blocks, "level": level, "border": border,
            "size": size, "scale": scale, "hour": hour, "run": f"{run:010d}", "x": x, "y": y}


def _decode_quantised(data):
    """Header and int16 blocks, refusing what decode_frame refuses."""
    header = read_tile_header(data)
    side = header["size"] + 2 * header["border"]
    count = side * side
    expected = HEADER_BYTES + header["blockCount"] * count * 2
    if len(data) != expected:
        raise ValueError(f"Tile is {len(data)} bytes, not the {expected} its header describes")
    blocks = []
    for index, field in enumerate(FIELDS[:header["blockCount"]]):
        deltas = np.frombuffer(data, dtype="<i2", count=count,
                               offset=HEADER_BYTES + index * count * 2).astype(np.int16)
        values = f5bin.delta_decode(deltas, side, side)
        present = values != MISSING
        if np.any(np.abs(values[present]) > MAX_SCALED):
            raise ValueError(f"Implausible {field} value beyond ±{MAX_SPEED} m/s")
        if field == "gust" and np.any(values[present] < 0):
            raise ValueError("Negative gust speed")
        blocks.append(values)
    return header, blocks


def decode_tile(data):
    """Header fields plus u/v/gust in metres per second; missing values are None.

    The same shape `f5bin.decode_frame` returns, with the stored side length as
    `side`: each list holds side × side values, border included.
    """
    header, blocks = _decode_quantised(data)
    tile = dict(header, side=header["size"] + 2 * header["border"], gust=None)
    for field, values in zip(FIELDS, blocks):
        metres = (values.astype(np.float64) / SCALE).tolist()
        tile[field] = [None if flag else value
                       for value, flag in zip(metres, (values == MISSING).tolist())]
    return tile


def _native(grid, values, field, native):
    """Level 0 as (sums, counts) over the level's global cells, int64.

    A global grid is rolled so that its array index is the global column.
    """
    width, height = grid["width"], grid["height"]
    stored = f5bin.quantise(values, width * height, field).reshape(height, width)
    present = stored != MISSING
    sums = np.where(present, stored, 0).astype(np.int64)
    counts = present.astype(np.int64)
    if native:
        shift = lattice_origin(grid)[0] % native
        sums, counts = np.roll(sums, shift, axis=1), np.roll(counts, shift, axis=1)
    return sums, counts


def _halve(sums, counts, first_column, first_row):
    """The next level up: 2×2 block sums, aligned to the global lattice.

    `first_column`/`first_row` are the global indices of the array's first
    cell. An odd one means that cell is the second half of its block, so the
    block's first half is padded with an empty cell; a ragged far edge likewise.
    Integer sums make the result independent of the order levels are built in.
    """
    left, top = first_column % 2, first_row % 2
    right = (left + sums.shape[1]) % 2
    bottom = (top + sums.shape[0]) % 2
    pad = ((top, bottom), (left, right))
    sums, counts = np.pad(sums, pad), np.pad(counts, pad)
    rows, columns = sums.shape[0] // 2, sums.shape[1] // 2
    return (sums.reshape(rows, 2, columns, 2).sum(axis=(1, 3)),
            counts.reshape(rows, 2, columns, 2).sum(axis=(1, 3)))


def _mean(sums, counts):
    """Each block's mean in tenths, rounded half away from zero like quantise.

    Done in integers, `sign(s) · floor((2|s| + n) / 2n)`, so no float rounding
    can make two builds of the same field differ.
    """
    present = counts > 0
    safe = np.where(present, counts, 1)
    rounded = np.sign(sums) * ((2 * np.abs(sums) + safe) // (2 * safe))
    return np.where(present, rounded, MISSING).astype(np.int16)


def _pyramid_blocks(grid, fields, spec):
    """For each level, each field's int16 array over that level's domain cells."""
    native = around(grid)
    state = [_native(grid, values, name, native) for name, values in fields]
    out = []
    for index, level in enumerate(spec):
        if index:
            previous = spec[index - 1]
            state = [_halve(sums, counts, previous["columns"][0], previous["rows"][0])
                     for sums, counts in state]
        out.append([_mean(sums, counts) for sums, counts in state])
    return out


def _cut(array, level_spec, x, y, size, border, wrap):
    """One tile's stored cells from a level's array; outside the domain is missing."""
    side = size + 2 * border
    columns = np.arange(x * size - border, x * size - border + side)
    rows = np.arange(y * size - border, y * size - border + side)
    if wrap:
        columns = columns % wrap
    column_index = columns - level_spec["columns"][0]
    row_index = rows - level_spec["rows"][0]
    column_ok = (column_index >= 0) & (column_index < array.shape[1])
    # Rows never wrap: there is nothing north of 90° or south of -90°, and the
    # level's rows end at the grid's last, so the row at -90° itself is kept.
    row_ok = (row_index >= 0) & (row_index < array.shape[0])
    out = np.full((side, side), MISSING, dtype=np.int16)
    out[np.ix_(row_ok, column_ok)] = array[np.ix_(row_index[row_ok], column_index[column_ok])]
    return out


def build_pyramid(grid, u, v, gust, hour, run, size=TILE_SIZE, border=BORDER,
                  keep_empty=False):
    """Every tile of every level, as `(levels(grid, size), [(level, x, y, bytes), …])`.

    `u`, `v` and `gust` (or None) are the frame's fields in m/s, as an adapter
    already holds them: width × height values, north to south, west to east,
    None or NaN where missing. A tile whose owned cells are all missing is left
    out; the levels still give the bounding ranges, so a reader treats a tile
    that is absent inside them as all missing.

    `keep_empty` keeps those tiles too. A run publishes a tile for every hour or
    for none (`run_tiles`), so the adapters write them all and the run decides,
    once it has every hour, which tiles are missing in all of them.
    """
    _check_identity(0, 0, 0, hour, run, size, border)
    if u is None or v is None:
        raise ValueError("A wind frame carries u and v, and gust or nothing")
    spec = levels(grid, size)
    fields = [("u", u), ("v", v)] + ([("gust", gust)] if gust is not None else [])
    fields = [(name, [np.nan if value is None else value for value in values])
              for name, values in fields]
    native = around(grid)
    tiles = []
    for level_spec, blocks in zip(spec, _pyramid_blocks(grid, fields, spec)):
        level = level_spec["level"]
        wrap = _columns_at(native, level) if native else None
        for y in range(level_spec["y"][0], level_spec["y"][1] + 1):
            for x in range(level_spec["x"][0], level_spec["x"][1] + 1):
                cut = [_cut(block, level_spec, x, y, size, border, wrap) for block in blocks]
                owned = slice(border, border + size)
                if not keep_empty and all(np.all(block[owned, owned] == MISSING)
                                          for block in cut):
                    continue
                tiles.append((level, x, y, _encode_quantised(level, x, y, hour, run, cut,
                                                             size, border)))
    return spec, tiles


def write_pyramid(output_dir, grid, u, v, gust, hour, run, size=TILE_SIZE, border=BORDER,
                  quality=None, sidecars=None, keep_empty=False):
    """Write every tile under `output_dir` as `t/{level}/{x}/{y}/{hour:03d}.bin`.

    Each file gets f5bin's brotli and gzip sidecars, unless they are turned off
    the same way. Returns `(levels, {relative path: sha256 hex})` so a manifest
    can be written from the one and the bucket's collision check fed from the
    other.
    """
    spec, tiles = build_pyramid(grid, u, v, gust, hour, run, size, border, keep_empty)
    written = {}
    for level, x, y, data in tiles:
        path = tile_path(level, x, y, hour)
        f5bin.write_with_sidecars(Path(output_dir) / path, data, quality, sidecars)
        written[path] = hashlib.sha256(data).hexdigest()
    return spec, written


def position(grid, level, lat, lon):
    """The level-k cell a bilinear sample at (lat, lon) starts from, and its weights.

    Returns `(column, row, tx, ty)`: the global level-k column and row of the
    sample's north-west corner, which the other three corners are east and south
    of, or None outside the level's domain. The tile that owns that corner holds
    all four, thanks to its border, so this also says which tile to read.

    At level 0 this is `sample()` in force5/src/weather.ts to the bit: the same
    `(lon - west) / dx`, the same clamp at the east and south edges. At level k
    a cell's value sits at the centre of the native points it averages, half of
    2^k - 1 native cells east and south of its first one, so the overview field
    is not shifted. Its edge cells are part-filled blocks and the sampleable
    area ends at their centres, which can leave a strip under one level-k cell
    wide along an edge that only finer levels cover.
    """
    if not (math.isfinite(lat) and math.isfinite(lon)):
        return None
    column0, row0 = lattice_origin(grid)
    scale = 1 << level
    shift = (scale - 1) / 2
    x = (lon - grid["west"]) / grid["dx"]
    y = (grid["north"] - lat) / grid["dy"]
    first_row, last_row = row0 >> level, (row0 + grid["height"] - 1) >> level
    y = (y + (row0 - first_row * scale) - shift) / scale
    if not (0 <= y <= last_row - first_row) or last_row == first_row:
        return None
    row = min(math.floor(y), last_row - first_row - 1)
    ty = y - row
    native = around(grid)
    if native:
        wrap = _columns_at(native, level)
        x = ((x + column0) % native - shift) / scale
        column = math.floor(x)
        return column % wrap, first_row + row, x - column, ty
    first_column, last_column = column0 >> level, (column0 + grid["width"] - 1) >> level
    x = (x + (column0 - first_column * scale) - shift) / scale
    if not (0 <= x <= last_column - first_column) or last_column == first_column:
        return None
    column = min(math.floor(x), last_column - first_column - 1)
    return first_column + column, first_row + row, x - column, ty


def tile_of(grid, level, lat, lon, size=TILE_SIZE):
    """The tile (x, y) to sample (lat, lon) from at this level, or None outside it."""
    at = position(grid, level, lat, lon)
    return None if at is None else (at[0] // size, at[1] // size)


def sample(tile_lookup, grid, level, lat, lon, size=TILE_SIZE):
    """Bilinear u/v/gust at (lat, lon) from one tile, or None.

    `tile_lookup(level, x, y)` returns a `decode_tile` dict, or None for a tile
    that was not written, which reads as all missing. The result is
    `{"u", "v", "gust"}` like weather.ts's `Wind`, and None when the point is
    outside the level or any of the four u or v corners is missing. `gust` is
    None when the tile has no gust block or a gust corner is missing.

    At level 0 the numbers are the whole-frame sampler's exactly
    (`archive_forecasts.sample_point` and weather.ts's `sample`), tile edges
    included, because the corner, the weights and the arithmetic are the same.
    """
    at = position(grid, level, lat, lon)
    if at is None:
        return None
    column, row, tx, ty = at
    tile = tile_lookup(level, column // size, row // size)
    if tile is None:
        return None
    border, side = tile["border"], tile["side"]
    if border < 1:  # The east and south corners come from the border.
        raise ValueError("A tile without a border cannot be sampled on its own")
    if (tile["level"], tile["x"], tile["y"], tile["size"]) != (level, column // size,
                                                               row // size, size):
        raise ValueError("Tile lookup returned another tile")
    i = (row - (tile["y"] * size - border)) * side + column - (tile["x"] * size - border)

    def bilinear(values):
        cells = (values[i], values[i + 1], values[i + side], values[i + side + 1])
        if any(cell is None for cell in cells):
            return None
        return ((cells[0] * (1 - tx) + cells[1] * tx) * (1 - ty)
                + (cells[2] * (1 - tx) + cells[3] * tx) * ty)

    u, v = bilinear(tile["u"]), bilinear(tile["v"])
    if u is None or v is None:
        return None
    return {"u": u, "v": v, "gust": None if tile["gust"] is None else bilinear(tile["gust"])}


# --- a run's tiles, as its manifest describes them ---------------------------------
#
# A wind run publishes, for every frame hour, every tile of every level inside the
# ranges `levels` gives, except the tiles listed `absent`: those whose owned cells
# are missing in *every* hour. Absence is per run, not per hour, so a reader never
# has to guess whether a 404 means "all land" or "broken": a tile the manifest
# does not list as absent exists for every hour, and one it lists never does.
#
#     "tiles": {"size": 128, "border": 1, "encoding": "f5-tile-v1",
#               "blocks": ["u", "v", "gust"], "url": "t/{level}/{x}/{y}/{hour}.bin",
#               "levels": [{"level": 0, "dx": 0.025, "dy": 0.02, "x": [52, 54],
#                           "y": [13, 15], "absent": [[52, 13]]}, …]}
#
# `blocks` names the most a tile carries. A frame whose `gustIntervalHours` is
# null (no gust at that hour, as at +0h of an interval gust) has u and v only.
# A level's dx and dy are the grid's times 2^level, which is exact in binary
# floating point, so both languages compare them exactly.

TILE_KEYS = ("size", "border", "encoding", "blocks", "url", "levels")
LEVEL_KEYS = ("level", "dx", "dy", "x", "y", "absent")


def tile_blocks(frames):
    """The blocks a run's tiles carry: gust too when any frame has a gust window."""
    gust = any(frame.get("gustIntervalHours") is not None for frame in frames)
    return list(FIELDS if gust else FIELDS[:2])


def frame_blocks(info):
    """How many blocks one frame's tiles carry: three when it has a gust window."""
    return 3 if info.get("gustIntervalHours") is not None else 2


def manifest_tiles(grid, frames, absent=None, size=TILE_SIZE, border=BORDER):
    """A manifest's `tiles` block. `absent` is {level: [(x, y), …]} of skipped tiles."""
    absent = absent or {}
    return {"size": size, "border": border, "encoding": ENCODING,
            "blocks": tile_blocks(frames), "url": TILE_URL,
            "levels": [{"level": spec["level"], "dx": spec["dx"], "dy": spec["dy"],
                        "x": list(spec["x"]), "y": list(spec["y"]),
                        "absent": [list(pair) for pair in sorted(
                            {tuple(pair) for pair in absent.get(spec["level"], ())})]}
                       for spec in levels(grid, size)]}


def _whole(value):
    return isinstance(value, int) and not isinstance(value, bool)


def check_tiles(manifest):
    """A wind manifest's `tiles` block, checked against its grid and frames.

    The grid must sit on the lattice; the levels must be exactly the ones
    `levels(grid, size)` gives, with each level's cell size; `absent` may only
    name tiles inside its level's ranges, once each, in order; `blocks` must say
    gust exactly when some frame has a gust window. Returns the block.
    """
    tiles, grid = manifest.get("tiles"), manifest.get("grid")
    if not isinstance(tiles, dict) or set(tiles) != set(TILE_KEYS):
        raise ValueError(f"A tiled run needs a tiles block of {', '.join(TILE_KEYS)}")
    if not isinstance(grid, dict):
        raise ValueError("A tiled run needs a grid")
    lattice_origin(grid)
    size, border = tiles["size"], tiles["border"]
    if not (_whole(size) and 1 <= size <= 65535):
        raise ValueError("Invalid tile size")
    if not (_whole(border) and 1 <= border <= 255):
        raise ValueError("A tile needs a border of at least one cell to be sampled")
    if tiles["encoding"] != ENCODING:
        raise ValueError(f"Unknown tile encoding {tiles['encoding']!r}")
    if tiles["url"] != TILE_URL:
        raise ValueError(f"Tiles are published at {TILE_URL}, not {tiles['url']!r}")
    if tiles["blocks"] != tile_blocks(manifest.get("frames") or []):
        raise ValueError("Tile blocks do not match the published gust periods")
    expected = levels(grid, size)
    published = tiles["levels"]
    if not isinstance(published, list) or len(published) != len(expected):
        raise ValueError("Tile levels do not match the grid")
    for entry, spec in zip(published, expected):
        if not isinstance(entry, dict) or set(entry) != set(LEVEL_KEYS):
            raise ValueError(f"A tile level needs {', '.join(LEVEL_KEYS)}")
        if (entry["level"], entry["dx"], entry["dy"], entry["x"], entry["y"]) != (
                spec["level"], spec["dx"], spec["dy"], list(spec["x"]), list(spec["y"])):
            raise ValueError(f"Tile level {spec['level']} does not match the grid")
        absent = entry["absent"]
        pairs = ([tuple(pair) for pair in absent] if isinstance(absent, list) and all(
            isinstance(pair, list) and len(pair) == 2 and all(map(_whole, pair))
            for pair in absent) else None)
        if pairs is None or pairs != sorted(set(pairs)) or not all(
                spec["x"][0] <= x <= spec["x"][1] and spec["y"][0] <= y <= spec["y"][1]
                for x, y in pairs):
            raise ValueError(f"Absent tiles of level {spec['level']} must be distinct "
                             "[x, y] pairs inside its ranges, in order")
    return tiles


def run_tiles(manifest):
    """Every tile file a tiled run publishes: {path inside the run: (level, x, y, info)}.

    The tiles inside each level's ranges that are not absent, for every frame,
    `info` being the frame's entry in the manifest.
    """
    tiles = check_tiles(manifest)
    out = {}
    for entry in tiles["levels"]:
        level, absent = entry["level"], {tuple(pair) for pair in entry["absent"]}
        for y in range(entry["y"][0], entry["y"][1] + 1):
            for x in range(entry["x"][0], entry["x"][1] + 1):
                if (x, y) in absent:
                    continue
                for info in manifest.get("frames") or []:
                    out[tile_path(level, x, y, info["hour"])] = (level, x, y, info)
    return out


def decode_blocks(data):
    """A tile's int16 blocks (tenths, MISSING marked), refusing what decode_tile refuses."""
    return _decode_quantised(data)[1]


def owned_empty(data):
    """Whether every cell a tile owns is missing in every block (its border aside)."""
    header, blocks = _decode_quantised(data)
    side, border, size = header["size"] + 2 * header["border"], header["border"], header["size"]
    owned = slice(border, border + size)
    return all(np.all(block.reshape(side, side)[owned, owned] == MISSING) for block in blocks)


def owns_domain(grid, level, x, y, size=TILE_SIZE):
    """Whether tile (x, y) at `level` owns any cell of the grid's domain."""
    spec = next(entry for entry in levels(grid, size) if entry["level"] == level)
    return (x * size <= spec["columns"][1] and (x + 1) * size > spec["columns"][0]
            and y * size <= spec["rows"][1] and (y + 1) * size > spec["rows"][0])


def covers_domain(header, blocks, grid):
    """Whether a level-0 tile has every block's value at every grid cell it owns.

    A wind frame has a value at every cell of its grid; only the cells of a
    tile outside the grid may be missing. `blocks` are `decode_blocks`'s.
    """
    if header["level"] != 0:
        raise ValueError("Only a native tile maps one to one onto the grid")
    size, border = header["size"], header["border"]
    side = size + 2 * border
    column0, row0 = lattice_origin(grid)
    first_row = max(row0, header["y"] * size)
    last_row = min(row0 + grid["height"], (header["y"] + 1) * size)
    if around(grid):
        first_column, last_column = header["x"] * size, (header["x"] + 1) * size
        last_column = min(last_column, grid["width"])
    else:
        first_column = max(column0, header["x"] * size)
        last_column = min(column0 + grid["width"], (header["x"] + 1) * size)
    if first_row >= last_row or first_column >= last_column:
        return True
    rows = slice(first_row - header["y"] * size + border, last_row - header["y"] * size + border)
    columns = slice(first_column - header["x"] * size + border,
                    last_column - header["x"] * size + border)
    return all(not np.any(block.reshape(side, side)[rows, columns] == MISSING)
               for block in blocks)


def check_tile(data, manifest, level, x, y, info):
    """A tile's header against the run, the place and the frame it is published as."""
    tiles = manifest["tiles"]
    header = read_tile_header(data)
    where = tile_path(level, x, y, info["hour"])
    if (header["run"], header["hour"]) != (manifest["run"], info["hour"]):
        raise ValueError(f"Tile {where} is from run {header['run']} +{header['hour']}h")
    if (header["level"], header["x"], header["y"]) != (level, x, y):
        raise ValueError(f"Tile {where} is tile {header['level']}/{header['x']}/{header['y']}")
    if (header["size"], header["border"]) != (tiles["size"], tiles["border"]):
        raise ValueError(f"Tile {where} does not match the manifest's tile size")
    if header["blockCount"] != frame_blocks(info):
        raise ValueError(f"Gust block does not match the published gust period in tile {where}")
    return header


class FrameTiles:
    """One frame of a tiled run, read a tile at a time as samples need them.

    `read(path)` returns a tile's bytes by its path inside the run directory.
    A tile the manifest lists as absent is never read and samples as missing.
    `sample(lat, lon)` at level 0 is the whole-frame sampler's answer exactly,
    so everything that used to sample a whole frame (the archive, a backfill)
    reads the same numbers from far fewer bytes.
    """

    def __init__(self, manifest, info, read):
        self.tiles = check_tiles(manifest)
        self.manifest, self.info, self.read = manifest, info, read
        self.grid, self.hour = manifest["grid"], info["hour"]
        self.valid_time = info.get("validTime")
        self.size = self.tiles["size"]
        self.absent = {entry["level"]: {tuple(pair) for pair in entry["absent"]}
                       for entry in self.tiles["levels"]}
        self.loaded = {}

    def tile(self, level, x, y):
        """A decoded tile, or None for an absent one."""
        key = (level, x, y)
        if key not in self.loaded:
            if (x, y) in self.absent.get(level, ()):
                self.loaded[key] = None
            else:
                data = self.read(tile_path(level, x, y, self.hour))
                check_tile(data, self.manifest, level, x, y, self.info)
                self.loaded[key] = decode_tile(data)
        return self.loaded[key]

    def sample(self, lat, lon, level=0):
        """{u, v, gust} in m/s, bilinear, or None off the grid or where u/v is missing.

        `level` is for drawing only: everything that reads numbers reads level 0.
        """
        return sample(self.tile, self.grid, level, lat, lon, self.size)

    def native(self):
        """The whole frame back from its native tiles: {u, v, gust} over the grid.

        Lists of width × height values, rows north to south, None where missing,
        `gust` None when the frame has no gust block. What a whole frame held;
        for tests and tools, never for the map.
        """
        width, height = self.grid["width"], self.grid["height"]
        column0, row0 = lattice_origin(self.grid)
        native = around(self.grid)
        out = {"u": [None] * (width * height), "v": [None] * (width * height),
               "gust": [None] * (width * height) if frame_blocks(self.info) == 3 else None}
        for row in range(height):
            for column in range(width):
                global_column = (column0 + column) % native if native else column0 + column
                x, y = global_column // self.size, (row0 + row) // self.size
                tile = self.tile(0, x, y)
                if tile is None:
                    continue
                at = ((row0 + row - (y * self.size - tile["border"])) * tile["side"]
                      + global_column - (x * self.size - tile["border"]))
                for field in ("u", "v", "gust"):
                    if out[field] is not None:
                        out[field][row * width + column] = tile[field][at]
        return out

