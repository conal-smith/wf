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
 * A file inside a run directory (`weather/<model>-<run>-<hours>h-v<N>-<hash8>/…`).
 * Its name carries the run's content hash, so it never changes; and every run
 * has new names, so a long-running server that kept each one for its TTL would
 * hold every square it was ever asked for. The spot loader keeps the squares
 * itself, in a bounded cache (force5/src/spotData.ts).
 */
const RUN_FILE = /^[^/]+\/[a-z0-9][a-z0-9.-]*-[0-9a-f]{8}\//;
/** At most this many reads kept, however many paths a burst asks for. */
export const SOURCE_CACHE_LIMIT = 256;

/**
 * Cache and de-duplicate reads for `ttlMs`, so a burst of agent calls costs
 * one fetch per manifest. A failed read is not cached, and `forget` drops a
 * path's read early. A file of a run directory is shared while in flight but
 * not kept (`RUN_FILE`); what is kept is dropped once it expires, and the
 * least recently used goes past `SOURCE_CACHE_LIMIT`, so the cache stays small
 * in a server that runs for months.
 */
export function cached(
  read: (path: string) => Promise<unknown | null>,
  ttlMs: number,
  now: () => number,
): ForecastSource & { size(): number } {
  const hits = new Map<string, { at: number; value: unknown | null }>();
  const inflight = new Map<string, Promise<unknown | null>>();
  const keep = (key: string, value: unknown | null) => {
    const at = now();
    for (const [path, hit] of hits)
      if (at - hit.at >= ttlMs) hits.delete(path);
    hits.delete(key);
    hits.set(key, { at, value });
    while (hits.size > SOURCE_CACHE_LIMIT)
      hits.delete(hits.keys().next().value!);
  };
  return {
    json(path) {
      const key = safePath(path);
      const hit = hits.get(key);
      if (hit && now() - hit.at < ttlMs) {
        // Most recently used last, so the limit drops the least used first.
        hits.delete(key);
        hits.set(key, hit);
        return Promise.resolve(hit.value);
      }
      const pending =
        inflight.get(key) ??
        read(key)
          .then((value) => {
            if (!RUN_FILE.test(key)) keep(key, value);
            return value;
          })
          .finally(() => inflight.delete(key));
      inflight.set(key, pending);
      return pending;
    },
    forget(path) {
      hits.delete(safePath(path));
    },
    size: () => hits.size,
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
