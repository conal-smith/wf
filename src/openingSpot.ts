import type { FavouritesState } from "../shared/web/favourites";
import type { Spot } from "../force5/src/weather";
import { spotFromSearch } from "./locations";

/**
 * Why the dock opened on the spot it did. Only a link focuses the chart on it
 * (and flies there): a remembered or starred spot fills the dock and lights up
 * on the chart, and the chart still opens on the whole of Ireland.
 */
export type OpeningReason = "link" | "last" | "starred";

export interface Opening {
  spot: Spot;
  why: OpeningReason;
}

/**
 * The riding place this visitor chose most recently, from the visits the
 * favourites store keeps (shared/web/favourites, `wingfoil.spots.v1`): every
 * spot chosen on the map or opened on its own page counts one, stamped with
 * when. A visit to an id the catalogue no longer holds is passed over, so a
 * spot that has gone falls back to the one chosen before it.
 */
export function lastSpot<S extends Pick<Spot, "id">>(
  state: Pick<FavouritesState, "visits">,
  spots: readonly S[],
): S | undefined {
  const byId = new Map(spots.map((spot) => [spot.id, spot] as const));
  let best: { spot: S; last: number } | undefined;
  for (const visit of Object.values(state.visits)) {
    const spot = byId.get(visit.id);
    if (!spot || !Number.isFinite(visit.last)) continue;
    if (!best || visit.last > best.last) best = { spot, last: visit.last };
  }
  return best?.spot;
}

/** The first of the visitor's stars that is still a riding place. */
export function firstStarred<S extends Pick<Spot, "id">>(
  state: Pick<FavouritesState, "starred">,
  spots: readonly S[],
): S | undefined {
  for (const id of state.starred) {
    const spot = spots.find((s) => s.id === id);
    if (spot) return spot;
  }
  return undefined;
}

/**
 * The spot the map's dock opens on, if any: a spot named in the link
 * (`?spot=keel`), else the last one this visitor chose, else their first star,
 * else none at all — a first visit sees the whole of Ireland and every light,
 * and picks for itself. There is no default place.
 */
export function openingSpot(
  search: string,
  spots: readonly Spot[],
  state: FavouritesState,
): Opening | null {
  const linked = spotFromSearch(search, spots);
  if (linked) return { spot: linked, why: "link" };
  const last = lastSpot(state, spots);
  if (last) return { spot: last, why: "last" };
  const starred = firstStarred(state, spots);
  if (starred) return { spot: starred, why: "starred" };
  return null;
}
