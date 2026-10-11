import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decodeTile, tileLevels } from "../force5/src/f5tile";
// The Node tile writer the sample generator uses. Building the golden pyramids
// from their sources here and comparing every tile with the file
// force5/ingest/test_f5tile.py wrote pins the two writers to one another, byte
// for byte; force5/src/f5tile.test.ts pins the reader to the same files.
import {
  buildPyramid,
  latticeOrigin,
  levels,
  manifestTiles,
  tilePath,
} from "../scripts/f5tile.mjs";
import { FIXTURE_ROOT } from "./bundles";

interface GoldenPyramid {
  name: string;
  grid: {
    west: number;
    north: number;
    dx: number;
    dy: number;
    width: number;
    height: number;
  };
  size: number;
  border: number;
  hour: number;
  run: string;
  source: {
    u: (number | null)[];
    v: (number | null)[];
    gust: (number | null)[] | null;
  };
  levels: {
    level: number;
    dx: number;
    dy: number;
    columns: number[];
    rows: number[];
    x: number[];
    y: number[];
  }[];
  tiles: { level: number; x: number; y: number; path: string }[];
}

const golden: { pyramids: GoldenPyramid[] } = JSON.parse(
  readFileSync(`${FIXTURE_ROOT}/f5tile/golden.json`, "utf8"),
);

const bytes = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;

describe("the Node tile writer's lattice", () => {
  it("refuses a grid past 180° of longitude or south of the pole, as Python does", () => {
    for (const grid of [
      { west: -180, north: 90, dx: 0.25, dy: 0.25, width: 1441, height: 721 },
      { west: 170, north: 10, dx: 1, dy: 1, width: 20, height: 5 },
      { west: 0, north: -80, dx: 1, dy: 1, width: 5, height: 12 },
    ])
      expect(() => latticeOrigin(grid)).toThrow(/past 180°|south of -90°/);
    expect(
      latticeOrigin({ west: 170, north: 10, dx: 1, dy: 1, width: 10, height: 5 }),
    ).toEqual({ column: 350, row: 80 });
  });
});

describe("the Node tile writer", () => {
  for (const pyramid of golden.pyramids)
    describe(pyramid.name, () => {
      const built = buildPyramid(
        pyramid.grid,
        pyramid.source,
        pyramid.hour,
        pyramid.run,
        { size: pyramid.size, border: pyramid.border },
      );

      it("works out the same levels as the Python writer", () => {
        expect(built.levels).toEqual(pyramid.levels);
        expect(levels(pyramid.grid, pyramid.size)).toEqual(pyramid.levels);
      });

      it("writes exactly the golden tiles, byte for byte", () => {
        expect(
          built.tiles.map((tile) => `${tile.level}/${tile.x}/${tile.y}`),
        ).toEqual(
          pyramid.tiles.map((tile) => `${tile.level}/${tile.x}/${tile.y}`),
        );
        built.tiles.forEach((tile, index) => {
          const file = readFileSync(
            `${FIXTURE_ROOT}/f5tile/${pyramid.tiles[index].path}`,
          );
          expect(Buffer.compare(tile.bytes, file)).toBe(0);
          expect(pyramid.tiles[index].path).toBe(
            `${pyramid.name}/${tilePath(tile.level, tile.x, tile.y, pyramid.hour)}`,
          );
        });
      });

      it("keeps the empty tiles only when asked", () => {
        const all = buildPyramid(
          pyramid.grid,
          pyramid.source,
          pyramid.hour,
          pyramid.run,
          { size: pyramid.size, border: pyramid.border, keepEmpty: true },
        );
        const expected = pyramid.levels.reduce(
          (sum, level) =>
            sum + (level.x[1] - level.x[0] + 1) * (level.y[1] - level.y[0] + 1),
          0,
        );
        expect(all.tiles).toHaveLength(expected);
        // Every kept tile reads back, the empty ones included.
        for (const tile of all.tiles)
          expect(() =>
            decodeTile(bytes(tile.bytes), {
              ...tile,
              hour: pyramid.hour,
              run: pyramid.run,
              size: pyramid.size,
              border: pyramid.border,
              blocks: pyramid.source.gust ? 3 : 2,
            }),
          ).not.toThrow();
      });

      it("describes the levels in a manifest as the browser works them out", () => {
        const tiles = manifestTiles(pyramid.grid, [], {}, pyramid.size);
        expect(
          tiles.levels.map(
            ({ level, x, y }: { level: number; x: number[]; y: number[] }) => ({
              level,
              x,
              y,
            }),
          ),
        ).toEqual(tileLevels(pyramid.grid, pyramid.size));
        expect(tiles.blocks).toEqual(["u", "v"]);
      });
    });

  it("refuses a grid off the lattice and values out of range", () => {
    const grid = {
      west: -10.9,
      north: 55.7,
      dx: 0.3,
      dy: 0.02,
      width: 2,
      height: 2,
    };
    expect(() => levels(grid)).toThrow(/lattice/);
    const onLattice = { ...grid, dx: 0.025 };
    expect(() =>
      buildPyramid(
        onLattice,
        { u: [151, 0, 0, 0], v: [0, 0, 0, 0] },
        0,
        "2026091712",
      ),
    ).toThrow(/150/);
    expect(() =>
      buildPyramid(
        onLattice,
        { u: [0, 0, 0, 0], v: [0, 0, 0, 0], gust: [-1, 0, 0, 0] },
        0,
        "2026091712",
      ),
    ).toThrow(/Negative gust/);
  });
});
