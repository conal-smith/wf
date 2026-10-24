/**
 * The wedge a light shows, and the rose the loupe draws: the headings this
 * rider can hold, at this hour's wind.
 *
 * One number says how high a rider goes: degrees into the wind, counted from
 * straight across it (`Rider.upwind`). 0° is the least: everyone is taken to
 * ride straight across the wind and hold their ground. 45° is about the most
 * a very good rider points (Duotone's academy, AFS and Wing Daily all teach
 * about 45° off the wind). Each level starts somewhere sensible, Learning at
 * 0°, Riding at 20° and Advanced at 35°, and the rider moves it in Customise.
 * The owner ruled (24 October 2026, docs/RIDE_ROSE.md) that it is one angle
 * in every wind: how powered the hour is does not move the no-go.
 *
 * The no-go is 90° less that number either side of the wind. The course runs
 * from its edge to about 120° off the wind; past that, downwind, is possible
 * but slow, and the rose draws it faintly rather than as part of the course.
 * The wind's side, whether the hour is rideable at all and how well powered,
 * still comes from the rider's own band and rideable wind (./stars), so the
 * wedge and the stars agree on what the hour is. None of it moves a star.
 */
import {
  rideableWind,
  shoreAngle,
  windBand,
  type Rider,
  type ShoreAngle,
  type Skill,
} from "./stars";

/** Degrees off the true wind: [highest upwind, deepest downwind]. */
type Range = readonly [number, number];

/** The most a rider can say they go into the wind: about a very good rider's. */
export const UPWIND_MAX = 45;

/** Where each level starts, in degrees into the wind past straight across it. */
export const UPWIND_DEFAULT: Record<Skill, number> = {
  beginner: 0,
  intermediate: 20,
  advanced: 35,
};

/** The deepest heading the course runs to, off the wind; past it is slow. */
export const COURSE_DEEP = 120;

/** A whole number of degrees between 0 and UPWIND_MAX. */
export const clampUpwind = (deg: number): number =>
  Math.min(UPWIND_MAX, Math.max(0, Math.round(deg)));

/** How far into the wind the rider rides: their own number, else their level's. */
export const upwindOf = (rider: Pick<Rider, "skill" | "upwind">): number =>
  rider.upwind === undefined
    ? UPWIND_DEFAULT[rider.skill]
    : clampUpwind(rider.upwind);

/**
 * The no-go's half-angle, in degrees off the true wind: the highest heading
 * the rider holds, in every wind.
 */
export const upwindAngle = (rider: Pick<Rider, "skill" | "upwind">): number =>
  90 - upwindOf(rider);

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

/**
 * What the rider can hold at a rideable wind, or null below their floor: the
 * course, the same in every wind, and how well powered the hour is, which
 * the light's wedge draws in its length and its pulse.
 */
export function rideRange(
  rider: Rider,
  rideKn: number,
): { range: Range; power: number; state: WedgeState } | null {
  const band = windBand(rider);
  if (!(rideKn >= band.min)) return null;
  const range: Range = [upwindAngle(rider), COURSE_DEEP];
  if (rideKn < band.sweetLow) {
    const t = ease((rideKn - band.min) / (band.sweetLow - band.min));
    return { range, power: lerp(0.45, 1, t), state: "building" };
  }
  if (rideKn <= band.sweetHigh) return { range, power: 1, state: "sweet" };
  const t = ease(
    clamp((rideKn - band.sweetHigh) / (band.max - band.sweetHigh), 0, 1),
  );
  return {
    range,
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
  /** The reaches either side of the no-go: the course, to COURSE_DEEP off the wind. */
  reaches: RoseReach[];
  /** Downwind of the course: possible but slow, drawn faintly. Null when nothing is drawn. */
  slow: Span | null;
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
 * wind: no no-go, no reaches, no slow downwind, no drift. With a beach, the reach that heads
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
    slow: null,
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
    slow: span(from + down, from + 360 - down),
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
