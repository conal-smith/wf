/**
 * Each page's own title and description, in the HTML Pages sends, so a search
 * engine and a link preview read "Kilcrea — Malahide Estuary wing foil
 * forecast" and not the map's head on every spot page. The site is one
 * index.html for every path (public/_redirects); the worker (worker.ts) hands
 * the paths named here that file with its head rewritten. Nothing in the app
 * reads these tags, so the page a reader sees is the same either way.
 */

import { pageTitle } from "../../site/shared/pageTitle.js";

/** Where the site is, whichever host served it: staging points here too. */
export const SITE = "https://wingfoil.ie";

/** As much of a riding place as its head needs (public/riding-locations.json). */
export interface HeadSpot {
  id: string;
  name: string;
  county?: string | null;
}

export interface PageHead {
  title: string;
  description: string;
  /** The page's address on the site, its canonical URL. */
  url: string;
}

/** The map's own head, in index.html: what every other path keeps. */
export const HOME: PageHead = {
  title:
    "Wing foil forecast for Ireland, ready for your AI agent | wingfoil.ie",
  description:
    "Wind and wave forecasts your AI agent can read: every wing foil spot in Ireland, rated for your weight and wings.",
  url: `${SITE}/`,
};

const SPOT = /^\/spot\/([^/]+)\/?$/;

/** A path with a head of its own, as far as its shape says: before any spot is read. */
export const isPagePath = (pathname: string) =>
  /^\/(spot\/[^/]+|stars|ai)\/?$/.test(pathname);

/**
 * Whether `pathname` is the page of a riding place `spots` does not hold:
 * /spot/<id> for an id no place has, or one that does not decode. The app
 * says so on the page, with the places it might have meant; the address
 * answers 404 as any other with nothing behind it does, so a search engine
 * or a link checker does not keep it (#225). /spot, the list of every place,
 * is not one, and nor is any spot while the places are unknown (none read).
 */
export function isMissingSpot(
  pathname: string,
  spots: ReadonlyMap<string, HeadSpot>,
): boolean {
  const id = SPOT.exec(pathname)?.[1];
  if (id === undefined || !spots.size) return false;
  try {
    return !spots.has(decodeURIComponent(id));
  } catch {
    return true;
  }
}

/** The head of a spot page with no place behind it, as the app titles it. */
export const MISSING_SPOT: PageHead = {
  title: pageTitle("Spot not found", "Wind map"),
  description: "No riding place has this address on wingfoil.ie.",
  url: `${SITE}/spot`,
};

/**
 * The head for `pathname`, or null where the map's own (index.html) stands:
 * the map, an unknown spot, and every path not named here.
 */
export function pageHead(
  pathname: string,
  spots: ReadonlyMap<string, HeadSpot>,
): PageHead | null {
  const id = SPOT.exec(pathname)?.[1];
  if (id !== undefined) {
    let key: string;
    try {
      key = decodeURIComponent(id);
    } catch {
      return null;
    }
    const spot = spots.get(key);
    if (!spot) return null;
    const where = spot.county ? `, Co. ${spot.county}` : "";
    return {
      // What the page names itself once it runs (spot/web/SpotApp.tsx), so
      // the title a crawler reads and the one it renders are one.
      title: pageTitle(`${spot.name} wing foil forecast`, "Wind map"),
      description: `Hour-by-hour wind, gusts, waves and tide at ${spot.name}${where}, rated in stars for your weight and wings. Your AI agent can read it too.`,
      url: `${SITE}/spot/${encodeURIComponent(spot.id)}`,
    };
  }
  if (/^\/stars\/?$/.test(pathname))
    return {
      title: pageTitle("How the stars work", "Wind map"),
      description:
        "How wingfoil.ie rates an hour from one to five stars: the wind against your weight and wings, the gusts, the shore and the daylight, worked through.",
      url: `${SITE}/stars`,
    };
  if (/^\/ai\/?$/.test(pathname))
    return {
      title: pageTitle("Connect your AI agent to the wing foil forecast", "AI"),
      description:
        "Add Ireland's wing foil forecast to Claude, ChatGPT or any MCP client, and ask it where and when to ride.",
      url: `${SITE}/ai`,
    };
  return null;
}

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * index.html with `head` in place of the map's: its title, and each meta and
 * link that says the page's title, description or address. Tags it does not
 * have are left absent, not added: index.html is the one place they are said.
 */
export function withHead(html: string, head: PageHead): string {
  const title = escape(head.title);
  const description = escape(head.description);
  const url = escape(head.url);
  const content =
    (attr: "name" | "property", key: string, value: string) => (out: string) =>
      out.replace(
        new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`),
        `$1${value}$2`,
      );
  const steps = [
    (out: string) =>
      out.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`),
    content("name", "description", description),
    content("property", "og:title", title),
    content("property", "og:description", description),
    content("property", "og:url", url),
    content("name", "twitter:title", title),
    content("name", "twitter:description", description),
    (out: string) =>
      out.replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/, `$1${url}$2`),
  ];
  return steps.reduce((out, step) => step(out), html);
}
