/**
 * "Your stars" (YourStarsScreen.tsx) apart from the drawing: the three steps
 * and their words, what is saved and when it differs from ours, and the
 * touch — which handle or dot a finger takes, and where on a scale, the web
 * or the upwind picture it is. The rating's own arithmetic, the units and the
 * web's geometry are the site's (spot/web/yourStars.ts, force5/src/stars.ts,
 * force5/src/rideWedge.ts).
 */
import { parseRider, withCustomStars, type Prefs } from "../../../../force5/src/prefs";
import {
  DOWNWIND_DEFAULT,
  DOWNWIND_MAX,
  UPWIND_DEFAULT,
  UPWIND_MAX,
  clampDownwind,
  clampUpwind,
  downwindOf,
  upwindOf,
} from "../../../../force5/src/rideWedge";
import {
  oursCopy,
  sameCustomRating,
  type CustomRating,
  type DirectionKey,
  type Rider,
} from "../../../../force5/src/stars";
import type { Units } from "../../../../force5/src/units";
import {
  WEB_DIRS,
  inForces,
  knotsOf,
  polar,
  ratingIsOurs,
  said,
  shoreLocked,
  webRadius,
  type UnitScale,
} from "../../../../spot/web/yourStars";

const clamp = (x: number, low: number, high: number) => Math.min(high, Math.max(low, x));

/* ------------------------------------------------------------ the steps */

export type StepId = "wind" | "shore" | "upwind";

/** The web wizard's steps 2–4 (src/Customise.tsx): the weight and the units are in Settings. */
export const STEPS: readonly { id: StepId; title: string; sub: string }[] = [
  {
    id: "wind",
    title: "What wind suits you?",
    sub: "Drag the handles to the wind you like. The stars under them follow.",
  },
  {
    id: "shore",
    title: "Configure stars based on wind direction",
    sub: "Drag a dot in to take stars off for that wind.",
  },
  {
    id: "upwind",
    title: "Can you ride upwind?",
    sub: "Pick the nearest answer, then set the two angles.",
  },
];

/* ------------------------------------------------------- what is saved */

/** What "Your stars" holds and saves: the rating, and how far up and down the wind the rider rides. */
export interface YourStars {
  rating: CustomRating;
  /** Degrees into the wind past straight across, 0–45. */
  upwind: number;
  /** Degrees below straight across the course runs to, 0–45. */
  downwind: number;
}

/** A rating as the rider's units set it: in Force, the four numbers on whole forces, as the handles stand. */
const inUnits = (rating: CustomRating, units: Units) => (units === "bft" ? inForces(rating) : rating);

/** Ours, everything: what "Reset to ours" puts back. */
export const oursStars = (units: Units): YourStars => ({
  rating: inUnits(oursCopy(), units),
  upwind: UPWIND_DEFAULT,
  downwind: DOWNWIND_DEFAULT,
});

/** What the screen opens on: the rider's own, else ours. */
export const yourStarsOf = (rider: Rider, units: Units): YourStars => ({
  rating: inUnits(
    rider.custom
      ? { ...rider.custom, wind: { ...rider.custom.wind }, direction: { ...rider.custom.direction } }
      : oursCopy(),
    units,
  ),
  upwind: upwindOf(rider),
  downwind: downwindOf(rider),
});

/**
 * Whether anything differs from ours, so "Reset to ours" has something to
 * do: the rating as it stands or, in Force, as ours stands in whole forces
 * (spot/web/yourStars.ts `ratingIsOurs`, as the site's wizard reads it), and
 * the two angles. The weight and the units are the rider's, not ours to reset.
 */
export const differsFromOurs = (yours: YourStars, units: Units) =>
  !ratingIsOurs(yours.rating, units) || yours.upwind !== UPWIND_DEFAULT || yours.downwind !== DOWNWIND_DEFAULT;

/**
 * The prefs with "Your stars" saved: each angle kept only while it is not
 * ours (`parseRider`), and the rating only while it is not ours
 * (`withCustomStars`), so a rider who puts everything back is as they always
 * were. The account's copy is stamped only when the rating itself changes,
 * as the site's wizard does (src/customiseDraft.ts `applyDraft`).
 */
export function withYourStars(prefs: Prefs, yours: YourStars, now: Date = new Date()): Prefs {
  const rider = parseRider({ ...prefs.rider, upwind: yours.upwind, downwind: yours.downwind });
  const next = { ...prefs, rider };
  const custom = ratingIsOurs(yours.rating, prefs.units) ? null : yours.rating;
  if (sameCustomRating(custom, prefs.rider.custom ?? null)) return next;
  return withCustomStars(next, custom, now);
}

/* ------------------------------------------------------------- the wind */

/** The slider's scale runs to 50 kn, past the top handle's 40, so the strip shows the stars running out. */
export const SCALE_TO = 50;

/** Knots at `x` points along a scale `width` wide that ends at `top` knots, snapped to the rider's unit. */
export function knAtX(x: number, width: number, top: number, unit: UnitScale): number {
  if (width <= 0) return 0;
  return knotsOf(clamp(x / width, 0, 1) * top * unit.perKn, unit);
}

/**
 * The handle a drag takes: the nearest to where the finger went down. Handles
 * a finger cannot tell apart (within `tieKn` of the nearest) go by the way it
 * moves: right takes the upper one, left the lower, so two handles side by
 * side can always be pulled apart.
 */
export function grabHandle<K extends string>(
  keys: readonly K[],
  values: Record<K, number>,
  kn: number,
  dx: number,
  tieKn: number,
): K {
  const dist = (k: K) => Math.abs(values[k] - kn);
  const nearest = keys.reduce((best, k) => (dist(k) < dist(best) ? k : best), keys[0]);
  const ties = keys.filter((k) => dist(k) <= dist(nearest) + tieKn);
  if (ties.length < 2 || dx === 0) return nearest;
  return dx > 0 ? ties[ties.length - 1] : ties[0];
}

/**
 * Where the slider's three names sit, from the left, in points: "Too light"
 * ends short of its handle, "Too much, in gusts" starts past its own, and
 * "no stars past here", under the track, just past it; each kept inside.
 */
export function windLabels(
  width: number,
  xMin: number,
  xMax: number,
  sizes: { light: number; much: number; none: number },
  gap = 24,
) {
  return {
    light: Math.max(0, xMin - gap - sizes.light),
    much: Math.max(0, Math.min(xMax + gap, width - sizes.much)),
    none: Math.max(0, Math.min(xMax + 6, width - sizes.none)),
  };
}

/** The read-only strip in words, for a screen reader: "1 star at 11 kn, …, 5 from 15 to 22 kn, none from 32 kn". */
export function stripWords(runs: readonly { stars: number; from: number; to: number }[], unit: UnitScale) {
  const parts: string[] = [];
  runs.forEach((run, i) => {
    if (run.stars)
      parts.push(
        run.from === run.to
          ? `${run.stars} at ${said(run.from, unit)}`
          : `${run.stars} from ${said(run.from, unit)} to ${said(run.to, unit)}`,
      );
    else if (i) parts.push(`none from ${said(run.from, unit)}`);
  });
  return `Your stars by steady wind: ${parts.join(", ")}`;
}

/* ------------------------------------------------------------ the shore */

/** The rows beside the web, onshore first, as the wizard has them. */
export const SHORE_ORDER: readonly DirectionKey[] = ["onshore", "crossOn", "cross", "crossOff", "offshore"];

/** The web's names round the rim: short enough for a phone. */
export const DIRECTION_SHORT: Record<DirectionKey, string> = {
  onshore: "ON",
  crossOn: "X-ON",
  cross: "CROSS",
  crossOff: "X-OFF",
  offshore: "OFF",
};

/** One short line under each row. */
export const DIRECTION_LINE: Record<DirectionKey, string> = {
  onshore: "Blows straight in. Choppy out, but it brings you back.",
  crossOn: "In at an angle. The easiest wind to learn in.",
  cross: "Along the beach. Ideal for most riders.",
  crossOff: "Out at an angle. You drift away from the beach.",
  offshore: "We don't recommend going out in an offshore wind.",
};

/**
 * The direction whose dot is under (x, y), in the web's units, within
 * `reach`: the nearest that can move. Offshore is locked, never, so its dot
 * is never taken, and a finger at the middle finds the dot it means.
 */
export function dotAt(
  x: number,
  y: number,
  off: CustomRating["direction"],
  reach: number,
): DirectionKey | null {
  const hits = WEB_DIRS.filter((d) => !shoreLocked(d.key))
    .flatMap((d) =>
      d.at.map((a) => {
        const [dx, dy] = polar(a, webRadius(off[d.key]));
        return { key: d.key, dist: Math.hypot(x - dx, y - dy) };
      }),
    )
    .filter((h) => h.dist <= reach)
    .sort((a, b) => a.dist - b.dist);
  return hits[0]?.key ?? null;
}

/* ----------------------------------------------------------- the upwind */

/** The three answers across the top, each the angle into the wind it sets. */
export const UP_ANSWERS: readonly { into: number; name: string; line: string }[] = [
  { into: 0, name: "Not yet", line: "I can ride straight across the wind and hold my ground." },
  { into: 5, name: "A little", line: "I gain a bit of ground on each tack." },
  { into: 20, name: "Yes", line: "I can work my way upwind." },
];

/** The answer an angle into the wind is, if it is one of them. */
export const answerOf = (upwind: number) => UP_ANSWERS.find((a) => a.into === upwind) ?? null;

export { DOWNWIND_MAX, UPWIND_MAX };

/** The upwind picture's frame and circle, in its own units (the approved mock-up's). */
export const UP = { cx: 150, cy: 168, r: 118, vx: -36, vw: 372, vh: 310 } as const;

/** A point on the picture `a` degrees off the wind (0 up, into it), `r` out from the board. */
export const upPoint = (a: number, r: number): [number, number] => [
  UP.cx + r * Math.sin((a * Math.PI) / 180),
  UP.cy - r * Math.cos((a * Math.PI) / 180),
];

/** Degrees off the wind of a point on the picture, either side: 0 straight into it, 180 straight down. */
export const offWind = (x: number, y: number) => (Math.atan2(Math.abs(x - UP.cx), -(y - UP.cy)) * 180) / Math.PI;

/** The angle a handle dragged to `off` degrees off the wind sets: into the wind, or below across. */
export const edgeAngle = (kind: "upwind" | "downwind", off: number) =>
  kind === "upwind" ? clampUpwind(90 - off) : clampDownwind(off - 90);

/** The handle on the picture under (x, y), within `reach`, in the picture's units. */
export function edgeAt(
  x: number,
  y: number,
  yours: Pick<YourStars, "upwind" | "downwind">,
  reach: number,
): "upwind" | "downwind" | null {
  const hits = (["upwind", "downwind"] as const).flatMap((kind) =>
    [1, -1].map((side) => {
      const a = kind === "upwind" ? 90 - yours.upwind : 90 + yours.downwind;
      const [hx, hy] = upPoint(side * a, UP.r);
      return { kind, dist: Math.hypot(x - hx, y - hy) };
    }),
  );
  const best = hits.filter((h) => h.dist <= reach).sort((a, b) => a.dist - b.dist)[0];
  return best?.kind ?? null;
}

/** Whole degrees at `x` points along a slider `width` wide, from 0 to `max`. */
export const degAtX = (x: number, width: number, max: number) =>
  width <= 0 ? 0 : Math.round(clamp(x / width, 0, 1) * max);
