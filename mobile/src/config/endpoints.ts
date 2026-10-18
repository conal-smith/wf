/**
 * Where the app reads and writes, by variant. Pure, so tests can import it.
 *
 * Staging reads production's forecast, as the staging site does
 * (docs/RELEASES.md): it is the app that is on trial, not the data. Its API
 * is production's too unless the build set EXPO_PUBLIC_STAGING_API_URL.
 */
export type Variant = "development" | "staging" | "production";

export function variantOf(applicationId: string | null | undefined): Variant {
  if (applicationId?.endsWith(".dev")) return "development";
  if (applicationId?.endsWith(".staging")) return "staging";
  return "production";
}

export interface Endpoints {
  /** The forecast data host (the site's <meta name="wingfoil:forecast-base">). */
  data: string;
  /** The site, which serves spots.json and the satellite and foil indexes. */
  site: string;
  /** The API: alerts, and the marketplace's and community's when they are on. */
  api: string;
}

const slash = (url: string) => url.replace(/\/?$/, "/");

export function endpointsFor(
  variant: Variant,
  env: Record<string, string | undefined>,
): Endpoints {
  const data = env.EXPO_PUBLIC_FORECAST_BASE_URL || "https://data.wingfoil.ie/";
  const site = env.EXPO_PUBLIC_SITE_URL || "https://wingfoil.ie/";
  const production = env.EXPO_PUBLIC_API_URL || "https://api.wingfoil.ie/";
  const api =
    variant === "development"
      ? env.EXPO_PUBLIC_DEV_API_URL || production
      : variant === "staging"
        ? env.EXPO_PUBLIC_STAGING_API_URL || production
        : production;
  return { data: slash(data), site: slash(site), api: slash(api) };
}
