// The winds a shore wants: the runs of compass points whose wind meets a beach
// at the angles wanted, from the same shore rule the stars rate on. The spot
// page's header and dial ("best ENE–ESE, SSW–W") and the forecast server's
// `best_directions` both read them here. Dependency-free apart from the
// shore rule.
import { shoreAngle, type ShoreAngle } from "./stars.js";

/** The sixteen compass points, clockwise from north. */
const COMPASS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];

export interface WindArc {
  /** Compass points at either end, inclusive, clockwise. */
  from: string;
  to: string;
  /** Bearings of the same ends, for the dial. */
  fromDeg: number;
  toDeg: number;
}

/**
 * The runs of compass points, clockwise, whose wind meets the shore at one of
 * `angles`: the arcs the dial paints and the words the header says.
 */
export function windArcs(
  facing: number,
  angles: readonly ShoreAngle[],
): WindArc[] {
  const good = COMPASS.map((_, i) =>
    angles.includes(shoreAngle(i * 22.5, facing)),
  );
  if (good.every(Boolean))
    return [{ from: "N", to: "NNW", fromDeg: 0, toDeg: 337.5 }];
  // Start just after a point that is out, so no arc is cut in two at north.
  const start = good.findIndex((ok) => !ok);
  const arcs: WindArc[] = [];
  let open: number | null = null;
  for (let step = 1; step <= 16; step++) {
    const i = (start + step) % 16;
    if (good[i] && open === null) open = i;
    if ((!good[i] || step === 16) && open !== null) {
      const last = good[i] ? i : (i + 15) % 16;
      arcs.push({
        from: COMPASS[open],
        to: COMPASS[last],
        fromDeg: open * 22.5,
        toDeg: last * 22.5,
      });
      open = null;
    }
  }
  return arcs;
}

/** What the wind wants to be at this shore: cross and cross-on. */
export const goodWindArcs = (facing: number) =>
  windArcs(facing, ["cross-on", "cross"]);

export const arcText = (arc: WindArc) =>
  arc.from === arc.to ? arc.from : `${arc.from}–${arc.to}`;
