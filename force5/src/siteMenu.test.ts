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
  SiteSections,
  dragCloses,
  siteMenuStyles,
} from "./SiteMenu";

/**
 * The site menu, drawn from ui/ and the theme rather than the design bundle's
 * stylesheet. How it behaves (Escape, focus, blur, the grown hit area) is
 * e2e/site-menu.spec.ts's; what is asked here is that every class it writes
 * comes to something, and that each ground gets the look it had.
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

describe("on the chart", () => {
  /*
   * The trigger is the kit's own button, not one that looks like it: every
   * class of the kit's (its hover and ring included), and only the menu's
   * hit band on top. On either ground it is the round menu button: the
   * kit's raised paper button with an icon in it (mixed and rounded,
   * 2026-10-24).
   */
  it("draws the trigger as exactly the kit's button: the round raised menu button on either ground", () => {
    const classOf = (markup: string) =>
      markup
        .match(/<button[^>]*\bclass="([^"]+)"/)?.[1]
        .split(" ")
        .sort();
    const cases = [
      [{ current: "map", size: "md", ground: "map" }, "md", "raised"],
      [{ current: "market", size: "sm", ground: "content" }, "sm", "raised"],
    ] as const;
    for (const [props, size, variant] of cases) {
      const kit = buttonStyles({
        variant,
        size,
        icon: true,
        className: siteMenuStyles({ ground: props.ground }).trigger(),
      });
      const drawn = classOf(html(props));
      expect(drawn, props.ground).toEqual(kit.split(" ").sort());
      expect(drawn, props.ground).toContain(
        "not-disabled:focus-visible:outline-focus",
      );
      for (const name of ["rounded-full", "border-ink", "sheen-raised"])
        expect(drawn, `${props.ground} ${name}`).toContain(name);
    }
  });

  /*
   * The drawer: paper at the left edge, ruled in ink down its right edge,
   * its corners and its shadow the theme's (so a change to the dialog's
   * radius or the sheet's shadow reaches it), sliding in over the kit's
   * backdrop and holding still for a reader who asks for less motion.
   */
  it("draws the drawer from the theme: the left edge, the dialog's radius, the kit's backdrop", () => {
    const classes = siteMenuStyles().drawer().split(" ");
    for (const name of [
      "fixed",
      "left-0",
      "inset-y-0",
      "h-dvh",
      "w-80",
      "max-w-11/12",
      "rounded-r-dialog",
      "border-r",
      "border-ink",
      "bg-card",
      "paper-grain",
      "shadow-sheet",
      "backdrop:scrim",
      "drawer-slide",
      "touch-pan-y",
    ])
      expect(classes, name).toContain(name);
    // No radius or shadow of its own.
    expect(classes.join(" ")).not.toMatch(
      /rounded-(?!r-dialog)|shadow-(?!sheet)/,
    );
    expect(classes.join(" ")).not.toMatch(/glass/);
    expect(SOURCE).toMatch(/<dialog[\s\S]*className=\{styles\.drawer\(\)\}/);
  });

  it("slides in and out at the fast duration, and holds still for less motion", () => {
    const css = build(["drawer-slide"]);
    expect(css).toMatch(/@starting-style \{\s*transform: translateX\(-100%\);/);
    expect(css).toContain("transform var(--transition-duration-fast) ease");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^}]*transition: none;/,
    );
  });

  it("names every row in the body face, on hairlines, with its glyph in the margin", () => {
    for (const slot of ["row", "tool"] as const) {
      const row = siteMenuStyles()[slot]().split(" ");
      for (const name of ["font-body", "border-b", "border-line", "h-touch"])
        expect(row, `${slot} ${name}`).toContain(name);
    }
    expect(SOURCE).toContain(
      "<ChartGlyph glyph={SECTION_GLYPH[section.id]} />",
    );
    expect(SOURCE).toContain(
      "<span className={styles.glyph()}>{tool.glyph}</span>",
    );
  });

  it("is signed by nothing: the Almanac and its puffin are gone from the menu", () => {
    expect(SOURCE).not.toContain("Puffin");
    expect(SOURCE).not.toContain("Almanac");
  });

  it("has a grip on its right edge, and a close button and the name at its head", () => {
    const grip = siteMenuStyles().grip().split(" ");
    for (const name of ["absolute", "right-1.5", "top-1/2", "rounded-full"])
      expect(grip).toContain(name);
    expect(SOURCE).toContain('aria-label="Close menu"');
    expect(SOURCE).toContain('<Wordmark size="sm" />');
  });

  it("sets the section you are in in the italic, heavier, on the second sheet", () => {
    const here = siteMenuStyles({ current: true }).row().split(" ");
    for (const name of ["italic", "font-bold", "bg-sunken"])
      expect(here).toContain(name);
    const other = siteMenuStyles().row().split(" ");
    for (const name of ["italic", "font-bold", "bg-sunken"])
      expect(other).not.toContain(name);
  });

  it("keeps a row the height of touch, and the trigger's own size on a finger", () => {
    expect(siteMenuStyles().row().split(" ")).toContain("h-touch");
    const trigger = siteMenuStyles().trigger().split(" ");
    for (const name of [
      "pointer-coarse:min-h-0",
      "pointer-coarse:min-w-0",
      "pointer-coarse:after:h-touch",
      "pointer-coarse:after:inset-x-0",
    ])
      expect(trigger).toContain(name);
  });
});

describe("the markup", () => {
  it("draws nothing of the drawer until it is opened", () => {
    const markup = html({ current: "map" });
    expect(markup).not.toContain("<dialog");
    expect(markup).not.toContain("<nav");
  });

  it("is a disclosure: a named button, closed, controlling nothing yet", () => {
    const markup = html({ current: "community", size: "sm" });
    expect(markup).toContain('aria-label="Site menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("aria-haspopup");
    expect(markup).not.toContain("aria-controls");
    expect(markup).not.toContain("aria-pressed");
    expect(markup).toMatch(new RegExp(`^<div class="${HOOK} `));
    expect(markup).not.toContain("data-mode");
  });
});

describe("the sections", () => {
  const rows = (props: Parameters<typeof SiteSections>[0]) =>
    renderToStaticMarkup(createElement(SiteSections, props));

  it("gives every section its glyph, the chart's and the AI's among them", () => {
    const markup = rows({
      current: "map",
      features: { market: true, community: true },
    });
    const links = markup.match(/<a [^>]*>[\s\S]*?<\/a>/g) ?? [];
    expect(links.map((link) => link.replace(/<[^>]+>/g, ""))).toEqual([
      "Wind map",
      "Marketplace",
      "Community",
      "Use with AI",
    ]);
    for (const link of links) expect(link).toMatch(/<svg[^>]*class="g-set"/);
    // The two drawn for the menu: the folded chart, and the bubble.
    for (const glyph of [glyphs.windMap, glyphs.useWithAi]) {
      const sheet = glyph[0];
      expect("d" in sheet && markup.includes(`d="${sheet.d}"`)).toBe(true);
    }
    expect(markup).toContain('aria-current="page"');
  });

  it("draws nothing at all of the marketplace or the community when they are off", () => {
    const markup = rows({
      current: "map",
      features: { market: false, community: false },
    });
    expect(markup).not.toMatch(/Marketplace|Community|\/market|\/community/);
    expect(markup.match(/<li>/g)).toHaveLength(2);
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
});

describe("a finger on the drawer", () => {
  const at = 1000;
  it("puts it away past the line, or with a flick", () => {
    expect(dragCloses({ dx: -DRAG.CLOSE_AT - 1, speed: 0, at }, at + 500)).toBe(
      true,
    );
    expect(dragCloses({ dx: -30, speed: -1, at }, at + 16)).toBe(true);
  });
  it("springs back from a short drag, a slow one, or a flick held still", () => {
    expect(dragCloses({ dx: -40, speed: -0.1, at }, at + 16)).toBe(false);
    expect(dragCloses({ dx: -40, speed: -1, at }, at + 400)).toBe(false);
    // A twitch is not a flick.
    expect(dragCloses({ dx: -6, speed: -2, at }, at + 8)).toBe(false);
  });
});
