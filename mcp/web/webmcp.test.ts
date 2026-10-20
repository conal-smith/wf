import { describe, expect, it, vi } from "vitest";
import { FIXTURE_NOW, fixtureSource } from "../api/testing";
import { CARE, FORECAST_TOOLS } from "../api/tools";
import {
  modelContext,
  registerTools,
  webTools,
  type ModelContextLike,
  type PageDeps,
  type WebMcpTool,
} from "./webmcp";

function page(overrides: Partial<PageDeps> = {}) {
  const navigate = vi.fn();
  const deps: PageDeps = {
    source: fixtureSource(),
    now: () => FIXTURE_NOW,
    location: { pathname: "/", search: "" },
    favourites: {
      get: () => ({ starred: [], visits: {} }),
      frequent: () => [],
    },
    navigate,
    ...overrides,
  };
  const tools = webTools(deps);
  const call = (name: string, input: unknown = {}) =>
    tools.find((t) => t.name === name)!.execute(input) as Promise<
      Record<string, any>
    >;
  return { tools, call, navigate };
}

describe("WebMCP", () => {
  it("finds the model context on document, else on navigator", () => {
    const context = { registerTool() {} };
    expect(modelContext({ modelContext: context }, {})).toBe(context);
    expect(modelContext({}, { modelContext: context })).toBe(context);
    expect(modelContext({ modelContext: {} }, {})).toBeUndefined();
    expect(modelContext({}, {})).toBeUndefined();
  });

  it("offers the server's tools, then the page's own", () => {
    const { tools } = page();
    expect(tools.map((t) => t.name)).toEqual([
      ...FORECAST_TOOLS.map((t) => t.name),
      "my_spots",
      "open_spot",
    ]);
    expect(
      tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name),
    ).toEqual(["open_spot"]);
    const forecast = tools.find((t) => t.name === "get_spot_forecast")!;
    expect(forecast.description).toContain(CARE);
    expect(forecast.inputSchema).toMatchObject({
      type: "object",
      required: ["spot"],
      properties: { hours: { type: "integer", maximum: 240 } },
    });
  });

  it("forecasts a spot as the server does, as plain JSON", async () => {
    const { call } = page();
    const forecast = await call("get_spot_forecast", {
      spot: "Brandon Bay",
      hours: 6,
    });
    expect(forecast.spot.id).toBe("brandon");
    expect(forecast.hours).toHaveLength(6);
    expect(JSON.parse(JSON.stringify(forecast))).toEqual(forecast);
  });

  it("answers bad arguments and failures with an error, not a throw", async () => {
    const { call } = page();
    expect(
      (await call("get_spot_forecast", { spot: "dollymount", hours: 10000 }))
        .error,
    ).toMatch(/hours/);
    expect((await call("find_wind", { min_kn: 20, max_kn: 10 })).error).toMatch(
      /max_kn/,
    );
    expect(
      (await call("get_spot_forecast", { spot: "Timbuktu" })).error,
    ).toMatch(/list_spots/);
  });

  it("tells the agent which spots are this visitor's", async () => {
    const { call } = page({
      location: { pathname: "/spot/brandon", search: "" },
      favourites: {
        get: () => ({ starred: ["dollymount", "gone-spot"], visits: {} }),
        frequent: () => [{ id: "brandon", count: 3, last: 1 }],
      },
    });
    const mine = await call("my_spots");
    expect(mine.viewing.id).toBe("brandon");
    expect(mine.starred.map((s: { id: string }) => s.id)).toEqual([
      "dollymount",
    ]);
    expect(mine.frequent.map((s: { id: string }) => s.id)).toEqual(["brandon"]);

    const onMap = await page({
      location: { pathname: "/", search: "?spot=dollymount" },
    }).call("my_spots");
    expect(onMap.viewing.id).toBe("dollymount");
    expect((await page().call("my_spots")).viewing).toBeNull();
  });

  it("opens a spot's page or the map on it, and asks when unsure", async () => {
    const { call, navigate } = page();
    expect(await call("open_spot", { spot: "Brandon Bay" })).toMatchObject({
      opened: "/spot/brandon",
    });
    expect(navigate).toHaveBeenLastCalledWith("/spot/brandon");
    await call("open_spot", { spot: "dollymount", view: "map" });
    expect(navigate).toHaveBeenLastCalledWith("/?spot=dollymount");
    navigate.mockClear();
    expect((await call("open_spot", { spot: "beach" })).error).toMatch(
      /Ask which/,
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("registers every tool it can, and takes them all back", () => {
    const registered: string[] = [];
    let signal: AbortSignal | undefined;
    const legacy = vi.fn();
    const context: ModelContextLike = {
      registerTool(tool, options) {
        if (tool.name === "b") throw new Error("taken");
        registered.push(tool.name);
        signal = options?.signal;
        return { unregister: legacy };
      },
      unregisterTool: vi.fn(),
    };
    const tool = (name: string): WebMcpTool => ({
      name,
      title: name,
      description: name,
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: true },
      execute: async () => ({}),
    });
    const stop = registerTools(context, [tool("a"), tool("b"), tool("c")]);
    expect(registered).toEqual(["a", "c"]);
    expect(signal!.aborted).toBe(false);
    stop();
    expect(signal!.aborted).toBe(true);
    expect(legacy).toHaveBeenCalledTimes(2);
    expect(context.unregisterTool).toHaveBeenCalledTimes(3);
  });
});
