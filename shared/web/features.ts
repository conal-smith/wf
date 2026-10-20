/**
 * The parts of the site that are switched on, fixed when the site is built.
 *
 * Each is off unless its variable is "1" at build time: VITE_FEATURE_GUST,
 * VITE_FEATURE_MARKET, VITE_FEATURE_COMMUNITY. Off, a section leaves the site
 * menu, its paths send the reader on to the map at `/` (src/main.tsx), and
 * Gust never appears. The API has the same
 * switches without the VITE_ (market/api/src/env.ts), so a section that is
 * off here cannot be reached around the page either: turn both on together.
 */
export interface SiteFeatures {
  gust: boolean;
  market: boolean;
  community: boolean;
}

const on = (value: string | undefined) => value === "1";

export const FEATURES: Readonly<SiteFeatures> = {
  gust: on(import.meta.env.VITE_FEATURE_GUST),
  market: on(import.meta.env.VITE_FEATURE_MARKET),
  community: on(import.meta.env.VITE_FEATURE_COMMUNITY),
};
