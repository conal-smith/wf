/**
 * The forecast alerts are evaluated on: the published blend (weather/blend.json
 * and its spot squares, rebuilt hourly by force5/blend), rated per rider the
 * way the map rates it. The blend carries the hours the default stars come
 * from (HARMONIE, then ECMWF; force5/src/lead.ts); a rider who picked another
 * model is rated from its own spot squares, and ECMWF's past its run, instead, read through the forecast server's
 * loader and its `hourWind` (mcp/api/forecast.ts), the rule the spot page uses.
 *
 * The map reads the blend through src/spotBlend.ts, which this service cannot
 * import: that module and its imports (src/ratings.ts, force5/src/weather.ts)
 * are written for Vite and the browser, and this one compiles as plain Node
 * ESM (market/api/tsconfig.json). So it takes the same road through the
 * dependency-free pieces the forecast server already shares with the site —
 * the one spot-square loader (force5/src/spotData.ts), the stars
 * (force5/src/stars.ts) and the sun (force5/src/sun.ts) — and forecast.test.ts
 * holds it to `parseSpotBlend`, `spotBlendHours` and `daylightOn`, value for
 * value, so the stars in a notification are the stars on the chart.
 *
 * The places are the published catalogue (public/riding-locations.json, the
 * list the blend job rates) with the shore facing the stars need, from the
 * same table the map reads (companion/api/spots.ts shoreFacing).
 */
import {
  checkBase,
  checkSpotIndex,
  loadSpotSquares,
  type ReadJson,
  type SpotIndex,
} from "../../force5/src/spotData.js";
import { rateHour, type Agreement, type Rider } from "../../force5/src/stars.js";
import { dayNights } from "../../force5/src/sun.js";
import { shoreFacing } from "../../companion/api/spots.js";
import { sameStarsFrom, starsFromAt, type StarsFrom } from "../../force5/src/lead.js";
import {
  hourWind,
  loadWind,
  spotWindLines,
} from "../../mcp/api/forecast.js";
import { squaresFor } from "../../force5/src/spotData.js";
import type { ForecastSource } from "../../mcp/api/source.js";
import catalogue from "../../public/riding-locations.json" with { type: "json" };
import type { RatedColumn } from "../shared/match.js";

/** Where the blend's pointer is published (src/spotBlend.ts SPOT_BLEND_PATH). */
export const BLEND_PATH = "weather/blend.json";
const BLEND_KEY = "spotBlend";
/** Past this the map stops trusting the blend, and alerts stop too (SPOT_BLEND_MAX_AGE_HOURS). */
export const BLEND_MAX_AGE_HOURS = 6;

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  facing: number | null;
}

/** Every riding place, by id. */
export const PLACES: ReadonlyMap<string, Place> = new Map(
  (catalogue as { id: string; name: string; lat: number; lon: number }[]).map((row) => [
    row.id,
    { id: row.id, name: row.name, lat: row.lat, lon: row.lon, facing: shoreFacing(row.id) },
  ]),
);

export const placeName = (id: string) => PLACES.get(id)?.name ?? id;

/** The pointer, as far as alerts need it. */
export interface BlendPointer {
  kind: "blend";
  model: "blend";
  run: string;
  generatedAt: string;
  times: string[];
  base: string;
  spots: SpotIndex;
  /**
   * The models every place's hours are (src/spotBlend.ts). Absent from a blend
   * built before 19 October 2026, which then fits no rider's stars.
   */
  lead?: StarsFrom;
}

/** One place's consensus on the blend's times: knots in tenths, bearings in degrees. */
export interface BlendSeries {
  wind: (number | null)[];
  gust: (number | null)[];
  from: (number | null)[];
  agreement: string;
  /** Which model each time is: its place in the pointer's sources, base 36. */
  lead?: string;
}

export interface Blend {
  pointer: BlendPointer;
  spots: Record<string, BlendSeries>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const numberOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));

/** The published pointer, checked as parseSpotBlend checks it; throws with a sentence. */
export function parseBlendPointer(body: unknown): BlendPointer {
  if (!isObject(body) || body.kind !== "blend" || body.model !== "blend")
    throw new Error("Not a blend file.");
  if (body.schemaVersion !== 2) throw new Error(`Unknown blend schema ${String(body.schemaVersion)}.`);
  const times = body.times;
  if (!Array.isArray(times) || !times.every((t) => typeof t === "string" && Number.isFinite(Date.parse(t))))
    throw new Error("The blend's times are not a list of times.");
  if (typeof body.run !== "string" || typeof body.generatedAt !== "string")
    throw new Error("The blend names no run.");
  checkBase(body.base);
  const index = checkSpotIndex(body.spots);
  if (index.keys.length !== 1 || index.keys[0] !== BLEND_KEY)
    throw new Error(`The blend's squares must carry ${BLEND_KEY} alone.`);
  return body as unknown as BlendPointer;
}

function checkSeries(times: readonly string[], spots: unknown): Record<string, BlendSeries> {
  if (!isObject(spots)) throw new Error("The blend's places are malformed.");
  const n = times.length;
  for (const [id, spot] of Object.entries(spots)) {
    const ok =
      isObject(spot) &&
      typeof spot.agreement === "string" &&
      spot.agreement.length === n &&
      [spot.wind, spot.gust, spot.from].every(
        (s) => Array.isArray(s) && s.length === n && s.every(numberOrNull),
      );
    if (!ok) throw new Error(`The blend's series for ${id} are malformed.`);
  }
  return spots as Record<string, BlendSeries>;
}

export const staleBlend = (pointer: Pick<BlendPointer, "generatedAt">, now: number) =>
  now - Date.parse(pointer.generatedAt) > BLEND_MAX_AGE_HOURS * 3_600_000;

/** One reader per source, so the loader's cache of immutable squares is kept. */
const readers = new WeakMap<ForecastSource, ReadJson>();
const readerFor = (source: ForecastSource): ReadJson => {
  let read = readers.get(source);
  if (!read) readers.set(source, (read = (path) => source.json(path)));
  return read;
};

/** The pointer alone: cheap, for deciding whether anything changed. Null when none is published. */
export async function readBlendPointer(source: ForecastSource): Promise<BlendPointer | null> {
  const body = await source.json(BLEND_PATH);
  return body === null ? null : parseBlendPointer(body);
}

/** The blend with every place, from every square it lists. */
export async function readBlend(source: ForecastSource, pointer?: BlendPointer): Promise<Blend | null> {
  const head = pointer ?? (await readBlendPointer(source));
  if (!head) return null;
  const data = await loadSpotSquares(readerFor(source), BLEND_PATH, head);
  return { pointer: head, spots: checkSeries(head.times, data[BLEND_KEY]) };
}

/** Whether each axis time is in daylight at a place (src/ratings.ts daylightOn). */
export function daylight(place: Pick<Place, "lat" | "lon">, axis: readonly string[]): boolean[] {
  if (!axis.length) return [];
  const nights = dayNights(place.lat, place.lon, new Date(axis[0]), new Date(axis[axis.length - 1]));
  return axis.map((iso) => {
    const time = Date.parse(iso);
    return !nights.some((night) => time >= night.from.getTime() && time < night.to.getTime());
  });
}

const AGREEMENT: Record<string, Agreement | null> = { h: "high", m: "moderate", l: "low", "-": null };

/** One place's hours on the blend's own times, rated for this rider (src/spotBlend.ts spotBlendHours). */
export function blendHours(blend: Blend, place: Place, rider: Rider): RatedColumn[] | null {
  const spot = blend.spots[place.id];
  if (!spot) return null;
  const light = daylight(place, blend.pointer.times);
  return blend.pointer.times.map((_, i) => {
    const hour = {
      windKn: spot.wind[i] === null ? null : spot.wind[i]! / 10,
      gustKn: spot.gust[i] === null ? null : spot.gust[i]! / 10,
      from: spot.from[i],
      agreement: AGREEMENT[spot.agreement[i]] ?? null,
      daylight: light[i],
    };
    return { ...hour, rating: rateHour(hour, { facing: place.facing }, rider) };
  });
}

/** What moves a rider's ratings: the wing is the weight's and the quiver's, the stars the rating's and the model's. */
export const riderKey = (rider: Rider) =>
  JSON.stringify([
    rider.weightKg,
    [...rider.wings].sort((a, b) => a - b),
    rider.custom ?? null,
    rider.starsFrom ?? null,
  ]);

/** Every live wind model with the spot squares of every place: what a rider rated apart is read from. */
export type ModelWind = Awaited<ReturnType<typeof loadWind>>;

/** The models' own forecasts at every place, for riders whose stars the blend does not carry. */
export const readModelWind = (source: ForecastSource, now: number): Promise<ModelWind> =>
  loadWind(source, now, squaresFor([...PLACES.values()]));

/** Whether a rider's hours come from the blend: their stars come from its models. */
export const fromBlend = (pointer: Pick<BlendPointer, "lead">, rider: Rider) =>
  sameStarsFrom(pointer.lead, starsFromAt(rider.starsFrom));

/** Whether this rider is rated from the models: then the models must be read. */
export const ridesApart = (pointer: Pick<BlendPointer, "lead">, rider: Rider) => !fromBlend(pointer, rider);

/**
 * One place's hours on the blend's own times, rated for this rider from the
 * models their stars come from there (`hourWind`, as the spot page has them).
 * Null where no model is read or none publishes the place.
 */
export function modelHours(wind: ModelWind, place: Place, times: readonly string[], rider: Rider): RatedColumn[] | null {
  const { lines } = spotWindLines(wind.loaded, place.id);
  if (!lines.length) return null;
  const from = starsFromAt(rider.starsFrom);
  const light = daylight(place, times);
  return times.map((iso, i) => {
    const w = hourWind(lines, Date.parse(iso), false, from);
    const hour = {
      windKn: w?.wind_kn ?? null,
      gustKn: w?.gust_kn ?? null,
      from: w ? w.direction_deg : null,
      agreement: w?.agreement ?? null,
      daylight: light[i],
    };
    return { ...hour, rating: rateHour(hour, { facing: place.facing }, rider) };
  });
}

/**
 * A rated-hours lookup per rider, for one blend: many devices share a rider
 * (the default most of all), so each place is rated once per rider per run.
 * A place whose stars, for this rider, come from other models than the
 * blend's is rated from `wind`, the models' own forecasts; without them it is
 * unknown.
 */
export function ratingCache(blend: Blend, wind: ModelWind | null = null) {
  const byRider = new Map<string, Map<string, RatedColumn[] | null>>();
  return (rider: Rider) => {
    const key = riderKey(rider);
    let spots = byRider.get(key);
    if (!spots) byRider.set(key, (spots = new Map()));
    const cache = spots;
    return (spotId: string): RatedColumn[] | null => {
      if (cache.has(spotId)) return cache.get(spotId)!;
      const place = PLACES.get(spotId);
      const hours = !place
        ? null
        : fromBlend(blend.pointer, rider)
          ? blendHours(blend, place, rider)
          : wind
            ? modelHours(wind, place, blend.pointer.times, rider)
            : null;
      cache.set(spotId, hours);
      return hours;
    };
  };
}
