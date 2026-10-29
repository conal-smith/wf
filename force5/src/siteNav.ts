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
 * The spot finder, the home page: the rider's riding places as cards, the
 * best of their week first, each with today hour by hour and the next five
 * days, with the chart beside them on a wide screen. Since 26 October 2026 it
 * is the site's root; it was at `/spots` before, and that address is still
 * read and sent on to the root (`OLD_FINDER_HREF`, src/lastView.ts).
 */
export const FINDER_HREF = "/";

/** The spot finder's address until 26 October 2026, still answered. */
export const OLD_FINDER_HREF = "/spots";

const OLD_FINDER_PATH = /^\/spots(\/|$)/;

/** `/spots` and under it: the spot finder's old address. */
export function isOldFinderPath(pathname: string): boolean {
  return OLD_FINDER_PATH.test(pathname);
}

/**
 * The full chart: the menu's Chart and every way back named Chart. It is the
 * home page with the chart opened over the list to the whole screen
 * (src/App.tsx), and so is any address on the root that names a spot
 * (`/?spot=keel`, the chart open on Keel). `/?chart`, the chart's word until
 * 26 October 2026, is read as this one.
 */
export const MAP_PARAM = "map";
export const CHART_HREF = `/?${MAP_PARAM}`;
/** The full chart's word before 26 October 2026, still read. */
export const OLD_CHART_PARAM = "chart";

/** Whether an address on this origin asks for the full chart by name. */
export function asksChart(url: { pathname: string; search: string }) {
  if (url.pathname !== "/") return false;
  const query = new URLSearchParams(url.search);
  return query.has(MAP_PARAM) || query.has(OLD_CHART_PARAM);
}

/**
 * Whether an address is the full chart: asked for by name, or on a spot.
 * Anything else on the root is the spot finder.
 */
export function isChartAddress(url: { pathname: string; search: string }) {
  return (
    asksChart(url) ||
    (url.pathname === "/" && new URLSearchParams(url.search).has("spot"))
  );
}

/**
 * The full chart's address with `id` as its spot, or with none, the rest of
 * the address kept as it was: `/?spot=keel` with a spot (a spot names the
 * chart by itself), and `/?map` without one, so letting go of a spot never
 * leaves the chart's address for the list's.
 */
export function chartAddress(href: string, id: string | null): string {
  const url = new URL(href);
  const query = url.searchParams;
  query.delete(OLD_CHART_PARAM);
  if (id) {
    query.delete(MAP_PARAM);
    query.set("spot", id);
  } else {
    query.delete("spot");
    if (!query.has(MAP_PARAM)) query.set(MAP_PARAM, "");
  }
  return url.pathname + tidySearch(query) + url.hash;
}

/**
 * A query as an address writes it, with the full chart's word bare (`?map`,
 * not `?map=`), or "" for none.
 */
export function tidySearch(query: URLSearchParams): string {
  const text = query
    .toString()
    .replace(new RegExp(`(^|&)${MAP_PARAM}=(?=&|$)`), `$1${MAP_PARAM}`);
  return text ? `?${text}` : "";
}

/**
 * Settings, from a page that is not the map's: the home page, opened with
 * the Settings dialog over it. The map reads the word once and takes it out of
 * the address (src/App.tsx); a page drawn over the map hands it back to the
 * map instead of loading it (src/PagesOverMap.tsx). Settings was "Customise"
 * until 26 October 2026, and `/?customise`, in links already out there, is
 * read the same.
 */
export const SETTINGS_PARAM = "settings";
export const SETTINGS_HREF = `/?${SETTINGS_PARAM}`;
/** Settings' word before 26 October 2026, still read. */
export const OLD_SETTINGS_PARAM = "customise";

/**
 * What a menu row on another page asks the map to open, as Settings does:
 * Settings, the display options, what the map means, or the tour. Each is a
 * word on the home page's address (`/?options`), read once by the map and
 * taken out of it (src/App.tsx), which opens the chart first where the thing
 * asked for is the chart's.
 */
export type MapAsk = "settings" | "options" | "about" | "tour";
export const MAP_ASKS: readonly MapAsk[] = [
  "settings",
  "options",
  "about",
  "tour",
];
/** The address on another page that asks the map for `ask`. */
export const askHref = (ask: MapAsk) => `/?${ask}`;

/** What an address on this origin asks the map to open, if anything. */
export function mapAsk(url: {
  pathname: string;
  search: string;
}): MapAsk | null {
  if (url.pathname !== "/") return null;
  const query = new URLSearchParams(url.search);
  if (query.has(OLD_SETTINGS_PARAM)) return "settings";
  return MAP_ASKS.find((ask) => query.has(ask)) ?? null;
}

/** Whether an address on this origin asks the map for Settings. */
export function asksSettings(url: { pathname: string; search: string }) {
  return mapAsk(url) === "settings";
}

/** The site menu's rows that are the same on every page. */
export type SiteNavId =
  "chart" | "finder" | "settings" | "options" | "about" | "tour";

export interface SiteNavRow {
  id: SiteNavId;
  href: string;
  label: string;
}

/**
 * The site's navigation, the same menu on every page, in groups set apart
 * by a gap (the owner's ruling of 2026-10-29): the chart and the spot
 * finder; Settings and the display options; About and the tour. The site's
 * other sections follow, Use with AI last of all. The chart is the map
 * section's own page, so the sections under these leave the map out: it is
 * here, once, as the chart.
 */
export const SITE_NAV_GROUPS: readonly (readonly SiteNavRow[])[] = [
  [
    { id: "chart", href: CHART_HREF, label: "Chart" },
    { id: "finder", href: FINDER_HREF, label: "Spot finder" },
  ],
  [
    { id: "settings", href: SETTINGS_HREF, label: "Settings" },
    { id: "options", href: askHref("options"), label: "Display options" },
  ],
  [
    { id: "about", href: askHref("about"), label: "About" },
    { id: "tour", href: askHref("tour"), label: "Take the tour" },
  ],
];

/** Every row of the navigation, in order. */
export const SITE_NAV: readonly SiteNavRow[] = SITE_NAV_GROUPS.flat();

/**
 * The page the menu marks as the one you are on: one of the navigation's or
 * of the sections', or none (a spot's page, "How the stars work").
 */
export type SitePageId = "chart" | "finder" | Exclude<SiteSectionId, "map">;

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
 * own, the spot page, and the spot finder.
 */
export const APP_ROUTES: readonly string[] = [
  ...SITE_SECTIONS.filter((section) => section.href !== "/").map(
    (section) => section.href,
  ),
  "/spot",
  STARS_HREF,
  OLD_FINDER_HREF,
];
