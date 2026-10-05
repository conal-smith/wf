import { describe, expect, it } from "vitest";
import { FAVOURITES_KEY, localFavourites } from "./favourites";

function memory(): Storage {
  const m = new Map<string, string>();
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

describe("favourites", () => {
  it("stars and unstars, most recent first, and keeps it on the device", () => {
    const storage = memory();
    const f = localFavourites(storage);
    expect(f.toggle("brandon")).toBe(true);
    expect(f.toggle("dollymount")).toBe(true);
    expect(f.get().starred).toEqual(["dollymount", "brandon"]);
    expect(f.toggle("brandon")).toBe(false);
    expect(localFavourites(storage).get().starred).toEqual(["dollymount"]);
  });

  it("ranks the spots you open by count, then recency, leaving out starred ones", () => {
    const f = localFavourites(memory());
    f.visit("rusheen", 1);
    f.visit("rusheen", 2);
    f.visit("keel", 3);
    f.visit("inch", 4);
    f.visit("brandon", 5);
    f.toggle("brandon");
    expect(f.frequent().map((v) => v.id)).toEqual(["rusheen", "inch", "keel"]);
  });

  it("tells subscribers of every change", () => {
    const f = localFavourites(memory());
    const seen: string[][] = [];
    const off = f.subscribe((s) => seen.push(s.starred));
    f.toggle("keel");
    off();
    f.toggle("inch");
    expect(seen).toEqual([["keel"]]);
  });

  it("survives bad or blocked storage", () => {
    const storage = memory();
    storage.setItem(FAVOURITES_KEY, "{not json");
    expect(localFavourites(storage).get()).toEqual({ starred: [], visits: {} });
    const blocked = {
      ...memory(),
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as Storage;
    const f = localFavourites(blocked);
    expect(f.toggle("brandon")).toBe(true);
    expect(f.isStarred("brandon")).toBe(true);
  });
});
