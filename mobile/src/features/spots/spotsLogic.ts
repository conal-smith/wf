/**
 * The Spots tab's arithmetic: each of a rider's places at the hour the chart
 * shows (its stars and wind, never a day's best), the places they keep
 * opening, and the nearest places to them.
 */
import type { HourRating } from "../../../../force5/src/stars";
import type { Units } from "../../../../force5/src/units";
import type { Spot } from "../../../../force5/src/weather";
import type { PlaceHour } from "../../../../src/ratings";
import { clock, dayShort, type StripColumn } from "../../../../src/strip";
import { windFigures } from "../dock/dockLogic";

/** A place at one hour: unknown until its hours are read, nothing where the hour is not rated. */
export type SpotHour =
  | { kind: "unread" }
  | { kind: "unrated" }
  | { kind: "rated"; rating: HourRating; wind: string };

/** A place's hour at the chart's selected column. */
export function spotHour(
  hours: readonly PlaceHour[] | null | undefined,
  column: number,
  units: Units,
): SpotHour {
  if (!hours) return { kind: "unread" };
  const hour = hours[column];
  if (!hour?.rating) return { kind: "unrated" };
  return { kind: "rated", rating: hour.rating, wind: windFigures(hour, units) };
}

/** "Sat 15:00": the hour the list is read at. */
export const whenLabel = (column: Pick<StripColumn, "time"> | undefined) =>
  column ? `${dayShort(column.time)} ${clock(column.time)}` : "";

/** "Sat 15:00, 4 stars, wind 14 g22 · WSW": the hour, spoken. */
export function hourWords(at: SpotHour, label: string): string {
  if (at.kind === "unread") return `${label} not read yet`;
  if (at.kind === "unrated") return `${label} not rated`;
  const { stars } = at.rating;
  return `${label}, ${stars} star${stars === 1 ? "" : "s"}, wind ${at.wind}`;
}

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
