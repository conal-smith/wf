import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Field, TextInput } from "../../ui";
import { buttonStyles } from "../../ui/Button";
import { checkboxStyles } from "../../ui/Checkbox";
import { controlStyles } from "../../ui/control";
import { fieldStyles } from "../../ui/Field";
import { mastheadStyles } from "../../ui/Masthead";
import { compileTheme, holds } from "../../ui/theme.testkit";
import type { Listing } from "../shared/types";
import {
  Avatar,
  faceStyles,
  footerStyles,
  GridSkeleton,
  headerStyles,
  ListingCard,
  listingCardStyles,
  ListingGrid,
  listingGridStyles,
  MarketFooter,
  PageSkeleton,
  RatingPicker,
  ratingStyles,
  SaveButton,
  SellerRating,
  sharedStyles,
  shortAge,
  Stars,
  starsOf,
  newestFresh,
  notFoundStyles,
  tabStyles,
} from "./components";
import { shellStyles } from "./MarketApp";
import { browseStyles } from "./pages/BrowsePage";
import { gated, listingStyles } from "./pages/ListingPage";
import { meStyles } from "./pages/MePage";
import { profileFormStyles } from "./pages/ProfileForm";
import { sellerStyles } from "./pages/SellerPage";
import { sellStyles } from "./pages/SellPage";

/**
 * The marketplace, rendered to markup: there is no DOM under these tests, so
 * what is asked is what a reader is handed and what the class names come to.
 * How it lays out at a width is e2e's question, and the baseline shots' (S1).
 *
 * Every page is converted and market.css is gone (D7), so the checks here are
 * asked of the whole directory.
 */

const WEB = dirname(fileURLToPath(import.meta.url));
const html = (element: ReactElement) => renderToStaticMarkup(element);

/*
 * The two prefixes the old stylesheets drew with: the marketplace's own and
 * the design bundle's. Joined rather than written out, because the item's
 * ACCEPT line is a grep over market/web for the first, and a test that spelt
 * it would be the thing it found.
 */
const MK = ["mk", ""].join("-");
const F5 = ["f5", ""].join("-");
/** A rendered class attribute that names either. */
const OLD_CLASS = new RegExp(`class="[^"]*\\b(?:${MK}|${F5})`);

/** Every file under market/web, as a path relative to it. */
function walk(dir = WEB): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [relative(WEB, path)];
  });
}
const SOURCES = walk().filter((file) => /\.tsx?$/.test(file));
/** The markup: every source file but the tests. */
const MARKUP = SOURCES.filter((file) => !/\.test\.tsx?$/.test(file));

/** The files converted, and every recipe they declare. */
const CONVERTED = [
  "MarketApp.tsx",
  "components.tsx",
  "pages/BrowsePage.tsx",
  "pages/ListingPage.tsx",
  "pages/MePage.tsx",
  "pages/ProfileForm.tsx",
  "pages/SellerPage.tsx",
  "pages/SellPage.tsx",
];
const RECIPES = {
  browseStyles,
  faceStyles,
  footerStyles,
  headerStyles,
  listingCardStyles,
  listingGridStyles,
  listingStyles,
  meStyles,
  profileFormStyles,
  ratingStyles,
  sellerStyles,
  sellStyles,
  sharedStyles,
  notFoundStyles,
  shellStyles,
  tabStyles,
};

type Classes = string | readonly Classes[] | { [key: string]: Classes } | null;

/** Every class name written anywhere in a recipe, whatever its nesting. */
function written(value: Classes | undefined): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap((v) => written(v));
  return Object.values(value).flatMap((v) => written(v as Classes));
}

const read = (file: string) => readFileSync(resolve(WEB, file), "utf8");

describe("S1: Tailwind and ui/ only, everywhere in the marketplace", () => {
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

  it("names every file that draws, and checks every recipe they declare", () => {
    const drawing = MARKUP.filter((file) => /className/.test(read(file)));
    expect(drawing.sort()).toEqual([...CONVERTED].sort());
    const declared = CONVERTED.flatMap((file) =>
      [...read(file).matchAll(/export const (\w+Styles) = tv\(/g)].map(
        (m) => m[1],
      ),
    );
    expect(declared.sort()).toEqual(Object.keys(RECIPES).sort());
  });

  /*
   * A class written straight into markup would slip past the check above.
   * Quoted, or a string in braces, or a string handed to a recipe as its
   * className: `className={"x"}` is the same literal as `className="x"`.
   */
  it("writes no class outside a recipe", () => {
    const literal =
      /className(?:=|:\s*|=\{\s*)(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
    const literals = MARKUP.flatMap((file) =>
      [...read(file).matchAll(literal)].map((m) => m[1] ?? m[2] ?? m[3]),
    );
    expect(literals).toEqual([]);
  });

  it("draws nothing of the old stylesheets in the markup it renders", () => {
    const rendered = [
      html(createElement(MarketFooter)),
      card("active", { saved: true }),
      html(createElement(ListingGrid, { listings: [] })),
      html(createElement(GridSkeleton, { count: 1 })),
      html(createElement(Stars, { value: 3 })),
      html(createElement(Stars, { value: null })),
      html(createElement(RatingPicker, { value: 2, onChange: () => {} })),
      html(createElement(SellerRating, { seller: sellerOf(0) })),
      html(createElement(SellerRating, { seller: sellerOf(4) })),
      html(
        createElement(SaveButton, {
          saved: true,
          busy: false,
          onToggle: () => {},
        }),
      ),
      html(
        createElement(SaveButton, {
          saved: false,
          busy: false,
          onToggle: () => {},
        }),
      ),
      html(createElement(PageSkeleton)),
      html(createElement(Avatar, { name: "aoife" })),
      html(createElement(Avatar, { name: "aoife", large: true })),
    ];
    for (const out of rendered) expect(out).not.toMatch(OLD_CLASS);
  });

  /*
   * S5: the stylesheet is gone, and nothing in the directory names it, its
   * prefix, or the design bundle's classes. The site menu is force5's and
   * brings its own stylesheet; the marketplace only says what it stands on.
   */
  it("holds no stylesheet, and no name from the old ones", () => {
    expect(existsSync(resolve(WEB, "market.css"))).toBe(false);
    expect(walk().filter((file) => file.endsWith(".css"))).toEqual([]);
    for (const file of walk()) {
      expect(read(file), file).not.toContain(MK);
      expect(read(file), file).not.toContain(F5);
    }
    expect(read("MarketApp.tsx")).not.toMatch(/import "\.\/[\w.]*\.css"/);
  });

  it("puts no hook and no mode on the shell's root", () => {
    const app = read("MarketApp.tsx");
    expect(app).not.toContain("LEGACY_ROOT");
    expect(app).not.toContain("data-mode");
    // Nothing but utilities on the root.
    for (const name of shellStyles().root().split(" "))
      expect(name).not.toMatch(new RegExp(`^(?:${MK}|${F5})`));
  });

  it("stands the site menu on the header's card, not on glass", () => {
    expect(read("components.tsx")).toContain(
      '<SiteMenu current="market" size="sm" ground="content" />',
    );
  });

  it("draws the face beside a name as the kit's monogram, a size down on a phone", () => {
    expect(faceStyles({ large: true }).split(" ")).toEqual(
      expect.arrayContaining(["max-wide:size-14", "max-wide:text-lead"]),
    );
    expect(html(createElement(Avatar, { name: "Aoife Byrne" }))).toContain(
      ">AB<",
    );
    // The kit's ring in ink, not the old filled disc.
    expect(html(createElement(Avatar, { name: "aoife" }))).toMatch(
      /class="[^"]*border-ink[^"]*italic/,
    );
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

    // The header is the site's masthead now, and it keeps the notch clear too.
    expect(mastheadStyles().base().split(" ")).toContain("pt-safe-2");
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
    expect(mastheadStyles().bar()).toContain("max-wide:gap-2");
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
  it("is a ruled pane: the heavy rule over the ad, no box round it", () => {
    const out = card("active");
    const open = out.slice(0, out.indexOf(">"));
    expect(open).toContain("border-t-2");
    expect(open).toContain("border-ink");
    expect(open).not.toMatch(/[\s"]border[\s"]/);
    // The photograph stands in its own hairline frame.
    expect(listingCardStyles().media().split(" ")).toEqual(
      expect.arrayContaining(["border", "border-line"]),
    );
  });

  it("does not float under the pointer: the name underlines, the photo leans in", () => {
    const styles = listingCardStyles();
    expect(styles.card()).not.toContain("translate");
    expect(styles.card()).not.toContain("shadow");
    expect(styles.title()).toContain("group-hover:underline");
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

  it("is one link, with the price as a figure, the title and where it is", () => {
    const out = card("active");
    expect(out).toMatch(/^<a href="\/market\/listing\/l1"/);
    expect(out).toMatch(/class="[^"]*font-mono[^"]*tabular-nums[^"]*">.*€380/);
    expect(out).toContain("<h3");
    // The town and the county, each in a span of its own: on a phone the town
    // gives way and the county, the one a buyer filters on, stays whole.
    expect(out).toMatch(/<span class="truncate">Castlegregory<\/span><span class="shrink-0">,\u00a0Kerry<\/span>/);
    // The stars beside the condition say whose they are.
    expect(out).toMatch(/>Seller<\/span><svg[^>]*aria-label="4.5 out of 5"/);
    // Two photos, so the count badge, and the seller's stars, said in words.
    expect(out).toContain("Photos:");
    expect(out).toContain('aria-label="4.5 out of 5"');
  });

  it("leaves out what the page around it already says", () => {
    const listing = listingOf("active", { saved: true });
    // The Saved tab: every card on it is saved.
    const onSaved = html(createElement(ListingCard, { listing, hideSaved: true }));
    expect(onSaved).not.toContain("Saved");
    // The seller's own page: every card is theirs, and their rating heads it.
    const onSeller = html(createElement(ListingCard, { listing, hideSeller: true }));
    expect(onSeller).not.toContain(">Seller<");
    expect(onSeller).not.toContain('aria-label="4.5 out of 5"');
  });

  it("badges a saved listing on paper, at the corner of the photograph", () => {
    // Top left is the badge's corner; bottom right is the photo count's,
    // which every card with more than one photo already carries.
    expect(card("active", { saved: true })).toMatch(
      /class="[^"]*bg-glass[^"]*absolute top-2 left-2"/,
    );
    expect(card("active")).not.toMatch(/absolute top-2 left-2/);
    expect(card("active")).toMatch(
      /class="[^"]*bg-glass[^"]*absolute right-2 bottom-2"/,
    );
  });

  it("loops new in the pen on one card at most, and only from this week", () => {
    const now = Date.parse("2026-09-20T09:00:00.000Z");
    const at = (id: string, iso: string, status: Listing["status"] = "active") =>
      listingOf(status, { id, createdAt: iso });
    expect(
      newestFresh(
        [
          at("old", "2026-09-17T09:00:00.000Z"),
          at("newer", "2026-09-19T09:00:00.000Z"),
          at("sold", "2026-09-20T08:00:00.000Z", "sold"),
        ],
        now,
      ),
    ).toBe("newer");
    expect(newestFresh([at("old", "2026-09-01T09:00:00.000Z")], now)).toBe(
      null,
    );
    const fresh = html(
      createElement(ListingCard, {
        listing: listingOf("active", {}),
        fresh: true,
      }),
    );
    expect(fresh).toMatch(/font-hand[^"]*">new</);
    expect(card("active")).not.toContain("font-hand");
  });

  it("says an age as a figure, and in words to a screen reader", () => {
    const now = Date.parse("2026-09-20T09:00:00.000Z");
    expect(shortAge("2026-09-20T08:59:50.000Z", now)).toBe("now");
    expect(shortAge("2026-09-20T07:00:00.000Z", now)).toBe("2h");
    expect(shortAge("2026-09-17T09:00:00.000Z", now)).toBe("3d");
    expect(shortAge("2026-08-30T09:00:00.000Z", now)).toBe("3w");
    // The card reads the clock itself: hold it three days after the listing.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(now);
      const drawn = card("active");
      expect(drawn).toMatch(/<span aria-hidden="true">3d<\/span>/);
      expect(drawn).toMatch(/class="sr-only">Listed 3 days ago</);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Every class name a recipe writes, whatever branch of it. */
const classesOf = (recipe: unknown) => {
  const { base, slots, variants } = recipe as {
    base: Classes;
    slots: Classes;
    variants: Classes;
  };
  return [...written(base), ...written(slots), ...written(variants)];
};

/** Everything on a slot that decides where in a grid the box lands. */
const places = (classes: string) =>
  classes
    .split(" ")
    .filter((c) =>
      /(^|:)(grid-cols-|col-start|row-start|row-span|sticky)/.test(c),
    );

describe("S1: the listing's two columns, and the panel that stays in view", () => {
  it("is two columns where there is room, and one where there is not", () => {
    const styles = listingStyles();
    expect(styles.detail().split(" ")).toContain("rail:grid-cols-detail");
    /*
     * Every class that places a child carries the same breakpoint, so under it
     * there is no template and no placement at all and the three children
     * stack in the order they are written: the photographs, then the panel,
     * then the description. That is the order market.css named in its areas.
     */
    const placed = [
      styles.detail(),
      styles.gallery(),
      styles.aside(),
      styles.body(),
    ].flatMap(places);
    expect(placed.length).toBeGreaterThan(4);
    for (const name of placed) expect(name, name).toMatch(/^rail:/);
    const order = read("pages/ListingPage.tsx");
    expect(order.indexOf("styles.gallery()")).toBeLessThan(
      order.indexOf("<Aside"),
    );
    expect(order.indexOf("<Aside")).toBeLessThan(
      order.indexOf("styles.body()"),
    );
  });

  it("holds the panel clear of the sticky header", () => {
    // 22.5 steps of 4px is 90: the header's bar, its inset and the gap under
    // it, which is what market.css added up to. The header itself is 70.
    expect(listingStyles().aside().split(" ")).toContain("rail:top-22.5");
  });

  it("lets the action's words wrap before the row runs past the panel", () => {
    const fill = buttonStyles({
      variant: "primary",
      size: "lg",
      className: listingStyles().fill(),
    }).split(" ");
    for (const name of ["min-w-0", "whitespace-normal", "leading-tight"])
      expect(fill, name).toContain(name);
    expect(fill).not.toContain("whitespace-nowrap");
  });

  /*
   * Three to two at the same breakpoint, but on the floor the old head rule had.
   * The detail panel's 320 binds from 900 to about 920 wide, where the head's
   * second column is 311-319px; 260 never binds there, as it never did.
   */
  it("gives the seller's head its own floor, not the detail panel's", () => {
    const head = sellerStyles().head().split(" ");
    expect(head).toContain("rail:grid-cols-profile");
    expect(head).not.toContain("rail:grid-cols-detail");
  });
});

describe("the tabs, on the seller's page and the account", () => {
  // The row clips what overflows it, so the ring goes inside the tab.
  it("draws the ring inside the tab, where the row cannot clip it", () => {
    const tab = tabStyles().tab().split(" ");
    expect(tab).toContain("not-disabled:focus-visible:-outline-offset-2");
    expect(tab).not.toContain("not-disabled:focus-visible:outline-offset-2");
    expect(tab).toContain("not-disabled:focus-visible:outline-2");
    expect(tabStyles().list().split(" ")).toContain("overflow-x-auto");
    expect(tabStyles().list().split(" ")).toContain("scrollbar-none");
  });

  it("underlines the one being read in ink and sets it heavier, not colour alone", () => {
    const tab = tabStyles().tab().split(" ");
    expect(tab).toContain("aria-selected:border-ink");
    expect(tab).toContain("aria-selected:font-semibold");
    expect(tab).toContain("pointer-coarse:min-h-touch");
  });

  it("is the one recipe both pages draw their tabs with", () => {
    expect(read("pages/SellerPage.tsx")).toContain("tabs.tab()");
    expect(read("pages/MePage.tsx")).toContain("tabs.tab()");
    expect(read("pages/MePage.tsx")).toMatch(/<Link[\s\S]*?role="tab"/);
    expect(read("pages/MePage.tsx")).toContain(
      "<small className={tabs.count()}",
    );
  });
});

describe("S2: the gallery", () => {
  it("shows the whole photograph, four to three, never cropped", () => {
    const styles = listingStyles();
    expect(styles.frame().split(" ")).toContain("aspect-4/3");
    expect(styles.photo().split(" ")).toContain("object-contain");
  });

  it("draws a thumbnail 76 wide at the same ratio, which is 57 tall", () => {
    const thumb = listingStyles().thumb().split(" ");
    // 19 steps of 4px, and the height follows from the ratio.
    expect(thumb).toContain("w-19");
    expect(thumb).toContain("aspect-4/3");
    // Already past the coarse-pointer minimum, so it asks for none.
    expect(thumb).not.toContain("pointer-coarse:min-h-touch");
  });

  it("says which thumbnail is chosen with a line, not an opacity alone", () => {
    const pressed = listingStyles()
      .thumb()
      .split(" ")
      .filter((c) => c.startsWith("aria-pressed:"));
    expect(pressed).toContain("aria-pressed:not-focus-visible:outline-2");
    expect(pressed).toContain("aria-pressed:not-focus-visible:outline-ink");
    // The opacity is there too, and on its own it would not be a state.
    expect(pressed).toContain("aria-pressed:opacity-100");
    // The outline gives way to the focus ring, never sits over it.
    for (const c of pressed.filter((c) => c.includes("outline")))
      expect(c, c).toMatch(/^aria-pressed:not-focus-visible:/);
  });
});

describe("S3: a rating is the chart's star, and the shape says it", () => {
  it("draws whole stars, the half an average reaches past, and dots", () => {
    expect(starsOf(4.5)).toEqual({ stars: 4, potential: 5 });
    expect(starsOf(4.2)).toEqual({ stars: 4, potential: 4 });
    expect(starsOf(4.8)).toEqual({ stars: 5, potential: 5 });
    expect(starsOf(0)).toEqual({ stars: 0, potential: 0 });
    const out = html(createElement(Stars, { value: 4.5 }));
    expect(out).toContain('aria-label="4.5 out of 5"');
    // Four solid, one outline, no lucide star anywhere.
    expect(out.match(/fill-current"/g)).toHaveLength(4);
    expect(out).toContain("fill-none stroke-current");
    expect(out).not.toContain("lucide");
    expect(html(createElement(Stars, { value: null }))).toContain(
      'aria-label="Not yet rated"',
    );
  });

  it("picks a rating with the same star, solid when lit", () => {
    const out = html(createElement(RatingPicker, { value: 2, onChange: () => {} }));
    expect(out.match(/role="radio"/g)).toHaveLength(5);
    expect(out.match(/fill-current"/g)).toHaveLength(2);
    expect(out).not.toContain("lucide");
    for (const lit of [true, false]) {
      const star = buttonStyles({
        icon: true,
        size: "md",
        className: ratingStyles({ lit }).star(),
      }).split(" ");
      expect(star).toContain(lit ? "text-ink" : "text-ink-muted");
      expect(star).toContain("not-disabled:hover:bg-transparent");
    }
  });

  it("sums a seller up in a figure beside the stars, or says there is none", () => {
    expect(html(createElement(SellerRating, { seller: sellerOf(2) }))).toMatch(
      /font-mono[^"]*">4\.5/,
    );
    expect(html(createElement(SellerRating, { seller: sellerOf(0) }))).toContain(
      "No ratings yet",
    );
  });

  // The histogram's bars are a quantity, so they are magenta's wash; nothing
  // on these pages fills in the accent but the kit's one primary.
  it("fills the histogram in the wash, and leaves the accent fill to the action", () => {
    expect(sellerStyles().fill().split(" ")).toContain("bg-wash/25");
    expect(classesOf(listingStyles)).not.toContain("bg-accent");
    expect(classesOf(ratingStyles)).not.toContain("bg-accent");
    expect(classesOf(sellerStyles)).not.toContain("bg-accent");
    expect(buttonStyles({ variant: "primary" })).toContain("bg-accent");
    // Saved is a toggle that says so in its own words, not another fill.
    expect(
      buttonStyles({ variant: "pill", pressed: "worded" }).split(" "),
    ).not.toContain("bg-inverse");
  });
});

/**
 * The aside reads the session, which is chosen from the environment when the
 * auth module loads, so each case sets it and loads afresh — as the header's
 * cases do. A build with neither a key nor a dev name has no way in at all,
 * which is the state the baseline shots are taken in.
 */
async function asideAs(devUser: string | null, over: Partial<Listing> = {}) {
  vi.resetModules();
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
  vi.stubEnv("VITE_MARKET_DEV_USER", devUser ?? "");
  const { MarketAuthProvider } = await import("./auth");
  const { Aside: Panel } = await import("./pages/ListingPage");
  return html(
    createElement(MarketAuthProvider, {
      children: createElement(Panel, {
        listing: listingOf("active", over),
        onChange: () => {},
      }),
    }),
  );
}

describe("S4: the sign-in gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("presses through to the action when there is a session", async () => {
    const signIn = vi.fn();
    const act = vi.fn(async () => {});
    await gated({ signedIn: true, signIn }, act);
    expect(act).toHaveBeenCalledTimes(1);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("opens sign-in instead, and does nothing else, when there is not", async () => {
    const signIn = vi.fn();
    const act = vi.fn(async () => {});
    await gated({ signedIn: false, signIn }, act);
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(act).not.toHaveBeenCalled();
  });

  it("offers the action either way, and says which one it is", async () => {
    expect(await asideAs("fionn")).toContain("Contact seller");
    const out = await asideAs(null);
    expect(out).toContain("Sign in to contact");
    // Offered, not hidden behind a sign-in: the save is drawn beside it too.
    expect(out).toContain("Save");
    expect(out).toContain("Share this listing");
    // The seller's box is still a labelled region, not a bare div.
    expect(out).toMatch(/<section[^>]*aria-label="Seller"/);
  });

  it("says Saved in words and a mark, and keeps its quiet box", async () => {
    const out = await asideAs("fionn", { saved: true });
    expect(out).toMatch(/aria-pressed="true"[^>]*>.*?Saved/s);
    // The toggle's own tag, not the aside's: the seller's face beside it is
    // on the inverse ground, and is not a pressed button.
    const toggle = out.match(/<button[^>]*aria-pressed="true"[^>]*>/)?.[0];
    expect(toggle).toBeDefined();
    // Its hover inks it (`not-disabled:hover:bg-inverse`); at rest it is not.
    expect(toggle).not.toMatch(/[\s"]bg-inverse[\s"]/);
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

/** The seller on that listing, rated this many times (0: not yet rated). */
const sellerOf = (ratingCount: number) => ({
  ...listingOf("active", {}).seller,
  ratingAvg: ratingCount ? 4.5 : null,
  ratingCount,
});

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
    const stood = sell(await headerAs("maeve", false));
    expect(stood).not.toContain("bg-accent");
    expect(stood).toContain("bg-card");
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
    expect(hrefs).toEqual(["/market", "/market/sell", "/?chart"]);
    // A list of nothing but links needs no underlines.
    expect(out).toContain("no-underline");
  });
});

/*
 * What follows is the second conversion's: the sell and account pages. Its S
 * lines are numbered from its own item file, so they are named for it.
 */

describe("sell/me S1: a field is the kit's, and wrong is never colour alone", () => {
  it("draws the label, the control and the message from ui/", () => {
    const out = html(
      createElement(Field, {
        label: "Title",
        hint: "optional",
        htmlFor: "listing-title",
        children: createElement(TextInput, { id: "listing-title" }),
      }),
    );
    expect(out).not.toMatch(OLD_CLASS);
    expect(out).toMatch(/<label class="[^"]*" for="listing-title"/);
    expect(out).toMatch(/<input [^>]*id="listing-title"/);
  });

  /*
   * S1, and the epic's own rule: a field that is wrong says so three times
   * over — a warm border, a warm ground, and the message underneath, which
   * carries `role="alert"` so it reaches a screen reader as well.
   */
  it("says wrong in the border, the ground and the words", () => {
    const out = html(
      createElement(Field, {
        label: "Price",
        error: "Enter a price like 450",
        htmlFor: "p",
        children: createElement(TextInput, { id: "p" }),
      }),
    );
    expect(out).toContain('data-invalid=""');
    expect(out).toMatch(/role="alert">Enter a price like 450</);
    const box = controlStyles().box();
    expect(box).toContain("group-data-invalid/field:border-warn");
    expect(box).toContain("group-data-invalid/field:bg-warn-ground");
    expect(fieldStyles().error()).toContain("text-warn");
  });

  // Two and three fields to a line, and one to a line once a field would be
  // too narrow to read what is in it. The measure is the theme's, not a page's.
  it("lays a row of fields out from the theme", () => {
    expect(sharedStyles().formRow().split(" ")).toContain("grid-cols-fields");
  });

  /*
   * The checkbox was the one control on these pages drawn in the action
   * colour. The kit answers it now, and the answer is not a hue: the tick is
   * the state. The rest of that ruling is in ui/kit.test.tsx.
   */
  it("draws the one checkbox from the kit, and not in the accent", () => {
    expect(read("pages/ProfileForm.tsx")).toMatch(/<Checkbox/);
    expect(checkboxStyles().input()).toContain("accent-inverse");
  });
});

describe("sell/me S2: the photo uploader", () => {
  const styles = sellStyles();

  it("lays the tiles out at a photograph's ratio, from the theme", () => {
    expect(styles.tiles().split(" ")).toContain("grid-cols-tiles");
    expect(styles.tile().split(" ")).toContain("aspect-4/3");
    expect(styles.add().split(" ")).toContain("aspect-4/3");
  });

  it("marks the tile you add with as an outline, not a tile", () => {
    const add = styles.add().split(" ");
    expect(add).toContain("border-dashed");
    expect(add).toContain("border-2");
    expect(add).toContain("bg-ground");
  });

  // An upload still on its way is dimmed, and says so with an attribute
  // rather than by being drawn a different colour.
  it("dims a tile whose upload has not landed", () => {
    expect(styles.image()).toContain("group-data-busy:opacity-50");
    expect(styles.tile().split(" ")).toContain("group");
  });

  it("puts the cover badge and the tools on paper over the photograph", () => {
    expect(styles.badge().split(" ")).toEqual(["absolute", "top-1", "left-1"]);
    // The kit's paper capsule, which stays paper when it cannot be pressed.
    expect(read("pages/SellPage.tsx")).toMatch(
      /variant="pill"\s+icon\s+size="sm"\s+className=\{styles\.tool\(\)\}/,
    );
    expect(styles.tool()).toContain("disabled:bg-card");
    expect(styles.tools()).toContain("absolute");
  });
});

describe("sell/me S4: the whole-page sign-in gate", () => {
  it("is one Empty, drawn by the kit", async () => {
    const out = await mePageAs(null);
    expect(out).toContain("Sign in to see your account");
    expect(out).toContain(
      "Your listings, saved gear and reviews all live here",
    );
    // The kit's Empty is a pane with a round icon well above its title.
    expect(out).toMatch(/<span class="[^"]*rounded-full[^"]*" aria-hidden/);
    expect(out).not.toMatch(OLD_CLASS);
  });

  /*
   * The one action on it is the kit's filled one, and there is exactly one.
   * It cannot be rendered here: this build has no identity provider, so the
   * gate offers no way in — the same thing the baseline shots record. So the
   * count is taken from what the page writes.
   */
  it("offers one filled action, and only where there is a way in", () => {
    const source = read("pages/MePage.tsx");
    expect(source.match(/variant="primary"/g)).toHaveLength(1);
    expect(source).toContain('auth.provider !== "none"');
    expect(source).toContain('<Button variant="primary" size="lg"');
  });

  // The sell page gates the same way, in a pane rather than an empty state:
  // it is a step in a flow, not a list with nothing in it.
  it("and the sell page's gate draws nothing of the old stylesheet", async () => {
    const out = await sellPageAs(null);
    expect(out).toContain("Sell your gear");
    expect(out).not.toMatch(OLD_CLASS);
  });
});

/**
 * A page rendered with no session.
 *
 * Two things stand in the way of asking a whole page for its markup here.
 * The session is chosen when the auth module loads, so each case loads it
 * afresh, as the header's cases above do. And `useAsync` begins every page
 * loading and only settles in an effect, which never runs without a DOM, so
 * every page would answer with its skeleton: it is settled to "nothing to
 * fetch" here, which is what a signed-out reader's is. Everything else — the
 * gate itself, the kit under it — is the real thing.
 */
async function pageAs(module: string, devUser: string | null, props: object) {
  vi.resetModules();
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
  vi.stubEnv("VITE_MARKET_DEV_USER", devUser ?? "");
  vi.doMock("./components", async () => ({
    ...(await vi.importActual<typeof import("./components")>("./components")),
    useAsync: () => ({
      data: null,
      error: null,
      loading: false,
      reload: () => {},
      setData: () => {},
    }),
  }));
  const { MarketAuthProvider } = await import("./auth");
  const Page = (await import(module)).default;
  const out = html(
    createElement(MarketAuthProvider, {
      children: createElement(Page, props),
    }),
  );
  vi.doUnmock("./components");
  return out;
}

const mePageAs = (devUser: string | null) =>
  pageAs("./pages/MePage", devUser, { tab: "listings" });
const sellPageAs = (devUser: string | null) =>
  pageAs("./pages/SellPage", devUser, {});
