/**
 * The sections of wingfoil.ie, and which one a URL belongs to.
 *
 * There are three apps on one origin — the wind map, the second-hand gear
 * marketplace and the community — and `src/main.tsx` picks between them from
 * the pathname at load time. That single fact is why this module exists twice
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

export type SiteSectionId = "map" | "market" | "community";

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
