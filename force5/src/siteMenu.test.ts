import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { buttonStyles } from "../../ui/Button";
import { surfaceStyles } from "../../ui/Surface";
import { compileTheme, holds } from "../../ui/theme.testkit";
import { SiteMenu, siteMenuStyles } from "./SiteMenu";

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

describe("the site menu's recipe", () => {
  let build: (names: string[]) => string;
  beforeAll(async () => {
    build = await compileTheme();
  });

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
   * hit band on top. On a page's masthead it is the square ink box laid over
   * the map; on the chart it stands inside the head's own box, and is the
   * kit's quiet button, so there is no box in a box.
   */
  it("draws the trigger as exactly the kit's button: bare on the chart, the square instrument on a page", () => {
    const classOf = (markup: string) =>
      markup
        .match(/<button[^>]*\bclass="([^"]+)"/)?.[1]
        .split(" ")
        .sort();
    const cases = [
      [{ current: "map", size: "md", ground: "map" }, "md", "quiet"],
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
      const box = ["rounded-none", "border-ink", "bg-card"];
      for (const name of box)
        if (variant === "raised")
          expect(drawn, `${props.ground} ${name}`).toContain(name);
        else expect(drawn, `${props.ground} ${name}`).not.toContain(name);
    }
  });

  /*
   * The panel is a Surface with the menu's placement on it: the chart's
   * double-ruled paper box, solid on either ground, dropping in and holding
   * still for a reader who asks for less motion.
   */
  it("composes the panel from the Surface: the chart's box, solid, declinable motion", () => {
    expect(SOURCE).toContain("surfaceStyles({ className: styles.panel() })");
    for (const ground of ["map", "content"] as const) {
      const classes = surfaceStyles({
        className: siteMenuStyles({ ground }).panel(),
      }).split(" ");
      for (const name of [
        "animate-menu-in",
        "motion-reduce:animate-none",
        "bg-card",
        "paper-grain",
        "inset-shadow-frame",
        "absolute",
        "top-full",
        "mt-2",
        "p-2",
      ])
        expect(classes, `${ground} ${name}`).toContain(name);
      expect(classes, ground).not.toContain("p-5");
      expect(classes.join(" "), ground).not.toMatch(/glass|backdrop/);
    }
  });

  it("names the sections in the display face, on hairlines, with no icons", () => {
    const row = siteMenuStyles().row().split(" ");
    for (const name of ["font-display", "border-b", "border-line", "h-touch"])
      expect(row).toContain(name);
    expect(SOURCE).not.toMatch(/from "lucide-react";[\s\S]*Store/);
  });

  it("is signed by the Almanac: the puffin and one line, under the sections", () => {
    expect(SOURCE).toContain("<Puffin size={44} />");
    expect(SOURCE).toContain(
      "The Almanac reads every forecast so you don’t have to.",
    );
    expect(siteMenuStyles().almanac()).toContain("italic");
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
