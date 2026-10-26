import { describe, expect, it } from "vitest";
import * as install from "../../../../ai/web/install";
import { windModels, type ModelAvailability } from "../../../../force5/src/manifests";
import { parseStarsChoice } from "../../../../force5/src/lead";
import { loadPrefs, withRiderModel } from "../../../../force5/src/prefs";
import { DEFAULT_RIDER, oursCopy } from "../../../../force5/src/stars";
import {
  changeRider,
  claudeCodeLine,
  customiseText,
  claudeConnectorLink,
  codexLines,
  EXAMPLE_QUESTIONS,
  geminiLines,
  mcpEndpoint,
  modelRows,
  parseWeight,
  MODEL_NOTE,
  modelChoiceRows,
  modelStarsLine,
  modelValue,
  parseWings,
  riderSummary,
  riderWords,
  starsName,
  toggleBlendModel,
  toggleWing,
  WING_SIZES,
} from "./settingsLogic";

describe("the rider", () => {
  const own = () => {
    const custom = oursCopy();
    custom.wind.sweetHigh = 25;
    return custom;
  };

  it("says who the stars are for: ours, and the weight", () => {
    expect(riderWords(DEFAULT_RIDER)).toBe("Ours · ~80 kg");
    expect(riderSummary({ weightKg: 72, wings: [4, 5.5] })).toBe("Ours · 72 kg · 4, 5.5 m²");
    expect(starsName(DEFAULT_RIDER)).toBe("Ours");
    expect(customiseText(DEFAULT_RIDER)).toBe("Customise");
  });

  it("names a rider's own stars once they have made them their own", () => {
    const rider = { ...DEFAULT_RIDER, weightKg: 80, custom: own() };
    expect(riderWords(rider)).toBe("Your own stars · 80 kg");
    expect(customiseText(rider)).toBe("Edit your stars");
    // Deleted, or stored before there were any: ours.
    expect(riderWords({ ...DEFAULT_RIDER, custom: null })).toBe("Ours · ~80 kg");
  });

  it("keeps the rider's own stars and angles through a change of weight or wings", () => {
    const rider = { ...DEFAULT_RIDER, custom: own(), upwind: 20 };
    const changed = changeRider(rider, { weightKg: 90, wings: [5] });
    expect(changed).toEqual({ ...rider, weightKg: 90, wings: [5] });
  });

  it("drops an old level and gust setting rather than keeping them", () => {
    const old = { ...DEFAULT_RIDER, skill: "beginner", gusty: "a-lot" } as unknown as Partial<typeof DEFAULT_RIDER>;
    expect(changeRider(DEFAULT_RIDER, old)).toEqual(DEFAULT_RIDER);
  });

  it("takes only what a person and a wing can be", () => {
    expect(parseWeight("72")).toBe(72);
    expect(parseWeight("72,4")).toBe(72);
    expect(parseWeight("12")).toBeNull();
    expect(parseWeight("")).toBeNull();
    expect(parseWings("4, 5.5 5,5 12 1")).toEqual([4, 5.5]);
    expect(changeRider(DEFAULT_RIDER, { weightKg: 500 }).weightKg).toBeNull();
    expect(changeRider(DEFAULT_RIDER, { wings: [6, 4, 4] }).wings).toEqual([4, 6]);
  });

  it("toggles a wing in the quiver", () => {
    expect(toggleWing([4], 5)).toEqual([4, 5]);
    expect(toggleWing([4, 5], 4)).toEqual([5]);
    expect(WING_SIZES[0]).toBe(2);
    expect(WING_SIZES.at(-1)).toBe(8);
  });
});

describe("the models", () => {
  const ids = windModels().map((m) => m.id);

  it("keeps at least one model in the blend, in the registry's order", () => {
    expect(toggleBlendModel([ids[0]], ids[0], false, ids)).toEqual([ids[0]]);
    expect(toggleBlendModel([ids[1]], ids[0], true, ids)).toEqual([ids[0], ids[1]]);
  });

  it("says what each model answered", () => {
    const entry = windModels()[0];
    const answered = {
      id: entry.id,
      entry,
      manifest: null,
      wind: { runTime: "2026-10-14T06:00:00Z" },
      wave: null,
      weather: null,
      available: true,
      error: null,
    } as unknown as ModelAvailability;
    const rows = modelRows(windModels(), [answered], [entry.id], true);
    expect(rows[0]).toMatchObject({ on: true, answered: true, status: "Run Wed 07:00" });
    expect(rows[1]).toMatchObject({ on: false, answered: false, status: "Reading…" });
    expect(modelRows(windModels(), [], [], false)[0].status).toBe("");
  });
});

describe("the model", () => {
  it("says HARMONIE until the rider chooses", () => {
    expect(modelValue(undefined)).toBe("HARMONIE");
    expect(modelValue({ model: "icon-eu" })).toBe("ICON-EU");
  });

  it("lists every model to pick, HARMONIE recommended", () => {
    const rows = modelChoiceRows(undefined);
    expect(rows.map((r) => r.id)).toEqual(["harmonie", "icon-eu", "ecmwf", "gfs"]);
    expect(rows.filter((r) => r.on).map((r) => r.id)).toEqual(["harmonie"]);
    expect(rows[0].detail).toMatch(/recommended$/);
    expect(rows[1].detail).not.toMatch(/recommended/);
    expect(modelChoiceRows({ model: "gfs" }).filter((r) => r.on).map((r) => r.id)).toEqual(["gfs"]);
  });

  it("writes the rider through the site's prefs", () => {
    const rider = withRiderModel(DEFAULT_RIDER, "ecmwf");
    expect(rider.starsFrom).toEqual({ model: "ecmwf" });
    // Back to the default, the rider is as they always were.
    expect(withRiderModel(rider, "harmonie")).toEqual(DEFAULT_RIDER);
  });

  it("loads an old choice of a fallback and spots of their own as the model alone", () => {
    const old = { model: "gfs", then: "harmonie", spots: { portrane: "icon-eu" } };
    expect(parseStarsChoice(old)).toEqual({ model: "gfs" });
    expect(modelChoiceRows(parseStarsChoice(old)).find((r) => r.on)?.id).toBe("gfs");
    const stored = JSON.stringify({ rider: { ...DEFAULT_RIDER, starsFrom: old } });
    const storage = { getItem: () => stored, setItem: () => {} };
    expect(loadPrefs(storage).rider.starsFrom).toEqual({ model: "gfs" });
  });

  it("never says Stars from, and keeps the stars the model's own under the blend", () => {
    expect(MODEL_NOTE).not.toMatch(/stars from/i);
    expect(MODEL_NOTE).toMatch(/ECMWF/);
    expect(modelStarsLine(undefined)).toBe(
      "The stars stay your model's own: HARMONIE's, then ECMWF's past the end of its run.",
    );
    expect(modelStarsLine({ model: "ecmwf" })).toBe("The stars stay your model's own: ECMWF's.");
  });
});

describe("the AI assistant", () => {
  const url = mcpEndpoint("https://api.wingfoil.ie/");

  it("hands out the site's address and lines, word for word", () => {
    expect(url).toBe("https://api.wingfoil.ie/api/mcp");
    expect(url).toBe(install.mcpUrl("https://api.wingfoil.ie/", "https://wingfoil.ie"));
    expect(claudeConnectorLink(url)).toBe(install.claudeLink(url));
    expect(claudeCodeLine(url)).toBe(install.claudeCodeCommand(url));
    expect(codexLines(url)).toBe(install.codexConfig(url));
    expect(geminiLines(url)).toBe(install.geminiConfig(url));
    expect(EXAMPLE_QUESTIONS).toEqual(install.EXAMPLE_PROMPTS);
  });
});
