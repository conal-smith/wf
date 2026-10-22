/**
 * The wedge a light shows, and the rose the loupe draws: the headings this
 * rider can hold, at this hour's wind.
 *
 * How high a wing foiler points and how deep they go downwind depends on how
 * good they are and how well powered: nobody points just off the foil, and
 * bearing away gets hard when overpowered. The wind side comes from the
 * rider's own band and rideable wind (./stars), so the wedge and the stars
 * agree on what the hour is; the band already assumes the wing we would
 * recommend, so the rider's quiver is not read here.
 *
 * The angles are checked against what schools, makers and riders' GPS tracks
 * say (docs/RIDE_ROSE.md, 19 October 2026): about 45° off the true wind for a
 * good rider (Duotone's academy, AFS, Wing Daily), 50–60° measured by riding
 * riders, a beam reach at best for a learner, and 10–15° worse in light air.
 * Those are the good end: what is taught as the aim and what a rider proud
 * enough of a track to post it measured. A rider out for a session holds
 * about 10° less (the owner's ruling of 22 October 2026), so that is the
 * default, and a rider who points higher or lower says so (`Pointing`).
 * Gear moves them as much as skill does, so they say "about here", not a
 * polar. They are the headings a session is ridden on, back and forth across
 * the wind, not the deepest a rider could bear away: never past 110° off,
 * since a heading at 135° and more runs downwind, where a session ends a long
 * walk from where it began.
 */
import {
  rideableWind,
  shoreAngle,
  windBand,
  type Pointing,
  type Rider,
  type ShoreAngle,
  type Skill,
} from "./stars";

/** Degrees off the true wind: [highest upwind, deepest downwind]. */
type Range = readonly [number, number];

/**
 * Powered up, in the sweet spot, for a rider of typical pointing. A learner
 * holds a beam reach at best; a riding rider about 70° and an advanced rider
 * about 55°: 10° short of the 60° GPS tracks measure and the 45° Duotone and
 * AFS teach, which a session rider does not hold tack after tack.
 */
const BEST: Record<Skill, Range> = {
  beginner: [90, 105],
  intermediate: [70, 105],
  advanced: [55, 110],
};
/**
 * Just foiling, at the band's floor: about 15° lower upwind (a light-air
 * Formula sailor loses 10–15°, and a wing foiler slipping off the foil more),
 * and nobody runs off.
 */
const AT_FLOOR: Record<Skill, Range> = {
  beginner: [95, 100],
  intermediate: [85, 100],
  advanced: [70, 105],
};
/** At the band's top: about 5° worse upwind, and less off the wind. */
const AT_TOP: Record<Skill, Range> = {
  beginner: [95, 100],
  intermediate: [75, 100],
  advanced: [60, 105],
};

/**
 * How much higher or lower than typical a rider points, in degrees off the
 * wind. Sharp is the good end the sources give (60° riding, 45° advanced);
 * cautious is a rider still learning to work upwind. Only the upwind edge
 * moves: how deep a session is ridden does not change with how high.
 */
const POINTING_OFF: Record<Pointing, number> = {
  cautious: 10,
  typical: 0,
  sharp: -10,
};

/**
 * The upwind edge for a rider's pointing. Pointing lower never closes the
 * reach: at least 10° of it stays, or what the level had where it had less
 * (a learner just foiling).
 */
function pointed(range: Range, pointing: Pointing = "typical"): Range {
  const [up, down] = range;
  return [Math.min(up + POINTING_OFF[pointing], Math.max(up, down - 10)), down];
}

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

/**
 * How high the rider points powered up, in degrees off the true wind: what
 * the display options say beside the pointing they chose.
 */
export const upwindAngle = (rider: Rider): number =>
  pointed(BEST[rider.skill], rider.pointing)[0];

/** What the rider can hold at a rideable wind, or null below their floor. */
export function rideRange(
  rider: Rider,
  rideKn: number,
): { range: Range; power: number; state: WedgeState } | null {
  const ride = levelRange(rider, rideKn);
  return ride && { ...ride, range: pointed(ride.range, rider.pointing) };
}

/** What the rider's level holds, at typical pointing. */
function levelRange(
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

/* ---- the rose: every heading, for the loupe ------------------------------ */

/** How a reach meets the beach: the tack out to sea, the tack home, or neither known. */
export type ReachKind = "out" | "home" | "reach";

/** A span of compass bearings, clockwise from `from` (0–360) to `to` (`from` up to 360 more). */
export interface Span {
  from: number;
  to: number;
}

export interface RoseReach extends Span {
  kind: ReachKind;
}

export interface Rose {
  /** Where the wind blows from, as given. */
  windFrom: number;
  /** How it meets the beach, or null where the facing is not known. */
  shore: ShoreAngle | null;
  /** The headings too close to the wind to hold, or null when nothing is drawn. */
  nogo: Span | null;
  /** The reaches either side of the no-go. */
  reaches: RoseReach[];
  /** Straight downwind: where a rider off the foil drifts, or null. */
  drift: number | null;
  /** True when the drift carries a rider away from the beach (cross-off, offshore). */
  driftOut: boolean;
}

/** To the nearest 5°: the rose says "about here", not a polar. */
const five = (d: number) => Math.round(d / 5) * 5;
const span = (a: number, b: number): Span => {
  const from = norm(five(a));
  return { from, to: from + norm(five(b) - five(a)) };
};

/**
 * The rose for an hour. Null with no wind or no direction: the dock has
 * nothing to show either. In the dark or below the rider's floor, only the
 * wind: no no-go, no reaches, no drift. With a beach, the reach that heads
 * out to sea is cut off at it, as the light's wedge is, and the other is the
 * way home; if neither heads out, nothing is drawn but the wind, as the wedge
 * is not. With no beach (a tapped point, a place whose facing is not known)
 * or in an offshore wind, both are plain reaches, uncut: there is no out to
 * name, and no home but upwind.
 */
export function rideRose(
  rider: Rider,
  hour: {
    windKn: number | null;
    gustKn: number | null;
    from: number | null;
    daylight: boolean;
  },
  facing: number | null,
): Rose | null {
  const { windKn, gustKn, from } = hour;
  if (windKn === null || from === null) return null;
  const shore = facing === null ? null : shoreAngle(from, facing);
  const bare: Rose = {
    windFrom: from,
    shore,
    nogo: null,
    reaches: [],
    drift: null,
    driftOut: false,
  };
  if (!hour.daylight) return bare;
  const ride = rideRange(rider, rideableWind(windKn, gustKn, rider));
  if (!ride) return bare;
  const [up, down] = ride.range;
  const tacks = [span(from + up, from + down), span(from - down, from - up)];
  let reaches: RoseReach[];
  if (facing === null || shore === "offshore")
    reaches = tacks.map((t) => ({ ...t, kind: "reach" }));
  else {
    reaches = tacks.map((t) => {
      const sea = clipToSea(t.from, t.to, facing);
      return sea
        ? { ...span(sea[0], sea[1]), kind: "out" as const }
        : { ...t, kind: "home" as const };
    });
    if (!reaches.some((r) => r.kind === "out")) return bare;
  }
  return {
    ...bare,
    nogo: span(from - up, from + up),
    reaches,
    drift: norm(five(from + 180)),
    driftOut: shore === "cross-off" || shore === "offshore",
  };
}

/**
 * The wind directions that are offshore at a beach facing `facing`, and the
 * two cross-offshore spans either side, on shoreAngle's bands (./stars): the
 * offshore within 30° of straight off the beach, cross-off from 30° to 70°.
 */
export function offshoreSpans(facing: number): {
  offshore: Span;
  crossOff: [Span, Span];
} {
  const off = facing + 180;
  const at = (a: number, b: number): Span => {
    const from = norm(off + a);
    return { from, to: from + (b - a) };
  };
  return {
    offshore: at(-30, 30),
    crossOff: [at(-70, -30), at(30, 70)],
  };
}
