import { beforeAll, describe, expect, it } from "vitest";
import { compileTheme, declared, holds, selector } from "./theme.testkit";
import {
  DISABLED,
  HOVER,
  NO_RING,
  RING,
  RING_WITHIN,
  THEME_NAMES,
  tv,
} from "./tv";

let build: (names: string[]) => string;
beforeAll(async () => {
  build = await compileTheme();
});

/** Compiled CSS on one line: a declaration keeps the line breaks it was written with. */
const flat = (css: string) => css.replace(/\s+/g, " ");

describe("ui/tv.ts: the merge knows the theme's names", () => {
  // The merge reads an unknown `text-…` as a colour. If the theme gains a type
  // step this list lacks, `text-<step> text-ink` silently loses the step.
  it.each(Object.keys(THEME_NAMES) as (keyof typeof THEME_NAMES)[])(
    "lists every --%s-* the theme declares, and no other",
    (family) => {
      expect([...THEME_NAMES[family]].sort()).toEqual(declared(family).sort());
    },
  );

  it("keeps a type step beside a text colour", () => {
    expect(tv({ base: "text-label text-ink" })()).toBe("text-label text-ink");
  });

  it.each([
    ["text-label text-prose", "text-prose"],
    ["rounded-control rounded-full", "rounded-full"],
    ["shadow-control shadow-none", "shadow-none"],
    ["h-control-md h-auto", "h-auto"],
    ["min-h-touch min-h-0", "min-h-0"],
    ["max-w-dialog max-w-dialog-wide", "max-w-dialog-wide"],
    ["backdrop-blur-glass backdrop-blur-scrim", "backdrop-blur-scrim"],
    ["animate-pulse animate-none", "animate-none"],
    ["duration-base duration-fast", "duration-fast"],
    ["z-panel z-dialog", "z-dialog"],
    ["bg-card bg-accent", "bg-accent"],
  ])("%s merges to %s", (written, merged) => {
    expect(tv({ base: written })()).toBe(merged);
  });

  it("lets a caller's className have the last word", () => {
    const pill = tv({ base: "rounded-full px-3" });
    expect(pill({ className: "rounded-control" })).toBe("px-3 rounded-control");
  });
});

describe("ui/tv.ts: the shared states", () => {
  it.each([
    ["RING", RING],
    ["RING_WITHIN", RING_WITHIN],
    ["NO_RING", NO_RING],
    ["HOVER", HOVER],
    ["DISABLED", DISABLED],
  ])("every class in %s resolves from the theme", (_, classes) => {
    const names = classes.split(" ");
    const css = build(names);
    for (const name of names) expect(holds(css, name), name).toBe(true);
  });

  // `.text-ink` is how `.text-ink-muted` begins: a name the theme has lost
  // must not pass for one that merely starts the same way.
  it("a name is not held by a longer one that begins with it", () => {
    const css = build(["text-ink-muted", "border-card/70"]);
    expect(holds(css, "text-ink-muted")).toBe(true);
    expect(holds(css, "border-card/70")).toBe(true);
    expect(holds(css, "text-ink-mut")).toBe(false);
    expect(holds(css, "border-card")).toBe(false);
  });

  // S4: one ring, 3px of focus, 2px clear.
  it.each([
    ["on the control", RING, "focus-visible"],
    ["on the box around a field", RING_WITHIN, "focus-within"],
  ])("the ring %s is 3px of focus, 2px clear", (_, ring, state) => {
    const css = build(ring.split(" "));
    const rules = ring
      .split(" ")
      .map((name) => {
        const start = css.indexOf(`\n${selector(name)}`);
        return css.slice(start, css.indexOf("\n}", start));
      })
      .join("\n");
    expect(rules).toContain("outline-width: 3px;");
    expect(rules).toContain("outline-offset: 2px;");
    expect(rules).toContain("outline-color: var(--color-focus);");
    for (const name of ring.split(" ")) expect(name).toContain(`${state}:`);
  });

  // The site's reset styles `button:enabled:hover`: an element and two
  // pseudo-classes. A class and one loses to that; a class and two wins. Its
  // `button:focus-visible` and `button:disabled` are an element and one, which
  // any class and pseudo-class outranks.
  it("outranks the site reset's button states", () => {
    const css = build([...RING.split(" "), HOVER, ...DISABLED.split(" ")]);
    expect(css).toContain(
      `${selector("not-disabled:focus-visible:outline-3")}:not(:disabled):focus-visible {`,
    );
    expect(css).toContain(
      `${selector("not-disabled:hover:bg-sunken")}:not(:disabled):hover {`,
    );
    expect(css).toContain(`${selector("disabled:opacity-100")}:disabled {`);
  });
});

// The kit needed three families the theme did not yet state. They are cleared
// and restated like the rest, so a stock name comes to nothing here too.
describe("ui/theme.css: blur, measures and animation", () => {
  it.each(["backdrop-blur-sm", "blur-md", "max-w-md", "animate-spin"])(
    "%s produces no CSS",
    (name) => {
      expect(build([name])).not.toContain(selector(name));
    },
  );

  it.each([
    ["backdrop-blur-glass", "--blur-glass", "28px"],
    ["backdrop-blur-scrim", "--blur-scrim", "5px"],
    ["max-w-dialog", "--container-dialog", "420px"],
    ["max-w-dialog-wide", "--container-dialog-wide", "640px"],
    ["max-w-reading", "--container-reading", "44ch"],
    ["max-w-measure", "--container-measure", "68ch"],
    ["max-w-page", "--container-page", "1200px"],
    ["max-w-form", "--container-form", "760px"],
    [
      "grid-cols-shell",
      "--grid-template-columns-shell",
      "236px minmax(0, 1fr)",
    ],
    [
      "grid-cols-cards",
      "--grid-template-columns-cards",
      "repeat(auto-fill, minmax(240px, 1fr))",
    ],
    [
      "grid-cols-detail",
      "--grid-template-columns-detail",
      "minmax(0, 3fr) minmax(320px, 2fr)",
    ],
    [
      "grid-cols-specs",
      "--grid-template-columns-specs",
      "repeat(auto-fill, minmax(150px, 1fr))",
    ],
    [
      "grid-cols-meter",
      "--grid-template-columns-meter",
      "auto minmax(0, 1fr) auto",
    ],
    [
      "grid-cols-profile",
      "--grid-template-columns-profile",
      "minmax(0, 3fr) minmax(260px, 2fr)",
    ],
  ])("%s reads %s, which is %s", (name, variable, value) => {
    const css = build([name]);
    expect(css).toContain(selector(name));
    expect(css).toContain(`${variable}: ${value};`);
  });

  // 900px, in rem: a media query reads the browser's 16px, not the root's 14.
  it("the rail's two columns start at 900px and stop below it", () => {
    const css = build(["rail:grid-cols-shell", "max-rail:hidden"]);
    expect(css).toMatch(
      /@media \(width >= 56\.25rem\) \{\s*\.rail\\:grid-cols-shell \{/,
    );
    expect(css).toMatch(
      /@media \(width < 56\.25rem\) \{\s*\.max-rail\\:hidden \{/,
    );
  });

  // 720px, the marketplace's second breakpoint, in the same unit as the rail's.
  it("a row makes room for its words at 720px and stops below it", () => {
    const css = build(["wide:inline", "max-wide:hidden"]);
    expect(css).toMatch(/@media \(width >= 45rem\) \{\s*\.wide\\:inline \{/);
    expect(css).toMatch(/@media \(width < 45rem\) \{\s*\.max-wide\\:hidden \{/);
  });

  // The design system's three, restated: the stock `tight` was 1.25, and a
  // card's title takes the prose size at 1.3. Every other stock name is gone.
  it.each([
    ["leading-tight", "--leading-tight", "1.3"],
    ["leading-normal", "--leading-normal", "1.5"],
    ["leading-loose", "--leading-loose", "1.75"],
  ])("%s reads %s, which is %s", (name, variable, value) => {
    const css = build([name]);
    expect(css).toContain(selector(name));
    expect(css).toContain(`${variable}: ${value};`);
  });

  // `leading-none` and `leading-<step>` are Tailwind's own arithmetic and stay;
  // the named ones come from the theme, which now holds three.
  it.each(["leading-snug", "leading-relaxed"])("%s produces no CSS", (name) => {
    expect(build([name])).not.toContain(selector(name));
  });

  it("hides a sideways row's scrollbar in both spellings", () => {
    const css = flat(build(["scrollbar-none"]));
    expect(css).toContain(".scrollbar-none {");
    expect(css).toContain("scrollbar-width: none;");
    expect(css).toContain("&::-webkit-scrollbar { display: none; }");
  });

  /*
   * A notch or a home bar, which `env()` states and no class can. Each of
   * these is the spacing step it names or the device's own inset, whichever
   * is the larger, so it is the plain utility on every screen but the one
   * that needs more. market.css wrote the same three maxima before the
   * marketplace was converted.
   */
  it.each([
    ["px-safe-6", ["padding-left", "padding-right"], 6, ["left", "right"]],
    ["pt-safe-3", ["padding-top"], 3, ["top"]],
    ["pb-safe-6", ["padding-bottom"], 6, ["bottom"]],
  ])(
    "%s is the larger of the step and the device's inset",
    (name, sides, step, edges) => {
      const css = flat(build([name]));
      expect(css).toContain(selector(name));
      sides.forEach((side, i) => {
        expect(css).toContain(
          `${side}: max( calc(var(--spacing) * ${step}), env(safe-area-inset-${edges[i]}) );`,
        );
      });
    },
  );

  // A step the scale cannot hold is not an inset at all: it comes to nothing.
  it.each(["px-safe-half", "pt-safe-x"])("%s produces no CSS", (name) => {
    expect(build([name])).not.toContain(selector(name));
  });

  it("a placeholder pulses and a dialog arrives, and both can be declined", () => {
    const css = build([
      "animate-pulse",
      "animate-dialog-in",
      "motion-reduce:animate-none",
    ]);
    expect(css).toContain("@keyframes pulse");
    expect(css).toContain("@keyframes dialog-in");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.motion-reduce\\:animate-none \{\s*animation: none;/,
    );
  });

  it("glass goes solid for a reader who asked for less transparency", () => {
    const css = build(["reduced-transparency:bg-solid"]);
    expect(css).toMatch(
      /@media \(prefers-reduced-transparency: reduce\) \{\s*\.reduced-transparency\\:bg-solid \{/,
    );
  });
});
