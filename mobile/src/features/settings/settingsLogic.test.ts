import { describe, expect, it } from "vitest";
import * as install from "../../../../ai/web/install";
import { windModels, type ModelAvailability } from "../../../../force5/src/manifests";
import { DEFAULT_RIDER } from "../../../../force5/src/stars";
import {
  changeRider,
  claudeCodeLine,
  claudeConnectorLink,
  codexLines,
  EXAMPLE_QUESTIONS,
  geminiLines,
  mcpEndpoint,
  modelRows,
  parseWeight,
  parseWings,
  riderSummary,
  riderWords,
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
