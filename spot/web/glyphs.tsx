/**
 * The small marks the spot page draws: the sky (the glyph set's, in the
 * weather's colours, as the dock draws it), and the star a rider keeps a
 * place by. Each says in words what it draws, for a screen reader and a hover.
 */
import { Heart } from "lucide-react";
import type { HourWeather } from "../../mcp/api/forecast";
import { presentWeather, skyOf } from "../../force5/src/presentWeather";
import { ChartGlyph } from "../../shared/web/ChartGlyph";
import { skyGlyph } from "../../shared/web/glyphSet";
import { tv } from "../../ui/tv";

const glyph = tv({
  slots: {
    svg: "inline-block shrink-0 overflow-visible align-middle",
    pen: "stroke-pen",
  },
});

/**
 * The sky as the dock draws it, from the glyph set (shared/web/glyphSet.ts):
 * an ink outline with the weather's colour inside, the moon for the sun in a
 * dark hour. Named in words for a screen reader and a hover.
 */
export function SkyGlyph({
  weather,
  size = 18,
  dark = false,
}: {
  weather: HourWeather;
  size?: number;
  /** A dark hour: the moon for the sun. */
  dark?: boolean;
}) {
  const sky = skyOf(weather);
  if (!sky) return null;
  const present = presentWeather(weather.weather_code);
  const words =
    [
      present?.description ??
        (weather.cloud_pct !== null ? `Cloud ${weather.cloud_pct}%` : null),
      (weather.rain_mm ?? 0) >= 0.1 ? `rain ${weather.rain_mm} mm` : null,
    ]
      .filter(Boolean)
      .join(", ") || sky;
  return (
    <ChartGlyph
      glyph={skyGlyph(sky, dark)}
      size={size}
      title={words}
      className={glyph().svg()}
    />
  );
}

/** The heart a rider saves a place by: an outline in ink, filled when saved. */
export function KeepHeart({ on, size = 17 }: { on: boolean; size?: number }) {
  return (
    <Heart
      size={size}
      strokeWidth={1.5}
      fill={on ? "currentColor" : "none"}
      aria-hidden="true"
    />
  );
}
