/**
 * The arithmetic behind "Your star rating" (YourStarsDialog.tsx), kept apart
 * from the drawing so it can be tested: the rider's units and the handles'
 * steps in them, the handles kept in order, and every star the dialog shows,
 * read from the rating itself (force5/src/stars.ts) rather than restated.
 *
 * Everything is held in knots, as the rating is, and shown in the rider's
 * unit; a handle snaps to a whole unit (half a metre per second), and is kept
 * to the tenth of a knot, which shows again as the figure it was set to.
 */
import {
  CUSTOM_LIMITS,
  DIRECTION_KEYS,
  directionCosts,
  gustCurve,
  gustLoss,
  parseCustomRating,
  rateHour,
  rideableWind,
  windBand,
  windScore,
  type CustomRating,
  type DirectionKey,
  type HourRating,
  type Rider,
} from "../../force5/src/stars";
import { KNOTS, convert, unitLabel, type Units } from "../../force5/src/units";

/** One of the rider's units, against the knot the rating is kept in. */
export interface UnitScale {
  label: string;
  /** Shown units to the knot. */
  perKn: number;
  /** A handle's step, in shown units. */
  step: number;
  /** Decimals shown. */
  dp: number;
  /** An axis label every this many shown units. */
  tick: number;
}

const STEPS: Record<Units, { step: number; dp: number; tick: number }> = {
  kn: { step: 1, dp: 0, tick: 10 },
  mph: { step: 1, dp: 0, tick: 10 },
  "km/h": { step: 1, dp: 0, tick: 20 },
  "m/s": { step: 0.5, dp: 1, tick: 5 },
};

export function unitScale(units: Units): UnitScale {
  return {
    label: unitLabel(units),
    perKn: convert(1 / KNOTS, units),
    ...STEPS[units],
  };
}

/** Knots as the rider reads them: "15", or "7.5" in metres per second. */
export const shown = (kn: number, unit: UnitScale) =>
  (kn * unit.perKn).toFixed(unit.dp);

/** A figure in the rider's unit, snapped to the step, back in knots to the tenth. */
export function knotsOf(value: number, unit: UnitScale): number {
  const snapped = Math.round(value / unit.step) * unit.step;
  return Math.round((snapped / unit.perKn) * 10) / 10;
}

/** A handle moved by `steps` of the rider's unit from where it shows. */
export const stepped = (kn: number, steps: number, unit: UnitScale) =>
  knotsOf(Number(shown(kn, unit)) + steps * unit.step, unit);

export type WindKey = keyof CustomRating["wind"];
export type GustKey = "fine" | "worst";
export const WIND_KEYS: readonly WindKey[] = [
  "min",
  "sweetLow",
  "sweetHigh",
  "max",
];
export const GUST_KEYS: readonly GustKey[] = ["fine", "worst"];
/** The ends of the two scales, in knots. */
export const WIND_TOP = CUSTOM_LIMITS.windTopKn;
export const GUST_TOP = CUSTOM_LIMITS.gustTopKn;

const clamp = (x: number, low: number, high: number) =>
  Math.min(high, Math.max(low, x));

/**
 * One handle moved, the others left where they are: it stops a knot short of
 * its neighbours (minimum < ideal from < ideal to < maximum; no effect < most
 * off) and inside its scale. Anything else about the rating is made safe by
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

export function moveGust(
  rating: CustomRating,
  key: GustKey,
  kn: number,
): CustomRating {
  const { apartKn } = CUSTOM_LIMITS;
  const value =
    key === "fine"
      ? clamp(kn, 1, rating.gust.worst - apartKn)
      : clamp(kn, rating.gust.fine + apartKn, GUST_TOP);
  return safe({ ...rating, gust: { ...rating.gust, [key]: value } });
}

/** Stars off for one direction, in half stars from 0 to 5. */
export function setDirection(
  rating: CustomRating,
  key: DirectionKey,
  off: number,
): CustomRating {
  return safe({
    ...rating,
    direction: {
      ...rating.direction,
      [key]: clamp(Math.round(off * 2) / 2, 0, 5),
    },
  });
}

const safe = (rating: CustomRating) => parseCustomRating(rating) ?? rating;

/** "−2½", "−3", "0": stars off as the dialog sets them. */
export const halfStars = (off: number) =>
  off ? `−${Math.floor(off) || ""}${off % 1 ? "½" : ""}` : "0";

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
 * An hour of `windKn` gusting `gustKn` from `dir`, rated for this rider:
 * steady models, daylight, and no wing to fit, so only the three curves speak.
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
      agreement: "high",
      daylight: true,
    },
    { facing: FACING },
    { ...rider, wings: [] },
  )!;
}

/** The rider rated on a custom rating, and on the level it started from. */
export const withRating = (rider: Rider, custom: CustomRating): Rider => ({
  ...rider,
  custom,
});
export const onLevel = (rider: Rider, custom: CustomRating): Rider => ({
  ...rider,
  skill: custom.base,
  custom: null,
});

/** What the readout says of an hour: its wind, and what came off. */
export function breakdown(
  rider: Rider,
  windKn: number,
  gustKn: number,
  dir: DirectionKey,
) {
  const rating = rateExample(rider, windKn, gustKn, dir);
  const r = { ...rider, wings: [] };
  const wind = windScore(rideableWind(windKn, gustKn, r), windBand(r));
  const gusts = gustLoss(gustKn, gustCurve(r));
  const direction = directionCosts(r)[dir];
  return { rating, wind, gusts, direction };
}

/** The examples' hours: [wind, gust, direction], cross-onshore unless named. */
export const EXAMPLES: readonly [number, number, DirectionKey][] = [
  [10, 16, "crossOn"],
  [12, 20, "crossOn"],
  [15, 22, "crossOn"],
  [18, 24, "crossOn"],
  [18, 27, "crossOn"],
  [22, 32, "crossOn"],
  [25, 38, "crossOn"],
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

/** Stars off for a dot dragged to (x, y), unrounded: `setDirection` makes half stars of it. */
export const offAt = (x: number, y: number) =>
  (1 - Math.min(Math.hypot(x, y), WEB_R) / WEB_R) * 5;

/** The direction whose slice of the web holds (x, y), or null outside the rim. */
export function sliceAt(x: number, y: number): DirectionKey | null {
  if (Math.hypot(x, y) > WEB_R) return null;
  // Degrees off straight out to sea, either way round.
  const off = Math.abs((Math.atan2(x, -y) * 180) / Math.PI);
  return WEB_DIRS.find((d) => off <= d.to)?.key ?? "onshore";
}

/** Shade of a "Together" square for 0–5 stars, as the pattern's key draws them. */
export const SHADE = [0, 0.08, 0.25, 0.45, 0.65, 0.85] as const;

/** Knots a square of the "Together" grid. */
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
