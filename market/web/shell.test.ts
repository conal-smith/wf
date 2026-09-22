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
import { segmentedStyles } from "../../ui/Segmented";
import { fieldStyles } from "../../ui/Field";
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
  Stars,
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
  shellStyles,
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

  it("draws the face beside a name at the two sizes it had", () => {
    expect(faceStyles().split(" ")).toEqual(
      expect.arrayContaining(["size-control-lg", "text-lead", "bg-inverse"]),
    );
    expect(faceStyles({ large: true }).split(" ")).toEqual(
      expect.arrayContaining(["size-17.5", "text-title", "tracking-normal"]),
    );
    expect(html(createElement(Avatar, { name: "aoife" }))).toContain(">A<");
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

describe("the seller's tabs", () => {
  // The track clips what overflows it, so the ring goes inside the tab.
  it("draws the ring inside the tab, where the track cannot clip it", () => {
    const tab = sellerStyles().tab().split(" ");
    expect(tab).toContain("not-disabled:focus-visible:-outline-offset-2");
    expect(tab).not.toContain("not-disabled:focus-visible:outline-offset-2");
    expect(tab).toContain("not-disabled:focus-visible:outline-3");
    expect(sellerStyles().tabs().split(" ")).toContain("overflow-x-auto");
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
    expect(pressed).toContain("aria-pressed:not-focus-visible:outline-accent");
    // The opacity is there too, and on its own it would not be a state.
    expect(pressed).toContain("aria-pressed:opacity-100");
    // The outline gives way to the focus ring, never sits over it.
    for (const c of pressed.filter((c) => c.includes("outline")))
      expect(c, c).toMatch(/^aria-pressed:not-focus-visible:/);
  });
});

describe("S3: the accent is for what was earned, the line for what was not", () => {
  it("colours the marks, the picker and the bars the one pair of ways", () => {
    const rating = ratingStyles();
    expect(rating.marks().split(" ")).toContain("text-accent");
    expect(rating.empty().split(" ")).toContain("text-line-strong");
    expect(ratingStyles({ lit: true }).star().split(" ")).toContain(
      "text-accent",
    );
    expect(rating.star().split(" ")).toContain("text-line-strong");
    // What the picker's own button comes to once the star's colour is laid
    // over the kit's: the mark's colour, and no box under the pointer.
    for (const lit of [true, false]) {
      const star = buttonStyles({
        icon: true,
        size: "sm",
        className: ratingStyles({ lit }).star(),
      }).split(" ");
      expect(star).toContain(lit ? "text-accent" : "text-line-strong");
      expect(star).not.toContain("text-quiet");
      expect(star).toContain("not-disabled:hover:bg-transparent");
      expect(star).not.toContain("not-disabled:hover:bg-sunken");
    }
    expect(sellerStyles().fill().split(" ")).toContain("bg-accent");
    expect(sellerStyles().bar().split(" ")).toContain("bg-sunken");
  });

  /*
   * A filled star is a mark, not an action, so it does not spend the view's
   * one filled control: nothing either page draws takes the accent as a fill
   * but the histogram's bar, and the one accent-filled control on the listing
   * is the kit's primary, which the page uses once.
   */
  it("leaves the one accent fill to the one action", () => {
    expect(classesOf(listingStyles)).not.toContain("bg-accent");
    expect(classesOf(ratingStyles)).not.toContain("bg-accent");
    expect(classesOf(sellerStyles).filter((c) => c === "bg-accent")).toEqual([
      "bg-accent",
    ]);
    expect(buttonStyles({ variant: "primary" })).toContain("bg-accent");
    // Saved is a toggle that says so in its own words, not another fill.
    expect(buttonStyles({ variant: "pill", pressed: "worded" })).not.toContain(
      "bg-accent",
    );
    expect(buttonStyles({ variant: "pill", pressed: "worded" })).not.toContain(
      "bg-inverse",
    );
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
    expect(await asideAs("fionn")).toContain("Show contact details");
    const out = await asideAs(null);
    expect(out).toContain("Sign in to contact seller");
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
    expect(toggle).not.toContain("bg-inverse");
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

  it("puts the cover badge and the tools on glass over the photograph", () => {
    expect(styles.badge().split(" ")).toEqual(["absolute", "top-1", "left-1"]);
    expect(styles.tool()).toContain("bg-glass");
    // Glass is a choice a reader can decline, here as everywhere else.
    expect(styles.tool()).toContain("reduced-transparency:bg-solid");
    expect(styles.tools()).toContain("absolute");
  });
});

describe("sell/me S3: the account's tabs", () => {
  it("is the kit's Segmented, worn by links that are real URLs", () => {
    const source = read("pages/MePage.tsx");
    expect(source).toContain("segmentedStyles().item(");
    expect(source).toMatch(/<Link[\s\S]*?role="tab"/);
  });

  it("scrolls sideways rather than wrapping onto a second line", () => {
    const tabs = meStyles().tabs().split(" ");
    expect(tabs).toContain("overflow-x-auto");
    expect(tabs).toContain("scrollbar-none");
  });

  // A scrolling track clips past its padding, so the ring is drawn inside.
  it("draws the ring inside a tab, where the scrolling track cannot cut it", () => {
    const tab = segmentedStyles()
      .item({ className: meStyles().tab() })
      .split(" ");
    expect(tab).toContain("not-disabled:focus-visible:-outline-offset-2");
    expect(tab).not.toContain("not-disabled:focus-visible:outline-offset-2");
    expect(tab).toContain("not-disabled:focus-visible:outline-3");
    expect(tab).toContain("not-disabled:focus-visible:outline-focus");
  });

  /*
   * The number of saved listings, inside the tab that holds them: the plain
   * number market.css drew, and not the kit's Count, which is a filled badge
   * for what has not been read yet and would be a new mark on this page.
   */
  it("keeps the count inside the tab, as a number", () => {
    const count = meStyles().count().split(" ");
    expect(count).toContain("text-caption");
    // At the tab's own leading and weight, as the design bundle's segmented drew it:
    // a caption-sized number in the muted ink, and nothing else about it.
    expect(count).toContain("leading-tight");
    expect(count).not.toContain("font-normal");
    expect(meStyles().tab().split(" ")).toContain("leading-tight");
    expect(read("pages/MePage.tsx")).toContain(
      "<small className={styles.count",
    );
  });

  it("is the same inset ring the seller page's own tabs draw", () => {
    for (const tab of [meStyles().tab(), sellerStyles().tab()])
      expect(tab.split(" ")).toContain(
        "not-disabled:focus-visible:-outline-offset-2",
      );
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
