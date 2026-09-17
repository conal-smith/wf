import { describe, expect, it } from "vitest";
import { SITE_SECTIONS, currentSection, isMarketPath } from "./siteNav";

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

describe("currentSection", () => {
  it("names the section a URL belongs to", () => {
    expect(currentSection("/")).toBe("map");
    expect(currentSection("/market/me")).toBe("market");
  });

  it("always names a section the menu actually offers", () => {
    const ids = SITE_SECTIONS.map((section) => section.id);
    for (const path of ["/", "/market", "/anything-else"])
      expect(ids).toContain(currentSection(path));
  });
});

describe("SITE_SECTIONS", () => {
  it("links with absolute paths, because crossing sections is a page load", () => {
    for (const section of SITE_SECTIONS)
      expect(section.href.startsWith("/")).toBe(true);
  });

  it("puts every section's own href in that section", () => {
    for (const section of SITE_SECTIONS)
      expect(currentSection(section.href)).toBe(section.id);
  });
});
