/**
 * The sections of wingfoil.ie, and which one a URL belongs to.
 *
 * There are four apps on one origin — the wind map, the second-hand gear
 * marketplace, the community and the page that adds the forecast to an AI
 * assistant — and `src/main.tsx` picks between them from
 * the pathname at load time (and a fifth bundle, a riding place's spot page,
 * which belongs to the map section; see `isSpotPath` below). That single fact is why this module exists twice
 * over: it is what the entry point matches on, and it is what the shared site
 * menu marks as the current section, so the two can never disagree about where
 * the reader is.
 *
 * It is also why `href` is an absolute path rather than a router target.
 * Crossing sections swaps the bundle, which is a page load, not a push.
 *
 * There is deliberately no path-to-section helper here. Each app already knows
 * which section it is and tells the menu; a second way of answering the same
 * question is a second answer waiting to disagree with the entry point.
 *
 * Deliberately free of React, the DOM and every app: the map, the marketplace
 * and the community each import it, and none drags another along.
 */

export type SiteSectionId = "map" | "market" | "community" | "ai";

export interface SiteSection {
  id: SiteSectionId;
  /** Always absolute: crossing sections is a full page load. */
  href: string;
  label: string;
}

/** In menu order. The map is the product, so the map is first. */
export const SITE_SECTIONS: readonly SiteSection[] = [
  { id: "map", href: "/", label: "Wind map" },
  { id: "market", href: "/market", label: "Marketplace" },
  { id: "community", href: "/community", label: "Community" },
  { id: "ai", href: "/ai", label: "Use with AI" },
];

/**
 * The menu's sections with the switched-off ones left out (the features are
 * passed in, shared/web/features.ts, so this module stays free of the build's
 * environment: vite.config.ts imports it).
 */
export function siteSections(features: {
  market: boolean;
  community: boolean;
}): readonly SiteSection[] {
  return SITE_SECTIONS.filter(
    (section) =>
      (section.id !== "market" || features.market) &&
      (section.id !== "community" || features.community),
  );
}

/**
 * Whether a path is a section's that is switched off in this build: the
 * marketplace's or the community's, with that feature off. The host still
 * answers it with the app (public/_redirects), and the entry point sends the
 * reader on to the map at `/` rather than draw the map under an address that
 * names a page that is not there.
 */
export function isSwitchedOffPath(
  pathname: string,
  features: { market: boolean; community: boolean },
): boolean {
  return (
    (!features.market && isMarketPath(pathname)) ||
    (!features.community && isCommunityPath(pathname))
  );
}

/** `/market` and everything under it — but not `/marketplace-of-ideas`. */
const MARKET_PATH = /^\/market(\/|$)/;

export function isMarketPath(pathname: string): boolean {
  return MARKET_PATH.test(pathname);
}

/** `/community` and everything under it — but not `/community-guidelines`. */
const COMMUNITY_PATH = /^\/community(\/|$)/;

export function isCommunityPath(pathname: string): boolean {
  return COMMUNITY_PATH.test(pathname);
}

/** `/ai` and everything under it — but not `/aid` or `/air`. */
const AI_PATH = /^\/ai(\/|$)/;

export function isAiPath(pathname: string): boolean {
  return AI_PATH.test(pathname);
}

/**
 * `/spot`, `/spot/brandon` and `/spot/brandon/` — but not `/spots` or
 * `/spotify` — and `/stars`, "How the stars work", which is a page of the same
 * bundle. Both belong to the map section (the menu marks the map as current
 * there) but are a bundle of their own, so the entry point matches them here
 * beside the sections it also splits off.
 */
const SPOT_PATH = /^\/(spot|stars)(\/|$)/;

export function isSpotPath(pathname: string): boolean {
  return SPOT_PATH.test(pathname);
}

/**
 * Every path that `src/main.tsx` splits off from the map: everything else is
 * the map's. The build's preload hint for the map's chunk (vite.config.ts)
 * reads this list, so the hint and the entry point agree on which paths are
 * the map's; a new section with a bundle of its own goes in it.
 */
export const OWN_BUNDLE_PATHS: readonly RegExp[] = [
  MARKET_PATH,
  COMMUNITY_PATH,
  AI_PATH,
  SPOT_PATH,
];

/** The page that adds the forecast to an AI assistant. */
export const AI_HREF = "/ai";

/** "How the stars work": the spot bundle's other page. */
export const STARS_HREF = "/stars";

/** `/stars` and `/stars/`, which the spot bundle draws as the stars page. */
export function isStarsPath(pathname: string): boolean {
  return /^\/stars(\/|$)/.test(pathname);
}

/**
 * The riding place a spot path names, decoded, or null for `/spot` itself (the
 * index of every place) and for anything deeper than one segment.
 */
export function spotIdFromPath(pathname: string): string | null {
  const match = /^\/spot\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** A riding place's own page. Absolute: it is a page load from the map. */
export const spotHref = (id: string) => `/spot/${encodeURIComponent(id)}`;

/** The map, opened on a riding place, as every link back to it is written. */
export const mapSpotHref = (id: string) => `/?spot=${encodeURIComponent(id)}`;

/**
 * Every path with no file behind it that the entry point draws, as the SPA
 * fallback in public/_redirects lists them: each section with a bundle of its
 * own, and the spot page.
 */
export const APP_ROUTES: readonly string[] = [
  ...SITE_SECTIONS.filter((section) => section.href !== "/").map(
    (section) => section.href,
  ),
  "/spot",
  STARS_HREF,
];
