/**
 * The arithmetic behind the rider's own stars — Settings' "Wind strength"
 * and "Wind direction" on the site
 * (src/Settings.tsx) and in the app (mobile/src/features/stars) — kept apart
 * from the drawing so it can be tested: the rider's units and the handles'
 * steps in them, the handles kept in order, and every star they show, read
 * from the rating itself (force5/src/stars.ts) rather than restated.
 *
 * Everything is held in knots, as the rating is, and shown in the rider's
 * unit; a handle snaps to a whole unit (half a metre per second), and is kept
 * to the tenth of a knot, which shows again as the figure it was set to. In
 * Force a handle snaps to a whole force instead: see `moveWindForce`.
 */
import {
  CUSTOM_LIMITS,
  DIRECTION_KEYS,
  NEVER,
  oursCopy,
  parseCustomRating,
  sameCustomRating,
  rateHour,
  windStars,
  type CustomRating,
  type DirectionKey,
  type HourRating,
  type Rider,
  type WindBand,
} from "../../force5/src/stars";
import {
  BEAUFORT_KN,
  KNOTS,
  beaufort,
  convert,
  forceKn,
  unitLabel,
  type Units,
} from "../../force5/src/units";

/** One of the rider's units, against the knot the rating is kept in. */
export interface UnitScale {
  label: string;
  /** Shown units to the knot. In Force, the scale is drawn in knots: 1. */
  perKn: number;
  /** A handle's step, in shown units. */
  step: number;
  /** Decimals shown. */
  dp: number;
  /** An axis label every this many shown units. */
  tick: number;
  /** Whether the rider reads forces: a figure is a force, a handle a whole one. */
  force: boolean;
}

const STEPS: Record<Units, { step: number; dp: number; tick: number }> = {
  kn: { step: 1, dp: 0, tick: 10 },
  mph: { step: 1, dp: 0, tick: 10 },
  "km/h": { step: 1, dp: 0, tick: 20 },
  "m/s": { step: 0.5, dp: 1, tick: 5 },
  bft: { step: 1, dp: 0, tick: 10 },
};

export function unitScale(units: Units): UnitScale {
  return {
    label: unitLabel(units),
    perKn: convert(1 / KNOTS, units),
    ...STEPS[units],
    force: units === "bft",
  };
}

/** Knots as the rider reads them: "15", or "7.5" in metres per second, or the force, "5". */
export const shown = (kn: number, unit: UnitScale) =>
  unit.force ? String(beaufort(kn)) : (kn * unit.perKn).toFixed(unit.dp);

/** A speed written out with its unit: "15 kn", "Force 5". */
export const said = (kn: number, unit: UnitScale) =>
  unit.force ? `Force ${beaufort(kn)}` : `${shown(kn, unit)} ${unit.label}`;

/** A figure in the rider's unit, snapped to the step, back in knots to the tenth. */
export function knotsOf(value: number, unit: UnitScale): number {
  const snapped = Math.round(value / unit.step) * unit.step;
  return Math.round((snapped / unit.perKn) * 10) / 10;
}

/**
 * A handle moved by `steps` of the rider's unit from where it shows. In Force,
 * by whole forces: the first knot of the force it lands in, which the move
 * then sets on the force's first or last knot as the handle wants.
 */
export const stepped = (kn: number, steps: number, unit: UnitScale) =>
  unit.force
    ? forceKn(beaufort(kn) + steps, "first")
    : knotsOf(Number(shown(kn, unit)) + steps * unit.step, unit);

/**
 * Where a scale in knots is ticked for a rider in Force: at each force's first
 * knot between `from` and `to`, labelled with the force that starts there.
 */
export const forceTicks = (from: number, to: number) =>
  BEAUFORT_KN.map((kn, i) => ({ kn, force: i + 1 })).filter(
    (t) => t.kn >= from && t.kn <= to,
  );

export type WindKey = keyof CustomRating["wind"];
export const WIND_KEYS: readonly WindKey[] = [
  "min",
  "sweetLow",
  "sweetHigh",
  "max",
];
/** The ends of the wind scale and of the grid's gusts, in knots. */
export const WIND_TOP = CUSTOM_LIMITS.windTopKn;
export const GUST_TOP = 50;

const clamp = (x: number, low: number, high: number) =>
  Math.min(high, Math.max(low, x));

/**
 * One handle moved, the others left where they are: it stops a knot short of
 * its neighbours (minimum < ideal from < ideal to < maximum) and inside its
 * scale. Anything else about the rating is made safe by
 * the rating's own validation.
 */
export function moveWind(
  rating: CustomRating,
  key: WindKey,
  kn: number,
): CustomRating {
  const i = WIND_KEYS.indexOf(key);
  const { apartKn } = CUSTOM_LIMITS;
  const below = i > 0 ? rating.wind[WIND_KEYS[i - 1]] + apartKn : 2 + i;
  const above =
    i < 3 ? rating.wind[WIND_KEYS[i + 1]] - apartKn : WIND_TOP - (3 - i);
  const value = clamp(
    kn,
    Math.max(below, 2 + i),
    Math.min(above, WIND_TOP - (3 - i)),
  );
  return safe({ ...rating, wind: { ...rating.wind, [key]: value } });
}

/*
 * In Force, the band is set in whole forces: the lower two handles on a
 * force's first knot, the upper two on its last, and each on a force of its
 * own but for the sweet spot, which may be one force wide (Learning's
 * 13/15/20/24 kn is F4 / F5–F5 / F6). The forces the scale holds: F2 (from
 * 4 kn, since the band starts no lower than 2) to F8 (34–40 kn, the top).
 */
const FORCE_LOW = 2;
const FORCE_TOP = beaufort(CUSTOM_LIMITS.windTopKn);
const EDGE: readonly ("first" | "last")[] = ["first", "first", "last", "last"];
/** How many forces each handle stands above the one before it. */
const APART = [0, 1, 0, 1];

/** The four handles' forces kept in order and on the scale, low to high. */
function forceOrder(forces: number[]): number[] {
  const out = [...forces];
  for (let i = 0; i < 4; i++)
    out[i] = Math.max(out[i], i ? out[i - 1] + APART[i] : FORCE_LOW);
  for (let i = 3; i >= 0; i--)
    out[i] = Math.min(out[i], i < 3 ? out[i + 1] - APART[i + 1] : FORCE_TOP);
  return out;
}

/** The band set in whole forces, each handle where Force puts it. */
export function forceBand(rating: CustomRating): CustomRating {
  const forces = forceOrder(WIND_KEYS.map((key) => beaufort(rating.wind[key])));
  const wind = { ...rating.wind };
  WIND_KEYS.forEach((key, i) => (wind[key] = forceKn(forces[i], EDGE[i])));
  return safe({ ...rating, wind });
}

/** One handle moved in Force: to a whole force, never onto a neighbour's. */
export function moveWindForce(
  rating: CustomRating,
  key: WindKey,
  kn: number,
): CustomRating {
  const i = WIND_KEYS.indexOf(key);
  const forces = WIND_KEYS.map((k) => beaufort(rating.wind[k]));
  const low = i ? forces[i - 1] + APART[i] : FORCE_LOW;
  const high = i < 3 ? forces[i + 1] - APART[i + 1] : FORCE_TOP;
  const force = clamp(beaufort(kn), low, Math.max(low, high));
  return safe({
    ...rating,
    wind: { ...rating.wind, [key]: forceKn(force, EDGE[i]) },
  });
}

/** The band set in whole forces, as a rider in Force sets it. */
export const inForces = (rating: CustomRating): CustomRating =>
  forceBand(rating);

/**
 * Whether a rating is ours: as it stands, or, in Force, as ours is set in
 * whole forces. Then no rating of the rider's own is kept.
 */
export const ratingIsOurs = (custom: CustomRating, units: Units) =>
  sameCustomRating(custom, oursCopy()) ||
  (units === "bft" && sameCustomRating(custom, inForces(oursCopy())));

/** Offshore is never, for everyone: no dot moves it (the owner's ruling, 25 October 2026). */
export const shoreLocked = (key: DirectionKey) => key === "offshore";

/** Stars off for one direction, in whole stars from 0 to 5; offshore stays never. */
export function setDirection(
  rating: CustomRating,
  key: DirectionKey,
  off: number,
): CustomRating {
  if (shoreLocked(key)) return rating;
  return safe({
    ...rating,
    direction: {
      ...rating.direction,
      [key]: clamp(Math.round(off), 0, NEVER),
    },
  });
}

const safe = (rating: CustomRating) => parseCustomRating(rating) ?? rating;

/** What a way of wind costs, as the wizard says it: "no cost", "−1★", "never". */
export const costLabel = (off: number) =>
  off >= NEVER ? "never" : off <= 0 ? "no cost" : `−${off}★`;

/**
 * The stars the four handles make by steady wind, whole stars, as runs of
 * one count at a time from 0 to `to` knots: the read-only strip under the
 * slider. A run's `from`–`to` are whole knots, both in it.
 */
export function starRuns(
  wind: WindBand,
  to = 50,
): { stars: number; from: number; to: number }[] {
  const runs: { stars: number; from: number; to: number }[] = [];
  for (let kn = 0; kn <= to; kn++) {
    const stars = Math.round(windStars(kn, wind));
    const last = runs[runs.length - 1];
    if (last && last.stars === stars) last.to = kn;
    else runs.push({ stars, from: kn, to: kn });
  }
  return runs;
}

/** The bearings a west-facing beach sees each way of wind from. */
const FACING = 270;
export const FROM: Record<DirectionKey, number> = {
  onshore: 270,
  crossOn: 225,
  cross: 180,
  crossOff: 135,
  offshore: 90,
};

/**
 * An hour of `windKn` gusting `gustKn` from `dir`, rated for this rider in
 * daylight: only the wind, the gusts and the direction speak.
 */
export function rateExample(
  rider: Rider,
  windKn: number,
  gustKn: number,
  dir: DirectionKey,
): HourRating {
  return rateHour(
    {
      windKn,
      gustKn,
      from: FROM[dir],
      daylight: true,
    },
    { facing: FACING },
    rider,
  )!;
}

/** The examples' hours: [wind, gust, direction], cross-onshore unless named. */
export const EXAMPLES: readonly [number, number, DirectionKey][] = [
  [10, 16, "crossOn"],
  [12, 20, "crossOn"],
  [15, 20, "crossOn"],
  [15, 27, "crossOn"],
  [18, 24, "crossOn"],
  [18, 27, "crossOn"],
  [22, 32, "crossOn"],
  [25, 33, "crossOn"],
  [18, 24, "onshore"],
  [18, 24, "crossOff"],
  [18, 24, "offshore"],
];

/** How the examples and the "Together" picker name each direction. */
export const DIRECTION_NAME: Record<DirectionKey, string> = {
  offshore: "Offshore",
  crossOff: "Cross-offshore",
  cross: "Cross-shore",
  crossOn: "Cross-onshore",
  onshore: "Onshore",
};
export const DIRECTION_WORD: Record<DirectionKey, string> = {
  onshore: "onshore",
  crossOn: "cross-on",
  cross: "cross",
  crossOff: "cross-off",
  offshore: "offshore",
};

/**
 * The direction web: the beach from above, sea up and land down, as stars.ts's
 * shoreAngle reads it and drawn the way the wind blows, offshore out over the
 * sea and onshore in over the land. `from`–`to` are degrees off straight out
 * to sea; `at` is where its dot sits, on each side for the four that come
 * from either side. The web's own units: the rim is `WEB_R` from the beach.
 */
export const WEB_DIRS: readonly {
  key: DirectionKey;
  from: number;
  to: number;
  at: readonly number[];
}[] = [
  { key: "offshore", from: 0, to: 30, at: [0] },
  { key: "crossOff", from: 30, to: 70, at: [50, -50] },
  { key: "cross", from: 70, to: 110, at: [90, -90] },
  { key: "crossOn", from: 110, to: 150, at: [130, -130] },
  { key: "onshore", from: 150, to: 180, at: [180] },
];
export const WEB_R = 100;

/** A point `r` out from the beach, `a` degrees round from straight out to sea. */
export const polar = (a: number, r: number): [number, number] => [
  r * Math.sin((a * Math.PI) / 180),
  -r * Math.cos((a * Math.PI) / 180),
];

/** How far out a dot sits for its stars off: on the rim none, at the beach all five. */
export const webRadius = (off: number) => WEB_R * (1 - off / 5);

/** Stars off for a dot dragged to (x, y), unrounded: `setDirection` makes whole stars of it. */
export const offAt = (x: number, y: number) =>
  (1 - Math.min(Math.hypot(x, y), WEB_R) / WEB_R) * 5;

/** The direction whose slice of the web holds (x, y), or null outside the rim. */
export function sliceAt(x: number, y: number): DirectionKey | null {
  if (Math.hypot(x, y) > WEB_R) return null;
  // Degrees off straight out to sea, either way round.
  const off = Math.abs((Math.atan2(x, -y) * 180) / Math.PI);
  return WEB_DIRS.find((d) => off <= d.to)?.key ?? "onshore";
}

/** Shade of a grid square for 0–5 stars, as the pattern's key draws them. */
export const SHADE = [0, 0.08, 0.25, 0.45, 0.65, 0.85] as const;

/** Knots a square of the grid. */
export const GRID_STEP = 2;

/**
 * Every wind and gust, two knots a square, rated for this direction: null
 * where the gust is under the wind and no hour can be.
 */
export function gridStars(
  rider: Rider,
  dir: DirectionKey,
): (number | null)[][] {
  const rows: (number | null)[][] = [];
  for (let wind = 0; wind < WIND_TOP; wind += GRID_STEP) {
    const column: (number | null)[] = [];
    for (let gust = 0; gust < GUST_TOP; gust += GRID_STEP) {
      if (gust + GRID_STEP <= wind) column.push(null);
      else {
        const w = wind + GRID_STEP / 2;
        column.push(
          rateExample(rider, w, Math.max(gust + GRID_STEP / 2, w), dir).stars,
        );
      }
    }
    rows.push(column);
  }
  return rows;
}

export { DIRECTION_KEYS };
