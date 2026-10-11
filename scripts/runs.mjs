/**
 * The published run layout, for code that writes runs without the Python
 * pipeline: the synthetic sample bundles (scripts/sample-weather.mjs), the e2e
 * site built from them, and the blend job (force5/blend/build.ts), which
 * publishes the blend as a run of spot squares in production too.
 *
 *   weather/<model>.json                                    the pointer
 *   weather/<model>-<run>-<hours>h-v1-<hash8>/t/1/26/6/000.bin   a wind frame's tile
 *   weather/<model>-<run>-<hours>h-v1-<hash8>/frames/000.json    a wave frame
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

/**
 * The square holding a point, named by its south-west corner on even degrees.
 * A point past 90° of latitude or 180° of longitude is a catalogue typo, and is
 * refused rather than wrapped into some other square.
 */
export function spotSquare(lat, lon) {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
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

/** squares.SUPERSEDED_KEEP_HOURS and SUPERSEDED_LIMIT. */
export const SUPERSEDED_KEEP_HOURS = 6;
export const SUPERSEDED_LIMIT = 24;
const RUN_BASE = /^[a-z0-9][a-z0-9.-]*-[0-9a-f]{8}\/$/;
const isoSecond = (time) =>
  new Date(time).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * A `superseded` entry's time: RFC 3339 with seconds and an offset, the only
 * form either writer produces (squares.SUPERSEDED_TIME).
 */
const SUPERSEDED_TIME =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]+)?(?:(Z)|([+-])([0-9]{2}):([0-9]{2}))$/;

/**
 * A `superseded` entry's time in milliseconds, to the second, or null when it
 * cannot be read: squares.superseded_time. Anything but `SUPERSEDED_TIME` is
 * null, and so is a date that does not exist (2026-02-30, which `Date` would
 * roll over into March), an offset past 23:59, or a year Python cannot hold.
 * A fraction of a second is accepted and dropped.
 */
export function supersededTime(value) {
  const match = typeof value === "string" ? SUPERSEDED_TIME.exec(value) : null;
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  let offset = 0;
  if (!match[7]) {
    const hours = Number(match[9]);
    const minutes = Number(match[10]);
    if (hours > 23 || minutes > 59) return null;
    offset = (hours * 60 + minutes) * (match[8] === "+" ? 1 : -1);
  }
  // setUTCFullYear, not Date.UTC, which reads years 0-99 as 1900-1999.
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, 0);
  if (
    year < 1 ||
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  )
    return null;
  const when = local.getTime() - offset * 60000;
  const utcYear = new Date(when).getUTCFullYear();
  return utcYear >= 1 && utcYear <= 9999 ? when : null;
}

/**
 * The `superseded` list for `pointer`, about to replace `previous` (or null):
 * squares.retire, so the pruners keep the run directory `previous` named for
 * readers still holding it. What `previous` remembered, younger than six
 * hours, and its own `base` at `now` when that is not `pointer`'s. An entry
 * whose time cannot be read (`supersededTime`) counts as `now`.
 */
export function retire(previous, pointer, now = Date.now()) {
  const live = pointer.base;
  const cutoff = now - SUPERSEDED_KEEP_HOURS * 3600000;
  const retired = new Map();
  const entries = Array.isArray(previous?.superseded) ? previous.superseded : [];
  for (const entry of entries) {
    if (!entry || typeof entry.base !== "string" || !RUN_BASE.test(entry.base))
      continue;
    const when = supersededTime(entry.at) ?? now;
    if (entry.base !== live && when > cutoff)
      retired.set(entry.base, Math.max(when, retired.get(entry.base) ?? when));
  }
  const old = previous?.base;
  if (typeof old === "string" && old !== live && RUN_BASE.test(old))
    retired.set(old, now);
  return [...retired]
    .sort(([a, x], [b, y]) => x - y || (a < b ? -1 : a > b ? 1 : 0))
    .slice(-SUPERSEDED_LIMIT)
    .map(([base, when]) => ({ base, at: isoSecond(when) }));
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

/**
 * A JSON file of a run, as text: rundir.json_body's compact JSON, which refuses
 * NaN and ±Infinity rather than writing them as null the way JSON.stringify
 * does, so a square the blend writes cannot carry a value Python would refuse.
 */
export function jsonText(value) {
  return JSON.stringify(value, (key, item) => {
    if (typeof item === "number" && !Number.isFinite(item))
      throw new Error(`A run file cannot hold ${item} (at "${key}"): JSON has no such number.`);
    return item;
  });
}

const bytesOf = (value) =>
  Buffer.isBuffer(value) ? value : Buffer.from(jsonText(value));

/** The series keys a frameless run is timed by: squares.SERIES_KEYS. */
const SERIES_KEYS = ["spotForecasts", "spotSeries", "spotMembers"];

/**
 * The last hour any spot's series reaches, or undefined: a frameless run's
 * horizon, by squares.series_horizon's rule. Each series' last step, where its
 * hour is a whole number.
 */
export function seriesHorizon(whole) {
  const last = [];
  for (const key of SERIES_KEYS) {
    const values = whole[key];
    if (!values || typeof values !== "object" || Array.isArray(values)) continue;
    for (const steps of Object.values(values)) {
      const step = Array.isArray(steps) ? steps[steps.length - 1] : undefined;
      if (step && typeof step === "object" && Number.isInteger(step.hour))
        last.push(step.hour);
    }
  }
  return last.length ? Math.max(...last) : undefined;
}

/**
 * A whole manifest, as an adapter holds it, published as a run.
 *
 * A wave or weather run's `frameBodies` are [hour, suffix, body] in the
 * manifest's frame order. A wind run's frames name no file: its `tiles` block
 * is already in the manifest (scripts/f5tile.mjs, `manifestTiles`) and its
 * tiles come in `tileFiles`, [path inside the run, bytes], as rundir.write_run
 * leaves them once it has settled which are absent. A run with no `frames` key
 * at all (the blend) gets none in its pointer either. `spots` are the
 * catalogue entries that place each spot in its square. Returns the
 * schemaVersion 2 pointer and the files to write, as [path from the directory
 * above weather/, bytes].
 */
export function publishRun(whole, prefix, frameBodies, spots, tileFiles = []) {
  const where = new Map(
    spots.map((spot) => [spot.id, spotSquare(spot.lat, spot.lon)]),
  );
  const inside = tileFiles.map(([path, bytes]) => [path, bytesOf(bytes)]);
  const frames = whole.tiles
    ? whole.frames.map((frame) => ({ ...frame }))
    : (whole.frames ?? []).map((frame, index) => {
        const [hour, suffix, body] = frameBodies[index];
        if (hour !== frame.hour)
          throw new Error(`Frame ${index} is not +${hour}h`);
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
  // `superseded` belongs to the pointer this run replaces: see `retire`.
  const pointer = Object.fromEntries(
    Object.entries(whole).filter(
      ([key]) => !SPOT_KEYS.includes(key) && key !== "superseded",
    ),
  );
  pointer.schemaVersion = RUN_SCHEMA_VERSION;
  if ("frames" in whole) pointer.frames = frames;
  // A frameless run, frames empty or absent, states how far it reaches, as
  // squares.split_spot_data does.
  if (!frames.length && !("horizonHours" in whole)) {
    const horizon = seriesHorizon(whole);
    if (horizon !== undefined) pointer.horizonHours = horizon;
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
