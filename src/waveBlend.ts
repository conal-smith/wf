/**
 * The wave blend: every riding place's sea state from every wave model the
 * site publishes, worked out once an hour, the wave counterpart of the wind
 * blend (src/spotBlend.ts).
 *
 * The `wave-blend` job (force5/blend/waves.ts, run by
 * force5/ingest/fetch_wave_blend.py) reads the published wave runs of the
 * models in `WAVE_BLEND_MODELS`, puts each on the times any of them publishes,
 * and keeps, for each place and time:
 *
 * - what every model has, blended: the significant wave height's median and its
 *   range across the models (`height`, `low`, `high`), the median peak period
 *   (`period`), and the direction the waves come from as a vector mean of the
 *   models' directions, each weighted by its own height (`from`), so 350° and
 *   10° make 0°, never 180°;
 * - what the models split differently, unblended: the wind sea and swell
 *   partitions of the one model that leads the hour (`parts`), the first of
 *   the blend's models, in the dock's handover order, that has it, and which
 *   model that is (`lead`). A partition is never averaged: one model's
 *   primary swell is not another's;
 * - which models fed the hour (`fed`, one bit per source) and how many
 *   (`count`), so a reader sees members drop out as the short runs end.
 *
 * A model reads a time from its nearest native step within `WAVE_MATCH_HOURS`,
 * as the dock reads it; nothing is interpolated (force5/src/waves.ts).
 *
 * It is published as a run, the way the wind blend is (docs/TILING_DESIGN.md,
 * decision 6): the pointer `weather/wave-blend.json` holds the times and the
 * models it read, and each place sits under `spotWaveBlend` in the 2° square of
 * the run directory it falls in, read through the one spot loader
 * (force5/src/spotData.ts).
 */
import { waveModels } from "../force5/src/catalog";
import {
  checkBase,
  checkSpotIndex,
  loadSpotSquares,
  mergeSpots,
  SPOT_KEYS,
  type ReadJson,
  type SpotIndex,
} from "../force5/src/spotData";
import { pickVariable } from "../force5/src/variables";
import {
  WAVE_MATCH_HOURS,
  WAVE_SOURCE_PREFERENCE,
  waveAtAxis,
  waveSeries,
  type WaveManifest,
  type WaveStep,
} from "../force5/src/waves";

/** Where the wave blend's pointer is published, beside the wind blend's. */
export const WAVE_BLEND_PATH = "weather/wave-blend.json";
export const WAVE_BLEND_SCHEMA = 2;
/** The one per-spot key the wave blend's squares carry. */
export const WAVE_BLEND_KEY = "spotWaveBlend";
/**
 * The wave models the blend reads, in the order their partitions lead: the
 * dock's own handover order (`WAVE_SOURCE_PREFERENCE`, finest first), so one
 * line there adds a model to the blend and to the handover alike. A model the
 * catalogue calls retired or planned is left out until it is published again.
 */
export const WAVE_BLEND_MODELS: readonly string[] = WAVE_SOURCE_PREFERENCE;
/** How old the wave blend may be before a reader stops trusting it (it runs hourly). */
export const WAVE_BLEND_MAX_AGE_HOURS = 6;

/** The variable every member blends: the whole sea's significant height. */
export const HEIGHT_VARIABLE = "swh";
/** The peak period. A model that publishes only a mean period does not vote on it. */
export const PERIOD_VARIABLE = "pp1d";
/** The direction the whole sea comes from, the mean where a model has one. */
export const DIRECTION_VARIABLES = ["mwd", "pwd"] as const;
/**
 * Where the models' resultant direction is shorter than this, as a fraction of
 * their summed weights, they point too many ways to have a mean: two models
 * 170° apart, say. The blend then gives no direction for the hour.
 */
export const MIN_DIRECTION_RESULTANT = 0.1;

/**
 * The partitions the lead model's step is read for, by the variables each
 * model names them with. `swell` is a model's whole swell as one height
 * (Irish Shelf SWAN's `hswe`), not a partition of it; `swell1` to `swell3` are
 * the swell partitions in the models' own order, most energetic first. The
 * wind sea's period is GFS-Wave's mean (`mpww`) or the Met Office's peak
 * (`ppww`), as `waveFields` in force5/src/waves.ts reads it.
 */
export const WAVE_PARTITIONS = {
  windsea: { height: ["shww"], period: ["mpww", "ppww"], direction: ["mdww"] },
  swell: { height: ["hswe"], period: [], direction: [] },
  swell1: {
    height: ["swell1_h"],
    period: ["swell1_p"],
    direction: ["swell1_d"],
  },
  swell2: {
    height: ["swell2_h"],
    period: ["swell2_p"],
    direction: ["swell2_d"],
  },
  swell3: {
    height: ["swell3_h"],
    period: ["swell3_p"],
    direction: ["swell3_d"],
  },
} as const satisfies Record<
  string,
  {
    height: readonly string[];
    period: readonly string[];
    direction: readonly string[];
  }
>;
export type PartitionKey = keyof typeof WAVE_PARTITIONS;
export const PARTITION_KEYS = Object.keys(WAVE_PARTITIONS) as PartitionKey[];

/** One model the wave blend read. */
export interface WaveBlendSource {
  id: string;
  name: string;
  run: string;
  runTime: string;
  resolutionKm: number | null;
  /** The times it publishes a step at, as indices into `times`. */
  columns: number[];
  /** The variables it was read for: its height, period and direction. */
  variables: {
    height: string;
    period: string | null;
    direction: string | null;
  };
  /** The partitions it publishes, which `parts` carries wherever it leads. */
  partitions: PartitionKey[];
}

/** One partition's series: heights in centimetres, periods in tenths of a second. */
export interface WaveBlendPart {
  height: (number | null)[];
  period: (number | null)[];
  from: (number | null)[];
}

/**
 * One place's sea state on `times`. Heights are whole centimetres, periods
 * tenths of a second and directions whole degrees the waves come from.
 */
export interface WaveBlendSpot {
  /** The median of the models' significant heights. */
  height: (number | null)[];
  /** The lowest and highest of them: the models' range. */
  low: (number | null)[];
  high: (number | null)[];
  /** The median of the models' peak periods. */
  period: (number | null)[];
  /** The models' directions, a vector mean weighted by each one's height. */
  from: (number | null)[];
  /** Which models fed each time: bit i set for `sources[i]`. */
  fed: number[];
  /** How many models fed each time, one base-36 digit a time. */
  count: string;
  /** Which model's partitions each time carries: its place in `sources` in base 36, or - for none. */
  lead: string;
  /** The lead model's partitions; a partition no source publishes is absent. */
  parts: Partial<Record<PartitionKey, WaveBlendPart>>;
}

export type WaveBlendSpots = Record<string, WaveBlendSpot>;

interface WaveBlendHead {
  schemaVersion: typeof WAVE_BLEND_SCHEMA;
  kind: "wave-blend";
  model: "wave-blend";
  /** The hour it was worked out, YYYYMMDDHH, as the publisher names a run. */
  run: string;
  runTime: string;
  generatedAt: string;
  coverage: { from: string; to: string };
  /** Every time any of its models publishes a step at, sorted. */
  times: string[];
  /** The models it read, in the order their partitions lead. */
  sources: WaveBlendSource[];
}

/** The wave blend as the job works it out, every place in hand. */
export interface WaveBlendRun extends WaveBlendHead {
  spotWaveBlend: WaveBlendSpots;
}

/** The published pointer: no places, the squares they are in. */
export interface WaveBlend extends WaveBlendHead {
  base: string;
  spots: SpotIndex;
}

/** The pointer with the places of the squares read so far. */
export interface LoadedWaveBlend extends WaveBlend {
  spotWaveBlend: WaveBlendSpots;
  loaded: readonly string[];
  failed: readonly string[];
}

/** The blend's members among `ids`, in the order they lead; anything else is left out. */
export function waveBlendMembers(
  ids: readonly string[],
  models: readonly string[] = WAVE_BLEND_MODELS,
  live: readonly string[] = waveModels().map((entry) => entry.id),
): string[] {
  return models.filter((id) => ids.includes(id) && live.includes(id));
}

/** The middle value, or the mean of the two middle ones. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The mean of bearings (degrees, the way waves come from) as vectors, each
 * weighted: 350° and 10° make 0°. Null with none, or where they cancel out
 * (`MIN_DIRECTION_RESULTANT`). Weights that are all zero count equally.
 */
export function meanDirection(
  bearings: readonly { from: number; weight: number }[],
): number | null {
  if (!bearings.length) return null;
  const total = bearings.reduce((sum, b) => sum + Math.max(0, b.weight), 0);
  const weight = (b: { weight: number }) =>
    total > 0 ? Math.max(0, b.weight) : 1;
  let x = 0;
  let y = 0;
  for (const b of bearings) {
    const radians = (b.from * Math.PI) / 180;
    x += weight(b) * Math.sin(radians);
    y += weight(b) * Math.cos(radians);
  }
  const sum = total > 0 ? total : bearings.length;
  if (Math.hypot(x, y) / sum < MIN_DIRECTION_RESULTANT) return null;
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);
const centimetres = (m: number | null) =>
  m === null ? null : Math.round(m * 100);
const tenths = (s: number | null) => (s === null ? null : Math.round(s * 10));
const degrees = (d: number | null) => (d === null ? null : Math.round(d) % 360);
const pad = (n: number) => String(n).padStart(2, "0");
const runId = (at: Date) =>
  `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}${pad(at.getUTCHours())}`;

/** How one model's variables map onto the blend. */
function sourceFields(manifest: WaveManifest) {
  const variables = manifest.variables ?? {};
  const has = (name: string) => name in variables;
  const partitions = Object.fromEntries(
    PARTITION_KEYS.map((key) => {
      const set = WAVE_PARTITIONS[key];
      const height = pickVariable(variables, set.height);
      return [
        key,
        height === null
          ? null
          : {
              height,
              period: pickVariable(variables, set.period),
              direction: pickVariable(variables, set.direction),
            },
      ];
    }),
  ) as Record<
    PartitionKey,
    { height: string; period: string | null; direction: string | null } | null
  >;
  return {
    height: has(HEIGHT_VARIABLE) ? HEIGHT_VARIABLE : null,
    period: has(PERIOD_VARIABLE) ? PERIOD_VARIABLE : null,
    direction: pickVariable(variables, DIRECTION_VARIABLES),
    partitions,
  };
}

const value = (step: WaveStep | null, name: string | null) => {
  const v = step && name ? step.values?.[name] : null;
  return finite(v) ? v : null;
};

/**
 * The wave blend of `manifests` (wave runs with their spot squares merged in)
 * for every place any of them has a sea state for. Only the blend's members
 * are read (`waveBlendMembers`), in the order they lead. `now` names the run:
 * the hour it was worked out.
 */
export function buildWaveBlend(
  manifests: readonly WaveManifest[],
  now = new Date(),
  members: readonly string[] = waveBlendMembers(manifests.map((m) => m.model)),
): WaveBlendRun {
  const runs = members
    .map((id) => manifests.find((manifest) => manifest.model === id))
    .filter((manifest): manifest is WaveManifest => !!manifest)
    .map((manifest) => ({ manifest, fields: sourceFields(manifest) }))
    .filter(({ fields }) => fields.height !== null);
  // Every place any of them publishes a series for, and every time they publish.
  const native = runs.map(({ manifest }) => {
    const times = new Set<string>();
    for (const series of Object.values(manifest.spotSeries ?? {}))
      for (const step of series ?? []) times.add(step.validTime);
    return times;
  });
  const byInstant = new Map<number, string>();
  for (const times of native)
    for (const time of times) {
      const at = Date.parse(time);
      if (Number.isFinite(at) && !byInstant.has(at)) byInstant.set(at, time);
    }
  const instants = [...byInstant.keys()].sort((a, b) => a - b);
  const times = instants.map((at) => byInstant.get(at)!);
  const index = new Map(instants.map((at, i) => [at, i]));
  const places = [
    ...new Set(
      runs.flatMap(({ manifest }) => Object.keys(manifest.spotSeries ?? {})),
    ),
  ].sort();
  const published = PARTITION_KEYS.filter((key) =>
    runs.some(({ fields }) => fields.partitions[key] !== null),
  );
  const spots: WaveBlendSpots = {};
  for (const id of places) {
    // Each model's step at each time, or null where it has none near enough.
    const steps = runs.map(({ manifest }) => {
      const series = waveSeries(manifest, id);
      return series
        ? waveAtAxis(series, times, WAVE_MATCH_HOURS)
        : times.map(() => null);
    });
    const spot: WaveBlendSpot = {
      height: [],
      low: [],
      high: [],
      period: [],
      from: [],
      fed: [],
      count: "",
      lead: "",
      parts: Object.fromEntries(
        published.map((key) => [key, { height: [], period: [], from: [] }]),
      ),
    };
    let any = false;
    times.forEach((_, c) => {
      const fed = runs
        .map((run, i) => ({ run, i, step: steps[i][c] }))
        .filter(({ run, step }) => value(step, run.fields.height) !== null);
      const heights = fed.map(({ run, step }) =>
        value(step, run.fields.height)!,
      );
      const periods = fed
        .map(({ run, step }) => value(step, run.fields.period))
        .filter(finite);
      const bearings = fed.flatMap(({ run, step }) => {
        const from = value(step, run.fields.direction);
        return from === null
          ? []
          : [{ from, weight: value(step, run.fields.height)! }];
      });
      spot.height.push(centimetres(median(heights)));
      spot.low.push(heights.length ? centimetres(Math.min(...heights)) : null);
      spot.high.push(heights.length ? centimetres(Math.max(...heights)) : null);
      spot.period.push(tenths(median(periods)));
      spot.from.push(degrees(meanDirection(bearings)));
      spot.fed.push(fed.reduce((mask, { i }) => mask | (1 << i), 0));
      spot.count += fed.length.toString(36);
      const lead = fed[0];
      spot.lead += lead ? lead.i.toString(36) : "-";
      for (const key of published) {
        const set = lead?.run.fields.partitions[key] ?? null;
        const part = spot.parts[key]!;
        part.height.push(
          centimetres(set ? value(lead.step, set.height) : null),
        );
        part.period.push(tenths(set ? value(lead.step, set.period) : null));
        part.from.push(degrees(set ? value(lead.step, set.direction) : null));
      }
      if (fed.length) any = true;
    });
    if (any) spots[id] = spot;
  }
  const hour = new Date(Math.floor(now.getTime() / 3600000) * 3600000);
  return {
    schemaVersion: WAVE_BLEND_SCHEMA,
    kind: "wave-blend",
    model: "wave-blend",
    run: runId(hour),
    runTime: hour.toISOString().replace(".000Z", "Z"),
    generatedAt: now.toISOString(),
    coverage: { from: times[0] ?? "", to: times[times.length - 1] ?? "" },
    times,
    sources: runs.map(({ manifest, fields }, i) => ({
      id: manifest.model,
      name: manifest.modelName,
      run: manifest.run,
      runTime: manifest.runTime,
      resolutionKm: manifest.resolutionKm ?? null,
      columns: [...native[i]]
        .map((time) => index.get(Date.parse(time)))
        .filter((c): c is number => c !== undefined)
        .sort((a, b) => a - b),
      variables: {
        height: fields.height!,
        period: fields.period,
        direction: fields.direction,
      },
      partitions: PARTITION_KEYS.filter(
        (key) => fields.partitions[key] !== null,
      ),
    })),
    [WAVE_BLEND_KEY]: spots,
  };
}

/** The run directory's name before its hash: `wave-blend-<run>-<hours>h-v2`. */
export function waveBlendPrefix(
  blend: Pick<WaveBlendHead, "run" | "runTime" | "coverage">,
): string {
  const reach = Math.max(
    0,
    Math.ceil(
      (Date.parse(blend.coverage.to) - Date.parse(blend.runTime)) / 3600000,
    ) || 0,
  );
  return `wave-blend-${blend.run}-${reach}h-v${WAVE_BLEND_SCHEMA}`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const numberOrNull = (value: unknown) =>
  value === null || (typeof value === "number" && Number.isFinite(value));

/** The published pointer, checked; throws with a sentence when it is not one. */
export function parseWaveBlend(body: unknown): WaveBlend {
  if (
    !isObject(body) ||
    body.kind !== "wave-blend" ||
    body.model !== "wave-blend"
  )
    throw new Error("Not a wave blend file.");
  if (body.schemaVersion !== WAVE_BLEND_SCHEMA)
    throw new Error(`Unknown wave blend schema ${String(body.schemaVersion)}.`);
  const times = body.times;
  if (
    !Array.isArray(times) ||
    !times.every((t) => typeof t === "string" && Number.isFinite(Date.parse(t)))
  )
    throw new Error("The wave blend's times are not a list of times.");
  if (!Array.isArray(body.sources) || !body.sources.length)
    throw new Error("The wave blend names no models.");
  for (const source of body.sources)
    if (
      !isObject(source) ||
      typeof source.id !== "string" ||
      typeof source.runTime !== "string" ||
      !Array.isArray(source.columns) ||
      !source.columns.every(
        (c) => Number.isInteger(c) && c >= 0 && c < times.length,
      ) ||
      !Array.isArray(source.partitions)
    )
      throw new Error("A wave blend source is malformed.");
  checkBase(body.base);
  const index = checkSpotIndex(body.spots);
  if (index.keys.length !== 1 || index.keys[0] !== WAVE_BLEND_KEY)
    throw new Error(
      `The wave blend's squares must carry ${WAVE_BLEND_KEY} alone.`,
    );
  if (SPOT_KEYS.some((key) => key in body))
    throw new Error(
      "The wave blend's places belong in its squares, not its pointer.",
    );
  return body as unknown as WaveBlend;
}

const series = (values: unknown, n: number) =>
  Array.isArray(values) && values.length === n && values.every(numberOrNull);
const code = (text: unknown, n: number, digits: (c: string) => boolean) =>
  typeof text === "string" && text.length === n && [...text].every(digits);

/** One square's places, checked against the blend's times and models; throws naming the place. */
export function checkWaveBlendSpots(
  blend: Pick<WaveBlendHead, "times" | "sources">,
  spots: unknown,
): WaveBlendSpots {
  if (!isObject(spots))
    throw new Error("The wave blend's places are malformed.");
  const n = blend.times.length;
  const m = blend.sources.length;
  for (const [id, spot] of Object.entries(spots)) {
    const ok =
      isObject(spot) &&
      (["height", "low", "high", "period", "from"] as const).every((key) =>
        series(spot[key], n),
      ) &&
      Array.isArray(spot.fed) &&
      spot.fed.length === n &&
      spot.fed.every(
        (mask) => Number.isInteger(mask) && mask >= 0 && mask < 2 ** m,
      ) &&
      code(spot.count, n, (c) => parseInt(c, 36) <= m) &&
      code(spot.lead, n, (c) => c === "-" || parseInt(c, 36) < m) &&
      isObject(spot.parts) &&
      Object.entries(spot.parts).every(
        ([key, part]) =>
          (PARTITION_KEYS as string[]).includes(key) &&
          isObject(part) &&
          series(part.height, n) &&
          series(part.period, n) &&
          series(part.from, n),
      );
    if (!ok)
      throw new Error(`The wave blend's series for ${id} are malformed.`);
  }
  return spots as WaveBlendSpots;
}

/**
 * The pointer with the places of `squares` merged in, read through the one
 * spot loader. Each square stands alone: one that cannot be read, or does not
 * hold together, is named in `failed` and its places stay unknown.
 */
export async function loadWaveBlendSquares(
  read: ReadJson,
  blend: WaveBlend,
  squares: readonly string[],
): Promise<LoadedWaveBlend> {
  const listed = new Set(blend.spots.squares);
  const wanted = [...new Set(squares)].filter((s) => listed.has(s)).sort();
  const results = await Promise.allSettled(
    wanted.map(async (square) => {
      const data = await loadSpotSquares(read, WAVE_BLEND_PATH, blend, [
        square,
      ]);
      return checkWaveBlendSpots(blend, data.spotWaveBlend);
    }),
  );
  const spotWaveBlend: WaveBlendSpots = Object.create(null);
  const loaded: string[] = [];
  const failed: string[] = [];
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      failed.push(wanted[i]);
      return;
    }
    loaded.push(wanted[i]);
    mergeSpots(spotWaveBlend, result.value, WAVE_BLEND_KEY);
  });
  return { ...blend, spotWaveBlend, loaded, failed };
}

/** Whether the wave blend was worked out too long ago to show. */
export const staleWaveBlend = (
  blend: Pick<WaveBlend, "generatedAt">,
  now = Date.now(),
) => now - Date.parse(blend.generatedAt) > WAVE_BLEND_MAX_AGE_HOURS * 3600000;

/** One partition at one time, in metres, seconds and degrees. */
export interface WavePartHour {
  heightM: number | null;
  periodS: number | null;
  from: number | null;
}

/** One place's sea state at one time, as a reader uses it. */
export interface WaveBlendHour {
  time: string;
  /** The median significant height, and the models' range, in metres. */
  heightM: number | null;
  lowM: number | null;
  highM: number | null;
  periodS: number | null;
  from: number | null;
  /** The models that fed the time, in the order they lead, and how many. */
  models: string[];
  count: number;
  /** The model whose partitions `parts` are, or null where none fed the time. */
  lead: string | null;
  parts: Partial<Record<PartitionKey, WavePartHour>>;
}

const metres = (cm: number | null) => (cm === null ? null : cm / 100);
const seconds = (ds: number | null) => (ds === null ? null : ds / 10);

/**
 * One place's hours from the wave blend, on its own times, or null where the
 * blend does not know the place (or its square has not been read).
 */
export function waveBlendHours(
  blend: Pick<WaveBlendRun, "times" | "sources" | "spotWaveBlend">,
  placeId: string,
): WaveBlendHour[] | null {
  const spot = blend.spotWaveBlend[placeId];
  if (!spot) return null;
  const ids = blend.sources.map((source) => source.id);
  return blend.times.map((time, c) => {
    const lead = spot.lead[c];
    const parts: Partial<Record<PartitionKey, WavePartHour>> = {};
    for (const [key, part] of Object.entries(spot.parts) as [
      PartitionKey,
      WaveBlendPart,
    ][])
      parts[key] = {
        heightM: metres(part.height[c]),
        periodS: seconds(part.period[c]),
        from: part.from[c],
      };
    return {
      time,
      heightM: metres(spot.height[c]),
      lowM: metres(spot.low[c]),
      highM: metres(spot.high[c]),
      periodS: seconds(spot.period[c]),
      from: spot.from[c],
      models: ids.filter((_, i) => spot.fed[c] & (1 << i)),
      count: parseInt(spot.count[c], 36),
      lead: lead === "-" ? null : (ids[parseInt(lead, 36)] ?? null),
      parts,
    };
  });
}
