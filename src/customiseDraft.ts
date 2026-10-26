/**
 * The arithmetic behind "Customise" (src/Customise.tsx), kept apart from the
 * drawing so it can be tested: the draft the wizard edits, read from the same
 * preferences the rest of the site reads, and written back through the same
 * functions (force5/src/prefs.ts), so the lights, the dock and every other
 * page rate the hours as the wizard left them.
 *
 * Everyone starts from ours (force5/src/stars.ts `OURS`). The wizard's wind
 * and shore are the rider's own rating; left as ours, none is kept and ours
 * rates. How far up and down the wind they ride is kept on the rider; it
 * moves no star. Weight and units are the rider's too, and never make the
 * rating differ from ours.
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
  oursCopy,
  rateHour,
  sameCustomRating,
  type CustomRating,
  type DirectionKey,
  type HourRating,
  type Rider,
} from "../force5/src/stars";
import type { Units } from "../force5/src/units";
import { inForces, ratingIsOurs, setDirection } from "../spot/web/yourStars";
import type { PlaceHour } from "./ratings";

/** What the wizard is setting, until "Show me the chart" saves it. */
export interface Draft {
  weightKg: number | null;
  units: Units;
  /** The four wind numbers and the shore: ours until changed. */
  custom: CustomRating;
  /** Degrees into the wind, past straight across it: ours, 0, until changed. */
  upwind: number;
  /** Degrees below straight across the course runs to: ours, 10, until changed. */
  downwind: number;
  /** The rider's spots, most recently starred first. */
  starred: string[];
}

/** The draft as the rider stands now: their own rating if they have one, else ours. */
export function draftOf(prefs: Prefs, starred: readonly string[]): Draft {
  const rider = prefs.rider;
  return inUnits({
    weightKg: rider.weightKg,
    units: prefs.units,
    custom: rider.custom
      ? { ...rider.custom, wind: { ...rider.custom.wind } }
      : oursCopy(),
    upwind: upwindOf(rider),
    downwind: downwindOf(rider),
    starred: [...starred],
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
  upwind: draft.upwind,
  downwind: draft.downwind,
  custom: ratingIsOurs(draft.custom, draft.units) ? null : draft.custom,
});

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
    upwind: draft.upwind,
    downwind: draft.downwind,
  });
  const next: Prefs = { ...prefs, units: draft.units, rider };
  const custom = ratingIsOurs(draft.custom, draft.units) ? null : draft.custom;
  if (sameCustomRating(custom, prefs.rider.custom ?? null)) return next;
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

/* ---- the rider's spots ---- */

/** Where "Your spots" lists the nearest from: the map's centre, or the rider. */
export interface Origin {
  lat: number;
  lng: number;
}

/** Kilometres from `origin` to a place, near enough to order a short list. */
export const kmFrom = (origin: Origin, place: { lat: number; lon: number }) =>
  Math.hypot(
    (place.lat - origin.lat) * 111.2,
    (place.lon - origin.lng) * 111.2 * Math.cos((origin.lat * Math.PI) / 180),
  );

/**
 * The `count` places nearest `origin`, nearest first, each with its distance.
 * Their order is the distance alone, so starring one moves nothing.
 */
export function nearest<T extends { lat: number; lon: number }>(
  places: readonly T[],
  origin: Origin,
  count: number,
): { place: T; km: number }[] {
  return places
    .map((place) => ({ place, km: kmFrom(origin, place) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, count);
}
