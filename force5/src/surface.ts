// Surface weather: temperature, rain, cloud, pressure and present weather, read
// from a `kind: "weather"` variables bundle. The contract, the validator and the
// nearest-step axis matching are the shared ones in `variables.ts`; what belongs
// here is which of a manifest's declared variables carry which reading, and what
// a WMO present-weather code actually means.
import {
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
/** Sources in the order the dock prefers them; there is one adapter so far. */
export const WEATHER_SOURCE_PREFERENCE: readonly string[] = ["icon-eu-weather"];

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
 * The weather manifest to read for one spot. A manifest whose series for the
 * spot carries no air temperature at all is not a source: it has said it cannot
 * see this place, and the next model gets the chance.
 */
export function preferredWeatherSource(
  manifests: readonly WeatherManifest[],
  spotId: string | undefined,
  preference: readonly string[] = WEATHER_SOURCE_PREFERENCE,
): WeatherSource | null {
  const order = (manifest: WeatherManifest) => {
    const rank = preference.indexOf(manifest.model);
    return rank === -1 ? preference.length : rank;
  };
  for (const manifest of [...manifests].sort((a, b) => order(a) - order(b))) {
    const series = weatherSeries(manifest, spotId);
    const fields = weatherFields(manifest);
    if (!series || !fields.air || !weatherSeriesHasData(series, fields.air))
      continue;
    return { manifest, series, fields };
  }
  return null;
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

/**
 * The nine shapes the dock draws for present weather. A code table has far more
 * entries than a reader can tell apart at 18 pixels, so the groups are the ones
 * a rider acts on: is it clear, is it raining, is it thundering, can I see.
 */
export type WeatherIcon =
  | "clear"
  | "partly"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "showers"
  | "thunder"
  | "snow";

export interface PresentWeather {
  code: number;
  icon: WeatherIcon;
  /** WMO 4677's own words for the code, as one short phrase. */
  description: string;
}

/** 50–55, 60–65 and 70–75 encode intensity in pairs: slight, moderate, heavy. */
const INTENSITY = ["Slight", "Moderate", "Heavy"] as const;
const graded = (noun: string) => (code: number) =>
  `${INTENSITY[Math.floor((code % 10) / 2)]} ${noun}`;

type Entry = [
  from: number,
  to: number,
  icon: WeatherIcon,
  words: string | ((code: number) => string),
];

/**
 * WMO code table 4677, grouped. DWD's `ww` is the model's own interpretation
 * code, not an observed report, so the words below describe the code and never
 * claim a measurement.
 */
const TABLE: readonly Entry[] = [
  [0, 0, "clear", "Clear sky"],
  [1, 1, "partly", "Mainly clear, clouds dissolving"],
  [2, 2, "partly", "Partly cloudy, state of sky unchanged"],
  [3, 3, "cloudy", "Cloudy or overcast, clouds developing"],
  [4, 4, "fog", "Visibility reduced by smoke"],
  [5, 5, "fog", "Haze"],
  [6, 9, "fog", "Dust or sand in the air"],
  [10, 10, "fog", "Mist"],
  [11, 12, "fog", "Shallow fog"],
  [13, 13, "thunder", "Lightning visible, no thunder heard"],
  [14, 16, "rain", "Precipitation in sight, not at this place"],
  [17, 17, "thunder", "Thunderstorm without precipitation"],
  [18, 18, "cloudy", "Squalls"],
  [19, 19, "cloudy", "Funnel cloud"],
  [20, 20, "drizzle", "Drizzle or snow grains in the past hour"],
  [21, 21, "rain", "Rain in the past hour"],
  [22, 22, "snow", "Snow in the past hour"],
  [23, 23, "snow", "Rain and snow, or ice pellets, in the past hour"],
  [24, 24, "drizzle", "Freezing drizzle or freezing rain in the past hour"],
  [25, 25, "showers", "Rain showers in the past hour"],
  [26, 26, "snow", "Snow showers in the past hour"],
  [27, 27, "showers", "Hail showers in the past hour"],
  [28, 28, "fog", "Fog in the past hour"],
  [29, 29, "thunder", "Thunderstorm in the past hour"],
  [30, 35, "fog", "Duststorm or sandstorm"],
  [36, 39, "snow", "Drifting or blowing snow"],
  [40, 47, "fog", "Fog"],
  [48, 49, "fog", "Freezing fog, depositing rime"],
  [50, 55, "drizzle", graded("drizzle")],
  [56, 57, "drizzle", "Freezing drizzle"],
  [58, 59, "drizzle", "Drizzle and rain"],
  [60, 65, "rain", graded("rain")],
  [66, 67, "rain", "Freezing rain"],
  [68, 69, "snow", "Rain or drizzle with snow"],
  [70, 75, "snow", graded("snow")],
  [76, 76, "snow", "Diamond dust"],
  [77, 77, "snow", "Snow grains"],
  [78, 78, "snow", "Isolated snow crystals"],
  [79, 79, "snow", "Ice pellets"],
  [80, 80, "showers", "Slight rain showers"],
  [81, 81, "showers", "Moderate or heavy rain showers"],
  [82, 82, "showers", "Violent rain showers"],
  [83, 84, "showers", "Showers of rain and snow"],
  [85, 86, "snow", "Snow showers"],
  [87, 88, "showers", "Showers of snow pellets or small hail"],
  [89, 90, "showers", "Hail showers without thunder"],
  [91, 94, "thunder", "Precipitation now, thunderstorm in the past hour"],
  [95, 95, "thunder", "Thunderstorm, slight or moderate"],
  [96, 96, "thunder", "Thunderstorm with hail"],
  [97, 97, "thunder", "Heavy thunderstorm"],
  [98, 98, "thunder", "Thunderstorm with duststorm or sandstorm"],
  [99, 99, "thunder", "Heavy thunderstorm with hail"],
];

/**
 * One present-weather code as a shape and a sentence, or null when there is no
 * code — which the dock renders as an em dash, never as "clear". A code outside
 * the table is an absence too: inventing a shape for it would be worse than
 * saying nothing.
 */
export function presentWeather(
  code: number | null | undefined,
): PresentWeather | null {
  if (typeof code !== "number" || !Number.isInteger(code)) return null;
  const entry = TABLE.find(([from, to]) => code >= from && code <= to);
  if (!entry) return null;
  const [, , icon, words] = entry;
  return {
    code,
    icon,
    description: typeof words === "function" ? words(code) : words,
  };
}
