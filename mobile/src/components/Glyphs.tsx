/**
 * The chart's small glyphs, drawn as the site draws them (src/glyphs.tsx,
 * src/WeatherGlyph.tsx): an arrow blowing downwind, the red star a rider keeps
 * a spot with, a wing, the sea's thermometer, and nine shapes for the sky.
 * Each draws into its own <Svg>, or as a group (`*Mark`) into a larger one,
 * so a row of a hundred hours is one drawing rather than a hundred.
 */
import { memo } from "react";
import { Pressable, StyleSheet } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import type { WeatherIcon } from "../../../force5/src/surface";
import { colors, hitTarget } from "../theme/tokens";
import { tick } from "./haptics";

/** The arrow, in a 14-unit box centred on 0,0, pointing down before it is turned. */
export const ARROW_PATH = "M0 5.5V-5.2M-3 -1.8L0 -5.6L3 -1.8";

/** An arrow blowing downwind for a wind from `from` degrees, at x,y in a larger drawing. */
export function ArrowMark({
  from,
  x,
  y,
  size = 13,
  color = colors.ink,
}: {
  from: number;
  x: number;
  y: number;
  size?: number;
  color?: string;
}) {
  const s = size / 14;
  return (
    <G transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(3)}) rotate(${Math.round(from + 180)})`}>
      <Path
        d={ARROW_PATH}
        fill="none"
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </G>
  );
}

/** The arrow on its own. Decorative: the words go on whatever holds it. */
export const WindArrow = memo(function WindArrow({
  from,
  size = 13,
  color = colors.ink,
}: {
  from: number;
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="-7 -7 14 14" accessible={false}>
      <G rotation={Math.round(from + 180)}>
        <Path
          d={ARROW_PATH}
          fill="none"
          stroke={color}
          strokeWidth={1.3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G>
    </Svg>
  );
});

/** The site's star, solid and faded, on its 12 box (ui/StarGlyphs.tsx). */
export const STAR_PATH =
  "M0,-5 L1.47,-2.02 4.76,-1.55 2.38,0.77 2.94,4.05 0,2.5 -2.94,4.05 -2.38,0.77 -4.76,-1.55 -1.47,-2.02Z";

/**
 * An hour's stars into a larger drawing, centred on cx,cy: solid, then faded
 * to the potential, and nothing past it, as the dock's narrow cells draw them
 * (`slots="potential"`). No stars at all is a single dot.
 */
export function StarsMark({
  stars,
  potential,
  cx,
  cy,
  size,
  ink = colors.ink,
}: {
  stars: number;
  potential: number;
  cx: number;
  cy: number;
  size: number;
  ink?: string;
}) {
  const slots = Math.max(1, potential);
  const step = size * 1.08;
  const left = cx - (step * (slots - 1)) / 2;
  const scale = size / 12;
  if (!potential)
    return <Circle cx={cx} cy={cy} r={Math.max(1, size * 0.12)} fill={colors.ink} opacity={0.3} />;
  return (
    <G>
      {Array.from({ length: slots }, (_, i) => (
        <G key={i} transform={`translate(${(left + i * step).toFixed(1)} ${(cy + 0.4 * scale).toFixed(1)}) scale(${scale.toFixed(3)})`}>
          {i < stars ? (
            <Path d={STAR_PATH} fill={ink} />
          ) : (
            <Path
              d={STAR_PATH}
              fill="none"
              stroke={colors.ink}
              strokeWidth={0.95}
              strokeLinejoin="round"
              opacity={0.5}
            />
          )}
        </G>
      ))}
    </G>
  );
}

const KEEP_STAR =
  "M8 1.3 L10 6.1 L15.1 6.5 L11.2 9.8 L12.5 14.8 L8 12.1 L3.6 14.9 L4.8 9.9 L0.9 6.6 L6 6.1 Z";

/** The red star a rider keeps a spot with, filled once it is kept. */
export function KeepStarGlyph({ on, size = 19 }: { on: boolean; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" accessible={false}>
      <Path
        d={KEEP_STAR}
        fill={on ? colors.pen : "none"}
        stroke={on ? colors.pen : colors.ink}
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** The star as a 44-point button: "Star Inch Strand" / "Unstar Inch Strand". */
export const StarToggle = memo(function StarToggle({
  on,
  name,
  onToggle,
  size = 19,
}: {
  on: boolean;
  name: string;
  onToggle: () => void;
  size?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${on ? "Unstar" : "Star"} ${name}`}
      accessibilityState={{ selected: on }}
      accessibilityHint={on ? "Takes it off your spots" : "Keeps it on your spots"}
      hitSlop={Math.max(0, (hitTarget - size) / 2)}
      onPress={() => {
        tick();
        onToggle();
      }}
      style={({ pressed }) => [styles.star, pressed && styles.pressed]}
    >
      <KeepStarGlyph on={on} size={size} />
    </Pressable>
  );
});

interface StrokeProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

function Stroke({ size = 14, color = colors.ink, strokeWidth = 1.6, d }: StrokeProps & { d: string[] }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      {d.map((path) => (
        <Path
          key={path}
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}

/** A wing: the leading edge's arc and the strut across it. */
export const WingGlyph = (props: StrokeProps) => (
  <Stroke {...props} d={["M3 17C6 8 13 4 21 5C17 9 12 14 3 17Z", "M7 14L17 7"]} />
);

/** A thermometer standing in a wave, for the sea's temperature. */
export const SeaTempGlyph = (props: StrokeProps) => (
  <Stroke
    {...props}
    d={[
      "M12 3a2 2 0 0 0-2 2v7.3a3.5 3.5 0 1 0 4 0V5a2 2 0 0 0-2-2Z",
      "M2 21c2-1.3 3.3-1.3 5 0s3 1.3 5 0 3.3-1.3 5 0 3 1.3 5 0",
    ]}
  />
);

/** The wind's row: three streams. */
export const WindGlyph = (props: StrokeProps) => (
  <Stroke
    {...props}
    d={["M3 8h10a3 3 0 1 0-3-3", "M3 12h15a3 3 0 1 1-3 3", "M3 16h7"]}
  />
);

/** Where the wind goes: an arrowhead. */
export const DirectionGlyph = (props: StrokeProps) => (
  <Stroke {...props} d={["M12 2 19 21 12 17 5 21Z"]} />
);

/** Waves: two crests. */
export const WavesGlyph = (props: StrokeProps) => (
  <Stroke
    {...props}
    d={[
      "M2 9c2-1.3 3.3-1.3 5 0s3 1.3 5 0 3.3-1.3 5 0 3 1.3 5 0",
      "M2 15c2-1.3 3.3-1.3 5 0s3 1.3 5 0 3.3-1.3 5 0 3 1.3 5 0",
    ]}
  />
);

/** The air's temperature: a thermometer. */
export const ThermometerGlyph = (props: StrokeProps) => (
  <Stroke {...props} d={["M14 4v10.5a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"]} />
);

const CLOUD = "M7.5 18h9a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.6 10.7 3.7 3.7 0 0 0 7.5 18Z";
const CLOUD_HIGH = "M7.5 14h9a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.6 6.7 3.7 3.7 0 0 0 7.5 14Z";
const SMALL_SUN = [
  "M8 7.5a2.5 2.5 0 1 0 0 .01",
  "M8 2.5v1M3 7.5h1M4.5 4l.7.7M11.5 4l-.7.7",
];

const SKY: Record<WeatherIcon, string[]> = {
  clear: [
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  ],
  partly: [...SMALL_SUN, "M9.5 20h8a3.5 3.5 0 0 0 .5-6.96A4.8 4.8 0 0 0 9 13.3 3.2 3.2 0 0 0 9.5 20Z"],
  cloudy: [CLOUD],
  fog: [CLOUD_HIGH, "M4 18h16M6 21h12"],
  drizzle: [CLOUD_HIGH, "M8 18v.5M12 19v.5M16 18v.5M10 21.5v.5M14 21.5v.5"],
  rain: [CLOUD_HIGH, "M8 17l-1 4M12 17l-1 4M16 17l-1 4"],
  showers: [...SMALL_SUN, "M9.5 16h8a3.5 3.5 0 0 0 .5-6.96A4.8 4.8 0 0 0 9 9.3 3.2 3.2 0 0 0 9.5 16Z", "M11 19l-.8 3M15 19l-.8 3"],
  thunder: [CLOUD_HIGH, "M13 14l-3 4.5h4L11 23"],
  snow: ["M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9", "M10 4.5l2 1.5 2-1.5M10 19.5l2-1.5 2 1.5"],
};

/** One shape per present-weather group, in the row's ink. Its words go on the cell. */
export const SkyGlyph = memo(function SkyGlyph({ icon, ...props }: StrokeProps & { icon: WeatherIcon }) {
  return <Stroke {...props} d={SKY[icon]} />;
});

/** A chevron, up or down, for a fold. */
export const Chevron = ({ up, size = 14, color = colors.ink }: { up: boolean; size?: number; color?: string }) => (
  <Svg width={size} height={(size * 9) / 14} viewBox="0 0 14 9" accessible={false}>
    <Path
      d={up ? "M1 7.5L7 1.5L13 7.5" : "M1 1.5L7 7.5L13 1.5"}
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const styles = StyleSheet.create({
  star: { alignItems: "center", justifyContent: "center", minWidth: hitTarget, minHeight: hitTarget },
  pressed: { opacity: 0.6 },
});
