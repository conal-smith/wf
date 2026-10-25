/**
 * The small marks a card repeats along its hours and days, drawn as the
 * spot page and the dock draw them: the wind's arrow, pointing where it
 * blows, in the pen's red where it blows off the beach; a tide's turn, an
 * ink dot for high water and a paper one ringed in ink for low (the tide
 * label of design-system/components/tide-label); and a speed in the rider's
 * units, a Beaufort glyph in Force.
 */
import { shoreAngle } from "../../force5/src/stars";
import {
  beaufort,
  isForce,
  speedShort,
  type Units,
} from "../../force5/src/units";
import { BeaufortGlyph } from "../../ui/BeaufortGlyph";

/** The arrow's path, on a 14-unit box round the origin, pointing up. */
export const ARROW_PATH = "M0 5.5V-5.2M-3 -1.8L0 -5.6L3 -1.8";

/** Whether a wind blows off the beach (offshore, or cross-off) at a shore. */
export function offshore(from: number | null, facing: number | null): boolean {
  if (from === null || facing === null) return false;
  const angle = shoreAngle(from, facing);
  return angle === "offshore" || angle === "cross-off";
}

/** The wind's arrow, blowing downwind from `from`; red when it blows off the beach. */
export function ShoreArrow({
  from,
  facing,
  size = 12,
}: {
  from: number;
  facing: number | null;
  size?: number;
}) {
  const off = offshore(from, facing);
  return (
    <svg
      className="inline-block shrink-0 overflow-visible"
      width={size}
      height={size}
      viewBox="-7 -7 14 14"
      aria-hidden="true"
      data-offshore={off || undefined}
    >
      <g transform={`rotate(${Math.round(from + 180)})`}>
        <path
          className={off ? "fill-none stroke-pen" : "fill-none stroke-ink"}
          d={ARROW_PATH}
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

/** A tide's turn: an ink dot for high water, a paper one ringed in ink for low. */
export function TideMark({ high }: { high: boolean }) {
  return (
    <svg
      className="inline-block shrink-0"
      width={7}
      height={7}
      viewBox="-3.5 -3.5 7 7"
      aria-hidden="true"
    >
      <circle
        className={high ? "fill-ink stroke-ink" : "fill-card stroke-ink"}
        r={2.6}
        strokeWidth={1}
      />
    </svg>
  );
}

/**
 * A speed as a figure in the rider's units: "19", or the Beaufort glyph in
 * Force. Decorative: the column says the hour's wind in words.
 */
export function Speed({
  knots,
  units,
  size,
}: {
  knots: number;
  units: Units;
  /** The glyph's size in Force. */
  size: number;
}) {
  return isForce(units) ? (
    <BeaufortGlyph force={beaufort(knots)} size={size} label="" />
  ) : (
    <>{speedShort(knots, units)}</>
  );
}

/**
 * The gust worth writing beside a wind, or null: one over the mean, and in
 * Force one in a higher force than the wind's (the dock's rule).
 */
export function gustShown(
  windKn: number,
  gustKn: number | null,
  units: Units,
): number | null {
  if (gustKn === null || !(gustKn > windKn)) return null;
  if (isForce(units) && beaufort(gustKn) <= beaufort(windKn)) return null;
  return gustKn;
}
