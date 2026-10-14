/**
 * The Spots tab's arithmetic: each of a rider's places with every day's best
 * stars (the dock's `dayBest`, after now), the places they keep opening, and
 * the nearest places to them.
 */
import type { Spot } from "../../../../force5/src/weather";
import type { PlaceHour } from "../../../../src/ratings";
import { dayBest, dayShort, type StripColumn, type StripDay } from "../../../../src/strip";

/** One day's verdict at a place: unknown until its hours are read, never "no stars". */
export type DayStars =
  | { kind: "unread"; date: string; label: string }
  | { kind: "dark"; date: string; label: string }
  | { kind: "rated"; date: string; label: string; stars: number; potential: number };

/** The days a row shows: today and the six after it. */
export const WEEK = 7;

/** Each day's best stars still ahead at one place. */
export function weekStars(
  hours: readonly PlaceHour[] | null | undefined,
  days: readonly StripDay[],
  strip: readonly StripColumn[],
  now: number,
  count = WEEK,
): DayStars[] {
  const times = strip.map((c) => c.time);
  const ratings = hours?.map((h) => h.rating) ?? null;
  return days.slice(0, count).map((day) => {
    const label = dayShort(day.noon);
    if (!ratings) return { kind: "unread", date: day.date, label };
    const best = dayBest(ratings, day, now, times);
    if (!best) return { kind: "dark", date: day.date, label };
    return {
      kind: "rated",
      date: day.date,
      label,
      stars: best.stars,
      potential: ratings[best.from]?.potential ?? best.stars,
    };
  });
}

/** "Sat 4 stars, Sun 2 stars, Mon not read yet": the week, spoken. */
export function weekWords(week: readonly DayStars[]): string {
  return week
    .map((d) =>
      d.kind === "rated"
        ? `${d.label} ${d.stars} star${d.stars === 1 ? "" : "s"}`
        : d.kind === "dark"
          ? `${d.label} nothing left to ride`
          : `${d.label} not read yet`,
    )
    .join(", ");
}

/** The week's best day at a place, for the row's summary. */
export const weekTop = (week: readonly DayStars[]) =>
  week.reduce((top, d) => (d.kind === "rated" && d.stars > top ? d.stars : top), 0);

/** Great-circle kilometres. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** The places nearest a point, nearest first, with their distances. */
export function nearest(
  spots: readonly Spot[],
  here: { lat: number; lon: number },
  count = 8,
): { spot: Spot; km: number }[] {
  return spots
    .map((spot) => ({ spot, km: distanceKm(here, spot) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, count);
}

/** "3.2 km", "48 km". */
export const kmText = (km: number) => (km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`);

/** The rider's places, in their order, dropping any id no longer a place. */
export function placesFor(ids: readonly string[], byId: (id: string) => Spot | undefined): Spot[] {
  return ids.flatMap((id) => {
    const spot = byId(id);
    return spot ? [spot] : [];
  });
}
