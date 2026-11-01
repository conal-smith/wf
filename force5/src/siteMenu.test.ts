import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { buttonStyles } from "../../ui/Button";
import { compileTheme, holds } from "../../ui/theme.testkit";
import { FEATURES } from "../../shared/web/features";
import * as glyphs from "../../shared/web/glyphSet";
import {
  DRAG,
  SiteMenu,
  SiteNav,
  dragCloses,
  siteMenuStyles,
} from "./SiteMenu";

/**
 * The site menu, drawn from ui/ and the theme rather than the design bundle's
 * stylesheet. How it behaves (Escape, focus, blur, the grown hit area) is
 * e2e/site-menu.spec.ts's; what is asked here is that every class it writes
 * comes to something, and that it has the quiet look of the new design.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const SOURCE = read("force5/src/SiteMenu.tsx");
const html = (props: Parameters<typeof SiteMenu>[0]) =>
  renderToStaticMarkup(createElement(SiteMenu, props));

type Classes = string | readonly Classes[] | { [key: string]: Classes } | null;
function written(value: Classes | undefined): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap((v) => written(v));
  return Object.values(value).flatMap((v) => written(v as Classes));
}

/** The one class that is a hook for e2e, not a rule. */
const HOOK = "f5-site-menu";

let build: (names: string[]) => string;
beforeAll(async () => {
  build = await compileTheme();
});

describe("the site menu's recipe", () => {
  it("resolves every class it writes from the theme", () => {
    const { slots, variants, compoundVariants } = siteMenuStyles as unknown as {
      slots: Classes;
      variants: Classes;
      compoundVariants: { class: Classes }[];
    };
    const names = [
      ...written(slots),
      ...written(variants),
      // A compound's own keys are variant names; only its class is drawn.
      ...compoundVariants.flatMap((compound) => written(compound.class)),
    ].filter((name) => name !== HOOK);
    expect(names.length).toBeGreaterThan(20);
    const css = build(names);
    for (const name of names) expect(holds(css, name), name).toBe(true);
  });

  it("is scanned by the theme and linted by ui:lint, as the one force5 file in utilities", () => {
    expect(read("ui/theme.css")).toContain(
      '@source "../force5/src/SiteMenu.tsx";',
    );
    expect(read("scripts/lint-ui.mjs")).toContain('"force5/src/SiteMenu.tsx"');
  });

  it("imports no stylesheet, and nothing of the retired bundle", () => {
    expect(SOURCE).not.toMatch(/import\s+["'][^"']+\.css["']/);
    // Joined, so the item's ACCEPT grep does not find this test.
    expect(SOURCE).not.toContain(["design", ""].join("/"));
    expect(SOURCE).not.toMatch(/f5-(?:button|surface)|f5-site-menu__/);
  });
});

describe("the drawer", () => {
  /*
   * The trigger is the kit's own button, not one that looks like it: the
   * round outlined icon button, 40px, its ring the kit's.
   */
  it("draws the trigger as exactly the kit's round outlined icon button", () => {
    const drawn = html({ current: "chart" })
      .match(/<button[^>]*\bclass="([^"]+)"/)?.[1]
      .split(" ")
      .sort();
    expect(drawn).toEqual(buttonStyles({ icon: true }).split(" ").sort());
    expect(drawn).toContain("not-disabled:focus-visible:outline-focus");
    expect(drawn).toContain("rounded-full");
  });

  /*
   * The drawer: the ground at the right edge, where the menu button is, its
   * page-facing corners a sheet's, one soft shadow, over the kit's backdrop.
   * No ink edge, no grain.
   */
  it("draws the drawer from the theme: the right edge, a sheet's corners, the kit's backdrop", () => {
    const classes = siteMenuStyles().drawer().split(" ");
    for (const name of [
      "fixed",
      "right-0",
      "inset-y-0",
      "h-dvh",
      "w-90",
      "max-w-11/12",
      "rounded-l-dialog",
      "bg-ground",
      "shadow-sheet",
      "backdrop:scrim",
      "drawer-slide",
      "touch-pan-y",
    ])
      expect(classes, name).toContain(name);
    expect(classes.join(" ")).not.toMatch(/paper-grain|border-ink|border-r\b/);
    expect(SOURCE).toMatch(/<dialog[\s\S]*className=\{styles\.drawer\(\)\}/);
  });

  it("slides in from the right at the fast duration, and holds still for less motion", () => {
    const css = build(["drawer-slide"]);
    expect(css).toMatch(/@starting-style \{\s*transform: translateX\(100%\);/);
    expect(css).toContain("transform var(--transition-duration-fast) ease");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^}]*transition: none;/,
    );
  });

  it("names every row in Inter, the height of touch, with no rule between rows", () => {
    const row = siteMenuStyles().row().split(" ");
    for (const name of ["font-body", "h-touch", "rounded-control"])
      expect(row, name).toContain(name);
    expect(row).not.toContain("border-b");
    expect(SOURCE).toContain("<ChartGlyph glyph={ROW_GLYPH[id]} />");
  });

  it("is signed by nothing: no puffin, no Almanac", () => {
    expect(SOURCE).not.toContain("Puffin");
    expect(SOURCE).not.toContain("Almanac");
  });

  it("has the wordmark and a close button at its head, with no rule under them", () => {
    expect(SOURCE).toContain('aria-label="Close menu"');
    expect(SOURCE).toContain("<Wordmark />");
    expect(siteMenuStyles().head()).not.toMatch(/border/);
  });

  it("sets the page you are on on a soft pill in semibold, not in italic", () => {
    const here = siteMenuStyles({ current: true }).row().split(" ");
    for (const name of ["font-semibold", "bg-sunken"])
      expect(here).toContain(name);
    expect(here).not.toContain("italic");
    const other = siteMenuStyles().row().split(" ");
    expect(other).not.toContain("font-semibold");
  });
});

describe("the markup", () => {
  it("draws nothing of the drawer until it is opened", () => {
    const markup = html({ current: "chart" });
    expect(markup).not.toContain("<dialog");
    expect(markup).not.toContain("<nav");
  });

  it("is a disclosure: a named button, closed, controlling nothing yet", () => {
    const markup = html({ current: "community" });
    expect(markup).toContain('aria-label="Site menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("aria-haspopup");
    expect(markup).not.toContain("aria-controls");
    expect(markup).not.toContain("aria-pressed");
    expect(markup).toMatch(new RegExp(`^<div class="${HOOK} `));
    expect(markup).not.toContain("data-mode");
  });
});

describe("the navigation", () => {
  const rows = (props: Parameters<typeof SiteNav>[0]) =>
    renderToStaticMarkup(createElement(SiteNav, props));
  const names = (markup: string) =>
    (markup.match(/<a [^>]*>[\s\S]*?<\/a>/g) ?? []).map((link) =>
      link.replace(/<[^>]+>/g, ""),
    );
  const both = { market: true, community: true };

  it("is the forecast, your settings, help, then the sections, Use with AI last, each named and with its glyph", () => {
    const markup = rows({ current: "chart", features: both });
    expect(names(markup)).toEqual([
      "ChartYou’re here",
      "Spot finder",
      "Settings",
      "Display options",
      "About the map",
      "How the stars work",
      "Take the tour",
      "MarketplacePreview",
      "CommunityPreview",
      "Use with AI",
    ]);
    const heads = [...markup.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map(
      (m) => m[1],
    );
    expect(heads).toEqual([
      "Forecast",
      "Your settings",
      "Help",
      "More from wingfoil.ie",
    ]);
    const links = markup.match(/<a [^>]*>[\s\S]*?<\/a>/g) ?? [];
    for (const link of links) expect(link).toMatch(/<svg[^>]*class="g-set"/);
    for (const glyph of [
      glyphs.windMap,
      glyphs.spotFinder,
      glyphs.settings,
      glyphs.displayOptions,
      glyphs.about,
      glyphs.starsFrom,
      glyphs.tour,
      glyphs.useWithAi,
    ]) {
      const path = glyph.find((part) => "d" in part);
      const drawn = !!path && "d" in path && markup.includes(`d="${path.d}"`);
      expect(drawn).toBe(true);
    }
    expect(markup.match(/<ul /g)).toHaveLength(4);
    // The map is the chart: there is no "Wind map" beside it.
    expect(markup).not.toContain("Wind map");
    expect(markup.match(/href="\/\?map"/g)).toHaveLength(1);
  });

  /*
   * The owner's ruling of 2026-10-25: the menu is the same on every page.
   * The chart's and the spot finder's, a spot's page's, the AI page's and the
   * marketplace's: the same rows in the same order, the page marked.
   */
  it("is the same on every page, with only the page you are on marked", () => {
    const pages = [
      "chart",
      "finder",
      "ai",
      "market",
      "community",
      null,
    ] as const;
    const drawn = pages.map((current) => rows({ current, features: both }));
    const bare = (markup: string) =>
      names(markup).map((name) => name.replace(/You’re here|Preview/, ""));
    for (const markup of drawn) expect(bare(markup)).toEqual(bare(drawn[0]));
    const marked = (markup: string) =>
      [
        ...markup.matchAll(/<a [^>]*aria-current="page"[^>]*>([\s\S]*?)<\/a>/g),
      ].map((m) => m[1].replace(/<[^>]+>/g, "").replace("You’re here", ""));
    expect(drawn.map(marked)).toEqual([
      ["Chart"],
      ["Spot finder"],
      ["Use with AI"],
      ["Marketplace"],
      ["Community"],
      [],
    ]);
  });

  it("links each row where a page load takes it: the spot finder the home page, the chart the full chart, Settings the home page with Settings open", () => {
    const markup = rows({ current: null, features: both });
    for (const href of [
      "/",
      "/?map",
      "/?settings",
      "/?options",
      "/?about",
      "/stars",
      "/?tour",
      "/market",
      "/community",
      "/ai",
    ])
      expect(markup).toContain(`href="${href}"`);
  });

  it("draws nothing at all of the marketplace or the community when they are off", () => {
    const markup = rows({
      current: "chart",
      features: { market: false, community: false },
    });
    expect(markup).not.toMatch(/Marketplace|Community|\/market|\/community/);
    expect(markup.match(/<li>/g)).toHaveLength(8);
    expect(markup).not.toContain("Preview");
  });

  it("leaves them out as production builds it, with no feature switched on", () => {
    // No build of the site sets VITE_FEATURE_MARKET or VITE_FEATURE_COMMUNITY
    // but the end-to-end suite's (package.json, preview:e2e); this test runs
    // without them, as production does.
    expect(FEATURES.market).toBe(false);
    expect(FEATURES.community).toBe(false);
    expect(rows({ current: "ai" })).not.toMatch(/Marketplace|Community/);
    for (const path of [
      ".github/workflows/release.yml",
      "deploy/local/Dockerfile.web",
    ])
      expect(read(path), path).not.toMatch(/VITE_FEATURE_(MARKET|COMMUNITY)/);
  });

  it("has no rows of a page's own: the chart's layers are its rail", () => {
    expect(SOURCE).not.toContain("tools");
    expect(SOURCE).not.toMatch(/>Layers</);
  });
});

describe("a finger on the drawer", () => {
  const at = 1000;
  it("puts it away past the line, or with a flick", () => {
    expect(dragCloses({ dx: DRAG.CLOSE_AT + 1, speed: 0, at }, at + 500)).toBe(
      true,
    );
    expect(dragCloses({ dx: 30, speed: 1, at }, at + 16)).toBe(true);
  });
  it("springs back from a short drag, a slow one, or a flick held still", () => {
    expect(dragCloses({ dx: 40, speed: 0.1, at }, at + 16)).toBe(false);
    expect(dragCloses({ dx: 40, speed: 1, at }, at + 400)).toBe(false);
    // A twitch is not a flick.
    expect(dragCloses({ dx: 6, speed: 2, at }, at + 8)).toBe(false);
  });
});
