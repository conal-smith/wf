import { describe, expect, it } from "vitest";
import {
  PREFS_KEY,
  defaultPrefs,
  loadPrefs,
  parseRider,
  rowOn,
  savePrefs,
  setRow,
  type Prefs,
  type PrefsStorage,
} from "./prefs";
import { windModels } from "./manifests";

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
});
