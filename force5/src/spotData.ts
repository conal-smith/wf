// The one reader of a run's spot data (docs/TILING_DESIGN.md, decisions 4–6).
//
// A forecast pointer (`weather/harmonie.json`, schemaVersion 2) names one run
// directory, `base`, beside itself. The run's per-spot data — `spotForecasts`,
// `spotSeries`, `spotCoverage`, `spotMembers`, `spotCells` — is not in the
// pointer but in one file per 2° spot square inside that directory,
// `spots/<square>.json`, and the pointer lists the squares. The publisher
// (force5/ingest/rundir.py) writes them; everything that reads them, in the
// browser, the forecast server and the blend job, comes through
// `loadSpotSquares` here.
//
// Dependency-free apart from squares.ts, and free of the DOM and of Vite, so
// the forecast server (mcp/api, compiled on its own) imports it as it is. Each
// caller brings its own `ReadJson`: `fetch` in the browser, the forecast
// source in the server, the disk in the blend job.
import { SQUARE_DEGREES, SQUARE_NAME } from "./squares.js";

export { SQUARE_DEGREES, spotSquare, squaresFor } from "./squares.js";

/** The schema every run pointer and every square file is published at. */
export const RUN_SCHEMA_VERSION = 2;
/**
 * Every per-spot key a run may carry, in the order the publisher writes them.
 * `spotBlend` is the blend's (src/spotBlend.ts), a run of squares of its own
 * read through this same loader; no model carries it.
 */
export const SPOT_KEYS = [
  "spotForecasts",
  "spotSeries",
  "spotCoverage",
  "spotMembers",
  "spotCells",
  "spotBlend",
] as const;
export type SpotKey = (typeof SPOT_KEYS)[number];
/** Where a square file sits inside its run directory. */
export const SQUARE_URL = "spots/{square}.json";
/** `<model>-<run>-<hours>h-v<N>-<hash8>`: a run directory's name (rundir.py). */
const RUN_DIRECTORY = /^[a-z0-9][a-z0-9.-]*-[0-9a-f]{8}$/;

/** The pointer's `spots` block: which squares the run publishes, and which keys. */
export interface SpotIndex {
  squareDegrees: number;
  url: string;
  squares: string[];
  keys: SpotKey[];
}
/** The parts of a run pointer the loader needs. */
export interface RunPointer {
  model: string;
  run: string;
  base: string;
  spots: SpotIndex;
}
/** Per-spot data, merged across the squares read: key → spot id → value. */
export type SpotData = Partial<Record<SpotKey, Record<string, unknown>>>;
/** One square file as published. */
export interface SquareFile extends SpotData {
  schemaVersion: number;
  model: string;
  run: string;
  square: string;
}
/**
 * Read one published JSON file, by its path relative to the site root
 * (`weather/harmonie-…-1a2b3c4d/spots/n52w010.json`). A file that is not there
 * may resolve to null or reject; either way the load fails.
 */
export type ReadJson = (path: string) => Promise<unknown>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A pointer's `base`: one run directory beside it, ending in `/`. */
export function checkBase(base: unknown): string {
  if (
    typeof base !== "string" ||
    !base.endsWith("/") ||
    !RUN_DIRECTORY.test(base.slice(0, -1))
  )
    throw new Error(`Unusable run directory ${JSON.stringify(base)}.`);
  return base;
}

/** A path inside a run directory: relative, and never leaving it. */
export function checkRunPath(relative: unknown): string {
  if (
    typeof relative !== "string" ||
    !relative ||
    relative.startsWith("/") ||
    relative.includes("\\") ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(
      `Unusable path ${JSON.stringify(relative)} inside a run directory.`,
    );
  return relative;
}

/**
 * A file of a run, as a path from the site root: the pointer's own directory,
 * then `base`, then the path inside the run. `weather/harmonie.json` with base
 * `harmonie-…-1a2b3c4d/` and `frames/000.bin` is
 * `weather/harmonie-…-1a2b3c4d/frames/000.bin`.
 */
export function runPath(
  pointerPath: string,
  base: string,
  relative: string,
): string {
  const directory = pointerPath.includes("/")
    ? pointerPath.slice(0, pointerPath.lastIndexOf("/") + 1)
    : "";
  return `${directory}${checkBase(base)}${checkRunPath(relative)}`;
}

/** The pointer's `spots` block, checked. */
export function checkSpotIndex(index: unknown): SpotIndex {
  if (
    !isObject(index) ||
    index.squareDegrees !== SQUARE_DEGREES ||
    index.url !== SQUARE_URL
  )
    throw new Error("The forecast lists no usable spot squares.");
  const { squares, keys } = index;
  if (
    !Array.isArray(squares) ||
    !squares.every(
      (square, i) =>
        typeof square === "string" &&
        SQUARE_NAME.test(square) &&
        (i === 0 || square > (squares[i - 1] as string)),
    )
  )
    throw new Error("The forecast's spot squares are not sorted square names.");
  if (
    !Array.isArray(keys) ||
    new Set(keys).size !== keys.length ||
    !keys.every((key) => (SPOT_KEYS as readonly unknown[]).includes(key))
  )
    throw new Error("The forecast's spot keys are not per-spot keys.");
  return index as unknown as SpotIndex;
}

/** Where one square of a run is, from the site root. */
export const squarePath = (
  pointerPath: string,
  manifest: Pick<RunPointer, "base" | "spots">,
  square: string,
): string =>
  runPath(
    pointerPath,
    manifest.base,
    checkSpotIndex(manifest.spots).url.replace("{square}", square),
  );

/** A square file read back: its envelope, and only declared per-spot keys. */
export function checkSquare(
  manifest: Pick<RunPointer, "model" | "run" | "spots">,
  square: string,
  body: unknown,
): SquareFile {
  if (!isObject(body) || body.schemaVersion !== RUN_SCHEMA_VERSION)
    throw new Error(`Spot square ${square} is not a schema 2 square.`);
  if (
    body.model !== manifest.model ||
    body.run !== manifest.run ||
    body.square !== square
  )
    throw new Error(
      `Spot square ${square} belongs to another model, run or square.`,
    );
  const keys = manifest.spots.keys as readonly string[];
  for (const key of Object.keys(body)) {
    if (["schemaVersion", "model", "run", "square"].includes(key)) continue;
    if (!keys.includes(key))
      throw new Error(`Spot square ${square} carries an undeclared ${key}.`);
    if (!isObject(body[key]) || !Object.keys(body[key]).length)
      throw new Error(
        `Spot square ${square} has an empty or malformed ${key}.`,
      );
  }
  return body as unknown as SquareFile;
}

/** A square already read, or on its way, per reader: the files are immutable. */
const CACHE_LIMIT = 256;
const caches = new WeakMap<ReadJson, Map<string, Promise<SquareFile>>>();

function cacheFor(read: ReadJson) {
  let cache = caches.get(read);
  if (!cache) caches.set(read, (cache = new Map()));
  return cache;
}

/** Forget every square a reader has kept, or the one for a path. */
export function clearSpotSquares(read: ReadJson, path?: string): void {
  if (path === undefined) caches.delete(read);
  else caches.get(read)?.delete(path);
}

function readSquare(
  read: ReadJson,
  pointerPath: string,
  manifest: RunPointer,
  square: string,
): Promise<SquareFile> {
  // The base carries the run directory's content hash, so the path alone names
  // exactly one file for ever: a cache keyed by it can never go stale.
  const path = squarePath(pointerPath, manifest, square);
  const cache = cacheFor(read);
  const hit = cache.get(path);
  if (hit) {
    cache.delete(path);
    cache.set(path, hit);
    return hit;
  }
  const loading = Promise.resolve()
    .then(() => read(path))
    .then((body) => {
      if (body === null || body === undefined)
        throw new Error(
          `Spot square ${square} of ${manifest.model} is missing.`,
        );
      return checkSquare(manifest, square, body);
    });
  cache.set(path, loading);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  // A failure is not kept: the next ask tries again.
  loading.catch(() => {
    if (cache.get(path) === loading) cache.delete(path);
  });
  return loading;
}

/**
 * The per-spot data of a run, merged from its squares.
 *
 * `squares` limits the read to those squares — the square of the one spot a
 * page is about, say — and a square the run does not list is simply skipped:
 * it holds none of this model's spots. Omitted, every square the run lists is
 * read, which is what a reader that needs every spot (the browser's own blend,
 * the blend job) asks for. Reads are shared while in flight and kept after, per
 * `read` function. Every key the run declares is present in the answer, empty
 * when no square read carries it; a spot found in two squares is refused.
 */
export async function loadSpotSquares<T extends SpotData = SpotData>(
  read: ReadJson,
  pointerPath: string,
  manifest: RunPointer,
  squares?: readonly string[],
): Promise<T> {
  checkBase(manifest.base);
  const index = checkSpotIndex(manifest.spots);
  const listed = new Set(index.squares);
  const wanted =
    squares === undefined
      ? index.squares
      : [...new Set(squares)].filter((square) => listed.has(square)).sort();
  const files = await Promise.all(
    wanted.map((square) => readSquare(read, pointerPath, manifest, square)),
  );
  const merged: SpotData = {};
  for (const key of index.keys) merged[key] = {};
  for (const file of files)
    for (const key of index.keys) {
      const values = file[key];
      if (!values) continue;
      const into = merged[key]!;
      for (const [spot, value] of Object.entries(values)) {
        if (spot in into)
          throw new Error(`${spot} appears in two spot squares of ${key}.`);
        into[spot] = value;
      }
    }
  return merged as T;
}

/** The pointer with its spot data merged back in: the shape adapters build. */
export async function withSpotSquares<
  M extends RunPointer,
  T extends SpotData = SpotData,
>(
  read: ReadJson,
  pointerPath: string,
  manifest: M,
  squares?: readonly string[],
): Promise<M & T> {
  return {
    ...manifest,
    ...(await loadSpotSquares<T>(read, pointerPath, manifest, squares)),
  };
}
