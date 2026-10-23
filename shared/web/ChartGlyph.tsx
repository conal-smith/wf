/**
 * The glyph set (shared/web/glyphSet.ts), drawn: an ink outline in the text's
 * colour, and the colour inside from the theme where it means something. The
 * map (through src/chartGlyphs.tsx) and the spot page both draw with it, and
 * neither may import the other, so it is shared/web's; the app
 * (mobile/src/components/Glyphs.tsx) reads the same data.
 *
 *   <ChartGlyph glyph={glyphs.blend} size={16} />
 */
import type { CSSProperties } from "react";
import type { GlyphDef, GlyphPaint } from "./glyphSet";
import { glyphStroke } from "./glyphSet";

/** Each paint, from the theme. `wind` is the colour handed in for a speed. */
const PAINT: Record<Exclude<GlyphPaint, "wind">, string> = {
  ink: "currentColor",
  paper: "var(--color-ground)",
  sun: "var(--color-weather-sun)",
  rain: "var(--color-weather-rain)",
  cloud: "var(--color-weather-cloud)",
  night: "var(--color-weather-night)",
  gust: "var(--color-gust)",
  magenta: "var(--color-chart-magenta)",
  pen: "var(--color-pen)",
  depth: "var(--color-depth)",
};

const FACE = { mono: "var(--font-mono)", body: "var(--font-body)" };

/**
 * A glyph from the set, at a size, in the text's colour with its colour
 * inside. `wind` is the colour a speed arrow is filled with. Decorative: the
 * words go on whatever holds it, unless `title` names it.
 */
export interface ChartGlyphProps {
  glyph: GlyphDef;
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** The colour a speed arrow is filled with. */
  wind?: string;
  /** Names the glyph for a screen reader and a hover; else it is hidden. */
  title?: string;
}

export function ChartGlyph({
  glyph,
  size = 20,
  strokeWidth,
  className,
  wind,
  title,
}: ChartGlyphProps) {
  const paint = (p: GlyphPaint | "none" | undefined) =>
    p === undefined
      ? undefined
      : p === "none"
        ? "none"
        : p === "wind"
          ? (wind ?? "currentColor")
          : PAINT[p];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? glyphStroke(size)}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={className ? `g-set ${className}` : "g-set"}
    >
      {title && <title>{title}</title>}
      {glyph.map((part, i) => {
        if ("text" in part)
          return (
            <text
              key={i}
              x={part.x}
              y={part.y}
              textAnchor={part.middle ? "middle" : undefined}
              stroke="none"
              style={{
                fill: paint(part.fill ?? "ink"),
                fontFamily: FACE[part.face],
                fontSize: part.size,
                fontWeight: part.weight,
                fontStyle: part.italic ? "italic" : undefined,
              }}
            >
              {part.text}
            </text>
          );
        const style: CSSProperties = {
          fill: paint(part.fill),
          stroke: paint(part.stroke),
        };
        const common = {
          style,
          strokeWidth: part.width,
          strokeDasharray: part.dash,
          opacity: part.opacity,
        };
        return "d" in part ? (
          <path key={i} d={part.d} {...common} />
        ) : (
          <circle key={i} cx={part.cx} cy={part.cy} r={part.r} {...common} />
        );
      })}
    </svg>
  );
}
