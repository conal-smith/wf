import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { pageHead, withHead } from "./head";
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
      new Request("https://wingfoil.test/market"),
      env,
    );
    expect(res.status).toBe(404);
    expect(asked).toEqual(["/market"]);
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

describe("the pages with heads of their own", () => {
  /** The real index.html and riding places, as Pages would serve them. */
  const html = readFileSync(
    new URL("../../index.html", import.meta.url),
    "utf8",
  );
  const places = readFileSync(
    new URL("../../public/riding-locations.json", import.meta.url),
    "utf8",
  );
  const site = () => {
    const asked: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const { pathname } = new URL(
        input instanceof Request ? input.url : input,
      );
      asked.push(pathname);
      if (pathname === "/riding-locations.json") return new Response(places);
      return pathname === "/"
        ? new Response(html, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Length": String(html.length),
            },
          })
        : new Response("Not found", { status: 404 });
    });
    return {
      env: { ASSETS: { fetch: fetch as typeof globalThis.fetch } },
      asked,
    };
  };
  const get = (path: string, method = "GET") =>
    new Request(`https://wingfoil.test${path}`, { method });

  it("names a spot's page for the spot, in every tag the map's head has", async () => {
    const { env } = site();
    const res = await worker.fetch(get("/spot/kilcrea"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("content-length")).toBeNull();
    const page = await res.text();
    const title =
      "Kilcrea — Malahide Estuary wing foil forecast — wingfoil.ie Wind map";
    expect(page).toContain(`<title>${title}</title>`);
    /** A tag's content, however index.html has the tag laid out. */
    const tag = (attr: string, key: string) =>
      new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`).exec(
        page,
      )?.[1];
    expect(tag("property", "og:title")).toBe(title);
    expect(tag("name", "twitter:title")).toBe(title);
    expect(page).toMatch(
      /<meta\s+name="description"\s+content="Hour-by-hour wind, gusts, waves and tide at Kilcrea — Malahide Estuary, Co\. Dublin,/,
    );
    expect(page).toContain(
      '<link rel="canonical" href="https://wingfoil.ie/spot/kilcrea" />',
    );
    expect(tag("property", "og:url")).toBe("https://wingfoil.ie/spot/kilcrea");
    // Nothing of the map's own head is left to say otherwise.
    expect(page).not.toContain("ready for your AI agent");
    // The app is the same file: the rewrite touches the head alone.
    expect(page.slice(page.indexOf("</head>"))).toBe(
      html.slice(html.indexOf("</head>")),
    );
  });

  it("names /stars and /ai, and answers a HEAD without a body", async () => {
    const { env } = site();
    expect(await (await worker.fetch(get("/stars"), env)).text()).toContain(
      "<title>How the stars work — wingfoil.ie Wind map</title>",
    );
    expect(await (await worker.fetch(get("/ai/"), env)).text()).toContain(
      '<link rel="canonical" href="https://wingfoil.ie/ai" />',
    );
    const head = await worker.fetch(get("/spot/brandon", "HEAD"), env);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("leaves an unknown spot, the map and the files to the static site", async () => {
    const { env, asked } = site();
    await worker.fetch(get("/spot/nowhere"), env);
    await worker.fetch(get("/"), env);
    await worker.fetch(get("/spots.json"), env);
    await worker.fetch(get("/spot/%E0%A4%A"), env);
    // The places are read once, for the first spot path, and kept.
    expect(asked).toEqual([
      "/riding-locations.json",
      "/spot/nowhere",
      "/",
      "/spots.json",
      "/spot/%E0%A4%A",
    ]);
  });
});

describe("a spot page whose places cannot be read", () => {
  it("is the map's own page, and the next request reads them again", async () => {
    const asked: string[] = [];
    let up = false;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const { pathname } = new URL(
        input instanceof Request ? input.url : input,
      );
      asked.push(pathname);
      if (pathname === "/riding-locations.json")
        return up
          ? Response.json([
              { id: "kilcrea", name: "Kilcrea", county: "Dublin" },
            ])
          : new Response("Unavailable", { status: 503 });
      return new Response(INDEX.replace("<head>", "<head><title>Map</title>"));
    });
    const env = { ASSETS: { fetch: fetch as typeof globalThis.fetch } };
    const page = () =>
      worker.fetch(new Request("https://wingfoil.test/spot/kilcrea"), env);
    expect(await (await page()).text()).toContain("<title>Map</title>");
    up = true;
    expect(await (await page()).text()).toContain("<title>Kilcrea wing foil");
    expect(asked.filter((p) => p === "/riding-locations.json")).toHaveLength(2);
  });
});

describe("withHead", () => {
  it("escapes what it writes into an attribute", () => {
    const out = withHead(
      '<title>x</title><meta name="description" content="x" />',
      { title: 'A "B" <C>', description: "D & E", url: "https://wingfoil.ie/" },
    );
    expect(out).toBe(
      '<title>A &quot;B&quot; &lt;C&gt;</title><meta name="description" content="D &amp; E" />',
    );
  });

  it("is the map's own head for every path it does not name", () => {
    const spots = new Map([
      ["brandon", { id: "brandon", name: "Brandon Bay" }],
    ]);
    expect(pageHead("/", spots)).toBeNull();
    expect(pageHead("/spot", spots)).toBeNull();
    expect(pageHead("/spot/brandon/extra", spots)).toBeNull();
    expect(pageHead("/market", spots)).toBeNull();
    expect(pageHead("/spot/brandon", spots)?.description).not.toContain("Co.");
  });
});
