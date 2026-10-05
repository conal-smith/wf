/**
 * The small marks the spot page repeats on every row, drawn as the chart
 * draws them: thin ink strokes on paper. The wind's arrow, the wind against
 * the beach, the way the beach faces, the sky, and the star a rider keeps a
 * place by. Each says in words what it draws, for a screen reader and a hover.
 */
import type { HourWeather } from "../../mcp/api/forecast";
import { SHORE_LABEL, shoreAngle } from "../../force5/src/stars";
import { presentWeather } from "../../force5/src/surface";
import { tv } from "../../ui/tv";
import { compass } from "./spot";

const glyph = tv({
  slots: {
    svg: "inline-block shrink-0 overflow-visible align-middle",
    stroke: "fill-none stroke-ink",
    warn: "fill-none stroke-pen",
    fill: "fill-ink",
    paper: "fill-card stroke-ink",
    land: "fill-land",
    sea: "fill-depth",
    rain: "fill-none stroke-depth",
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

type Sky = "clear" | "partly" | "cloudy" | "rain" | "fog" | "thunder" | "snow";

/** The sky in one word, from the model's present weather or its cloud and rain. */
export function skyOf(weather: HourWeather): Sky | null {
  const present = presentWeather(weather.weather_code);
  if (present) {
    const icon = present.icon as string;
    if (icon === "drizzle" || icon === "showers" || icon === "rain")
      return "rain";
    if (icon === "clear" || icon === "partly" || icon === "cloudy") {
      if ((weather.rain_mm ?? 0) >= 0.3) return "rain";
      return icon;
    }
    if (icon === "fog" || icon === "thunder" || icon === "snow") return icon;
  }
  if ((weather.rain_mm ?? 0) >= 0.3) return "rain";
  if (weather.cloud_pct === null) return null;
  return weather.cloud_pct < 25
    ? "clear"
    : weather.cloud_pct < 70
      ? "partly"
      : "cloudy";
}

const SUN_RAYS =
  "M0 -6.2V-5M0 5V6.2M-6.2 0H-5M5 0H6.2M-4.4 -4.4L-3.6 -3.6M3.6 3.6L4.4 4.4M-4.4 4.4L-3.6 3.6M3.6 -3.6L4.4 -4.4";
const CLOUD =
  "M-6 3 H5.5 A3 3 0 0 0 5 -2.8 A4.2 4.2 0 0 0 -3 -3.2 A3.2 3.2 0 0 0 -6 3Z";

/** The sky as a weather report draws it: sun, sun and cloud, cloud, rain… */
export function SkyGlyph({
  weather,
  size = 18,
}: {
  weather: HourWeather;
  size?: number;
}) {
  const s = glyph();
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
  const sun = (
    <g strokeWidth={1.1} strokeLinecap="round">
      <circle className={s.paper()} r={3.4} />
      <path className={s.stroke()} d={SUN_RAYS} />
    </g>
  );
  const cloud = (x: number, y: number, k = 1) => (
    <path
      className={s.paper()}
      transform={`translate(${x} ${y}) scale(${k})`}
      d={CLOUD}
      strokeWidth={1.1}
      strokeLinejoin="round"
    />
  );
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
      {sky === "clear" && sun}
      {sky === "partly" && (
        <>
          <g transform="translate(-2.4 -2.2) scale(.8)">{sun}</g>
          {cloud(2, 2.4, 0.85)}
        </>
      )}
      {sky === "cloudy" && cloud(0, 0)}
      {(sky === "rain" || sky === "thunder" || sky === "snow") && (
        <>
          {cloud(0, -1.5)}
          {sky === "rain" && (
            <path
              className={s.rain()}
              d="M-3 4.5L-4 7.5M0.5 4.5L-0.5 7.5M4 4.5L3 7.5"
              strokeWidth={1.2}
              strokeLinecap="round"
            />
          )}
          {sky === "thunder" && (
            <path
              className={s.stroke()}
              d="M0.5 3.6L-1.5 6.4H1L-0.6 8.8"
              strokeWidth={1.1}
              strokeLinejoin="round"
            />
          )}
          {sky === "snow" && (
            <g className={s.fill()}>
              <circle cx={-3} cy={6} r={0.8} />
              <circle cx={0.5} cy={7.2} r={0.8} />
              <circle cx={4} cy={6} r={0.8} />
            </g>
          )}
        </>
      )}
      {sky === "fog" && (
        <path
          className={s.stroke()}
          d="M-6.5 -3H6.5M-5 0.5H5M-6.5 4H6.5"
          strokeWidth={1.2}
          strokeLinecap="round"
        />
      )}
    </svg>
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
