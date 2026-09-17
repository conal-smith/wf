import { describe, expect, it } from "vitest";
import {
  PREFS_KEY,
  defaultPrefs,
  loadPrefs,
  savePrefs,
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
      rain: true,
      cloud: false,
      pressure: false,
      sea: false,
      tide: true,
    });
    expect(prefs.blendModels).toEqual(windModels().map((model) => model.id));
    expect(prefs.blendModels).toContain("ecmwf-ens");
    expect(prefs.blendModels).not.toContain("ukv");
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
  it("reports a failed write without throwing", () => {
    expect(savePrefs(defaultPrefs(), brokenStorage())).toBe(false);
    expect(savePrefs(defaultPrefs(), null)).toBe(false);
  });
});
