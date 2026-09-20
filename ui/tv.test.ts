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
    [
      "grid-cols-shell",
      "--grid-template-columns-shell",
      "236px minmax(0, 1fr)",
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
