// Wave forecasts. The manifest shape, its validator and the nearest-step axis
// matching are not wave-specific — a weather bundle says the same thing about
// temperature and rain — so they live in `variables.ts` and this module is the
// wave-shaped door onto them, holding only what is actually about the sea: the
// coverage notes an adapter publishes for a beach it cannot resolve, which of
// its variables carry a sea state, and which source the dock should prefer.
import {
  MAX_VARIABLES_HORIZON_HOURS,
  VARIABLE_MATCH_HOURS,
  VARIABLE_STEP_HOURS,
  VARIABLE_VALUE_LIMITS,
  pickVariable,
  validateVariablesManifest,
  variableAtAxis,
  variableSeries,
  variableSeriesHasData,
  variablesHours,
  type BundleVariable,
  type VariableStep,
  type VariablesManifest,
} from "./variables";

/** Cadences the importers publish; anything else is a contract break. */
export const WAVE_STEP_HOURS = VARIABLE_STEP_HOURS;
/** The longest horizon a frameless bundle may declare, as the importer allows. */
export const MAX_WAVE_HORIZON_HOURS = MAX_VARIABLES_HORIZON_HOURS;
/** The importer's absolute bound on every published wave value. */
export const MAX_WAVE_VALUE = VARIABLE_VALUE_LIMITS.wave;
/**
 * How far a dock column may sit from a native wave step and still read it, in
 * hours. Wave values are never interpolated between steps: heights, periods and
 * directions belong to a spectrum the model solved at that hour, and averaging
 * two of them invents a sea state that was never forecast.
 */
export const WAVE_MATCH_HOURS = VARIABLE_MATCH_HOURS;

/** Sources in the order the dock prefers them: Ireland's own model first. */
export const WAVE_SOURCE_PREFERENCE: readonly string[] = [
  "mi-swan",
  "gfs-wave",
];

export type WaveVariable = BundleVariable;
/** One native forecast step for one spot; a variable with no value is null. */
export type WaveStep = VariableStep;
/**
 * Why a spot reads the way it does, as GFS-Wave publishes it. `landMasked` says
 * the cell over the location is land, ice or unresolved; `resolved` says a
 * usable water cell was found anyway, next to it.
 */
export interface WaveCoverage {
  landMasked?: boolean;
  resolved?: boolean;
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
export interface WaveManifest extends VariablesManifest {
  kind: "wave";
  spotCoverage?: Record<string, WaveCoverage>;
  spots?: Record<string, WaveSpotRecord>;
  directionConvention?: string;
  partitionNote?: string;
}

/**
 * The hours a wave bundle publishes, from its cadence ladder, its frame count
 * or its declared horizon — the browser side of `expected_hours`.
 */
export const waveHours = (manifest: WaveManifest): number[] =>
  variablesHours(manifest, "wave");

/**
 * A validated wave manifest, checking the manifest-level rules the importer
 * checks. Frame *contents* are not checked: the dock reads series and never
 * downloads a wave frame.
 */
export const validateWaveManifest =
  validateVariablesManifest<WaveManifest>("wave");

/** The precomputed series for a named spot, or null when this model omits it. */
export const waveSeries = (
  manifest: WaveManifest,
  spotId: string | undefined,
): WaveStep[] | null => variableSeries(manifest, spotId);

/**
 * Whether a series says anything at all. A land-masked or unresolved location
 * is published as a full series of nulls, which is a deliberate statement that
 * the model cannot speak here — not a row of dashes worth showing.
 */
export const waveSeriesHasData = (
  series: readonly WaveStep[] | null,
  variable = "swh",
) => variableSeriesHasData(series, variable);

/**
 * The nearest native wave step to each time on the dock's axis, or null where
 * no step falls inside `WAVE_MATCH_HOURS`. Nothing is interpolated.
 */
export const waveAtAxis = (
  series: readonly WaveStep[],
  axisTimes: readonly string[],
  toleranceHours = WAVE_MATCH_HOURS,
): (WaveStep | null)[] => variableAtAxis(series, axisTimes, toleranceHours);

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

export function waveFields(manifest: WaveManifest): WaveFields | null {
  const variables = manifest.variables ?? {};
  const set = (
    heights: readonly string[],
    periods: readonly string[],
    directions: readonly string[],
  ): WaveFieldSet | null => {
    const height = pickVariable(variables, heights);
    return height === null
      ? null
      : {
          height,
          period: pickVariable(variables, periods),
          direction: pickVariable(variables, directions),
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
