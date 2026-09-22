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

describe("the two grounds", () => {
  it("on the map and in the community, a raised pill over a glass panel", () => {
    const html_ = html({ current: "map" });
    const trigger = buttonStyles({ variant: "raised", size: "md", icon: true });
    for (const name of ["bg-card/40", "border-card/70", "rounded-full"])
      expect(trigger.split(" ")).toContain(name);
    expect(trigger).not.toContain("shadow-control");
    expect(html_).toContain("bg-card/40");
    // The panel is only drawn open; the recipe says what it will be.
    const panel = siteMenuStyles({ ground: "map" }).panel();
    expect(panel).not.toContain("bg-solid");
    expect(panel).not.toContain("backdrop-filter-none");
  });

  it("on the marketplace's card, the card pill and a solid, unblurred panel", () => {
    const markup = html({ current: "market", size: "sm", ground: "content" });
    expect(markup).toContain("shadow-control");
    expect(markup).toContain("bg-card ");
    expect(markup).not.toContain("bg-card/40");
    const panel = siteMenuStyles({ ground: "content" }).panel().split(" ");
    expect(panel).toContain("bg-solid");
    expect(panel).toContain("backdrop-filter-none");
  });

  /*
   * The trigger is the kit's own button, not one that looks like it: every
   * class of the kit's variant, its hover included, and only the menu's hit
   * band on top. On the marketplace that hover is the one its header
   * neighbours have (ruled a colour-only alignment in review, 2026-09-22).
   */
  it("draws the trigger as exactly the kit's button on each ground, hover and ring included", () => {
    const classOf = (markup: string) =>
      markup
        .match(/<button[^>]*\bclass="([^"]+)"/)?.[1]
        .split(" ")
        .sort();
    const cases = [
      [{ current: "map", size: "md", ground: "map" }, "raised", "md"],
      [{ current: "market", size: "sm", ground: "content" }, "pill", "sm"],
    ] as const;
    for (const [props, variant, size] of cases) {
      const kit = buttonStyles({
        variant,
        size,
        icon: true,
        className: siteMenuStyles({ ground: props.ground }).trigger(),
      });
      expect(classOf(html(props)), variant).toEqual(kit.split(" ").sort());
    }
    const onCard = classOf(
      html({ current: "market", size: "sm", ground: "content" }),
    );
    expect(onCard).toContain("not-disabled:hover:bg-sunken");
    expect(onCard).toContain("border-line");
    expect(onCard).toContain("not-disabled:focus-visible:outline-focus");
    const onGlass = classOf(html({ current: "map" }));
    expect(onGlass).toContain("not-disabled:hover:bg-card/55");
    expect(onGlass).toContain("not-disabled:focus-visible:outline-focus");
  });

  /*
   * The panel is a Surface with the menu's placement on it. Drawn only when
   * open, so the composition the component writes is asked for here: glass
   * that goes solid for a reader who asks, drops in and holds still for one
   * who asks that, and on the card is solid with no blur left at all.
   */
  it("composes the panel from the Surface: glass on the map, solid on the card, both declinable", () => {
    const panel = (ground: "map" | "content") =>
      surfaceStyles({ className: siteMenuStyles({ ground }).panel() }).split(
        " ",
      );
    for (const ground of ["map", "content"] as const) {
      const classes = panel(ground);
      for (const name of [
        "animate-menu-in",
        "motion-reduce:animate-none",
        "reduced-transparency:bg-solid",
        "reduced-transparency:backdrop-filter-none",
        "absolute",
        "top-full",
        "mt-2",
        "p-1",
      ])
        expect(classes, `${ground} ${name}`).toContain(name);
      expect(classes, ground).not.toContain("p-5");
    }
    expect(panel("map")).toContain("bg-glass");
    expect(panel("map")).toContain("backdrop-blur-glass");
    expect(panel("content")).toContain("bg-solid");
    expect(panel("content")).not.toContain("bg-glass");
    expect(SOURCE).toContain("surfaceStyles({ className: styles.panel() })");
  });

  /*
   * The merge keeps the Surface's blur beside `backdrop-filter-none` (they are
   * different properties to it), so on the card it is the stylesheet's order
   * that takes the blur off: at one class each, the later rule wins. Asked of
   * the compiled theme, so a reorder shows up here and not on a phone.
   */
  it("takes the blur off the card's panel by the order the theme compiles in", async () => {
    const classes = surfaceStyles({
      className: siteMenuStyles({ ground: "content" }).panel(),
    }).split(" ");
    const css = (await compileTheme())(classes);
    const at = (name: string) => {
      const index = css.search(
        new RegExp(`\\.${name.replace(/[^\w-]/g, "\\\\$&")} \\{`),
      );
      expect(index, name).toBeGreaterThan(-1);
      return index;
    };
    const none = at("backdrop-filter-none");
    expect(none).toBeGreaterThan(at("backdrop-blur-glass"));
    expect(none).toBeGreaterThan(at("backdrop-saturate-145"));
  });

  it("raises the section you are in, and keeps it raised under the pointer on glass only", () => {
    const here = siteMenuStyles({ ground: "map", current: true })
      .row()
      .split(" ");
    for (const name of ["bg-card/40", "text-ink", "shadow-control"])
      expect(here).toContain(name);
    expect(here).toContain("not-disabled:hover:bg-card/40");
    const onCard = siteMenuStyles({ ground: "content", current: true }).row();
    expect(onCard.split(" ")).toContain("not-disabled:hover:bg-card/55");
    const other = siteMenuStyles({ ground: "map" }).row().split(" ");
    expect(other).toContain("not-disabled:hover:bg-card/55");
    expect(other).not.toContain("shadow-control");
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
