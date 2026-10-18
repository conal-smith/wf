import { endpointsFor } from "./endpoints";
import { variant } from "./variant";

/**
 * EXPO_PUBLIC_* are inlined into the bundle when it is built (nightly, for
 * the over-the-air update the train stages and promotes), so each must be
 * read as process.env.NAME, literally, for Metro to see it.
 */
export const endpoints = endpointsFor(variant, {
  EXPO_PUBLIC_FORECAST_BASE_URL: process.env.EXPO_PUBLIC_FORECAST_BASE_URL,
  EXPO_PUBLIC_SITE_URL: process.env.EXPO_PUBLIC_SITE_URL,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_STAGING_API_URL: process.env.EXPO_PUBLIC_STAGING_API_URL,
  EXPO_PUBLIC_DEV_API_URL: process.env.EXPO_PUBLIC_DEV_API_URL,
});

export { variant };

/** A site file (spots.json, the satellite and foil indexes). */
export const siteUrl = (path: string) => `${endpoints.site}${path.replace(/^\//, "")}`;

/** An API route, e.g. apiUrl("api/alerts/devices"). */
export const apiUrl = (path: string) => `${endpoints.api}${path.replace(/^\//, "")}`;
