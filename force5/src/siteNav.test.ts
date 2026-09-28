import { describe, expect, it } from "vitest";
import {
  SITE_SECTIONS,
  isAiPath,
  isCommunityPath,
  isMarketPath,
} from "./siteNav";

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
