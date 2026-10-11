import { describe, expect, it } from "vitest";
import {
  FAVOURITES_KEY,
  localFavourites,
  type FavouritesState,
} from "../shared/web/favourites";
import type { Spot } from "../force5/src/weather";
import { firstStarred, lastSpot, openingSpot } from "./openingSpot";

const spot = (id: string): Spot => ({
  id,
  name: id,
  county: "Kerry",
  lat: 53,
  lon: -9,
  note: "",
});
const SPOTS = ["brandon", "keel", "rusheen", "dollymount"].map(spot);

const none: FavouritesState = { starred: [], visits: {} };
const visits = (...list: [string, number][]): FavouritesState["visits"] =>
  Object.fromEntries(list.map(([id, last]) => [id, { id, count: 1, last }]));

function memory(seed: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(seed));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

describe("openingSpot", () => {
  const state: FavouritesState = {
    starred: ["dollymount"],
    visits: visits(["keel", 10], ["rusheen", 30]),
  };

  it("takes the spot named in the link over everything else", () => {
    expect(openingSpot("?spot=brandon", SPOTS, state)).toEqual({
      spot: SPOTS[0],
      why: "link",
    });
  });

  it("then the spot chosen last, by when, not by how often", () => {
    const often = {
      ...state,
      visits: {
        ...state.visits,
        keel: { id: "keel", count: 40, last: 10 },
      },
    };
    expect(openingSpot("", SPOTS, often)).toEqual({
      spot: SPOTS[2],
      why: "last",
    });
  });

  it("then the first starred spot, when nothing has been chosen", () => {
    expect(
      openingSpot("", SPOTS, { starred: ["keel", "brandon"], visits: {} }),
    ).toEqual({ spot: SPOTS[1], why: "starred" });
  });

  it("and otherwise no spot at all: there is no default place", () => {
    expect(openingSpot("", SPOTS, none)).toBeNull();
    expect(openingSpot("?spot=", SPOTS, none)).toBeNull();
  });

  it("passes over a link to a place the catalogue does not hold", () => {
    expect(openingSpot("?spot=atlantis", SPOTS, state)?.why).toBe("last");
    expect(openingSpot("?spot=atlantis", SPOTS, none)).toBeNull();
  });

  it("falls down the list when the remembered spots have gone", () => {
    // The last chosen has left the catalogue: the one chosen before it.
    expect(
      openingSpot("", SPOTS, {
        starred: [],
        visits: visits(["keel", 10], ["gone", 99]),
      }),
    ).toEqual({ spot: SPOTS[1], why: "last" });
    // Every visit has gone: the first star still here.
    expect(
      openingSpot("", SPOTS, {
        starred: ["vanished", "brandon"],
        visits: visits(["gone", 99]),
      }),
    ).toEqual({ spot: SPOTS[0], why: "starred" });
    // And nothing left at all: no spot.
    expect(
      openingSpot("", SPOTS, {
        starred: ["vanished"],
        visits: visits(["gone", 99]),
      }),
    ).toBeNull();
  });
});

describe("lastSpot and firstStarred", () => {
  it("ignore a visit whose time is not a number", () => {
    expect(
      lastSpot({ visits: visits(["keel", Number.NaN], ["brandon", 1]) }, SPOTS)
        ?.id,
    ).toBe("brandon");
  });

  it("find nothing in an empty store", () => {
    expect(lastSpot(none, SPOTS)).toBeUndefined();
    expect(firstStarred(none, SPOTS)).toBeUndefined();
  });
});

describe("the remembered spot, through the favourites store", () => {
  it("is the spot chosen last, kept across page loads", () => {
    const storage = memory();
    const store = localFavourites(storage);
    store.visit("keel", 1);
    store.visit("keel", 2);
    store.visit("brandon", 3);
    const reloaded = localFavourites(storage).get();
    expect(openingSpot("", SPOTS, reloaded)?.spot.id).toBe("brandon");
  });

  it("is the spot chosen last even when the clock has not moved", () => {
    const store = localFavourites(memory());
    store.visit("keel", 7);
    store.visit("dollymount", 7);
    expect(openingSpot("", SPOTS, store.get())?.spot.id).toBe("dollymount");
  });

  it("starring alone, with nothing chosen, opens on the first star", () => {
    const storage = memory();
    localFavourites(storage).toggle("rusheen");
    expect(
      openingSpot("", SPOTS, localFavourites(storage).get()),
    ).toMatchObject({ spot: { id: "rusheen" }, why: "starred" });
  });

  it("opens on no spot over a store it cannot read", () => {
    for (const raw of [
      "{not json",
      "null",
      '"brandon"',
      '{"visits":{"brandon":{"count":"many","last":"today"}}}',
      '{"visits":[["brandon",1]],"starred":"brandon"}',
    ]) {
      const state = localFavourites(memory({ [FAVOURITES_KEY]: raw })).get();
      expect(openingSpot("", SPOTS, state), raw).toBeNull();
    }
  });
});
