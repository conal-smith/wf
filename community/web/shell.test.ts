import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { compileTheme, holds } from "../../ui/theme.testkit";
import { SEED_CATEGORIES, SEED_CHANNELS } from "../api/seed";
import type { Channel } from "../shared/types";
import { accentNewThread, shellStyles } from "./CommunityApp";
import { headerStyles } from "./Header";
import { railGroups, type ChannelsState } from "./hooks";
import { Rail, railCurrent, railStyles } from "./Rail";
import { matchRoute } from "./router";

/**
 * The shell, rendered to markup: there is no DOM under these tests, so what is
 * asked is what a reader is handed (the landmarks, the names, the states) and
 * what the class names come to. How it lays out at a width is e2e's question.
 */

const WEB = dirname(fileURLToPath(import.meta.url));
const html = (element: ReactElement) => renderToStaticMarkup(element);

const RECIPES = { headerStyles, railStyles, shellStyles };

type Classes = string | readonly Classes[] | { [key: string]: Classes } | null;

/** Every class name written anywhere in a recipe, whatever its nesting. */
function written(value: Classes | undefined): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap((v) => written(v));
  return Object.values(value).flatMap((v) => written(v as Classes));
}

const sources = readdirSync(WEB, { recursive: true, encoding: "utf8" });
const code = sources.filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
const read = (file: string) => readFileSync(resolve(WEB, file), "utf8");

describe("S8: Tailwind and ui/ only", () => {
  let build: (names: string[]) => string;
  beforeAll(async () => {
    build = await compileTheme();
  });

  // A class that names a value the theme does not hold is not an error
  // anywhere: it is a rail quietly missing its fill. So every name is asked.
  it.each(Object.entries(RECIPES))(
    "every class in %s resolves from the theme",
    (_, recipe) => {
      const { slots, variants } = recipe as unknown as {
        slots: Classes;
        variants: Classes;
      };
      const names = [...written(slots), ...written(variants)];
      expect(names.length).toBeGreaterThan(0);
      const css = build(names);
      for (const name of names) {
        // `group` is a marker for a variant to find, not a rule.
        if (name === "group") continue;
        expect(holds(css, name), name).toBe(true);
      }
    },
  );

  it("checks every recipe a file here declares", () => {
    const declared = code.flatMap((file) =>
      [...read(file).matchAll(/export const (\w+Styles) = tv\(/g)].map(
        (m) => m[1],
      ),
    );
    expect(declared.sort()).toEqual(Object.keys(RECIPES).sort());
  });

  // A class written straight into markup would slip past the check above.
  it("writes no class outside a recipe", () => {
    for (const file of code)
      expect(read(file), file).not.toMatch(/className="/);
  });

  it("holds no stylesheet, and imports none, nor anything from design/", () => {
    expect(sources.filter((f) => /\.(css|scss|less)$/.test(f))).toEqual([]);
    for (const file of code) {
      expect(read(file), file).not.toMatch(/import\s+["'][^"']+\.css["']/);
      expect(read(file), file).not.toMatch(/from\s+["'][^"']*design\//);
    }
  });
});

describe("S4: the shell's measures", () => {
  it("is the 1200 page measure and two columns from the rail breakpoint up", () => {
    const styles = shellStyles({ railIsPage: true });
    expect(styles.page()).toContain("max-w-page");
    expect(styles.shell()).toContain("rail:grid-cols-shell");
    expect(styles.shell()).toContain("grid-cols-1");
  });

  it("below it the channels are the page at /community, and hidden elsewhere", () => {
    expect(shellStyles({ railIsPage: true }).rail() ?? "").toBe("");
    expect(shellStyles({ railIsPage: false }).rail()).toContain(
      "max-rail:hidden",
    );
    // The way back to them is only drawn where they are not beside the page.
    expect(shellStyles().back()).toContain("rail:hidden");
  });
});

describe("S5: one filled action per view", () => {
  it.each([
    ["/community", true],
    ["/community/following", true],
    ["/community/mentions", true],
    ["/community/notifications", true],
    ["/community/c/wings", true],
    ["/community/u/aoife", true],
    // Reply is the thread's filled action, and the way back is not-found's.
    ["/community/t/abc123/5m-or-6m", false],
    ["/community/nowhere", false],
  ])("%s: New thread is primary = %s", (pathname, primary) => {
    expect(accentNewThread(matchRoute(pathname))).toBe(primary);
  });
});

/**
 * The header and the whole shell read the session, which is chosen from the
 * environment when the auth module loads: each case sets it and loads afresh.
 */
async function shellAs(devUser: string | null, pathname: string) {
  vi.resetModules();
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
  vi.stubEnv("VITE_MARKET_DEV_USER", devUser ?? "");
  vi.stubGlobal("location", { pathname, search: "" });
  const { default: CommunityApp } = await import("./CommunityApp");
  return html(createElement(CommunityApp));
}

async function headerAs(
  devUser: string | null,
  props: { accentNew: boolean; newThread: string; unread: number },
) {
  vi.resetModules();
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
  vi.stubEnv("VITE_MARKET_DEV_USER", devUser ?? "");
  const { SiteAuthProvider } = await import("../../shared/web/auth");
  const { Header } = await import("./Header");
  return html(
    createElement(SiteAuthProvider, {
      home: "/community",
      children: createElement(Header, props),
    }),
  );
}

describe("S5: the header", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const quiet = { accentNew: true, newThread: "/community?new=1", unread: 0 };

  it("is the marketplace's bar with Community in the chip", async () => {
    const out = await headerAs(null, quiet);
    expect(out).toContain('aria-label="Site menu"');
    expect(out).toMatch(
      /<a href="\/community"[^>]*aria-label="wingfoil\.ie Community, home"/,
    );
    expect(out).toMatch(/<span class="[^"]*uppercase[^"]*">Community<\/span>/);
    expect(out).toMatch(/<nav class="[^"]*" aria-label="Community">/);
  });

  it("signed out is Sign in, and nothing a reader cannot use", async () => {
    const out = await headerAs(null, quiet);
    expect(out).toContain("Sign in");
    expect(out).not.toContain("New thread");
    expect(out).not.toContain("Notifications");
    // No filled control: signing in is offered, not pushed.
    expect(out).not.toContain("bg-accent");
  });

  it("signed in is New thread, the bell and the member", async () => {
    const out = await headerAs("aoife", { ...quiet, unread: 4 });
    expect(out).not.toContain("Sign in");
    expect(out).toMatch(/<a href="\/community\?new=1"[^>]*>.*New thread/);
    expect(out).toMatch(
      /<a href="\/community\/notifications"[^>]*aria-label="Notifications, 4 unread"/,
    );
    // The number is for the eye; the label has already said it.
    expect(out).toMatch(/<span class="[^"]*" aria-hidden="true">4<\/span>/);
    expect(out).toContain(">aoife</span>");
  });

  it("draws no badge, and says no number, when nothing is unread", async () => {
    const out = await headerAs("aoife", quiet);
    expect(out).toContain('aria-label="Notifications"');
    expect(out).not.toContain("unread");
  });

  it("New thread is filled only when the view has no primary of its own", async () => {
    const button = (out: string) =>
      out.match(/<a href="\/community\?new=1" class="([^"]*)"/)![1];
    const filled = button(await headerAs("aoife", quiet));
    expect(filled).toContain("bg-accent");
    const stood = button(
      await headerAs("aoife", { ...quiet, accentNew: false }),
    );
    expect(stood).not.toContain("bg-accent");
    expect(stood).toContain("bg-card");
    // On a phone the bar does not carry it at all.
    expect(filled).toContain("max-rail:hidden");
  });
});

const ready = (channels: Channel[]): ChannelsState => ({
  status: "ready",
  groups: railGroups(SEED_CATEGORIES, channels),
});

const rail = (state: ChannelsState, pathname: string) =>
  html(
    createElement(Rail, {
      state,
      reload: () => {},
      current: railCurrent(matchRoute(pathname)),
    }),
  );

/** Every row of the rail, as its href, its attributes and what it says. */
const rows = (out: string) =>
  [...out.matchAll(/<a href="([^"]*)"([^>]*)>(.*?)<\/a>/g)].map(
    ([, href, attributes, inner]) => ({ href, attributes, inner }),
  );

describe("S6: the rail", () => {
  it("is a named landmark: search, the three feeds, then the site's channels", () => {
    const out = rail(ready(SEED_CHANNELS), "/community");
    expect(out).toMatch(/^<nav class="[^"]*" aria-label="Channels">/);
    expect(out).toContain('<form role="search">');
    expect(out).toMatch(
      /<input[^>]*aria-label="Search the community"[^>]*name="q"/,
    );
    expect(rows(out).map((row) => row.href)).toEqual([
      "/community",
      "/community/following",
      "/community/mentions",
      ...SEED_CHANNELS.map((c) => `/community/c/${c.slug}`),
    ]);
    expect(SEED_CHANNELS).toHaveLength(10);
  });

  it("heads each category with a button that says it is open", () => {
    const out = rail(ready(SEED_CHANNELS), "/community");
    const heads = [
      ...out.matchAll(
        /<h2[^>]*><button type="button"[^>]*aria-expanded="true" aria-controls="([^"]+)"[^>]*>.*?<\/svg>([^<]*)<\/button><\/h2>/g,
      ),
    ];
    expect(heads.map((m) => m[2])).toEqual(SEED_CATEGORIES.map((c) => c.name));
    expect(heads).toHaveLength(4);
    // What each controls is the list under it.
    for (const [, id] of heads) expect(out).toContain(`<ul id="${id}"`);
  });

  it.each([
    ["/community", "/community"],
    ["/community/following", "/community/following"],
    ["/community/mentions", "/community/mentions"],
    ["/community/c/wings", "/community/c/wings"],
  ])(
    "at %s exactly one row is aria-current, and it is %s",
    (pathname, href) => {
      const current = rows(rail(ready(SEED_CHANNELS), pathname)).filter((row) =>
        row.attributes.includes('aria-current="page"'),
      );
      expect(current.map((row) => row.href)).toEqual([href]);
      // Raised and heavier as well as said: never by colour alone.
      expect(current[0].attributes).toContain("shadow-control");
      expect(current[0].attributes).toContain("font-semibold");
    },
  );

  it("lights no row on a thread, a member or a page that does not exist", () => {
    for (const pathname of [
      "/community/t/abc123",
      "/community/u/aoife",
      "/community/nowhere",
    ])
      expect(rail(ready(SEED_CHANNELS), pathname)).not.toContain(
        "aria-current",
      );
  });

  const withUnread = (counts: Record<string, number>) =>
    SEED_CHANNELS.map((c) => ({ ...c, unread: counts[c.slug] ?? 0 }));

  it("says unread in weight and a count a screen reader hears", () => {
    const out = rail(ready(withUnread({ wings: 5, foils: 3 })), "/community");
    const row = (slug: string) =>
      rows(out).find((r) => r.href === `/community/c/${slug}`)!;
    expect(row("wings").attributes).toContain("font-semibold");
    expect(row("wings").inner).toMatch(
      />5<span class="sr-only"> unread<\/span>/,
    );
    expect(row("foils").inner).toMatch(
      />3<span class="sr-only"> unread<\/span>/,
    );
    // Past four the badge is filled; up to four it is quiet. Both are numbers.
    expect(row("wings").inner).toContain("bg-inverse");
    expect(row("foils").inner).toContain("bg-sunken");
    expect(row("boards").attributes).not.toContain("font-semibold");
    expect(row("boards").inner).not.toContain("unread");
  });

  it("shows no count on the channel that is open", () => {
    const out = rail(ready(withUnread({ wings: 5 })), "/community/c/wings");
    const wings = rows(out).find((r) => r.href === "/community/c/wings")!;
    expect(wings.inner).not.toContain("unread");
  });

  it("marks a staff-only channel with a lock that has words too", () => {
    const out = rail(ready(SEED_CHANNELS), "/community");
    const staffOnly = SEED_CHANNELS.filter((c) => c.postPolicy === "staff");
    expect(staffOnly.map((c) => c.slug)).toEqual(["announcements"]);
    for (const row of rows(out)) {
      const locked = row.href === "/community/c/announcements";
      expect(row.inner.includes("staff posts only"), row.href).toBe(locked);
      expect(row.inner.includes("lucide-lock"), row.href).toBe(locked);
    }
  });

  it("says it is loading, and keeps the feeds usable meanwhile", () => {
    const out = rail({ status: "loading" }, "/community");
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("Loading the channels…");
    expect(rows(out).map((row) => row.href)).toEqual([
      "/community",
      "/community/following",
      "/community/mentions",
    ]);
  });

  it("names what failed and offers to try again", () => {
    const out = rail(
      { status: "error", message: "The community could not be reached." },
      "/community",
    );
    expect(out).toContain('role="alert"');
    expect(out).toContain("The community could not be reached.");
    expect(out).toMatch(/<button type="button"[^>]*>Try again<\/button>/);
  });
});

describe("S3 and S4: the shell around a route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is a header, the rail and one main column, signed out", async () => {
    const out = await shellAs(null, "/community");
    expect(out.match(/<header/g)).toHaveLength(1);
    expect(out.match(/<nav [^>]*aria-label="Channels"/g)).toHaveLength(1);
    expect(out.match(/<main id="community-main"/g)).toHaveLength(1);
    expect(out).toContain("Sign in");
    // At /community the channels are the page on a phone: nothing hides them,
    // and there is nowhere to go back to.
    expect(out).not.toMatch(
      /<nav class="[^"]*max-rail:hidden[^"]*" aria-label="Channels"/,
    );
    expect(out).not.toContain(">Channels</span>");
  });

  it("signed in, on a channel: the rail stands down on a phone and New thread lands in the channel", async () => {
    const out = await shellAs("aoife", "/community/c/wings");
    expect(out).toMatch(
      /<nav class="[^"]*max-rail:hidden[^"]*" aria-label="Channels"/,
    );
    expect(out).toMatch(
      /<a href="\/community"[^>]*class="[^"]*rail:hidden[^"]*"[^>]*>.*?<span>Channels<\/span>/,
    );
    expect(out).toContain('href="/community/c/wings?new=1"');
  });

  it("an unknown URL is the not-found Empty, with the view's one filled action", async () => {
    const out = await shellAs("aoife", "/community/nowhere");
    expect(out).toContain("That page does not exist");
    const filled = [
      ...out.matchAll(/<a href="([^"]*)"[^>]*class="[^"]*bg-accent[^"]*"/g),
    ];
    expect(filled.map((m) => m[1])).toEqual(["/community"]);
    expect(out).toContain("Back to the community");
  });

  it("a known URL holds an empty main column for its page", async () => {
    const out = await shellAs(null, "/community");
    expect(out).toMatch(/<main id="community-main" class="[^"]*"><\/main>/);
  });
});
