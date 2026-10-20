import type { Spot } from "../force5/src/weather";
import { spotFromSearch } from "./locations";

/**
 * The spot the map's dock opens on, if any: only a spot named in the link
 * (`?spot=keel`), which focuses the chart on it as a shared link always has.
 * Nothing else opens the dock as the page loads, not the spot this visitor
 * chose last nor their first star: the chart opens on the whole of Ireland
 * and every light, with nothing at its foot, and the dock comes with the
 * first spot, light or point the reader taps. There is no default place.
 */
export function openingSpot(
  search: string,
  spots: readonly Spot[],
): Spot | null {
  return spotFromSearch(search, spots) ?? null;
}

/**
 * The map's address with `id` as its spot, or with none: each spot chosen,
 * from its light, the search or the list, is written into the link
 * (`/?spot=keel`), so it can be shared and Back goes to the one before. The
 * rest of the address is kept as it was.
 */
export function spotAddress(href: string, id: string | null): string {
  const url = new URL(href);
  if (id) url.searchParams.set("spot", id);
  else url.searchParams.delete("spot");
  return url.pathname + url.search + url.hash;
}
