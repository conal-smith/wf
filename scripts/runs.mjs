/**
 * The published run layout, for code that writes runs without the Python
 * pipeline: the synthetic sample bundles (scripts/sample-weather.mjs), the e2e
 * site built from them, and the blend job (force5/blend/build.ts), which
 * publishes the blend as a run of spot squares in production too.
 *
 *   weather/<model>.json                                    the pointer
 *   weather/<model>-<run>-<hours>h-v1-<hash8>/frames/000.bin
 *   weather/<model>-<run>-<hours>h-v1-<hash8>/spots/n52w010.json
 *
 * The same rules as force5/ingest/rundir.py and squares.py, which are the
 * production writers: the run directory is named for the first 8 hex digits of
 * a sha256 over the sorted lines `<path> <sha256 of the file's bytes>\n`, and
 * the per-spot keys move out of the manifest into one file per 2° spot square
 * (`spotSquare`, held to tests/fixtures/squares.json by tests/squares.test.ts).
 */
import { createHash } from "node:crypto";

export const RUN_SCHEMA_VERSION = 2;
export const SQUARE_DEGREES = 2;
export const SQUARE_URL = "spots/{square}.json";
export const SPOT_KEYS = [
  "spotForecasts",
  "spotSeries",
  "spotCoverage",
  "spotMembers",
  "spotCells",
  "spotBlend",
];

const pad = (value, width) => String(Math.abs(value)).padStart(width, "0");

/** The square holding a point, named by its south-west corner on even degrees. */
export function spotSquare(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90)
    throw new Error(`No square for ${lat}, ${lon}`);
  const lat0 = Math.min(
    Math.floor(lat / SQUARE_DEGREES) * SQUARE_DEGREES,
    90 - SQUARE_DEGREES,
  );
  const lon0 =
    ((((Math.floor(lon / SQUARE_DEGREES) * SQUARE_DEGREES + 180) % 360) + 360) %
      360) -
    180;
  return `${lat0 >= 0 ? "n" : "s"}${pad(lat0, 2)}${lon0 >= 0 ? "e" : "w"}${pad(lon0, 3)}`;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A run directory's content hash, from [path inside the run, bytes] pairs. */
export function runDigest(files) {
  const lines = [...files]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, bytes]) => `${path} ${sha256(bytes)}\n`)
    .join("");
  return sha256(Buffer.from(lines)).slice(0, 8);
}

const bytesOf = (value) =>
  Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));

/**
 * A whole manifest, as an adapter holds it, published as a run.
 *
 * `frames` are [hour, suffix, body] in the manifest's frame order; `spots` are
 * the catalogue entries that place each spot in its square. A run with no
 * `frames` key at all (the blend) gets none in its pointer either. Returns the
 * schemaVersion 2 pointer and the files to write, as [path from the directory
 * above weather/, bytes].
 */
export function publishRun(whole, prefix, frameBodies, spots) {
  const where = new Map(
    spots.map((spot) => [spot.id, spotSquare(spot.lat, spot.lon)]),
  );
  const inside = [];
  const frames = (whole.frames ?? []).map((frame, index) => {
    const [hour, suffix, body] = frameBodies[index];
    if (hour !== frame.hour) throw new Error(`Frame ${index} is not +${hour}h`);
    const url = `frames/${String(hour).padStart(3, "0")}.${suffix}`;
    inside.push([url, bytesOf(body)]);
    return { ...frame, url };
  });
  const keys = SPOT_KEYS.filter((key) => key in whole);
  const squares = new Map();
  for (const key of keys)
    for (const [spot, value] of Object.entries(whole[key])) {
      const square = where.get(spot);
      if (!square)
        throw new Error(`${key} names ${spot}, which has no coordinates`);
      if (!squares.has(square)) squares.set(square, {});
      const document = squares.get(square);
      (document[key] ??= {})[spot] = value;
    }
  const names = [...squares.keys()].sort();
  for (const square of names)
    inside.push([
      SQUARE_URL.replace("{square}", square),
      bytesOf({
        schemaVersion: RUN_SCHEMA_VERSION,
        model: whole.model,
        run: whole.run,
        square,
        ...squares.get(square),
      }),
    ]);
  const base = `${prefix}-${runDigest(inside)}/`;
  const pointer = Object.fromEntries(
    Object.entries(whole).filter(([key]) => !SPOT_KEYS.includes(key)),
  );
  pointer.schemaVersion = RUN_SCHEMA_VERSION;
  if ("frames" in whole) pointer.frames = frames;
  if ("frames" in whole && !frames.length && pointer.horizonHours === undefined) {
    const reach = ["spotForecasts", "spotMembers"].flatMap((key) =>
      Object.values(whole[key] ?? {}).flatMap((steps) =>
        steps.length ? [steps[steps.length - 1].hour] : [],
      ),
    );
    if (reach.length) pointer.horizonHours = Math.max(...reach);
  }
  pointer.spots = {
    squareDegrees: SQUARE_DEGREES,
    url: SQUARE_URL,
    squares: names,
    keys,
  };
  pointer.base = base;
  return {
    pointer,
    base,
    files: inside.map(([path, bytes]) => [`weather/${base}${path}`, bytes]),
  };
}
