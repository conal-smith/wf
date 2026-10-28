/**
 * The arithmetic behind "Settings" (src/Settings.tsx), kept apart from the
 * drawing so it can be tested: the draft the dialog edits, read from the same
 * preferences the rest of the site reads, and written back through the same
 * functions (force5/src/prefs.ts), so the lights, the dock and every other
 * page rate the hours as Settings left them.
 *
 * Everyone starts from ours (force5/src/stars.ts `OURS`). The dialog's wind
 * and shore are the rider's own rating; left as ours, none is kept and ours
 * rates. How far up and down the wind they ride is kept on the rider; it
 * moves no star. Weight, wings and units are the rider's too, and never
 * make the rating differ from ours.
 */
import { parseRider, withCustomStars, type Prefs } from "../force5/src/prefs";
import {
  DOWNWIND_DEFAULT,
  UPWIND_DEFAULT,
  clampDownwind,
  clampUpwind,
  downwindOf,
  upwindOf,
} from "../force5/src/rideWedge";
import {
  NEVER,
  oursCopy,
  sameCustomRating,
  type CustomRating,
  type DirectionKey,
  type Rider,
} from "../force5/src/stars";
import type { Units } from "../force5/src/units";
import { inForces, ratingIsOurs, setDirection } from "../spot/web/yourStars";

/** What Settings is setting, until Save keeps it. */
export interface Draft {
  weightKg: number | null;
  /**
   * The wings the rider owns, m², smallest first: which of them to take is
   * said beside the stars (force5/src/stars.ts `pickWing`), as the spot page's
   * wings and the MCP's `wings_m2` say it. They never move a star.
   */
  wings: number[];
  units: Units;
  /** The four wind numbers and the shore: ours until changed. */
  custom: CustomRating;
  /** Degrees into the wind, past straight across it: ours, 0, until changed. */
  upwind: number;
  /** Degrees below straight across the course runs to: ours, 10, until changed. */
  downwind: number;
}

/** The draft as the rider stands now: their own rating if they have one, else ours. */
export function draftOf(prefs: Prefs): Draft {
  const rider = prefs.rider;
  return inUnits({
    weightKg: rider.weightKg,
    wings: [...rider.wings],
    units: prefs.units,
    custom: rider.custom
      ? { ...rider.custom, wind: { ...rider.custom.wind } }
      : oursCopy(),
    upwind: upwindOf(rider),
    downwind: downwindOf(rider),
  });
}

/**
 * The draft as its units show it: in Force, the four numbers on whole
 * forces (yourStars.ts `inForces`), as the handles stand.
 */
export const inUnits = (draft: Draft): Draft =>
  draft.units === "bft" ? { ...draft, custom: inForces(draft.custom) } : draft;

/** Whether a rating is ours (yourStars.ts `ratingIsOurs`). */
export { ratingIsOurs };

/**
 * Whether anything the rating or the course is made of differs from ours:
 * then "Reset to ours" shows. Weight and units are the rider's own, never
 * ours to reset.
 */
export const differsFromOurs = (draft: Draft) =>
  !ratingIsOurs(draft.custom, draft.units) ||
  draft.upwind !== UPWIND_DEFAULT ||
  draft.downwind !== DOWNWIND_DEFAULT;

/** "Reset to ours": the wind, the shore and the course as ours, weight and units as they are. */
export const resetToOurs = (draft: Draft): Draft =>
  inUnits({
    ...draft,
    custom: oursCopy(),
    upwind: UPWIND_DEFAULT,
    downwind: DOWNWIND_DEFAULT,
  });

/** The rider the draft rates as. */
export const draftRider = (draft: Draft, rider: Rider): Rider => ({
  ...rider,
  weightKg: draft.weightKg,
  wings: draft.wings,
  upwind: draft.upwind,
  downwind: draft.downwind,
  custom: ratingIsOurs(draft.custom, draft.units) ? null : draft.custom,
});

/**
 * Whether the draft is not what the dialog opened on: then closing without
 * Save asks first (issue 218), since what was changed would be thrown away.
 */
export const draftChanged = (draft: Draft, start: Draft) =>
  JSON.stringify(draft) !== JSON.stringify(start);

/* ---- the wings ---- */

/**
 * The wings in what the rider typed, as the spot page reads its own field
 * (spot/web/RiderSwitch.tsx): every number in it, kept only where it is a
 * wing (force5/src/prefs.ts `parseRider`, 1.5–10 m²), each once, smallest
 * first. "4, 5.5" and "4 5.5 m²" are both 4 and 5.5.
 */
export const wingsIn = (text: string): number[] =>
  parseRider({ wings: (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number) }).wings;

/** The wings as the field shows them: "4, 5.5". */
export const wingsText = (wings: readonly number[]) => wings.join(", ");

/* ---- the shore ---- */

/**
 * The stars a way of wind takes off, as a dot on the web sets them: in whole
 * stars from none to never (yourStars.ts `setDirection`). Offshore stays at
 * never.
 */
export function withShore(draft: Draft, key: DirectionKey, off: number): Draft {
  const custom = setDirection(draft.custom, key, off);
  return custom.direction[key] === draft.custom.direction[key]
    ? draft
    : { ...draft, custom };
}

/** What a wind direction costs, in words: "Full stars", "1 star off", "No stars". */
export const offWords = (off: number) =>
  off >= NEVER
    ? "No stars"
    : off <= 0
      ? "Full stars"
      : `${off} star${off === 1 ? "" : "s"} off`;

/* ---- the course ---- */

/** Degrees into the wind, held to 0–45 whole degrees. */
export const withUpwind = (draft: Draft, deg: number): Draft => {
  const upwind = clampUpwind(deg);
  return upwind === draft.upwind ? draft : { ...draft, upwind };
};

/** Degrees below straight across, held to 0–45 whole degrees. */
export const withDownwind = (draft: Draft, deg: number): Draft => {
  const downwind = clampDownwind(deg);
  return downwind === draft.downwind ? draft : { ...draft, downwind };
};

/* ---- saving ---- */

/**
 * The preferences with the draft saved: the rider's weight and angles, the
 * units, and either no rating of their own (the draft's wind and shore left
 * as ours) or the draft as their own. Through `withCustomStars`, so the
 * account's copy is stamped only when the rating itself changes.
 */
export function applyDraft(
  prefs: Prefs,
  draft: Draft,
  now: Date = new Date(),
): Prefs {
  const rider = parseRider({
    ...prefs.rider,
    weightKg: draft.weightKg,
    wings: draft.wings,
    upwind: draft.upwind,
    downwind: draft.downwind,
  });
  const next: Prefs = { ...prefs, units: draft.units, rider };
  const custom = ratingIsOurs(draft.custom, draft.units) ? null : draft.custom;
  if (sameCustomRating(custom, prefs.rider.custom ?? null)) return next;
  return withCustomStars(next, custom, now);
}
