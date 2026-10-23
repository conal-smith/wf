/**
 * The chart's parts as glyphs, each drawn the way an Admiralty chart draws
 * the thing itself (INT 1, Chart 5011), so that the icon says "chart" before
 * its name is read: a dotted depth contour with its soundings, a hill in
 * hachures, a light's flare beside its name, a drying height underlined over
 * sand. For the site menu's rows on the map and the layers' switches, and for
 * any feature after them that names a part of the chart (the tidal streams,
 * a survey's lines, the map's key).
 *
 * Single ink: every mark is `currentColor`, on lucide's 24-unit grid at a
 * stroke of 1.5, as src/glyphs.tsx's are, and a tint is the ink at a fraction
 * of its strength rather than a colour of its own. The figures are set in the
 * chart's italic through src/map.css (`.g-fig`). Each is a picture beside its
 * name, so each is hidden from a screen reader.
 *
 * The rest of the set (the weather, the wind and the blend, the dock's rows,
 * the chart's symbols and the app's) is data in shared/web/glyphSet.ts, which
 * the spot page and the app draw from too, drawn by
 * `ChartGlyph` (shared/web/ChartGlyph.tsx), both re-exported here:
 *
 *   import { ChartGlyph, glyphs } from "./chartGlyphs";
 *   <ChartGlyph glyph={glyphs.blend} size={16} />
 *
 * Those carry colour where it means something (the weather's state, the
 * wind's speed, the best, a warning), each from the theme.
 */
import type { ReactNode } from "react";

export { ChartGlyph } from "../shared/web/ChartGlyph";
export * as glyphs from "../shared/web/glyphSet";

export interface ChartGlyphProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

function Glyph({
  size = 20,
  strokeWidth = 1.5,
  className,
  children,
}: ChartGlyphProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ? `g-chart ${className}` : "g-chart"}
    >
      {children}
    </svg>
  );
}

/** A tint: the ink laid thin, as a chart prints its shallow water. */
const tint = (opacity: number) => ({
  fill: "currentColor",
  fillOpacity: opacity,
  stroke: "none",
});

/** A dotted line, as a chart draws a depth contour: round dots, close set. */
const DOTTED = { strokeDasharray: "0 2.6", strokeWidth: 1.7 };

/* ---- the site menu's rows on the chart ---- */

/** Two sheets laid one over the other: the chart's layers. */
export function LayersGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M12 4L21 9L12 14L3 9Z" />
      <path d="M3 13.5L12 18.5L21 13.5" />
    </Glyph>
  );
}

/** The star a rider keeps a spot with, as the dock's star is drawn. */
export function SpotsGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M12 2.5L14.7 8.9L21.5 9.4L16.3 13.8L18 20.5L12 16.9L6.1 20.6L7.7 13.9L2.5 9.5L9.3 8.9Z" />
    </Glyph>
  );
}

/** Three rules, each with its stop where the rider set it: the options. */
export function OptionsGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M3 6H21M3 12H21M3 18H21" strokeWidth={1} />
      <path d="M14.5 3.5V8.5M7.5 9.5V14.5M16.5 15.5V20.5" strokeWidth={2.4} />
    </Glyph>
  );
}

/** The chart's note: an "i" in a ring, for what the map's marks mean. */
export function AboutGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11V17" />
      <circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/* ---- the map's information ---- */

/** A star inked in: the rating, as the dock and the lights give it. */
export function StarGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path
        d="M12 2.5L14.7 8.9L21.5 9.4L16.3 13.8L18 20.5L12 16.9L6.1 20.6L7.7 13.9L2.5 9.5L9.3 8.9Z"
        fill="currentColor"
      />
    </Glyph>
  );
}

/**
 * The sources: a chart's source diagram, the sheet ruled into the surveys
 * it was compiled from.
 */
export function SourcesGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4 3H20V21H4Z" />
      <path d="M4 10H13V21M13 14H20" strokeWidth={1} />
      <path d="M6.5 6H17.5" strokeWidth={1} strokeOpacity={0.6} />
    </Glyph>
  );
}

/* ---- the wind ---- */

/** The wind in ink: the streaks the particles leave, one strong, one faint. */
export function InkWindGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M3 14C8 12.5 13 8.5 21 6.5" />
      <path
        d="M5 19C10 17.5 14 14.5 19 13.5"
        strokeWidth={1}
        strokeOpacity={0.5}
      />
    </Glyph>
  );
}

/** Arrows blowing downwind, longer as the wind is stronger. */
export function ArrowsWindGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M3 11L7.5 6.5M4.5 6.5H7.5V9.5" />
      <path d="M11 12L19 4M15.5 4H19V7.5" />
      <path d="M5 21L11 15M7.8 15H11V18.2" />
    </Glyph>
  );
}

/**
 * The wind laid over the water as a colour: a feathered wind arrow over a
 * tint, its feathers at the tail as a chart's wind arrow is drawn.
 */
export function ColouredWindGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M2 9C7 7 11 11 16 9S21 8 22 8.5V22H2Z" {...tint(0.18)} />
      <path d="M2 15C7 13 11 17 16 15S21 14 22 14.5V22H2Z" {...tint(0.18)} />
      <path d="M5 19L19 5M14.6 5H19V9.4" />
      <path d="M5 19L3.4 14.6M7 17L5.4 12.6" strokeWidth={1.2} />
    </Glyph>
  );
}

/* ---- the chart ---- */

/**
 * The depth tints: bands of tint off the shore, stepped where the contours
 * step and paling as the water deepens, with a drying height underlined in
 * the shallowest.
 */
export function TintsGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M3 4H21V10H15V13H9V15H3Z" {...tint(0.4)} />
      <path d="M3 15H9V13H15V10H21V17H13V19H3Z" {...tint(0.18)} />
      <path d="M3 4H21" />
      <text className="g-fig" x="4.5" y="11.5">
        2
      </text>
      <path d="M4.4 12.6H8" strokeWidth={1} />
    </Glyph>
  );
}

/** A dotted depth contour, and the soundings either side in small italics. */
export function SoundingsGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M2.5 12.5C6.5 8.5 10 15 14 11.5S19.5 8 21.5 9" {...DOTTED} />
      <text className="g-fig" x="3.5" y="8">
        4
      </text>
      <text className="g-fig" x="14.5" y="7">
        7
      </text>
      <text className="g-fig" x="5" y="20.5">
        12
      </text>
      <text className="g-fig" x="17" y="19.5">
        9
      </text>
    </Glyph>
  );
}

/** A hill in its land contours, as a chart draws high ground, its summit spotted. */
export function ReliefGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M2.5 18C2.5 13.5 5.5 11 8.5 11.2S10.5 5.5 15 5.2 21.5 8.5 21 13 18.5 19.5 13 19 3 21 2.5 18Z" />
      <path
        d="M9.5 15C9.3 13 11.5 12.5 12.5 11.5S14.5 8.5 16.5 9.2 18.6 12 17.6 14.3 15 16.4 12.8 16.3 9.7 16.4 9.5 15Z"
        strokeWidth={1.1}
      />
      <circle cx="15" cy="12.4" r="1" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** A light: its dot and its flare, as a chart marks one, beside its name. */
export function NamesGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M5 20L8.2 6.4A3 3 0 0 1 13.4 8.6Z" {...tint(0.35)} />
      <path d="M5 20L8.2 6.4A3 3 0 0 1 13.4 8.6Z" strokeWidth={1.2} />
      <circle cx="5" cy="20" r="1.6" fill="currentColor" stroke="none" />
      <path d="M14.5 15H21.5M14.5 18.5H19.5" />
    </Glyph>
  );
}

/**
 * The tidal depth: a drying height, underlined as a chart sets one, over the
 * stipple of sand the tide covers and uncovers.
 */
export function TidalDepthGlyph(props: ChartGlyphProps) {
  const sand = [
    [4, 16],
    [8, 15.5],
    [12, 16.5],
    [16, 15.5],
    [20, 16],
    [6, 19],
    [10, 18.5],
    [14, 19.5],
    [18, 18.5],
    [4, 21.5],
    [8, 21.5],
    [12, 21],
    [16, 21.5],
    [20, 21],
  ];
  return (
    <Glyph {...props}>
      <text className="g-fig g-fig-lg" x="9" y="11">
        2
      </text>
      <path d="M8.5 12.6H15" />
      {sand.map(([x, y]) => (
        <circle
          key={`${x} ${y}`}
          cx={x}
          cy={y}
          r="0.75"
          fill="currentColor"
          stroke="none"
        />
      ))}
    </Glyph>
  );
}

/** A photograph inset on the chart: its double frame, the coast within. */
export function SatelliteGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="2.5" y="4" width="19" height="16" />
      <rect x="4.5" y="6" width="15" height="12" strokeWidth={0.9} />
      <path
        d="M4.5 13C7 12 8 9 11 9.5S14 13 16.5 12.5 19.5 10 19.5 10V18H4.5Z"
        {...tint(0.3)}
      />
    </Glyph>
  );
}

/** High water: the tide curve's crest, dotted solid. */
export function HighTideGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M2 17C6 17 8 8 12 8S18 17 22 17" />
      <circle cx="12" cy="8" r="2.6" fill="currentColor" />
    </Glyph>
  );
}

/** Low water: the curve's trough, dotted open. */
export function LowTideGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M2 7C6 7 8 16 12 16S18 7 22 7" />
      <circle cx="12" cy="16" r="2.6" />
    </Glyph>
  );
}

/**
 * A flood tidal stream: the feathered arrow a chart sets the flood with, and
 * its rate in knots beside it.
 */
export function CurrentsGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M3 17L17 7M12.6 6.8H17V11.2" />
      <path
        d="M3 17L2.6 13.4M5.6 15.1L5.2 11.5M8.2 13.3L7.8 9.7"
        strokeWidth={1.2}
      />
      <text className="g-fig" x="13" y="21">
        2
      </text>
    </Glyph>
  );
}

/** A survey's lines: tracks run side by side, a sounding at every step. */
export function SurveyGlyph(props: ChartGlyphProps) {
  const lines = [6, 12, 18];
  return (
    <Glyph {...props}>
      {lines.map((y) => (
        <path key={y} d={`M3 ${y}H21`} strokeWidth={0.8} strokeOpacity={0.6} />
      ))}
      {lines.flatMap((y, row) =>
        [4, 8, 12, 16, 20].map((x) => (
          <circle
            key={`${x} ${y}`}
            cx={x + (row % 2) * 1}
            cy={y}
            r="1"
            fill="currentColor"
            stroke="none"
          />
        )),
      )}
    </Glyph>
  );
}

/* ---- round the chosen spot ---- */

/** The loupe: a compass rose, north marked, the light at its heart. */
export function LoupeGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3V5.5M21 12H18.5M12 21V18.5M3 12H5.5" strokeWidth={1.1} />
      <path
        d="M12 4.5L13.6 12L12 10.6L10.4 12Z"
        fill="currentColor"
        strokeWidth={1}
      />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** The range ring: a dashed ring at a distance round the light. */
export function RingGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9" strokeDasharray="2.4 2.2" />
      <path d="M12 2V5M12 19V22M2 12H5M19 12H22" strokeWidth={1.1} />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </Glyph>
  );
}
