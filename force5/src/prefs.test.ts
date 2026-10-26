import { describe, expect, it } from "vitest";
import {
  PREFS_KEY,
  PREFS_VERSION,
  defaultPrefs,
  loadPrefs,
  parseRider,
  rowOn,
  savePrefs,
  setRow,
  saveRider,
  withCustomStars,
  withRiderModel,
  type Prefs,
  type PrefsStorage,
} from "./prefs";
import { windModels } from "./manifests";
import { DEFAULT_RIDER, OURS, oursCopy, type CustomRating } from "./stars";

/** A rider's own rating: ours with a few numbers moved. */
const mine = (max = 30): CustomRating => ({
  ...oursCopy(),
  wind: { ...OURS.wind, max },
  direction: { ...OURS.direction, onshore: 1 },
});

const fakeStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};
const brokenStorage = (): PrefsStorage => ({
  getItem() {
    throw new Error("storage disabled");
  },
  setItem() {
    throw new Error("storage disabled");
  },
});

describe("display preferences", () => {
  it("defaults to the blend view with the per-model rows off", () => {
    const prefs = defaultPrefs();
    expect(prefs.view).toBe("blend");
    expect(prefs.units).toBe("kn");
    expect(prefs.rows).toEqual({
      stars: true,
      wing: false,
      blend: true,
      waveOverlay: false,
      wind: false,
      spread: true,
      gust: false,
      dir: false,
      waves: true,
      swell: false,
      windsea: false,
      weather: true,
      air: true,
      rain: false,
      cloud: false,
      pressure: false,
      sea: false,
      tide: true,
    });
    expect(prefs.blendModels).toEqual(windModels().map((model) => model.id));
    expect(prefs.blendModels).not.toContain("ecmwf-ens");
    expect(prefs.blendModels).not.toContain("ukv");
  });
  it("rates for the estimated rider, on ours, until the reader says otherwise", () => {
    expect(defaultPrefs().rider).toEqual({
      weightKg: null,
      wings: [],
    });
  });
  it("keeps a stored rider only where each field is a real person's or a real wing's", () => {
    expect(parseRider({ weightKg: 72.4, wings: [6, 4, 4, 5.5] })).toEqual({
      weightKg: 72,
      wings: [4, 5.5, 6],
    });
    expect(parseRider({ weightKg: 900, wings: [0.2, "5", 30, 3] })).toEqual({
      weightKg: null,
      wings: [3],
    });
    expect(parseRider("heavy")).toEqual(defaultPrefs().rider);
  });
  it("ignores what the rider used to carry: a level, gusty wind, a kept rating, a pointing", () => {
    expect(
      parseRider({
        weightKg: 70,
        skill: "advanced",
        gusty: "lots",
        keptCustom: mine(),
        pointing: "sharp",
        wings: [],
      }),
    ).toEqual({ weightKg: 70, wings: [] });
  });
  it("keeps the degrees into the wind only when they are not ours, 0°", () => {
    const base = { weightKg: null, wings: [] };
    expect(parseRider({ ...base, upwind: 30 }).upwind).toBe(30);
    expect(parseRider({ ...base, upwind: 0 })).toEqual(base);
    // Whole degrees, held to 0–45; anything else is not a number of degrees.
    expect(parseRider({ ...base, upwind: 12.4 }).upwind).toBe(12);
    expect(parseRider({ ...base, upwind: 60 }).upwind).toBe(45);
    expect(parseRider({ ...base, upwind: -5 })).toEqual(base);
    expect(parseRider({ ...base, upwind: "30" })).toEqual(base);
    expect(parseRider({ ...base, upwind: Number.NaN })).toEqual(base);
    // Kept on the device, as the weight is.
    const storage = fakeStorage();
    saveRider(parseRider({ ...base, upwind: 27 }), storage);
    expect(loadPrefs(storage).rider.upwind).toBe(27);
  });
  it("keeps the degrees below across only when they are not ours, 10°", () => {
    const base = { weightKg: null, wings: [] };
    expect(parseRider({ ...base, downwind: 30 }).downwind).toBe(30);
    expect(parseRider({ ...base, downwind: 0 }).downwind).toBe(0);
    expect(parseRider({ ...base, downwind: 10 })).toEqual(base);
    expect(parseRider({ ...base, downwind: 70 }).downwind).toBe(45);
    expect(parseRider({ ...base, downwind: "5" })).toEqual(base);
    const storage = fakeStorage();
    saveRider(parseRider({ ...base, downwind: 25 }), storage);
    expect(loadPrefs(storage).rider.downwind).toBe(25);
  });
  it("starts with no row touched by hand", () => {
    expect(defaultPrefs().touchedRows).toEqual([]);
  });
  it("gives every caller its own mutable copy", () => {
    const first = defaultPrefs();
    first.blendModels.push("ukv");
    expect(defaultPrefs().blendModels).not.toContain("ukv");
  });
  it("round-trips through a storage fake", () => {
    const storage = fakeStorage();
    const prefs: Prefs = {
      ...defaultPrefs(),
      units: "km/h",
      view: "candles",
      nightHours: "hide",
      blendModels: ["ecmwf", "gfs"],
      rows: { ...defaultPrefs().rows, gust: true, tide: false },
    };
    expect(savePrefs(prefs, storage)).toBe(true);
    expect(storage.data.has(PREFS_KEY)).toBe(true);
    expect(loadPrefs(storage)).toEqual(prefs);
  });
  it("adds a model published since the blend list was saved, and keeps the reader's choices", () => {
    const live = windModels().map((model) => model.id);
    const storage = fakeStorage({
      [PREFS_KEY]: JSON.stringify({
        blendModels: ["ecmwf"],
        // Saved when every live model but GFS existed, so GFS is new.
        blendKnown: live.filter((id) => id !== "gfs"),
      }),
    });
    const loaded = loadPrefs(storage).blendModels;
    expect(loaded).toEqual(["ecmwf", "gfs"]);
    // Whatever else was there and left out stays out.
    expect(loaded).not.toContain("harmonie");
  });
  it("takes a blend list saved before models were recorded as it stands", () => {
    const storage = fakeStorage({
      [PREFS_KEY]: JSON.stringify({ blendModels: ["ecmwf", "gfs"] }),
    });
    expect(loadPrefs(storage).blendModels).toEqual(["ecmwf", "gfs"]);
  });
  it("drops a model retired since the blend list was saved", () => {
    // Saved when AIFS was live: it is no longer published, so not counted.
    const storage = fakeStorage({
      [PREFS_KEY]: JSON.stringify({
        blendModels: ["harmonie", "ecmwf", "aifs"],
        blendKnown: [...windModels().map((model) => model.id), "aifs"],
      }),
    });
    expect(loadPrefs(storage).blendModels).toEqual(["harmonie", "ecmwf"]);
    // A list of nothing but retired models is no choice at all: the default.
    const only = fakeStorage({
      [PREFS_KEY]: JSON.stringify({ blendModels: ["arome", "aifs"] }),
    });
    expect(loadPrefs(only).blendModels).toEqual(
      windModels().map((model) => model.id),
    );
  });
  it("shows the night's hours unless the reader has hidden them", () => {
    expect(defaultPrefs().nightHours).toBe("show");
    const stored = (nightHours: unknown) =>
      loadPrefs(fakeStorage({ [PREFS_KEY]: JSON.stringify({ nightHours }) }))
        .nightHours;
    expect(stored("hide")).toBe("hide");
    expect(stored("show")).toBe("show");
    expect(stored(undefined)).toBe("show");
    expect(stored(false)).toBe("show");
    expect(stored("dark")).toBe("show");
  });
  it("merges partial and unknown stored values over the defaults", () => {
    const storage = fakeStorage({
      [PREFS_KEY]: JSON.stringify({
        rows: { gust: true, unknownRow: true, tide: "yes" },
        units: "beaufort",
        view: "ribbon",
        blendModels: ["ecmwf", "ecmwf", "gfs"],
      }),
    });
    const prefs = loadPrefs(storage);
    expect(prefs.touchedRows).toEqual([]);
    expect(prefs.rows.gust).toBe(true);
    expect(prefs.rows.tide).toBe(true);
    expect(prefs.rows).not.toHaveProperty("unknownRow");
    expect(prefs.units).toBe("kn");
    expect(prefs.view).toBe("blend");
    expect(prefs.blendModels).toEqual(["ecmwf", "gfs"]);
  });
  it("falls back to the defaults for junk, empty and hostile storage", () => {
    expect(loadPrefs(fakeStorage({ [PREFS_KEY]: "not json" }))).toEqual(
      defaultPrefs(),
    );
    expect(loadPrefs(fakeStorage({ [PREFS_KEY]: "null" }))).toEqual(
      defaultPrefs(),
    );
    expect(loadPrefs(fakeStorage())).toEqual(defaultPrefs());
    expect(loadPrefs(null)).toEqual(defaultPrefs());
    expect(loadPrefs(brokenStorage())).toEqual(defaultPrefs());
  });
  it("keeps only real row keys among the touched rows", () => {
    const storage = fakeStorage({
      [PREFS_KEY]: JSON.stringify({ touchedRows: ["sea", "nonsense", 7] }),
    });
    expect(loadPrefs(storage).touchedRows).toEqual(["sea"]);
    expect(
      loadPrefs(
        fakeStorage({ [PREFS_KEY]: JSON.stringify({ touchedRows: 3 }) }),
      ).touchedRows,
    ).toEqual([]);
  });
  it("lets availability decide an untouched row and the reader decide a touched one", () => {
    const prefs = defaultPrefs();
    // A row with no availability answer is simply its stored boolean.
    expect(rowOn(prefs, "sea")).toBe(false);
    expect(rowOn(prefs, "air")).toBe(true);
    // With one, an untouched row follows it in both directions.
    expect(rowOn(prefs, "sea", true)).toBe(true);
    expect(rowOn(prefs, "sea", false)).toBe(false);
    // Switching it by hand takes it out of availability's hands for good.
    const off = setRow(prefs, "sea", false);
    expect(off.touchedRows).toEqual(["sea"]);
    expect(rowOn(off, "sea", true)).toBe(false);
    const on = setRow(off, "sea", true);
    expect(on.touchedRows).toEqual(["sea"]);
    expect(rowOn(on, "sea", false)).toBe(true);
    // And it survives a round trip through storage.
    const storage = fakeStorage();
    savePrefs(on, storage);
    expect(rowOn(loadPrefs(storage), "sea", false)).toBe(true);
    // The original is untouched: preferences are replaced, never mutated.
    expect(prefs.touchedRows).toEqual([]);
    expect(prefs.rows.sea).toBe(false);
  });
  it("reports a failed write without throwing", () => {
    expect(savePrefs(defaultPrefs(), brokenStorage())).toBe(false);
    expect(savePrefs(defaultPrefs(), null)).toBe(false);
  });

  it("keeps the rider's own star rating, stamped, through storage", () => {
    const storage = fakeStorage();
    const own = mine();
    const at = new Date("2026-10-18T10:00:00Z");
    const saved = withCustomStars(defaultPrefs(), own, at);
    expect(saved.rider.custom).toEqual(own);
    expect(saved.starsUpdatedAt).toBe("2026-10-18T10:00:00.000Z");
    savePrefs(saved, storage);
    expect(JSON.parse(storage.data.get(PREFS_KEY)!).version).toBe(
      PREFS_VERSION,
    );
    const loaded = loadPrefs(storage);
    expect(loaded.rider.custom).toEqual(own);
    expect(loaded.starsUpdatedAt).toBe("2026-10-18T10:00:00.000Z");
    // Back to ours is a change too, stamped, and leaves no custom field behind.
    const reset = withCustomStars(
      loaded,
      null,
      new Date("2026-10-18T11:00:00Z"),
    );
    expect("custom" in reset.rider).toBe(false);
    expect(reset.starsUpdatedAt).toBe("2026-10-18T11:00:00.000Z");
    // So is saving ours as it stands: nothing of their own is kept.
    expect("custom" in withCustomStars(loaded, oursCopy()).rider).toBe(false);
  });

  it("starts everyone stored before 25 October 2026 from ours, keeping weight, wings and model", () => {
    const old = (version: number | undefined) =>
      loadPrefs(
        fakeStorage({
          [PREFS_KEY]: JSON.stringify({
            version,
            units: "mph",
            rider: {
              weightKg: 90,
              skill: "beginner",
              gusty: "lots",
              wings: [5],
              upwind: 30,
              starsFrom: { model: "gfs" },
              custom: {
                version: 2,
                base: "beginner",
                wind: { min: 13, sweetLow: 15, sweetHigh: 20, max: 24 },
                direction: {
                  onshore: 0,
                  crossOn: 0,
                  cross: 0,
                  crossOff: 3,
                  offshore: 5,
                },
              },
              keptCustom: mine(),
            },
          }),
        }),
      );
    for (const version of [undefined, 1, 2]) {
      const loaded = old(version);
      expect(loaded.units).toBe("mph");
      expect(loaded.rider).toEqual({
        weightKg: 90,
        wings: [5],
        starsFrom: { model: "gfs" },
      });
    }
  });

  it("drops a stored star rating it cannot read, or from another version, and clamps the rest", () => {
    const own = mine();
    const load = (custom: unknown) =>
      loadPrefs(
        fakeStorage({
          [PREFS_KEY]: JSON.stringify({
            version: PREFS_VERSION,
            rider: { ...DEFAULT_RIDER, custom },
            starsUpdatedAt: "not a time",
          }),
        }),
      );
    expect(load(own).rider.custom).toEqual(own);
    expect(load({ ...own, version: 2 }).rider.custom).toBeUndefined();
    expect(load({ ...own, wind: null }).rider.custom).toBeUndefined();
    expect(load("custom").rider.custom).toBeUndefined();
    expect(
      load({ ...own, direction: { ...own.direction, crossOff: 11 } }).rider
        .custom!.direction.crossOff,
    ).toBe(5);
    // Ours, stored as their own, is no rating of their own.
    expect(load(oursCopy()).rider.custom).toBeUndefined();
    expect(load(own).starsUpdatedAt).toBeNull();
  });

  it("keeps the stored rating through a change of weight, wings or angles", () => {
    const own = mine();
    const storage = fakeStorage();
    savePrefs(withCustomStars(defaultPrefs(), own), storage);
    const next = saveRider(
      { ...DEFAULT_RIDER, weightKg: 70, upwind: 15 },
      storage,
    );
    expect(next.rider).toEqual({
      ...DEFAULT_RIDER,
      weightKg: 70,
      upwind: 15,
      custom: own,
    });
  });
});

describe("the model the stars come from", () => {
  it("is the default for a rider who never chose, and stays out of what is stored", () => {
    expect(loadPrefs(fakeStorage()).rider.starsFrom).toBeUndefined();
    expect(
      parseRider({
        ...DEFAULT_RIDER,
        starsFrom: { model: "harmonie", then: "ecmwf" },
      }),
    ).toEqual(DEFAULT_RIDER);
  });

  it("is kept with the rider and survives a reload", () => {
    const storage = fakeStorage();
    const gfs = withRiderModel(DEFAULT_RIDER, "gfs");
    expect(gfs.starsFrom).toEqual({ model: "gfs" });
    savePrefs({ ...defaultPrefs(), rider: gfs }, storage);
    expect(loadPrefs(storage).rider).toEqual(gfs);
    expect(withRiderModel(gfs, "harmonie")).toEqual(DEFAULT_RIDER);
  });

  it("keeps an old saved model, and ignores its fallback and its spots of their own", () => {
    const storage = fakeStorage({
      [PREFS_KEY]: JSON.stringify({
        rider: {
          ...DEFAULT_RIDER,
          starsFrom: {
            model: "icon-eu",
            then: "gfs",
            spots: { portrane: "harmonie" },
          },
        },
      }),
    });
    expect(loadPrefs(storage).rider.starsFrom).toEqual({ model: "icon-eu" });
  });

  it("drops a stored model that is no longer offered", () => {
    expect(
      parseRider({
        ...DEFAULT_RIDER,
        starsFrom: { model: "arpege", then: "gfs" },
      }).starsFrom,
    ).toBeUndefined();
  });
});
