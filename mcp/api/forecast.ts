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
 * The headline is deliberately simple and says so: one model's own forecast,
 * never a blend of several (the ruling of 19 October 2026). Its wind, gust and
 * direction are HARMONIE's own while HARMONIE reaches the hour, and past it
 * ECMWF's, or the two models a caller names instead (force5/src/lead.ts, the
 * rule every surface that rates shares). The range and the agreement label,
 * the same the dock's blend gives (force5/src/blend.ts), are read across every
 * model — an ensemble's member mean counting once — as context beside it. It
 * is not bias-corrected.
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
  AGREEMENT_MIN_MODELS,
  AGREEMENT_SPREAD_KN,
  agreementFrom,
  leadHours,
  type Agreement,
} from "../../force5/src/weights.js";
import {
  DEFAULT_STARS_FROM,
  leadOrder,
  pickModel,
  type StarsFrom,
} from "../../force5/src/lead.js";
import {
  isOnWater,
  shoreFacing,
  shoreType,
  type ShoreType,
} from "../../force5/src/shoreFacing.js";
import {
  GUST_EASE_KN,
  bestWindow,
  shoreAngle,
  type HourRating,
  type Rider,
  type ShoreAngle,
} from "../../force5/src/stars.js";
import { gustFactor } from "../../force5/src/gustFactor.js";
import { isStale } from "../../force5/src/catalog.js";
import { feelsLikeC } from "../../force5/src/feelsLike.js";
import {
  THUNDER_CAPE_DRY,
  THUNDER_CAPE_WET,
  thunderRisk,
  type ThunderRisk,
} from "../../force5/src/thunder.js";
import {
  presentWeather,
  skyOf,
  type WeatherIcon,
} from "../../force5/src/presentWeather.js";
import type { ForecastSource } from "./httpSource.js";
import {
  NOT_RATED,
  bestDirections,
  hourStars,
  rateWind,
  riderUsed,
  type HourStars,
  type RiderUsed,
} from "./rating.js";
import {
  hourWarning,
  loadWarnings,
  placeWarnings,
  ratingUnderWarnings,
  warningsAcross,
  warningsAnswer,
  type HourWarning,
  type PlaceWarnings,
  type WarningsAnswer,
} from "./warnings.js";
import {
  hourWater,
  loadWaterQuality,
  ratingUnderWater,
  waterAcross,
  waterAnswer,
  type HourWater,
  type WaterAnswer,
} from "./waterQuality.js";
import {
  spotWaterQuality,
  type SpotWaterQuality,
} from "../../force5/src/waterQuality.js";

const HOUR = 3600000;
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
  {
    id: "gfs-weather",
    name: "GFS weather",
    manifestUrl: "weather/gfs-weather.json",
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
/** "Wed, 16 Sept, 19:00" in Irish time: the site's own label, with no zone. */
export const localTime = (millis: number) =>
  localFormat.format(new Date(millis));

const offsetFormat = new Intl.DateTimeFormat("en-IE", {
  timeZone: TIME_ZONE,
  timeZoneName: "longOffset",
});
const clockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** "2026-10-25": the Irish calendar day an instant falls on. */
export const dublinDate = (millis: number) =>
  dateFormat.format(new Date(millis));

/**
 * The zone Irish clocks are on at an instant: "IST" (Irish Standard Time,
 * UTC+1, from the last Sunday of March) or "GMT" (UTC+0, from the last Sunday
 * of October). Read from the offset rather than from a locale's own
 * abbreviation, which differs between runtimes.
 */
export function irishZone(millis: number): string {
  const name =
    offsetFormat
      .formatToParts(new Date(millis))
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const offset = /([+-]\d{2}):?(\d{2})?/.exec(name);
  if (!offset) return "GMT";
  const hm = `${offset[1]}:${offset[2] ?? "00"}`;
  return hm === "+01:00" ? "IST" : hm === "+00:00" ? "GMT" : `UTC${hm}`;
}

/**
 * "Sun, 25 Oct, 01:00 IST": Irish time with its zone, for an agent to repeat
 * verbatim. The night the clocks go back has two 01:00s, an hour apart, and
 * the zone is what tells them apart (01:00 IST, then 01:00 GMT).
 */
export const localStamp = (millis: number) =>
  `${localTime(millis)} ${irishZone(millis)}`;

/**
 * A stretch of Irish time in one label: "Sun, 25 Oct, 08:00 – 17:41 GMT".
 * The zone is said at both ends where the clocks change inside it, and the
 * end's day where it falls on another.
 */
export function localSpan(from: number, to: number): string {
  const zoneFrom = irishZone(from);
  const zoneTo = irishZone(to);
  const start =
    zoneFrom === zoneTo ? localTime(from) : `${localTime(from)} ${zoneFrom}`;
  // An end at midnight closes the day it started on.
  const sameDay =
    dublinDate(from) === dublinDate(to) ||
    (dublinDate(from) === dublinDate(to - 1) &&
      clockFormat.format(new Date(to)) === "00:00");
  const end = sameDay ? clockFormat.format(new Date(to)) : localTime(to);
  return `${start} – ${end} ${zoneTo}`;
}
const iso = (millis: number) => new Date(millis).toISOString();

export type { Agreement, ShoreAngle, ShoreType };

/**
 * How the wind meets a spot: one of the five shore angles at a beach, or
 * "on-water" at a spot on the water, where riders launch and ride out in the
 * middle of an estuary or lagoon and no one shore's angle applies.
 */
export type SpotShore = ShoreAngle | "on-water";

/** What get_spot_forecast says about the shore of a spot that is not a plain beach. */
export function shoreNote(spot: RidingSpot, type: ShoreType): string | null {
  if (type === "on-water")
    return (
      `${spot.name} is a spot on the water: riders launch and ride out in the ` +
      'middle of it, not off one beach. So `shore` is "on-water": onshore and ' +
      "offshore don't apply, the stars rate the wind alone, and find_wind's " +
      "offshore filter doesn't apply here. The rider still has to judge the " +
      "wind against the shore they launch from and the shore it would carry " +
      "them to if they fell, and how the tide runs."
    );
  if (type === "unknown")
    return (
      "This beach's facing isn't known well enough to rate against: `shore` " +
      "is null, the stars rate the wind alone, and offshore wind can't be " +
      "ruled out, so find_wind's offshore filter can't apply here."
    );
  return null;
}

/**
 * How close another spot must be to be named as near this one: close enough
 * to be the same beach or water more often than not, though not always (Keel
 * Lake lies 1.3 km from Keel's beach).
 */
export const NEARBY_KM = 1.5;

export interface NearbySpot {
  id: string;
  name: string;
  distance_km: number;
}

/** The other spots within NEARBY_KM of a spot, nearest first. */
export function nearbySpots(
  spots: readonly RidingSpot[],
  spot: RidingSpot,
): NearbySpot[] {
  return spots
    .filter((s) => s.id !== spot.id)
    .map((s) => ({
      id: s.id,
      name: s.name,
      distance_km: round(distanceKm(spot, s)),
    }))
    .filter((s) => s.distance_km <= NEARBY_KM)
    .sort((a, b) => a.distance_km - b.distance_km);
}

/**
 * How the wind meets the spot's shore, as the stars rate it (force5/src/stars.ts
 * shoreAngle, from the facing the map reads): null where the facing is not
 * known well enough, or there is no wind.
 */
export function shoreOf(
  facing: number | null,
  wind: Pick<HourWind, "direction_deg"> | null,
): ShoreAngle | null {
  return facing === null || wind === null
    ? null
    : shoreAngle(wind.direction_deg, facing);
}

/** onshore 0 … offshore 4: how far out to sea the wind would carry a rider. */
const SEAWARD: Record<ShoreAngle, number> = {
  onshore: 0,
  "cross-on": 1,
  cross: 2,
  "cross-off": 3,
  offshore: 4,
};

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

/**
 * A county as an agent may write it: "Wicklow", "Co. Wicklow", "co wicklow" or
 * "County Wicklow" all fold to "wicklow". What every county argument and every
 * spot's county are compared by.
 */
export const countyKey = (value: string) =>
  fold(value).replace(/^(county|co) /, "");

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
  const county = spots.filter((s) => countyKey(s.county) === countyKey(query));
  if (county.length === 1) return { spot: county[0] };
  return { spot: null, candidates: county };
}

/** Kilometres between two points, as the crow flies. */
export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) *
      Math.cos(b.lat * r) *
      Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** Why this place was chosen, when the words matched several spots close together. */
  note?: string;
}

/**
 * How close together the spots a name matches must all lie for `near` to take
 * one and go on: a radius search from any of them finds much the same spots,
 * so asking which would be a pointless question.
 */
export const CLOSE_TOGETHER_KM = 5;

const LAT_LON = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/;

/**
 * Where a rider is, from what an agent passed: a latitude and longitude, as
 * numbers or "53.35, -6.26"; a county, as the middle of its spots; or a spot.
 * Anything else is an error that says what would do, since this server knows
 * no towns but its spots and their counties.
 */
export function findPlace(
  spots: readonly RidingSpot[],
  near: string | { lat: number; lon: number },
): { place: Place } | { error: string } {
  if (typeof near !== "string")
    return { place: { name: `${near.lat}, ${near.lon}`, ...near } };
  const coords = LAT_LON.exec(near);
  if (coords) {
    const lat = Number(coords[1]);
    const lon = Number(coords[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
      return { place: { name: `${lat}, ${lon}`, lat, lon } };
  }
  const q = countyKey(near);
  const county = spots.filter((s) => countyKey(s.county) === q);
  if (q && county.length) {
    const mean = (pick: (s: RidingSpot) => number) =>
      round(county.reduce((sum, s) => sum + pick(s), 0) / county.length, 3);
    return {
      place: {
        name: `County ${county[0].county}`,
        lat: mean((s) => s.lat),
        lon: mean((s) => s.lon),
      },
    };
  }
  const match = findSpot(spots, near);
  if (match.spot) {
    const { name, lat, lon } = match.spot;
    return { place: { name, lat, lon } };
  }
  const close = match.candidates.every((a) =>
    match.candidates.every((b) => distanceKm(a, b) <= CLOSE_TOGETHER_KM),
  );
  if (match.candidates.length > 1 && close) {
    // The shortest name is the plainest, "Malahide Estuary" over "Low Rock — Malahide".
    const { name, lat, lon } = match.candidates.reduce((a, b) =>
      b.name.length < a.name.length ? b : a,
    );
    return {
      place: {
        name,
        lat,
        lon,
        note: `"${near}" matches ${match.candidates.length} spots within ${CLOSE_TOGETHER_KM} km of each other; distances are from ${name}.`,
      },
    };
  }
  return {
    error: match.candidates.length
      ? `"${near}" could be any of: ${match.candidates
          .slice(0, 8)
          .map((s) => `${s.name} (${s.county})`)
          .join("; ")}. Ask which, or pass near as { lat, lon }.`
      : `This server only knows its spots and their counties, not "${near}". Pass near as { lat, lon } for the person's town, or name their county.`,
  };
}

// ---- manifests --------------------------------------------------------------

export interface ModelRun {
  id: string;
  name: string;
  provider: string;
  run_time: string;
  /** The last hour this run forecasts. */
  until: string;
  /** Hours since the run started, at the time of asking. */
  age_hours: number;
  /**
   * Older than its model's schedule allows (catalog.ts's `staleAfterHours`, as
   * the map and the production monitor read it): an ingest failed or a
   * provider is late. A once-a-day run on time is never stale.
   */
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
  /** Hours of the interval `precip` totals up to this step, where stated. */
  precipHours?: number | null;
}
interface VariablesManifest {
  variables: Record<string, { units?: string; label?: string }>;
  spotSeries: Record<string, unknown>;
  /**
   * The run's native cadence where it states one: ICON-EU weather publishes
   * every hour; a run that states none is read from its steps' spacing.
   */
  stepHours?: number;
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
    age_hours: round((now - runTime) / HOUR),
    stale: isStale(entry.id, runTime, now),
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
    const interval = row.precipIntervalHours;
    const precipHours =
      Array.isArray(interval) &&
      finite(interval[0]) &&
      finite(interval[1]) &&
      interval[1] > interval[0]
        ? interval[1] - interval[0]
        : null;
    return [{ time, values, precipHours }];
  });
  return steps.length ? steps.sort((a, b) => a.time - b.time) : null;
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

/** The window's hours, a step apart, from `from` up to but not including `to`. */
export function axis(window: Window): number[] {
  const times: number[] = [];
  for (let t = window.from; t < window.to; t += window.stepHours * HOUR)
    times.push(t);
  return times;
}

/**
 * How light it is at an instant: "day" from sunrise to sunset, "twilight"
 * from first light (civil dawn, the sun 6° below the horizon) to sunrise and
 * from sunset to last light (civil dusk), "dark" otherwise. The spot page
 * shades the same bands.
 */
export type Light = "day" | "twilight" | "dark";

export function lightAt(spot: RidingSpot, time: number): Light {
  const sun = sunTimes(spot.lat, spot.lon, new Date(time));
  if (sun.polar) return sun.polar === "day" ? "day" : "dark";
  const within = (from: Date | null, to: Date | null) =>
    !!from && !!to && time >= from.getTime() && time <= to.getTime();
  if (within(sun.sunrise, sun.sunset)) return "day";
  return within(sun.civilDawn, sun.civilDusk) ? "twilight" : "dark";
}

/** First light, sunrise, sunset and last light of an Irish day ("2026-10-25"). */
export function daySun(spot: RidingSpot, date: string) {
  // An Irish day's light all falls inside the UTC day of the same date.
  const sun = sunTimes(spot.lat, spot.lon, new Date(`${date}T12:00:00Z`));
  const ms = (value: Date | null) => (value ? value.getTime() : null);
  return {
    firstLight: ms(sun.civilDawn),
    sunrise: ms(sun.sunrise),
    sunset: ms(sun.sunset),
    lastLight: ms(sun.civilDusk),
  };
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
   * The headline speed: one model's own, the first of the two the stars come
   * from that reaches the hour (`lead` says which; force5/src/lead.ts).
   */
  wind_kn: number;
  /** The lowest and highest of every model, the lead among them. */
  min_kn: number;
  max_kn: number;
  /**
   * The headline gust: the lead model's, null where it gives none (no other
   * model fills it in). `gust_max_kn` is the highest of every model's.
   */
  gust_kn: number | null;
  gust_max_kn: number | null;
  /**
   * The headline gust over the headline wind (force5/src/gustFactor.ts), to
   * two places. Context only: the stars read the gust itself, not this.
   * Null without a gust. hourWind always gives it; an hour built elsewhere
   * may not.
   */
  gust_factor?: number | null;
  /** The headline bearing: the lead model's. */
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
   * How far to trust the hour: `agreement`, but low behind fewer than three
   * models. hourWind always gives it; an hour built from elsewhere (the app's
   * spot page) may not.
   */
  confidence?: Agreement;
  /** Which model the headline wind, gust and direction are, and so the stars. */
  lead: string;
  /**
   * The lead's id when it gave a gust this hour, else null. HARMONIE gives
   * none at the first hour of its run.
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

const RANK = { high: 0, moderate: 1, low: 2 } as const;
const worse = (a: Agreement, b: Agreement) => (RANK[a] >= RANK[b] ? a : b);

/**
 * How far to trust an hour or a session: its agreement, but never above "low"
 * behind fewer than three models. One or two models can agree by chance, and
 * once HARMONIE's and ICON-EU's runs end only ECMWF and GFS are left, so a
 * closely agreeing pair must not read as four models agreeing.
 * Lead time is already in the agreement, whose spread limits tighten by day.
 */
export function confidenceOf(
  agreement: Agreement | null,
  models: number,
): Agreement {
  return agreement === null || models < AGREEMENT_MIN_MODELS
    ? "low"
    : agreement;
}

/**
 * One hour at a spot: the headline from the one model the stars come from
 * (`from`: HARMONIE then ECMWF unless a caller names others), the range and
 * agreement across every model. Null where neither of the two reaches the
 * hour: the other models never stand in for them.
 */
export function hourWind(
  lines: SpotWindLines["lines"],
  time: number,
  perModel: boolean,
  from: StarsFrom = DEFAULT_STARS_FROM,
): HourWind | null {
  const samples = lines.flatMap(({ run, points, gap }) => {
    const at = windAt(points, time, gap);
    const runTime = Date.parse(run.run_time);
    return at
      ? [{ id: run.id, runTime, ...at, speed: Math.hypot(at.u, at.v) }]
      : [];
  });
  const leadId = pickModel(from, (id) => samples.some((s) => s.id === id));
  const lead = samples.find((s) => s.id === leadId);
  if (!lead) return null;
  const speeds = samples.map((s) => s.speed * KNOTS).sort((a, b) => a - b);
  const gusts = samples
    .filter((s) => s.gust !== null)
    .map((s) => s.gust! * KNOTS)
    .sort((a, b) => a - b);
  const direction = bearing(lead.u, lead.v);
  const agreement =
    samples.length > 1
      ? agreementFrom(
          speeds,
          leadHours(Math.max(...samples.map((s) => s.runTime)), time),
        )
      : null;
  const hour: HourWind = {
    wind_kn: round(lead.speed * KNOTS),
    min_kn: round(speeds[0]),
    max_kn: round(speeds[speeds.length - 1]),
    gust_kn: lead.gust === null ? null : round(lead.gust * KNOTS),
    gust_max_kn: gusts.length ? round(gusts[gusts.length - 1]) : null,
    gust_factor: null,
    direction_deg: direction,
    direction: compass(direction),
    agreement,
    models: samples.length,
    confidence: confidenceOf(agreement, samples.length),
    lead: lead.id,
    gust_lead: lead.gust === null ? null : lead.id,
  };
  const factor = gustFactor(hour.wind_kn, hour.gust_kn);
  hour.gust_factor = factor === null ? null : round(factor, 2);
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
  /** The runs that go on past `run`'s end, in turn (`handedSource`). */
  after: ModelRun[];
}

/**
 * The spot's steps from every source that says anything about it, finest
 * first: the first source's own run, then each next one's past the end of the
 * steps already taken, as the site's dock hands MI SWAN over to GFS-Wave and
 * ICON-EU weather to GFS's (force5/src/variables.ts, `handOverSeries`). The
 * sources of a kind publish the same names for the readings read here.
 */
function handedSource(
  loaded: Loaded<VariablesManifest>[],
  spotId: string,
  variable: readonly string[],
): SpotVariables | null {
  let out: SpotVariables | null = null;
  for (const { run, manifest } of loaded) {
    const steps = variableSteps(manifest, spotId);
    const name = pick(manifest, variable);
    if (!steps || !name || !steps.some((s) => finite(s.values[name]))) continue;
    if (!out) {
      out = { run, manifest, steps, after: [] };
      continue;
    }
    const reach = out.steps[out.steps.length - 1]?.time ?? -Infinity;
    const later = steps.filter((step) => step.time > reach);
    if (!later.length) continue;
    out.steps = [...out.steps, ...later];
    out.after.push(run);
  }
  return out;
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

/**
 * One hour's surface weather. spotForecast gives every field; an hour built
 * elsewhere (the app's spot page) may give only the readings it has.
 */
export interface HourWeather {
  air_c: number | null;
  /**
   * How cold the air feels in the hour's mean wind (force5/src/feelsLike.ts:
   * the JAG/TI wind chill, never above air_c). Null without a wind or an air
   * temperature.
   */
  feels_like_c?: number | null;
  /**
   * The model's rain total over the `rain_interval_hours` ending at this hour
   * (or at `rain_until`), on one row only; null on the interval's other hours.
   */
  rain_mm: number | null;
  rain_interval_hours?: number;
  /** Where the interval does not end at this row's hour: when it does end. */
  rain_until?: string;
  cloud_pct: number | null;
  /** The model's present-weather code (WMO 4677, `ww`), where it publishes one. */
  weather_code: number | null;
  /** What the code means, in the words of wingfoil.ie's sky glyph for it. */
  description?: string | null;
  /**
   * The sky glyph wingfoil.ie draws for the hour (force5/src/presentWeather.ts
   * skyOf): the code's group, rain where a dry code has rain in the hour.
   */
  sky?: WeatherIcon | null;
  /** The model's CAPE, J/kg: the energy showers can grow into storms on. */
  cape_j_kg?: number | null;
  /**
   * The risk of thunder and lightning (force5/src/thunder.ts): high where the
   * code is a thunderstorm, possible on enough CAPE, else low; null where the
   * model gives neither a code nor a CAPE. A safety flag, never an all-clear.
   */
  thunder_risk?: ThunderRisk | null;
  /** Why, where the risk is high or possible. */
  thunder_why?: string;
}

/** A rain total and the interval it covers, as one row carries it. */
interface RainTotal {
  mm: number;
  hours: number;
  until: number;
}

/** A minute: rows and steps both fall on the hour, so this is only rounding. */
const SLACK = 60000;

/**
 * The model's rain totals, each given to one row of the window so that adding
 * the rows up gives the rain and never more. A step's `precip` is the total
 * over the interval that ends at it: an hour for ICON-EU and GFS's first 120
 * hours, where each interval is its own hourly row, and three for GFS past
 * them. A three-hour total belongs to that interval and to no other hour:
 * read into each of three hourly rows, as the other weather fields are, it
 * would say three times the rain. As in the dock (src/strip.ts
 * `rainColumns`), the last row inside an interval carries it. Rows coarser
 * than the steps can leave an interval with no row inside it, which then
 * goes to the first row after it, so a three-hourly row over hourly steps
 * sums the three hours since the row before. An interval wholly before the
 * first row or after the last is outside the window and dropped.
 */
function rainRows(
  times: readonly number[],
  steps: readonly VariableStep[],
  stepHours: number | null,
): (RainTotal | null)[] {
  const rows: (RainTotal | null)[] = times.map(() => null);
  steps.forEach((step, k) => {
    const mm = step.values.precip;
    if (!finite(mm)) return;
    // The interval the step states, else the gap since the step before it.
    const hours =
      step.precipHours ??
      (k > 0 ? (step.time - steps[k - 1].time) / HOUR : stepHours);
    if (!hours || hours <= 0) return;
    const end = step.time;
    const start = end - hours * HOUR;
    let row = -1;
    for (let i = times.length - 1; i >= 0 && row < 0; i--)
      if (times[i] <= end + SLACK) row = i;
    if (row < 0) return;
    if (times[row] <= start + SLACK) {
      row = times.findIndex((t) => t > end + SLACK);
      if (row < 0) return;
    }
    const total = rows[row];
    rows[row] = total
      ? {
          mm: total.mm + mm,
          hours: total.hours + hours,
          until: Math.max(total.until, end),
        }
      : { mm, hours, until: end };
  });
  return rows;
}

/** The native cadence of a weather run: as its manifest states, else its steps'. */
function weatherStepHours(source: SpotVariables): number | null {
  const stated = source.manifest.stepHours;
  if (finite(stated) && stated > 0) return stated;
  const gap = maxGap(source.steps) / 2;
  return gap > 0 ? round(gap / HOUR, 2) : null;
}

function hourWeather(
  source: SpotVariables,
  time: number,
  rain: RainTotal | null,
): HourWeather | null {
  const step = stepAt(source.steps, time);
  const value = (name: string, places: number) => {
    const v = step?.values[name];
    return finite(v) ? round(v, places) : null;
  };
  const result: HourWeather = {
    air_c: value("t2m", 0),
    feels_like_c: null,
    rain_mm: rain && round(rain.mm, 1),
    ...(rain && { rain_interval_hours: round(rain.hours, 2) }),
    ...(rain &&
      Math.abs(rain.until - time) > SLACK && { rain_until: iso(rain.until) }),
    cloud_pct: value("clct", 0),
    weather_code: value("ww", 0),
    description: null,
    sky: null,
    cape_j_kg: null,
    thunder_risk: null,
  };
  result.description = presentWeather(result.weather_code)?.description ?? null;
  const capeName = pick(source.manifest, ["cape", "cape_ml"]);
  result.cape_j_kg = capeName ? value(capeName, 0) : null;
  const thunder = thunderRisk(result.weather_code, result.cape_j_kg);
  result.thunder_risk = thunder?.risk ?? null;
  if (thunder?.why) result.thunder_why = thunder.why;
  return [
    result.air_c,
    result.rain_mm,
    result.cloud_pct,
    result.weather_code,
  ].every((v) => v === null)
    ? null
    : result;
}

/**
 * Each hour's rain as the total of the interval it falls in, read back from
 * the row that carries it, by the hour's time: for a reader that draws each
 * hour on its own (the spot page's sky) rather than adding the rows up. An
 * hour no total covers is absent.
 */
export function rainByHour(
  hours: readonly ForecastHour[],
): Map<number, number> {
  const times = hours.map((hour) => Date.parse(hour.time));
  const rain = new Map<number, number>();
  for (const hour of hours) {
    const weather = hour.weather;
    if (!weather?.rain_interval_hours || weather.rain_mm === null) continue;
    const until = Date.parse(weather.rain_until ?? hour.time);
    const start = until - weather.rain_interval_hours * HOUR;
    for (const time of times)
      if (time > start + SLACK && time <= until + SLACK)
        rain.set(time, weather.rain_mm);
  }
  return rain;
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
    if (!Number.isFinite(time) || time < window.from || time >= window.to)
      return [];
    if (e.kind !== "high" && e.kind !== "low") return [];
    return [
      {
        time: iso(time),
        local: localStamp(time),
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
    // The station's own credit (the Marine Institute's, or in Northern Ireland
    // wingfoil.ie's from the Environment Agency's gauges and EOT20).
    attribution: text(station.attribution) ?? text(manifest.attribution),
  };
}

export interface SpotSea {
  celsius: number;
  /** When it was read, in Irish time with its zone ("Wed, 16 Sept, 21:12 IST"). */
  measured: string;
  /** The same instant as an ISO time, to say how long ago it was. */
  time: string;
  station: string;
  /** "coastal", "sentinel" or "buoy"; null where the bundle does not say. */
  network: string | null;
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
    measured: localStamp(time),
    time: iso(time),
    station: isObject(station)
      ? (text(station.name) ?? spot.station)
      : spot.station,
    network: isObject(station) ? text(station.network) : null,
    distance_km: finite(spot.distanceKm) ? round(spot.distanceKm) : 0,
    attribution: text(manifest.attribution),
  };
}

// ---- answers ---------------------------------------------------------------------

export interface ForecastHour {
  time: string;
  local: string;
  /** The sun is up at the row's time: the hours the stars are rated over. */
  daylight: boolean;
  /**
   * How light it is at the row's time: day, twilight (first light to sunrise,
   * sunset to last light) or dark. spotForecast always gives it; an hour
   * built elsewhere (the spot page's tests) may not.
   */
  light?: Light;
  wind: HourWind | null;
  /**
   * How the headline wind meets the shore; "on-water" at a spot on the water;
   * null where a beach's facing is unknown.
   */
  shore?: SpotShore | null;
  waves?: HourWaves | null;
  weather?: HourWeather | null;
  /** Where an ensemble reaches the spot: the spread of its members. */
  ensemble?: HourEnsemble | null;
  /**
   * The hour's stars for `rider`, as the spot page shows them; null where the
   * site does not rate the hour, `why_not_rated` saying why. Only where a
   * rider was asked for.
   */
  rating?: HourStars | null;
  why_not_rated?: string;
  /**
   * The Met Éireann warnings covering the hour, on every hour when the spot has
   * any (null on an hour none covers); absent when it has none. Orange or red
   * (`replaces_rating`): no rating, never rideable.
   */
  warning?: HourWarning | null;
  /**
   * The bathing water notices covering the hour (mcp/api/waterQuality.ts);
   * absent where none does. `replaces_rating`: no rating, never rideable.
   */
  water?: HourWater;
}

/** One Irish day's light at the spot, in Irish time with its zone. */
export interface DayLight {
  /** The Irish calendar day, "2026-10-25". */
  date: string;
  /** Civil dawn: light enough to see the water before sunrise. */
  first_light: string | null;
  sunrise: string | null;
  sunset: string | null;
  /** Civil dusk: the end of usable light; be off the water by then. */
  last_light: string | null;
}

export interface DayWindow {
  /** The Irish calendar day, "2026-10-25". */
  date: string;
  window: (Session & { tides?: SpotTides["events"] }) | null;
  /** Where there is no window, why. */
  why_none?: string;
}

export interface SpotForecast {
  spot: RidingSpot;
  /** The bearing the shore looks out to sea along, or null where there is none. */
  shore_facing_deg?: number | null;
  /** A beach with a facing, a spot on the water, or a beach whose facing is unknown. */
  shore_type?: ShoreType;
  /** What the shore type means for the stars and the offshore filter, where it is not a beach. */
  shore_note?: string;
  /** The other spots within NEARBY_KM: often the same beach or water. */
  nearby?: NearbySpot[];
  /**
   * The winds the shore wants, as the spot page's header gives them ("ENE–ESE",
   * "SSW–W"): cross-onshore and cross-shore. Null where there is no facing.
   */
  best_directions?: string[] | null;
  /** Who the stars are for, where a rider was asked for. */
  rider?: RiderUsed;
  /**
   * Each Irish day's best stretch for `rider`, summed up as find_wind's
   * sessions are, with the tides inside it; null on a day where no two hours
   * in a row earn a star.
   */
  best_windows?: DayWindow[];
  units: Record<string, string>;
  window: {
    from: string;
    to: string;
    step_hours: number;
    /** How far apart the weather model's own steps are, where one reaches the spot. */
    weather_step_hours?: number;
  };
  hours: ForecastHour[];
  sun: DayLight[];
  tides: SpotTides | { note: string } | null;
  sea_temperature: SpotSea | null;
  /** Met Éireann's warnings for the spot, in force or still to come (mcp/api/warnings.ts). */
  warnings: WarningsAnswer;
  /** The EPA's bathing water notices near the spot (mcp/api/waterQuality.ts). */
  water_quality: WaterAnswer;
  sources: {
    wind: ModelRun[];
    wind_outside_domain: string[];
    waves: ModelRun | null;
    /** The wave runs that go on past `waves`' end, in turn. */
    waves_after?: ModelRun[];
    weather: ModelRun | null;
    /** The weather runs that go on past `weather`'s end, in turn. */
    weather_after?: ModelRun[];
    unavailable: Unavailable[];
  };
  method: string;
}

export const METHOD =
  "Wind, gust and direction are one model's own forecast, never a blend of " +
  "several: HARMONIE's while it reaches the hour (about 60 hours ahead), and " +
  "past it ECMWF's (`lead` names the model; `model` chooses another, which " +
  "ECMWF follows the same way). Where that model gives no gust, `gust_kn` is null. An hour neither " +
  "model reaches has no wind. The range (min_kn, max_kn, gust_max_kn) is " +
  "across every model, as context, and agreement comes from the standard " +
  "deviation of every model's speed (an ensemble's member mean counting once), " +
  "tighter the further " +
  `ahead: high under ${AGREEMENT_SPREAD_KN[0][0]} kn today and under ` +
  `${AGREEMENT_SPREAD_KN[3][0]} kn from day 3, low from ` +
  `${AGREEMENT_SPREAD_KN[0][1]} kn today and ${AGREEMENT_SPREAD_KN[3][1]} kn ` +
  "from day 3, and never high from fewer than three models. `confidence` is " +
  "the agreement but low wherever fewer than three models cover the hour " +
  "(`models`; once the shorter runs end, only ECMWF and GFS are left). Not " +
  "bias-corrected against observations. " +
  "Waves come from the finest wave model that covers the spot and, past the " +
  "end of its run, from the next (`sources.waves_after`); the weather goes " +
  "on the same way (`sources.weather_after`). " +
  "Model forecasts only: never a statement that conditions are safe.";

export const UNITS = {
  wind: "knots",
  shore:
    "`shore` is how the wind meets the beach, by the stars' rule: onshore, " +
    "cross-on, cross, cross-off or offshore. A spot on the water " +
    '(`shore_type` "on-water", such as Malahide Estuary) is ridden in the ' +
    'middle of the water rather than off one beach: its `shore` is "on-water", ' +
    "onshore and offshore don't apply, the stars rate the wind alone and " +
    "find_wind's offshore filter doesn't apply, so the rider judges the wind " +
    "against the shore they launch from and the one it would carry them to. " +
    "Where a beach's facing isn't known (`shore_type` \"unknown\") `shore` is " +
    "null and offshore wind can't be ruled out",
  gust_factor:
    "`gust_factor` is the hour's gust_kn over its wind_kn (one model's, the " +
    "one the stars rate), as context: the stars read the gust itself, not " +
    "the factor. A gust past too much (`rider.gust_limit_kn`) leaves the " +
    `hour no stars; any other gust is read ${GUST_EASE_KN} kn lighter, and where that is ` +
    "worth fewer stars than the mean wind the hour takes the lower",
  direction: "degrees the wind or waves come FROM (0 = north)",
  waves: "metres (significant height), seconds (peak period)",
  temperature: "°C",
  rain:
    "mm: the weather model's own total over the `rain_interval_hours` " +
    "ending at that row's hour, or at `rain_until` where given: 1 where the " +
    "model steps hourly (ICON-EU, and GFS to +120 h), so each hourly row is " +
    "its own hour's rain, and 3 where it steps three-hourly (GFS past +120 h). " +
    "Each total is on one row only, with null on an interval's other hours, " +
    "so adding rain_mm up over rows gives the rain in their intervals. A row " +
    "further apart than the model's steps sums the intervals since the row before",
  weather:
    "air_c, cloud_pct and weather_code are the weather model's nearest step, " +
    "`window.weather_step_hours` apart (the first weather run's cadence: 1 " +
    "for ICON-EU), so each hour has its own; where the steps are more than an " +
    "hour apart they repeat on the hours between",
  thunder:
    "`thunder_risk` is a safety flag from the weather model's own fields: " +
    "high where its code is a thunderstorm (ww 13, 17, 29, 91–99; ICON-EU " +
    "forecasts these, GFS's code never does), possible where CAPE is " +
    `${THUNDER_CAPE_WET} J/kg or more with showers or rain in the code (ww 50–99) ` +
    `or ${THUNDER_CAPE_DRY} J/kg or more under any sky, else low; null where the ` +
    "model gives neither. Lightning strikes well ahead of a storm: tell a " +
    "rider to stay off the water on a high or possible hour and the hours " +
    "either side of it, and never read low as a promise of no storm. " +
    "Met Éireann's warnings come first",
  feels_like:
    "°C: `feels_like_c` is worked out here, as no model publishes one: the " +
    "JAG/TI wind chill index (Environment Canada, US NWS, UK Met Office), " +
    "13.12 + 0.6215 T − 11.37 V^0.16 + 0.3965 T V^0.16, from air_c (T, at 2 m) " +
    "and the hour's mean wind_kn at 10 m in km/h (V), never the gust. Designed " +
    "for 10 °C and below; above that it is used as it stands but never above " +
    "air_c, so its cooling fades out by about 20 °C. Below 3 kn it is air_c. " +
    "For dry skin in shade: a wet rider loses heat much faster, so treat it " +
    "as the warmest it will feel",
  weather_code:
    "the model's WMO present-weather code (`ww`, WMO-No. 306 code table 4677), " +
    "its own interpretation, never an observation. `description` is the " +
    "code's meaning in the words of wingfoil.ie's sky glyph, and `sky` the " +
    "glyph drawn for the hour: clear, partly, cloudy, fog, drizzle, rain, " +
    "showers, thunder or snow, rain where a dry code has 0.3 mm or more in " +
    "the hour's rain interval. Describe the sky from these, not from the bare code",
  light:
    "each row's `light` is at its time: day from sunrise to sunset, twilight " +
    "from first light (civil dawn, the sun 6° down) to sunrise and from " +
    "sunset to last light (civil dusk), dark otherwise. `daylight` is the " +
    "sun being up, the hours wingfoil.ie rates. `sun` gives each Irish day's " +
    "first light, sunrise, sunset and last light: a session ends by last light",
  time:
    "`time` is UTC (ISO 8601). Every `local` label, and sunrise, sunset, the " +
    "tides' and the sea temperature's times, is Irish time ending in its zone: " +
    "IST (Irish Standard Time, UTC+1, late March to late October) or GMT " +
    "(UTC+0). Quote the zone around a clock change: the night the clocks go " +
    "back has 01:00 IST and then 01:00 GMT, two different hours",
};

export async function spotForecast(
  source: ForecastSource,
  spot: RidingSpot,
  window: Window,
  options: {
    perModel?: boolean;
    now: number;
    /** The model the headline is, and the one past its run (default HARMONIE, then ECMWF). */
    from?: StarsFrom;
    /** Rate every hour for this rider, as the spot page does, and pick each day's best window. */
    rider?: Rider;
  },
): Promise<SpotForecast> {
  // Only the one square that holds the spot is read, of each model.
  const square = [spotSquare(spot.lat, spot.lon)];
  const [wind, waves, weather, tides, sea, warned, notices] =
    await Promise.all([
      loadWind(source, options.now, square),
      loadWaves(source, options.now, square),
      loadWeather(source, options.now, square),
      spotTides(source, spot.id, window),
      spotSea(source, spot.id),
      loadWarnings(source),
      loadWaterQuality(source),
    ]);
  const warnings = placeWarnings(warned, spot, options.now);
  const water = spotWaterQuality(notices, spot.id, options.now);
  const { lines, outside } = spotWindLines(wind.loaded, spot.id);
  const memberLines = spotMemberLines(wind.loaded, spot.id);
  const waveSource = handedSource(waves.loaded, spot.id, ["swh"]);
  const weatherSource = handedSource(weather.loaded, spot.id, ["t2m"]);
  const facing = shoreFacing(spot.id);
  const kind = shoreType(spot.id);
  const times = axis(window);
  const weatherStep = weatherSource && weatherStepHours(weatherSource);
  const rain = weatherSource
    ? rainRows(times, weatherSource.steps, weatherStep)
    : [];
  const hours = times.map((time, row): ForecastHour => {
    const wind = hourWind(lines, time, options.perModel ?? false, options.from);
    const hour: ForecastHour = {
      time: iso(time),
      local: localStamp(time),
      daylight: daylight(spot, time),
      light: lightAt(spot, time),
      wind,
      shore: kind === "on-water" ? "on-water" : shoreOf(facing, wind),
    };
    if (waveSource) hour.waves = hourWaves(waveSource, time);
    if (weatherSource) {
      hour.weather = hourWeather(weatherSource, time, rain[row]);
      // The mean wind the hour is rated on, never the gust.
      if (hour.weather)
        hour.weather.feels_like_c = feelsLikeC(
          hour.weather.air_c,
          wind?.wind_kn,
        );
    }
    if (memberLines.length) hour.ensemble = hourEnsemble(memberLines, time);
    if (warnings.warnings.length)
      hour.warning = hourWarning(warnings, time, window.stepHours);
    const covered = hourWater(water, time, window.stepHours);
    if (covered) hour.water = covered;
    return hour;
  });
  // The sky as the spot page draws it, from each hour's share of the rain.
  const rainEach = rainByHour(hours);
  for (const hour of hours)
    if (hour.weather)
      hour.weather.sky = skyOf({
        ...hour.weather,
        rain_mm: rainEach.get(Date.parse(hour.time)) ?? null,
      });
  const note = shoreNote(spot, kind);
  const best = options.rider
    ? rateForecast(lines, window, hours, spot, facing, tides, {
        rider: options.rider,
        from: options.from,
        warnings,
        water,
      })
    : null;
  const days = new Set(hours.map((h) => dublinDate(Date.parse(h.time))));
  const stamp = (time: number | null) =>
    time === null ? null : localStamp(time);
  const sun = [...days].map((date): DayLight => {
    const day = daySun(spot, date);
    return {
      date,
      first_light: stamp(day.firstLight),
      sunrise: stamp(day.sunrise),
      sunset: stamp(day.sunset),
      last_light: stamp(day.lastLight),
    };
  });
  return {
    spot,
    shore_facing_deg: facing,
    shore_type: kind,
    ...(note && { shore_note: note }),
    best_directions: bestDirections(facing),
    ...(options.rider && { rider: riderUsed(options.rider) }),
    ...(best && { best_windows: best }),
    units: UNITS,
    window: {
      from: iso(window.from),
      to: iso(window.to),
      step_hours: window.stepHours,
      ...(weatherStep && { weather_step_hours: weatherStep }),
    },
    hours,
    sun,
    tides,
    sea_temperature: sea,
    warnings: warningsAnswer(warnings, options.now, spot),
    water_quality: waterAnswer(water, options.now),
    sources: {
      wind: lines.map((l) => l.run),
      wind_outside_domain: outside,
      waves: waveSource?.run ?? null,
      ...(waveSource?.after.length && { waves_after: waveSource.after }),
      weather: weatherSource?.run ?? null,
      ...(weatherSource?.after.length && {
        weather_after: weatherSource.after,
      }),
      unavailable: [
        ...wind.unavailable,
        ...waves.unavailable,
        ...weather.unavailable,
      ],
    },
    method: METHOD,
  };
}

/**
 * The window rated for a rider as the spot page rates it, hour by hour
 * whatever the rows' step: each row its stars (or why it has none), and each
 * Irish day its best window, force5's `bestWindow` (the longest run of two
 * hours or more at the highest rating any such run reaches, rated on its
 * weakest hour) over that day's hours, ended by last light.
 */
function rateForecast(
  lines: SpotWindLines["lines"],
  window: Window,
  rows: ForecastHour[],
  spot: RidingSpot,
  facing: number | null,
  tides: SpotTides | { note: string } | null,
  options: {
    rider: Rider;
    from?: StarsFrom;
    warnings: PlaceWarnings;
    water: SpotWaterQuality;
  },
): DayWindow[] {
  const { rider, warnings, water } = options;
  for (const row of rows) {
    const rating = ratingUnderWater(
      ratingUnderWarnings(
        rateWind(row.wind, row.daylight, facing, rider),
        row.warning,
      ),
      row.water,
    );
    row.rating = rating && hourStars(rating);
    if (!row.rating)
      row.why_not_rated = row.warning?.replaces_rating
        ? NOT_RATED.warning
        : row.water?.replaces_rating
          ? NOT_RATED.water
          : row.wind
          ? NOT_RATED.dark
          : NOT_RATED.noWind;
  }
  const hourly = axis({ ...window, stepHours: 1 }).map((time) => {
    const wind = hourWind(lines, time, false, options.from);
    return {
      time,
      wind,
      shore: shoreOf(facing, wind),
      // An orange or red warning, or a notice against bathing, leaves the
      // hour unrated, before any window is picked.
      rating: ratingUnderWater(
        ratingUnderWarnings(
          rateWind(wind, daylight(spot, time), facing, rider),
          hourWarning(warnings, time),
        ),
        hourWater(water, time),
      ),
    };
  });
  const events = tides && "events" in tides ? tides.events : [];
  const days = new Map<string, typeof hourly>();
  for (const hour of hourly) {
    const date = dublinDate(hour.time);
    days.set(date, [...(days.get(date) ?? []), hour]);
  }
  return [...days].map(([date, day]): DayWindow => {
    const best = bestWindow(day.map((h) => h.rating));
    if (!best)
      return {
        date,
        window: null,
        why_none: day.some((h) => h.rating)
          ? "no two hours in a row earn a star for this rider"
          : "no hour of the window on this day is rated: dark, no wind forecast, an orange or red warning, or a bathing water notice",
      };
    const run = day
      .slice(best.from, best.to + 1)
      .map((h) => ({ ...h, hour: h.wind! }));
    const summary = session(run, spot, true);
    const from = Date.parse(summary.from);
    const to = Date.parse(summary.to);
    const inside = events.filter((e) => {
      const t = Date.parse(e.time);
      return t >= from && t <= to;
    });
    return {
      date,
      window: { ...summary, ...(inside.length && { tides: inside }) },
    };
  });
}

export interface Session {
  from: string;
  /** Its last hour's end, or last light where that comes first. */
  to: string;
  local: string;
  /** The forecast hours it spans; the last may end early, at last light. */
  hours: number;
  /** It stops at last light (civil dusk), not at its last hour's end. */
  ends_at_last_light?: boolean;
  /** Hours after last light or before first light: only where daylight_only is off. */
  dark_hours?: number;
  wind_kn: number;
  min_kn: number;
  max_kn: number;
  gust_max_kn: number | null;
  /** The strongest headline gust (the lead model's, else every model's top). */
  gust_kn: number | null;
  /** Its highest gust factor, gust ÷ mean, of the one model's own (`gust_kn`). */
  gust_factor: number | null;
  /** Its weakest hour's stars for the rider: what it can be relied on for. */
  stars: number | null;
  /** Its best hour's stars. */
  best_stars: number | null;
  /** Why its weakest hour has no more stars, in the site's words. */
  why_not_more_stars?: string[];
  direction: string;
  direction_deg: number;
  /**
   * The most offshore of its hours; "on-water" at a spot on the water; null
   * where a beach's facing is unknown.
   */
  shore: SpotShore | null;
  /** Hours with the wind dead offshore: none unless offshore hours were allowed. */
  offshore_hours: number;
  /** The worst agreement of any hour; null when only one model covered it. */
  agreement: Agreement | null;
  /** The fewest models behind any hour of the session. */
  models: number;
  /** The worst confidence of any hour: low wherever fewer than three models cover it. */
  confidence: Agreement;
}
export interface SpotSessions {
  spot: RidingSpot;
  /** Kilometres from `near`, as the crow flies, when a search gave one. */
  distance_km?: number;
  /** The bearing the shore looks out to sea along, or null where there is none. */
  shore_facing_deg: number | null;
  /** A beach, a spot on the water (no offshore filter applies) or a beach whose facing is unknown. */
  shore_type: ShoreType;
  /** The other spots within NEARBY_KM: often the same beach or water. */
  nearby?: NearbySpot[];
  /** The winds the shore wants, as the spot page's header gives them. */
  best_directions: string[] | null;
  /** Hours earning at least `min_stars` for the rider, in sessions. */
  rideable_hours: number;
  /**
   * The best stretch of the search for the rider, force5's `bestWindow` over
   * the hours that count, as the spots are ranked by; null with none.
   */
  best_window: Session | null;
  sessions: Session[];
  /** Ids of the Met Éireann warnings in force at the spot during the search. */
  warnings?: string[];
  /** Ids of the bathing water notices standing at the spot during the search. */
  water_notices?: string[];
}

export interface FindOptions {
  /** Who the stars are for: the site's default rider unless an agent says. */
  rider: Rider;
  /** The fewest stars an hour must earn to count (wingfoil.ie's rating). */
  minStars: number;
  /** Optionally also a mean wind range, knots, on top of the stars. */
  minKnots?: number;
  maxKnots?: number;
  /** An hour gusting over this many knots is not rideable. */
  maxGustKnots?: number;
  /** Nor one whose gust is more than this many times its mean wind. */
  maxGustFactor?: number;
  /** Count hours with the wind dead offshore too (they are left out by default). */
  allowOffshore?: boolean;
  /**
   * Only hours whose start is between sunrise and sunset, the hours the stars
   * rate, each session ending by last light. Off, every hour counts, dark
   * ones too, and a session runs to its last hour's end.
   */
  daylightOnly: boolean;
  minSessionHours: number;
  /** Only spots in these counties. */
  counties?: readonly string[];
  /** Only spots within maxKm of here, each with its distance. */
  near?: { lat: number; lon: number };
  maxKm?: number;
  limit: number;
  now: number;
  /** The model the headline is, and the one past its run (default HARMONIE, then ECMWF). */
  from?: StarsFrom;
}

/** The gust a limit reads: the headline's, else the top of every model's. */
const gustOf = (hour: HourWind) => hour.gust_kn ?? hour.gust_max_kn;

/** Whether an hour's gust is inside the limits a search asked for. */
function gustWithin(hour: HourWind, options: FindOptions): boolean {
  const gust = gustOf(hour);
  if (gust === null) return true;
  if (options.maxGustKnots !== undefined && gust > options.maxGustKnots)
    return false;
  return (
    options.maxGustFactor === undefined ||
    hour.wind_kn <= 0 ||
    gust / hour.wind_kn <= options.maxGustFactor
  );
}

/**
 * Spots ranked by their stars for a rider: every hour of the window rated as
 * the spot page rates it (force5/src/stars.ts `rateHour` on the one model's
 * wind, gust and direction), an hour counting when it earns `minStars` or
 * more and passes the search's own limits, the hours that count grouped into
 * sessions. A gust over the rider's limit leaves an hour no stars, so it never
 * counts. Spots rank by their best window's stars, then by hours that count,
 * then nearest first. How far the other models agree is reported beside each
 * session, as the site shows it beside the stars, and decides nothing (the
 * ruling of 19 October 2026). With `near`, only spots within `maxKm` are
 * searched, each with its distance.
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
  /** Every Met Éireann warning in force at a searched spot during the window. */
  warnings: WarningsAnswer;
  /** Every bathing water notice standing at a searched spot during the window. */
  water_quality: WaterAnswer;
  /**
   * The last hour the models the ranking reads (the stars' model and the one
   * after it) reach, and which of them reaches it, or null when neither is
   * published: no hour past it can be a session.
   */
  reach: Reach | null;
}> {
  const counties = options.counties?.length
    ? new Set(options.counties.map(countyKey))
    : null;
  const near = options.near;
  const distance = new Map(
    near ? spots.map((s) => [s.id, round(distanceKm(near, s))]) : [],
  );
  const pool = spots.filter(
    (s) =>
      (!counties || counties.has(countyKey(s.county))) &&
      (options.maxKm === undefined ||
        !near ||
        distance.get(s.id)! <= options.maxKm),
  );
  // The squares of the places searched: every square for all of Ireland,
  // fewer for a county or a radius.
  const [wind, warned, notices] = await Promise.all([
    loadWind(source, options.now, squaresFor(pool)),
    loadWarnings(source),
    loadWaterQuality(source),
  ]);
  const times = axis({ ...window, stepHours: 1 });
  const during = { from: window.from, to: times.at(-1)! + HOUR };
  const warnings = warningsAcross(warned, pool, options.now, during);
  const water = waterAcross(
    notices,
    pool.map((s) => s.id),
    options.now,
    during,
  );
  const results: SpotSessions[] = [];
  for (const spot of pool) {
    const { lines } = spotWindLines(wind.loaded, spot.id);
    if (!lines.length) continue;
    const facing = shoreFacing(spot.id);
    const spotWarnings: PlaceWarnings = {
      status: warnings.answer.status,
      checkedAt: warnings.answer.checked_at,
      warnings: warnings.bySpot.get(spot.id) ?? [],
    };
    const spotWater = { notices: water.bySpot.get(spot.id) ?? [] };
    const sessions: Session[] = [];
    const hours: SessionHour[] = [];
    let run: SessionHour[] = [];
    const close = () => {
      if (run.length >= options.minSessionHours)
        sessions.push(session(run, spot, options.daylightOnly));
      run = [];
    };
    for (const time of times) {
      const hour = hourWind(lines, time, false, options.from);
      const shore = shoreOf(facing, hour);
      // Rated as on the site, sunrise to sunset; a search for dark hours
      // rates them as though they were light.
      // An orange or red warning, or a notice against bathing, leaves the
      // hour unrated, so it never counts.
      const rating = ratingUnderWater(
        ratingUnderWarnings(
          rateWind(
            hour,
            !options.daylightOnly || daylight(spot, time),
            facing,
            options.rider,
          ),
          hourWarning(spotWarnings, time),
        ),
        hourWater(spotWater, time),
      );
      const good =
        hour !== null &&
        rating !== null &&
        rating.stars >= options.minStars &&
        (options.minKnots === undefined || hour.wind_kn >= options.minKnots) &&
        (options.maxKnots === undefined || hour.wind_kn <= options.maxKnots) &&
        gustWithin(hour, options) &&
        (options.allowOffshore || shore !== "offshore");
      const counted = {
        time,
        hour: hour!,
        shore,
        rating: good ? rating : null,
      };
      hours.push(counted);
      if (good) run.push(counted);
      else close();
    }
    close();
    if (!sessions.length) continue;
    const nearby = nearbySpots(spots, spot);
    const best = bestWindow(
      hours.map((h) => h.rating),
      options.minSessionHours,
    );
    results.push({
      spot,
      ...(near && { distance_km: distance.get(spot.id)! }),
      shore_facing_deg: facing,
      shore_type: shoreType(spot.id),
      ...(nearby.length && { nearby }),
      best_directions: bestDirections(facing),
      rideable_hours: sessions.reduce((sum, s) => sum + s.hours, 0),
      best_window: best
        ? session(
            hours.slice(best.from, best.to + 1),
            spot,
            options.daylightOnly,
          )
        : null,
      sessions,
      ...(spotWarnings.warnings.length && {
        warnings: spotWarnings.warnings.map((w) => w.warning.capId),
      }),
      ...(spotWater.notices.length && {
        water_notices: spotWater.notices.map((n) => n.notice.id),
      }),
    });
  }
  results.sort(
    (a, b) =>
      (b.best_window?.stars ?? 0) - (a.best_window?.stars ?? 0) ||
      b.rideable_hours - a.rideable_hours ||
      (a.distance_km ?? 0) - (b.distance_km ?? 0),
  );
  const runs = wind.loaded.map((l) => l.run);
  return {
    spots: results.slice(0, options.limit),
    searched: pool.length,
    sources: runs,
    unavailable: wind.unavailable,
    warnings: warnings.answer,
    water_quality: water.answer,
    reach: forecastReach(runs, options.from),
  };
}

export interface Reach {
  time: number;
  model: string;
}

/**
 * The last hour the headline's models (the stars' model and the one after it)
 * reach among `runs`, and which of them reaches it, or null when neither is
 * published. GFS alone, live but not one of the two, never counts.
 */
export function forecastReach(
  runs: readonly ModelRun[],
  from: StarsFrom = DEFAULT_STARS_FROM,
): Reach | null {
  const leads = leadOrder(from);
  return runs
    .filter((run) => leads.includes(run.id))
    .map((run) => ({ time: Date.parse(run.until), model: run.name }))
    .reduce<Reach | null>(
      (last, r) => (last && last.time >= r.time ? last : r),
      null,
    );
}

interface SessionHour {
  time: number;
  hour: HourWind;
  shore: ShoreAngle | null;
  rating: HourRating | null;
}

function session(
  run: SessionHour[],
  spot: RidingSpot,
  byLastLight: boolean,
): Session {
  const speeds = run.map((r) => r.hour.wind_kn);
  const gusts = run.flatMap((r) =>
    r.hour.gust_max_kn === null ? [] : [r.hour.gust_max_kn],
  );
  const headlineGusts = run.flatMap((r) => {
    const gust = gustOf(r.hour);
    return gust === null ? [] : [gust];
  });
  // Direction from the unit vectors, so SW and W average to WSW, not to E.
  let x = 0;
  let y = 0;
  for (const { hour } of run) {
    x += Math.sin((hour.direction_deg * Math.PI) / 180);
    y += Math.cos((hour.direction_deg * Math.PI) / 180);
  }
  const direction =
    Math.round(((Math.atan2(x, y) * 180) / Math.PI + 360) % 360) % 360;
  const worst = run.reduce<Agreement | null>((acc, r) => {
    const a = r.hour.agreement;
    if (a === null) return acc;
    return acc === null ? a : worse(acc, a);
  }, null);
  const factors = run.flatMap((r) =>
    r.hour.gust_factor == null ? [] : [r.hour.gust_factor],
  );
  const ratings = run.flatMap((r) => (r.rating ? [r.rating] : []));
  const weakest = ratings.length
    ? ratings.reduce((a, b) => (b.stars < a.stars ? b : a))
    : null;
  const first = run[0].time;
  const last = run[run.length - 1].time;
  // Never past last light: an hour that starts before sunset is rated, but a
  // rider must be off the water by dusk.
  const lastLight = byLastLight
    ? daySun(spot, dublinDate(last)).lastLight
    : null;
  const clipped = lastLight !== null && lastLight < last + HOUR;
  const end = clipped ? lastLight : last + HOUR;
  const dark = byLastLight
    ? 0
    : run.filter((r) => lightAt(spot, r.time) === "dark").length;
  return {
    from: iso(first),
    to: iso(end),
    local: localSpan(first, end),
    hours: run.length,
    ...(clipped && { ends_at_last_light: true }),
    ...(dark > 0 && { dark_hours: dark }),
    wind_kn: round(speeds.reduce((a, b) => a + b, 0) / speeds.length),
    min_kn: Math.min(...speeds),
    max_kn: Math.max(...speeds),
    gust_max_kn: gusts.length ? Math.max(...gusts) : null,
    gust_kn: headlineGusts.length ? Math.max(...headlineGusts) : null,
    gust_factor: factors.length ? Math.max(...factors) : null,
    stars: ratings.length ? weakest!.stars : null,
    best_stars: ratings.length
      ? Math.max(...ratings.map((r) => r.stars))
      : null,
    ...(weakest?.reasons.length && { why_not_more_stars: weakest.reasons }),
    direction: compass(direction),
    direction_deg: direction,
    shore: isOnWater(spot.id)
      ? "on-water"
      : run.reduce<ShoreAngle | null>(
          (most, { shore }) =>
            shore !== null && (most === null || SEAWARD[shore] > SEAWARD[most])
              ? shore
              : most,
          null,
        ),
    offshore_hours: run.filter((r) => r.shore === "offshore").length,
    agreement: worst,
    models: Math.min(...run.map((r) => r.hour.models)),
    confidence: run
      .map(
        (r) =>
          r.hour.confidence ?? confidenceOf(r.hour.agreement, r.hour.models),
      )
      .reduce(worse),
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
