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
  withStarsOn,
  type Prefs,
  type PrefsStorage,
} from "./prefs";
import { windModels } from "./manifests";
import { DEFAULT_RIDER, standardRating } from "./stars";

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
  it("rates for the estimated rider until the reader says otherwise", () => {
    expect(defaultPrefs().rider).toEqual({
      weightKg: null,
      skill: "intermediate",
      wings: [],
    });
  });
  it("keeps a stored rider only where each field is a real person's or a real wing's", () => {
    expect(
      parseRider({ weightKg: 72.4, skill: "advanced", wings: [6, 4, 4, 5.5] }),
    ).toEqual({ weightKg: 72, skill: "advanced", wings: [4, 5.5, 6] });
    expect(
      parseRider({ weightKg: 900, skill: "pro", wings: [0.2, "5", 30, 3] }),
    ).toEqual({ weightKg: null, skill: "intermediate", wings: [3] });
    expect(parseRider("heavy")).toEqual(defaultPrefs().rider);
  });
  it("keeps how high the rider points only when it is not typical", () => {
    const base = { weightKg: null, skill: "intermediate", wings: [] };
    expect(parseRider({ ...base, pointing: "sharp" }).pointing).toBe("sharp");
    expect(parseRider({ ...base, pointing: "cautious" }).pointing).toBe(
      "cautious",
    );
    // Typical is the default, and anything else is not a pointing at all.
    expect(parseRider({ ...base, pointing: "typical" })).toEqual(base);
    expect(parseRider({ ...base, pointing: "very" })).toEqual(base);
    expect(parseRider({ ...base, pointing: 10 })).toEqual(base);
    // Kept on the device, as the weight and the level are.
    const storage = fakeStorage();
    saveRider(parseRider({ ...base, pointing: "sharp" }), storage);
    expect(loadPrefs(storage).rider.pointing).toBe("sharp");
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
    const own = standardRating(DEFAULT_RIDER, "advanced");
    const at = new Date("2026-10-18T10:00:00Z");
    const saved = withCustomStars(defaultPrefs(), own, at);
    expect(saved.rider.custom).toEqual(own);
    expect(saved.starsUpdatedAt).toBe("2026-10-18T10:00:00.000Z");
    savePrefs(saved, storage);
    const loaded = loadPrefs(storage);
    expect(loaded.rider.custom).toEqual(own);
    expect(loaded.starsUpdatedAt).toBe("2026-10-18T10:00:00.000Z");
    // A reset is a change too, stamped, and leaves no custom field behind.
    const reset = withCustomStars(
      loaded,
      null,
      new Date("2026-10-18T11:00:00Z"),
    );
    expect("custom" in reset.rider).toBe(false);
    expect(reset.starsUpdatedAt).toBe("2026-10-18T11:00:00.000Z");
  });

  it("reads preferences saved before custom stars as the standard rating", () => {
    const storage = fakeStorage({
      [PREFS_KEY]: JSON.stringify({
        units: "mph",
        rider: { weightKg: 90, skill: "beginner", wings: [5] },
      }),
    });
    const loaded = loadPrefs(storage);
    expect(loaded.rider).toEqual({
      weightKg: 90,
      skill: "beginner",
      wings: [5],
    });
    expect(loaded.starsUpdatedAt).toBeNull();
    expect(loaded.starsAccount).toBeNull();
  });

  it("drops a stored star rating it cannot read, or from another version, and clamps the rest", () => {
    const own = standardRating(DEFAULT_RIDER);
    const load = (custom: unknown) =>
      loadPrefs(
        fakeStorage({
          [PREFS_KEY]: JSON.stringify({
            rider: { ...DEFAULT_RIDER, custom },
            starsUpdatedAt: "not a time",
          }),
        }),
      );
    expect(load({ ...own, version: 2 }).rider.custom).toBeUndefined();
    expect(load({ ...own, wind: null }).rider.custom).toBeUndefined();
    expect(load("custom").rider.custom).toBeUndefined();
    expect(
      load({ ...own, direction: { ...own.direction, offshore: 11 } }).rider
        .custom!.direction.offshore,
    ).toBe(5);
    expect(load(own).starsUpdatedAt).toBeNull();
  });

  it("keeps the rider's own rating while a level rates, and goes back to it", () => {
    const storage = fakeStorage();
    const own = standardRating(DEFAULT_RIDER, "advanced");
    const saved = withCustomStars(
      defaultPrefs(),
      own,
      new Date("2026-10-18T10:00:00Z"),
    );
    // A level picked: it rates, the rating is kept, and the change stamped.
    const level = withStarsOn(
      saved,
      "beginner",
      new Date("2026-10-18T11:00:00Z"),
    );
    expect(level.rider).toEqual({
      ...DEFAULT_RIDER,
      skill: "beginner",
      keptCustom: own,
    });
    expect(level.starsUpdatedAt).toBe("2026-10-18T11:00:00.000Z");
    savePrefs(level, storage);
    expect(JSON.parse(storage.data.get(PREFS_KEY)!).version).toBe(
      PREFS_VERSION,
    );
    expect(loadPrefs(storage).rider).toEqual(level.rider);
    // Another level: still off the rider's own, so nothing for the account.
    const other = withStarsOn(
      level,
      "advanced",
      new Date("2026-10-18T12:00:00Z"),
    );
    expect(other.rider.keptCustom).toEqual(own);
    expect(other.starsUpdatedAt).toBe(level.starsUpdatedAt);
    // Custom again: the same rating rates, the level stays as it was.
    const back = withStarsOn(other, "custom", new Date("2026-10-18T13:00:00Z"));
    expect(back.rider).toEqual({
      ...DEFAULT_RIDER,
      skill: "advanced",
      custom: own,
    });
    expect(back.starsUpdatedAt).toBe("2026-10-18T13:00:00.000Z");
    // Custom with none saved changes nothing.
    expect(withStarsOn(defaultPrefs(), "custom").rider).toEqual(DEFAULT_RIDER);
    // Saving makes it rate; deleting leaves neither behind.
    const edited = standardRating(DEFAULT_RIDER, "beginner");
    expect(withCustomStars(level, edited).rider).toEqual({
      ...DEFAULT_RIDER,
      skill: "beginner",
      custom: edited,
    });
    const gone = withCustomStars(level, null);
    expect("custom" in gone.rider || "keptCustom" in gone.rider).toBe(false);
  });

  it("keeps the stored rating, rating or kept, through a change of weight, level or wings", () => {
    const own = standardRating(DEFAULT_RIDER, "advanced");
    const storage = fakeStorage();
    savePrefs(
      withStarsOn(withCustomStars(defaultPrefs(), own), "beginner"),
      storage,
    );
    const next = saveRider({ ...DEFAULT_RIDER, weightKg: 70 }, storage);
    expect(next.rider).toEqual({
      ...DEFAULT_RIDER,
      weightKg: 70,
      keptCustom: own,
    });
  });

  it("reads a version 1 rider's own rating as saved and in use", () => {
    const own = standardRating(DEFAULT_RIDER, "advanced");
    const v1 = (rider: object) =>
      loadPrefs(
        fakeStorage({
          [PREFS_KEY]: JSON.stringify({
            rider: { ...DEFAULT_RIDER, ...rider },
            starsUpdatedAt: "2026-10-18T10:00:00.000Z",
          }),
        }),
      );
    expect(v1({ custom: own }).rider).toEqual({
      ...DEFAULT_RIDER,
      custom: own,
    });
    // Version 1 never wrote a kept rating: one there is not read.
    expect(v1({ keptCustom: own }).rider).toEqual(DEFAULT_RIDER);
    // Version 2: both read, and never both at once.
    const v2 = loadPrefs(
      fakeStorage({
        [PREFS_KEY]: JSON.stringify({
          version: 2,
          rider: { ...DEFAULT_RIDER, custom: own, keptCustom: own },
        }),
      }),
    );
    expect(v2.rider).toEqual({ ...DEFAULT_RIDER, custom: own });
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
