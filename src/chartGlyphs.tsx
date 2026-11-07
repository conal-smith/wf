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

/** Three rules, each with its stop where the rider set it: the options. */
export function OptionsGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M3 6H21M3 12H21M3 18H21" strokeWidth={1} />
      <path d="M14.5 3.5V8.5M7.5 9.5V14.5M16.5 15.5V20.5" strokeWidth={2.4} />
    </Glyph>
  );
}

/** A dotted track from a start to a flag: the tour. */
export function TourGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path
        d="M5 19.5C9 19.5 8.5 14 12 14s3.5-5 6.2-5"
        strokeDasharray="1.2 2.6"
      />
      <path d="M18.2 11V3.2" />
      <path
        d="M18.2 3.4l4 1.8-4 1.8ZM6.7 19.5a1.7 1.7 0 1 1-3.4 0a1.7 1.7 0 1 1 3.4 0"
        fill="currentColor"
        strokeWidth={1}
      />
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

/** The particles: the streaks they leave in ink, one strong, one faint. */
export function ParticlesGlyph(props: ChartGlyphProps) {
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

/**
 * The wind measured: a cup anemometer on its mast, as a weather station
 * stands, its two cups turned to the wind.
 */
export function LiveWindGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M12 21V7.5M8.5 21H15.5M5 7.5H19" />
      <path d="M2.6 7.5a2.4 2.4 0 0 0 4.8 0Z" {...tint(0.55)} />
      <path d="M16.6 7.5a2.4 2.4 0 0 1 4.8 0Z" {...tint(0.55)} />
      <path d="M2.6 7.5a2.4 2.4 0 0 0 4.8 0M16.6 7.5a2.4 2.4 0 0 1 4.8 0" />
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
 * The tidal depth: the water's height over the bottom, measured from the
 * surface to a shelving bed.
 */
export function TidalDepthGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M2.5 6.5C4.5 4.8 6.5 4.8 8.5 6.5S12.5 8.2 14.5 6.5 19 4.8 21.5 6.5" />
      <path d="M2.5 21L21.5 15.5V21Z" {...tint(0.3)} />
      <path d="M2.5 21L21.5 15.5" />
      <path d="M10 9.5V16.6M7.8 11.7L10 9.5L12.2 11.7M7.8 14.6L10 16.8L12.2 14.6" />
    </Glyph>
  );
}

/** A satellite: its body between two panels, slantwise, as it is known. */
function SatelliteMark() {
  return (
    <g transform="rotate(-45 12 9.5)">
      <rect x="9.6" y="6.6" width="4.8" height="5.8" rx="0.8" />
      <path d="M3.2 7.4H7.8V11.6H3.2ZM16.2 7.4H20.8V11.6H16.2ZM7.8 9.5H9.6M14.4 9.5H16.2" />
    </g>
  );
}

/** The satellite image under the chart. */
export function SatelliteGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <SatelliteMark />
      <path d="M4 20.5C6.5 18.8 8.5 18.8 11 20.5" />
    </Glyph>
  );
}

/** The satellite's picture at high water: the sea right up the shore. */
export function HighTideGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <SatelliteMark />
      <path d="M3 20.5C5 19 7 19 9 20.5S13 22 15 20.5 19 19 21 20.5" />
    </Glyph>
  );
}

/** The satellite's picture at low water: the sand bared, in dots. */
export function LowTideGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <SatelliteMark />
      <path d="M3.5 20.5H20.5" strokeDasharray="0 3.4" strokeWidth={2} />
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

/**
 * Rain: a cloud's outline, a light tint of the ink under it where it falls,
 * and the streaks of rain slanting out of it, as a weather map hatches rain.
 */
export function RainGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M7 13.5A3.5 3.5 0 0 1 7.6 6.6 4.6 4.6 0 0 1 16.4 6.2 3.7 3.7 0 0 1 17.2 13.5Z" />
      <path d="M6 15.5L18 15.5 16 22 4 22Z" {...tint(0.14)} />
      <path d="M8.5 16L7 20.5M12.5 16L11 20.5M16.5 16L15 20.5" />
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

/** The loupe: a glass held over the spot, a compass needle in it. */
export function LoupeGlyph(props: ChartGlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="10.5" cy="10.5" r="7.5" />
      <path d="M16 16L21.5 21.5" strokeWidth={2} />
      <path
        d="M12.8 8.2L11.6 11.6L8.2 12.8L9.4 9.4Z"
        fill="currentColor"
        strokeWidth={1}
      />
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
