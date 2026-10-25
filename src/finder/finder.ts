/**
 * The spot finder's arithmetic, apart from the page: which places it lists,
 * the six days each card covers, today's row of hours from first light to
 * last, the next five days' daylight, the best stars a place has in them and
 * the order that puts the places in, and the hour a rider picks. Pure, so it
 * is tested without a page; src/finder/SpotFinder.tsx draws it.
 *
 * The finder reads the chart's own table of rated hours (src/useRatings.ts)
 * on the chart's own strip of columns (src/strip.ts): a star here is the
 * chart's star and the dock's, for this rider. It is not tied to the chart's
 * time: the page is today and the five days after it, whatever hour the
 * chart was left on.
 */
import { sunTimes } from "../../force5/src/sun";
import type { Spot } from "../../force5/src/weather";
import type { PlaceHour } from "../ratings";
import { irishDate, irishHour, type StripColumn } from "../strip";
import type { LatLon } from "../lastView";

/** Favourites (the default) or every place round the rider. */
export type Scope = "favourites" | "near";

/** How far "near you" reaches. */
export const NEAR_KM = 30;

/** Today and the five days after it: what a card covers. */
export const CARD_DAYS = 6;

/** The middle of Ireland: where the finder looks with nothing else to go on. */
export const IRELAND_CENTRE: LatLon = { lat: 53.4, lon: -7.9 };

export const HOUR = 3600000;
const DAY = 24 * HOUR;

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

/* ---- the days ------------------------------------------------------------ */

/** Today and the days after it, as Irish dates: `count` of them. */
export function cardDates(now: number, count = CARD_DAYS): string[] {
  const dates: string[] = [];
  // A step of a day from midday never lands twice on one date, nor skips
  // one, across a change of the clocks.
  const noon = Date.parse(`${irishDate(now)}T12:00:00Z`);
  for (let d = 0; dates.length < count && d < count + 2; d++) {
    const date = irishDate(noon + d * DAY);
    if (!dates.includes(date)) dates.push(date);
  }
  return dates;
}

/**
 * First light and last light at a place on an Irish day: civil dawn and
 * civil dusk, as the forecast server gives them (mcp/api/forecast.ts
 * `daySun`). An Irish day's light all falls inside the UTC day of the same
 * date. Null where the sun never sets or never rises, which Ireland is spared.
 */
export function dayLight(
  place: LatLon,
  date: string,
): { firstLight: number; lastLight: number } | null {
  const sun = sunTimes(place.lat, place.lon, new Date(`${date}T12:00:00Z`));
  if (!sun.civilDawn || !sun.civilDusk) return null;
  return {
    firstLight: sun.civilDawn.getTime(),
    lastLight: sun.civilDusk.getTime(),
  };
}

/** The strip's columns by their time, for finding an hour's column. */
export function columnsByTime(
  strip: readonly Pick<StripColumn, "time">[],
): Map<number, number> {
  return new Map(strip.map((column, at) => [column.time, at] as const));
}

/** The top of the hour a time falls in. */
export const hourOf = (time: number) => Math.floor(time / HOUR) * HOUR;

/** One column of today's row: an hour, and the strip's column for it. */
export interface TodayHour {
  /** The top of the hour. */
  time: number;
  /** Its column in the strip, or null where the forecast has none. */
  at: number | null;
  /** Before first light or after last light: shaded, and never rated. */
  dark: boolean;
  /** Over already. */
  gone: boolean;
  /** The hour now. */
  now: boolean;
}

export interface TodayRow {
  firstLight: number;
  lastLight: number;
  hours: TodayHour[];
}

/**
 * Today at a place, an hour a column: from the hour before first light to
 * the hour after last light (06:00 to 18:00 for an October light of 06:50 to
 * 17:33; 04:00 to 23:00 for June's 04:12 to 22:46), each with the strip's
 * column for it where there is one. The ends are the dark: shaded, and the
 * site rates no hour in it.
 */
export function todayRow(
  strip: readonly Pick<StripColumn, "time">[],
  place: LatLon,
  now: number,
  byTime: ReadonlyMap<number, number> = columnsByTime(strip),
): TodayRow | null {
  const light = dayLight(place, irishDate(now));
  if (!light) return null;
  const { firstLight, lastLight } = light;
  // The whole hour before first light, even when first light is on the hour,
  // and the whole hour after last light.
  const from = hourOf(firstLight - 1);
  const to = hourOf(lastLight) + HOUR;
  const current = hourOf(now);
  const hours: TodayHour[] = [];
  for (let time = from; time <= to; time += HOUR)
    hours.push({
      time,
      at: byTime.get(time) ?? null,
      dark: time < firstLight || time > lastLight,
      gone: time < current,
      now: time === current,
    });
  return { firstLight, lastLight, hours };
}

/** One of the next days at a place: its light, and the strip's columns in it. */
export interface DayPlan {
  date: string;
  firstLight: number;
  lastLight: number;
  /** The strip's columns from first light to last, by their place in it. */
  columns: number[];
}

/**
 * A day's daylight at a place: the strip's columns from first light to last
 * light, at whatever cadence the run has there (hourly near, three-hourly
 * further out). Nothing after last light is drawn.
 */
export function dayPlan(
  strip: readonly Pick<StripColumn, "time" | "date">[],
  place: LatLon,
  date: string,
): DayPlan | null {
  const light = dayLight(place, date);
  if (!light) return null;
  const columns: number[] = [];
  strip.forEach((column, at) => {
    if (
      column.date === date &&
      column.time >= light.firstLight &&
      column.time <= light.lastLight
    )
      columns.push(at);
  });
  return { date, ...light, columns };
}

/** The stars an hour is worth, or null for one with none to give (dark, unrated). */
export const starsAt = (hour: PlaceHour | null | undefined): number | null =>
  hour?.rating ? hour.rating.stars : null;

/** The most stars among some columns of a row; 0 with none rated. */
export function bestStars(
  row: readonly (PlaceHour | null | undefined)[] | undefined,
  columns: readonly number[],
): number {
  let best = 0;
  for (const at of columns) best = Math.max(best, starsAt(row?.[at]) ?? 0);
  return best;
}

/**
 * The run of rideable columns round a day's best: from the best column, out
 * either way while the stars hold above none. Null on a day with no stars.
 * The card draws it as a short line under the day, in the best's colour.
 */
export function rideableRun(
  row: readonly (PlaceHour | null | undefined)[] | undefined,
  columns: readonly number[],
): { from: number; to: number; stars: number } | null {
  const stars = columns.map((at) => starsAt(row?.[at]) ?? 0);
  const top = Math.max(0, ...stars);
  if (!top) return null;
  let a = stars.indexOf(top);
  let b = a;
  while (a > 0 && stars[a - 1] > 0) a--;
  while (b < stars.length - 1 && stars[b + 1] > 0) b++;
  return { from: columns[a], to: columns[b], stars: top };
}

/** The windiest column among some, by the mean wind; null with no wind. */
export function windiest(
  row: readonly (PlaceHour | null | undefined)[] | undefined,
  columns: readonly number[],
): number | null {
  let best: number | null = null;
  for (const at of columns) {
    const kn = row?.[at]?.windKn;
    if (kn == null) continue;
    if (best === null || kn > row![best]!.windKn!) best = at;
  }
  return best;
}

/**
 * The column a day is summed up at, for its sky, its air and its sea: the
 * one nearest 13:00, early afternoon, or the hour now on a day already past
 * it. Null for a day with no columns.
 */
export function middayColumn(
  strip: readonly Pick<StripColumn, "time">[],
  columns: readonly number[],
  now: number,
): number | null {
  if (!columns.length) return null;
  const score = (at: number) => {
    const time = strip[at].time;
    // Past hours are no use to a heading about the day ahead.
    if (time < hourOf(now)) return Infinity;
    return Math.abs(irishHour(time) + (time % HOUR) / HOUR - 13);
  };
  let best = columns[0];
  for (const at of columns) if (score(at) < score(best)) best = at;
  return score(best) === Infinity ? columns[columns.length - 1] : best;
}

/* ---- the order ------------------------------------------------------------ */

/** A place's best in its six days: how many stars, and the first day it has them. */
export interface WeekBest {
  stars: number;
  /** 0 for today, 1 for tomorrow, …; null with no stars anywhere. */
  day: number | null;
}

/**
 * The most stars a place has in its six days, and the soonest day it has
 * them: today's hours only from the hour now on, each day's only in its
 * light. A place not yet rated has none (`stars` -1), and goes last.
 */
export function weekBest(
  row: readonly (PlaceHour | null | undefined)[] | undefined,
  strip: readonly Pick<StripColumn, "time" | "date">[],
  dates: readonly string[],
  now: number,
): WeekBest {
  if (!row) return { stars: -1, day: null };
  const current = hourOf(now);
  let best: WeekBest = { stars: 0, day: null };
  strip.forEach((column, at) => {
    const day = dates.indexOf(column.date);
    if (day < 0 || column.time < current) return;
    const stars = starsAt(row[at]);
    if (!stars) return;
    if (
      stars > best.stars ||
      (stars === best.stars && best.day !== null && day < best.day)
    )
      best = { stars, day };
  });
  return best;
}

/** A place on the list: how far it is, and its best of the week. */
export interface Listed<S extends Spot = Spot> {
  spot: S;
  /** From the rider, where that is known. */
  km: number | null;
  best: WeekBest;
}

/**
 * The most stars in the six days first; among equals the soonest day they
 * come, then the nearer, then the order the places came in (the favourites'
 * own, most recently starred first).
 */
export function rankSpots<S extends Spot>(
  list: readonly Listed<S>[],
): Listed<S>[] {
  return list
    .map((item, order) => ({ item, order }))
    .sort(
      (a, b) =>
        b.item.best.stars - a.item.best.stars ||
        (a.item.best.day ?? Infinity) - (b.item.best.day ?? Infinity) ||
        (a.item.km ?? Infinity) - (b.item.km ?? Infinity) ||
        a.order - b.order,
    )
    .map(({ item }) => item);
}

/* ---- the hour picked -------------------------------------------------------- */

/**
 * The hour picked after a press on one of today's: that hour, for every
 * card at once, or none again for the hour now (now is where the page
 * stands with none picked).
 */
export const pickHour = (pressed: number, now: number): number | null =>
  hourOf(pressed) === hourOf(now) ? null : hourOf(pressed);

/**
 * The strip's column a card's picture shows: the hour picked, or with none
 * the column the chart itself would open on now. Null where the strip has
 * no column for the hour picked.
 */
export function shownColumn(
  strip: readonly Pick<StripColumn, "time">[],
  picked: number | null,
  opening: number,
  byTime: ReadonlyMap<number, number> = columnsByTime(strip),
): number | null {
  if (picked === null) return strip.length ? opening : null;
  return byTime.get(picked) ?? null;
}

/* ---- the row's scroll ----------------------------------------------------------- */

/** How far a row scrolls to stand a column in its middle, held to its ends. */
export function centredScroll(
  left: number,
  width: number,
  view: number,
  scrollWidth: number,
): number {
  const max = Math.max(0, scrollWidth - view);
  return Math.max(0, Math.min(max, left + width / 2 - view / 2));
}

/** Where a press of ‹ or › takes the row: most of a view on, held to its ends. */
export function steppedScroll(
  scrollLeft: number,
  direction: -1 | 1,
  view: number,
  scrollWidth: number,
): number {
  const max = Math.max(0, scrollWidth - view);
  return Math.max(
    0,
    Math.min(max, scrollLeft + direction * Math.round(view * 0.6)),
  );
}

/** Whether there is more of the row before its view, and after it. */
export function rowEnds(
  scrollLeft: number,
  view: number,
  scrollWidth: number,
): { before: boolean; after: boolean } {
  return {
    before: scrollLeft > 4,
    after: scrollLeft + view < scrollWidth - 4,
  };
}

/* ---- the stars' colours ------------------------------------------------------------ */

/**
 * The theme's colour for a number of stars (ui/theme.css `stars-1` …
 * `stars-5`), as CSS reads it; null for none, which has no colour.
 */
export function starColour(stars: number | null | undefined): string | null {
  if (stars == null || !Number.isFinite(stars) || stars < 1) return null;
  return `var(--color-stars-${Math.min(5, Math.round(stars))})`;
}
