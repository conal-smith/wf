// What a WMO present-weather code means, as a shape and a sentence: the table
// the dock's and the spot page's sky glyphs are drawn from, and the words the
// forecast server gives an agent for the same hour. Dependency-free, so the
// browser, the Pages worker and Node all load it as it is; surface.ts
// re-exports it beside the weather bundles' readers.

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

/**
 * The sky as a present-weather group, from the model's code, or from its
 * cloud and rain where it gives no code: the spot page's sky glyph. A clear
 * or cloudy code over rain the model still counts (0.3 mm or more in the
 * hour's interval) is rain.
 */
export function skyOf(weather: {
  weather_code: number | null;
  rain_mm: number | null;
  cloud_pct: number | null;
}): WeatherIcon | null {
  const present = presentWeather(weather.weather_code);
  const raining = (weather.rain_mm ?? 0) >= 0.3;
  if (present) {
    const { icon } = present;
    if (raining && (icon === "clear" || icon === "partly" || icon === "cloudy"))
      return "rain";
    return icon;
  }
  if (raining) return "rain";
  if (weather.cloud_pct === null) return null;
  return weather.cloud_pct < 25
    ? "clear"
    : weather.cloud_pct < 70
      ? "partly"
      : "cloudy";
}
