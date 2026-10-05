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
 * `/spotify`. The spot page belongs to the map section (the menu marks the map
 * as current there) but is a bundle of its own, so the entry point matches it
 * here beside the sections it also splits off.
 */
const SPOT_PATH = /^\/spot(\/|$)/;

export function isSpotPath(pathname: string): boolean {
  return SPOT_PATH.test(pathname);
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
];
