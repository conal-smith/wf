// Variables bundles. Two published kinds share one shape — `wave` and
// `weather` — because both are the same statement: a declared `variables` map,
// map frames that are optional because the precomputed per-spot series is the
// product, and a location the model cannot resolve published as nulls with a
// stated reason rather than dropped. The importer validates both with one
// function (`validate_variables_bundle` in force5/ingest/publish_s3.py), so the
// browser reads both with one reader here, and `waves.ts` and `surface.ts` are
// the typed doors onto it.
//
// Only two things differ by kind. The value bound: waves are metres, seconds
// and bearings, while surface weather carries hectopascals, millimetres and
// joules per kilogram. And a variable may declare `"kind": "code"`, making its
// values whole code-table entries (WMO present weather) that are checked for
// being small integers instead of range-checked — and that nothing downstream
// may interpolate, average or blend.
import type { SpotIndex } from "./spotData";
import { usableRunPath, validateRunPointer, type Grid } from "./weather";

/** The bundle kinds built on a declared variable map. */
export type VariablesKind = "wave" | "weather" | "current";

/** Cadences the importers publish; anything else is a contract break. */
export const VARIABLE_STEP_HOURS: readonly number[] = [1, 3, 6];
/** The longest horizon a frameless bundle may declare, as the importer allows. */
export const MAX_VARIABLES_HORIZON_HOURS = 384;
/**
 * The importer's absolute bound on a published measurement, per kind. Mirrors
 * `VARIABLE_LIMITS`: a wave bundle publishes metres and seconds, a weather
 * bundle publishes hectopascals and joules per kilogram as well.
 */
export const VARIABLE_VALUE_LIMITS: Record<VariablesKind, number> = {
  wave: 1000,
  weather: 100_000,
  // Surface currents in m/s (force5/src/currents.ts).
  current: 10,
};
/** A code-table entry is a small whole number, never a measurement. */
export const MAX_VARIABLE_CODE = 1000;
/**
 * How far a dock column may sit from a native step and still read it, in hours.
 * Nothing is interpolated between steps. A wave height, period and direction
 * belong to a spectrum the model solved at that hour, and averaging two of them
 * invents a sea state that was never forecast; a present-weather code is an
 * index into a table, where the mean of "fog" and "rain" means nothing. Half a
 * three-hour step is wide enough to land every 3-hourly step on a 3-hourly wind
 * column and narrow enough to leave a 6-hourly wind column's odd hours empty.
 */
export const VARIABLE_MATCH_HOURS = 1.5;

/**
 * One declared variable. `kind: "code"` says the values are code-table entries
 * rather than measurements.
 */
export interface BundleVariable {
  units: string;
  label: string;
  description: string;
  kind?: "code";
}
/**
 * A frame in a variables bundle. It carries no gust window; a weather bundle
 * states the interval a per-interval variable covers instead, and `gfs-wave`
 * publishes neither. Both are optional so a wind-shaped frame list still fits.
 */
export interface BundleFrame {
  hour: number;
  validTime: string;
  url: string;
  /** The hours a differenced variable (`precip`) covers, null at hour zero. */
  precipIntervalHours?: [number, number] | null;
  gustIntervalHours?: [number, number] | null;
}
/** One native forecast step for one spot; a variable with no value is null. */
export interface VariableStep {
  hour: number;
  validTime: string;
  values: Record<string, number | null>;
  /** As on the frame: the interval `precip` covers, null at initialization. */
  precipIntervalHours?: [number, number] | null;
  /**
   * The model a step was taken from, in a series handed over from one run to
   * the next (`handOverSeries`). A run's own published steps carry none.
   */
  model?: string;
}
/**
 * Everything both kinds declare. `waves.ts` and `surface.ts` narrow `kind`.
 * A run pointer (schemaVersion 2): `spotSeries` is present only once the spot
 * squares a reader asked for have been merged in (spotData.ts).
 */
export interface VariablesManifest {
  schemaVersion: number;
  kind: VariablesKind;
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
  variables: Record<string, BundleVariable>;
  /** The run directory, relative to the pointer's own directory. */
  base: string;
  /** May be empty: the spot series is the product, a grid is a luxury. */
  frames: BundleFrame[];
  /** The subset of `variables` the frames carry, when it is narrower. */
  frameVariables?: string[];
  /** The spot squares the run publishes. */
  spots: SpotIndex;
  spotSeries?: Record<string, VariableStep[]>;
  processing?: string;
  sourceUrl: string;
  attribution: string;
  licenseUrl: string;
  termsUrl?: string;
}

const filled = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const whole = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);
const bounded = (value: unknown, limit: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= limit;
const VARIABLE_NAME = /^[a-z][a-z0-9_]{0,31}$/;

/** The one message a broken bundle of this kind reports. */
const invalid = (kind: VariablesKind) =>
  `Invalid ${kind} forecast manifest. Refresh the ${kind} forecast.`;
const failWith = (kind: VariablesKind): never => {
  throw new Error(invalid(kind));
};

/**
 * The hours a bundle publishes, from its cadence ladder, its frame count or its
 * declared horizon — the browser side of `expected_hours`. The kind only names
 * the error, so a fixture that has not said which it is reads as a wave bundle.
 */
export function variablesHours(
  manifest: VariablesManifest,
  kind: VariablesKind = manifest?.kind ?? "wave",
): number[] {
  const fail = () => failWith(kind);
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
  if (!whole(step) || !VARIABLE_STEP_HOURS.includes(step)) fail();
  const frames = manifest.frames;
  if (Array.isArray(frames) && frames.length)
    return frames.map((_, index) => index * step);
  // Frameless: the horizon is declared rather than implied by a frame count.
  const horizon = manifest.horizonHours;
  if (
    !whole(horizon) ||
    horizon <= 0 ||
    horizon > MAX_VARIABLES_HORIZON_HOURS ||
    horizon % step
  )
    return fail();
  return Array.from({ length: horizon / step + 1 }, (_, index) => index * step);
}

/**
 * A validator for one bundle kind's pointer, checking the manifest-level rules
 * the importer checks: the run directory and its spot squares, the variable map
 * and its code declarations, the optional frame list and the declared horizon.
 * The spot series are checked as they are read, by `validateVariableSpots`.
 * Frame *contents* are not checked here — the dock reads series and never
 * downloads a variables frame.
 */
export function validateVariablesManifest<M extends VariablesManifest>(
  kind: VariablesKind,
): (manifest: M) => M {
  const fail = (): never => failWith(kind);
  return (m: M): M => {
    if (
      !m ||
      typeof m !== "object" ||
      m.kind !== kind ||
      !filled(m.model) ||
      !filled(m.modelName) ||
      !filled(m.provider) ||
      !filled(m.attribution) ||
      !Number.isFinite(Date.parse(m.runTime))
    )
      fail();
    try {
      validateRunPointer(m);
    } catch {
      fail();
    }
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
          filled(meta.description) &&
          (meta.kind === undefined || meta.kind === "code"),
      )
    )
      fail();
    if (!Array.isArray(m.frames)) fail();
    const hours = variablesHours(m, kind);
    const runTime = Date.parse(m.runTime);
    // Compared as instants, not as strings: the importers write "…:00:00Z" and
    // an ISO round-trip would add milliseconds that mean nothing.
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
          usableRunPath(frame.url),
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
    if (!m.spots.keys.includes("spotSeries")) fail();
    return m;
  };
}

/**
 * A validator for the spot series of one bundle kind, once they have been read
 * from the run's squares (spotData.ts): every series on the run's own hours,
 * every declared variable at every step, and every value inside the kind's
 * bounds. Returns the manifest it was given, so a merged run is checked in
 * place.
 */
export function validateVariableSpots<M extends VariablesManifest>(
  kind: VariablesKind,
): (manifest: M) => M {
  const limit = VARIABLE_VALUE_LIMITS[kind];
  const fail = (): never => failWith(kind);
  return (m: M): M => {
    const variables = m.variables;
    const hours = variablesHours(m, kind);
    const runTime = Date.parse(m.runTime);
    const at = (hour: number) => runTime + hour * 3600000;
    const series = m.spotSeries;
    if (!series || typeof series !== "object" || Array.isArray(series)) fail();
    // A code variable is an index into a code table, so it is checked for being
    // a small whole number rather than for a physical range.
    const codes = new Set(
      Object.entries(variables)
        .filter(([, meta]) => meta.kind === "code")
        .map(([name]) => name),
    );
    const names = Object.keys(variables).sort();
    const usable = (value: unknown, name: string) =>
      value === null ||
      (codes.has(name)
        ? whole(value) && value >= 0 && value < MAX_VARIABLE_CODE
        : bounded(value, limit));
    for (const steps of Object.values(series!)) {
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
          // Land, unresolved cells and hours with no interval are null, never
          // zero: a zero would read as a measurement that was taken.
          !Object.entries(step.values).every(([name, value]) =>
            usable(value, name),
          )
        )
          fail();
      });
    }
    return m;
  };
}

/** The precomputed series for a named spot, or null when this model omits it. */
export function variableSeries(
  manifest: VariablesManifest,
  spotId: string | undefined,
): VariableStep[] | null {
  if (!spotId) return null;
  const series = manifest.spotSeries?.[spotId];
  return Array.isArray(series) && series.length ? series : null;
}

/**
 * Whether a series says anything at all about one variable. A land-masked or
 * unresolved location is published as a full series of nulls, which is a
 * deliberate statement that the model cannot speak here — not a row of dashes
 * worth showing.
 */
export const variableSeriesHasData = (
  series: readonly VariableStep[] | null,
  variable: string,
) =>
  !!series &&
  series.some((step) => typeof step.values?.[variable] === "number");

/** One run handed a place's hours, as `handOverSeries` takes it. */
export interface HandedRun {
  model: string;
  series: readonly VariableStep[];
  /**
   * The run's variable names, each as the first run calls the same reading,
   * where the two differ. A reading the first run has no name for is left as
   * the run published it.
   */
  names?: Readonly<Record<string, string>>;
}

/**
 * One place's steps read from several runs in turn, as the wind hands over
 * from HARMONIE to ECMWF past HARMONIE's reach (force5/src/lead.ts): every step
 * of the first run, then of each next run only the steps past the last one
 * already taken. So the rows run as far as the furthest of the runs reaches,
 * a later run never fills a gap inside an earlier one's reach, and an hour is
 * never two models' at once. Each step says which model it came from, in the
 * first run's names for its readings. A run that reaches no further than those
 * before it adds nothing.
 */
export function handOverSeries(runs: readonly HandedRun[]): VariableStep[] {
  const out: VariableStep[] = [];
  let reach = -Infinity;
  for (const { model, series, names } of runs) {
    for (const step of series) {
      const time = Date.parse(step.validTime);
      if (!(time > reach)) continue;
      const values: Record<string, number | null> = {};
      for (const [name, value] of Object.entries(step.values ?? {}))
        values[names?.[name] ?? name] = value;
      out.push({ ...step, values, model });
    }
    if (out.length) reach = Date.parse(out[out.length - 1].validTime);
  }
  return out;
}

/**
 * The columns where a handed-over series changes model: each column whose
 * step is from another model than the last column before it that has one.
 * The dock marks them, as it marks where the stars hand over.
 */
export function handoverColumns(
  columns: readonly ({ model?: string } | null | undefined)[],
): Set<number> {
  const out = new Set<number>();
  let last: string | undefined;
  columns.forEach((step, at) => {
    if (!step?.model) return;
    if (last !== undefined && step.model !== last) out.add(at);
    last = step.model;
  });
  return out;
}

/**
 * The nearest native step to each time on the dock's axis, or null where no
 * step falls inside `VARIABLE_MATCH_HOURS`. Nothing is interpolated: see the
 * note on that constant.
 */
export function variableAtAxis(
  series: readonly VariableStep[],
  axisTimes: readonly string[],
  toleranceHours = VARIABLE_MATCH_HOURS,
): (VariableStep | null)[] {
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

/** One variable's value at one step, or null for an absence of any shape. */
export const variableValue = (
  step: VariableStep | null | undefined,
  name: string | null | undefined,
): number | null => {
  if (!step || !name) return null;
  const value = step.values?.[name];
  return typeof value === "number" ? value : null;
};

/** The first of `candidates` a manifest actually declares, or null. */
export const pickVariable = (
  variables: Record<string, BundleVariable> | undefined,
  candidates: readonly string[],
) => candidates.find((name) => !!variables && name in variables) ?? null;
