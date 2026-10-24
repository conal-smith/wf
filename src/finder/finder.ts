/**
 * The spot finder's arithmetic, apart from the page: which places it lists,
 * in what order, and the week's timeline of daylight hours it picks one from.
 * Pure, so it is tested without a page; src/finder/SpotFinder.tsx draws it.
 *
 * The finder reads the chart's own table of rated hours (src/useRatings.ts)
 * and the chart's strip of columns (src/strip.ts): an hour here is the
 * chart's selected time, and a star here is the chart's star.
 */
import type { Spot } from "../../force5/src/weather";
import { daylightOn, type PlaceHour } from "../ratings";
import { dayShort, dayStep, type StripColumn, type StripDay } from "../strip";
import type { LatLon } from "../lastView";

/** Favourites (the default) or every place round the rider. */
export type Scope = "favourites" | "near";

/** How far "near you" reaches. */
export const NEAR_KM = 30;

/** How many days the timeline shows. */
export const TIMELINE_DAYS = 7;

/** The middle of Ireland: where the finder looks with nothing else to go on. */
export const IRELAND_CENTRE: LatLon = { lat: 53.4, lon: -7.9 };

const rad = (d: number) => (d * Math.PI) / 180;

/** Kilometres between two points, along the ground. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The places within `km` of a point, nearest first. */
export function nearSpots<S extends Spot>(
  spots: readonly S[],
  at: LatLon,
  km = NEAR_KM,
): { spot: S; km: number }[] {
  return spots
    .map((spot) => ({ spot, km: distanceKm(at, spot) }))
    .filter((s) => s.km <= km)
    .sort((a, b) => a.km - b.km);
}

/** The place nearest a point, or null with none. */
export function nearestSpot<S extends Spot>(
  spots: readonly S[],
  at: LatLon,
): S | null {
  let best: S | null = null;
  let gap = Infinity;
  for (const spot of spots) {
    const d = distanceKm(at, spot);
    if (d < gap) {
      gap = d;
      best = spot;
    }
  }
  return best;
}

/** A place on the list: its hour at the chosen time, and how far it is. */
export interface Listed<S extends Spot = Spot> {
  spot: S;
  /** The hour at the chosen time, or null until it is rated. */
  hour: PlaceHour | null;
  /** From the rider, where that is known. */
  km: number | null;
}

/** The stars an hour is worth, or -1 for one with none (dark, or not yet rated). */
export const starsOf = (hour: PlaceHour | null): number =>
  hour?.rating ? hour.rating.stars : -1;

/**
 * Best first: the stars at the chosen hour, then the nearer, then the order
 * the places came in (the favourites' own, most recently starred first).
 */
export function rankSpots<S extends Spot>(
  list: readonly Listed<S>[],
): Listed<S>[] {
  return list
    .map((item, order) => ({ item, order }))
    .sort(
      (a, b) =>
        starsOf(b.item.hour) - starsOf(a.item.hour) ||
        (a.item.km ?? Infinity) - (b.item.km ?? Infinity) ||
        a.order - b.order,
    )
    .map(({ item }) => item);
}

/** The places the finder lists for a scope, before they are ranked. */
export function listFor<S extends Spot>(
  scope: Scope,
  spots: readonly S[],
  starred: readonly string[],
  at: LatLon | null,
): { spot: S; km: number | null }[] {
  if (scope === "near") return at ? nearSpots(spots, at) : [];
  const byId = new Map(spots.map((s) => [s.id, s] as const));
  return starred.flatMap((id) => {
    const spot = byId.get(id);
    return spot ? [{ spot, km: at ? distanceKm(at, spot) : null }] : [];
  });
}

/* ---- the timeline: the week's daylight hours --------------------------- */

/** One of the strip's columns on the timeline. */
export interface TimelineHour {
  /** Its index in the strip: the chart's own column. */
  at: number;
  time: number;
  /** How many hours it stands for, to the next column: its width. */
  span: number;
}

export interface TimelineDay {
  date: string;
  /** "Sat 24". */
  label: string;
  /** Its daylight columns, in order; none for a day the forecast has no light in. */
  hours: TimelineHour[];
  /** The sum of their spans. */
  width: number;
}

const HOUR = 3600000;

/**
 * The first `count` days of the strip, each with its daylight columns at a
 * place (the rider, or the map's centre): the hours the stars are given for.
 * A column is as wide as the hours to the next one, so a day of three-hourly
 * columns is as long as a day of hourly ones.
 */
export function timelineDays(
  strip: readonly StripColumn[],
  days: readonly StripDay[],
  place: LatLon,
  count = TIMELINE_DAYS,
): TimelineDay[] {
  const light = daylightOn(
    place,
    strip.map((c) => c.validTime),
  );
  return days.slice(0, count).map((day) => {
    const hours: TimelineHour[] = [];
    for (let i = day.start; i < day.start + day.count; i++) {
      if (!light[i]) continue;
      const next = strip[i + 1];
      const span = next
        ? Math.min(6, Math.max(1, (next.time - strip[i].time) / HOUR))
        : 1;
      hours.push({ at: i, time: strip[i].time, span });
    }
    return {
      date: day.date,
      label: `${dayShort(day.noon)} ${Number(day.date.slice(8))}`,
      hours,
      width: hours.reduce((sum, h) => sum + h.span, 0),
    };
  });
}

/** Every timeline hour, in order across the days. */
export const timelineHours = (days: readonly TimelineDay[]) =>
  days.flatMap((d) => d.hours);

/**
 * The column under a press `fraction` (0–1) along day `day`: whichever
 * column's span it falls in. A day with no light gives the nearest hour of
 * the days either side.
 */
export function hourAt(
  days: readonly TimelineDay[],
  day: number,
  fraction: number,
): number | null {
  const d = days[Math.max(0, Math.min(days.length - 1, day))];
  if (!d) return null;
  if (!d.hours.length) {
    const all = timelineHours(days);
    if (!all.length) return null;
    const after = days.slice(day + 1).find((x) => x.hours.length);
    return fraction >= 0.5 && after
      ? after.hours[0].at
      : ([...days.slice(0, day)]
          .reverse()
          .find((x) => x.hours.length)
          ?.hours.at(-1)?.at ??
          after?.hours[0].at ??
          all[0].at);
  }
  const x = Math.max(0, Math.min(1, fraction)) * d.width;
  let run = 0;
  for (const h of d.hours) {
    run += h.span;
    if (x < run) return h.at;
  }
  return d.hours[d.hours.length - 1].at;
}

/**
 * Where the mark stands for the selected column: the day it is on and how
 * far along it (0–1), at the middle of its span. A column in the dark stands
 * at the edge of its day's light, before or after it; one past the timeline
 * at the end of its last day.
 */
export function markAt(
  days: readonly TimelineDay[],
  strip: readonly StripColumn[],
  selected: number,
): { day: number; fraction: number } | null {
  const column = strip[selected];
  if (!column || !days.length) return null;
  const day = days.findIndex((d) => d.date === column.date);
  if (day < 0)
    return column.time < (days[0].hours[0]?.time ?? Infinity)
      ? { day: 0, fraction: 0 }
      : { day: days.length - 1, fraction: 1 };
  const d = days[day];
  let run = 0;
  for (const h of d.hours) {
    if (h.at === selected)
      return { day, fraction: (run + h.span / 2) / d.width };
    run += h.span;
  }
  const first = d.hours[0];
  return { day, fraction: !first || column.time < first.time ? 0 : 1 };
}

/**
 * The column a key moves the hour to: along the daylight hours with the
 * arrows, a day with Page Up and Page Down (the same hour of the day, as the
 * dock's keys go), and to either end with Home and End. Null for any other
 * key, or where there is nowhere to go.
 */
export function stepHour(
  days: readonly TimelineDay[],
  strip: readonly StripColumn[],
  stripDayList: readonly StripDay[],
  selected: number,
  key: string,
): number | null {
  const all = timelineHours(days);
  if (!all.length) return null;
  const time = strip[selected]?.time ?? all[0].time;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return (all.find((h) => h.time > time) ?? all[all.length - 1]).at;
    case "ArrowLeft":
    case "ArrowDown":
      return ([...all].reverse().find((h) => h.time < time) ?? all[0]).at;
    case "Home":
      return all[0].at;
    case "End":
      return all[all.length - 1].at;
    case "PageDown":
    case "PageUp": {
      const to = dayStep(
        strip,
        stripDayList.slice(0, days.length),
        selected,
        key === "PageDown" ? 1 : -1,
      );
      const target = strip[to];
      const day = days.find((d) => d.date === target?.date);
      if (!day?.hours.length) return to;
      return day.hours.reduce((best, h) =>
        Math.abs(h.time - target.time) < Math.abs(best.time - target.time)
          ? h
          : best,
      ).at;
    }
    default:
      return null;
  }
}
