/**
 * The browser-safe half of where the forecast is read from: the source
 * contract, the read cache and the HTTP reader. source.ts adds the reader for a
 * directory on disk, which needs Node; this file must never import Node, so the
 * spot page (spot/web) can read the published bundles through the very same
 * code the MCP server does.
 *
 * Paths are the published ones — `weather/harmonie.json`,
 * `marine/tides.json`, `riding-locations.json` — relative to the site root.
 */

export interface ForecastSource {
  /** Parsed JSON at a published path, or null when nothing is published there. */
  json(path: string): Promise<unknown | null>;
  /**
   * Forget what was read at a path, so the next `json` reads it again: for a
   * pointer whose run's files could not be read, because that run may have
   * been replaced since the pointer was cached.
   */
  forget?(path: string): void;
}

/** Pointer manifests are replaced in place; the map revalidates them this often too. */
export const SOURCE_TTL_MS = 5 * 60 * 1000;

/** Published paths never climb out of the site root or name a scheme. */
export function safePath(path: string): string {
  const clean = path.replace(/^\/+/, "");
  if (!clean || clean.includes("..") || /^[a-z]+:/i.test(clean))
    throw new Error(`Refusing forecast path ${path}.`);
  return clean;
}

/**
 * Cache and de-duplicate reads for `ttlMs`, so a burst of agent calls costs
 * one fetch per manifest. A failed read is not cached, and `forget` drops a
 * path's read early.
 */
export function cached(
  read: (path: string) => Promise<unknown | null>,
  ttlMs: number,
  now: () => number,
): ForecastSource {
  const hits = new Map<string, { at: number; value: unknown | null }>();
  const inflight = new Map<string, Promise<unknown | null>>();
  return {
    json(path) {
      const key = safePath(path);
      const hit = hits.get(key);
      if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.value);
      const pending =
        inflight.get(key) ??
        read(key)
          .then((value) => {
            hits.set(key, { at: now(), value });
            return value;
          })
          .finally(() => inflight.delete(key));
      inflight.set(key, pending);
      return pending;
    },
    forget(path) {
      hits.delete(safePath(path));
    },
  };
}

/**
 * Read one published path over HTTP: null for a 404 (nothing published there,
 * a normal state for a model that has not run yet), an error for anything else
 * that is not a 200.
 */
export async function fetchJson(
  url: URL | string,
  path: string,
  get: typeof fetch = fetch,
  init: RequestInit = {},
): Promise<unknown | null> {
  const response = await get(url, {
    signal: AbortSignal.timeout(20000),
    ...init,
  });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Forecast data ${path} answered ${response.status}.`);
  return response.json();
}

/** The deployed site: `https://wingfoil.ie/` or the local Caddy stack. */
export function httpSource(
  baseUrl: string,
  options: {
    ttlMs?: number;
    fetch?: typeof fetch;
    now?: () => number;
  } = {},
): ForecastSource {
  const base = baseUrl.replace(/\/?$/, "/");
  return cached(
    (path) => fetchJson(new URL(path, base), path, options.fetch ?? fetch),
    options.ttlMs ?? SOURCE_TTL_MS,
    options.now ?? Date.now,
  );
}
