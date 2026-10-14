/**
 * The rider's starred and most-opened spots: the site's store
 * (shared/web/favourites.ts), under its key, in the device's localStorage.
 */
import { useMemo, useSyncExternalStore } from "react";
import { favourites, type FavouritesStore } from "../../../shared/web/favourites";

export function useFavourites(): {
  store: FavouritesStore;
  starred: readonly string[];
  frequent: readonly { id: string; count: number; last: number }[];
} {
  const store = favourites();
  const state = useSyncExternalStore(store.subscribe, store.get);
  // `frequent` reads the store, whose state is `state`: recomputed when it moves.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const frequent = useMemo(() => store.frequent(6), [store, state]);
  return { store, starred: state.starred, frequent };
}
