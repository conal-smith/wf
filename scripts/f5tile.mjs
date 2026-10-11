/**
 * The tiled wind frame ("F5T1") encoder, for Node: what the sample generator
 * needs to publish a wind run as tiles without the Python pipeline.
 *
 * force5/ingest/f5tile.py is the format's writer and documents the lattice,
 * the levels, the overview rule and the layout; force5/src/f5tile.ts is the
 * browser's reader. This is a second writer, and it must produce the same
 * bytes as the first: tests/f5tile.test.ts builds the golden pyramids in
 * tests/fixtures/f5tile from their `source` fields through this module and
 * compares every tile byte for byte with the files force5/ingest/test_f5tile.py
 * wrote. The rounding and the wrapping deltas are f5bin's (scripts/f5bin.mjs).
 *
 * Every step is the Python one, in the same order, in integers where Python
 * works in integers: the overview of a block is the mean of the stored tenths
 * of the native cells inside the domain, rounded half away from zero as
 * `sign(s) · floor((2|s| + n) / 2n)`, so no floating-point rounding can make the
 * two languages disagree.
 */
import { MISSING, SCALE, quantiseValue } from "./f5bin.mjs";

export const TILE_ENCODING = "f5-tile-v1";
export const TILE_SIZE = 128;
export const TILE_BORDER = 1;
export const TILE_URL = "t/{level}/{x}/{y}/{hour}.bin";
const HEADER_BYTES = 24;
const MAGIC = "F5T1";
const VERSION = 1;
const MAX_LEVELS = 15;
const MAX_SCALED = 1500;
const LATTICE_TOLERANCE = 1e-6;
const FIELDS = ["u", "v", "gust"];

const fold = (value) => ((value + 32768) & 0xffff) - 32768;
/** Python's `%`: the remainder takes the divisor's sign. */
const modulo = (value, n) => ((value % n) + n) % n;

/** The grid's first column and row on the global lattice, or a throw. */
export function latticeOrigin(grid) {
  const { dx, dy } = grid;
  if (!(dx > 0 && dy > 0)) throw new Error("Grid spacing must be positive");
  const columns = (grid.west + 180) / dx;
  const rows = (90 - grid.north) / dy;
  // Python's round() is half to even; a lattice edge is within 1e-6 of a whole
  // number, nowhere near a half, so Math.round agrees wherever it is accepted.
  const column = Math.round(columns),
    row = Math.round(rows);
  if (
    Math.abs(columns - column) > LATTICE_TOLERANCE ||
    Math.abs(rows - row) > LATTICE_TOLERANCE
  )
    throw new Error(
      `Grid at west ${grid.west}, north ${grid.north} is not on the global ` +
        `${dx} × ${dy} lattice`,
    );
  if (column < 0 || row < 0)
    throw new Error("Grid starts west of -180° or north of 90°");
  // f5tile.lattice_origin: past the circle a column would be cut twice over.
  if (
    (around(grid) === null ? column : 0) + grid.width >
    360 / dx + LATTICE_TOLERANCE
  )
    throw new Error(
      "Grid runs past 180° of longitude: a global grid must not repeat its " +
        "first column at 180°, and a regional one must not cross it",
    );
  if (row + grid.height - 1 > 180 / dy + LATTICE_TOLERANCE)
    throw new Error("Grid runs south of -90°");
  return { column, row };
}

/** Native columns around the globe when the grid is global, else null. */
function around(grid) {
  return Math.abs(grid.width - 360 / grid.dx) > LATTICE_TOLERANCE
    ? null
    : grid.width;
}

/** ceil(native / 2^level), as Python's `-(-native >> level)`. */
const columnsAt = (native, level) => -(-native >> level);

/** Every level of the pyramid, as f5tile.levels gives them. */
export function levels(grid, size = TILE_SIZE) {
  if (size < 1) throw new Error("Tile size must be positive");
  const { column: column0, row: row0 } = latticeOrigin(grid);
  const native = around(grid);
  const out = [];
  for (let level = 0; level < MAX_LEVELS; level++) {
    const columns = native
      ? [0, columnsAt(native, level) - 1]
      : [column0 >> level, (column0 + grid.width - 1) >> level];
    const rows = [row0 >> level, (row0 + grid.height - 1) >> level];
    const x = [Math.floor(columns[0] / size), Math.floor(columns[1] / size)];
    const y = [Math.floor(rows[0] / size), Math.floor(rows[1] / size)];
    out.push({
      level,
      dx: grid.dx * 2 ** level,
      dy: grid.dy * 2 ** level,
      columns,
      rows,
      x,
      y,
    });
    if (x[0] === x[1] && y[0] === y[1]) break;
  }
  return out;
}

/** A tile's path under its run directory, the hour zero-padded to three. */
export const tilePath = (level, x, y, hour) =>
  `t/${level}/${x}/${y}/${String(hour).padStart(3, "0")}.bin`;

/** A 2-D array of numbers, rows × columns, as one Float64Array. */
const table = (rows, columns) => ({
  rows,
  columns,
  data: new Float64Array(rows * columns),
});

/** Level 0 as integer sums and counts over the level's global cells. */
function nativeSums(grid, values, field, native) {
  const { width, height } = grid;
  if (!Array.isArray(values) || values.length !== width * height)
    throw new Error(
      `${field} has ${values?.length} values, not ${width * height}`,
    );
  const sums = table(height, width),
    counts = table(height, width);
  const shift = native ? modulo(latticeOrigin(grid).column, native) : 0;
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++) {
      const value = values[row * width + column];
      if (value === null || value === undefined || !Number.isFinite(value))
        continue;
      const scaled = quantiseValue(value);
      if (Math.abs(scaled) > MAX_SCALED)
        throw new Error(`Implausible ${field} value beyond ±150 m/s`);
      if (field === "gust" && scaled < 0)
        throw new Error("Negative gust speed");
      // A global grid is rolled so that its column index is the global column.
      const at = row * width + (native ? (column + shift) % width : column);
      sums.data[at] = scaled + 0; // +0, never -0.
      counts.data[at] = 1;
    }
  return { sums, counts };
}

/** The next level up: 2×2 block sums aligned to the global lattice. */
function halve({ sums, counts }, firstColumn, firstRow) {
  const left = modulo(firstColumn, 2),
    top = modulo(firstRow, 2);
  const right = (left + sums.columns) % 2,
    bottom = (top + sums.rows) % 2;
  const rows = (top + sums.rows + bottom) / 2,
    columns = (left + sums.columns + right) / 2;
  const out = { sums: table(rows, columns), counts: table(rows, columns) };
  for (const key of ["sums", "counts"]) {
    const source = key === "sums" ? sums : counts;
    const target = out[key].data;
    for (let row = 0; row < source.rows; row++)
      for (let column = 0; column < source.columns; column++) {
        const r = (row + top) >> 1,
          c = (column + left) >> 1;
        target[r * columns + c] += source.data[row * source.columns + column];
      }
  }
  return out;
}

/** Each block's mean in tenths, half away from zero, in integers; MISSING where empty. */
function mean({ sums, counts }) {
  const out = new Int16Array(sums.rows * sums.columns);
  for (let i = 0; i < out.length; i++) {
    const n = counts.data[i],
      s = sums.data[i];
    out[i] =
      n > 0
        ? Math.sign(s) * Math.floor((2 * Math.abs(s) + n) / (2 * n))
        : MISSING;
  }
  return { rows: sums.rows, columns: sums.columns, data: out };
}

/** One tile's stored cells from a level's array; outside the domain is missing. */
function cut(array, spec, x, y, size, border, wrap) {
  const side = size + 2 * border;
  const out = new Int16Array(side * side).fill(MISSING);
  for (let r = 0; r < side; r++) {
    const row = y * size - border + r;
    const rowIndex = row - spec.rows[0];
    // Rows never wrap: there is nothing north of 90° or south of -90°, and the
    // level's rows end at the grid's last, so the row at -90° itself is kept.
    if (rowIndex < 0 || rowIndex >= array.rows) continue;
    for (let c = 0; c < side; c++) {
      let column = x * size - border + c;
      if (wrap) column = modulo(column, wrap);
      const columnIndex = column - spec.columns[0];
      if (columnIndex < 0 || columnIndex >= array.columns) continue;
      out[r * side + c] = array.data[rowIndex * array.columns + columnIndex];
    }
  }
  return out;
}

/** A tile's bytes from its blocks already in int16 tenths. */
function encodeQuantised(level, x, y, hour, run, blocks, size, border) {
  if (!/^\d{10}$/.test(String(run)))
    throw new Error("A tile header carries the run as YYYYMMDDHH");
  if (blocks.length !== 2 && blocks.length !== 3)
    throw new Error("A wind tile carries u and v, and gust or nothing");
  const side = size + 2 * border;
  const buffer = Buffer.alloc(HEADER_BYTES + blocks.length * side * side * 2);
  buffer.write(MAGIC, 0, "latin1");
  buffer.writeUInt8(VERSION, 4);
  buffer.writeUInt8(blocks.length, 5);
  buffer.writeUInt8(level, 6);
  buffer.writeUInt8(border, 7);
  buffer.writeUInt16LE(size, 8);
  buffer.writeUInt16LE(SCALE, 10);
  buffer.writeUInt16LE(hour, 12);
  buffer.writeUInt32LE(Number(run), 14);
  buffer.writeUInt16LE(x, 18);
  buffer.writeUInt16LE(y, 20);
  let at = HEADER_BYTES;
  for (const block of blocks)
    for (let row = 0; row < side; row++)
      for (let column = 0; column < side; column++) {
        const here = block[row * side + column];
        buffer.writeInt16LE(
          column === 0 ? here : fold(here - block[row * side + column - 1]),
          at,
        );
        at += 2;
      }
  return buffer;
}

/**
 * Every tile of every level: `{ levels, tiles: [{ level, x, y, bytes }] }`,
 * as `f5tile.build_pyramid`. `u`, `v` and `gust` (or null) are width × height
 * values in m/s, rows north to south, null where missing. A tile whose owned
 * cells are all missing is left out unless `keepEmpty`.
 */
export function buildPyramid(
  grid,
  { u, v, gust = null },
  hour,
  run,
  { size = TILE_SIZE, border = TILE_BORDER, keepEmpty = false } = {},
) {
  if (u == null || v == null)
    throw new Error("A wind frame carries u and v, and gust or nothing");
  const spec = levels(grid, size);
  const native = around(grid);
  let state = [
    ["u", u],
    ["v", v],
    ...(gust != null ? [["gust", gust]] : []),
  ].map(([field, values]) => nativeSums(grid, values, field, native));
  const tiles = [];
  spec.forEach((levelSpec, index) => {
    if (index) {
      const previous = spec[index - 1];
      state = state.map((sums) =>
        halve(sums, previous.columns[0], previous.rows[0]),
      );
    }
    const arrays = state.map(mean);
    const wrap = native ? columnsAt(native, levelSpec.level) : null;
    for (let y = levelSpec.y[0]; y <= levelSpec.y[1]; y++)
      for (let x = levelSpec.x[0]; x <= levelSpec.x[1]; x++) {
        const blocks = arrays.map((array) =>
          cut(array, levelSpec, x, y, size, border, wrap),
        );
        if (
          !keepEmpty &&
          blocks.every((block) => ownedEmpty(block, size, border))
        )
          continue;
        tiles.push({
          level: levelSpec.level,
          x,
          y,
          bytes: encodeQuantised(
            levelSpec.level,
            x,
            y,
            hour,
            run,
            blocks,
            size,
            border,
          ),
        });
      }
  });
  return { levels: spec, tiles };
}

/** Whether every cell a block owns (its border aside) is missing. */
function ownedEmpty(block, size, border) {
  const side = size + 2 * border;
  for (let row = border; row < border + size; row++)
    for (let column = border; column < border + size; column++)
      if (block[row * side + column] !== MISSING) return false;
  return true;
}

/** The blocks a run's tiles carry: gust too when any frame has a gust window. */
export const tileBlocks = (frames) =>
  frames.some((frame) => frame.gustIntervalHours != null)
    ? [...FIELDS]
    : FIELDS.slice(0, 2);

/**
 * A manifest's `tiles` block, as `f5tile.manifest_tiles` writes it: the levels'
 * ranges and cell sizes, and the tiles each level leaves absent because they
 * are empty in every hour.
 */
export function manifestTiles(grid, frames, absent = {}, size = TILE_SIZE) {
  return {
    size,
    border: TILE_BORDER,
    encoding: TILE_ENCODING,
    blocks: tileBlocks(frames),
    url: TILE_URL,
    levels: levels(grid, size).map((spec) => ({
      level: spec.level,
      dx: spec.dx,
      dy: spec.dy,
      x: spec.x,
      y: spec.y,
      absent: [...(absent[spec.level] ?? [])].sort(
        (a, b) => a[0] - b[0] || a[1] - b[1],
      ),
    })),
  };
}
