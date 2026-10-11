// Types for scripts/f5tile.mjs, the Node tile writer, for the TypeScript tests
// that use it as a server (force5/src/tiledField.test.ts).
export const TILE_ENCODING: string;
export const TILE_SIZE: number;
export const TILE_BORDER: number;
export const TILE_URL: string;

export interface WriterGrid {
  west: number;
  north: number;
  dx: number;
  dy: number;
  width: number;
  height: number;
}

export interface WriterLevel {
  level: number;
  dx: number;
  dy: number;
  columns: [number, number];
  rows: [number, number];
  x: [number, number];
  y: [number, number];
}

export function latticeOrigin(grid: WriterGrid): {
  column: number;
  row: number;
};
export function levels(grid: WriterGrid, size?: number): WriterLevel[];
export function tilePath(
  level: number,
  x: number,
  y: number,
  hour: number,
): string;
export function buildPyramid(
  grid: WriterGrid,
  fields: {
    u: (number | null)[];
    v: (number | null)[];
    gust?: (number | null)[] | null;
  },
  hour: number,
  run: string,
  options?: { size?: number; border?: number; keepEmpty?: boolean },
): {
  levels: WriterLevel[];
  tiles: { level: number; x: number; y: number; bytes: Buffer }[];
};
export function tileBlocks(
  frames: readonly { gustIntervalHours: [number, number] | null }[],
): string[];
export function manifestTiles(
  grid: WriterGrid,
  frames: readonly { gustIntervalHours: [number, number] | null }[],
  absent?: Record<number, [number, number][]>,
  size?: number,
): {
  size: number;
  border: number;
  encoding: string;
  blocks: string[];
  url: string;
  levels: (Omit<WriterLevel, "columns" | "rows"> & {
    absent: [number, number][];
  })[];
};
