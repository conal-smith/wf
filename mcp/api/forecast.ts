/**
 * The forecast as an agent reads it: every wind model's precomputed series for
 * a riding location, reduced to one consensus line per hour, beside the waves,
 * surface weather, tides, sea temperature and daylight the dock shows.
 *
 * It reads the published bundles (see source.ts) and nothing else: each model's
 * pointer, and the spot squares of its run that hold the places asked about,
 * through the site's own loader (force5/src/spotData.ts). Speeds are stored in
 * m/s and answered in knots; directions are degrees the wind or the sea comes
 * FROM, as everywhere on the site.
 *
 * The consensus is deliberately simple and says so: one line per model — an
 * ensemble's member mean counts once, like any other model. Its headline wind,
 * gust and direction are HARMONIE's own forecast while HARMONIE reaches the
 * hour (`LEAD_MODEL`, force5/src/weights.ts), and past it a weighted median of
 * the other models, each counted by how well it verified that far into its run
 * (`modelWeight`), with a weighted mean bearing. The range and the agreement
 * label, the same the dock's blend gives (force5/src/blend.ts), are read
 * across every model either way. It is not bias-corrected.
 *
 * Beside it, where an ensemble reaches the spot, the spread of its members (ECMWF
 * ENS and GEFS, each member its own run). Both ensembles are retired for now
 * (force5/src/manifests.ts), so no forecast carries it until one is switched back on.
 */
import {
  RUN_SCHEMA_VERSION,
  checkBase,
  checkSpotIndex,
  loadSpotSquares,
  spotSquare,
  squaresFor,
  type ReadJson,
} from "../../force5/src/spotData.js";
import { sunTimes } from "../../force5/src/sun.js";
import { KNOTS } from "../../force5/src/units.js";
import {
  AGREEMENT_SPREAD_KN,
  LEAD_MODEL,
  agreementFrom,
  leadHours,
  modelWeight,
  weightedMedian,
  type Agreement,
} from "../../force5/src/weights.js";
import type { ForecastSource } from "./httpSource.js";

const HOUR = 3600000;
/** A run older than this is flagged stale, as the map flags it. */
const STALE_HOURS = 18;
/** Waves and weather are nearest-step, never interpolated (VARIABLE_MATCH_HOURS). */
const VARIABLE_MATCH_HOURS = 1.5;
export const TIME_ZONE = "Europe/Dublin";
export const MAX_WINDOW_HOURS = 240;
export const STEP_HOURS: readonly number[] = [1, 3, 6];

export interface CatalogEntry {
  id: string;
  name: string;
  manifestUrl: string;
}

/**
 * The live wind models, as force5/src/manifests.ts lists them. That module
 * reads Vite's environment and cannot load in Node, so the ids and paths are
 * repeated here; forecast.test.ts fails if the two lists ever drift.
 */
export const WIND_MODELS: readonly CatalogEntry[] = [
  { id: "harmonie", name: "HARMONIE", manifestUrl: "weather/harmonie.json" },
  { id: "icon-eu", name: "ICON-EU", manifestUrl: "weather/latest.json" },
  { id: "ecmwf", name: "ECMWF", manifestUrl: "weather/ecmwf.json" },
  { id: "gfs", name: "GFS", manifestUrl: "weather/gfs.json" },
];
/** Finest first, as WAVE_SOURCE_PREFERENCE in force5/src/waves.ts. */
export const WAVE_MODELS: readonly CatalogEntry[] = [
  { id: "mi-swan", name: "MI SWAN", manifestUrl: "weather/mi-swan.json" },
  { id: "gfs-wave", name: "GFS-Wave", manifestUrl: "weather/gfs-wave.json" },
];
export const WEATHER_MODELS: readonly CatalogEntry[] = [
  {
    id: "icon-eu-weather",
    name: "ICON-EU weather",
    manifestUrl: "weather/icon-eu-weather.json",
  },
];
export const SPOTS_URL = "riding-locations.json";
export const TIDES_URL = "marine/tides.json";
export const SEA_TEMPERATURE_URL = "marine/sea-temperature.json";

// ---- small helpers ----------------------------------------------------------

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const text = (value: unknown) => (typeof value === "string" ? value : null);
const round = (value: number, places = 1) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};
const knots = (metresPerSecond: number) => round(metresPerSecond * KNOTS);

/** Degrees the wind blows FROM, for u/v components (force5's `direction`). */
export const bearing = (u: number, v: number) =>
  Math.round(((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360) % 360;
const COMPASS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];
export const compass = (degrees: number) =>
  COMPASS[Math.round(degrees / 22.5) % 16];

const localFormat = new Intl.DateTimeFormat("en-IE", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
/** "Wed, 16 Sept, 19:00" in Irish time, for an agent to repeat verbatim. */
export const localTime = (millis: number) =>
  localFormat.format(new Date(millis));
const iso = (millis: number) => new Date(millis).toISOString();

export type { Agreement };

// ---- spots ------------------------------------------------------------------

export interface RidingSpot {
  id: string;
  name: string;
  county: string;
  lat: number;
  lon: number;
}

export async function loadSpots(source: ForecastSource): Promise<RidingSpot[]> {
  const body = await source.json(SPOTS_URL);
  if (!Array.isArray(body))
    throw new Error("The riding locations are not published.");
  return body.flatMap((row): RidingSpot[] => {
    if (!isObject(row)) return [];
    const { id, name, county, lat, lon } = row;
    if (typeof id !== "string" || typeof name !== "string") return [];
    if (!finite(lat) || !finite(lon)) return [];
    return [{ id, name, county: text(county) ?? "", lat, lon }];
  });
}

/** Lower case, no accents, words only: "Seancheibh an Spidéil" → "seancheibh an spideil". */
export const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export type SpotMatch =
  { spot: RidingSpot } | { spot: null; candidates: RidingSpot[] };

/**
 * A spot from what an agent typed: its id, its name, part of its name, or a
 * county. Anything short of one clear answer returns the candidates, so the
 * agent can ask its user rather than guess.
 */
export function findSpot(
  spots: readonly RidingSpot[],
  query: string,
): SpotMatch {
  const q = fold(query);
  if (!q) return { spot: null, candidates: [...spots] };
  const byId = spots.find((s) => s.id === query.trim());
  if (byId) return { spot: byId };
  const exact = spots.filter((s) => fold(s.name) === q);
  if (exact.length === 1) return { spot: exact[0] };
  const partial = spots.filter((s) => {
    const name = fold(s.name);
    return name.includes(q) || q.includes(name);
  });
  if (partial.length === 1) return { spot: partial[0] };
  if (partial.length > 1) return { spot: null, candidates: partial };
  const county = spots.filter((s) => fold(s.county) === q);
  if (county.length === 1) return { spot: county[0] };
  return { spot: null, candidates: county };
}

// ---- manifests --------------------------------------------------------------

export interface ModelRun {
  id: string;
  name: string;
  provider: string;
  run_time: string;
  /** The last hour this run forecasts. */
  until: string;
  stale: boolean;
  attribution: string;
  license_url: string;
}
export interface Unavailable {
  id: string;
  name: string;
  reason: string;
}

interface Loaded<T> {
  entry: CatalogEntry;
  run: ModelRun;
  manifest: T;
}

interface WindPoint {
  time: number;
  u: number;
  v: number;
  gust: number | null;
}
interface WindManifest {
  spotForecasts: Record<string, unknown>;
  /** The grid's spacing, which sets the model's weight in the consensus. */
  resolutionKm?: number | null;
  gustAvailable?: boolean;
  /** Ensembles only: how many members each frame of `spotMembers` holds. */
  ensemble?: { members?: number };
  /** Ensembles only: every member's own series, one frame per step. */
  spotMembers?: Record<string, unknown>;
}
interface VariableStep {
  time: number;
  values: Record<string, number | null>;
}
interface VariablesManifest {
  variables: Record<string, { units?: string; label?: string }>;
  spotSeries: Record<string, unknown>;
}

function runOf(
  entry: CatalogEntry,
  body: Json,
  until: number,
  now: number,
): ModelRun {
  const runTime = Date.parse(body.runTime as string);
  return {
    id: entry.id,
    name: text(body.modelName) ?? entry.name,
    provider: text(body.provider) ?? "",
    run_time: iso(runTime),
    until: iso(until),
    stale: now - runTime > STALE_HOURS * HOUR,
    attribution: text(body.attribution) ?? "",
    license_url: text(body.licenseUrl) ?? "",
  };
}

/** The last time a run reaches: its last frame, or the horizon it states. */
function lastTime(body: Json): number | null {
  const frames = Array.isArray(body.frames) ? (body.frames as Json[]) : [];
  if (frames.length) {
    const end = Date.parse(frames[frames.length - 1]?.validTime as string);
    return Number.isFinite(end) ? end : null;
  }
  const horizon = body.horizonHours;
  return finite(horizon)
    ? Date.parse(body.runTime as string) + horizon * HOUR
    : null;
}

/** A run pointer this server reads: schemaVersion 2, its run directory beside it. */
function runPointer(body: Json, seriesKey: string): boolean {
  try {
    checkBase(body.base);
    return (
      body.schemaVersion === RUN_SCHEMA_VERSION &&
      (checkSpotIndex(body.spots).keys as string[]).includes(seriesKey)
    );
  } catch {
    return false;
  }
}

/** One reader per source, so the loader's cache of squares is per source too. */
const readers = new WeakMap<ForecastSource, ReadJson>();
function readerOf(source: ForecastSource): ReadJson {
  let read = readers.get(source);
  if (!read) readers.set(source, (read = (path) => source.json(path)));
  return read;
}

/**
 * Which spot squares to read: the squares of these places, every square the
 * run lists (`undefined`), or none (`null`, for a caller that only wants to
 * know which runs are published).
 */
export type Squares = readonly string[] | undefined | null;

/**
 * Every manifest in a catalogue that is published, sound and not yet expired,
 * with the spot data of `squares` merged in. A model that is missing, broken or
 * over is reported, never thrown: the answer is still worth giving with the
 * models that are there.
 */
async function loadCatalog<T>(
  source: ForecastSource,
  entries: readonly CatalogEntry[],
  seriesKey: "spotForecasts" | "spotSeries",
  now: number,
  squares: Squares,
): Promise<{ loaded: Loaded<T>[]; unavailable: Unavailable[] }> {
  const read = readerOf(source);
  const results = await Promise.all(
    entries.map(async (entry) => {
      const miss = (reason: string) => ({
        unavailable: { id: entry.id, name: entry.name, reason },
      });
      const pointer = async (): Promise<
        { body: Json; until: number } | { unavailable: Unavailable }
      > => {
        let body: unknown;
        try {
          body = await source.json(entry.manifestUrl);
        } catch {
          return miss("Could not be read just now.");
        }
        if (body === null) return miss("Not published.");
        if (
          !isObject(body) ||
          body.model !== entry.id ||
          !Number.isFinite(Date.parse(body.runTime as string)) ||
          !runPointer(body, seriesKey)
        )
          return miss(
            "The published file is not a forecast this server reads.",
          );
        const until = lastTime(body);
        if (until === null || until < now)
          return miss("The latest published run has already ended.");
        return { body, until };
      };
      let found = await pointer();
      if ("unavailable" in found) return found;
      let spots: Json = {};
      if (squares !== null)
        try {
          spots = await loadSpotSquares(
            read,
            entry.manifestUrl,
            found.body as never,
            squares,
          );
        } catch {
          // The cached pointer may name a run since replaced, whose directory
          // has gone: read the pointer again and try once more from the run it
          // names now.
          const shown = found.body.base;
          source.forget?.(entry.manifestUrl);
          found = await pointer();
          if ("unavailable" in found) return found;
          if (found.body.base === shown)
            return miss("Its spot data could not be read just now.");
          try {
            spots = await loadSpotSquares(
              read,
              entry.manifestUrl,
              found.body as never,
              squares,
            );
          } catch {
            return miss("Its spot data could not be read just now.");
          }
        }
      const { body, until } = found;
      return {
        loaded: {
          entry,
          run: runOf(entry, body, until, now),
          manifest: { ...body, [seriesKey]: {}, ...spots } as unknown as T,
        },
      };
    }),
  );
  return {
    loaded: results.flatMap((r) => ("loaded" in r ? [r.loaded] : [])),
    unavailable: results.flatMap((r) =>
      "unavailable" in r ? [r.unavailable] : [],
    ),
  };
}

export const loadWind = (
  source: ForecastSource,
  now: number,
  squares?: Squares,
) =>
  loadCatalog<WindManifest>(source, WIND_MODELS, "spotForecasts", now, squares);
export const loadWaves = (
  source: ForecastSource,
  now: number,
  squares?: Squares,
) =>
  loadCatalog<VariablesManifest>(
    source,
    WAVE_MODELS,
    "spotSeries",
    now,
    squares,
  );
export const loadWeather = (
  source: ForecastSource,
  now: number,
  squares?: Squares,
) =>
  loadCatalog<VariablesManifest>(
    source,
    WEATHER_MODELS,
    "spotSeries",
    now,
    squares,
  );

/**
 * One model's series for one spot, or null when the model cannot see it. A
 * series of nulls is a model saying the spot is outside its domain (AROME
 * stops at 55.4°N), not a forecast of calm.
 */
function windPoints(
  manifest: WindManifest,
  spotId: string,
): WindPoint[] | null {
  const series = manifest.spotForecasts[spotId];
  if (!Array.isArray(series)) return null;
  const points = series.flatMap((row): WindPoint[] => {
    if (!isObject(row) || !finite(row.u) || !finite(row.v)) return [];
    const time = Date.parse(row.validTime as string);
    if (!Number.isFinite(time)) return [];
    const gust =
      manifest.gustAvailable !== false && finite(row.gust) ? row.gust : null;
    return [{ time, u: row.u, v: row.v, gust }];
  });
  return points.length ? points.sort((a, b) => a.time - b.time) : null;
}

function variableSteps(
  manifest: VariablesManifest,
  spotId: string,
): VariableStep[] | null {
  const series = manifest.spotSeries[spotId];
  if (!Array.isArray(series)) return null;
  const steps = series.flatMap((row): VariableStep[] => {
    if (!isObject(row) || !isObject(row.values)) return [];
    const time = Date.parse(row.validTime as string);
    if (!Number.isFinite(time)) return [];
    const values: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(row.values))
      values[key] = finite(value) ? value : null;
    return [{ time, values }];
  });
  return steps.length ? steps : null;
}

/** Twice the series' median cadence: bridges ECMWF's 3 → 6 h tail, not a hole. */
function maxGap(points: readonly { time: number }[]): number {
  const steps: number[] = [];
  for (let i = 1; i < points.length; i++)
    steps.push(points[i].time - points[i - 1].time);
  if (!steps.length) return 0;
  steps.sort((a, b) => a - b);
  return 2 * steps[Math.floor((steps.length - 1) / 2)];
}

/** Wind at a time, interpolated in u/v so a veering wind keeps its vector. */
function windAt(points: readonly WindPoint[], time: number, gap: number) {
  if (!points.length) return null;
  if (time < points[0].time || time > points[points.length - 1].time)
    return null;
  const right = points.findIndex((p) => p.time >= time);
  const b = points[right];
  if (b.time === time) return b;
  const a = points[right - 1];
  if (b.time - a.time > gap + 1) return null;
  const f = (time - a.time) / (b.time - a.time);
  return {
    time,
    u: a.u + (b.u - a.u) * f,
    v: a.v + (b.v - a.v) * f,
    gust:
      a.gust === null || b.gust === null
        ? null
        : a.gust + (b.gust - a.gust) * f,
  };
}

function stepAt(steps: readonly VariableStep[], time: number) {
  let best: VariableStep | null = null;
  for (const step of steps)
    if (!best || Math.abs(step.time - time) < Math.abs(best.time - time))
      best = step;
  return best && Math.abs(best.time - time) <= VARIABLE_MATCH_HOURS * HOUR
    ? best
    : null;
}

const pick = (manifest: VariablesManifest, names: readonly string[]) =>
  names.find((name) => name in (manifest.variables ?? {})) ?? null;

// ---- the window --------------------------------------------------------------

export interface Window {
  from: number;
  to: number;
  stepHours: number;
}

/** The hours to answer for: from the top of the current hour unless asked later. */
export function windowFor(
  now: number,
  options: { from?: string; hours?: number; stepHours?: number } = {},
): Window {
  const hourNow = Math.floor(now / HOUR) * HOUR;
  const asked = options.from ? Date.parse(options.from) : NaN;
  const from = Number.isFinite(asked)
    ? Math.max(hourNow, Math.ceil(asked / HOUR) * HOUR)
    : hourNow;
  const hours = Math.min(
    MAX_WINDOW_HOURS,
    Math.max(1, Math.round(options.hours ?? 48)),
  );
  const stepHours =
    options.stepHours !== undefined && STEP_HOURS.includes(options.stepHours)
      ? options.stepHours
      : hours <= 24
        ? 1
        : 3;
  return { from, to: from + hours * HOUR, stepHours };
}

export function axis(window: Window): number[] {
  const times: number[] = [];
  for (let t = window.from; t <= window.to; t += window.stepHours * HOUR)
    times.push(t);
  return times;
}

/** Sunrise to sunset at the spot, the same equations the dock draws night from. */
export function daylight(spot: RidingSpot, time: number): boolean {
  const sun = sunTimes(spot.lat, spot.lon, new Date(time));
  if (sun.polar) return sun.polar === "day";
  return (
    !!sun.sunrise &&
    !!sun.sunset &&
    time >= sun.sunrise.getTime() &&
    time <= sun.sunset.getTime()
  );
}

// ---- wind consensus ------------------------------------------------------------
// spotWindLines and hourWind are exported for the companion (companion/api),
// which rates the same consensus hour by hour for a rider.

export interface ModelWind {
  wind_kn: number;
  gust_kn: number | null;
  direction_deg: number;
}
export interface HourWind {
  /**
   * The headline speed: the lead model's own (HARMONIE, `LEAD_MODEL`) while it
   * reaches the hour; past it, the weighted median of the models that do.
   */
  wind_kn: number;
  /** The lowest and highest of every model, the lead among them. */
  min_kn: number;
  max_kn: number;
  /**
   * The headline gust: the lead model's while it gives one; otherwise the
   * weighted median of the models that forecast a gust (`gust_lead` says
   * which). `gust_max_kn` is the highest of every model's.
   */
  gust_kn: number | null;
  gust_max_kn: number | null;
  /** The headline bearing: the lead model's, or the models' weighted mean vector. */
  direction_deg: number;
  direction: string;
  /**
   * How far the models agree, read from the spread of every model's speed,
   * not from how far they sit from the headline. Null with only one model:
   * one line cannot agree or disagree.
   */
  agreement: Agreement | null;
  models: number;
  /**
   * Which model the headline wind and direction are: `"harmonie"` while
   * HARMONIE reaches the hour, null where they are the blend of the models.
   */
  lead: string | null;
  /**
   * Which model the headline gust is: the lead's id when it gave a gust this
   * hour, null where `gust_kn` is the blend's (or there is none). HARMONIE
   * gives none at the first hour of its run, so `lead` can be set while this
   * is null.
   */
  gust_lead: string | null;
  by_model?: Record<string, ModelWind>;
}

export interface SpotWindLines {
  lines: {
    run: ModelRun;
    points: WindPoint[];
    gap: number;
    resolutionKm: number | null;
  }[];
  /** Models that are live but do not reach this spot. */
  outside: string[];
}

export function spotWindLines(
  wind: Loaded<WindManifest>[],
  spotId: string,
): SpotWindLines {
  const lines: SpotWindLines["lines"] = [];
  const outside: string[] = [];
  for (const { run, manifest } of wind) {
    const points = windPoints(manifest, spotId);
    if (points)
      lines.push({
        run,
        points,
        gap: maxGap(points),
        resolutionKm: manifest.resolutionKm ?? null,
      });
    else outside.push(run.name);
  }
  return { lines, outside };
}

export function hourWind(
  lines: SpotWindLines["lines"],
  time: number,
  perModel: boolean,
): HourWind | null {
  const samples = lines.flatMap(({ run, points, gap, resolutionKm }) => {
    const at = windAt(points, time, gap);
    const runTime = Date.parse(run.run_time);
    // The dock's weight for this model this far into its run (`modelWeight`).
    const weight = modelWeight(run.id, leadHours(runTime, time), resolutionKm);
    return at
      ? [{ id: run.id, weight, runTime, ...at, speed: Math.hypot(at.u, at.v) }]
      : [];
  });
  if (!samples.length) return null;
  const speeds = samples.map((s) => s.speed * KNOTS).sort((a, b) => a - b);
  const gusted = samples.filter((s) => s.gust !== null);
  const gusts = gusted.map((s) => s.gust! * KNOTS).sort((a, b) => a - b);
  // The headline is the lead model's own while it reaches the hour; the blend
  // below is the headline only where it does not.
  const lead = samples.find((s) => s.id === LEAD_MODEL) ?? null;
  const weight = samples.reduce((sum, s) => sum + s.weight, 0);
  const u = lead
    ? lead.u
    : samples.reduce((sum, s) => sum + s.u * s.weight, 0) / weight;
  const v = lead
    ? lead.v
    : samples.reduce((sum, s) => sum + s.v * s.weight, 0) / weight;
  const direction = bearing(u, v);
  const gustLead = lead !== null && lead.gust !== null;
  const hour: HourWind = {
    wind_kn: round(
      lead
        ? lead.speed * KNOTS
        : weightedMedian(
            samples.map((s) => s.speed * KNOTS),
            samples.map((s) => s.weight),
          ),
    ),
    min_kn: round(speeds[0]),
    max_kn: round(speeds[speeds.length - 1]),
    gust_kn: gustLead
      ? round(lead.gust! * KNOTS)
      : gusted.length
        ? round(
            weightedMedian(
              gusted.map((s) => s.gust! * KNOTS),
              gusted.map((s) => s.weight),
            ),
          )
        : null,
    gust_max_kn: gusts.length ? round(gusts[gusts.length - 1]) : null,
    direction_deg: direction,
    direction: compass(direction),
    agreement:
      samples.length > 1
        ? agreementFrom(
            speeds,
            leadHours(Math.max(...samples.map((s) => s.runTime)), time),
          )
        : null,
    models: samples.length,
    lead: lead ? lead.id : null,
    gust_lead: gustLead ? lead.id : null,
  };
  if (perModel)
    hour.by_model = Object.fromEntries(
      samples.map((s) => [
        s.id,
        {
          wind_kn: knots(s.speed),
          gust_kn: s.gust === null ? null : knots(s.gust),
          direction_deg: bearing(s.u, s.v),
        },
      ]),
    );
  return hour;
}

// ---- the ensembles' members -------------------------------------------------------

export interface MemberLines {
  run: ModelRun;
  /** One series per member, each sorted by time. */
  members: WindPoint[][];
  gap: number;
}

/** Every member's own series for a spot, or null where the model has none. */
function memberPoints(
  manifest: WindManifest,
  spotId: string,
): WindPoint[][] | null {
  const series = manifest.spotMembers?.[spotId];
  const count = manifest.ensemble?.members;
  if (!Array.isArray(series) || !finite(count) || count < 1) return null;
  const members: WindPoint[][] = Array.from({ length: count }, () => []);
  for (const row of series) {
    if (!isObject(row) || !Array.isArray(row.u) || !Array.isArray(row.v))
      continue;
    const time = Date.parse(row.validTime as string);
    if (!Number.isFinite(time)) continue;
    const gusts = Array.isArray(row.gust) ? row.gust : [];
    for (let m = 0; m < count; m++) {
      const u = row.u[m];
      const v = row.v[m];
      if (!finite(u) || !finite(v)) continue;
      const gust = gusts[m];
      members[m].push({
        time,
        u,
        v,
        gust: manifest.gustAvailable !== false && finite(gust) ? gust : null,
      });
    }
  }
  const live = members.filter((points) => points.length);
  return live.length
    ? live.map((points) => points.sort((a, b) => a.time - b.time))
    : null;
}

/** The ensembles that publish their members for this spot. */
export function spotMemberLines(
  wind: Loaded<WindManifest>[],
  spotId: string,
): MemberLines[] {
  return wind.flatMap(({ run, manifest }) => {
    const members = memberPoints(manifest, spotId);
    return members ? [{ run, members, gap: maxGap(members[0]) }] : [];
  });
}

/** Every member's wind in knots at `time`, from every ensemble, and whose they are. */
export function memberSpeeds(
  lines: readonly MemberLines[],
  time: number,
): { speeds: number[]; models: string[] } {
  const speeds: number[] = [];
  const models: string[] = [];
  for (const { run, members, gap } of lines) {
    let any = false;
    for (const points of members) {
      const at = windAt(points, time, gap);
      if (!at) continue;
      any = true;
      speeds.push(round(Math.hypot(at.u, at.v) * KNOTS));
    }
    if (any) models.push(run.name);
  }
  return { speeds, models };
}

/** A sorted list's value at a fraction of the way along, interpolated. */
function quantile(sorted: readonly number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

export interface HourEnsemble {
  /** Members that reach this hour, across every ensemble that does. */
  members: number;
  /** The ensembles behind them. */
  models: string[];
  /** The members' mean wind at the 10th, 50th and 90th percentile, knots. */
  p10_kn: number;
  p50_kn: number;
  p90_kn: number;
}

export function hourEnsemble(
  lines: readonly MemberLines[],
  time: number,
): HourEnsemble | null {
  const { speeds, models } = memberSpeeds(lines, time);
  if (!speeds.length) return null;
  speeds.sort((a, b) => a - b);
  return {
    members: speeds.length,
    models,
    p10_kn: round(quantile(speeds, 0.1)),
    p50_kn: round(quantile(speeds, 0.5)),
    p90_kn: round(quantile(speeds, 0.9)),
  };
}

// ---- marine ----------------------------------------------------------------------

interface SpotVariables {
  run: ModelRun;
  manifest: VariablesManifest;
  steps: VariableStep[];
}

/** The first source, finest first, that says anything about this spot. */
function preferredSource(
  loaded: Loaded<VariablesManifest>[],
  spotId: string,
  variable: readonly string[],
): SpotVariables | null {
  for (const { run, manifest } of loaded) {
    const steps = variableSteps(manifest, spotId);
    const name = pick(manifest, variable);
    if (steps && name && steps.some((s) => finite(s.values[name])))
      return { run, manifest, steps };
  }
  return null;
}

export interface HourWaves {
  height_m: number | null;
  period_s: number | null;
  direction_deg: number | null;
}
function hourWaves(source: SpotVariables, time: number): HourWaves | null {
  const step = stepAt(source.steps, time);
  if (!step) return null;
  const value = (names: string[], places: number) => {
    const name = pick(source.manifest, names);
    const v = name ? step.values[name] : null;
    return finite(v) ? round(v, places) : null;
  };
  const height = value(["swh"], 1);
  if (height === null) return null;
  const direction = value(["mwd", "pwd"], 0);
  return {
    height_m: height,
    period_s: value(["pp1d", "mwp"], 0),
    direction_deg: direction === null ? null : direction % 360,
  };
}

export interface HourWeather {
  air_c: number | null;
  rain_mm: number | null;
  cloud_pct: number | null;
  /** The model's present-weather code (WMO 4677), where it publishes one. */
  weather_code: number | null;
}
function hourWeather(source: SpotVariables, time: number): HourWeather | null {
  const step = stepAt(source.steps, time);
  if (!step) return null;
  const value = (name: string, places: number) => {
    const v = step.values[name];
    return finite(v) ? round(v, places) : null;
  };
  const result = {
    air_c: value("t2m", 0),
    rain_mm: value("precip", 1),
    cloud_pct: value("clct", 0),
    weather_code: value("ww", 0),
  };
  return Object.values(result).every((v) => v === null) ? null : result;
}

export interface SpotTides {
  station: string;
  distance_km: number;
  datum: string;
  events: {
    time: string;
    local: string;
    tide: "high" | "low";
    height_m: number;
  }[];
  attribution: string | null;
}

async function spotTides(
  source: ForecastSource,
  spotId: string,
  window: Window,
): Promise<SpotTides | { note: string } | null> {
  let manifest: unknown;
  try {
    manifest = await source.json(TIDES_URL);
  } catch {
    return { note: "Tide predictions could not be read just now." };
  }
  if (!isObject(manifest) || !isObject(manifest.spots)) return null;
  const link = manifest.spots[spotId];
  if (!isObject(link))
    return { note: "This spot is not in the tide predictions." };
  if (typeof link.station !== "string")
    return {
      note:
        text(link.reason) ?? "No tide station is close enough to this spot.",
    };
  const stations = manifest.stations;
  const station = Array.isArray(stations)
    ? stations.find((s) => isObject(s) && s.id === link.station)
    : isObject(stations)
      ? stations[link.station]
      : null;
  if (!isObject(station))
    return { note: "This spot's tide station is missing." };
  const url = text(station.url) ?? `marine/tides/${link.station}.json`;
  let curve: unknown;
  try {
    curve = await source.json(url);
  } catch {
    return { note: "Tide predictions could not be read just now." };
  }
  if (!isObject(curve) || !Array.isArray(curve.events))
    return { note: "Tide predictions are not published for this station." };
  const events = curve.events.flatMap((e): SpotTides["events"] => {
    if (!isObject(e) || !finite(e.height)) return [];
    const time = Date.parse(e.time as string);
    if (!Number.isFinite(time) || time < window.from || time > window.to)
      return [];
    if (e.kind !== "high" && e.kind !== "low") return [];
    return [
      {
        time: iso(time),
        local: localTime(time),
        tide: e.kind,
        height_m: round(e.height, 2),
      },
    ];
  });
  events.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  return {
    station: text(station.name) ?? link.station,
    distance_km: finite(link.distanceKm) ? round(link.distanceKm) : 0,
    datum: text(curve.datum) ?? text(station.datum) ?? "station datum",
    events,
    attribution: text(manifest.attribution),
  };
}

export interface SpotSea {
  celsius: number;
  measured: string;
  station: string;
  distance_km: number;
  attribution: string | null;
}

async function spotSea(
  source: ForecastSource,
  spotId: string,
): Promise<SpotSea | null> {
  let manifest: unknown;
  try {
    manifest = await source.json(SEA_TEMPERATURE_URL);
  } catch {
    return null;
  }
  if (!isObject(manifest) || !isObject(manifest.spots)) return null;
  const spot = manifest.spots[spotId];
  if (!isObject(spot) || typeof spot.station !== "string") return null;
  const latest = spot.latest;
  if (!isObject(latest) || !finite(latest.value)) return null;
  const time = Date.parse(latest.time as string);
  if (!Number.isFinite(time)) return null;
  const station = isObject(manifest.stations)
    ? manifest.stations[spot.station]
    : null;
  return {
    celsius: round(latest.value),
    measured: localTime(time),
    station: isObject(station)
      ? (text(station.name) ?? spot.station)
      : spot.station,
    distance_km: finite(spot.distanceKm) ? round(spot.distanceKm) : 0,
    attribution: text(manifest.attribution),
  };
}

// ---- answers ---------------------------------------------------------------------

export interface ForecastHour {
  time: string;
  local: string;
  daylight: boolean;
  wind: HourWind | null;
  waves?: HourWaves | null;
  weather?: HourWeather | null;
  /** Where an ensemble reaches the spot: the spread of its members. */
  ensemble?: HourEnsemble | null;
}

export interface SpotForecast {
  spot: RidingSpot;
  units: Record<string, string>;
  window: { from: string; to: string; step_hours: number };
  hours: ForecastHour[];
  sun: { date: string; sunrise: string | null; sunset: string | null }[];
  tides: SpotTides | { note: string } | null;
  sea_temperature: SpotSea | null;
  sources: {
    wind: ModelRun[];
    wind_outside_domain: string[];
    waves: ModelRun | null;
    weather: ModelRun | null;
    unavailable: Unavailable[];
  };
  method: string;
}

export const METHOD =
  "Wind, gust and direction are HARMONIE's own forecast while it reaches the " +
  'hour (about 60 hours ahead; `lead` is "harmonie"); past it, a weighted ' +
  "median of the other models (`lead` is null), each weighted by how well it " +
  "verified against Irish stations that far into its run, with a vector-mean " +
  "direction (an ensemble's member mean counts as one model). Where HARMONIE " +
  "gives no gust the gust is the models' weighted median (`gust_lead` null). " +
  "The range (min_kn, max_kn, gust_max_kn) is across every model, and " +
  "agreement comes from the standard deviation of every model's speed, tighter the further " +
  `ahead: high under ${AGREEMENT_SPREAD_KN[0][0]} kn today and under ` +
  `${AGREEMENT_SPREAD_KN[3][0]} kn from day 3, low from ` +
  `${AGREEMENT_SPREAD_KN[0][1]} kn today and ${AGREEMENT_SPREAD_KN[3][1]} kn ` +
  "from day 3, and never high from fewer than three models. Not " +
  "bias-corrected against observations. " +
  "Waves come from the finest wave model that covers the spot. " +
  "Model forecasts only: never a statement that conditions are safe.";

export const UNITS = {
  wind: "knots",
  direction: "degrees the wind or waves come FROM (0 = north)",
  waves: "metres (significant height), seconds (peak period)",
  temperature: "°C",
  rain: "mm in the forecast step",
  time: "UTC ISO time, with `local` in Europe/Dublin",
};

export async function spotForecast(
  source: ForecastSource,
  spot: RidingSpot,
  window: Window,
  options: {
    perModel?: boolean;
    now: number;
  },
): Promise<SpotForecast> {
  // Only the one square that holds the spot is read, of each model.
  const square = [spotSquare(spot.lat, spot.lon)];
  const [wind, waves, weather, tides, sea] = await Promise.all([
    loadWind(source, options.now, square),
    loadWaves(source, options.now, square),
    loadWeather(source, options.now, square),
    spotTides(source, spot.id, window),
    spotSea(source, spot.id),
  ]);
  const { lines, outside } = spotWindLines(wind.loaded, spot.id);
  const memberLines = spotMemberLines(wind.loaded, spot.id);
  const waveSource = preferredSource(waves.loaded, spot.id, ["swh"]);
  const weatherSource = preferredSource(weather.loaded, spot.id, ["t2m"]);
  const hours = axis(window).map((time): ForecastHour => {
    const hour: ForecastHour = {
      time: iso(time),
      local: localTime(time),
      daylight: daylight(spot, time),
      wind: hourWind(lines, time, options.perModel ?? false),
    };
    if (waveSource) hour.waves = hourWaves(waveSource, time);
    if (weatherSource) hour.weather = hourWeather(weatherSource, time);
    if (memberLines.length) hour.ensemble = hourEnsemble(memberLines, time);
    return hour;
  });
  const days = new Set(hours.map((h) => h.time.slice(0, 10)));
  const sun = [...days].map((day) => {
    const times = sunTimes(spot.lat, spot.lon, new Date(`${day}T12:00:00Z`));
    return {
      date: day,
      sunrise: times.sunrise ? localTime(times.sunrise.getTime()) : null,
      sunset: times.sunset ? localTime(times.sunset.getTime()) : null,
    };
  });
  return {
    spot,
    units: UNITS,
    window: {
      from: iso(window.from),
      to: iso(window.to),
      step_hours: window.stepHours,
    },
    hours,
    sun,
    tides,
    sea_temperature: sea,
    sources: {
      wind: lines.map((l) => l.run),
      wind_outside_domain: outside,
      waves: waveSource?.run ?? null,
      weather: weatherSource?.run ?? null,
      unavailable: [
        ...wind.unavailable,
        ...waves.unavailable,
        ...weather.unavailable,
      ],
    },
    method: METHOD,
  };
}

export interface Session {
  from: string;
  to: string;
  local: string;
  hours: number;
  wind_kn: number;
  min_kn: number;
  max_kn: number;
  gust_max_kn: number | null;
  direction: string;
  direction_deg: number;
  /** The worst agreement of any hour; null when only one model covered it. */
  agreement: Agreement | null;
  /** The fewest models behind any hour of the session. */
  models: number;
}
export interface SpotSessions {
  spot: RidingSpot;
  rideable_hours: number;
  sessions: Session[];
}

export interface FindOptions {
  minKnots: number;
  maxKnots: number;
  daylightOnly: boolean;
  minSessionHours: number;
  county?: string;
  limit: number;
  now: number;
}

/**
 * Spots ranked by how many hours of the window the consensus sits inside the
 * asked wind range, grouped into sessions of consecutive hours. An hour the
 * models disagree about (agreement "low") does not count: a ranking that
 * recommends a spot on one model's outlier would be worse than none.
 */
export async function findSessions(
  source: ForecastSource,
  spots: readonly RidingSpot[],
  window: Window,
  options: FindOptions,
): Promise<{
  spots: SpotSessions[];
  searched: number;
  sources: ModelRun[];
  unavailable: Unavailable[];
}> {
  const county = options.county ? fold(options.county) : null;
  const pool = county
    ? spots.filter((s) => fold(s.county) === county)
    : [...spots];
  // The squares of the places searched: every square for all of Ireland, the
  // county's own for a county.
  const wind = await loadWind(source, options.now, squaresFor(pool));
  const times = axis({ ...window, stepHours: 1 });
  const results: SpotSessions[] = [];
  for (const spot of pool) {
    const { lines } = spotWindLines(wind.loaded, spot.id);
    if (!lines.length) continue;
    const sessions: Session[] = [];
    let run: { time: number; hour: HourWind }[] = [];
    const close = () => {
      if (run.length >= options.minSessionHours) sessions.push(session(run));
      run = [];
    };
    for (const time of times) {
      const hour = hourWind(lines, time, false);
      const good =
        hour !== null &&
        hour.wind_kn >= options.minKnots &&
        hour.wind_kn <= options.maxKnots &&
        hour.agreement !== "low" &&
        (!options.daylightOnly || daylight(spot, time));
      if (good) run.push({ time, hour: hour! });
      else close();
    }
    close();
    if (sessions.length)
      results.push({
        spot,
        rideable_hours: sessions.reduce((sum, s) => sum + s.hours, 0),
        sessions,
      });
  }
  results.sort((a, b) => b.rideable_hours - a.rideable_hours);
  return {
    spots: results.slice(0, options.limit),
    searched: pool.length,
    sources: wind.loaded.map((l) => l.run),
    unavailable: wind.unavailable,
  };
}

function session(run: { time: number; hour: HourWind }[]): Session {
  const speeds = run.map((r) => r.hour.wind_kn);
  const gusts = run.flatMap((r) =>
    r.hour.gust_max_kn === null ? [] : [r.hour.gust_max_kn],
  );
  // Direction from the unit vectors, so SW and W average to WSW, not to E.
  let x = 0;
  let y = 0;
  for (const { hour } of run) {
    x += Math.sin((hour.direction_deg * Math.PI) / 180);
    y += Math.cos((hour.direction_deg * Math.PI) / 180);
  }
  const direction =
    Math.round(((Math.atan2(x, y) * 180) / Math.PI + 360) % 360) % 360;
  const rank = { high: 0, moderate: 1, low: 2 } as const;
  const worst = run.reduce<Agreement | null>((acc, r) => {
    const a = r.hour.agreement;
    if (a === null) return acc;
    return acc === null || rank[a] > rank[acc] ? a : acc;
  }, null);
  const first = run[0].time;
  const last = run[run.length - 1].time;
  return {
    from: iso(first),
    to: iso(last + HOUR),
    local: `${localTime(first)} – ${localTime(last + HOUR)
      .split(", ")
      .pop()}`,
    hours: run.length,
    wind_kn: round(speeds.reduce((a, b) => a + b, 0) / speeds.length),
    min_kn: Math.min(...speeds),
    max_kn: Math.max(...speeds),
    gust_max_kn: gusts.length ? Math.max(...gusts) : null,
    direction: compass(direction),
    direction_deg: direction,
    agreement: worst,
    models: Math.min(...run.map((r) => r.hour.models)),
  };
}

export async function modelStatus(source: ForecastSource, now: number) {
  // Which runs are published, and how far they reach: no spot data needed.
  const [wind, waves, weather] = await Promise.all([
    loadWind(source, now, null),
    loadWaves(source, now, null),
    loadWeather(source, now, null),
  ]);
  return {
    wind: wind.loaded.map((l) => l.run),
    waves: waves.loaded.map((l) => l.run),
    weather: weather.loaded.map((l) => l.run),
    unavailable: [
      ...wind.unavailable,
      ...waves.unavailable,
      ...weather.unavailable,
    ],
  };
}
