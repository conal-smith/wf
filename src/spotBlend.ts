/**
 * The blend, worked out once for every riding place when the forecast is
 * published, so the map's stars need a few small files rather than every wind
 * model's manifest (two and a half megabytes between them, which a phone took
 * twenty seconds to fetch before a single light could say how good an hour was).
 *
 * The `blend` job (force5/blend/build.ts, run by force5/ingest/fetch_blend.py)
 * reads the published wind manifests, puts every model on the times the dock
 * can show, and keeps each place's hours as `placeConsensus` computes them for
 * the default choice of model (force5/src/lead.ts, named in the pointer as
 * `lead`): HARMONIE's own wind, gust and bearing while it reaches the hour,
 * ECMWF's past it, which of the two each hour is (`lead` in each place), and how
 * far all the models agree, as context. It does not keep stars: those are the
 * reader's own (weight, level, wings), and rating an hour is arithmetic the
 * browser does in microseconds.
 *
 * It is published as a run, the way the models are (docs/TILING_DESIGN.md,
 * decision 6): the pointer `weather/blend.json` holds the times, the models it
 * read and the list of its 2° spot squares, and each place's consensus sits
 * under `spotBlend` in the square of the run directory it falls in. The map
 * reads only the squares in view, and the dock only its spot's
 * (`loadBlendSquares`, through the one spot loader, force5/src/spotData.ts).
 *
 * Only the default is published: the hours HARMONIE then ECMWF rate, the
 * agreement across every wind model. A rider who picked another model gets the
 * hours worked out in the browser from that model's and ECMWF's own spot
 * squares (src/useRatings.ts). A rider who makes a blend of their own still
 * reads this one: the stars never come from the blend, so the lights are the
 * same for any blend, and the blend's own chart reads the chosen models' squares
 * for the open spot alone, only while it is shown (src/ForecastDock.tsx).
 *
 * Each blend keeps today's earlier hours from the one it replaces, from Irish
 * midnight and never before it (`carryToday`, the ruling of 25 October 2026),
 * so the dock and the spot finder show the whole of today and not only the
 * newest HARMONIE run's hours.
 *
 * Compatible both ways with the site before the ruling of 19 October 2026: the
 * schema stays 2 and the new keys (`lead` in the pointer and in each place) are
 * ones an older reader ignores, so the deployed site rates the new file as it
 * rated the old. A file without `lead` was built by the old rule (HARMONIE,
 * then a median of the others), so this site never rates from it
 * (`trustedSpotBlend`) and works the hours out from the models until the job
 * has run again.
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
import {
  irishMidnight,
  modelTimes,
  type ColumnModel,
} from "../force5/src/timeline";
import { KNOTS } from "../force5/src/units";
import type { Manifest } from "../force5/src/weather";
import { modelWeight } from "../force5/src/weights";
import {
  DEFAULT_STARS_FROM,
  leadOrder,
  sameStarsFrom,
  type StarsFrom,
} from "../force5/src/lead";
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
 * The published blend the map may rate from, or null for the browser to work
 * the hours out itself from the models: when there is none, once it is older
 * than six hours, or when the rider's stars come from another model than the
 * one it was built with (`from`; a blend that names none was built by the rule
 * before 19 October 2026 and fits nobody). The rider's own choice of models
 * for the blend does not count: it moves no star.
 */
export const trustedSpotBlend = <
  B extends Pick<SpotBlend, "generatedAt"> & { lead?: StarsFrom },
>(
  blend: B | null,
  now = Date.now(),
  from: StarsFrom = DEFAULT_STARS_FROM,
): B | null =>
  !blend || staleSpotBlend(blend, now) || !sameStarsFrom(blend.lead, from)
    ? null
    : blend;

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
  /**
   * The times it publishes, and today's earlier hours kept from its earlier
   * runs (`carryToday`), as indices into `times`. Empty for an ensemble.
   */
  columns: number[];
}

/** One place's hours on `times`. Knots in tenths; bearings in degrees. */
export interface BlendSpot {
  /** The one model's wind, gust and bearing each hour is rated from. */
  wind: (number | null)[];
  gust: (number | null)[];
  from: (number | null)[];
  /** One letter a time: h(igh), m(oderate), l(ow), or - for no models. */
  agreement: string;
  /**
   * Which model each time is, one character a time: its place in `sources`
   * in base 36, or - for none. Absent from a blend built before 19 October
   * 2026, which is never rated from.
   */
  lead?: string;
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
   * Every time any deterministic model publishes, and today's earlier hours
   * kept from the blend before (`carryToday`), sorted: the only times the
   * dock can make a column of (`dockColumns`).
   */
  times: string[];
  sources: BlendSource[];
  /**
   * The models every place's hours are, in order (force5/src/lead.ts): the
   * default, HARMONIE then ECMWF. Absent from a blend built before 19 October
   * 2026, by the rule of the time.
   */
  lead?: StarsFrom;
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
  from: StarsFrom = DEFAULT_STARS_FROM,
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
  const code = new Map(ids.map((model, i) => [model, i.toString(36)]));
  const spots: BlendSpots = {};
  for (const id of places) {
    const c = placeConsensus(manifests, ids, id, times, from);
    spots[id] = {
      wind: c.median.map(tenths),
      gust: c.gust.map(tenths),
      from: c.from.map((from) => (from === null ? null : Math.round(from))),
      agreement: c.agreement
        .map((a) => (a === null ? "-" : AGREEMENT_CODE[a]))
        .join(""),
      lead: c.model.map((m) => (m === null ? "-" : code.get(m)!)).join(""),
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
    lead: { model: from.model, then: from.then },
    [BLEND_KEY]: spots,
  };
}

/** What `carryToday` kept: the blend, and the times it carried forward. */
export interface CarriedBlend {
  blend: BlendRun;
  /** The times some place's hour was carried forward to, sorted. */
  carried: string[];
}

/**
 * Today's earlier hours, kept when a new run replaces the one that had them
 * (the ruling of 25 October 2026): "keep the forecast for the full day so we
 * don't just immediately discard it, but we do discard yesterday's forecast".
 *
 * A HARMONIE run covers nothing before it was initialised, and the run it
 * replaces is deleted an hour later, so a blend worked out at 21:00 from the
 * 17 UTC run had nothing from HARMONIE for the morning and afternoon, and the
 * dock and the spot finder showed today from 17:00. So each hourly blend reads
 * the one published before it (`previous`) and keeps, for every place, each
 * of today's hours that one rated from a model higher in the stars' order
 * (`lead`: HARMONIE, then ECMWF) than this one can: the hours before the new
 * lead run begins, where this blend has only ECMWF's steps or nothing. The
 * previous blend had carried its own morning forward the same way, so the day
 * fills hourly from Irish midnight with the most recent run that covered each
 * hour: wind, gust, bearing, the agreement as it was then, and which model it
 * was.
 *
 * Only today: an hour before Irish midnight (`irishMidnight` of `now`) is
 * never carried, so yesterday's forecast goes with the first blend of the day.
 * (The times before midnight a run still publishes of itself — ECMWF's run of
 * yesterday noon begins at yesterday noon — are its own, as before, and the
 * dock's strip, beginning at today, never shows them.)
 * Only the hours before the new lead run's first time: from there on the new
 * run is the newer word. Nothing is carried when the previous blend was built
 * for another order of models, when this blend has no run of the lead model
 * to say where carrying stops, or for a model this blend no longer reads.
 * A carried hour is added to the columns of the model it came from, so the
 * dock's near run reaches back to midnight (`dockColumns`); its `run` still
 * names the newest run, the one the hours from now on are.
 */
export function carryToday(
  blend: BlendRun,
  previous: Pick<BlendRun, "times" | "sources" | "spotBlend" | "lead"> | null,
  now = Date.parse(blend.generatedAt),
): CarriedBlend {
  const from = irishMidnight(now);
  const code = new Map(blend.sources.map((source, i) => [source.id, i]));
  const here = new Map(blend.times.map((time, i) => [Date.parse(time), i]));
  // Each place's carried hours, by the previous blend's index of the time.
  const keep = new Map<string, { from: number; model: string }[]>();
  // The times carried, each spelled as the previous blend spelled it.
  const times = new Map<number, string>();
  const order = blend.lead ? leadOrder(blend.lead) : [];
  const leadSource = blend.sources.find((source) => source.id === order[0]);
  if (
    previous &&
    sameStarsFrom(previous.lead, blend.lead) &&
    leadSource?.columns.length
  ) {
    const until = Math.min(
      ...leadSource.columns.map((c) => Date.parse(blend.times[c])),
    );
    const rank = (model: string | null) => {
      if (!model) return Infinity;
      const at = order.indexOf(model);
      return at < 0 ? order.length : at;
    };
    const modelOf = (
      sources: readonly Pick<BlendSource, "id">[],
      letter: string | undefined,
    ) =>
      !letter || letter === "-"
        ? null
        : (sources[parseInt(letter, 36)]?.id ?? null);
    previous.times.forEach((time, i) => {
      const t = Date.parse(time);
      if (!(t >= from && t < until)) return;
      for (const [id, spot] of Object.entries(blend.spotBlend)) {
        const old = previous.spotBlend[id];
        const model = modelOf(previous.sources, old?.lead?.[i]);
        if (!old || model === null || !code.has(model)) continue;
        const at = here.get(t);
        const fresh =
          at === undefined ? null : modelOf(blend.sources, spot.lead?.[at]);
        if (rank(model) >= rank(fresh)) continue;
        if (!keep.has(id)) keep.set(id, []);
        keep.get(id)!.push({ from: i, model });
        times.set(t, time);
      }
    });
  }
  if (!times.size) return { blend, carried: [] };
  const spelled = new Map([
    ...times,
    ...blend.times.map((time) => [Date.parse(time), time] as const),
  ]);
  const all = [...spelled.keys()].sort((a, b) => a - b);
  const to = new Map(all.map((t, i) => [t, i]));
  // Each of the blend's own times in the longer list.
  const moved = blend.times.map((time) => to.get(Date.parse(time))!);
  const spread = <T>(values: readonly T[], empty: T): T[] => {
    const out = new Array<T>(all.length).fill(empty);
    values.forEach((value, i) => (out[moved[i]] = value));
    return out;
  };
  const columns = blend.sources.map(
    (source) => new Set(source.columns.map((c) => moved[c])),
  );
  const spots: BlendSpots = {};
  for (const [id, spot] of Object.entries(blend.spotBlend)) {
    const wind = spread(spot.wind, null);
    const gust = spread(spot.gust, null);
    const bearing = spread(spot.from, null);
    const agreement = spread([...spot.agreement], "-");
    const lead = spread(
      [...(spot.lead ?? "-".repeat(blend.times.length))],
      "-",
    );
    const old = previous?.spotBlend[id];
    for (const { from: i, model } of keep.get(id) ?? []) {
      const at = to.get(Date.parse(previous!.times[i]))!;
      wind[at] = old!.wind[i];
      gust[at] = old!.gust[i];
      bearing[at] = old!.from[i];
      agreement[at] = old!.agreement[i];
      lead[at] = code.get(model)!.toString(36);
      columns[code.get(model)!].add(at);
    }
    spots[id] = {
      wind,
      gust,
      from: bearing,
      agreement: agreement.join(""),
      lead: lead.join(""),
    };
  }
  const iso = all.map((t) => spelled.get(t)!);
  return {
    blend: {
      ...blend,
      times: iso,
      coverage: { from: iso[0], to: iso[iso.length - 1] },
      sources: blend.sources.map((source, i) => ({
        ...source,
        columns: [...columns[i]].sort((a, b) => a - b),
      })),
      [BLEND_KEY]: spots,
    },
    carried: [...times.keys()].sort((a, b) => a - b).map((t) => times.get(t)!),
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
  if (
    "lead" in body &&
    (!isObject(body.lead) ||
      typeof body.lead.model !== "string" ||
      typeof body.lead.then !== "string")
  )
    throw new Error("The blend's lead is malformed.");
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
      (spot.lead === undefined ||
        (typeof spot.lead === "string" && spot.lead.length === n)) &&
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
  blend: Pick<BlendRun, "times" | "spotBlend" | "sources">,
  place: RatedPlace,
  axis: readonly string[],
  rider: Rider,
): PlaceHour[] | null {
  const spot = blend.spotBlend[place.id];
  if (!spot) return null;
  const columns = columnsOf(blend.times, axis);
  const light = daylightOn(place, axis);
  const modelAt = (i: number) => {
    const at = i < 0 ? "-" : (spot.lead?.[i] ?? "-");
    return at === "-" ? null : (blend.sources[parseInt(at, 36)]?.id ?? null);
  };
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
      model: modelAt(i),
      rating: rateHour(hour, { facing: place.facing }, rider),
    };
  });
}
