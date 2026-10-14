/**
 * Every riding place, bundled: the site's base spots (public/spots.json)
 * merged with the researched and the owner's places (src/locations.ts), each
 * with the shore it faces. A new place reaches the app with the next update,
 * as it reaches the site with the next deploy.
 */
import base from "../../../public/spots.json";
import { ridingLocations } from "../../../src/locations";
import type { Spot } from "../../../force5/src/weather";

let all: Spot[] | null = null;
let byId: Map<string, Spot> | null = null;

export function allSpots(): readonly Spot[] {
  return (all ??= ridingLocations(base as Spot[]));
}

export function spotById(id: string): Spot | undefined {
  byId ??= new Map(allSpots().map((spot) => [spot.id, spot]));
  return byId.get(id);
}

/** Case- and accent-blind: "Inch" finds "Inch Strand", "Ballinskelligs" finds "Baile an Sceilg". */
const fold = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function searchSpots(query: string, limit = 40): Spot[] {
  const q = fold(query.trim());
  if (!q) return [];
  const scored: [number, Spot][] = [];
  for (const spot of allSpots()) {
    const names = [spot.name, ...(spot.aliases ?? [])].map(fold);
    const county = fold(spot.county ?? "");
    const at = Math.min(...names.map((n) => (n.startsWith(q) ? 0 : n.includes(q) ? 1 : 9)));
    const score = at < 9 ? at : county.startsWith(q) ? 2 : 9;
    if (score < 9) scored.push([score, spot]);
  }
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
    .slice(0, limit)
    .map(([, spot]) => spot);
}

/** Great-circle kilometres, for "nearest you". */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
