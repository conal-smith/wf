import type { PresentWeather } from "../force5/src/surface";
import { ChartGlyph } from "./chartGlyphs";
import { skyGlyph } from "./glyphSet";

/**
 * One shape per present-weather group, from the glyph set (src/glyphSet.ts):
 * an ink outline with the weather's colour inside, the sun's yellow, rain's
 * blue, a cloud's grey, so a day's sky reads at a glance. In the dark hours a
 * clear or part-cloudy sky is the moon. Nine groups for a hundred codes: the
 * groups are what a rider acts on, and the code's own words are in the cell's
 * tooltip for anyone who wants the rest.
 */
interface Props {
  weather: PresentWeather;
  size?: number;
  /** A dark hour: the moon for the sun. */
  dark?: boolean;
}

/** A present-weather code as a glyph, with its description as the text reading. */
export default function WeatherGlyph({ weather, size = 16, dark }: Props) {
  return (
    <span
      className="weather-cell"
      data-weather={weather.icon}
      data-code={weather.code}
    >
      <ChartGlyph glyph={skyGlyph(weather.icon, dark)} size={size} />
      <span className="sr-only">{weather.description}</span>
    </span>
  );
}
