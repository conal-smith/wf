import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SITE_SECTIONS,
  isAiPath,
  isCommunityPath,
  isMarketPath,
} from "../force5/src/siteNav";

/**
 * `public/_redirects` and `src/main.tsx` answer the same question in two
 * places: which URLs have no file behind them and are an app's to draw. A
 * section the entry point branches on and the file forgets is a 404 on every
 * refresh and shared link, on the hosts that read the file, and nothing in a
 * build or in `vite preview` would say so.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const rules = readFileSync(join(ROOT, "public/_redirects"), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split(/\s+/));

describe("the SPA fallback", () => {
  it("has the section's root and everything under it, for each section with a bundle of its own", () => {
    const expected = SITE_SECTIONS.filter((s) => s.href !== "/").flatMap(
      (s) => [
        [s.href, "/index.html", "200"],
        [`${s.href}/*`, "/index.html", "200"],
      ],
    );
    expect(rules).toEqual(expected);
  });

  it("names only paths the entry point branches on", () => {
    for (const [from] of rules) {
      const path = from.replace(/\*$/, "anything");
      expect(
        isMarketPath(path) || isCommunityPath(path) || isAiPath(path),
        from,
      ).toBe(true);
    }
  });

  // This origin also serves /weather and /marine, whose loaders gate on
  // `!response.ok`: index.html with a 200 for a missing snapshot would be
  // parsed as one.
  it("has no blanket rule", () => {
    expect(rules.map(([from]) => from)).not.toContain("/*");
  });
});
