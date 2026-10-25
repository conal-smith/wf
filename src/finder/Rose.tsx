/**
 * The loupe's ride rose (force5/src/focus.ts), small, on a spot's picture:
 * the headings this rider can hold at the chosen hour. The no-go is hatched,
 * the tack out washed in paper to the rim and the tack home dashed, the
 * offshore winds are the pen's red on the rim, and the wind's needle stands
 * outside it in the wind's colour. Its rim is the loupe's distance, half a
 * nautical mile or a kilometre, wherever the picture says that is.
 *
 * Drawn on paper's lines over the photograph, as the mockup draws it: no
 * words, which at this size would be most of it. The washes stay light, and
 * the no-go's hatching is drawn in screen pixels, a line a pixel wide every
 * few: at a card's size a hatch drawn to the rose's own scale is finer than
 * a pixel and reads as haze, and a picture under a rose that is mostly
 * no-go and tack out (an estuary of flat water) looked washed out beside
 * one of beach and fields.
 */
import { useId } from "react";
import {
  dialDrawing,
  polar,
  roseDrawing,
  type LoupeRose,
} from "../../force5/src/focus";

/** The drawing's own radius: the geometry is worked out at this, then scaled. */
const R = 100;
/** The no-go's hatching, in screen pixels: a line this wide, this far apart. */
const HATCH_LINE = 1;
const HATCH_GAP = 4;
/** Room round the rim for the offshore arc and the needle. */
const MARGIN = 26;
const BOX = R + MARGIN;

/**
 * The loupe's needle, shorter: from just inside the rim to outside it, at
 * the bearing the wind comes from, pointing in.
 */
function needle(from: number) {
  const p = (bearing: number, r: number) =>
    polar(bearing, r)
      .map((v) => v.toFixed(1))
      .join(" ");
  return `M${p(from, R - 14)}L${p(from - 3.4, R + 24)}L${p(from, R + 17)}L${p(from + 3.4, R + 24)}Z`;
}

const line = (l: { x1: number; y1: number; x2: number; y2: number }) => ({
  x1: l.x1,
  y1: l.y1,
  x2: l.x2,
  y2: l.y2,
});

export function Rose({
  loupe,
  r,
  x,
  y,
}: {
  /** The rose for the hour, or null with no wind to draw (only the rim). */
  loupe: LoupeRose | null;
  /** The rim's radius on screen. */
  r: number;
  /** Where the spot is on the picture. */
  x: number;
  y: number;
}) {
  const hatch = `rose-${useId().replace(/[^\w-]/g, "")}`;
  const size = (2 * BOX * r) / R;
  // The drawing's units in a screen pixel.
  const px = R / Math.max(r, 1);
  const rose = loupe ? roseDrawing(loupe.rose, R, null) : null;
  const dial = loupe ? dialDrawing(loupe.rose.windFrom, loupe.facing, R) : null;
  return (
    <svg
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 overflow-visible"
      style={{ left: x, top: y, width: size, height: size }}
      viewBox={`${-BOX} ${-BOX} ${2 * BOX} ${2 * BOX}`}
      aria-hidden="true"
      data-rose
    >
      <defs>
        <pattern
          id={hatch}
          width={HATCH_GAP * px}
          height={HATCH_GAP * px}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            className="stroke-ground"
            x1={0}
            y1={0}
            x2={0}
            y2={HATCH_GAP * px}
            strokeWidth={HATCH_LINE * px}
            strokeOpacity={0.6}
          />
        </pattern>
      </defs>
      <circle
        className="fill-none stroke-ground"
        r={R}
        strokeWidth={6}
        strokeOpacity={0.8}
      />
      <circle className="fill-none stroke-ink" r={R} strokeWidth={2.2} />
      {rose?.nogo && (
        <g data-rose-nogo>
          <path d={rose.nogo.fill} fill={`url(#${hatch})`} />
          {rose.nogo.edges.map((e, i) => (
            <line
              key={i}
              className="stroke-ink"
              {...line(e)}
              strokeWidth={1.8}
              strokeDasharray="5 4"
            />
          ))}
        </g>
      )}
      {rose?.fans.map((fan, i) => (
        <g key={i} data-rose-fan={fan.kind}>
          {fan.fill && (
            <path className="fill-card" d={fan.fill} fillOpacity={0.3} />
          )}
          <path
            className="fill-none stroke-ink"
            d={fan.arc}
            strokeWidth={fan.kind === "out" ? 3.5 : 2.5}
            strokeDasharray={fan.kind === "out" ? undefined : "8 6"}
          />
          {fan.edges.map((e, j) => (
            <line
              key={j}
              className="stroke-ink"
              {...line(e)}
              strokeWidth={2}
              strokeDasharray={fan.kind === "out" ? undefined : "8 6"}
            />
          ))}
        </g>
      ))}
      {dial?.offshore && (
        <path
          className="fill-none stroke-pen"
          d={dial.offshore.arc}
          strokeWidth={6}
          strokeLinecap="round"
          data-rose-offshore
        />
      )}
      {dial && loupe && (
        <path
          className="stroke-ink"
          d={needle(loupe.rose.windFrom)}
          fill={loupe.colour}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      )}
      <circle className="fill-ink stroke-ground" r={5} strokeWidth={2.5} />
    </svg>
  );
}
