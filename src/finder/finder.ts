/**
 * The spot finder's arithmetic, apart from the page: which places it lists,
 * the six days it steps through and the one it opens on, a day's row of
 * hours from first light to last, each day's daylight, the best stars a
 * place has on the day shown and the order that puts the places in, and the
 * hour a rider picks. Pure, so it is tested without a page;
 * src/finder/SpotFinder.tsx draws it.
 *
 * The finder reads the chart's own table of rated hours (src/useRatings.ts)
 * on the chart's own strip of columns (src/strip.ts): a star here is the
 * chart's star and the dock's, for this rider. It is not tied to the chart's
 * time: the page is one of today and the five days after it, whatever hour
 * the chart was left on.
 */
import { sunTimes } from "../../force5/src/sun";
import type { ViewBounds } from "../../force5/src/squares";
import type { Spot } from "../../force5/src/weather";
import type { PlaceHour } from "../ratings";
import { irishDate, irishHour, type StripColumn } from "../strip";
import type { LatLon } from "../lastView";
import { tidySearch } from "../../force5/src/siteNav";

/** Favourites or every place round the rider. */
export type Scope = "favourites" | "near";

/** How far "near you" reaches, round the rider's own place. */
export const NEAR_KM = 30;

/**
 * How many places "near you" lists round a place that is not the rider's
 * own (where the chart was last, or the middle of Ireland): the nearest,
 * however far, so the list is never empty. The approved mock-up's count.
 */
export const NEAREST_COUNT = 12;

/**
 * The most cards Nearby lists while it follows the map: the best of the spots
 * in view, whose rest stand on the map as muted dots. A view of the whole of
 * Ireland is 149 spots, and each card is a loupe and a day's hours.
 */
export const MAX_CARDS = 30;

/** Today and the five days after it: the days the finder steps through. */
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

/** The `count` places nearest a point, however far, nearest first. */
export function nearestSpots<S extends Spot>(
  spots: readonly S[],
  at: LatLon,
  count = NEAREST_COUNT,
): { spot: S; km: number }[] {
  return spots
    .map((spot) => ({ spot, km: distanceKm(at, spot) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, count);
}

/**
 * The tab the finder opens on: the rider's favourites once they have
 * starred a place; before that, the places round them, so a first visit
 * is never an empty page.
 */
export const openingScope = (starred: readonly string[]): Scope =>
  starred.length ? "favourites" : "near";

/**
 * The tab in the finder's address, so Favourites and Near you can be linked
 * to, kept and reloaded: `/?tab=favourites`, `/?tab=near`. A bare `/` opens
 * on `openingScope`, and the address names a tab only once one is chosen.
 */
export const TAB_PARAM = "tab";

/** The tab an address names, or null for none (or one there is not). */
export function scopeInAddress(search: string): Scope | null {
  const tab = new URLSearchParams(search).get(TAB_PARAM);
  return tab === "favourites" || tab === "near" ? tab : null;
}

/** The address with `scope` as its tab, the rest of it kept as it was. */
export function scopeAddress(href: string, scope: Scope): string {
  const url = new URL(href);
  url.searchParams.set(TAB_PARAM, scope);
  return url.pathname + tidySearch(url.searchParams) + url.hash;
}

/**
 * How many places a search by name lists: the best matches, as many as
 * "near you" lists round a place that is not the rider's.
 */
export const FOUND_COUNT = NEAREST_COUNT;

/**
 * The places the finder lists for a scope, before they are ranked. `own` is
 * whether `at` is the rider's own place: round it, "near you" is every place
 * within NEAR_KM and each card says how far it is; round any other place it
 * is the nearest few, however far, and no card gives a distance from a
 * place the rider is not at.
 */
export function listFor<S extends Spot>(
  scope: Scope,
  spots: readonly S[],
  starred: readonly string[],
  at: LatLon | null,
  own = true,
): { spot: S; km: number | null }[] {
  if (scope === "near") {
    if (!at) return [];
    return own
      ? nearSpots(spots, at)
      : nearestSpots(spots, at).map(({ spot }) => ({ spot, km: null }));
  }
  const byId = new Map(spots.map((s) => [s.id, s] as const));
  return starred.flatMap((id) => {
    const spot = byId.get(id);
    return spot ? [{ spot, km: at && own ? distanceKm(at, spot) : null }] : [];
  });
}

/**
 * The places inside what the map shows, for Nearby beside it: those nearest
 * the view's middle first, so among equals the cap keeps what the rider is
 * looking at. `from` is the rider's own place, which each card measures from;
 * with none, no card gives a distance. A view past the antimeridian has a west
 * or an east beyond 180, as MapLibre gives it (`ViewBounds`), so longitudes are
 * measured round the world from its west edge.
 */
export function spotsInView<S extends Spot>(
  spots: readonly S[],
  view: ViewBounds,
  from: LatLon | null,
): { spot: S; km: number | null }[] {
  const { west, south, east, north } = view;
  const width = east - west;
  if (![west, south, east, north].every(Number.isFinite) || width < 0)
    return [];
  const middle = { lat: (south + north) / 2, lon: west + width / 2 };
  return spots
    .filter(
      ({ lat, lon }) =>
        lat >= south &&
        lat <= north &&
        (width >= 360 || (((lon - west) % 360) + 360) % 360 <= width),
    )
    .map((spot) => ({ spot, off: distanceKm(middle, spot) }))
    .sort((a, b) => a.off - b.off)
    .map(({ spot }) => ({ spot, km: from ? distanceKm(from, spot) : null }));
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

/**
 * Whether today is over on the finder: the hour now (`nearestHour`) is past
 * the end of today's row (`dayRow`, the hour after last light) at every
 * place listed, or at the middle of Ireland with none listed. At 19:59 on a
 * November evening, whose rows end at 18:00, it is.
 */
export function todayOver(places: readonly LatLon[], now: number): boolean {
  const date = irishDate(now);
  const current = nearestHour(now);
  return (places.length ? places : [IRELAND_CENTRE]).every((place) => {
    const light = dayLight(place, date);
    return !light || current > hourOf(light.lastLight) + HOUR;
  });
}

/**
 * The day the finder opens on, of `dates` (`cardDates`): today, and once
 * today is over (`todayOver`), tomorrow, so the evening's page is the day
 * ahead rather than a day of hours gone.
 */
export function openingDay(
  dates: readonly string[],
  places: readonly LatLon[],
  now: number,
): string {
  return dates.length > 1 && todayOver(places, now) ? dates[1] : dates[0];
}

/** The strip's columns by their time, for finding an hour's column. */
export function columnsByTime(
  strip: readonly Pick<StripColumn, "time">[],
): Map<number, number> {
  return new Map(strip.map((column, at) => [column.time, at] as const));
}

/** The top of the hour a time falls in. */
export const hourOf = (time: number) => Math.floor(time / HOUR) * HOUR;

/**
 * The hour a time is nearest: the hour the finder calls now, as a clock is
 * read (19:59 is 20:00, not 19:00). The cards' tick, the map's pill and the
 * lights beside the list all stand on it.
 */
export const nearestHour = (time: number) => Math.round(time / HOUR) * HOUR;

/** One column of a day's row: an hour, and the strip's column for it. */
export interface RowHour {
  /** The top of the hour (of the step, where the run is coarser). */
  time: number;
  /** Its column in the strip, or null where the forecast has none. */
  at: number | null;
  /** Before first light or after last light: shaded, and never rated. */
  dark: boolean;
  /** Over already. */
  gone: boolean;
  /** The hour now (`nearestHour`). */
  now: boolean;
}

export interface DayRow {
  date: string;
  firstLight: number;
  lastLight: number;
  hours: RowHour[];
}

/**
 * A day at a place, a column an hour: from the hour before first light to
 * the hour after last light (06:00 to 18:00 for an October light of 06:50 to
 * 17:33; 04:00 to 23:00 for June's 04:12 to 22:46), each with the strip's
 * column for it where there is one. The ends are the dark: shaded, and the
 * site rates no hour in it.
 *
 * Where the run is coarser than hourly (three-hourly a few days out) the row
 * is its steps, a column each, from the step before first light to the one
 * after last light: an hour between two steps has no column of its own and
 * is left out, not drawn empty. An hour before the strip begins has none
 * either, and is kept, empty (rare since 25 October 2026: the strip begins
 * at today's midnight, `dockColumns`); and so is the hour now where it falls
 * between the two ends and the strip steps over it. The hour now is never
 * added past either end: after dark, and before first light, it is not on
 * the row at all, and nothing on the row stands for it.
 */
export function dayRow(
  strip: readonly Pick<StripColumn, "time">[],
  place: LatLon,
  date: string,
  now: number,
  byTime: ReadonlyMap<number, number> = columnsByTime(strip),
): DayRow | null {
  const light = dayLight(place, date);
  if (!light) return null;
  const { firstLight, lastLight } = light;
  const start = strip.length ? strip[0].time : Infinity;
  const end = strip.length ? strip[strip.length - 1].time : -Infinity;
  // The whole hour before first light, even when first light is on the hour,
  // and the whole hour after last light; out to the run's own step either
  // side where it has none on the hour.
  let from = hourOf(firstLight - 1);
  let to = hourOf(lastLight) + HOUR;
  if (!byTime.has(from) && from > start)
    from = strip.reduce((t, c) => (c.time <= from ? c.time : t), from);
  if (!byTime.has(to) && to < end)
    to = strip.reduce((t, c) => (c.time >= to && c.time < t ? c.time : t), end);
  const current = nearestHour(now);
  const hours: RowHour[] = [];
  for (let time = from; time <= to; time += HOUR) {
    const at = byTime.get(time) ?? null;
    if (at === null && time >= start && time <= end && time !== current)
      continue;
    hours.push({
      time,
      at,
      dark: time < firstLight || time > lastLight,
      gone: time < current,
      now: time === current,
    });
  }
  return { date, firstLight, lastLight, hours };
}

/** Today at a place: its row of hours (`dayRow`). */
export const todayRow = (
  strip: readonly Pick<StripColumn, "time">[],
  place: LatLon,
  now: number,
  byTime?: ReadonlyMap<number, number>,
) => dayRow(strip, place, irishDate(now), now, byTime);

/** The stars an hour is worth, or null for one with none to give (dark, unrated). */
export const starsAt = (hour: PlaceHour | null | undefined): number | null =>
  hour?.rating ? hour.rating.stars : null;

/**
 * The column a day opens on: the one nearest 13:00, early afternoon, or the
 * last of them on a day already past it. Null for a day with no columns.
 */
export function middayColumn(
  strip: readonly Pick<StripColumn, "time">[],
  columns: readonly number[],
  now: number,
): number | null {
  if (!columns.length) return null;
  const score = (at: number) => {
    const time = strip[at].time;
    // Past hours are no use to a day ahead.
    if (time < hourOf(now)) return Infinity;
    return Math.abs(irishHour(time) + (time % HOUR) / HOUR - 13);
  };
  let best = columns[0];
  for (const at of columns) if (score(at) < score(best)) best = at;
  return score(best) === Infinity ? columns[columns.length - 1] : best;
}

/* ---- the order ------------------------------------------------------------ */

/** A place's best on some days: how many stars, and the first day it has them. */
export interface Best {
  stars: number;
  /** Which of the days, from 0; null with no stars on any. */
  day: number | null;
}

/**
 * The most stars a place has on some days, and the soonest of them it has
 * them: today's hours only from the hour now on, each day's only in its
 * light. The finder asks it of the day shown, so the list is in that day's
 * order. A place not yet rated has none (`stars` -1), and goes last.
 */
export function bestStars(
  row: readonly (PlaceHour | null | undefined)[] | undefined,
  strip: readonly Pick<StripColumn, "time" | "date">[],
  dates: readonly string[],
  now: number,
): Best {
  if (!row) return { stars: -1, day: null };
  const current = hourOf(now);
  let best: Best = { stars: 0, day: null };
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

/** A place on the list: how far it is, and its best on the day shown. */
export interface Listed<S extends Spot = Spot> {
  spot: S;
  /** From the rider, where that is known. */
  km: number | null;
  best: Best;
}

/**
 * The most stars first; among equals the soonest day they come, then the
 * nearer, then the order the places came in (the favourites' own, most
 * recently starred first).
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

/** How the rider has the list put in order: the best first, the nearest, or by name. */
export type Order = "best" | "near" | "name";

/**
 * A ranked list put in the rider's order. The best first is the ranking as
 * it stands (or a search's own order); the nearest needs the rider's place,
 * and a place with no distance goes last; by name is A to Z.
 */
export function orderSpots<S extends Spot>(
  list: readonly Listed<S>[],
  order: Order,
): Listed<S>[] {
  if (order === "best") return [...list];
  return list
    .map((item, at) => ({ item, at }))
    .sort((a, b) =>
      order === "near"
        ? (a.item.km ?? Infinity) - (b.item.km ?? Infinity) || a.at - b.at
        : a.item.spot.name.localeCompare(b.item.spot.name, "en-IE"),
    )
    .map(({ item }) => item);
}

/**
 * The places with at least `stars` stars at their best (on the day shown);
 * every place for none. A place not rated yet has none to show, and waits until
 * its stars are in.
 */
export function withStars<S extends Spot>(
  list: readonly Listed<S>[],
  stars: number,
): Listed<S>[] {
  if (stars <= 0) return [...list];
  return list.filter((item) => item.best.stars >= stars);
}

/**
 * The cards a list comes to: those with at least `stars` stars, the best
 * `cap` of them, in the rider's order. `total` is how many had the stars,
 * before the cap, which is the count the head of the list says.
 */
export function chooseCards<S extends Spot>(
  list: readonly Listed<S>[],
  order: Order,
  stars: number,
  cap = Infinity,
): { cards: Listed<S>[]; total: number } {
  const good = withStars(rankSpots(list), stars);
  return { cards: orderSpots(good.slice(0, cap), order), total: good.length };
}

/* ---- the hour picked -------------------------------------------------------- */

/**
 * The hour picked after a press on one of the day's: that hour, for every
 * card at once, or none again for the hour the day stands at with none
 * picked (now, today; on any other day, the hour it opens on).
 */
export const pickHour = (pressed: number, standing: number): number | null =>
  hourOf(pressed) === hourOf(standing) ? null : hourOf(pressed);

/**
 * The strip's column a day after today opens on, with no hour picked: its
 * early afternoon (`middayColumn`). Null for a day the strip has no column
 * in.
 */
export function dayOpening(
  strip: readonly Pick<StripColumn, "time" | "date">[],
  date: string,
  now: number,
): number | null {
  const columns: number[] = [];
  strip.forEach((column, at) => column.date === date && columns.push(at));
  return middayColumn(strip, columns, now);
}

/**
 * The strip's column a card's picture shows: the hour picked, or with none
 * the column the day opens on (today, the one the chart itself would open
 * on now; any other day, `dayOpening`). Null where the strip has no column
 * for the hour picked.
 */
export function shownColumn(
  strip: readonly Pick<StripColumn, "time">[],
  picked: number | null,
  opening: number | null,
  byTime: ReadonlyMap<number, number> = columnsByTime(strip),
): number | null {
  if (picked === null) return strip.length ? opening : null;
  return byTime.get(picked) ?? null;
}
