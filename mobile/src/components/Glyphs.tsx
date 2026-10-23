/**
 * The chart's small glyphs, drawn as the site draws them (src/glyphs.tsx,
 * src/WeatherGlyph.tsx): an arrow blowing downwind, the red star a rider keeps
 * a spot with, and the site's glyph set (shared/web/glyphSet.ts, `SetGlyph`): the
 * rows' glyphs and the sky, an ink outline with the weather's colour inside.
 * Each draws into its own <Svg>, or as a group (`*Mark`) into a larger one,
 * so a row of a hundred hours is one drawing rather than a hundred.
 */
import { memo } from "react";
import { Pressable, StyleSheet } from "react-native";
import Svg, { Circle, G, Path, Text as SvgText } from "react-native-svg";
import type { WeatherIcon } from "../../../force5/src/surface";
import * as glyphs from "../../../shared/web/glyphSet";
import { glyphStroke, skyGlyph, type GlyphDef, type GlyphPaint } from "../../../shared/web/glyphSet";
import { colors, fonts, hitTarget } from "../theme/tokens";
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

/** Each paint of the glyph set (shared/web/glyphSet.ts), from the theme; `ink` is the glyph's colour. */
const PAINT: Record<Exclude<GlyphPaint, "ink" | "wind">, string> = {
  paper: colors.paper,
  sun: colors.weatherSun,
  rain: colors.weatherRain,
  cloud: colors.weatherCloud,
  night: colors.weatherNight,
  gust: colors.gust,
  magenta: colors.magenta,
  pen: colors.pen,
  depth: colors.depth,
};

/**
 * A glyph from the site's set (shared/web/glyphSet.ts), drawn as the site's
 * `ChartGlyph` draws it: an ink outline in `color`, the weather's colour
 * inside. `wind` fills a speed arrow. Decorative: the words go on whatever
 * holds it.
 */
export const SetGlyph = memo(function SetGlyph({
  glyph,
  size = 14,
  color = colors.ink,
  strokeWidth,
  wind,
}: StrokeProps & { glyph: GlyphDef; wind?: string }) {
  const paint = (p: GlyphPaint | "none" | undefined, fallback: string) =>
    p === undefined ? fallback : p === "none" ? "none" : p === "ink" ? color : p === "wind" ? (wind ?? color) : PAINT[p];
  const width = strokeWidth ?? glyphStroke(size);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      {glyph.map((part, i) => {
        if ("text" in part)
          return (
            <SvgText
              key={i}
              x={part.x}
              y={part.y}
              fontSize={part.size}
              fontFamily={part.face === "mono" ? fonts.monoBold : part.italic ? fonts.bodyItalic : fonts.body}
              textAnchor={part.middle ? "middle" : undefined}
              fill={paint(part.fill, color)}
            >
              {part.text}
            </SvgText>
          );
        const common = {
          fill: paint(part.fill, "none"),
          stroke: paint(part.stroke, color),
          strokeWidth: part.width ?? width,
          strokeDasharray: part.dash,
          strokeLinecap: "round" as const,
          strokeLinejoin: "round" as const,
          opacity: part.opacity,
        };
        return "d" in part ? (
          <Path key={i} d={part.d} {...common} />
        ) : (
          <Circle key={i} cx={part.cx} cy={part.cy} r={part.r} {...common} />
        );
      })}
    </Svg>
  );
});

/** A wing: the leading edge's arc and the strut across it. */
export const WingGlyph = (props: StrokeProps) => <SetGlyph {...props} glyph={glyphs.wing} />;

/** A thermometer standing in a wave, for the sea's temperature. */
export const SeaTempGlyph = (props: StrokeProps) => <SetGlyph {...props} glyph={glyphs.seaTemp} />;

/** The wind's row: three streams. */
export const WindGlyph = (props: StrokeProps) => <SetGlyph {...props} glyph={glyphs.wind} />;

/** Where the wind goes, in its ring. */
export const DirectionGlyph = (props: StrokeProps) => <SetGlyph {...props} glyph={glyphs.direction} />;

/** Waves: two crests over the sea's line. */
export const WavesGlyph = (props: StrokeProps) => <SetGlyph {...props} glyph={glyphs.waves} />;

/** The air's temperature: a thermometer, its bulb full. */
export const ThermometerGlyph = (props: StrokeProps) => <SetGlyph {...props} glyph={glyphs.air} />;

/** Rain, in millimetres: a drop in rain's blue. */
export const DropGlyph = (props: StrokeProps) => <SetGlyph {...props} glyph={glyphs.drop} />;

/** One shape per present-weather group, the weather's colour inside; the moon for the sun after dark. */
export const SkyGlyph = memo(function SkyGlyph({
  icon,
  dark,
  ...props
}: StrokeProps & { icon: WeatherIcon; dark?: boolean }) {
  return <SetGlyph {...props} glyph={skyGlyph(icon, dark)} />;
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
