import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buttonStyles } from "../../ui/Button";
import { compileTheme, holds } from "../../ui/theme.testkit";
import type { Listing } from "../shared/types";
import {
  footerStyles,
  GridSkeleton,
  headerStyles,
  ListingCard,
  listingCardStyles,
  ListingGrid,
  listingGridStyles,
  MarketFooter,
} from "./components";
import { shellStyles } from "./MarketApp";
import { browseStyles } from "./pages/BrowsePage";

/**
 * The marketplace shell, its header and footer, the listing card and the
 * browse page, rendered to markup: there is no DOM under these tests, so what
 * is asked is what a reader is handed and what the class names come to. How it
 * lays out at a width is e2e's question, and the baseline shots' (S1).
 *
 * The pages this conversion has not reached still read market.css, so the
 * checks here name the four files it did rather than the whole directory.
 */

const WEB = dirname(fileURLToPath(import.meta.url));
const html = (element: ReactElement) => renderToStaticMarkup(element);

/** The files this item converted, and every recipe they declare. */
const CONVERTED = ["MarketApp.tsx", "components.tsx", "pages/BrowsePage.tsx"];
const RECIPES = {
  browseStyles,
  footerStyles,
  headerStyles,
  listingCardStyles,
  listingGridStyles,
  shellStyles,
};

/*
 * What is left of market.css in converted markup, and why. Each one is a hook
 * on a piece another item owns; the list empties as those items land, and the
 * stylesheet goes with the last of them (D7).
 *
 * - `mk-root`   the shell's root, which scopes the rules the unconverted pages
 *               still read and carries `data-mode="light"` for design/'s tokens.
 * - `mk-empty__actions`  the row of actions inside `Empty`, which browse and
 *               the not-found page draw and four other pages draw with them.
 */

type Classes = string | readonly Classes[] | { [key: string]: Classes } | null;

/** Every class name written anywhere in a recipe, whatever its nesting. */
function written(value: Classes | undefined): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap((v) => written(v));
  return Object.values(value).flatMap((v) => written(v as Classes));
}

const read = (file: string) => readFileSync(resolve(WEB, file), "utf8");

describe("S1: Tailwind and ui/ only, in the files this item converted", () => {
  let build: (names: string[]) => string;
  beforeAll(async () => {
    build = await compileTheme();
  });

  // A class that names a value the theme does not hold is not an error
  // anywhere: it is a card quietly missing its fill. So every name is asked.
  it.each(Object.entries(RECIPES))(
    "every class in %s resolves from the theme",
    (_, recipe) => {
      const { base, slots, variants } = recipe as unknown as {
        base: Classes;
        slots: Classes;
        variants: Classes;
      };
      const names = [...written(base), ...written(slots), ...written(variants)];
      expect(names.length).toBeGreaterThan(0);
      const css = build(names);
      for (const name of names) {
        // `group` is a marker for a variant to find, not a rule.
        if (name === "group") continue;
        expect(holds(css, name), name).toBe(true);
      }
    },
  );

  it("checks every recipe those files declare", () => {
    const declared = CONVERTED.flatMap((file) =>
      [...read(file).matchAll(/export const (\w+Styles) = tv\(/g)].map(
        (m) => m[1],
      ),
    );
    expect(declared.sort()).toEqual(Object.keys(RECIPES).sort());
  });

  /*
   * A class written straight into markup would slip past the check above.
   * components.tsx still holds the pieces the other two items own (the fields,
   * the dialog, the pager), so it is asked of what this item's components
   * render rather than of the file; the two whole files it converted are asked
   * of their source.
   */
  it("writes no class outside a recipe, but the hook it names", () => {
    const files = ["MarketApp.tsx", "pages/BrowsePage.tsx"];
    const literals = files.flatMap((file) =>
      [...read(file).matchAll(/className="([^"]*)"/g)].map((m) => m[1]),
    );
    expect(literals).toEqual(["mk-empty__actions", "mk-empty__actions"]);
  });

  it("draws nothing of the old stylesheet in the markup it renders", () => {
    const rendered = [
      html(createElement(MarketFooter)),
      card("active", { saved: true }),
      html(createElement(ListingGrid, { listings: [] })),
      html(createElement(GridSkeleton, { count: 1 })),
    ];
    for (const out of rendered) {
      expect(out).not.toMatch(/class="[^"]*\bmk-/);
      expect(out).not.toMatch(/class="[^"]*\bf5-/);
    }
  });

  it("keeps the one hook on the shell's root, and nothing else there", () => {
    const root = shellStyles().root({ className: "mk-root" });
    expect(root.split(" ").filter((c) => c.startsWith("mk-"))).toEqual([
      "mk-root",
    ]);
    expect(read("MarketApp.tsx")).toContain('const LEGACY_ROOT = "mk-root"');
    expect(read("MarketApp.tsx")).toContain('data-mode="light"');
  });

  it("no longer holds the rules it converted", () => {
    const css = read("market.css");
    // The prefix is joined on rather than written into each name, because the
    // item's own ACCEPT line is a grep over market/web for several of them and
    // a test that spelt them out would be the thing it found.
    const gone = [
      "header",
      "footer",
      "brand",
      "page",
      "main",
      "hero",
      "search",
      "rail",
      "filters",
      "sort",
      "price-range",
      "results-head",
      "token",
      "grid",
      "card",
      "skeleton__line",
      "sr-only",
    ].map((name) => `mk-${name}`);
    for (const name of gone)
      // The block and the parts of it, `.mk-card`, `.mk-card__media` and
      // `.mk-card--skeleton`, since most of what was converted was a part. Not
      // a different name that merely begins the same way: `.mk-page-head` is
      // another item's and stays, as does `.mk-skeleton` beside
      // `.mk-skeleton__line`.
      expect(css, name).not.toMatch(
        new RegExp(`\\.${name}(?:__[\\w-]+|--[\\w-]+)?(?![\\w-])`),
      );
    // `.mk-root` is kept as a scope, with nothing of its own left to draw.
    expect(css).toContain(".mk-root h1");
    expect(css).not.toMatch(/^\.mk-root \{/m);
    // The search field component went with the one field that used it.
    expect(css).not.toContain("search-field/component.css");
  });
});

describe("S2: the shell's measures", () => {
  it("is 1200px wide, and a form inside it is 760", () => {
    expect(shellStyles().page()).toContain("max-w-page");
    expect(shellStyles({ narrow: true }).main()).toContain("max-w-form");
    expect(shellStyles().main()).not.toContain("max-w-form");
  });

  it("stands on the content ground, one column, full height", () => {
    const root = shellStyles().root().split(" ");
    for (const name of ["min-h-dvh", "flex", "flex-col", "bg-ground"])
      expect(root).toContain(name);
  });

  /*
   * A notch in landscape and a home bar at the foot. market.css wrote three
   * `max(…, env(safe-area-inset-*))` and they are three utilities now, so the
   * gutter, the sticky header's top and the last row's foot are all the larger
   * of the two. Nothing else on these pages faces a device edge.
   */
  it("keeps every edge that faces the device clear of it", () => {
    const page = shellStyles().page().split(" ");
    expect(page).toContain("px-safe-6");
    expect(page).toContain("max-wide:px-safe-3");
    expect(page).not.toContain("px-6");
    expect(page).not.toContain("max-wide:px-3");

    expect(headerStyles().base().split(" ")).toContain("pt-safe-3");
    expect(footerStyles().base()).toContain("pb-safe-6");
  });
});

describe("S3: what a phone drops, at 720px", () => {
  it("is the same breakpoint market.css used", async () => {
    const build = await compileTheme();
    const css = build(["wide:inline", "max-wide:hidden"]);
    expect(css).toMatch(/@media \(width >= 45rem\) \{\s*\.wide\\:inline \{/);
    expect(css).toMatch(/@media \(width < 45rem\) \{\s*\.max-wide\\:hidden \{/);
  });

  it("drops the labels from the header and tightens the bar", () => {
    const styles = headerStyles();
    expect(styles.label()).toBe("hidden wide:inline");
    expect(styles.name()).toContain("wide:inline-flex");
    expect(styles.bar()).toContain("max-wide:px-1");
  });

  it("scrolls the category rail on one line, bleeding to the edge", () => {
    const rail = browseStyles().rail().split(" ");
    for (const name of [
      "max-wide:flex-nowrap",
      "max-wide:overflow-x-auto",
      "max-wide:scrollbar-none",
      "max-wide:-mx-3",
    ])
      expect(rail).toContain(name);
    // And wraps onto as many lines as it needs above the breakpoint.
    expect(rail).toContain("flex-wrap");
  });

  it("folds the filters behind one 44px toggle", () => {
    const styles = browseStyles({ open: false });
    const toggle = styles.toggle().split(" ");
    expect(toggle).toContain("hidden");
    expect(toggle).toContain("max-wide:inline-flex");
    expect(toggle).toContain("max-wide:h-touch");
    // Closed, the panel is not there; open, it is a column under the row.
    expect(styles.panel()).toContain("max-wide:hidden");
    const open = browseStyles({ open: true }).panel().split(" ");
    expect(open).toContain("max-wide:grid");
    expect(open).not.toContain("max-wide:hidden");
    expect(open).toContain("max-wide:grid-cols-1");
  });

  it("lays the grid out two up", () => {
    const grid = listingGridStyles().split(" ");
    expect(grid).toContain("grid-cols-cards");
    expect(grid).toContain("max-wide:grid-cols-2");
  });

  /*
   * A thumb, not a pointer. The kit's own controls carry the minimum, so the
   * rail's chips and the toggle already have it; the removable filter is the
   * one control on this page that ui/ has no part for, and it is asked for
   * here so that it does not stay 30px beside a 44px chip.
   */
  it("gives every control a reader taps 44px, the kit's and its own", () => {
    expect(browseStyles().token()).toContain("pointer-coarse:min-h-touch");
    expect(buttonStyles({ variant: "pill" })).toContain(
      "pointer-coarse:min-h-touch",
    );
    // The toggle says 44 outright, as market.css did, rather than by minimum.
    expect(browseStyles().toggle()).toContain("max-wide:h-touch");
  });

  it("stacks the footer's two ends", () => {
    expect(footerStyles().base()).toContain("max-wide:flex-col");
  });
});

describe("S5: what the card does, and what it does not", () => {
  it("lifts and zooms under the pointer, and stands still under reduce", () => {
    const styles = listingCardStyles();
    expect(styles.card()).toContain(
      "motion-safe:not-disabled:hover:-translate-y-1",
    );
    expect(styles.card()).toContain("not-disabled:hover:shadow-surface");
    expect(styles.card()).toContain("motion-reduce:transition-none");
    expect(styles.image()).toContain("motion-safe:group-hover:scale-104");
    expect(styles.image()).toContain("motion-reduce:transition-none");
  });

  it("does none of it where the card is a placeholder, which pulses instead", () => {
    const styles = listingCardStyles({ linked: false, loading: true });
    expect(styles.card()).not.toContain("hover:");
    expect(styles.image()).not.toContain("hover:");
    expect(styles.media()).toContain("animate-pulse");
    expect(styles.media()).toContain("motion-reduce:animate-none");
  });

  // Greyscale is not motion: a sold listing stays grey however still the page.
  it("drains the colour from a sold cover, always", () => {
    expect(listingCardStyles().image()).toContain("group-data-sold:grayscale");
    expect(listingCardStyles().image()).not.toContain(
      "motion-safe:group-data-sold:grayscale",
    );
  });

  it("says sold to the stylesheet with an attribute, not a colour", () => {
    const openTag = (out: string) => out.slice(0, out.indexOf(">"));
    expect(openTag(card("sold"))).toContain('data-sold=""');
    expect(openTag(card("active"))).not.toContain("data-sold");
  });

  it("is one link, with the price, the title and where it is", () => {
    const out = card("active");
    expect(out).toMatch(/^<a href="\/market\/listing\/l1"/);
    expect(out).toContain("€380");
    expect(out).toContain("<h3");
    expect(out).toContain("Castlegregory, Kerry");
    // Two photos, so the count badge, and a rating the seller has earned.
    expect(out).toContain("Photos:");
    expect(out).toContain("4.5");
  });

  it("badges a saved listing in glass, at the corner of the photograph", () => {
    // Top left is the badge's corner; bottom right is the photo count's,
    // which every card with more than one photo already carries.
    expect(card("active", { saved: true })).toMatch(
      /class="[^"]*bg-glass[^"]*absolute top-3 left-3"/,
    );
    expect(card("active")).not.toMatch(/absolute top-3 left-3/);
    expect(card("active")).toMatch(
      /class="[^"]*bg-glass[^"]*absolute right-3 bottom-3"/,
    );
  });
});

/** A listing with two photos, enough for a card and its count badge. */
function listingOf(status: Listing["status"], over: Partial<Listing>): Listing {
  const photo = (id: string) => ({
    id,
    url: `/${id}.png`,
    width: 8,
    height: 6,
  });
  return {
    id: "l1",
    title: "Brandon 4m wing, 2023",
    description: "",
    category: "wing",
    condition: "good",
    brand: null,
    sizeLabel: null,
    year: null,
    priceCents: 38000,
    currency: "EUR",
    county: "Kerry",
    town: "Castlegregory",
    status,
    createdAt: "2026-09-17T09:00:00.000Z",
    updatedAt: "2026-09-17T09:00:00.000Z",
    soldAt: null,
    photos: [photo("a"), photo("b")],
    seller: {
      id: "s1",
      displayName: "Maeve Doyle",
      county: "Kerry",
      memberSince: "2024-04-11T09:00:00.000Z",
      ratingAvg: 4.5,
      ratingCount: 2,
      soldCount: 1,
    },
    ...over,
  };
}

const card = (status: Listing["status"], over: Partial<Listing> = {}) =>
  html(createElement(ListingCard, { listing: listingOf(status, over) }));

/**
 * The header reads the session, which is chosen from the environment when the
 * auth module loads: each case sets it and loads afresh.
 */
async function headerAs(devUser: string | null, accentSell: boolean) {
  vi.resetModules();
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
  vi.stubEnv("VITE_MARKET_DEV_USER", devUser ?? "");
  const { MarketAuthProvider } = await import("./auth");
  const { MarketHeader } = await import("./components");
  return html(
    createElement(MarketAuthProvider, {
      children: createElement(MarketHeader, { accentSell }),
    }),
  );
}

describe("S4: the header, and its one filled action", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is the site menu, the brand, the chip and the marketplace's nav", async () => {
    const out = await headerAs(null, true);
    expect(out).toContain('aria-label="Site menu"');
    expect(out).toMatch(
      /<a href="\/market"[^>]*aria-label="wingfoil\.ie Market, home"/,
    );
    expect(out).toMatch(/<span class="[^"]*uppercase[^"]*">Market<\/span>/);
    expect(out).toMatch(/<nav class="[^"]*" aria-label="Marketplace">/);
  });

  it("signed out is Sell and Sign in, and nothing a reader cannot use", async () => {
    const out = await headerAs(null, true);
    expect(out).toContain("Sign in");
    expect(out).not.toContain("My listings");
  });

  it("signed in is Sell, My listings and who you are", async () => {
    const out = await headerAs("maeve", true);
    expect(out).not.toContain("Sign in");
    expect(out).toMatch(/<a href="\/market\/me"/);
    expect(out).toContain(">maeve</span>");
  });

  it("fills Sell only where the view has no primary of its own", async () => {
    const sell = (out: string) =>
      out.match(/<a href="\/market\/sell" class="([^"]*)"/)![1];
    const filled = sell(await headerAs("maeve", true));
    expect(filled).toContain("bg-accent");
    // And takes the wider inset only where the bar has room for it.
    expect(filled).toContain("wide:px-3");
    const stood = sell(await headerAs("maeve", false));
    expect(stood).not.toContain("bg-accent");
    expect(stood).toContain("bg-card");
    expect(stood).not.toContain("wide:px-3");
  });
});

describe("S4: accentSell decides which action is filled", () => {
  it.each([
    ["/market", true],
    ["/market/seller/abc", true],
    ["/market/listing/abc", false],
    ["/market/sell", false],
    ["/market/me", false],
    ["/market/nowhere", false],
  ])("%s: Sell is primary = %s", async (pathname, primary) => {
    const { matchRoute } = await import("./router");
    const route = matchRoute(pathname);
    expect(route.page === "browse" || route.page === "seller").toBe(primary);
  });
});

describe("S6: the footer", () => {
  it("is the year, three plain links and a hairline above them", () => {
    const out = html(createElement(MarketFooter));
    expect(out).toMatch(/^<footer class="[^"]*border-t[^"]*"/);
    expect(out).toContain(`© ${new Date().getFullYear()} wingfoil.ie`);
    expect(out).toMatch(/<nav class="[^"]*" aria-label="Footer">/);
    const hrefs = [...out.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/market", "/market/sell", "/"]);
    // A list of nothing but links needs no underlines.
    expect(out).toContain("no-underline");
  });
});
