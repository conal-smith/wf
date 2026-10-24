/**
 * The small marks the spot page repeats on every row, drawn as the chart
 * draws them: thin ink strokes on paper. The wind's arrow, the wind against
 * the beach, the way the beach faces, the sky (the glyph set's, in the
 * weather's colours, as the dock draws it), and the star a rider keeps a
 * place by. Each says in words what it draws, for a screen reader and a hover.
 */
import type { HourWeather } from "../../mcp/api/forecast";
import { SHORE_LABEL, shoreAngle } from "../../force5/src/stars";
import { presentWeather, type WeatherIcon } from "../../force5/src/surface";
import { ChartGlyph } from "../../shared/web/ChartGlyph";
import { skyGlyph } from "../../shared/web/glyphSet";
import { BeaufortGlyph } from "../../ui/BeaufortGlyph";
import { tv } from "../../ui/tv";
import { beaufort, type Units } from "../../force5/src/units";
import { compass, windIn } from "./spot";

const glyph = tv({
  slots: {
    svg: "inline-block shrink-0 overflow-visible align-middle",
    stroke: "fill-none stroke-ink",
    warn: "fill-none stroke-pen",
    paper: "fill-card stroke-ink",
    land: "fill-land",
    sea: "fill-depth",
    pen: "stroke-pen",
  },
});

/**
 * Where the wind goes, for a bearing it comes FROM: wind from the north points
 * down the page. Decorative: the compass point beside it says it.
 */
export function WindArrow({
  from,
  size = 14,
}: {
  from: number;
  size?: number;
}) {
  const s = glyph();
  return (
    <svg
      className={s.svg()}
      width={size}
      height={size}
      viewBox="-7 -7 14 14"
      aria-hidden="true"
    >
      <g transform={`rotate(${Math.round(from + 180)})`}>
        <path
          className={s.stroke()}
          d="M0 5.5V-5.2M-3 -1.8L0 -5.6L3 -1.8"
          strokeWidth={1.3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

/**
 * The wind against the beach: the shore along the bottom, land below it, and
 * the wind's arrow turned to how it meets it. In the pen's red when it blows
 * off the beach.
 */
export function ShoreGlyph({
  from,
  facing,
  size = 18,
}: {
  from: number;
  facing: number;
  size?: number;
}) {
  const s = glyph();
  const angle = shoreAngle(from, facing);
  const away = angle === "cross-off" || angle === "offshore";
  const words = SHORE_LABEL[angle];
  return (
    <svg
      className={s.svg()}
      width={size}
      height={size}
      viewBox="-9 -9 18 18"
      role="img"
      aria-label={words}
    >
      <title>{words}</title>
      <rect className={s.land()} x={-8.5} y={4.2} width={17} height={4.6} />
      <path className={s.stroke()} d="M-8.5 4.2H8.5" strokeWidth={1.1} />
      <g
        transform={`translate(0 -2.2) rotate(${Math.round(from - facing + 180)})`}
      >
        <path
          className={away ? s.warn() : s.stroke()}
          d="M0 5V-5.2M-2.6 -2.3L0 -5.5L2.6 -2.3"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

/** The way the beach faces: a dial with the sea's wedge and the shoreline. */
export function FacingGlyph({
  facing,
  size = 20,
}: {
  facing: number;
  size?: number;
}) {
  const s = glyph();
  const words = `Beach faces ${compass(facing)}, ${Math.round(facing)}°`;
  return (
    <svg
      className={s.svg()}
      width={size}
      height={size}
      viewBox="-10 -10 20 20"
      role="img"
      aria-label={words}
    >
      <title>{words}</title>
      <circle className={s.paper()} r={8.8} strokeWidth={0.9} />
      <path className={s.stroke()} d="M0 -8.8V-6.4" strokeWidth={1.3} />
      <g transform={`rotate(${Math.round(facing)})`}>
        <path className={s.sea()} d="M0 -7.6L3.1 .2H-3.1Z" />
        <path
          className={s.stroke()}
          d="M-5.2 3H5.2"
          strokeWidth={1.7}
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/**
 * The sky as a present-weather group, from the model's code, or from its
 * cloud and rain where it gives no code. A clear or cloudy code over rain the
 * model still counts is rain.
 */
export function skyOf(weather: HourWeather): WeatherIcon | null {
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

/**
 * A wind in the reader's units, as a row writes it: the figure, or in Force
 * the old charts' glyph beside the force. `small` for a gust written after
 * it. The glyph names its force for a screen reader ("Force 5").
 */
export function WindValue({
  knots,
  units,
  small = false,
}: {
  knots: number;
  units: Units;
  small?: boolean;
}) {
  return units === "bft" ? (
    <BeaufortGlyph force={beaufort(knots)} size={small ? 10 : 17} />
  ) : (
    <>{windIn(knots, units)}</>
  );
}
