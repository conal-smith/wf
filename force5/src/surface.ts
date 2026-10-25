// Surface weather: temperature, rain, cloud, pressure and present weather, read
// from a `kind: "weather"` variables bundle. The contract, the validator and the
// nearest-step axis matching are the shared ones in `variables.ts`; what belongs
// here is which of a manifest's declared variables carry which reading, and what
// a WMO present-weather code actually means.
import {
  handOverSeries,
  VARIABLE_MATCH_HOURS,
  VARIABLE_VALUE_LIMITS,
  pickVariable,
  validateVariableSpots,
  validateVariablesManifest,
  variableAtAxis,
  variableSeries,
  variableSeriesHasData,
  variablesHours,
  type VariableStep,
  type VariablesManifest,
} from "./variables";

/** The importer's absolute bound on a published surface measurement. */
export const MAX_WEATHER_VALUE = VARIABLE_VALUE_LIMITS.weather;
/** How far a dock column may sit from a native step and still read it. */
export const WEATHER_MATCH_HOURS = VARIABLE_MATCH_HOURS;
/**
 * Sources in the order the dock prefers them, finest first: ICON-EU's 6.5 km
 * for its three days, then GFS's 0.25° to sixteen (`handedWeatherSource`).
 */
export const WEATHER_SOURCE_PREFERENCE: readonly string[] = [
  "icon-eu-weather",
  "gfs-weather",
];

export type WeatherStep = VariableStep;

export interface WeatherManifest extends VariablesManifest {
  kind: "weather";
  /** How `precip` was derived from the model's own accumulation. */
  precipitationNote?: string;
  /** Why the skin temperature is a proxy for an SST and not an observation. */
  seaTemperatureNote?: string;
  /** Why a present-weather code is never averaged or blended. */
  presentWeatherNote?: string;
}

/** The hours a weather bundle publishes — the browser side of `expected_hours`. */
export const weatherHours = (manifest: WeatherManifest): number[] =>
  variablesHours(manifest, "weather");

/**
 * A validated weather manifest. The same manifest-level rules as a wave bundle,
 * with the wider value bound and the code-table variables the shared validator
 * already knows about.
 */
export const validateWeatherManifest =
  validateVariablesManifest<WeatherManifest>("weather");
/** A weather run's spot series, once read from its squares. */
export const validateWeatherSpots =
  validateVariableSpots<WeatherManifest>("weather");

/** The precomputed series for a named spot, or null when this model omits it. */
export const weatherSeries = (
  manifest: WeatherManifest,
  spotId: string | undefined,
): WeatherStep[] | null => variableSeries(manifest, spotId);

/** The nearest native step per dock column; null where none is close enough. */
export const weatherAtAxis = (
  series: readonly WeatherStep[],
  axisTimes: readonly string[],
  toleranceHours = WEATHER_MATCH_HOURS,
): (WeatherStep | null)[] => variableAtAxis(series, axisTimes, toleranceHours);

/**
 * Which of a manifest's variables carry each reading the dock shows. Read from
 * the declared map rather than hard-coded, so a second adapter that names its
 * fields differently only has to be listed here.
 */
export interface WeatherFields {
  air: string | null;
  dewPoint: string | null;
  humidity: string | null;
  /** Precipitation in the interval ending at the step, not the accumulation. */
  rain: string | null;
  rainSinceRun: string | null;
  cloud: string | null;
  cloudLow: string | null;
  cloudMid: string | null;
  cloudHigh: string | null;
  pressure: string | null;
  /** The present-weather code variable, declared as `kind: "code"`. */
  present: string | null;
  /** Ground/skin temperature: over sea a model SST proxy, never an observation. */
  skin: string | null;
  visibility: string | null;
  cape: string | null;
}

export function weatherFields(manifest: WeatherManifest): WeatherFields {
  const variables = manifest.variables ?? {};
  const pick = (...candidates: string[]) => pickVariable(variables, candidates);
  return {
    air: pick("t2m", "t_2m"),
    dewPoint: pick("td2m", "td_2m"),
    humidity: pick("rh2m", "relhum_2m"),
    rain: pick("precip"),
    rainSinceRun: pick("tp", "tot_prec"),
    cloud: pick("clct"),
    cloudLow: pick("clcl"),
    cloudMid: pick("clcm"),
    cloudHigh: pick("clch"),
    pressure: pick("pmsl", "msl"),
    present: pick("ww"),
    skin: pick("tg", "t_g", "sst"),
    visibility: pick("vis"),
    cape: pick("cape", "cape_ml"),
  };
}

/** Whether the manifest speaks about this spot at all. */
export const weatherSeriesHasData = (
  series: readonly WeatherStep[] | null,
  variable = "t2m",
) => variableSeriesHasData(series, variable);

export interface WeatherSource {
  manifest: WeatherManifest;
  series: WeatherStep[];
  fields: WeatherFields;
}

/**
 * Every weather manifest that can be read for one spot, in the order the dock
 * prefers them. A manifest whose series for the spot carries no air
 * temperature at all is not a source: it has said it cannot see this place,
 * and the next model gets the chance.
 */
export function weatherSources(
  manifests: readonly WeatherManifest[],
  spotId: string | undefined,
  preference: readonly string[] = WEATHER_SOURCE_PREFERENCE,
): WeatherSource[] {
  const order = (manifest: WeatherManifest) => {
    const rank = preference.indexOf(manifest.model);
    return rank === -1 ? preference.length : rank;
  };
  const out: WeatherSource[] = [];
  for (const manifest of [...manifests].sort((a, b) => order(a) - order(b))) {
    const series = weatherSeries(manifest, spotId);
    const fields = weatherFields(manifest);
    if (!series || !fields.air || !weatherSeriesHasData(series, fields.air))
      continue;
    out.push({ manifest, series, fields });
  }
  return out;
}

/** The weather manifest to read first for one spot (`weatherSources`). */
export const preferredWeatherSource = (
  manifests: readonly WeatherManifest[],
  spotId: string | undefined,
  preference: readonly string[] = WEATHER_SOURCE_PREFERENCE,
): WeatherSource | null =>
  weatherSources(manifests, spotId, preference)[0] ?? null;

/**
 * The spot's weather from every source in turn: the first source's own run,
 * then each next one's past the end of it (`handOverSeries`), so ICON-EU's
 * three days go on in GFS's fifteen rather than stopping. The result reads as
 * the first source, in its names for each reading; each step names the model
 * it came from. A rain total keeps its own interval, so the rain row prints
 * the handed run's totals as they were forecast. Null with no source.
 */
export function handedWeatherSource(
  sources: readonly WeatherSource[],
): WeatherSource | null {
  const [lead] = sources;
  if (!lead) return null;
  const keys = Object.keys(lead.fields) as (keyof WeatherFields)[];
  return {
    ...lead,
    series: handOverSeries(
      sources.map(({ manifest, series, fields }) => {
        const names: Record<string, string> = {};
        for (const key of keys) {
          const from = fields[key];
          const to = lead.fields[key];
          if (from && to && from !== to) names[from] = to;
        }
        return { model: manifest.model, series, names };
      }),
    ),
  };
}

/**
 * The length in hours of the interval a differenced variable covers at this
 * step, or null at initialization, which has no interval. The manifest states
 * it per step rather than leaving the reader to assume the cadence.
 */
export function precipIntervalHours(
  step: WeatherStep | null | undefined,
): number | null {
  const interval = step?.precipIntervalHours;
  if (!Array.isArray(interval) || interval.length !== 2) return null;
  const [from, to] = interval;
  return typeof from === "number" && typeof to === "number" && to > from
    ? to - from
    : null;
}

// What a present-weather code means lives on its own, free of the bundle
// readers, so the forecast server can say it in words without loading them.
export {
  presentWeather,
  skyOf,
  type PresentWeather,
  type WeatherIcon,
} from "./presentWeather";
