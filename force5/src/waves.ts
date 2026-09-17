// Wave forecasts. A wave bundle is not a wind bundle: it declares its own
// variables instead of publishing u/v/gust, its map frames are optional because
// the precomputed per-spot series is the product, and a location the model
// cannot resolve is published as nulls with a stated reason rather than
// dropped. So it gets its own contract, validator and readers here, mirroring
// `validate_wave_bundle` in force5/ingest/publish_s3.py.
import type { FrameInfo, Grid } from "./weather";

/** Cadences the importers publish; anything else is a contract break. */
export const WAVE_STEP_HOURS: readonly number[] = [1, 3, 6];
/** The longest horizon a frameless bundle may declare, as the importer allows. */
export const MAX_WAVE_HORIZON_HOURS = 384;
/** The importer's absolute bound on every published wave value. */
export const MAX_WAVE_VALUE = 1000;
/**
 * How far a dock column may sit from a native wave step and still read it, in
 * hours. Wave values are never interpolated between steps: heights, periods and
 * directions belong to a spectrum the model solved at that hour, and averaging
 * two of them invents a sea state that was never forecast. Half a three-hour
 * step is wide enough to land every 3-hourly wave step on a 3-hourly wind
 * column and narrow enough to leave a 6-hourly wind column's odd hours empty.
 */
export const WAVE_MATCH_HOURS = 1.5;

/**
 * Sources in the order the dock prefers them, finest first. Ireland's own 2.8 km
 * shelf model wins; NOAA's 9 km global model is the fallback; ECMWF's 0.25°
 * (~28 km) wave stream is last, because at that resolution a bay is a cell or
 * two wide and many spots are read from open water nearby. It is still worth
 * having: it is the only source of the three that reaches 15 days.
 */
export const WAVE_SOURCE_PREFERENCE: readonly string[] = [
  "mi-swan",
  "gfs-wave",
  "ecmwf-wave",
];

export interface WaveVariable {
  units: string;
  label: string;
  description: string;
}
/** One native forecast step for one spot; a variable with no value is null. */
export interface WaveStep {
  hour: number;
  validTime: string;
  values: Record<string, number | null>;
}
/**
 * Why a spot reads the way it does, as GFS-Wave publishes it. `landMasked` says
 * the cell over the location is land, ice or unresolved; `resolved` says a
 * usable water cell was found anyway, next to it.
 */
export interface WaveCoverage {
  landMasked?: boolean;
  resolved?: boolean;
  /**
   * How far the cell the values came from is from the location, in kilometres:
   * `0` when the location's own cells were read, and a real distance when the
   * adapter had to reach for the nearest cell the model solved. ECMWF Wave
   * publishes it at 0.25°, where many Irish spots sit in a cell the model treats
   * as land.
   */
  nearestOffsetKm?: number | null;
  note?: string;
}
/**
 * The Irish Shelf SWAN equivalent: the dataset and wet cell a spot was read
 * from, or a null `dataset` with the reason no cell was close enough.
 */
export interface WaveSpotRecord {
  dataset?: string | null;
  nearestOffsetKm?: number | null;
  nest?: boolean;
  reason?: string;
}
export interface WaveManifest {
  schemaVersion: number;
  kind: "wave";
  model: string;
  modelName: string;
  provider: string;
  run: string;
  runTime: string;
  generatedAt: string;
  stepHours: number;
  stepRanges?: { throughHour: number; stepHours: number }[];
  /** The last published hour, for a bundle whose frame count cannot imply it. */
  horizonHours?: number;
  resolutionKm?: number | null;
  resolutionLabel?: string;
  modelDetail?: string;
  /** Present only when frames are; a frameless bundle needs no grid. */
  grid?: Grid;
  variables: Record<string, WaveVariable>;
  /** May be empty: the spot series is the product, a wave grid is a luxury. */
  frames: FrameInfo[];
  /** The subset of `variables` the frames carry, when it is narrower. */
  frameVariables?: string[];
  spotSeries: Record<string, WaveStep[]>;
  spotCoverage?: Record<string, WaveCoverage>;
  spots?: Record<string, WaveSpotRecord>;
  directionConvention?: string;
  partitionNote?: string;
  processing?: string;
  sourceUrl: string;
  attribution: string;
  licenseUrl: string;
  termsUrl?: string;
}

const INVALID = "Invalid wave forecast manifest. Refresh the wave forecast.";
const fail = (): never => {
  throw new Error(INVALID);
};
const filled = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const whole = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);
const bounded = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= MAX_WAVE_VALUE;
const VARIABLE_NAME = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * The hours a wave bundle publishes, from its cadence ladder, its frame count
 * or its declared horizon — the browser side of `expected_hours`.
 */
export function waveHours(manifest: WaveManifest): number[] {
  const step = manifest.stepHours;
  const ranges = manifest.stepRanges;
  if (ranges !== undefined) {
    if (
      !Array.isArray(ranges) ||
      !ranges.length ||
      ranges[0]?.stepHours !== step
    )
      fail();
    const hours = [0];
    let end = 0;
    for (const range of ranges) {
      const { throughHour: through, stepHours: entry } = range ?? {};
      if (
        !whole(entry) ||
        entry <= 0 ||
        !whole(through) ||
        !(end < through && through <= 1000) ||
        (through - end) % entry
      )
        fail();
      for (let hour = end + entry; hour <= through; hour += entry)
        hours.push(hour);
      end = through;
    }
    return hours;
  }
  if (!whole(step) || !WAVE_STEP_HOURS.includes(step)) fail();
  const frames = manifest.frames;
  if (Array.isArray(frames) && frames.length)
    return frames.map((_, index) => index * step);
  // Frameless: the horizon is declared rather than implied by a frame count.
  const horizon = manifest.horizonHours;
  if (!whole(horizon) || horizon <= 0 || horizon > MAX_WAVE_HORIZON_HOURS)
    return fail();
  if (horizon % step) fail();
  return Array.from({ length: horizon / step + 1 }, (_, index) => index * step);
}

/**
 * A validated wave manifest, checking the manifest-level rules the importer
 * checks: the variable map, the optional frame list, the declared horizon and
 * the shape of every spot series. Frame *contents* are not checked here — the
 * dock reads series and never downloads a wave frame.
 */
export function validateWaveManifest(m: WaveManifest): WaveManifest {
  if (
    !m ||
    typeof m !== "object" ||
    m.schemaVersion !== 1 ||
    m.kind !== "wave" ||
    !filled(m.model) ||
    !filled(m.modelName) ||
    !filled(m.provider) ||
    !filled(m.attribution) ||
    !Number.isFinite(Date.parse(m.runTime))
  )
    fail();
  const variables = m.variables;
  if (
    !variables ||
    typeof variables !== "object" ||
    Array.isArray(variables) ||
    !Object.keys(variables).length ||
    !Object.entries(variables).every(
      ([name, meta]) =>
        VARIABLE_NAME.test(name) &&
        meta &&
        typeof meta === "object" &&
        filled(meta.units) &&
        filled(meta.label) &&
        filled(meta.description),
    )
  )
    fail();
  if (!Array.isArray(m.frames)) fail();
  const hours = waveHours(m);
  const runTime = Date.parse(m.runTime);
  // Compared as instants, not as strings: the importers write "…:00:00Z" and an
  // ISO round-trip would add milliseconds that mean nothing.
  const at = (hour: number) => runTime + hour * 3600000;
  if (
    m.horizonHours !== undefined &&
    m.horizonHours !== hours[hours.length - 1]
  )
    fail();
  if (
    m.frames.length &&
    !m.frames.every(
      (frame, index) =>
        frame &&
        frame.hour === hours[index] &&
        Date.parse(frame.validTime) === at(hours[index]) &&
        filled(frame.url) &&
        frame.url.startsWith("weather/") &&
        !frame.url.includes(".."),
    )
  )
    fail();
  const gridded = m.frameVariables;
  if (
    gridded !== undefined &&
    (!Array.isArray(gridded) ||
      !gridded.length ||
      new Set(gridded).size !== gridded.length ||
      !gridded.every((name) => name in variables))
  )
    fail();
  const series = m.spotSeries;
  if (
    !series ||
    typeof series !== "object" ||
    Array.isArray(series) ||
    !Object.keys(series).length
  )
    fail();
  const names = Object.keys(variables).sort();
  for (const steps of Object.values(series)) {
    if (!Array.isArray(steps) || steps.length !== hours.length) fail();
    steps.forEach((step, index) => {
      if (
        !step ||
        step.hour !== hours[index] ||
        Date.parse(step.validTime) !== at(hours[index]) ||
        !step.values ||
        typeof step.values !== "object" ||
        Array.isArray(step.values)
      )
        fail();
      const keys = Object.keys(step.values).sort();
      if (
        keys.length !== names.length ||
        keys.some((key, i) => key !== names[i]) ||
        // Land, unresolved cells and locations with no usable cell are null,
        // never zero: a zero would read as a flat calm sea that was measured.
        !Object.values(step.values).every(
          (value) => value === null || bounded(value),
        )
      )
        fail();
    });
  }
  return m;
}

/** The precomputed series for a named spot, or null when this model omits it. */
export function waveSeries(
  manifest: WaveManifest,
  spotId: string | undefined,
): WaveStep[] | null {
  if (!spotId) return null;
  const series = manifest.spotSeries?.[spotId];
  return Array.isArray(series) && series.length ? series : null;
}

/**
 * Whether a series says anything at all. A land-masked or unresolved location
 * is published as a full series of nulls, which is a deliberate statement that
 * the model cannot speak here — not a row of dashes worth showing.
 */
export const waveSeriesHasData = (
  series: readonly WaveStep[] | null,
  variable = "swh",
) =>
  !!series &&
  series.some((step) => typeof step.values?.[variable] === "number");

/**
 * The manifest's own words on why a spot reads the way it does, or null when it
 * sits in resolved water and there is nothing to explain. GFS-Wave publishes
 * `spotCoverage`; Irish Shelf SWAN publishes a `spots` record with the dataset
 * and offset it used, or a reason it used none.
 */
export function waveCoverageNote(
  manifest: WaveManifest,
  spotId: string | undefined,
): string | null {
  if (!spotId) return null;
  const coverage = manifest.spotCoverage?.[spotId];
  if (coverage)
    return coverage.landMasked || coverage.resolved === false
      ? (coverage.note ?? "This model cannot resolve waves at this location.")
      : null;
  const record = manifest.spots?.[spotId];
  if (!record) return null;
  if (record.dataset === null || record.dataset === undefined)
    return (
      record.reason ?? "No wave grid cell is near enough to this location."
    );
  const offset = record.nearestOffsetKm;
  return typeof offset === "number" && offset > 0
    ? `Read from the nearest open-water cell, ${offset.toFixed(1)} km away, so it describes the sea off this beach rather than the shorebreak.`
    : null;
}

/**
 * The nearest native wave step to each time on the dock's axis, or null where
 * no step falls inside `WAVE_MATCH_HOURS`. Nothing is interpolated: see the
 * note on that constant.
 */
export function waveAtAxis(
  series: readonly WaveStep[],
  axisTimes: readonly string[],
  toleranceHours = WAVE_MATCH_HOURS,
): (WaveStep | null)[] {
  const times = series.map((step) => Date.parse(step.validTime));
  const limit = toleranceHours * 3600000;
  return axisTimes.map((iso) => {
    const when = Date.parse(iso);
    if (!Number.isFinite(when)) return null;
    let best = -1;
    let distance = Infinity;
    times.forEach((time, index) => {
      const gap = Math.abs(time - when);
      if (gap < distance) {
        distance = gap;
        best = index;
      }
    });
    return best >= 0 && distance <= limit ? series[best] : null;
  });
}

/** The variables that carry one sea state: a height, and a period and bearing. */
export interface WaveFieldSet {
  height: string;
  period: string | null;
  direction: string | null;
}
/**
 * Which of a manifest's variables carry the whole sea and each partition. The
 * two adapters name them differently and publish different partitions — SWAN
 * has a swell height but no swell period, and its wind sea is derived — so the
 * rows read the declared variable map rather than hard-coding one source.
 */
export interface WaveFields {
  total: WaveFieldSet;
  swell: WaveFieldSet | null;
  windsea: WaveFieldSet | null;
}

const pick = (
  variables: Record<string, WaveVariable>,
  candidates: readonly string[],
) => candidates.find((name) => name in variables) ?? null;

export function waveFields(manifest: WaveManifest): WaveFields | null {
  const variables = manifest.variables ?? {};
  const set = (
    heights: readonly string[],
    periods: readonly string[],
    directions: readonly string[],
  ): WaveFieldSet | null => {
    const height = pick(variables, heights);
    return height === null
      ? null
      : {
          height,
          period: pick(variables, periods),
          direction: pick(variables, directions),
        };
  };
  const total = set(["swh"], ["pp1d", "mwp"], ["mwd", "pwd"]);
  if (!total) return null;
  return {
    total,
    swell: set(["swell1_h", "hswe"], ["swell1_p"], ["swell1_d"]),
    windsea: set(["shww"], ["mpww"], ["mdww"]),
  };
}

export interface WaveSource {
  manifest: WaveManifest;
  series: WaveStep[];
  fields: WaveFields;
  /** Why the spot reads as it does, or null when there is nothing to say. */
  note: string | null;
}

/**
 * The wave manifest to read for one spot. Ireland's own shelf model wins when
 * it resolves the location; GFS-Wave is the global fallback. A manifest whose
 * series for the spot is all nulls is not a source: it has said it cannot see
 * this place, and the next model gets the chance.
 */
export function preferredWaveSource(
  manifests: readonly WaveManifest[],
  spotId: string | undefined,
  preference: readonly string[] = WAVE_SOURCE_PREFERENCE,
): WaveSource | null {
  const order = (manifest: WaveManifest) => {
    const rank = preference.indexOf(manifest.model);
    return rank === -1 ? preference.length : rank;
  };
  for (const manifest of [...manifests].sort((a, b) => order(a) - order(b))) {
    const series = waveSeries(manifest, spotId);
    const fields = waveFields(manifest);
    if (!series || !fields || !waveSeriesHasData(series, fields.total.height))
      continue;
    return {
      manifest,
      series,
      fields,
      note: waveCoverageNote(manifest, spotId),
    };
  }
  return null;
}
