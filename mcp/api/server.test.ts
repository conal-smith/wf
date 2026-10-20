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
    expect(forecast.hours).toHaveLength(6);
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
    const nearby = (
      await call("find_wind", {
        min_kn: 0,
        max_kn: 80,
        hours: 12,
        daylight_only: false,
        near: "Dublin",
        max_km: 40,
        counties: ["Dublin", "Wicklow"],
      })
    ).json();
    expect(nearby.near).toMatchObject({ name: "County Dublin", max_km: 40 });
    expect(nearby.counties).toEqual(["Dublin", "Wicklow"]);
    expect(nearby.spots.length).toBeGreaterThan(0);
    for (const spot of nearby.spots) {
      expect(spot.distance_km).toBeLessThanOrEqual(40);
      expect(["Dublin", "Wicklow"]).toContain(spot.spot.county);
    }
    const coords = (
      await call("find_wind", { near: { lat: 52.26, lon: -9.7 }, max_km: 30 })
    ).json();
    expect(coords.near).toMatchObject({ lat: 52.26, lon: -9.7 });
    const nowhere = await call("find_wind", { near: "Narnia" });
    expect(nowhere.isError).toBe(true);
    expect(nowhere.text).toMatch(/lat, lon/);
    const atlantis = await call("find_wind", { counties: ["Atlantis"] });
    expect(atlantis.isError).toBe(true);
    expect(atlantis.text).toMatch(/Counties with spots: .*Kerry/);
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

  it("refuses a from that is not an ISO 8601 time, rather than starting now", async () => {
    const { call } = harness();
    for (const [name, args] of [
      ["find_wind", { from: "tomorrow" }],
      ["get_spot_forecast", { spot: "donabate", from: "next friday" }],
      ["find_wind", { from: "2026-02-30" }],
    ] as const) {
      const answer = await call(name, args);
      expect(answer.isError).toBe(true);
      expect(answer.text).toMatch(
        /from must be an ISO 8601 time such as 2026-10-23T00:00:00Z/,
      );
    }
    // A date, a time with or without its offset: all ISO 8601.
    for (const from of [
      "2026-09-17",
      "2026-09-17T09:00:00Z",
      "2026-09-17T10:00+01:00",
    ]) {
      const answer = await call("get_spot_forecast", {
        spot: "dollymount",
        from,
        hours: 3,
      });
      expect(answer.isError).toBe(false);
      expect(answer.json().window.from).toMatch(/^2026-09-17T/);
    }
  });

  it("gives hours: N as N hours, the end exclusive", async () => {
    const { call } = harness();
    const rows = async (hours: number, step_hours?: number) => {
      const forecast = (
        await call("get_spot_forecast", {
          spot: "dollymount",
          hours,
          step_hours,
        })
      ).json();
      expect(
        Date.parse(forecast.window.to) - Date.parse(forecast.window.from),
      ).toBe(hours * 3600000);
      return forecast.hours.length;
    };
    expect(await rows(1)).toBe(1);
    expect(await rows(24)).toBe(24);
    expect(await rows(72, 1)).toBe(72);
    expect(await rows(48)).toBe(16);
  });

  it("takes a county as Co. X, Co X or County X, in any case", async () => {
    const { call } = harness();
    const base = { min_kn: 0, max_kn: 80, hours: 12, daylight_only: false };
    const one = (
      await call("find_wind", { ...base, county: "Co. Dublin" })
    ).json();
    expect(one.counties).toEqual(["Dublin"]);
    expect(one.spots.length).toBeGreaterThan(0);
    const wicklow = (
      await call("find_wind", { ...base, counties: ["County Wicklow"] })
    ).json();
    expect(wicklow.counties).toEqual(["Wicklow"]);
    const two = (
      await call("find_wind", {
        ...base,
        counties: ["dublin", "co. wicklow", "CO DUBLIN"],
      })
    ).json();
    expect(two.counties).toEqual(["Dublin", "Wicklow"]);
    expect(two.searched_spots).toBeGreaterThan(one.searched_spots);
    const kerry = (await call("list_spots", { county: "county kerry" })).json();
    expect(kerry.spots.length).toBeGreaterThan(0);
    const near = (
      await call("find_wind", { ...base, near: "co wicklow" })
    ).json();
    expect(near.near.name).toBe("County Wicklow");
  });

  it("refuses max_km without near", async () => {
    const { call } = harness();
    const answer = await call("find_wind", { max_km: 20 });
    expect(answer.isError).toBe(true);
    expect(answer.text).toMatch(/^max_km needs near/);
  });

  it("says where the forecast ends when the window runs past it", async () => {
    const { call } = harness();
    // The fixtures' ECMWF run, the one find_wind ranks from by then, ends at 00:00Z on 28 Sept.
    const beyond = await call("find_wind", { from: "2026-10-01T00:00:00Z" });
    expect(beyond.isError).toBe(true);
    expect(beyond.text).toMatch(
      /does not reach .*: it ends Mon, 28 Sept, 01:00 \(2026-09-28T00:00:00.000Z\), the last hour ECMWF covers/,
    );
    const part = (
      await call("find_wind", { from: "2026-09-27T00:00:00Z", hours: 48 })
    ).json();
    expect(part.note).toMatch(
      /^Only part of the window is forecast: it ends .*2026-09-28T00:00:00.000Z/,
    );
    const whole = (await call("find_wind", { hours: 48 })).json();
    expect(whole.note).toBeUndefined();
    // On GFS alone, which reaches only the next morning.
    const gfs = (
      await call("find_wind", { hours: 48, stars_from: "gfs", then: "gfs" })
    ).json();
    expect(gfs.note).toMatch(
      /2026-09-17T06:00:00.000Z\), the last hour GFS covers/,
    );
  });

  it("goes on from one of several spots close together, and asks only when they are far apart", async () => {
    const { call } = harness();
    const malahide = await call("find_wind", { near: "Malahide", max_km: 20 });
    expect(malahide.isError).toBe(false);
    const found = malahide.json();
    expect(found.near).toMatchObject({ name: "Malahide Estuary", max_km: 20 });
    expect(found.near.note).toMatch(/"Malahide" matches 4 spots within 5 km/);
    const beach = await call("find_wind", { near: "beach" });
    expect(beach.isError).toBe(true);
    expect(beach.text).toMatch(/could be any of: .*Ask which/);
  });

  it("says how far a county's nearest spot is when counties and max_km cannot both be met", async () => {
    const { call } = harness();
    const wexford = await call("find_wind", {
      near: "malahide-estuary",
      max_km: 30,
      counties: ["Wexford"],
    });
    expect(wexford.isError).toBe(true);
    const said =
      /^Wexford's nearest spot \(Cahore\) is about (\d+) km from Malahide Estuary, past max_km 30\. Drop counties, or raise max_km to at least (\d+)\.$/.exec(
        wexford.text,
      );
    expect(said).not.toBeNull();
    const km = Number(said![2]);
    expect(Number(said![1])).toBeGreaterThan(90);
    // Raised as far as it says, the search finds Wexford.
    const raised = (
      await call("find_wind", {
        near: "malahide-estuary",
        max_km: km,
        counties: ["Wexford"],
        min_kn: 0,
        max_kn: 80,
      })
    ).json();
    expect(raised.searched_spots).toBeGreaterThan(0);
    const two = await call("find_wind", {
      near: "malahide-estuary",
      max_km: 30,
      counties: ["Wexford", "Kerry"],
    });
    expect(two.text).toMatch(
      /^Wexford's nearest spot .*; Kerry's \(.+\) about \d+ km/,
    );
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
