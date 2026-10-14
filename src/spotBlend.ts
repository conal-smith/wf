/**
 * The blend, worked out once for every riding place when the forecast is
 * published, so the map's stars need a few small files rather than every wind
 * model's manifest (two and a half megabytes between them, which a phone took
 * twenty seconds to fetch before a single light could say how good an hour was).
 *
 * The `blend` job (force5/blend/build.ts, run by force5/ingest/fetch_blend.py)
 * reads the published wind manifests, puts every model on the times the dock
 * can show, and keeps each place's consensus as `placeConsensus` computes it:
 * the wind, gust and bearing (HARMONIE's own while it reaches the hour, past
 * it the other models' weighted median and mean bearing) and how far the
 * models agree. It does not keep stars: those are the reader's own (weight, level,
 * wings), and rating an hour is arithmetic the browser does in microseconds.
 *
 * It is published as a run, the way the models are (docs/TILING_DESIGN.md,
 * decision 6): the pointer `weather/blend.json` holds the times, the models it
 * read and the list of its 2° spot squares, and each place's consensus sits
 * under `spotBlend` in the square of the run directory it falls in. The map
 * reads only the squares in view, and the dock only its spot's
 * (`loadBlendSquares`, through the one spot loader, force5/src/spotData.ts).
 *
 * Only the default blend, every wind model, is published. A reader who picks
 * their own models gets the old path: the manifests, and the blend worked out
 * in the browser (src/useRatings.ts).
 */
import type { Agreement } from "../force5/src/blend";
import {
  checkBase,
  checkSpotIndex,
  loadSpotSquares,
  mergeSpots,
  SPOT_KEYS,
  type ReadJson,
  type SpotIndex,
} from "../force5/src/spotData";
import { rateHour, type Rider } from "../force5/src/stars";
import { modelTimes, type ColumnModel } from "../force5/src/timeline";
import { KNOTS } from "../force5/src/units";
import type { Manifest } from "../force5/src/weather";
import { modelWeight } from "../force5/src/weights";
import {
  daylightOn,
  placeConsensus,
  type PlaceHour,
  type RatedPlace,
} from "./ratings";

/** Where the blend's pointer is published, beside the models' own pointers. */
export const SPOT_BLEND_PATH = "weather/blend.json";
export const SPOT_BLEND_SCHEMA = 2;
/** The one per-spot key the blend's squares carry. */
export const BLEND_KEY = "spotBlend";
/**
 * How old a blend may be before the map stops trusting it. The job runs hourly;
 * one that has stopped would otherwise leave the lights on runs the map itself
 * has long moved past, so past this the browser works the blend out again.
 */
export const SPOT_BLEND_MAX_AGE_HOURS = 6;

/** Whether the blend was worked out too long ago to rate from. */
export const staleSpotBlend = (
  blend: Pick<SpotBlend, "generatedAt">,
  now = Date.now(),
) => now - Date.parse(blend.generatedAt) > SPOT_BLEND_MAX_AGE_HOURS * 3600000;

/**
 * Whether the reader blends their own set of models: any wind model left out.
 * Only the blend of every wind model is published.
 */
export const ownBlendModels = (
  blendModels: readonly string[],
  windModelIds: readonly string[],
) => !windModelIds.every((id) => blendModels.includes(id));

/**
 * The published blend the map may rate from, or null for the browser to work
 * the blend out itself from the models: when there is none, when the reader
 * blends their own models, or once it is older than six hours.
 */
export const trustedSpotBlend = <B extends Pick<SpotBlend, "generatedAt">>(
  blend: B | null,
  ownModels: boolean,
  now = Date.now(),
): B | null =>
  ownModels || !blend || staleSpotBlend(blend, now) ? null : blend;

/** One model the blend read: enough of its run for the dock's columns. */
export interface BlendSource {
  id: string;
  name: string;
  run: string;
  runTime: string;
  resolutionKm: number | null;
  ensemble: boolean;
  /** What its line counts for on day 0 of its run (`modelWeight`); less or more later. */
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

/** Every place's consensus, by place id. */
export type BlendSpots = Record<string, BlendSpot>;

/** What every form of the blend carries: the run, its times and its models. */
interface BlendHead {
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
}

/** The blend as the job works it out, every place in hand, before it is cut into squares. */
export interface BlendRun extends BlendHead {
  spotBlend: BlendSpots;
}

/** The published pointer: no places, the squares they are in. */
export interface SpotBlend extends BlendHead {
  /** The run directory beside the pointer (`blend-<run>-<hours>h-v2-<hash8>/`). */
  base: string;
  spots: SpotIndex;
}

/** The pointer with the places of the squares read so far. */
export interface LoadedBlend extends SpotBlend {
  spotBlend: BlendSpots;
  /** The squares whose places are in `spotBlend`: a place outside them is unknown, not calm. */
  loaded: readonly string[];
  /** Squares asked for that could not be read or did not hold together. */
  failed: readonly string[];
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
 * The blend of `manifests` for every place any of them publishes. Each must
 * have every one of its spot squares merged in (`loadSpotSquares`): a place in
 * a square that was not read is a place this blend leaves out. `now` names the
 * run: the hour it was worked out, so each hourly job is a new run.
 */
export function buildSpotBlend(
  manifests: readonly Manifest[],
  now = new Date(),
): BlendRun {
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
      manifests.flatMap((manifest) =>
        Object.keys(manifest.spotForecasts ?? {}),
      ),
    ),
  ].sort();
  const spots: BlendSpots = {};
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
      weight: modelWeight(manifest.model, 0, manifest.resolutionKm),
      columns: runTimes.get(manifest.model)!.map((time) => index.get(time)!),
    })),
    [BLEND_KEY]: spots,
  };
}

/**
 * The run directory's name before its hash, as the publisher names a run:
 * `blend-<run>-<hours>h-v2`, the hours from the hour it was worked out to its
 * last time.
 */
export function blendPrefix(blend: Pick<BlendHead, "run" | "runTime" | "coverage">): string {
  const reach = Math.max(
    0,
    Math.ceil(
      (Date.parse(blend.coverage.to) - Date.parse(blend.runTime)) / 3600000,
    ) || 0,
  );
  return `blend-${blend.run}-${reach}h-v${SPOT_BLEND_SCHEMA}`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const numberOrNull = (value: unknown) =>
  value === null || (typeof value === "number" && Number.isFinite(value));

/** The published pointer, checked; throws with a sentence when it is not one. */
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
  if (!Array.isArray(body.sources))
    throw new Error("The blend names no models.");
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
  checkBase(body.base);
  const index = checkSpotIndex(body.spots);
  if (index.keys.length !== 1 || index.keys[0] !== BLEND_KEY)
    throw new Error(`The blend's squares must carry ${BLEND_KEY} alone.`);
  const inline = SPOT_KEYS.filter((key) => key in body);
  if (inline.length)
    throw new Error("The blend's places belong in its squares, not its pointer.");
  return body as unknown as SpotBlend;
}

/** One square's places, checked against the blend's times; throws naming the place. */
export function checkBlendSpots(
  blend: Pick<BlendHead, "times">,
  spots: unknown,
): BlendSpots {
  if (!isObject(spots)) throw new Error("The blend's places are malformed.");
  const n = blend.times.length;
  for (const [id, spot] of Object.entries(spots)) {
    const ok =
      isObject(spot) &&
      typeof spot.agreement === "string" &&
      spot.agreement.length === n &&
      [spot.wind, spot.gust, spot.from].every(
        (series) =>
          Array.isArray(series) &&
          series.length === n &&
          series.every(numberOrNull),
      );
    if (!ok) throw new Error(`The blend's series for ${id} are malformed.`);
  }
  return spots as BlendSpots;
}

/**
 * The pointer with the places of `squares` merged in, read through the one
 * spot loader (so a square is fetched once, and kept: its path is immutable).
 * A square the blend does not list holds no places and is not asked for. Each
 * square stands alone: one that cannot be read, or does not hold together,
 * is named in `failed` and its places stay unknown, while the others are used.
 * A place in two squares is a run that does not hold together as a whole, as
 * `loadSpotSquares` has it, and rejects. The places have no prototype, so a
 * place called `__proto__` is a place like any other.
 */
export async function loadBlendSquares(
  read: ReadJson,
  blend: SpotBlend,
  squares: readonly string[],
): Promise<LoadedBlend> {
  const listed = new Set(blend.spots.squares);
  const wanted = [...new Set(squares)].filter((s) => listed.has(s)).sort();
  const results = await Promise.allSettled(
    wanted.map(async (square) => {
      const data = await loadSpotSquares(read, SPOT_BLEND_PATH, blend, [
        square,
      ]);
      return checkBlendSpots(blend, data.spotBlend);
    }),
  );
  const spotBlend: BlendSpots = Object.create(null);
  const loaded: string[] = [];
  const failed: string[] = [];
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      failed.push(wanted[i]);
      return;
    }
    loaded.push(wanted[i]);
    mergeSpots(spotBlend, result.value, BLEND_KEY);
  });
  return { ...blend, spotBlend, loaded, failed };
}

/** The runs the blend read, as the dock's column builder takes them. */
export function blendColumnModels(
  blend: Pick<BlendHead, "sources" | "times">,
): ColumnModel[] {
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

const positions = new WeakMap<readonly string[], Map<number, number>>();

/** Where each axis time sits in the blend's times, or -1 where it has none. */
function columnsOf(times: readonly string[], axis: readonly string[]): number[] {
  let at = positions.get(times);
  if (!at) {
    at = new Map(times.map((time, i) => [Date.parse(time), i]));
    positions.set(times, at);
  }
  return axis.map((time) => at!.get(Date.parse(time)) ?? -1);
}

/**
 * One place's columns from the published blend, rated for this rider: what
 * `placeHours` gives from the manifests, without them. A place the blend does
 * not know — or whose square has not been read — gets no row, and so reads as
 * pending, as before it was rated.
 */
export function spotBlendHours(
  blend: Pick<BlendRun, "times" | "spotBlend">,
  place: RatedPlace,
  axis: readonly string[],
  rider: Rider,
): PlaceHour[] | null {
  const spot = blend.spotBlend[place.id];
  if (!spot) return null;
  const columns = columnsOf(blend.times, axis);
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
