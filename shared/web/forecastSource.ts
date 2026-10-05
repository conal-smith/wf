/**
 * The published forecast, read by the browser through the MCP server's own
 * reader (mcp/api/httpSource.ts), so a page that reduces the bundles with
 * mcp/api/forecast.ts reads them exactly as an agent does.
 *
 * Paths go where the map sends them: the ingest output under `weather/` and
 * `marine/` to the forecast base (force5/src/urls.ts, which may be a CDN), and
 * the site's own files — `riding-locations.json` — to the site. Every read
 * revalidates, as the map's do: a pointer manifest is replaced in place when a
 * run publishes.
 */
import { forecastUrl } from "../../force5/src/urls";
import {
  SOURCE_TTL_MS,
  cached,
  fetchJson,
  type ForecastSource,
} from "../../mcp/api/httpSource";

/** Where one published path is fetched from, absolute. */
export function publishedUrl(
  path: string,
  site = import.meta.env.BASE_URL,
  forecast: (path: string) => string = forecastUrl,
  origin = globalThis.location?.href ?? "http://localhost/",
): string {
  const url = /^(weather|marine)\//.test(path)
    ? forecast(path)
    : `${site.replace(/\/?$/, "/")}${path}`;
  return new URL(url, origin).href;
}

export function siteSource(
  options: { fetch?: typeof fetch; ttlMs?: number } = {},
): ForecastSource {
  return cached(
    (path) =>
      fetchJson(publishedUrl(path), path, options.fetch ?? fetch, {
        cache: "no-cache",
      }),
    options.ttlMs ?? SOURCE_TTL_MS,
    Date.now,
  );
}
