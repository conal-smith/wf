/**
 * The blend, worked out once for every riding place when the forecast is
 * published, so the map's stars need one small file rather than every wind
 * model's manifest (two and a half megabytes between them, which a phone took
 * twenty seconds to fetch before a single light could say how good an hour was).
 *
 * The `blend` job (force5/blend/build.ts, run by force5/ingest/fetch_blend.py)
 * reads the published wind manifests, puts every model on the times the dock
 * can show, and keeps each place's consensus as `placeConsensus` computes it:
 * the weighted median wind and gust, how far the models agree, and the mean
 * bearing. It does not keep stars: those are the reader's own (weight, level,
 * wings), and rating an hour is arithmetic the browser does in microseconds.
 *
 * Only the default blend, every wind model, is published. A reader who picks
 * their own models gets the old path: the manifests, and the blend worked out
 * in the browser (src/useRatings.ts).
 */
import type { Agreement } from "../force5/src/blend";
import { rateHour, type Rider } from "../force5/src/stars";
import { modelTimes, type ColumnModel } from "../force5/src/timeline";
import { KNOTS } from "../force5/src/units";
import type { Manifest } from "../force5/src/weather";
import { blendWeight } from "../force5/src/weights";
import {
  daylightOn,
  placeConsensus,
  type PlaceHour,
  type RatedPlace,
} from "./ratings";

/** Where the blend is published, beside the models' own pointers. */
export const SPOT_BLEND_PATH = "weather/blend.json";
export const SPOT_BLEND_SCHEMA = 1;
/**
 * How old a blend may be before the map stops trusting it. The job runs hourly;
 * one that has stopped would otherwise leave the lights on runs the map itself
 * has long moved past, so past this the browser works the blend out again.
 */
export const SPOT_BLEND_MAX_AGE_HOURS = 6;

/** Whether the blend was worked out too long ago to rate from. */
export const staleSpotBlend = (blend: SpotBlend, now = Date.now()) =>
  now - Date.parse(blend.generatedAt) > SPOT_BLEND_MAX_AGE_HOURS * 3600000;

/** One model the blend read: enough of its run for the dock's columns. */
export interface BlendSource {
  id: string;
  name: string;
  run: string;
  runTime: string;
  resolutionKm: number | null;
  ensemble: boolean;
  /** What its line counted for in the consensus (`blendWeight`). */
  weight: number;
  /** The times it publishes, as indices into `times`. Empty for an ensemble. */
  columns: number[];
}

/** One place's consensus on `times`. Knots in tenths; bearings in degrees. */
export interface BlendSpot {
  wind: (number | null)[];
  gust: (number | null)[];
  from: (number | null)[];
  /** One letter a time: h(igh), m(oderate), l(ow), or - for no models. */
  agreement: string;
}

export interface SpotBlend {
  schemaVersion: typeof SPOT_BLEND_SCHEMA;
  kind: "blend";
  model: "blend";
  /** The hour it was worked out, YYYYMMDDHH, as the publisher names a run. */
  run: string;
  runTime: string;
  generatedAt: string;
  coverage: { from: string; to: string };
  /**
   * Every time any deterministic model publishes, sorted: the only times the
   * dock can make a column of (`dockColumns`).
   */
  times: string[];
  sources: BlendSource[];
  spots: Record<string, BlendSpot>;
}

const AGREEMENT_CODE: Record<Agreement, string> = {
  high: "h",
  moderate: "m",
  low: "l",
};
const AGREEMENT_OF: Record<string, Agreement | null> = {
  h: "high",
  m: "moderate",
  l: "low",
  "-": null,
};

const tenths = (mps: number | null) =>
  mps === null ? null : Math.round(mps * KNOTS * 10);
const pad = (n: number) => String(n).padStart(2, "0");
/** The publisher's run id for the hour `at` falls in. */
const runId = (at: Date) =>
  `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}${pad(at.getUTCHours())}`;

const isEnsemble = (manifest: Manifest) =>
  !!manifest.ensemble || !!manifest.spotMembers;

/**
 * The blend of `manifests` for every place any of them publishes. `now` names
 * the run: the hour it was worked out, so each hourly job is a new run.
 */
export function buildSpotBlend(
  manifests: readonly Manifest[],
  now = new Date(),
): SpotBlend {
  const runTimes = new Map(
    manifests.map((manifest) => [
      manifest.model,
      isEnsemble(manifest) ? [] : modelTimes(manifest),
    ]),
  );
  const times = [...new Set([...runTimes.values()].flat())].sort(
    (a, b) => Date.parse(a) - Date.parse(b),
  );
  const index = new Map(times.map((time, i) => [time, i]));
  const ids = manifests.map((manifest) => manifest.model);
  const places = [
    ...new Set(
      manifests.flatMap((manifest) => Object.keys(manifest.spotForecasts)),
    ),
  ].sort();
  const spots: Record<string, BlendSpot> = {};
  for (const id of places) {
    const c = placeConsensus(manifests, ids, id, times);
    spots[id] = {
      wind: c.median.map(tenths),
      gust: c.gust.map(tenths),
      from: c.from.map((from) => (from === null ? null : Math.round(from))),
      agreement: c.agreement
        .map((a) => (a === null ? "-" : AGREEMENT_CODE[a]))
        .join(""),
    };
  }
  const hour = new Date(Math.floor(now.getTime() / 3600000) * 3600000);
  return {
    schemaVersion: SPOT_BLEND_SCHEMA,
    kind: "blend",
    model: "blend",
    run: runId(hour),
    runTime: hour.toISOString().replace(".000Z", "Z"),
    generatedAt: now.toISOString(),
    coverage: { from: times[0] ?? "", to: times[times.length - 1] ?? "" },
    times,
    sources: manifests.map((manifest) => ({
      id: manifest.model,
      name: manifest.modelName,
      run: manifest.run,
      runTime: manifest.runTime,
      resolutionKm: manifest.resolutionKm ?? null,
      ensemble: isEnsemble(manifest),
      weight: blendWeight(manifest.resolutionKm),
      columns: runTimes.get(manifest.model)!.map((time) => index.get(time)!),
    })),
    spots,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const numberOrNull = (value: unknown) =>
  value === null || (typeof value === "number" && Number.isFinite(value));

/** The published file, checked; throws with a sentence when it is not one. */
export function parseSpotBlend(body: unknown): SpotBlend {
  if (!isObject(body) || body.kind !== "blend" || body.model !== "blend")
    throw new Error("Not a blend file.");
  if (body.schemaVersion !== SPOT_BLEND_SCHEMA)
    throw new Error(`Unknown blend schema ${String(body.schemaVersion)}.`);
  const times = body.times;
  if (
    !Array.isArray(times) ||
    !times.every((t) => typeof t === "string" && Number.isFinite(Date.parse(t)))
  )
    throw new Error("The blend's times are not a list of times.");
  if (!Array.isArray(body.sources) || !isObject(body.spots))
    throw new Error("The blend has no sources or no places.");
  for (const source of body.sources)
    if (
      !isObject(source) ||
      typeof source.id !== "string" ||
      typeof source.runTime !== "string" ||
      !Array.isArray(source.columns) ||
      !source.columns.every(
        (c) => Number.isInteger(c) && c >= 0 && c < times.length,
      )
    )
      throw new Error("A blend source is malformed.");
  for (const [id, spot] of Object.entries(body.spots)) {
    const ok =
      isObject(spot) &&
      typeof spot.agreement === "string" &&
      spot.agreement.length === times.length &&
      [spot.wind, spot.gust, spot.from].every(
        (series) =>
          Array.isArray(series) &&
          series.length === times.length &&
          series.every(numberOrNull),
      );
    if (!ok) throw new Error(`The blend's series for ${id} are malformed.`);
  }
  return body as unknown as SpotBlend;
}

/** The runs the blend read, as the dock's column builder takes them. */
export function blendColumnModels(blend: SpotBlend): ColumnModel[] {
  return blend.sources.map((source) => ({
    id: source.id,
    ensemble: source.ensemble,
    manifest: {
      runTime: source.runTime,
      resolutionKm: source.resolutionKm,
      frames: source.columns.map((c) => ({ validTime: blend.times[c] })),
    },
  }));
}

const positions = new WeakMap<SpotBlend, Map<number, number>>();

/** Where each axis time sits in the blend's times, or -1 where it has none. */
function columnsOf(blend: SpotBlend, axis: readonly string[]): number[] {
  let at = positions.get(blend);
  if (!at) {
    at = new Map(blend.times.map((time, i) => [Date.parse(time), i]));
    positions.set(blend, at);
  }
  return axis.map((time) => at!.get(Date.parse(time)) ?? -1);
}

/**
 * One place's columns from the published blend, rated for this rider: what
 * `placeHours` gives from the manifests, without them. A place the blend does
 * not know gets no row, and so reads as pending, as before it was rated.
 */
export function spotBlendHours(
  blend: SpotBlend,
  place: RatedPlace,
  axis: readonly string[],
  rider: Rider,
): PlaceHour[] | null {
  const spot = blend.spots[place.id];
  if (!spot) return null;
  const columns = columnsOf(blend, axis);
  const light = daylightOn(place, axis);
  return columns.map((i, at) => {
    const wind = i < 0 ? null : spot.wind[i];
    const gust = i < 0 ? null : spot.gust[i];
    const hour = {
      windKn: wind === null ? null : wind / 10,
      gustKn: gust === null ? null : gust / 10,
      from: i < 0 ? null : spot.from[i],
      agreement: i < 0 ? null : (AGREEMENT_OF[spot.agreement[i]] ?? null),
      daylight: light[at],
    };
    return {
      ...hour,
      rating: rateHour(hour, { facing: place.facing }, rider),
    };
  });
}
