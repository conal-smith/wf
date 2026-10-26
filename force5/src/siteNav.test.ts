import { describe, expect, it } from "vitest";
import {
  APP_ROUTES,
  CHART_HREF,
  SETTINGS_HREF,
  SITE_NAV,
  SITE_SECTIONS,
  asksChart,
  asksSettings,
  siteSections,
  isFinderPath,
  isSpotPath,
  isStarsPath,
  mapSpotHref,
  spotHref,
  spotIdFromPath,
  isAiPath,
  isCommunityPath,
  isMarketPath,
  isSwitchedOffPath,
  OWN_BUNDLE_PATHS,
} from "./siteNav";

describe("OWN_BUNDLE_PATHS", () => {
  const claimed = (path: string) => OWN_BUNDLE_PATHS.some((p) => p.test(path));

  // The build preloads the map's chunk wherever none of these match, so it
  // must claim exactly what the entry point splits off.
  it("claims every path the entry point gives a bundle of its own", () => {
    for (const path of [
      "/market",
      "/market/sell",
      "/community/c/general",
      "/ai",
      "/spot/brandon",
      "/stars",
    ]) {
      expect(claimed(path)).toBe(true);
      expect(
        isMarketPath(path) ||
          isCommunityPath(path) ||
          isAiPath(path) ||
          isSpotPath(path),
      ).toBe(true);
    }
  });

  it("leaves the map's paths alone", () => {
    for (const path of ["/", "", "/?spot=brandon", "/spots", "/marketplace"])
      expect(claimed(path)).toBe(false);
  });
});

describe("isMarketPath", () => {
  it("claims /market and everything under it", () => {
    expect(isMarketPath("/market")).toBe(true);
    expect(isMarketPath("/market/")).toBe(true);
    expect(isMarketPath("/market/sell")).toBe(true);
    expect(isMarketPath("/market/listing/abc123")).toBe(true);
    expect(isMarketPath("/market/listing/abc123/edit")).toBe(true);
  });

  it("does not claim a path that merely starts with the word", () => {
    expect(isMarketPath("/marketplace")).toBe(false);
    expect(isMarketPath("/markets")).toBe(false);
    expect(isMarketPath("/market-report")).toBe(false);
  });

  it("does not claim the map, or anything else on the site", () => {
    expect(isMarketPath("/")).toBe(false);
    expect(isMarketPath("")).toBe(false);
    expect(isMarketPath("/about")).toBe(false);
    // The query string is not part of a pathname, but a caller that passes one
    // should still land on the map rather than half-matching.
    expect(isMarketPath("/?spot=brandon")).toBe(false);
  });
});

describe("isCommunityPath", () => {
  it("claims /community and everything under it", () => {
    expect(isCommunityPath("/community")).toBe(true);
    expect(isCommunityPath("/community/")).toBe(true);
    expect(isCommunityPath("/community/following")).toBe(true);
    expect(isCommunityPath("/community/c/wings")).toBe(true);
    expect(isCommunityPath("/community/t/abc123/5m-or-6m")).toBe(true);
  });

  it("does not claim a path that merely starts with the word", () => {
    expect(isCommunityPath("/community-guidelines")).toBe(false);
    expect(isCommunityPath("/communityx")).toBe(false);
  });

  it("does not claim the map or the marketplace", () => {
    expect(isCommunityPath("/")).toBe(false);
    expect(isCommunityPath("")).toBe(false);
    expect(isCommunityPath("/market")).toBe(false);
    expect(isCommunityPath("/market/community")).toBe(false);
    expect(isCommunityPath("/?to=/community")).toBe(false);
  });
});

describe("isAiPath", () => {
  it("claims /ai and everything under it, and nothing that starts with the letters", () => {
    expect(isAiPath("/ai")).toBe(true);
    expect(isAiPath("/ai/")).toBe(true);
    expect(isAiPath("/air")).toBe(false);
    expect(isAiPath("/aid")).toBe(false);
    expect(isAiPath("/")).toBe(false);
    expect(isAiPath("/community/ai")).toBe(false);
  });
});

describe("SITE_SECTIONS", () => {
  it("links with absolute paths, because crossing sections is a page load", () => {
    for (const section of SITE_SECTIONS)
      expect(section.href.startsWith("/")).toBe(true);
  });

  it("offers exactly the four sections the entry point branches on", () => {
    expect(SITE_SECTIONS).toEqual([
      { id: "map", href: "/", label: "Wind map" },
      { id: "market", href: "/market", label: "Marketplace" },
      { id: "community", href: "/community", label: "Community" },
      { id: "ai", href: "/ai", label: "Use with AI" },
    ]);
  });

  it("gives each section an href the entry point routes to that section", () => {
    for (const section of SITE_SECTIONS) {
      expect(isMarketPath(section.href)).toBe(section.id === "market");
      expect(isCommunityPath(section.href)).toBe(section.id === "community");
      expect(isAiPath(section.href)).toBe(section.id === "ai");
    }
  });
});

describe("SITE_NAV", () => {
  it("is the chart, the spot finder and Settings, in that order, on every page", () => {
    expect(SITE_NAV).toEqual([
      { id: "chart", href: "/?chart", label: "Chart" },
      { id: "finder", href: "/spots", label: "Spot finder" },
      { id: "settings", href: "/?settings", label: "Settings" },
    ]);
    // Each is the map's bundle's: none is split off.
    for (const row of SITE_NAV)
      expect(OWN_BUNDLE_PATHS.some((p) => p.test(row.href))).toBe(false);
  });

  it("names the chart with a word, so the root does not open on the finder", () => {
    const at = (href: string) => new URL(href, "https://wingfoil.ie");
    expect(CHART_HREF).toBe("/?chart");
    expect(asksChart(at(CHART_HREF))).toBe(true);
    expect(asksChart(at("/?spot=keel&chart"))).toBe(true);
    expect(asksChart(at("/"))).toBe(false);
    expect(asksChart(at("/?spot=chart"))).toBe(false);
    expect(asksChart(at("/spots?chart"))).toBe(false);
  });

  it("asks the map for Settings with the word, and only on the chart's address", () => {
    const at = (href: string) => new URL(href, "https://wingfoil.ie");
    expect(SETTINGS_HREF).toBe("/?settings");
    expect(asksSettings(at(SETTINGS_HREF))).toBe(true);
    expect(asksSettings(at("/?spot=keel&settings"))).toBe(true);
    expect(asksSettings(at("/"))).toBe(false);
    expect(asksSettings(at("/?spot=settings"))).toBe(false);
    expect(asksSettings(at("/spots?settings"))).toBe(false);
  });

  it("still reads Settings' old word, Customise's, in links already out there", () => {
    const at = (href: string) => new URL(href, "https://wingfoil.ie");
    expect(asksSettings(at("/?customise"))).toBe(true);
    expect(asksSettings(at("/?spot=keel&customise"))).toBe(true);
    expect(asksSettings(at("/spots?customise"))).toBe(false);
  });
});

describe("isSpotPath", () => {
  it("claims /spot and every place under it", () => {
    expect(isSpotPath("/spot")).toBe(true);
    expect(isSpotPath("/spot/")).toBe(true);
    expect(isSpotPath("/spot/brandon")).toBe(true);
    expect(isSpotPath("/spot/brandon/")).toBe(true);
  });

  it("claims /stars, the bundle's other page, and isStarsPath tells it apart", () => {
    expect(isSpotPath("/stars")).toBe(true);
    expect(isSpotPath("/stars/")).toBe(true);
    expect(isSpotPath("/starship")).toBe(false);
    expect(isStarsPath("/stars")).toBe(true);
    expect(isStarsPath("/spot/brandon")).toBe(false);
    expect(isStarsPath("/starsign")).toBe(false);
  });

  it("does not claim a path that merely starts with the word", () => {
    expect(isSpotPath("/spots")).toBe(false);
    expect(isSpotPath("/spotify")).toBe(false);
    expect(isSpotPath("/")).toBe(false);
    expect(isSpotPath("/?spot=brandon")).toBe(false);
    expect(isSpotPath("/community/spot/brandon")).toBe(false);
  });
});

describe("spotIdFromPath", () => {
  it("reads the one segment after /spot, decoded", () => {
    expect(spotIdFromPath("/spot/brandon")).toBe("brandon");
    expect(spotIdFromPath("/spot/brandon/")).toBe("brandon");
    expect(spotIdFromPath("/spot/fi-inchydoney%20east")).toBe(
      "fi-inchydoney east",
    );
  });

  it("is null for the index, a deeper path, or a malformed escape", () => {
    expect(spotIdFromPath("/spot")).toBeNull();
    expect(spotIdFromPath("/spot/")).toBeNull();
    expect(spotIdFromPath("/spot/brandon/extra")).toBeNull();
    expect(spotIdFromPath("/spot/%E0%A4%A")).toBeNull();
  });

  it("round-trips with spotHref", () => {
    for (const id of ["brandon", "osm-blast-kilcrea", "a b/c"])
      expect(spotIdFromPath(spotHref(id))).toBe(id);
  });
});

describe("mapSpotHref", () => {
  it("opens the map on a place", () => {
    expect(mapSpotHref("keel")).toBe("/?spot=keel");
    expect(mapSpotHref("a b")).toBe("/?spot=a%20b");
  });
});

describe("siteSections", () => {
  it("leaves out the sections that are switched off, and never the map or /ai", () => {
    const ids = (market: boolean, community: boolean) =>
      siteSections({ market, community }).map((s) => s.id);
    expect(ids(true, true)).toEqual(["map", "market", "community", "ai"]);
    expect(ids(false, false)).toEqual(["map", "ai"]);
    expect(ids(true, false)).toEqual(["map", "market", "ai"]);
    expect(ids(false, true)).toEqual(["map", "community", "ai"]);
  });
});

describe("isSwitchedOffPath", () => {
  it("is a switched-off section's path, and nothing else", () => {
    const off = { market: false, community: false };
    const on = { market: true, community: true };
    for (const path of ["/market", "/market/sell", "/community/t/1"]) {
      expect(isSwitchedOffPath(path, off), path).toBe(true);
      expect(isSwitchedOffPath(path, on), path).toBe(false);
    }
    expect(
      isSwitchedOffPath("/market", { market: false, community: true }),
    ).toBe(true);
    expect(
      isSwitchedOffPath("/community", { market: false, community: true }),
    ).toBe(false);
    for (const path of [
      "/",
      "/ai",
      "/spot/brandon",
      "/marketplace",
      "/communityx",
    ])
      expect(isSwitchedOffPath(path, off), path).toBe(false);
  });
});

describe("APP_ROUTES", () => {
  it("is every section with a bundle of its own, then the spot page, the stars and the spot finder", () => {
    expect(APP_ROUTES).toEqual([
      "/market",
      "/community",
      "/ai",
      "/spot",
      "/stars",
      "/spots",
    ]);
  });
});

describe("isFinderPath", () => {
  it("is /spots and under it, and not a spot's page", () => {
    expect(isFinderPath("/spots")).toBe(true);
    expect(isFinderPath("/spots/")).toBe(true);
    expect(isFinderPath("/spot")).toBe(false);
    expect(isFinderPath("/spot/keel")).toBe(false);
    expect(isFinderPath("/spotsx")).toBe(false);
    expect(isSpotPath("/spots")).toBe(false);
  });
});
