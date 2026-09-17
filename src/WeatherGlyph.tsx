import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  CloudSunRain,
  Snowflake,
  Sun,
} from "lucide-react";
import type { ComponentType } from "react";
import type { PresentWeather, WeatherIcon } from "../force5/src/surface";

/**
 * One shape per present-weather group, drawn as an inline stroke SVG in the row
 * text's own colour so it reads as a glyph and not as a coloured badge. Nine
 * shapes for a hundred codes: the groups are what a rider acts on, and the
 * code's own words are in the cell's tooltip for anyone who wants the rest.
 */
const GLYPH: Record<WeatherIcon, ComponentType<{ size?: number }>> = {
  clear: Sun,
  partly: CloudSun,
  cloudy: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  showers: CloudSunRain,
  thunder: CloudLightning,
  snow: Snowflake,
};

interface Props {
  weather: PresentWeather;
  size?: number;
}

/** A present-weather code as a glyph, with its description as the text reading. */
export default function WeatherGlyph({ weather, size = 16 }: Props) {
  const Icon = GLYPH[weather.icon];
  return (
    <span
      className="weather-cell"
      data-weather={weather.icon}
      data-code={weather.code}
    >
      <Icon size={size} />
      <span className="sr-only">{weather.description}</span>
    </span>
  );
}
