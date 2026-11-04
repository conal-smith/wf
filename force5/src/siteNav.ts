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
 * The site's information pages: how it handles your data, its terms of use,
 * and how to get help. Each is a page of one small bundle (info/web), which
 * none of the map, the spot pages or the sections load.
 */
export type InfoPageId = "privacy" | "terms" | "support";

export interface InfoPage {
  id: InfoPageId;
  href: string;
  /** Its name in a short list of links (the site menu's foot). */
  label: string;
  /** Its heading, and the title of its tab. */
  title: string;
}

export const INFO_PAGES: readonly InfoPage[] = [
  { id: "privacy", href: "/privacy", label: "Privacy", title: "Privacy" },
  { id: "terms", href: "/terms", label: "Terms", title: "Terms of use" },
  {
    id: "support",
    href: "/support",
    label: "Support",
    title: "Help and support",
  },
];

/** `/privacy`, `/terms`, `/support` and under each — but not `/privacy-x`. */
const INFO_PATH = /^\/(privacy|terms|support)(\/|$)/;

export function isInfoPath(pathname: string): boolean {
  return INFO_PATH.test(pathname);
}

/** The information page a path is, or null for any other path. */
export function infoPageOf(pathname: string): InfoPageId | null {
  return (INFO_PATH.exec(pathname)?.[1] as InfoPageId | undefined) ?? null;
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
/**
 * Words that once asked for what is now Settings, still read: Settings'
 * own before 26 October 2026, and the display options', which Settings took
 * in on 1 November 2026.
 */
export const OLD_SETTINGS_PARAMS: readonly string[] = ["customise", "options"];

/**
 * What a menu row on another page asks the map to open, as Settings does:
 * Settings, what the map means, or the tour. Each is a word on the home
 * page's address (`/?about`), read once by the map and
 * taken out of it (src/App.tsx), which opens the chart first where the thing
 * asked for is the chart's.
 */
export type MapAsk = "settings" | "about" | "tour";
export const MAP_ASKS: readonly MapAsk[] = ["settings", "about", "tour"];
/** The address on another page that asks the map for `ask`. */
export const askHref = (ask: MapAsk) => `/?${ask}`;

/** What an address on this origin asks the map to open, if anything. */
export function mapAsk(url: {
  pathname: string;
  search: string;
}): MapAsk | null {
  if (url.pathname !== "/") return null;
  const query = new URLSearchParams(url.search);
  if (OLD_SETTINGS_PARAMS.some((word) => query.has(word))) return "settings";
  return MAP_ASKS.find((ask) => query.has(ask)) ?? null;
}

/** Whether an address on this origin asks the map for Settings. */
export function asksSettings(url: { pathname: string; search: string }) {
  return mapAsk(url) === "settings";
}

/** The site menu's rows that are the same on every page. */
export type SiteNavId =
  "chart" | "finder" | "settings" | "about" | "stars" | "tour";

export interface SiteNavRow {
  id: SiteNavId;
  href: string;
  label: string;
}

export interface SiteNavGroup {
  /** The group's short name, in grey over its rows. */
  name: string;
  rows: readonly SiteNavRow[];
}

/**
 * The site's navigation, the same menu on every page, in named groups: the
 * forecast (the chart and the spot finder), the rider's settings (Settings,
 * everything they set in one place), and help (About the map, How the stars work and
 * the tour). The site's other sections follow under "More from wingfoil.ie",
 * Use with AI last of all (SECTIONS_GROUP_NAME). The chart is the map
 * section's own page, so the sections under these leave the map out: it is
 * here, once, as the chart.
 */
export const SITE_NAV_GROUPS: readonly SiteNavGroup[] = [
  {
    name: "Forecast",
    rows: [
      { id: "chart", href: CHART_HREF, label: "Chart" },
      { id: "finder", href: FINDER_HREF, label: "Spot finder" },
    ],
  },
  {
    name: "Your settings",
    rows: [{ id: "settings", href: SETTINGS_HREF, label: "Settings" }],
  },
  {
    name: "Help",
    rows: [
      { id: "about", href: askHref("about"), label: "About the map" },
      { id: "stars", href: "/stars", label: "How the stars work" },
      { id: "tour", href: askHref("tour"), label: "Take the tour" },
    ],
  },
];

/** The name over the site's other sections, after the navigation. */
export const SECTIONS_GROUP_NAME = "More from wingfoil.ie";

/** Every row of the navigation, in order. */
export const SITE_NAV: readonly SiteNavRow[] = SITE_NAV_GROUPS.flatMap(
  (group) => group.rows,
);

/**
 * The page the menu marks as the one you are on: one of the navigation's or
 * of the sections', or none (a spot's page, the spot index).
 */
export type SitePageId =
  "chart" | "finder" | "stars" | Exclude<SiteSectionId, "map">;

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
  INFO_PATH,
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

/**
 * The word on a spot page's address that opens its week at an hour, as if
 * the rider had put the pointer on it there: `?at=2026-09-14T13:00:00Z`.
 */
export const AT_PARAM = "at";

const atQuery = (at: string | undefined) =>
  at ? `?${AT_PARAM}=${encodeURIComponent(at)}` : "";

/**
 * A riding place's own page, opened at the hour `at` (an ISO time) when one
 * is given. Absolute: it is a page load from the map.
 */
export const spotHref = (id: string, at?: string) =>
  `/spot/${encodeURIComponent(id)}${atQuery(at)}`;

/**
 * A point on the water's id, as its page's address writes it: "@" and its
 * latitude and longitude to four places (about ten metres), "@53.3412,-6.1520".
 * No riding place's id starts with "@" (scripts/import-owner-places.mjs makes
 * them of letters, figures and hyphens), so the two never meet.
 */
export const pointId = (lat: number, lon: number) =>
  `@${lat.toFixed(4)},${lon.toFixed(4)}`;

const POINT_ID = /^@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/;

/**
 * The point a spot page's id names ("@53.3412,-6.1520"), or null where it is
 * a riding place's id, or a point off the globe.
 */
export function pointFromId(id: string): { lat: number; lon: number } | null {
  const match = POINT_ID.exec(id);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/** Two places for a name: about a kilometre, which is what a reader needs. */
const degrees = (value: number, positive: string, negative: string) =>
  `${Math.abs(value).toFixed(2)}° ${value < 0 ? negative : positive}`;

/**
 * A point's name, in words, as its page and its head both title it:
 * "53.34° N, 6.15° W".
 */
export const pointName = (lat: number, lon: number) =>
  `${degrees(lat, "N", "S")}, ${degrees(lon, "E", "W")}`;

/**
 * The page of a point on the water, a tap on the chart that is not a riding
 * place: `/spot/@53.3412,-6.1520`, opened at the hour `at` when one is given.
 * The "@" and the comma are written as they are, which a path allows, so the
 * address reads as the place it is.
 */
export const pointHref = (lat: number, lon: number, at?: string) =>
  `/spot/${pointId(lat, lon)}${atQuery(at)}`;

/** The map, opened on a riding place, as every link back to it is written. */
export const mapSpotHref = (id: string) => `/?spot=${encodeURIComponent(id)}`;

/**
 * Every path with no file behind it that the entry point draws, as the SPA
 * fallback in public/_redirects lists them: each section with a bundle of its
 * own, the spot page, the stars, the information pages and the spot finder.
 */
export const APP_ROUTES: readonly string[] = [
  ...SITE_SECTIONS.filter((section) => section.href !== "/").map(
    (section) => section.href,
  ),
  "/spot",
  STARS_HREF,
  ...INFO_PAGES.map((page) => page.href),
  OLD_FINDER_HREF,
];
