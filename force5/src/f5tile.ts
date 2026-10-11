// The browser's reader for tiled wind frames (`tiles.encoding: "f5-tile-v1"`),
// and the lattice arithmetic that says which tile holds a point.
//
// The format, the lattice and the overview rule are written out once in
// force5/ingest/f5tile.py; the rounding and the wrapping int16 deltas are
// f5bin's, written out in force5/ingest/f5bin.py. This file is the other side
// of that contract and must not drift from it: `f5tile.test.ts` decodes the
// golden pyramids in tests/fixtures/f5tile that the Python suite builds, and
// both suites check the same tile ranges and the same sampled values.
//
// A tile inside a level's ranges that a run never wrote, because every cell it
// owns is missing at every hour, is listed in the manifest as `absent` and is
// all missing. Every other tile in the ranges exists for every hour, so a
// reader never requests an absent one and treats a 404 as the error it is.
// `TiledField` (tiledField.ts) is the reader the map uses.
import type { Grid, Wind } from "./weather";

/** What a manifest's `tiles.encoding` says when its frames are tiled. */
export const TILE_ENCODING = "f5-tile-v1";
export const TILE_SIZE = 128;
export const TILE_BORDER = 1;
export const TILE_HEADER_BYTES = 24;
const MAGIC = 0x46355431; // "F5T1", read big-endian so the bytes read in order.
const VERSION = 1;
const SCALE = 10;
const MISSING = -32768;
const MAX_SCALED = 1500; // ±150 m/s, the range check every frame has.
const MAX_LEVELS = 15;
// How far, in cells, a grid's edge may sit from the lattice and still be on it.
const LATTICE_TOLERANCE = 1e-6;

const WRONG_RUN =
  "Forecast file does not match the selected model run. Refresh the page.";
const UNREADABLE = "This forecast tile could not be read. Try again.";
const NEWER = "This forecast tile is in a newer format. Refresh the page.";

/** One level as a manifest's `tiles.levels` lists it: inclusive tile ranges. */
export interface TileLevel {
  level: number;
  x: [number, number];
  y: [number, number];
}

/**
 * A level of a manifest's `tiles` block: its ranges, its cell size, and the
 * tiles inside the ranges that were never written because every cell they own
 * is missing at every hour. A tile not listed absent exists for every hour.
 */
export interface TilesLevel extends TileLevel {
  dx: number;
  dy: number;
  absent: [number, number][];
}

/**
 * A wind manifest's `tiles` block (force5/ingest/f5tile.py, `manifest_tiles`):
 * where a run's frames are and how they are cut. `blocks` is the most a tile
 * carries; a frame whose `gustIntervalHours` is null has u and v only. `url`
 * is relative to the run directory, `{hour}` zero-padded to three digits.
 */
export interface TilesSpec {
  size: number;
  border: number;
  encoding: string;
  blocks: string[];
  url: string;
  levels: TilesLevel[];
}

/** The one url template a manifest may give its tiles. */
export const TILE_URL = "t/{level}/{x}/{y}/{hour}.bin";

const whole = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) &&
  (value as number) >= min &&
  (value as number) <= max;

/**
 * A wind manifest's `tiles` block, checked against its grid and frames as the
 * publisher checks it (`check_tiles` in force5/ingest/f5tile.py): the grid on
 * the lattice, exactly the levels `tileLevels` gives with their cell sizes,
 * absent tiles inside their level's ranges, once each and in order, and gust
 * blocks exactly when some frame has a gust window. Returns the block.
 */
export function validateTiles(
  grid: Pick<Grid, "west" | "north" | "dx" | "dy" | "width" | "height">,
  frames: readonly { gustIntervalHours: [number, number] | null }[],
  tiles: unknown,
): TilesSpec {
  const bad = (why: string): never => {
    throw new Error(`Invalid forecast tiles: ${why}. Refresh the page.`);
  };
  if (!tiles || typeof tiles !== "object" || Array.isArray(tiles))
    bad("no tiles block");
  const t = tiles as TilesSpec;
  if (t.encoding !== TILE_ENCODING) throw new Error(NEWER);
  if (t.url !== TILE_URL) bad("an unknown url");
  if (!whole(t.size, 1, 65535)) bad("the tile size");
  if (!whole(t.border, 1, 255)) bad("no border to sample");
  latticeOrigin(grid);
  const gust = frames.some((frame) => frame.gustIntervalHours !== null);
  if (
    !Array.isArray(t.blocks) ||
    t.blocks.join() !== (gust ? "u,v,gust" : "u,v")
  )
    bad("blocks that do not match the gust periods");
  const expected = tileLevels(grid, t.size);
  if (!Array.isArray(t.levels) || t.levels.length !== expected.length)
    bad("levels that do not match the grid");
  t.levels.forEach((level, index) => {
    const want = expected[index];
    const { dx, dy } = levelCellDegrees(grid, want.level);
    if (
      !level ||
      level.level !== want.level ||
      level.dx !== dx ||
      level.dy !== dy ||
      !Array.isArray(level.x) ||
      !Array.isArray(level.y) ||
      level.x[0] !== want.x[0] ||
      level.x[1] !== want.x[1] ||
      level.y[0] !== want.y[0] ||
      level.y[1] !== want.y[1] ||
      !Array.isArray(level.absent)
    )
      bad(`level ${want.level} does not match the grid`);
    let previous: [number, number] | null = null;
    for (const pair of level.absent) {
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        !whole(pair[0], want.x[0], want.x[1]) ||
        !whole(pair[1], want.y[0], want.y[1]) ||
        (previous &&
          (pair[0] < previous[0] ||
            (pair[0] === previous[0] && pair[1] <= previous[1])))
      )
        bad(`absent tiles of level ${want.level}`);
      previous = pair;
    }
  });
  return t;
}

/** What the caller asked for, which the tile's own header must repeat. */
export interface TileRequest {
  level: number;
  x: number;
  y: number;
  hour: number;
  run: string;
  size: number;
  border: number;
  blocks: 2 | 3;
}

/**
 * A decoded tile. Each array holds `side` × `side` values in m/s, rows north
 * to south and each row west to east, border included; NaN is missing.
 * Float64Array keeps every value bit-identical to what `decodeFrame` returns
 * for the same cell, which is what lets level 0 sample exactly like a frame.
 */
export interface Tile {
  level: number;
  x: number;
  y: number;
  hour: number;
  run: string;
  size: number;
  border: number;
  side: number;
  u: Float64Array;
  v: Float64Array;
  gust: Float64Array | null;
}

/** See f5bin.ts: the file is little-endian and so is every browser in service. */
const LITTLE_ENDIAN = new Int16Array(new Uint8Array([1, 0]).buffer)[0] === 1;

/** Header fields, or a throw. Exported for the tests; `decodeTile` is the reader. */
export function readTileHeader(buffer: ArrayBuffer) {
  if (!LITTLE_ENDIAN)
    throw new Error("This browser cannot read binary forecast frames.");
  if (buffer.byteLength < TILE_HEADER_BYTES) throw new Error(UNREADABLE);
  const view = new DataView(buffer);
  if (view.getUint32(0, false) !== MAGIC) throw new Error(UNREADABLE);
  const version = view.getUint8(4);
  if (version !== VERSION) throw new Error(NEWER);
  const blockCount = view.getUint8(5);
  const level = view.getUint8(6);
  const border = view.getUint8(7);
  const size = view.getUint16(8, true);
  const scale = view.getUint16(10, true);
  const hour = view.getUint16(12, true);
  const run = view.getUint32(14, true);
  const x = view.getUint16(18, true);
  const y = view.getUint16(20, true);
  // Bytes 22-23 are reserved and must be zero, for f5bin.ts's reason.
  for (let at = 22; at < TILE_HEADER_BYTES; at++)
    if (view.getUint8(at) !== 0) throw new Error(NEWER);
  if (blockCount !== 2 && blockCount !== 3) throw new Error(UNREADABLE);
  if (scale !== SCALE || size < 1 || size + 2 * border < 2)
    throw new Error(UNREADABLE);
  return { version, blockCount, level, border, size, scale, hour, run, x, y };
}

/**
 * One block's stored values: the deltas summed along each row, wrapping in
 * int16 as f5bin's do, every value range-checked. Tenths of a metre per
 * second, `TILE_MISSING` where missing.
 */
function block(
  deltas: Int16Array,
  offset: number,
  side: number,
  gust: boolean,
): Int16Array {
  const values = new Int16Array(side * side);
  for (let row = 0; row < side; row++) {
    let previous = 0;
    const start = row * side;
    for (let column = 0; column < side; column++) {
      const delta = deltas[offset + start + column];
      const value = column === 0 ? delta : ((previous + delta) << 16) >> 16;
      previous = value;
      values[start + column] = value;
      if (value === MISSING) continue;
      if (value > MAX_SCALED || value < -MAX_SCALED || (gust && value < 0))
        throw new Error(
          `Invalid ${gust ? "gust" : "wind"} data in this forecast tile.`,
        );
    }
  }
  return values;
}

/** Stored tenths as m/s, NaN where missing: what `decodeTile` hands back. */
function metres(values: Int16Array): Float64Array {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++)
    out[i] = values[i] === MISSING ? NaN : values[i] / SCALE;
  return out;
}

/** The value a stored cell holds when it is missing, in `decodeTileValues`'s blocks. */
export const TILE_MISSING = MISSING;
/** Stored values are tenths of a metre per second. */
export const TILE_SCALE = SCALE;

/**
 * A decoded tile as its stored int16 tenths: a quarter of `Tile`'s memory,
 * which is what lets the map keep a hundred of them. `value / TILE_SCALE` is
 * exactly the number `decodeTile` gives for the same cell, so a sampler over
 * these is bit-for-bit the one over `Tile`.
 */
export interface TileValues extends Omit<Tile, "u" | "v" | "gust"> {
  u: Int16Array;
  v: Int16Array;
  gust: Int16Array | null;
}

/**
 * A tile, checked against the request it answers, as its stored tenths.
 *
 * The header repeats the run, hour, level, position, size and block count, so
 * a file served under the wrong key — another run, another hour, the tile next
 * door — is refused here rather than drawn in the wrong place.
 */
export function decodeTileValues(
  buffer: ArrayBuffer,
  expected: TileRequest,
): TileValues {
  const header = readTileHeader(buffer);
  if (header.hour !== expected.hour || String(header.run) !== expected.run)
    throw new Error(WRONG_RUN);
  if (
    header.level !== expected.level ||
    header.x !== expected.x ||
    header.y !== expected.y
  )
    throw new Error(
      "Forecast tile is not the one requested. Refresh the page.",
    );
  if (header.size !== expected.size || header.border !== expected.border)
    throw new Error("Forecast grids do not match.");
  if (header.blockCount !== expected.blocks)
    throw new Error("Gust period does not match the selected forecast.");
  const side = header.size + 2 * header.border;
  const count = side * side;
  if (buffer.byteLength !== TILE_HEADER_BYTES + header.blockCount * count * 2)
    throw new Error(UNREADABLE);
  // The header length is even, so this view is always aligned.
  const deltas = new Int16Array(
    buffer,
    TILE_HEADER_BYTES,
    header.blockCount * count,
  );
  return {
    level: header.level,
    x: header.x,
    y: header.y,
    hour: header.hour,
    run: expected.run,
    size: header.size,
    border: header.border,
    side,
    u: block(deltas, 0, side, false),
    v: block(deltas, count, side, false),
    gust: header.blockCount === 3 ? block(deltas, 2 * count, side, true) : null,
  };
}

/** A tile, checked against the request it answers, in m/s with NaN for missing. */
export function decodeTile(buffer: ArrayBuffer, expected: TileRequest): Tile {
  const tile = decodeTileValues(buffer, expected);
  return {
    ...tile,
    u: metres(tile.u),
    v: metres(tile.v),
    gust: tile.gust && metres(tile.gust),
  };
}

/** A tile's path under its run directory; the hour is zero-padded like frames. */
export const tilePath = (level: number, x: number, y: number, hour: number) =>
  `t/${level}/${x}/${y}/${String(hour).padStart(3, "0")}.bin`;

type Lattice = Pick<Grid, "west" | "north" | "dx" | "dy" | "width" | "height">;

/**
 * The grid's first column and row on the global lattice, or a throw: column c
 * sits at longitude -180 + c·dx and row r at latitude 90 - r·dy.
 */
export function latticeOrigin(grid: Lattice): { column: number; row: number } {
  const columns = (grid.west + 180) / grid.dx;
  const rows = (90 - grid.north) / grid.dy;
  const column = Math.round(columns),
    row = Math.round(rows);
  if (
    !(grid.dx > 0 && grid.dy > 0) ||
    !(Math.abs(columns - column) <= LATTICE_TOLERANCE) ||
    !(Math.abs(rows - row) <= LATTICE_TOLERANCE) ||
    column < 0 ||
    row < 0 ||
    // Past the circle, or the pole: refused by the writers too
    // (f5tile.lattice_origin), so never published.
    (around(grid) === null ? column : 0) + grid.width >
      360 / grid.dx + LATTICE_TOLERANCE ||
    row + grid.height - 1 > 180 / grid.dy + LATTICE_TOLERANCE
  )
    throw new Error("Forecast grid is not on the tile lattice.");
  return { column, row };
}

/** Native columns around the globe when the grid is global, else null. */
function around(grid: Lattice): number | null {
  return Math.abs(grid.width - 360 / grid.dx) <= LATTICE_TOLERANCE
    ? grid.width
    : null;
}

/** Level-k columns around the globe: ceil(native / 2^k), the last maybe partial. */
const columnsAt = (native: number, level: number) =>
  Math.ceil(native / 2 ** level);

/**
 * `value` modulo `n` in [0, n), as Python's float `%` computes it: add `n` only
 * to a negative remainder. `((value % n) + n) % n` would round away the low
 * bits of every positive value, and the two languages would sample differently.
 */
function modulo(value: number, n: number) {
  const remainder = value % n;
  return remainder < 0 ? remainder + n : remainder;
}

/** A level's cell size in degrees. */
export const levelCellDegrees = (grid: Lattice, level: number) => ({
  dx: grid.dx * 2 ** level,
  dy: grid.dy * 2 ** level,
});

/** The level-k global cells holding any of the domain, inclusive. */
function domainCells(grid: Lattice, level: number) {
  const { column, row } = latticeOrigin(grid);
  const scale = 2 ** level;
  const native = around(grid);
  return {
    columns: native
      ? [0, columnsAt(native, level) - 1]
      : [
          Math.floor(column / scale),
          Math.floor((column + grid.width - 1) / scale),
        ],
    rows: [
      Math.floor(row / scale),
      Math.floor((row + grid.height - 1) / scale),
    ],
  };
}

/**
 * Every level of the pyramid, as a manifest's `tiles.levels` lists them. The
 * same rule as `levels` in force5/ingest/f5tile.py: stop at the first level
 * that fits one tile, or at fifteen.
 */
export function tileLevels(grid: Lattice, size = TILE_SIZE): TileLevel[] {
  const out: TileLevel[] = [];
  for (let level = 0; level < MAX_LEVELS; level++) {
    const { columns, rows } = domainCells(grid, level);
    const x: [number, number] = [
      Math.floor(columns[0] / size),
      Math.floor(columns[1] / size),
    ];
    const y: [number, number] = [
      Math.floor(rows[0] / size),
      Math.floor(rows[1] / size),
    ];
    out.push({ level, x, y });
    if (x[0] === x[1] && y[0] === y[1]) break;
  }
  return out;
}

/**
 * A native offset from the domain's first cell, as a position in level-k cells
 * from the level's first cell. A level-k value sits at the centre of the native
 * points it averages, (2^k - 1) / 2 native cells past its first, so the
 * overview field is not shifted. At level 0 this returns `native` unchanged,
 * to the bit.
 */
function along(native: number, origin: number, first: number, level: number) {
  const scale = 2 ** level;
  return (native + (origin - first * scale) - (scale - 1) / 2) / scale;
}

/**
 * The global level-k cell a bilinear sample at (lat, lon) starts from — its
 * north-west corner — and the weights, or null outside the level's domain.
 *
 * At level 0 this is `sample()` in weather.ts to the bit: the same
 * `(lon - west) / dx` and the same clamp at the east and south edges. At a
 * coarser level the sampleable area ends at the centres of the edge cells,
 * which can leave a strip under one level-k cell wide along the domain's edge
 * that only finer levels cover. `position` in force5/ingest/f5tile.py is the
 * same function.
 */
function position(grid: Lattice, level: number, lat: number, lon: number) {
  const { column, row } = latticeOrigin(grid);
  const { columns, rows } = domainCells(grid, level);
  const x = (lon - grid.west) / grid.dx;
  const y = (grid.north - lat) / grid.dy;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const down = along(y, row, rows[0], level),
    lastRow = rows[1] - rows[0];
  if (lastRow < 1 || down < 0 || down > lastRow) return null;
  const r = Math.min(Math.floor(down), lastRow - 1);
  const native = around(grid);
  if (native) {
    // A global grid wraps: the column east of the last is the first.
    const wrap = columnsAt(native, level);
    const across = along(modulo(x + column, native), 0, 0, level);
    const c = Math.floor(across);
    return {
      column: modulo(c, wrap),
      row: rows[0] + r,
      tx: across - c,
      ty: down - r,
    };
  }
  const across = along(x, column, columns[0], level),
    lastColumn = columns[1] - columns[0];
  if (lastColumn < 1 || across < 0 || across > lastColumn) return null;
  const c = Math.min(Math.floor(across), lastColumn - 1);
  return {
    column: columns[0] + c,
    row: rows[0] + r,
    tx: across - c,
    ty: down - r,
  };
}

/** The tile to sample (lat, lon) from at this level, or null outside it. */
export function tileOf(
  grid: Lattice,
  level: number,
  lat: number,
  lon: number,
  size = TILE_SIZE,
): { x: number; y: number } | null {
  const at = position(grid, level, lat, lon);
  return at
    ? { x: Math.floor(at.column / size), y: Math.floor(at.row / size) }
    : null;
}

/**
 * The first and last starting cells, relative to the level's first cell, for
 * samples between two positions on one axis; null when they miss the domain.
 * A position past an edge starts where a sample on that edge does.
 */
function span(first: number, last: number, extent: number) {
  if (!(extent >= 1) || !(first <= last) || last < 0 || first > extent)
    return null;
  const cell = (at: number) =>
    Math.min(Math.floor(Math.min(Math.max(at, 0), extent)), extent - 1);
  return [cell(first), cell(last)];
}

/**
 * Every tile a sample anywhere in `bbox` reads at this level, which is the set
 * `tileOf` gives over the box, clipped to the level's published ranges. A box
 * with west > east crosses the antimeridian and is read as two boxes. A tile in
 * the list may be absent on the server, which means all missing.
 */
export function tilesCovering(
  grid: Lattice,
  levelSpec: TileLevel,
  bbox: { west: number; south: number; east: number; north: number },
  size = TILE_SIZE,
): { x: number; y: number }[] {
  if (bbox.west > bbox.east)
    return dedupe([
      ...tilesCovering(grid, levelSpec, { ...bbox, east: 180 }, size),
      ...tilesCovering(grid, levelSpec, { ...bbox, west: -180 }, size),
    ]);
  const { level } = levelSpec;
  const { column, row } = latticeOrigin(grid);
  const { columns, rows } = domainCells(grid, level);
  const down = span(
    along((grid.north - bbox.north) / grid.dy, row, rows[0], level),
    along((grid.north - bbox.south) / grid.dy, row, rows[0], level),
    rows[1] - rows[0],
  );
  if (!down) return [];
  const ys = clip(down, rows[0], size, levelSpec.y);
  const native = around(grid);
  let xs: number[];
  if (native) {
    const wrap = columnsAt(native, level);
    const x = (bbox.west - grid.west) / grid.dx;
    const west = along(modulo(x + column, native), 0, 0, level);
    const cells = (bbox.east - bbox.west) / (grid.dx * 2 ** level);
    if (!Number.isFinite(west) || !Number.isFinite(cells)) return [];
    const first = Math.floor(west),
      last = Math.floor(west + cells);
    xs =
      last - first + 1 >= wrap
        ? range(levelSpec.x[0], levelSpec.x[1])
        : [
            ...new Set(
              range(first, last).map((c) => Math.floor(modulo(c, wrap) / size)),
            ),
          ].filter((x) => x >= levelSpec.x[0] && x <= levelSpec.x[1]);
  } else {
    const across = span(
      along((bbox.west - grid.west) / grid.dx, column, columns[0], level),
      along((bbox.east - grid.west) / grid.dx, column, columns[0], level),
      columns[1] - columns[0],
    );
    if (!across) return [];
    xs = clip(across, columns[0], size, levelSpec.x);
  }
  return ys.flatMap((y) => xs.map((x) => ({ x, y })));
}

/** Tiles owning a span of cells, within a level's published range. */
const clip = (
  cells: number[],
  first: number,
  size: number,
  published: [number, number],
) =>
  range(
    Math.max(Math.floor((first + cells[0]) / size), published[0]),
    Math.min(Math.floor((first + cells[1]) / size), published[1]),
  );

const range = (first: number, last: number) =>
  Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);

const dedupe = (tiles: { x: number; y: number }[]) => [
  ...new Map(tiles.map((tile) => [`${tile.x}/${tile.y}`, tile])).values(),
];

/**
 * Bilinear u/v/gust at (lat, lon) from one decoded tile, using its border, or
 * null outside the level or where any u or v corner is missing. `gust` is null
 * when the tile has no gust block or a gust corner is missing.
 *
 * At level 0 this returns exactly what `sample()` in weather.ts returns for the
 * whole frame, on tile edges too. The tile must be the one `tileOf` names for
 * the point at the tile's level; another tile is a caller's bug and throws.
 */
export function sampleTile(
  tile: Tile,
  grid: Lattice,
  lat: number,
  lon: number,
): Wind | null {
  const at = position(grid, tile.level, lat, lon);
  if (!at) return null;
  const { size, border, side } = tile;
  // The east and south corners come from the border; without one they are not here.
  if (border < 1)
    throw new Error("This forecast tile has no border to sample.");
  if (
    Math.floor(at.column / size) !== tile.x ||
    Math.floor(at.row / size) !== tile.y
  )
    throw new Error("This point is not in this forecast tile.");
  const i =
    (at.row - (tile.y * size - border)) * side +
    at.column -
    (tile.x * size - border);
  const { tx, ty } = at;
  const bilinear = (a: Float64Array) =>
    (a[i] * (1 - tx) + a[i + 1] * tx) * (1 - ty) +
    (a[i + side] * (1 - tx) + a[i + side + 1] * tx) * ty;
  const corners = (a: Float64Array) =>
    !Number.isNaN(a[i] + a[i + 1] + a[i + side] + a[i + side + 1]);
  if (!corners(tile.u) || !corners(tile.v)) return null;
  return {
    u: bilinear(tile.u),
    v: bilinear(tile.v),
    gust: tile.gust && corners(tile.gust) ? bilinear(tile.gust) : null,
  };
}
