/**
 * The app's force5/src/urls.ts: metro.config.js resolves every import of the
 * site's file here. The site reads its data host from a <meta> the release
 * writes; the app reads it from its own config (env.ts).
 */
import { endpoints } from "./env";

export const FORECAST_BASE_META = "wingfoil:forecast-base";

/** Base includes any CDN prefix, but not /weather (manifest paths include it). */
export function forecastUrl(path: string) {
  return `${endpoints.data}${path.replace(/^\//, "")}`;
}
