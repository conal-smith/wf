import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER, type Rider } from "../../force5/src/stars";
import { FIXTURE_NOW, fixtureSource } from "../../mcp/api/testing";
import { shoreFacing as mapFacing } from "../../src/locations";
import type { ChatContext } from "../shared/protocol";
import { ratedSpots, shoreFacing } from "./spots";
import { dublinDayStart } from "./time";
import {
  TOOLS,
  TOOL_DEFINITIONS,
  riderFrom,
  toolNamed,
  type ToolContext,
} from "./tools";

const context: ChatContext = {
  spot: { id: "brandon", name: "Brandon Bay" },
  time: null,
  rider: null,
  now: new Date(FIXTURE_NOW).toISOString(),
};

function ctx(rider: Rider = DEFAULT_RIDER): ToolContext {
  let n = 0;
  return {
    source: fixtureSource(),
    now: FIXTURE_NOW,
    rider,
    context,
    newId: () => `id-${++n}`,
  };
}

const run = (name: string, input: unknown, c = ctx()) =>
  toolNamed(name)!.run(input, c);

describe("the tool definitions", () => {
  it("are sorted, strict and closed, with every property required", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual([
      "find_sessions",
      "get_spot_forecast",
      "list_spots",
      "propose_rider_profile",
      "show_on_map",
    ]);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.strict).toBe(true);
      const schema = tool.input_schema as {
        properties: Record<string, unknown>;
        required: string[];
        additionalProperties: boolean;
      };
      expect(schema.additionalProperties).toBe(false);
      expect([...schema.required].sort()).toEqual(
        Object.keys(schema.properties).sort(),
      );
    }
    expect(TOOLS).toHaveLength(5);
  });
});

describe("shore facing", () => {
  it("is the map's own facing for every published spot", async () => {
    for (const spot of await ratedSpots(fixtureSource()))
      expect(shoreFacing(spot.id), spot.id).toBe(mapFacing(spot.id));
    expect(shoreFacing("dollymount")).toBe(125); // a hand override
  });
});

describe("riderFrom", () => {
  it("keeps what a person can be and drops the rest", () => {
    expect(riderFrom(null)).toEqual(DEFAULT_RIDER);
    expect(
      riderFrom({ weightKg: 84.6, skill: "advanced", wings: [6, 4, 4, 42] }),
    ).toEqual({
      weightKg: 85,
      skill: "advanced",
      wings: [4, 6],
    });
    expect(
      riderFrom({ weightKg: 900, skill: "beginner", wings: [] }).weightKg,
    ).toBeNull();
  });
});

describe("dublinDayStart", () => {
  it("finds midnight in Irish summer and winter time", () => {
    expect(new Date(dublinDayStart("2026-09-17")!).toISOString()).toBe(
      "2026-09-16T23:00:00.000Z",
    );
    expect(new Date(dublinDayStart("2026-12-01")!).toISOString()).toBe(
      "2026-12-01T00:00:00.000Z",
    );
    expect(dublinDayStart("tomorrow")).toBeNull();
  });
});

describe("get_spot_forecast", () => {
  it("rates the spot for the rider and hands the browser a card", async () => {
    const out = await run("get_spot_forecast", {
      spot: "brandon",
      date: null,
      days: null,
    });
    expect(out.isError).toBeFalsy();
    const result = out.result as any;
    expect(result.spot).toMatchObject({
      id: "brandon",
      name: "Brandon Bay",
      shore_facing_deg: 101,
    });
    expect(result.rider).toEqual({
      weight_kg: 80,
      weight_assumed: true,
      level: "Riding",
      wings_m2: [],
    });
    expect(result.daylight_hours.length).toBeGreaterThan(0);
    for (const hour of result.daylight_hours) {
      expect(hour.stars === null || (hour.stars >= 0 && hour.stars <= 5)).toBe(
        true,
      );
      if (hour.stars !== null)
        expect(hour.potential).toBeGreaterThanOrEqual(hour.stars);
    }
    expect(out.cards).toHaveLength(1);
    const card = out.cards![0];
    expect(card).toMatchObject({
      kind: "spot",
      id: "brandon",
      county: "Kerry",
    });
    expect(card.rider).toEqual({
      weightKg: 80,
      assumed: true,
      skill: "intermediate",
    });
    if (card.best) {
      expect(card.best.stars).toBeGreaterThanOrEqual(1);
      expect(card.best.local).toMatch(/\d{2}:\d{2}–\d{2}:\d{2}$/);
      expect(Date.parse(card.best.to)).toBeGreaterThan(
        Date.parse(card.best.from),
      );
      expect(card.best.shore).not.toBeNull();
      expect(result.best_window.why_not_more_stars).toBeInstanceOf(Array);
    } else expect(card.note).toBeTruthy();
  });

  it("uses the rider's own wings", async () => {
    const out = await run(
      "get_spot_forecast",
      { spot: "Brandon Bay", date: null, days: null },
      ctx({ weightKg: 90, skill: "advanced", wings: [3, 4.5, 6] }),
    );
    const result = out.result as any;
    expect(result.rider.weight_assumed).toBe(false);
    const hour = result.daylight_hours.find((h: any) => h.own_wing_m2 !== null);
    expect([3, 4.5, 6]).toContain(hour.own_wing_m2);
  });

  it("asks which spot when a name is ambiguous, and refuses a day that has gone", async () => {
    const ambiguous = await run("get_spot_forecast", {
      spot: "bay",
      date: null,
      days: null,
    });
    expect(ambiguous.isError).toBe(true);
    expect(JSON.stringify(ambiguous.result)).toMatch(/could be any of/);
    const past = await run("get_spot_forecast", {
      spot: "brandon",
      date: "2026-09-01",
      days: null,
    });
    expect(past.isError).toBe(true);
    expect(JSON.stringify(past.result)).toMatch(/already passed/);
  });

  it("refuses input that does not match its schema", async () => {
    const out = await run("get_spot_forecast", {
      spot: "",
      date: "soon",
      days: 9,
    });
    expect(out.isError).toBe(true);
    expect(out.result).toHaveProperty("INVALID_INPUT");
  });
});

describe("find_sessions", () => {
  it("ranks spots by their best window and shows the top three", async () => {
    const out = await run("find_sessions", {
      date: null,
      days: null,
      county: null,
      min_stars: null,
    });
    expect(out.isError).toBeFalsy();
    const result = out.result as any;
    expect(result.searched.spots).toBeGreaterThan(10);
    const stars = result.spots.map((s: any) => s.best_window.stars);
    expect(stars).toEqual([...stars].sort((a: number, b: number) => b - a));
    expect(out.cards!.length).toBe(Math.min(3, result.spots.length));
    expect(out.cards!.map((c) => c.id)).toEqual(
      result.spots.slice(0, 3).map((s: any) => s.id),
    );
  });

  it("narrows to a county and to a floor of stars", async () => {
    const out = await run("find_sessions", {
      date: null,
      days: 2,
      county: "kerry",
      min_stars: 2,
    });
    const result = out.result as any;
    for (const spot of result.spots) {
      expect(spot.county).toBe("Kerry");
      expect(spot.best_window.stars).toBeGreaterThanOrEqual(2);
    }
    const none = await run("find_sessions", {
      date: null,
      days: null,
      county: "Atlantis",
      min_stars: null,
    });
    expect(none.isError).toBe(true);
  });
});

describe("list_spots", () => {
  it("finds spots by name or county", async () => {
    const byName = await run("list_spots", {
      query: "dollymount",
      county: null,
    });
    expect((byName.result as any).spots[0]).toMatchObject({
      id: "dollymount",
      county: "Dublin",
    });
    const byCounty = await run("list_spots", { query: null, county: "Kerry" });
    expect(
      (byCounty.result as any).spots.every((s: any) => s.county === "Kerry"),
    ).toBe(true);
  });
});

describe("show_on_map", () => {
  it("turns a request into map actions", async () => {
    const out = await run("show_on_map", {
      spot_id: "brandon",
      time: "2026-09-17T12:00:00Z",
      highlight_ids: ["brandon", "dollymount"],
    });
    expect(out.actions).toEqual([
      { type: "highlight_spots", ids: ["brandon", "dollymount"] },
      { type: "select_spot", id: "brandon" },
      { type: "set_time", iso: "2026-09-17T12:00:00.000Z" },
    ]);
  });

  it("refuses spots that do not exist and times outside the forecast", async () => {
    expect(
      (
        await run("show_on_map", {
          spot_id: "atlantis",
          time: null,
          highlight_ids: null,
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await run("show_on_map", {
          spot_id: null,
          time: "2020-01-01T00:00:00Z",
          highlight_ids: null,
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await run("show_on_map", {
          spot_id: null,
          time: null,
          highlight_ids: null,
        })
      ).isError,
    ).toBe(true);
  });
});

describe("propose_rider_profile", () => {
  it("proposes, merging over the current profile, and saves nothing", async () => {
    const out = await run(
      "propose_rider_profile",
      { weight_kg: 85.2, level: null, wings_m2: [6, 4, 5, 5.2] },
      ctx({ weightKg: null, skill: "advanced", wings: [] }),
    );
    expect(out.proposal).toEqual({
      id: "id-1",
      rider: { weightKg: 85, skill: "advanced", wings: [4, 5, 6] },
      summary: "Save 85 kg · Advanced · 4/5/6 m?",
    });
    expect(JSON.stringify(out.result)).toMatch(/Not saved yet/);
  });

  it("refuses a weight or a wing no rider has", async () => {
    expect(
      (
        await run("propose_rider_profile", {
          weight_kg: 12,
          level: null,
          wings_m2: null,
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await run("propose_rider_profile", {
          weight_kg: null,
          level: null,
          wings_m2: [25],
        })
      ).isError,
    ).toBe(true);
  });
});
