/**
 * Where the MCP server reads the published forecast from. The server holds no
 * forecast of its own: it reads the same pointer manifests, spot series and
 * marine bundles the map does, from the same origin the map reads them, so an
 * agent and a reader on the site can never be shown two different forecasts.
 *
 * Paths are the published ones — `weather/harmonie.json`,
 * `marine/tides.json`, `riding-locations.json` — relative to the site root.
 *
 * The contract, the cache and the HTTP reader live in httpSource.ts, which
 * never imports Node, so the browser's spot page can share them. This file adds
 * the one reader that needs the disk.
 */
import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";

export {
  SOURCE_TTL_MS,
  cached,
  httpSource,
  safePath,
  type ForecastSource,
} from "./httpSource.js";
import { SOURCE_TTL_MS, cached, type ForecastSource } from "./httpSource.js";

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
