/**
 * The site's own /api/mcp, on Cloudflare Pages: the MCP server of
 * mcp/api/server.ts, bundled into the built site as `_worker.js` by
 * scripts/build-pages-worker.mjs.
 *
 * Production has no API server, only the static site, so without this every
 * client the /ai page sends to https://wingfoil.ie/api/mcp got Pages' 404 page
 * for a GET and an empty 405 for a POST. `_routes.json` (public/) runs this
 * worker for /api/mcp alone; every other path is a static file, with
 * `_redirects` and `_headers` applied as before, and costs no invocation.
 *
 * Files are read where the map reads them: the ingest output (`weather/`,
 * `marine/`) from the base `configure-site` writes into index.html at deploy
 * (scripts/release/release.mjs, force5/src/urls.ts), so one build serves
 * staging's data on staging and production's in production; everything else
 * (`riding-locations.json`) from the site's own files. A site with no such tag
 * (a development build) reads both from itself.
 */
import { Hono } from "hono";
import { httpSource, type ForecastSource } from "../api/httpSource.js";
import { createMcpRouter } from "../api/server.js";

/** The binding Pages gives an advanced-mode worker for the static files. */
interface Env {
  ASSETS: { fetch: typeof fetch };
}

/** The paths the forecast base serves, as force5/src/urls.ts `forecastUrl` reads them. */
const INGEST = /^(weather|marine)\//;

const FORECAST_BASE = /<meta name="wingfoil:forecast-base" content="([^"]+)"/;

/** The forecast base index.html names, or this origin's root when it names none. */
export function forecastBase(html: string, origin: string): string {
  const named = FORECAST_BASE.exec(html)?.[1]?.replace(/&amp;/g, "&");
  return new URL(named ?? "/", origin).href;
}

/**
 * One app per isolate, so the source's read cache (five minutes for the
 * pointer manifests) is shared by the requests the isolate answers. A failed
 * read of index.html is not kept: the next request tries again.
 */
let app: Promise<Hono> | undefined;

function appFor(request: Request, env: Env): Promise<Hono> {
  app ??= (async () => {
    const origin = new URL(request.url).origin;
    const index = await env.ASSETS.fetch(new URL("/", origin).href);
    if (!index.ok) throw new Error(`index.html answered ${index.status}`);
    const data = httpSource(forecastBase(await index.text(), origin));
    const site = httpSource(origin, {
      fetch: (url, init) => env.ASSETS.fetch(url, init),
    });
    const from = (path: string) =>
      INGEST.test(path.replace(/^\/+/, "")) ? data : site;
    const source: ForecastSource = {
      json: (path) => from(path).json(path),
      forget: (path) => from(path).forget?.(path),
    };
    return new Hono().route("/api/mcp", createMcpRouter({ source }));
  })().catch((error) => {
    app = undefined;
    throw error;
  });
  return app;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== "/api/mcp" && pathname !== "/api/mcp/")
      return env.ASSETS.fetch(request);
    const mcp = await appFor(request, env);
    // Hono's routes have no trailing slash; a client given one still reaches it.
    const url = new URL(request.url);
    url.pathname = "/api/mcp";
    return mcp.fetch(new Request(url, request));
  },
};
