/**
 * The wedge a light shows: the headings this rider can hold, at this hour's
 * wind, on the tack that heads out to sea, cut off at the beach.
 *
 * How high a wing foiler points and how deep they go downwind depends on how
 * good they are and how well powered: nobody points just off the foil, and
 * bearing away gets hard when overpowered. The wind side comes from the
 * rider's own band and rideable wind (./stars), so the wedge and the stars
 * agree on what the hour is; the band already assumes the wing we would
 * recommend, so the rider's quiver is not read here.
 *
 * The angles are rough guides from riding, not measurements, and gear moves
 * them as much as skill does: the wedge says "about here", not a polar. They
 * are the headings a session is ridden on, back and forth across the wind,
 * not the deepest a rider could bear away. Centred a little upwind of
 * across, and never past 110° off: a wedge reaching 135° and more told a
 * rider to run downwind, where a session ends a long walk from where it
 * began.
 */
import { rideableWind, windBand, type Rider, type Skill } from "./stars";

/** Degrees off the true wind: [highest upwind, deepest downwind]. */
type Range = readonly [number, number];

/** Powered up, in the sweet spot. */
const BEST: Record<Skill, Range> = {
  beginner: [85, 105],
  intermediate: [60, 105],
  advanced: [45, 110],
};
/** Just foiling, at the band's floor: nobody points, and nobody runs off. */
const AT_FLOOR: Record<Skill, Range> = {
  beginner: [95, 102],
  intermediate: [85, 100],
  advanced: [75, 105],
};
/** At the band's top: a little worse upwind, and less off the wind. */
const AT_TOP: Record<Skill, Range> = {
  beginner: [90, 104],
  intermediate: [68, 104],
  advanced: [48, 108],
};

export type WedgeState = "building" | "sweet" | "overpowered" | "over";

export interface Wedge {
  /** Compass bearings the wedge spans, clockwise from `from` to `to`. */
  from: number;
  to: number;
  /** 0.45 just foiling, 1 in the sweet spot, down to 0.75 at the band's top. */
  power: number;
  state: WedgeState;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);
const norm = (d: number) => ((d % 360) + 360) % 360;
const mix = (a: Range, b: Range, t: number): Range => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
];

/** What the rider can hold at a rideable wind, or null below their floor. */
export function rideRange(
  rider: Rider,
  rideKn: number,
): { range: Range; power: number; state: WedgeState } | null {
  const band = windBand(rider);
  const { skill } = rider;
  if (!(rideKn >= band.min)) return null;
  if (rideKn < band.sweetLow) {
    const t = ease((rideKn - band.min) / (band.sweetLow - band.min));
    return {
      range: mix(AT_FLOOR[skill], BEST[skill], t),
      power: lerp(0.45, 1, t),
      state: "building",
    };
  }
  if (rideKn <= band.sweetHigh)
    return { range: BEST[skill], power: 1, state: "sweet" };
  const t = ease(
    clamp((rideKn - band.sweetHigh) / (band.max - band.sweetHigh), 0, 1),
  );
  return {
    range: mix(BEST[skill], AT_TOP[skill], t),
    power: lerp(1, 0.75, t),
    state: rideKn > band.max ? "over" : "overpowered",
  };
}

/** The part of a clockwise span within 90° of `facing`, or null. */
function clipToSea(
  a: number,
  b: number,
  facing: number,
): [number, number] | null {
  const lo = norm(a - facing + 180) - 180;
  for (const shift of [0, -360]) {
    const x = Math.max(lo + shift, -90);
    const y = Math.min(lo + shift + (b - a), 90);
    // A sliver a few degrees wide is a heading along the beach, not out.
    if (y - x >= 10) return [norm(facing + x), norm(facing + x) + (y - x)];
  }
  return null;
}

/**
 * The wedge for an hour: null at night, below the rider's floor, where the
 * spot's facing is not known, or where nothing the rider can hold heads out
 * to sea (an onshore wind for a learner).
 */
export function rideWedge(
  rider: Rider,
  windKn: number | null,
  gustKn: number | null,
  windFrom: number | null,
  facing: number | null,
): Wedge | null {
  if (windKn === null || windFrom === null || facing === null) return null;
  const ride = rideRange(rider, rideableWind(windKn, gustKn, rider));
  if (!ride) return null;
  const [up, down] = ride.range;
  const tacks = [
    clipToSea(windFrom + up, windFrom + down, facing),
    clipToSea(windFrom - down, windFrom - up, facing),
  ].filter((t): t is [number, number] => t !== null);
  if (!tacks.length) return null;
  // The tack with more of itself on the water.
  const [from, to] = tacks.reduce((best, t) =>
    t[1] - t[0] > best[1] - best[0] ? t : best,
  );
  return { from, to, power: ride.power, state: ride.state };
}
