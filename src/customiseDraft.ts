/**
 * The arithmetic behind "Customise" (src/Customise.tsx), kept apart from the
 * drawing so it can be tested: the draft the wizard edits, read from the same
 * preferences Display options and "Your star rating" write, and written back
 * through the same functions (force5/src/prefs.ts), so the lights, the dock
 * and every other page rate the hours as the wizard left them.
 *
 * The wizard's wind and shore are a custom star rating
 * (force5/src/stars.ts `CustomRating`): the band and the stars each way of
 * wind takes off. Left as the level has them, the level rates and no custom
 * rating is saved; changed, they are the rider's own. How much gusty wind
 * bothers the rider is theirs whatever rates, so it is kept on the rider, as
 * how high they point is.
 */
import {
  parseRider,
  withCustomStars,
  withStarsOn,
  type Prefs,
} from "../force5/src/prefs";
import { UPWIND_DEFAULT, upwindOf } from "../force5/src/rideWedge";
import {
  DEFAULT_RIDER,
  bestWindow,
  rateHour,
  ratingLevel,
  sameCustomRating,
  standardRating,
  type CustomRating,
  type DirectionKey,
  type Gusty,
  type HourRating,
  type Rider,
  type Skill,
} from "../force5/src/stars";
import type { Units } from "../force5/src/units";
import { inForces } from "../spot/web/yourStars";
import type { PlaceHour } from "./ratings";

/** What the wizard is setting, until "Show me the chart" saves it. */
export interface Draft {
  skill: Skill;
  weightKg: number | null;
  /** Degrees into the wind, past straight across it: the level's until changed. */
  upwind: number;
  /** How much gusty wind bothers them. */
  gusty: Gusty;
  /** The wind band and the shore: the level's until changed. */
  custom: CustomRating;
  units: Units;
  /** The rider's spots, most recently starred first. */
  starred: string[];
}

/**
 * The draft as the rider stands now: their own rating if it rates (at the
 * level it started from), else their level's.
 */
export function draftOf(prefs: Prefs, starred: readonly string[]): Draft {
  const rider = prefs.rider;
  const skill = ratingLevel(rider);
  return inUnits({
    skill,
    weightKg: rider.weightKg,
    upwind: upwindOf({ skill, upwind: rider.upwind }),
    gusty: rider.gusty ?? "some",
    custom: rider.custom
      ? lockShore(rider.custom)
      : levelRating(skill, rider.weightKg),
    units: prefs.units,
    starred: [...starred],
  });
}

/**
 * The draft as its units show it: in Force, the band and the gusts on whole
 * forces (yourStars.ts `inForces`), as the handles stand.
 */
export const inUnits = (draft: Draft): Draft =>
  draft.units === "bft" ? { ...draft, custom: inForces(draft.custom) } : draft;

/**
 * Whether the draft's wind, gusts and shore are its level's: as the level
 * has them, or, in Force, as the level's are set in whole forces.
 */
export function onItsLevel(draft: Draft): boolean {
  const custom = { ...draft.custom, base: draft.skill };
  const level = levelRating(draft.skill, draft.weightKg);
  return (
    sameCustomRating(custom, level) ||
    (draft.units === "bft" && sameCustomRating(custom, inForces(level)))
  );
}

/** A level's own band and shore for a rider of this weight. */
export const levelRating = (skill: Skill, weightKg: number | null) =>
  lockShore(standardRating({ ...DEFAULT_RIDER, skill, weightKg }, skill));

/**
 * A new level or weight: the wind and the shore start again from that
 * level's, as Display options' level does. A new level starts the
 * degrees into the wind again from its own too; a new weight leaves them.
 */
export const withLevel = (
  draft: Draft,
  skill: Skill,
  weightKg: number | null,
): Draft =>
  inUnits({
    ...draft,
    skill,
    weightKg,
    upwind: skill === draft.skill ? draft.upwind : UPWIND_DEFAULT[skill],
    custom: levelRating(skill, weightKg),
  });

/** The rider the draft rates as: the custom rating in use, the rest as it is. */
export const draftRider = (draft: Draft, rider: Rider): Rider => ({
  ...rider,
  skill: draft.skill,
  weightKg: draft.weightKg,
  upwind: draft.upwind,
  gusty: draft.gusty,
  custom: draft.custom,
  keptCustom: null,
});

/* ---- the shore ---- */

/** The three answers for each way of wind: ride it, a star or so off, or never. */
export type ShoreChoice = "ride" | "less" | "never";
/** Never: five off leaves no star in any wind. */
export const NEVER = 5;

/** Offshore is never for a learner: the wizard holds it there. */
export const shoreLocked = (skill: Skill, key: DirectionKey) =>
  skill === "beginner" && key === "offshore";

function lockShore(rating: CustomRating): CustomRating {
  return rating.base === "beginner"
    ? { ...rating, direction: { ...rating.direction, offshore: NEVER } }
    : rating;
}

export const shoreChoice = (off: number): ShoreChoice =>
  off <= 0 ? "ride" : off >= NEVER ? "never" : "less";

/**
 * What "less" takes off for this way of wind: what it takes off now, when
 * that is between none and all; else the level's own figure there; else one
 * star. So a level's half stars are kept, and said, rather than rounded.
 */
export function lessOff(draft: Draft, key: DirectionKey): number {
  const now = draft.custom.direction[key];
  if (now > 0 && now < NEVER) return now;
  const level = levelRating(draft.skill, draft.weightKg).direction[key];
  return level > 0 && level < NEVER ? level : 1;
}

export function withShore(
  draft: Draft,
  key: DirectionKey,
  choice: ShoreChoice,
): Draft {
  if (shoreLocked(draft.skill, key)) return draft;
  const off =
    choice === "ride" ? 0 : choice === "never" ? NEVER : lessOff(draft, key);
  return {
    ...draft,
    custom: {
      ...draft.custom,
      direction: { ...draft.custom.direction, [key]: off },
    },
  };
}

/** A tap on the beach's wedge: ride, then less, then never, then ride. */
export const NEXT_SHORE: Record<ShoreChoice, ShoreChoice> = {
  ride: "less",
  less: "never",
  never: "ride",
};

/** "−1", "−1½": stars off as the wizard names them. */
export const starsOff = (off: number) =>
  `−${Math.floor(off) || ""}${off % 1 ? "½" : ""}`;

/* ---- saving ---- */

/**
 * The preferences with the draft saved: the rider's level, weight, degrees
 * into the wind and gusty wind, the units, and either the level rating (the
 * draft's wind and shore left as the level has them, the rider's own rating
 * kept aside) or
 * the draft as the rider's own rating. Through the same functions Display
 * options and "Your star rating" save with, so the account's copy is stamped
 * the same way.
 */
export function applyDraft(
  prefs: Prefs,
  draft: Draft,
  now: Date = new Date(),
): Prefs {
  const rider = parseRider({
    ...prefs.rider,
    skill: draft.skill,
    weightKg: draft.weightKg,
    upwind: draft.upwind,
    gusty: draft.gusty,
  });
  const next: Prefs = { ...prefs, units: draft.units, rider };
  const custom = { ...draft.custom, base: draft.skill };
  if (onItsLevel(draft)) return withStarsOn(next, draft.skill, now);
  if (sameCustomRating(custom, prefs.rider.custom)) return next;
  return withCustomStars(next, custom, now);
}

/** The stars the rider's spots move by: the ids starred and unstarred. */
export function spotChanges(
  before: readonly string[],
  after: readonly string[],
): string[] {
  return [
    ...after.filter((id) => !before.includes(id)),
    ...before.filter((id) => !after.includes(id)),
  ];
}

/* ---- a real day to show it on ---- */

export interface SampleHour {
  time: number;
  windKn: number;
  gustKn: number | null;
  from: number | null;
}

export interface SampleDay {
  spot: { id: string; name: string; facing: number | null };
  hours: SampleHour[];
}

/** How many daylight hours the wizard shows of a day: nine, as the mockup does. */
export const SAMPLE_HOURS = 9;

/** The sample day's hours, rated for the rider: never null, for they are all daylight. */
export const rateSample = (day: SampleDay, rider: Rider): HourRating[] =>
  day.hours.map((hour) =>
    rateHour({ ...hour, daylight: true }, { facing: day.spot.facing }, rider)!,
  );

const HOUR = 3600000;

/** Of an hour's wind, whether it is any use as a sample: something to rate. */
const lively = (kn: number) => kn >= 8 && kn <= 34;

/**
 * A real day to rate as the rider drags: at the first of `prefer` (the open
 * spot, the rider's own) with a forecast in hand, else at whichever place in
 * hand has the liveliest day, and on that place's liveliest day: the most
 * daylight hours with a wind to rate. Nine of its daylight hours, from the
 * morning; null with nothing in hand.
 */
export function sampleDay(
  hours: ReadonlyMap<string, readonly PlaceHour[]>,
  times: readonly number[],
  places: ReadonlyMap<
    string,
    { id: string; name: string; facing?: number | null }
  >,
  prefer: readonly string[],
): SampleDay | null {
  const days = (rows: readonly PlaceHour[]) => {
    // Each day's longest run of hourly daylight columns: past a model's
    // hourly steps the strip goes three-hourly, which is no day to drag on.
    const runs = new Map<string, number[]>();
    let run: number[] = [];
    rows.forEach((hour, i) => {
      if (!hour.daylight || hour.windKn === null || times[i] === undefined)
        return (run = []);
      const date = new Date(times[i]).toISOString().slice(0, 10);
      const prev = run[run.length - 1];
      if (
        prev === undefined ||
        times[i] - times[prev] !== HOUR ||
        new Date(times[prev]).toISOString().slice(0, 10) !== date
      )
        run = [];
      run.push(i);
      if (run.length > (runs.get(date)?.length ?? 0)) runs.set(date, run);
    });
    let best: number[] = [];
    let score = -1;
    for (const at of runs.values()) {
      const s = at.filter((i) => lively(rows[i].windKn!)).length;
      if (s > score && at.length >= 6) {
        best = at;
        score = s;
      }
    }
    return { at: best, score };
  };
  const pick = (id: string) => {
    const rows = hours.get(id);
    const place = places.get(id);
    return rows && place ? { rows, place, ...days(rows) } : null;
  };
  let chosen = null as ReturnType<typeof pick>;
  for (const id of prefer) {
    chosen = pick(id);
    if (chosen && chosen.at.length) break;
    chosen = null;
  }
  if (!chosen)
    for (const id of hours.keys()) {
      const next = pick(id);
      if (next && next.at.length && (!chosen || next.score > chosen.score))
        chosen = next;
    }
  if (!chosen) return null;
  const { rows, place, at } = chosen;
  // From the morning: the day's first hours are the dawn's, rarely ridden.
  const start = Math.max(0, Math.min(at.length - SAMPLE_HOURS, 1));
  return {
    spot: { id: place.id, name: place.name, facing: place.facing ?? null },
    hours: at.slice(start, start + SAMPLE_HOURS).map((i) => ({
      time: times[i],
      windKn: rows[i].windKn!,
      gustKn: rows[i].gustKn,
      from: rows[i].from,
    })),
  };
}

/** The sample's best hours for the rider, where any are worth a star: the pen's frame. */
export const sampleBest = (ratings: readonly HourRating[]) =>
  bestWindow(ratings, 2) ?? bestWindow(ratings, 1);
