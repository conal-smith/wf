import { describe, expect, it } from "vitest";
import * as install from "../../../../ai/web/install";
import { windModels, type ModelAvailability } from "../../../../force5/src/manifests";
import { withRiderStarsFrom } from "../../../../force5/src/prefs";
import { DEFAULT_RIDER, rateOn, standardRating } from "../../../../force5/src/stars";
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
  pickStarsModel,
  spotOverrides,
  spotStarsRows,
  starsFromValue,
  starsModelRows,
  thenRows,
  thenTitle,
  parseWings,
  riderSummary,
  riderWords,
  starsOnSegments,
  toggleBlendModel,
  toggleWing,
  WING_SIZES,
} from "./settingsLogic";

describe("the rider", () => {
  it("says who the stars are for, as the site does", () => {
    expect(riderWords(DEFAULT_RIDER)).toBe("Riding · ~80 kg");
    expect(riderSummary({ weightKg: 72, skill: "beginner", wings: [4, 5.5] })).toBe(
      "Learning · 72 kg · 4, 5.5 m²",
    );
  });

  it("names a rider's own stars where the level was, only while they rate", () => {
    const custom = { ...DEFAULT_RIDER, custom: standardRating(DEFAULT_RIDER, "advanced") };
    expect(riderWords(custom)).toBe("Custom stars · ~80 kg");
    // Kept aside while a level rates: the level is who the stars are for.
    const kept = rateOn(custom, "beginner");
    expect(riderWords(kept)).toBe("Learning · ~80 kg");
    // A rider stored before custom ratings, or deleted: the level.
    expect(riderWords({ ...DEFAULT_RIDER, custom: null })).toBe("Riding · ~80 kg");
  });

  it("offers Custom on the level pill once the rider has a rating of their own, in use or kept", () => {
    const levels = ["beginner", "intermediate", "advanced"];
    expect(starsOnSegments(DEFAULT_RIDER).map((s) => s.value)).toEqual(levels);
    expect(customiseText(DEFAULT_RIDER)).toBe("Customise");
    const custom = { ...DEFAULT_RIDER, custom: standardRating(DEFAULT_RIDER, "advanced") };
    for (const rider of [custom, rateOn(custom, "advanced")]) {
      expect(starsOnSegments(rider).map((s) => s.value)).toEqual([...levels, "custom"]);
      expect(starsOnSegments(rider).at(-1)?.label).toBe("Custom");
      expect(customiseText(rider)).toBe("Edit custom");
    }
  });

  it("keeps the rider's own stars through a change of weight, level or wings", () => {
    const custom = standardRating(DEFAULT_RIDER, "advanced");
    const changed = changeRider({ ...DEFAULT_RIDER, custom }, { weightKg: 90, skill: "beginner" });
    expect(changed.custom).toEqual(custom);
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

describe("stars from", () => {
  it("says HARMONIE, then ECMWF until the rider chooses", () => {
    expect(starsFromValue(undefined)).toBe("HARMONIE, then ECMWF");
    expect(starsFromValue({ model: "icon-eu", then: "gfs" })).toBe("ICON-EU, then GFS");
    expect(thenTitle(undefined)).toBe("When HARMONIE ends");
  });

  it("lists every model to rate from, HARMONIE recommended, and the others to take over", () => {
    const rows = starsModelRows(undefined);
    expect(rows.map((r) => r.id)).toEqual(["harmonie", "icon-eu", "ecmwf", "gfs"]);
    expect(rows.filter((r) => r.on).map((r) => r.id)).toEqual(["harmonie"]);
    expect(rows[0].detail).toMatch(/recommended$/);
    expect(rows[1].detail).not.toMatch(/recommended/);
    const then = thenRows({ model: "icon-eu", then: "gfs" });
    expect(then.map((r) => r.id)).toEqual(["harmonie", "ecmwf", "gfs"]);
    expect(then.filter((r) => r.on).map((r) => r.id)).toEqual(["gfs"]);
  });

  it("keeps the model and the one that takes over two", () => {
    const from = { model: "harmonie", then: "ecmwf" };
    expect(pickStarsModel(from, "gfs")).toEqual({ model: "gfs" });
    // ECMWF rating everywhere hands the takeover to HARMONIE, not to itself.
    expect(pickStarsModel(from, "ecmwf")).toEqual({ model: "ecmwf", then: "harmonie" });
    expect(pickStarsModel(from, "harmonie")).toEqual({ model: "harmonie" });
  });

  it("writes the rider through the site's prefs", () => {
    const rider = withRiderStarsFrom(DEFAULT_RIDER, {
      everywhere: pickStarsModel({ model: "harmonie", then: "ecmwf" }, "ecmwf"),
    });
    expect(rider.starsFrom).toEqual({ model: "ecmwf", then: "harmonie" });
    // Back to the default, the rider is as they always were.
    const back = withRiderStarsFrom(rider, { everywhere: { model: "harmonie", then: "ecmwf" } });
    expect(back).toEqual(DEFAULT_RIDER);
  });

  it("offers a spot the same as everywhere, or a model of its own", () => {
    const choice = { model: "harmonie", then: "ecmwf", spots: { portrane: "gfs" } };
    const rows = spotStarsRows(choice, "portrane");
    expect(rows.map((r) => r.value)).toEqual(["same", "icon-eu", "ecmwf", "gfs"]);
    expect(rows[0].label).toBe("Same as everywhere (HARMONIE)");
    expect(rows.find((r) => r.on)?.value).toBe("gfs");
    expect(spotStarsRows(choice, "brandon").find((r) => r.on)?.value).toBe("same");
    expect(spotOverrides(choice)).toEqual([{ id: "portrane", model: "gfs", name: "GFS" }]);
    expect(spotOverrides(undefined)).toEqual([]);
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
