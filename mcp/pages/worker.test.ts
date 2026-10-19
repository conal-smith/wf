import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forecastBase } from "./worker";

const INDEX = `<html><head>
  <meta name="wingfoil:forecast-base" content="https://data.example/" />
  </head><body></body></html>`;

const SPOTS = [
  {
    id: "dollymount",
    name: "Dollymount",
    county: "Dublin",
    lat: 53.37,
    lon: -6.14,
  },
];

/** The static files, as Pages' ASSETS binding answers them. */
function assets(files: Record<string, unknown>) {
  const asked: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const { pathname } = new URL(input instanceof Request ? input.url : input);
    asked.push(pathname);
    if (pathname === "/") return new Response(INDEX);
    if (pathname.slice(1) in files)
      return Response.json(files[pathname.slice(1)]);
    return new Response("Not found", { status: 404 });
  });
  return {
    env: { ASSETS: { fetch: fetch as typeof globalThis.fetch } },
    asked,
  };
}

const rpc = (method: string, params: unknown = {}, path = "/api/mcp") =>
  new Request(`https://wingfoil.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

/** The worker keeps one app per isolate; each test gets a fresh isolate. */
let worker: typeof import("./worker").default;
beforeEach(async () => {
  vi.resetModules();
  worker = (await import("./worker")).default;
});
afterEach(() => vi.unstubAllGlobals());

describe("forecastBase", () => {
  it("reads the base configure-site wrote", () => {
    expect(forecastBase(INDEX, "https://wingfoil.ie")).toBe(
      "https://data.example/",
    );
  });

  it("falls back to the site's own origin", () => {
    expect(forecastBase("<html></html>", "https://wingfoil.ie")).toBe(
      "https://wingfoil.ie/",
    );
  });
});

describe("the Pages worker", () => {
  it("hands every other path to the static files", async () => {
    const { env, asked } = assets({});
    const res = await worker.fetch(
      new Request("https://wingfoil.test/ai"),
      env,
    );
    expect(res.status).toBe(404);
    expect(asked).toEqual(["/ai"]);
  });

  it("answers an MCP client's initialize", async () => {
    const { env } = assets({});
    const res = await worker.fetch(
      rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { serverInfo: { name: string } };
    };
    expect(body.result.serverInfo.name).toBe("wingfoil-ie");
  });

  it("explains itself to a GET, also with a trailing slash", async () => {
    const { env } = assets({});
    for (const path of ["/api/mcp", "/api/mcp/"]) {
      const res = await worker.fetch(
        new Request(`https://wingfoil.test${path}`),
        env,
      );
      expect(res.status).toBe(405);
      expect(await res.text()).toContain("wingfoil.ie MCP endpoint");
    }
  });

  it("reads the spots from the site and the forecast from the base", async () => {
    const data = vi.fn(async () => new Response("Not found", { status: 404 }));
    vi.stubGlobal("fetch", data);
    const { env, asked } = assets({ "riding-locations.json": SPOTS });
    const res = await worker.fetch(
      rpc("tools/call", { name: "list_spots", arguments: {} }),
      env,
    );
    const body = (await res.json()) as {
      result: { content: { text: string }[] };
    };
    expect(body.result.content[0].text).toContain("Dollymount");
    expect(asked).toContain("/riding-locations.json");
    expect(data).not.toHaveBeenCalled();

    await worker.fetch(
      rpc("tools/call", { name: "forecast_sources", arguments: {} }),
      env,
    );
    const read = data.mock.calls.map((call) => String(call[0]));
    expect(read.length).toBeGreaterThan(0);
    expect(read.every((url) => url.startsWith("https://data.example/"))).toBe(
      true,
    );
  });
});
