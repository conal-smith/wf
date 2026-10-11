import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  TILE_HEADER_BYTES,
  decodeTile,
  latticeOrigin,
  levelCellDegrees,
  readTileHeader,
  sampleTile,
  tileLevels,
  tileOf,
  tilePath,
  tilesCovering,
  type Tile,
  type TileRequest,
} from "./f5tile";
import { sample, type GridFrame, type Grid } from "./weather";

// The same files force5/ingest/test_f5tile.py builds and checks, so the two
// languages decode the same bytes and must agree on every number below.
const FIXTURES = new URL("../../tests/fixtures/f5tile/", import.meta.url);
type Values = (number | null)[];
interface GoldenTile {
  level: number;
  x: number;
  y: number;
  path: string;
  bytes: number;
  expected: { u: Values; v: Values; gust: Values | null };
}
interface Pyramid {
  name: string;
  grid: Grid;
  size: number;
  border: number;
  hour: number;
  run: string;
  source: { u: Values; v: Values; gust: Values | null };
  levels: { level: number; x: [number, number]; y: [number, number] }[];
  tiles: GoldenTile[];
  skipped: [number, number, number][];
  samples: {
    level: number;
    lat: number;
    lon: number;
    tile: [number, number] | null;
    expected: { u: number; v: number; gust: number | null } | null;
  }[];
}
const golden: { pyramids: Pyramid[] } = JSON.parse(
  readFileSync(new URL("golden.json", FIXTURES), "utf8"),
);
const [regional, global] = golden.pyramids;

/** A Node Buffer as the ArrayBuffer a `fetch` response would hand the decoder. */
const bytes = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
const fileOf = (tile: GoldenTile) => readFileSync(new URL(tile.path, FIXTURES));

/** `null` in the golden values is a missing cell; the decoder returns NaN. */
const nulled = (values: Float64Array) =>
  Array.from(values, (value) => (Number.isNaN(value) ? null : value));

const request = (pyramid: Pyramid, tile: GoldenTile): TileRequest => ({
  level: tile.level,
  x: tile.x,
  y: tile.y,
  hour: pyramid.hour,
  run: pyramid.run,
  size: pyramid.size,
  border: pyramid.border,
  blocks: pyramid.source.gust ? 3 : 2,
});

/** Every tile of a pyramid, decoded, keyed the way a tile cache would be. */
function decoded(pyramid: Pyramid) {
  const tiles = new Map<string, Tile>();
  for (const tile of pyramid.tiles)
    tiles.set(
      `${tile.level}/${tile.x}/${tile.y}`,
      decodeTile(bytes(fileOf(tile)), request(pyramid, tile)),
    );
  return tiles;
}

/** What a tiled field will do: find the tile, and a tile not there is missing. */
function sampleTiled(
  pyramid: Pyramid,
  tiles: Map<string, Tile>,
  level: number,
  lat: number,
  lon: number,
) {
  const at = tileOf(pyramid.grid, level, lat, lon, pyramid.size);
  if (!at) return null;
  const tile = tiles.get(`${level}/${at.x}/${at.y}`);
  return tile ? sampleTile(tile, pyramid.grid, lat, lon) : null;
}

const HARMONIE = {
  west: -10.9,
  north: 55.7,
  dx: 0.025,
  dy: 0.02,
  width: 233,
  height: 236,
};
const ICON_EU = {
  west: -18,
  north: 59,
  dx: 0.0625,
  dy: 0.0625,
  width: 321,
  height: 177,
};
const ECMWF = {
  west: -18,
  north: 59,
  dx: 0.25,
  dy: 0.25,
  width: 81,
  height: 45,
};

describe("the golden tile pyramids", () => {
  it("decode to exactly the values every reader must agree on", () => {
    for (const pyramid of golden.pyramids)
      for (const tile of pyramid.tiles) {
        const buffer = fileOf(tile);
        expect(buffer.byteLength).toBe(tile.bytes);
        const read = decodeTile(bytes(buffer), request(pyramid, tile));
        expect(nulled(read.u)).toEqual(tile.expected.u);
        expect(nulled(read.v)).toEqual(tile.expected.v);
        if (tile.expected.gust === null) expect(read.gust).toBeNull();
        else expect(nulled(read.gust!)).toEqual(tile.expected.gust);
        expect([read.level, read.x, read.y, read.hour, read.run]).toEqual([
          tile.level,
          tile.x,
          tile.y,
          pyramid.hour,
          pyramid.run,
        ]);
        expect(read.side).toBe(pyramid.size + 2 * pyramid.border);
      }
  });

  it("have the levels and tile ranges Python wrote, and skip only all-missing tiles", () => {
    for (const pyramid of golden.pyramids) {
      expect(tileLevels(pyramid.grid, pyramid.size)).toEqual(
        pyramid.levels.map(({ level, x, y }) => ({ level, x, y })),
      );
      const written = new Set(
        pyramid.tiles.map((t) => `${t.level}/${t.x}/${t.y}`),
      );
      const all = pyramid.levels.flatMap(({ level, x, y }) =>
        Array.from({ length: y[1] - y[0] + 1 }, (_, j) =>
          Array.from(
            { length: x[1] - x[0] + 1 },
            (_, i) => `${level}/${x[0] + i}/${y[0] + j}`,
          ),
        ).flat(),
      );
      expect(all.filter((key) => !written.has(key))).toEqual(
        pyramid.skipped.map((s) => s.join("/")),
      );
    }
    expect(regional.skipped).toEqual([
      [0, 85, 17],
      [1, 42, 8],
    ]);
  });

  it("sample to exactly the values Python sampled, at every level", () => {
    for (const pyramid of golden.pyramids) {
      const tiles = decoded(pyramid);
      for (const point of pyramid.samples) {
        const at = tileOf(
          pyramid.grid,
          point.level,
          point.lat,
          point.lon,
          pyramid.size,
        );
        expect(at && [at.x, at.y]).toEqual(point.tile);
        expect(
          sampleTiled(pyramid, tiles, point.level, point.lat, point.lon),
        ).toEqual(point.expected);
      }
    }
  });
});

/** Grids no writer tiles: see force5/ingest/test_f5tile.py. */
const PAST_THE_EDGE = [
  { west: -180, north: 90, dx: 0.25, dy: 0.25, width: 1441, height: 721 },
  { west: 170, north: 10, dx: 1, dy: 1, width: 20, height: 5 },
  { west: 0, north: -80, dx: 1, dy: 1, width: 5, height: 12 },
];

describe("the global lattice", () => {
  it("accepts the grids we publish and says where they start", () => {
    expect(latticeOrigin(HARMONIE)).toEqual({ column: 6764, row: 1715 });
    expect(latticeOrigin(ICON_EU)).toEqual({ column: 2592, row: 496 });
    expect(latticeOrigin(ECMWF)).toEqual({ column: 648, row: 124 });
  });

  it("refuses a grid off the lattice", () => {
    for (const change of [
      { west: -10.91 },
      { north: 55.71 },
      { dx: 0.03 },
      { dx: 0 },
      { west: -181 },
    ])
      expect(() => latticeOrigin({ ...HARMONIE, ...change })).toThrow(
        /not on the tile lattice/,
      );
  });

  it("refuses a grid past 180° of longitude or south of the pole", () => {
    // f5tile.lattice_origin's cases: a global grid repeating its first column at
    // 180°, a regional one crossing the date line, one reaching past -90°.
    for (const grid of PAST_THE_EDGE)
      expect(() => latticeOrigin(grid)).toThrow(/not on the tile lattice/);
    expect(latticeOrigin({ ...PAST_THE_EDGE[0], width: 1440 })).toEqual({
      column: 0,
      row: 0,
    });
  });

  it("tiles the real grids as the design says", () => {
    expect(tileLevels(HARMONIE)).toEqual([
      { level: 0, x: [52, 54], y: [13, 15] },
      { level: 1, x: [26, 27], y: [6, 7] },
      { level: 2, x: [13, 13], y: [3, 3] },
    ]);
    expect(tileLevels(ICON_EU)).toEqual([
      { level: 0, x: [20, 22], y: [3, 5] },
      { level: 1, x: [10, 11], y: [1, 2] },
      { level: 2, x: [5, 5], y: [0, 1] },
      { level: 3, x: [2, 2], y: [0, 0] },
    ]);
    expect(tileLevels(ECMWF)).toEqual([
      { level: 0, x: [5, 5], y: [0, 1] },
      { level: 1, x: [2, 2], y: [0, 0] },
    ]);
  });

  it("doubles a level's cells at each step", () => {
    const cell = levelCellDegrees(HARMONIE, 2);
    expect(cell.dx).toBeCloseTo(0.1, 12);
    expect(cell.dy).toBeCloseTo(0.08, 12);
  });

  it("names a tile's file with the hour padded like a frame", () => {
    expect(tilePath(0, 52, 13, 7)).toBe("t/0/52/13/007.bin");
    expect(tilePath(2, 13, 3, 120)).toBe("t/2/13/3/120.bin");
  });
});

describe("tiles in view", () => {
  const harmonie = tileLevels(HARMONIE);
  const ireland = { west: -11, south: 51, east: -5, north: 56 };

  it("covers all of Ireland with every tile of a level", () => {
    expect(tilesCovering(HARMONIE, harmonie[0], ireland)).toHaveLength(9);
    expect(tilesCovering(HARMONIE, harmonie[1], ireland)).toHaveLength(4);
    expect(tilesCovering(HARMONIE, harmonie[2], ireland)).toEqual([
      { x: 13, y: 3 },
    ]);
  });

  it("needs one native tile for a bay, and none for somewhere else", () => {
    // Dingle Bay. Tile 53 starts at column 6784, which is exactly -10.4°.
    const bay = { west: -10.4, south: 51.95, east: -9.9, north: 52.2 };
    expect(tilesCovering(HARMONIE, harmonie[0], bay)).toEqual([
      { x: 53, y: 14 },
    ]);
    expect(
      tilesCovering(HARMONIE, harmonie[0], {
        west: 0,
        south: 40,
        east: 2,
        north: 42,
      }),
    ).toEqual([]);
  });

  it("includes the tile for every point a sample in the box would read", () => {
    const box = { west: -9.3, south: 52.9, east: -6.95, north: 54.5 };
    for (const spec of harmonie) {
      const covering = new Set(
        tilesCovering(HARMONIE, spec, box).map((t) => `${t.x}/${t.y}`),
      );
      for (let lat = box.south; lat <= box.north; lat += 0.0137)
        for (let lon = box.west; lon <= box.east; lon += 0.0191) {
          const at = tileOf(HARMONIE, spec.level, lat, lon);
          if (at) expect(covering.has(`${at.x}/${at.y}`)).toBe(true);
        }
    }
  });

  it("wraps a box across the antimeridian on a global grid", () => {
    const [level0] = tileLevels(global.grid, global.size);
    expect(level0.x).toEqual([0, 1]);
    const pacific = { west: 170, south: 10, east: -170, north: 20 };
    expect(tilesCovering(global.grid, level0, pacific, global.size)).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ]);
  });
});

/** A whole frame of the regional golden, as `decodeFrame` would return it. */
function wholeFrame(pyramid: Pyramid): GridFrame {
  // Quantised exactly as the encoder does: half away from zero, then tenths.
  const stored = (values: Values) =>
    values.map((value) => {
      if (value === null) return NaN;
      const scaled = value * 10;
      return (Math.sign(scaled) * Math.floor(Math.abs(scaled) + 0.5)) / 10 + 0;
    });
  return {
    model: "golden",
    run: pyramid.run,
    hour: pyramid.hour,
    validTime: "2026-09-19T06:00:00Z",
    grid: pyramid.grid,
    gustIntervalHours: null,
    u: stored(pyramid.source.u),
    v: stored(pyramid.source.v),
    gust: pyramid.source.gust ? stored(pyramid.source.gust) : null,
  };
}

describe("sampling a tile", () => {
  it("is the whole-frame sampler at level 0, on tile edges and everywhere else", () => {
    const frame = wholeFrame(regional);
    const tiles = decoded(regional);
    const g = regional.grid;
    let compared = 0;
    // Every quarter cell from outside one edge to outside the other: every grid
    // point, every cell middle, every tile edge.
    for (let j = 0; j < 4 * g.height + 4; j++)
      for (let i = 0; i < 4 * g.width + 4; i++) {
        const lat = g.north + 0.2 - (j * g.dy) / 4;
        const lon = g.west - 0.2 + (i * g.dx) / 4;
        const whole = sample(frame, lon, lat);
        const tiled = sampleTiled(regional, tiles, 0, lat, lon);
        if (!whole || Number.isNaN(whole.u) || Number.isNaN(whole.v)) {
          expect(tiled).toBeNull();
          continue;
        }
        compared++;
        // Exactly equal: the same corner, weights and arithmetic.
        expect(tiled).toEqual({
          u: whole.u,
          v: whole.v,
          gust: Number.isNaN(whole.gust!) ? null : whole.gust,
        });
      }
    expect(compared).toBeGreaterThan(3000);
  });

  it("reads both sides of the date line on a global grid", () => {
    const tiles = decoded(global);
    const u = global.source.u;
    const across = sampleTiled(global, tiles, 0, 60, 157.5)!;
    expect(across.u).toBeCloseTo((u[7]! + u[0]!) / 2, 12);
    expect(tileOf(global.grid, 0, 60, 157.5, global.size)).toEqual({
      x: 1,
      y: 0,
    });
    expect(sampleTiled(global, tiles, 0, 45, -200)).toEqual(
      sampleTiled(global, tiles, 0, 45, 160),
    );
  });

  it("returns null outside the domain and refuses the wrong tile", () => {
    const tiles = decoded(regional);
    expect(sampleTiled(regional, tiles, 0, 55.5, -7)).toBeNull();
    expect(sampleTiled(regional, tiles, 0, NaN, -7)).toBeNull();
    // The all-land tile was never written, so the point reads as missing.
    expect(tileOf(regional.grid, 0, 54.9, -9.4, regional.size)).toEqual({
      x: 85,
      y: 17,
    });
    expect(sampleTiled(regional, tiles, 0, 54.9, -9.4)).toBeNull();
    expect(() =>
      sampleTile(tiles.get("0/87/19")!, regional.grid, 53, -7),
    ).toThrow(/not in this forecast tile/);
  });
});

describe("a tile that is not the one that was asked for", () => {
  const tile = regional.tiles.find(
    (t) => t.level === 0 && t.x === 86 && t.y === 18,
  )!;
  const goldenBytes = fileOf(tile);
  const asked = request(regional, tile);
  const wrongRun = /does not match the selected model run/;

  it("reads a header that says what the file is", () => {
    expect(readTileHeader(bytes(goldenBytes))).toEqual({
      version: 1,
      blockCount: 3,
      level: 0,
      border: 1,
      size: 8,
      scale: 10,
      hour: regional.hour,
      run: Number(regional.run),
      x: 86,
      y: 18,
    });
  });

  it("refuses another hour or run", () => {
    expect(() =>
      decodeTile(bytes(goldenBytes), { ...asked, hour: 41 }),
    ).toThrow(wrongRun);
    expect(() =>
      decodeTile(bytes(goldenBytes), { ...asked, run: "2026091713" }),
    ).toThrow(wrongRun);
  });

  it("refuses another level or place", () => {
    for (const change of [{ level: 1 }, { x: 87 }, { y: 17 }])
      expect(() =>
        decodeTile(bytes(goldenBytes), { ...asked, ...change }),
      ).toThrow(/not the one requested/);
  });

  it("refuses another tile shape or block count", () => {
    expect(() =>
      decodeTile(bytes(goldenBytes), { ...asked, size: 128 }),
    ).toThrow(/grids do not match/);
    expect(() =>
      decodeTile(bytes(goldenBytes), { ...asked, border: 0 }),
    ).toThrow(/grids do not match/);
    expect(() =>
      decodeTile(bytes(goldenBytes), { ...asked, blocks: 2 }),
    ).toThrow(/Gust period does not match/);
  });

  it("refuses a truncated, oversized or foreign buffer", () => {
    const frame = Buffer.from(goldenBytes);
    frame.write("F5F1", 0, "latin1"); // A whole frame's magic.
    for (const broken of [
      goldenBytes.subarray(0, goldenBytes.length - 2),
      goldenBytes.subarray(0, TILE_HEADER_BYTES),
      Buffer.concat([goldenBytes, Buffer.alloc(2)]),
      Buffer.alloc(0),
      frame,
    ])
      expect(() => decodeTile(bytes(broken), asked)).toThrow(
        /could not be read/,
      );
  });

  it("refuses a newer version or the reserved bytes", () => {
    const future = Buffer.from(goldenBytes);
    future.writeUInt8(2, 4);
    expect(() => decodeTile(bytes(future), asked)).toThrow(/newer format/);
    for (const at of [22, 23]) {
      const used = Buffer.from(goldenBytes);
      used.writeUInt8(1, at);
      expect(() => decodeTile(bytes(used), asked)).toThrow(/newer format/);
    }
  });

  it("refuses an out-of-range value the encoder would never have written", () => {
    const tampered = Buffer.from(goldenBytes);
    tampered.writeInt16LE(1501, TILE_HEADER_BYTES);
    expect(() => decodeTile(bytes(tampered), asked)).toThrow(
      /Invalid wind data/,
    );
    const side = regional.size + 2 * regional.border;
    const negativeGust = Buffer.from(goldenBytes);
    negativeGust.writeInt16LE(-1, TILE_HEADER_BYTES + 2 * side * side * 2);
    expect(() => decodeTile(bytes(negativeGust), asked)).toThrow(
      /Invalid gust data/,
    );
  });
});
