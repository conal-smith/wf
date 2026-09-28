/**
 * Where the MCP server reads the published forecast from. The server holds no
 * forecast of its own: it reads the same pointer manifests, spot series and
 * marine bundles the map does, from the same origin the map reads them, so an
 * agent and a reader on the site can never be shown two different forecasts.
 *
 * Paths are the published ones — `weather/harmonie.json`,
 * `marine/tides.json`, `riding-locations.json` — relative to the site root.
 */
import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";

export interface ForecastSource {
  /** Parsed JSON at a published path, or null when nothing is published there. */
  json(path: string): Promise<unknown | null>;
}

/** Pointer manifests are replaced in place; the map revalidates them this often too. */
export const SOURCE_TTL_MS = 5 * 60 * 1000;

/** Published paths never climb out of the site root or name a scheme. */
function safePath(path: string): string {
  const clean = path.replace(/^\/+/, "");
  if (!clean || clean.includes("..") || /^[a-z]+:/i.test(clean))
    throw new Error(`Refusing forecast path ${path}.`);
  return clean;
}

/**
 * Cache and de-duplicate reads for `ttlMs`, so a burst of agent calls costs
 * one fetch per manifest. A failed read is not cached.
 */
function cached(
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
  };
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
  const get = options.fetch ?? fetch;
  return cached(
    async (path) => {
      const response = await get(new URL(path, base), {
        signal: AbortSignal.timeout(20000),
      });
      if (response.status === 404) return null;
      if (!response.ok)
        throw new Error(`Forecast data ${path} answered ${response.status}.`);
      return response.json();
    },
    options.ttlMs ?? SOURCE_TTL_MS,
    options.now ?? Date.now,
  );
}

/** A directory laid out like the site root: `public/` in a checkout. */
export function dirSource(
  root: string,
  options: { ttlMs?: number; now?: () => number } = {},
): ForecastSource {
  const top = normalize(root);
  return cached(
    async (path) => {
      const file = normalize(join(top, path));
      if (!file.startsWith(top.endsWith(sep) ? top : top + sep))
        throw new Error(`Refusing forecast path ${path}.`);
      try {
        return JSON.parse(await readFile(file, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    options.ttlMs ?? SOURCE_TTL_MS,
    options.now ?? Date.now,
  );
}
