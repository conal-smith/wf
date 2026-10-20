import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createMcpRouter } from "./server";
import { FIXTURE_NOW, fixtureSource } from "./testing";

function harness() {
  const app = new Hono();
  app.route(
    "/api/mcp",
    createMcpRouter({ source: fixtureSource(), now: () => FIXTURE_NOW }),
  );
  let id = 0;
  const rpc = async (method: string, params: unknown = {}) => {
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      result?: Record<string, unknown>;
      error?: { message: string };
    };
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const { result } = await rpc("tools/call", { name, arguments: args });
    const content = result!.content as { type: string; text: string }[];
    return {
      isError: result!.isError === true,
      text: content[0].text,
      json: () => JSON.parse(content[0].text),
    };
  };
  return { app, rpc, call };
}

describe("the MCP endpoint", () => {
  it("introduces itself to a client with its instructions", async () => {
    const { rpc } = harness();
    const { result } = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(result!.serverInfo).toMatchObject({ name: "wingfoil-ie" });
    expect(result!.instructions).toMatch(
      /Never tell anyone conditions are safe/,
    );
  });

  it("lists read-only tools", async () => {
    const { rpc } = harness();
    const { result } = await rpc("tools/list");
    const tools = result!.tools as {
      name: string;
      annotations: { readOnlyHint: boolean };
    }[];
    expect(tools.map((t) => t.name)).toEqual([
      "list_spots",
      "get_spot_forecast",
      "find_wind",
      "forecast_sources",
    ]);
    expect(tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
  });

  it("forecasts a spot by name", async () => {
    const { call } = harness();
    const answer = await call("get_spot_forecast", {
      spot: "Brandon Bay",
      hours: 6,
    });
    expect(answer.isError).toBe(false);
    const forecast = answer.json();
    expect(forecast.spot.id).toBe("brandon");
    expect(forecast.window.step_hours).toBe(1);
    expect(forecast.hours).toHaveLength(7);
    expect(forecast.hours[0].wind.wind_kn).toEqual(expect.any(Number));
    expect(forecast.sources.wind.length).toBeGreaterThan(0);
  });

  it("asks which spot when a name is ambiguous or unknown", async () => {
    const { call } = harness();
    const ambiguous = await call("get_spot_forecast", { spot: "beach" });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toMatch(/could be any of: .*Ask which/);
    const unknown = await call("get_spot_forecast", { spot: "Timbuktu" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/list_spots/);
  });

  it("filters spots by county and says which counties exist", async () => {
    const { call } = harness();
    const kerry = (await call("list_spots", { county: "kerry" })).json();
    expect(kerry.spots.length).toBeGreaterThan(0);
    expect(
      kerry.spots.every((s: { county: string }) => s.county === "Kerry"),
    ).toBe(true);
    const none = await call("list_spots", { county: "Atlantis" });
    expect(none.isError).toBe(true);
    expect(none.text).toMatch(/Counties with spots: .*Kerry/);
  });

  it("finds wind and reports the models behind it", async () => {
    const { call } = harness();
    const found = (
      await call("find_wind", {
        min_kn: 0,
        max_kn: 80,
        hours: 12,
        daylight_only: false,
        limit: 3,
      })
    ).json();
    expect(found.spots.length).toBeLessThanOrEqual(3);
    expect(found.spots[0].sessions[0].local).toMatch(
      /Sept, \d\d:\d\d – \d\d:\d\d$/,
    );
    expect(found.sources.map((s: { id: string }) => s.id).sort()).toEqual([
      "ecmwf",
      "gfs",
    ]);
    expect(typeof found.spots[0].sessions[0].gusty).toBe("boolean");
    expect(found.offshore_hours).toBe("left out");
    expect("shore" in found.spots[0].sessions[0]).toBe(true);
    const backwards = await call("find_wind", { min_kn: 20, max_kn: 10 });
    expect(backwards.isError).toBe(true);
    const gustBelowWind = await call("find_wind", {
      min_kn: 14,
      max_gust_kn: 10,
    });
    expect(gustBelowWind.isError).toBe(true);
    const limited = (
      await call("find_wind", {
        min_kn: 0,
        max_kn: 80,
        max_gust_kn: 25,
        hours: 12,
        daylight_only: false,
      })
    ).json();
    expect(limited.max_gust_kn).toBe(25);
    for (const spot of limited.spots)
      for (const s of spot.sessions) expect(s.gust_kn).toBeLessThanOrEqual(25);
  });

  it("names every live source with its licence", async () => {
    const { call } = harness();
    const sources = (await call("forecast_sources")).json();
    expect(sources.wind.map((r: { id: string }) => r.id).sort()).toEqual([
      "ecmwf",
      "gfs",
    ]);
    expect(sources.waves[0]).toMatchObject({ id: "gfs-wave" });
    expect(sources.wind[0].attribution).toEqual(expect.any(String));
  });

  it("rejects bad arguments without calling the tool", async () => {
    const { call } = harness();
    const answer = await call("get_spot_forecast", {
      spot: "dollymount",
      hours: 10000,
    });
    expect(answer.isError).toBe(true);
  });

  it("answers GET with a pointer to the install page, and CORS preflight", async () => {
    const { app } = harness();
    const get = await app.request("/api/mcp");
    expect(get.status).toBe(405);
    expect(
      ((await get.json()) as { error: { message: string } }).error.message,
    ).toMatch(/wingfoil\.ie\/ai/);
    const preflight = await app.request("/api/mcp", {
      method: "OPTIONS",
      headers: {
        Origin: "https://claude.ai",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,mcp-protocol-version",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
  });
});
