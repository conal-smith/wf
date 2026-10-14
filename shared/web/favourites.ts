/**
 * A rider's spots: the ones they star, and the ones they keep opening. Kept on
 * this device for now (localStorage, best effort: private browsing, blocked
 * storage and quota errors never break the page). A signed-in sync can
 * implement `FavouritesStore` later and be swapped in without touching callers.
 *
 * Shared by the map (its "Your spots" panel, popup and dock) and the spot page,
 * so a star set on one shows on the other, and a change in another tab arrives
 * through `subscribe`.
 */

export interface SpotVisit {
  id: string;
  /** How many times the spot has been opened. */
  count: number;
  /** When it was last opened, ms since the epoch. */
  last: number;
}

export interface FavouritesState {
  /** Starred spot ids, most recently starred first. */
  starred: string[];
  /** Opened spots, keyed by id. */
  visits: Record<string, SpotVisit>;
}

export interface FavouritesStore {
  get(): FavouritesState;
  isStarred(id: string): boolean;
  /** Star or unstar; returns the new state of that spot. */
  toggle(id: string): boolean;
  /** Count an opening of a spot (a popup, the dock or its page). */
  visit(id: string, now?: number): void;
  /**
   * The spots to show as "spots you look at": visited, not starred, ranked by
   * opens with recency breaking ties, at most `limit`.
   */
  frequent(limit?: number): SpotVisit[];
  /** Called with the new state on every change here or in another tab. */
  subscribe(listener: (state: FavouritesState) => void): () => void;
}

export const FAVOURITES_KEY = "wingfoil.spots.v1";
const MAX_VISITS = 60;

const empty = (): FavouritesState => ({ starred: [], visits: {} });

function parse(raw: string | null): FavouritesState {
  if (!raw) return empty();
  try {
    const v = JSON.parse(raw) as Partial<FavouritesState>;
    const starred = Array.isArray(v.starred)
      ? v.starred.filter((s): s is string => typeof s === "string")
      : [];
    const visits: Record<string, SpotVisit> = {};
    for (const [id, x] of Object.entries(v.visits ?? {}))
      if (x && typeof x.count === "number" && typeof x.last === "number")
        visits[id] = { id, count: x.count, last: x.last };
    return { starred: [...new Set(starred)], visits };
  } catch {
    return empty();
  }
}

/** The device's store. Pass a Storage for tests. */
export function localFavourites(
  storage: Storage | null = safeStorage(),
): FavouritesStore {
  const listeners = new Set<(state: FavouritesState) => void>();
  let state = parse(read(storage));

  const save = (next: FavouritesState) => {
    state = next;
    try {
      storage?.setItem(FAVOURITES_KEY, JSON.stringify(next));
    } catch {
      // Best effort: the change still holds for this page.
    }
    listeners.forEach((l) => l(state));
  };

  // Another tab's change. React Native has a `window` with no events, so ask
  // for the method, not only the object.
  if (
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
  )
    window.addEventListener("storage", (e) => {
      if (e.key !== FAVOURITES_KEY) return;
      state = parse(e.newValue);
      listeners.forEach((l) => l(state));
    });

  return {
    get: () => state,
    isStarred: (id) => state.starred.includes(id),
    toggle(id) {
      const on = !state.starred.includes(id);
      save({
        ...state,
        starred: on
          ? [id, ...state.starred]
          : state.starred.filter((s) => s !== id),
      });
      return on;
    },
    visit(id, now = Date.now()) {
      const prev = state.visits[id];
      // Stamped after every earlier opening, so the last one chosen is the
      // latest even when the clock stands still or has been turned back: the
      // map opens on it next time (src/openingSpot.ts).
      const latest = Math.max(
        0,
        ...Object.values(state.visits).map((v) => v.last),
      );
      const visits = {
        ...state.visits,
        [id]: {
          id,
          count: (prev?.count ?? 0) + 1,
          last: now > latest ? now : latest + 1,
        },
      };
      // Keep the list bounded: forget the least recently opened.
      const ids = Object.keys(visits);
      if (ids.length > MAX_VISITS)
        ids
          .sort((a, b) => visits[a].last - visits[b].last)
          .slice(0, ids.length - MAX_VISITS)
          .forEach((k) => delete visits[k]);
      save({ ...state, visits });
    },
    frequent(limit = 5) {
      return Object.values(state.visits)
        .filter((v) => !state.starred.includes(v.id))
        .sort((a, b) => b.count - a.count || b.last - a.last)
        .slice(0, limit);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(storage: Storage | null): string | null {
  try {
    return storage?.getItem(FAVOURITES_KEY) ?? null;
  } catch {
    return null;
  }
}

let shared: FavouritesStore | null = null;
/** The page's one store. */
export function favourites(): FavouritesStore {
  return (shared ??= localFavourites());
}
