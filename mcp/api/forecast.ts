/**
 * The forecast as an agent reads it: every wind model's precomputed series for
 * a riding location, reduced to one consensus line per hour, beside the waves,
 * surface weather, tides, sea temperature and daylight the dock shows.
 *
 * It reads the published bundles (see source.ts) and nothing else. Speeds are
 * stored in m/s and answered in knots; directions are degrees the wind or the
 * sea comes FROM, as everywhere on the site.
 *
 * The consensus is deliberately simple and says so: one line per model — an
 * ensemble's member mean counts once, like any other model — reduced to the
 * median, the range and an agreement label on the same 4 kn / 8 kn thresholds
 * the dock's blend uses (force5/src/blend.ts). It is not bias-corrected and not
 * weighted by any model's past accuracy.
 *
 * Beside it, where an ensemble reaches the spot, the chance it rides: the share
 * of the ensembles' members (ECMWF ENS and GEFS, each member its own run) whose
 * rideable wind reaches the rider's floor, rated the way the stars rate an hour
 * (force5/src/stars.ts). It is the members' own spread, not the models'.
 */
import {
  DEFAULT_RIDER,
  rideableWind,
  riderWeight,
  windBand,
  type Rider,
  type Skill,
} from "../../force5/src/stars.js";
import { sunTimes } from "../../force5/src/sun.js";
import { KNOTS } from "../../force5/src/units.js";
import type { ForecastSource } from "./httpSource.js";

const HOUR = 3600000;
/** A run older than this is flagged stale, as the map flags it. */
const STALE_HOURS = 18;
/** Same thresholds as the dock (AGREEMENT_HIGH_KN, AGREEMENT_MODERATE_KN). */
const AGREEMENT_HIGH_KN = 4;
const AGREEMENT_MODERATE_KN = 8;
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
  { id: "ecmwf-ens", name: "ECMWF ENS", manifestUrl: "weather/ecmwf-ens.json" },
  { id: "gefs", name: "GEFS", manifestUrl: "weather/gefs.json" },
  { id: "arpege", name: "ARPEGE", manifestUrl: "weather/arpege.json" },
  { id: "arome", name: "AROME", manifestUrl: "weather/arome.json" },
  { id: "aifs", name: "AIFS", manifestUrl: "weather/aifs.json" },
];
/** Finest first, as WAVE_SOURCE_PREFERENCE in force5/src/waves.ts. */
export const WAVE_MODELS: readonly CatalogEntry[] = [
  { id: "mi-swan", name: "MI SWAN", manifestUrl: "weather/mi-swan.json" },
  { id: "gfs-wave", name: "GFS-Wave", manifestUrl: "weather/gfs-wave.json" },
  {
    id: "ecmwf-wave",
    name: "ECMWF Wave",
    manifestUrl: "weather/ecmwf-wave.json",
  },
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

function median(sorted: readonly number[]): number {
  const mid = (sorted.length - 1) / 2;
  return (sorted[Math.floor(mid)] + sorted[Math.ceil(mid)]) / 2;
}

export type Agreement = "high" | "moderate" | "low";
export function agreementFor(spreadKnots: number): Agreement {
  if (spreadKnots < AGREEMENT_HIGH_KN) return "high";
  if (spreadKnots < AGREEMENT_MODERATE_KN) return "moderate";
  return "low";
}

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

/** The latest valid time any series in a group reaches. */
function lastTime(groups: unknown[]): number | null {
  let last: number | null = null;
  for (const group of groups) {
    if (!isObject(group)) continue;
    for (const series of Object.values(group)) {
      if (!Array.isArray(series) || !series.length) continue;
      const end = Date.parse(
        (series[series.length - 1] as Json)?.validTime as string,
      );
      if (Number.isFinite(end))
        last = last === null ? end : Math.max(last, end);
    }
  }
  return last;
}

/**
 * Every manifest in a catalogue that is published, sound and not yet expired.
 * A model that is missing, broken or over is reported, never thrown: the
 * answer is still worth giving with the models that are there.
 */
async function loadCatalog<T>(
  source: ForecastSource,
  entries: readonly CatalogEntry[],
  seriesKey: "spotForecasts" | "spotSeries",
  now: number,
): Promise<{ loaded: Loaded<T>[]; unavailable: Unavailable[] }> {
  const results = await Promise.all(
    entries.map(async (entry) => {
      const miss = (reason: string) => ({
        unavailable: { id: entry.id, name: entry.name, reason },
      });
      let body: unknown;
      try {
        body = await source.json(entry.manifestUrl);
      } catch {
        return miss("Could not be read just now.");
      }
      if (body === null) return miss("Not published.");
      if (
        !isObject(body) ||
        body.schemaVersion !== 1 ||
        body.model !== entry.id ||
        !Number.isFinite(Date.parse(body.runTime as string)) ||
        !isObject(body[seriesKey])
      )
        return miss("The published file is not a forecast this server reads.");
      const until = lastTime([body[seriesKey], body.spotMembers]);
      if (until === null || until < now)
        return miss("The latest published run has already ended.");
      return {
        loaded: {
          entry,
          run: runOf(entry, body, until, now),
          manifest: body as unknown as T,
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

export const loadWind = (source: ForecastSource, now: number) =>
  loadCatalog<WindManifest>(source, WIND_MODELS, "spotForecasts", now);
export const loadWaves = (source: ForecastSource, now: number) =>
  loadCatalog<VariablesManifest>(source, WAVE_MODELS, "spotSeries", now);
export const loadWeather = (source: ForecastSource, now: number) =>
  loadCatalog<VariablesManifest>(source, WEATHER_MODELS, "spotSeries", now);

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
  /** The median of the models' speeds. */
  wind_kn: number;
  min_kn: number;
  max_kn: number;
  /** The median of the models that forecast a gust, and the highest of them. */
  gust_kn: number | null;
  gust_max_kn: number | null;
  direction_deg: number;
  direction: string;
  /** Null with only one model: one line cannot agree or disagree. */
  agreement: Agreement | null;
  models: number;
  by_model?: Record<string, ModelWind>;
}

export interface SpotWindLines {
  lines: { run: ModelRun; points: WindPoint[]; gap: number }[];
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
    if (points) lines.push({ run, points, gap: maxGap(points) });
    else outside.push(run.name);
  }
  return { lines, outside };
}

export function hourWind(
  lines: SpotWindLines["lines"],
  time: number,
  perModel: boolean,
): HourWind | null {
  const samples = lines.flatMap(({ run, points, gap }) => {
    const at = windAt(points, time, gap);
    return at ? [{ id: run.id, ...at, speed: Math.hypot(at.u, at.v) }] : [];
  });
  if (!samples.length) return null;
  const speeds = samples.map((s) => s.speed * KNOTS).sort((a, b) => a - b);
  const gusts = samples
    .flatMap((s) => (s.gust === null ? [] : [s.gust * KNOTS]))
    .sort((a, b) => a - b);
  const u = samples.reduce((sum, s) => sum + s.u, 0) / samples.length;
  const v = samples.reduce((sum, s) => sum + s.v, 0) / samples.length;
  const direction = bearing(u, v);
  const spread = speeds[speeds.length - 1] - speeds[0];
  const hour: HourWind = {
    wind_kn: round(median(speeds)),
    min_kn: round(speeds[0]),
    max_kn: round(speeds[speeds.length - 1]),
    gust_kn: gusts.length ? round(median(gusts)) : null,
    gust_max_kn: gusts.length ? round(gusts[gusts.length - 1]) : null,
    direction_deg: direction,
    direction: compass(direction),
    agreement: samples.length > 1 ? agreementFor(spread) : null,
    models: samples.length,
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

/** One member's wind at an hour, in knots: [mean, gust or null]. */
export type MemberSample = [number, number | null];

/** Every member that reaches `time`, from every ensemble, and whose they are. */
export function memberSamples(
  lines: readonly MemberLines[],
  time: number,
): { samples: MemberSample[]; models: string[] } {
  const samples: MemberSample[] = [];
  const models: string[] = [];
  for (const { run, members, gap } of lines) {
    let any = false;
    for (const points of members) {
      const at = windAt(points, time, gap);
      if (!at) continue;
      any = true;
      samples.push([
        round(Math.hypot(at.u, at.v) * KNOTS),
        at.gust === null ? null : round(at.gust * KNOTS),
      ]);
    }
    if (any) models.push(run.name);
  }
  return { samples, models };
}

/**
 * The chance it rides, in whole per cent: the share of members whose rideable
 * wind (the mean lifted toward that member's own gust, as the stars read it)
 * reaches the rider's floor. Null with no members.
 */
export function rideChance(
  samples: readonly MemberSample[],
  rider: Rider,
): number | null {
  if (!samples.length) return null;
  const floor = windBand(rider).min;
  const riding = samples.filter(
    ([wind, gust]) => rideableWind(wind, gust, rider) >= floor,
  ).length;
  return Math.round((100 * riding) / samples.length);
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
  /** Per cent of members whose rideable wind reaches the rider's floor. */
  chance_pct: number;
  /** Each member's [wind, gust] in knots, when asked for (`members`). */
  samples?: MemberSample[];
}

export function hourEnsemble(
  lines: readonly MemberLines[],
  time: number,
  rider: Rider,
  keepSamples = false,
): HourEnsemble | null {
  const { samples, models } = memberSamples(lines, time);
  const chance = rideChance(samples, rider);
  if (chance === null) return null;
  const speeds = samples.map(([wind]) => wind).sort((a, b) => a - b);
  const hour: HourEnsemble = {
    members: samples.length,
    models,
    p10_kn: round(quantile(speeds, 0.1)),
    p50_kn: round(quantile(speeds, 0.5)),
    p90_kn: round(quantile(speeds, 0.9)),
    chance_pct: chance,
  };
  if (keepSamples) hour.samples = samples;
  return hour;
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
  /** Where an ensemble reaches the spot: its members, and the chance it rides. */
  ensemble?: HourEnsemble | null;
}

/** Who the chance it rides was worked out for, and the floor that asked of them. */
export interface RideChanceBasis {
  skill: Skill;
  weight_kg: number;
  /** The rideable wind a member must reach to count, in knots. */
  floor_kn: number;
  ensembles: string[];
}

export interface SpotForecast {
  spot: RidingSpot;
  units: Record<string, string>;
  window: { from: string; to: string; step_hours: number };
  hours: ForecastHour[];
  sun: { date: string; sunrise: string | null; sunset: string | null }[];
  tides: SpotTides | { note: string } | null;
  sea_temperature: SpotSea | null;
  /** Null where no ensemble publishes its members for this spot. */
  ride_chance: RideChanceBasis | null;
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
  "Wind is the median of every live model's forecast for the spot at each hour " +
  "(an ensemble's member mean counts as one model), with the range across " +
  "models, a vector-mean direction, and agreement: high when the models sit " +
  `within ${AGREEMENT_HIGH_KN} kn of each other, moderate within ` +
  `${AGREEMENT_MODERATE_KN} kn, otherwise low. Not bias-corrected against ` +
  "observations. The chance it rides is the share of ensemble members " +
  "(ECMWF ENS and GEFS, every member counted) whose wind, lifted part of the " +
  "way to its gusts as a foil rides it, reaches the rider's floor. " +
  "Waves come from the finest wave model that covers the spot. " +
  "Model forecasts only: never a statement that conditions are safe.";

export const UNITS = {
  wind: "knots",
  direction: "degrees the wind or waves come FROM (0 = north)",
  waves: "metres (significant height), seconds (peak period)",
  temperature: "°C",
  rain: "mm in the forecast step",
  chance: "per cent of ensemble members",
  time: "UTC ISO time, with `local` in Europe/Dublin",
};

export async function spotForecast(
  source: ForecastSource,
  spot: RidingSpot,
  window: Window,
  options: {
    perModel?: boolean;
    now: number;
    /** Who the chance it rides is for; the 80 kg intermediate by default. */
    rider?: Rider;
    /** Keep every member's wind and gust per hour, to re-rate for another rider. */
    members?: boolean;
  },
): Promise<SpotForecast> {
  const [wind, waves, weather, tides, sea] = await Promise.all([
    loadWind(source, options.now),
    loadWaves(source, options.now),
    loadWeather(source, options.now),
    spotTides(source, spot.id, window),
    spotSea(source, spot.id),
  ]);
  const { lines, outside } = spotWindLines(wind.loaded, spot.id);
  const memberLines = spotMemberLines(wind.loaded, spot.id);
  const rider = options.rider ?? DEFAULT_RIDER;
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
    if (memberLines.length)
      hour.ensemble = hourEnsemble(
        memberLines,
        time,
        rider,
        options.members ?? false,
      );
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
    ride_chance: memberLines.length
      ? {
          skill: rider.skill,
          weight_kg: riderWeight(rider),
          floor_kn: round(windBand(rider).min),
          ensembles: memberLines.map((l) => l.run.name),
        }
      : null,
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
  const wind = await loadWind(source, options.now);
  const county = options.county ? fold(options.county) : null;
  const pool = county
    ? spots.filter((s) => fold(s.county) === county)
    : [...spots];
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
  const [wind, waves, weather] = await Promise.all([
    loadWind(source, now),
    loadWaves(source, now),
    loadWeather(source, now),
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
