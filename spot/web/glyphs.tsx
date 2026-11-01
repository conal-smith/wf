/**
 * The small marks the spot page draws: the sky (the glyph set's, in the
 * weather's colours, as the dock draws it), and the star a rider keeps a
 * place by. Each says in words what it draws, for a screen reader and a hover.
 */
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

/** The star a rider keeps a place by: an outline in the pen, filled when kept. */
export function KeepStar({ on, size = 17 }: { on: boolean; size?: number }) {
  const s = glyph();
  return (
    <svg
      className={s.svg()}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path
        className={[s.pen(), on ? "fill-pen" : "fill-none"].join(" ")}
        d="M8 1.3 L10 6.1 L15.1 6.5 L11.2 9.8 L12.5 14.8 L8 12.1 L3.6 14.9 L4.8 9.9 L0.9 6.6 L6 6.1 Z"
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
    </svg>
  );
}
