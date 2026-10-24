import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { avatarStyles } from "./Avatar";
import { BACKDROP, backdropStyles } from "./Backdrop";
import { buttonStyles } from "./Button";
import { checkboxStyles } from "./Checkbox";
import { chipStyles } from "./Chip";
import { controlStyles } from "./control";
import { countStyles } from "./Count";
import { backdropPress, dialogStyles, onBackdrop, syncModal } from "./Dialog";
import { emptyStyles } from "./Empty";
import { fieldStyles } from "./Field";
import { figureStyles } from "./Figure";
import { headlineStyles } from "./Headline";
import * as kit from "./index";
import { kickerStyles } from "./Kicker";
import { linkStyles } from "./Link";
import { mastheadStyles } from "./Masthead";
import { noticeStyles } from "./Notice";
import { pagerStyles } from "./Pager";
import { paneStyles } from "./Pane";
import { penNoteStyles, penStyles } from "./Pen";
import {
  arrowPath,
  framePath,
  loopPath,
  stemPath,
  strikePath,
  underlinePath,
} from "./penPaths";
import { puffinStyles } from "./Puffin";
import { ratingTipStyles } from "./RatingTip";
import { searchFieldStyles } from "./SearchField";
import { sectionHeadingStyles } from "./SectionHeading";
import { segmentedStyles } from "./Segmented";
import { skeletonStyles } from "./Skeleton";
import { starGlyphsStyles } from "./StarGlyphs";
import { beaufortGlyphStyles } from "./BeaufortGlyph";
import { beaufortPath } from "./beaufortPath";
import { surfaceStyles } from "./Surface";
import { UI, compileTheme, holds, selector } from "./theme.testkit";
import { MONO_LABEL, RING, RING_WITHIN } from "./tv";
import { wordmarkStyles } from "./Wordmark";

const {
  Avatar,
  Backdrop,
  BeaufortGlyph,
  Button,
  Checkbox,
  Chip,
  ConfirmDialog,
  Count,
  Dialog,
  Empty,
  Field,
  Figure,
  Headline,
  Kicker,
  Link,
  Masthead,
  MastheadMark,
  Notice,
  Pager,
  Pane,
  PenLoop,
  PenNote,
  Puffin,
  SearchField,
  SectionHeading,
  Segmented,
  Select,
  Skeleton,
  StarGlyphs,
  Surface,
  TextArea,
  TextInput,
  Wordmark,
  initials,
} = kit;

const RECIPES = {
  avatarStyles,
  backdropStyles,
  beaufortGlyphStyles,
  buttonStyles,
  checkboxStyles,
  chipStyles,
  controlStyles,
  countStyles,
  dialogStyles,
  emptyStyles,
  fieldStyles,
  figureStyles,
  headlineStyles,
  kickerStyles,
  linkStyles,
  mastheadStyles,
  noticeStyles,
  pagerStyles,
  paneStyles,
  penNoteStyles,
  penStyles,
  puffinStyles,
  ratingTipStyles,
  searchFieldStyles,
  sectionHeadingStyles,
  segmentedStyles,
  skeletonStyles,
  starGlyphsStyles,
  surfaceStyles,
  wordmarkStyles,
};

type Classes = string | readonly Classes[] | { [key: string]: Classes } | null;

/** Every class name written anywhere in a recipe, whatever its nesting. */
function written(value: Classes | undefined, skip: string[] = []): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap((v) => written(v, skip));
  return Object.entries(value)
    .filter(([key]) => !skip.includes(key))
    .flatMap(([, v]) => written(v as Classes, skip));
}

interface Recipe {
  base?: Classes;
  slots?: Classes;
  variants?: Classes;
  compoundVariants?: { class?: Classes; className?: Classes }[];
}

function classesOf(recipe: Recipe): string[] {
  return [
    ...written(recipe.base),
    ...written(recipe.slots),
    ...written(recipe.variants),
    ...(recipe.compoundVariants ?? []).flatMap((c) => [
      ...written(c.class),
      ...written(c.className),
    ]),
  ];
}

const html = (element: ReactElement) => renderToStaticMarkup(element);
const sources = readdirSync(UI).filter(
  (file) => /\.tsx?$/.test(file) && !/\.test\.|testkit/.test(file),
);
const read = (file: string) => readFileSync(resolve(UI, file), "utf8");

let build: (names: string[]) => string;
beforeAll(async () => {
  build = await compileTheme();
});

describe("the kit is styled only from the theme", () => {
  // A class that names a value the theme does not hold is not an error
  // anywhere: it is a control quietly missing its fill. So every name is asked.
  it.each(Object.entries(RECIPES))(
    "every class in %s resolves",
    (_, recipe) => {
      const names = classesOf(recipe as Recipe);
      expect(names.length).toBeGreaterThan(0);
      const css = build(names);
      for (const name of names) {
        // `group/field` is a marker for a variant to find, not a rule.
        if (name.startsWith("group/")) continue;
        expect(holds(css, name), name).toBe(true);
      }
    },
  );

  it("checks every recipe a component file declares", () => {
    const declaredIn = sources.flatMap((file) =>
      [...read(file).matchAll(/export const (\w+Styles) = tv\(/g)].map(
        (m) => m[1],
      ),
    );
    expect(declaredIn.sort()).toEqual(Object.keys(RECIPES).sort());
  });

  // A class written straight into markup would slip past the check above.
  it("writes no class outside a recipe, the gallery apart", () => {
    for (const file of sources.filter((f) => f !== "Gallery.tsx"))
      expect(read(file), file).not.toMatch(/className="/);
  });

  it("imports nothing from the design bundle, and no stylesheet", () => {
    for (const file of sources) {
      expect(read(file), file).not.toMatch(/from\s+["'][^"']*design\//);
      expect(read(file), file).not.toMatch(/import\s+["'][^"']+\.css["']/);
    }
  });
});

describe("S2: what ui/ exports", () => {
  it("is the thirty-six components, by name", () => {
    const components = Object.keys(kit).filter((name) => /^[A-Z]/.test(name));
    expect(components.sort()).toEqual(
      [
        "Avatar",
        "Backdrop",
        "BeaufortGlyph",
        "Button",
        "Checkbox",
        "Chip",
        "ConfirmDialog",
        "Count",
        "Dialog",
        "Empty",
        "Field",
        "Figure",
        "Headline",
        "Kicker",
        "Link",
        "Masthead",
        "MastheadMark",
        "Notice",
        "Pager",
        "Pane",
        "PenLoop",
        "PenNote",
        "PenStrike",
        "PenUnderline",
        "Puffin",
        "RatingTip",
        "SearchField",
        "SectionHeading",
        "Segmented",
        "Select",
        "Skeleton",
        "StarGlyphs",
        "Surface",
        "TextArea",
        "TextInput",
        "Wordmark",
      ].sort(),
    );
  });

  it.each([
    [
      "Button",
      buttonStyles,
      "variant",
      ["quiet", "primary", "pill", "raised", "link", "danger"],
    ],
    ["Button", buttonStyles, "size", ["sm", "md", "lg"]],
    ["Button", buttonStyles, "icon", ["true"]],
    ["Button", buttonStyles, "pressed", ["true", "worded"]],
    ["Chip", chipStyles, "tone", ["neutral", "warn", "glass"]],
    ["Chip", chipStyles, "eyebrow", ["true"]],
    ["Pane", paneStyles, "kind", ["card", "sunken", "ruled"]],
    ["Pane", paneStyles, "double", ["true"]],
    ["Pane", paneStyles, "standing", ["true"]],
    ["Surface", surfaceStyles, "rule", ["double", "single"]],
    ["Wordmark", wordmarkStyles, "size", ["sm", "md", "lg"]],
    ["SectionHeading", sectionHeadingStyles, "size", ["lead", "title", "kicker"]],
    ["SectionHeading", sectionHeadingStyles, "rule", ["thin", "thick", "double"]],
    ["StarGlyphs", starGlyphsStyles, "tone", ["ink", "inverse", "magenta"]],
    ["Avatar", avatarStyles, "size", ["sm", "md", "lg"]],
    ["RatingTip", ratingTipStyles, "size", ["md", "sm"]],
  ] as const)("%s has %s: %j", (_, recipe, variant, values) => {
    const variants = (recipe as unknown as { variants: Record<string, object> })
      .variants;
    expect(Object.keys(variants[variant])).toEqual([...values]);
  });
});

describe("S3: the chart's shapes", () => {
  it("speaks in the mono label: every button, in tracked capitals", () => {
    for (const variant of ["quiet", "primary", "pill", "raised", "danger"] as const) {
      const classes = buttonStyles({ variant }).split(" ");
      for (const name of ["font-mono", "text-label", "uppercase"])
        expect(classes, `${variant} ${name}`).toContain(name);
    }
  });

  it("a pill is paper in an ink rule, and turns to ink under the pointer", () => {
    const pill = buttonStyles({ variant: "pill" }).split(" ");
    for (const name of [
      "bg-card",
      "border",
      "border-ink",
      "rounded-full",
      "not-disabled:hover:bg-inverse",
      "not-disabled:hover:text-ink-inverse",
    ])
      expect(pill).toContain(name);
  });

  it("the filled action is an ink capsule that turns magenta, and lg is heavier", () => {
    const primary = buttonStyles({ variant: "primary", size: "lg" }).split(" ");
    for (const name of [
      "rounded-full",
      "bg-accent",
      "text-accent-ink",
      "not-disabled:hover:bg-accent-hover",
      "font-semibold",
    ])
      expect(primary).toContain(name);
  });

  it("the instrument is a raised paper button: a control's corner, round with an icon", () => {
    for (const icon of [false, true]) {
      const raised = buttonStyles({ variant: "raised", icon }).split(" ");
      expect(raised, String(icon)).toContain(
        icon ? "rounded-full" : "rounded-control",
      );
      expect(raised, String(icon)).not.toContain("rounded-none");
      for (const name of ["border-ink", "sheen-raised", "shadow-raised"])
        expect(raised, String(icon)).toContain(name);
    }
  });

  it("a pressed or filled ink control carries the ink's sheen and nudges when pressed", () => {
    for (const classes of [
      buttonStyles({ pressed: true }),
      buttonStyles({ variant: "primary" }),
    ]) {
      const list = classes.split(" ");
      for (const name of [
        "sheen-ink",
        "shadow-control",
        "not-disabled:active:translate-y-px",
        "disabled:bg-none",
      ])
        expect(list).toContain(name);
    }
    // A quiet, pill or link button is not lit.
    for (const variant of ["quiet", "pill", "link"] as const)
      expect(buttonStyles({ variant })).not.toMatch(/(^| )sheen-/);
  });

  it("a chip is a mono tag on the paper's second sheet, ruled with a hairline", () => {
    const chip = chipStyles().split(" ");
    for (const name of ["font-mono", "bg-sunken", "border-line", "text-ink-2"])
      expect(chip).toContain(name);
    expect(chipStyles({ tone: "warn" })).toContain("bg-warn-ground text-warn");
  });

  // Glass is a badge over a photograph now, and nothing else: over the map
  // the chart draws its boxes in solid paper.
  it("only a glass Chip is glass", () => {
    for (const [name, recipe] of Object.entries(RECIPES)) {
      const glass = classesOf(recipe as Recipe).some((c) => /glass/.test(c));
      expect(glass, name).toBe(name === "chipStyles");
    }
    expect(chipStyles({ tone: "glass" })).toContain("bg-glass");
    expect(chipStyles()).not.toContain("glass");
  });

  it("a surface is the chart's box: lit paper, the ink rule and its hairline, floating", () => {
    const surface = surfaceStyles().split(" ");
    for (const name of [
      "bg-card",
      "paper-float",
      "border-ink",
      "inset-shadow-frame",
      "rounded-surface",
      "shadow-float",
    ])
      expect(surface).toContain(name);
    expect(surfaceStyles({ rule: "single" })).not.toContain(
      "inset-shadow-frame",
    );
  });

  it("a pane is ruled in ink, and the broadsheet's section is a rule above", () => {
    expect(paneStyles().split(" ")).toContain("border-ink");
    expect(paneStyles().split(" ")).toContain("paper-grain");
    const ruled = paneStyles({ kind: "ruled" }).split(" ");
    for (const name of ["border-t-2", "border-ink", "px-0"])
      expect(ruled).toContain(name);
    expect(ruled).not.toContain("border");
    expect(paneStyles({ double: true })).toContain("inset-shadow-frame");
  });

  it("the dialog is the chart's box too, with its title in the display face", () => {
    const dialog = dialogStyles();
    for (const name of ["paper-grain", "border-ink", "inset-shadow-frame"])
      expect(dialog.base().split(" ")).toContain(name);
    expect(dialog.title().split(" ")).toContain("font-display");
  });

  it("a field is named in the mono label, and its words are the body face", () => {
    expect(fieldStyles().label()).toContain(MONO_LABEL.split(" ")[0]);
    expect(fieldStyles().label().split(" ")).toContain("uppercase");
    expect(controlStyles().input().split(" ")).toContain("font-body");
    expect(controlStyles().input().split(" ")).toContain("placeholder:italic");
  });

  it("a search is a rule to write on, not a box", () => {
    const base = searchFieldStyles().base().split(" ");
    for (const name of ["border-0", "border-b", "border-ink", "bg-transparent"])
      expect(base).toContain(name);
    expect(base).not.toContain("rounded-full");
  });
});

describe("S4: states", () => {
  it("every pressable control carries the one ring", () => {
    for (const variant of [
      "quiet",
      "primary",
      "pill",
      "raised",
      "link",
      "danger",
    ] as const)
      expect(buttonStyles({ variant }), variant).toContain(RING);
    expect(linkStyles()).toContain(RING);
    expect(segmentedStyles().item()).toContain(RING);
  });

  it("a field's box carries it, and the element inside draws none", () => {
    for (const kind of ["text", "area", "select"] as const) {
      const styles = controlStyles({ kind });
      expect(styles.box(), kind).toContain(RING_WITHIN);
      expect(styles.input(), kind).toContain("focus-visible:outline-hidden");
    }
    const search = searchFieldStyles();
    expect(search.base()).toContain(RING_WITHIN);
    expect(search.input()).toContain("focus-visible:outline-hidden");
  });

  it("no recipe draws a ring of its own", () => {
    const ring = new Set([...RING.split(" "), ...RING_WITHIN.split(" ")]);
    for (const [name, recipe] of Object.entries(RECIPES))
      for (const c of classesOf(recipe as Recipe))
        if (/(^|:)(outline|ring)-/.test(c) && !/inset-ring/.test(c))
          expect(
            ring.has(c) || c === "focus-visible:outline-hidden",
            `${name}: ${c}`,
          ).toBe(true);
  });

  it("pressed is filled in ink and heavier, not only recoloured", () => {
    const pressed = buttonStyles({ variant: "pill", pressed: true }).split(" ");
    for (const name of [
      "bg-inverse",
      "text-ink-inverse",
      "shadow-control",
      "font-semibold",
    ])
      expect(pressed).toContain(name);
    expect(pressed).not.toContain("bg-card");
    const item = segmentedStyles().item();
    for (const name of [
      "aria-pressed:bg-inverse",
      "aria-pressed:text-ink-inverse",
      "aria-pressed:font-semibold",
    ])
      expect(item).toContain(name);
  });

  /*
   * The one exception, and it is not a hole: a toggle whose label changes with
   * it — Save becomes Saved, its heart filled in — has said so in words and in
   * a mark before the box is asked. Filling it as well would put a second
   * filled control on a view that is allowed one.
   */
  it("a worded toggle keeps its quiet box, and still says pressed", () => {
    const worded = buttonStyles({ variant: "pill", pressed: "worded" });
    expect(worded).toBe(buttonStyles({ variant: "pill" }));
    for (const name of ["bg-inverse", "font-semibold", "text-ink-inverse"])
      expect(worded.split(" ")).not.toContain(name);
    expect(html(<Button pressed="worded">Saved</Button>)).toContain(
      'aria-pressed="true"',
    );
  });

  // A pane that is the page's own box rather than one of a column of them.
  it("a standing pane takes the wider inset, and is still a card", () => {
    const standing = paneStyles({ standing: true }).split(" ");
    for (const name of ["p-6", "shadow-card", "max-wide:p-5"])
      expect(standing).toContain(name);
    expect(standing).not.toContain("p-5");
    expect(paneStyles().split(" ")).toContain("p-5");
  });

  it("a card pane has the ink rule, its hairline and a contact shadow; a ruled one is square and bare", () => {
    const card = paneStyles().split(" ");
    for (const name of [
      "rounded-surface",
      "border-ink",
      "inset-shadow-frame",
      "shadow-card",
    ])
      expect(card).toContain(name);
    const ruled = paneStyles({ kind: "ruled" }).split(" ");
    expect(ruled).toContain("rounded-none");
    expect(ruled.some((c) => c.startsWith("shadow-"))).toBe(false);
    expect(ruled).not.toContain("inset-shadow-frame");
  });

  it("hover and disabled are written for every button", () => {
    for (const variant of [
      "quiet",
      "primary",
      "pill",
      "raised",
      "link",
      "danger",
    ] as const) {
      const classes = buttonStyles({ variant });
      expect(classes, variant).toMatch(/not-disabled:hover:/);
      expect(classes, variant).toContain("disabled:text-ink-disabled");
      // The reset fades a disabled button; the kit says it in ink instead.
      expect(classes, variant).toContain("disabled:opacity-100");
    }
  });

  /*
   * The reset's `button:enabled:hover` lays 25% white behind anything that does
   * not name a background of its own, so every variant names one — including
   * the two whose answer is "the one it already has". `link` is a box the size
   * of its words and would take a white patch behind them; `danger` would take
   * one over the warm fill it is drawn in.
   */
  it.each([
    ["quiet", "not-disabled:hover:bg-sunken"],
    ["primary", "not-disabled:hover:bg-accent-hover"],
    ["pill", "not-disabled:hover:bg-inverse"],
    ["raised", "not-disabled:hover:bg-inverse"],
    ["link", "not-disabled:hover:bg-transparent"],
    ["danger", "not-disabled:hover:bg-warn"],
  ] as const)("%s names the background its hover has", (variant, name) => {
    expect(buttonStyles({ variant }).split(" ")).toContain(name);
  });

  // The epic's tap-target rule: 44px on a touch device, whatever the size.
  it("every control is a touch target under pointer: coarse", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const button = buttonStyles({ variant: "pill", size }).split(" ");
      expect(button, size).toContain("pointer-coarse:min-h-touch");
      const icon = buttonStyles({ icon: true, size }).split(" ");
      expect(icon, size).toContain("pointer-coarse:min-h-touch");
      expect(icon, size).toContain("pointer-coarse:min-w-touch");
    }
    for (const size of ["md", "lg", "hero"] as const)
      expect(searchFieldStyles({ size }).base().split(" "), size).toContain(
        "pointer-coarse:min-h-touch",
      );
    expect(segmentedStyles().item().split(" ")).toContain(
      "pointer-coarse:min-h-touch",
    );
    for (const kind of ["text", "area", "select"] as const)
      expect(controlStyles({ kind }).box().split(" "), kind).toContain(
        "min-h-touch",
      );
    // A link in running text has no box of its own to make taller.
    const link = buttonStyles({ variant: "link" }).split(" ");
    expect(link).toContain("pointer-coarse:min-h-0");
    expect(link).not.toContain("pointer-coarse:min-h-touch");
    // ...but it is still a thumb's target: a touch-tall band over the words.
    for (const name of [
      "relative",
      "pointer-coarse:before:absolute",
      "pointer-coarse:before:inset-x-0",
      "pointer-coarse:before:top-1/2",
      "pointer-coarse:before:h-touch",
      "pointer-coarse:before:-translate-y-1/2",
    ])
      expect(link, name).toContain(name);
  });

  it("says pressed to a screen reader too", () => {
    expect(html(<Button pressed>Wings</Button>)).toContain(
      'aria-pressed="true"',
    );
    expect(html(<Button pressed={false}>Wings</Button>)).toContain(
      'aria-pressed="false"',
    );
    expect(html(<Button>Wings</Button>)).not.toContain("aria-pressed");
  });
});

describe("S5: one filled control", () => {
  it("the accent fill is written once in the kit: Button primary", () => {
    const holders = Object.entries(RECIPES)
      .filter(([, recipe]) => classesOf(recipe as Recipe).includes("bg-accent"))
      .map(([name]) => name);
    expect(holders).toEqual(["buttonStyles"]);
    for (const variant of [
      "quiet",
      "pill",
      "raised",
      "link",
      "danger",
    ] as const)
      expect(buttonStyles({ variant }), variant).not.toContain("bg-accent");
    expect(buttonStyles({ variant: "primary" })).toContain("bg-accent");
  });

  it("danger is the warn fill", () => {
    const danger = buttonStyles({ variant: "danger" }).split(" ");
    expect(danger).toContain("bg-warn");
    expect(danger).toContain("text-ink-inverse");
  });

  it("danger is used by ConfirmDialog and by nothing else in the kit", () => {
    const users = sources.filter(
      (file) => file !== "Gallery.tsx" && /variant="danger"/.test(read(file)),
    );
    expect(users).toEqual(["ConfirmDialog.tsx"]);
  });
});

describe("S6: fields on a touch device", () => {
  it("take the input step, 16px, under pointer: coarse", () => {
    for (const input of [
      controlStyles().input(),
      searchFieldStyles().input(),
    ]) {
      expect(input).toContain("text-prose");
      expect(input).toContain("pointer-coarse:text-input");
      expect(input).toContain("font-normal");
    }
    const css = build(["pointer-coarse:text-input"]);
    const at = css.indexOf(`${selector("pointer-coarse:text-input")} {`);
    const rule = css.slice(css.lastIndexOf("@media", at), css.indexOf("}", at));
    expect(rule).toMatch(/^@media \(pointer: coarse\) \{/);
    expect(rule).toContain("font-size: var(--text-input);");
    expect(css).toMatch(/--text-input: 16px;/);
  });
});

describe("S7: Dialog", () => {
  it("is a native dialog, named by its title", () => {
    const markup = html(
      <Dialog open title="New thread" onClose={() => {}}>
        Body
      </Dialog>,
    );
    expect(markup).toMatch(/^<dialog /);
    const [, id] = markup.match(/aria-labelledby="([^"]+)"/)!;
    expect(markup).toContain(
      `<h2 class="m-0 min-w-0 flex-1 font-display text-lead text-ink" id="${id}">`,
    );
    expect(markup).toContain('aria-label="Close"');
  });

  it("takes a name of its own over a changing title, and a figure in its head", () => {
    const markup = html(
      <Dialog
        open
        title="How do you ride?"
        label="Customise"
        aside="1 / 6"
        onClose={() => {}}
      >
        Body
      </Dialog>,
    );
    expect(markup).toContain('aria-label="Customise"');
    expect(markup).not.toContain("aria-labelledby");
    // Between the title and the close button.
    expect(markup).toMatch(
      /How do you ride\?<\/h2><div class="[^"]*">1 \/ 6<\/div><button/,
    );
  });

  it("only takes a display of its own while open", () => {
    const base = dialogStyles().base().split(" ");
    expect(base).toContain("open:grid");
    for (const name of ["grid", "flex", "block"])
      expect(base).not.toContain(name);
  });

  it("has the shared backdrop: paper over a 6px blur, fading in and out", () => {
    const base = dialogStyles().base().split(" ");
    for (const name of BACKDROP.split(" ")) expect(base).toContain(name);
    const css = build(["backdrop:scrim"]);
    expect(css).toContain(
      ".backdrop\\:scrim::backdrop {\n  background-color: var(--color-scrim);",
    );
    // Written as a pattern, not the property's own words: ui/ is scanned for
    // class names, and those words would come out as a utility of their own.
    expect(css).toMatch(/drop-filter: blur\(var\(--blur-scrim\)\);/);
    expect(css).toContain("animation: var(--animate-scrim-in);");
    expect(css).toMatch(/--blur-scrim: 6px;/);
  });

  it("falls back to a thicker wash and no blur, and holds still for less motion", () => {
    const css = build(["scrim"]);
    const solid = /background-color: var\(--color-scrim-solid\);/;
    const noBlur = css.slice(css.indexOf("prefers-reduced-transparency"));
    expect(noBlur).toMatch(solid);
    expect(noBlur).toMatch(/drop-filter: none;/);
    const unsupported = css.slice(css.indexOf("@supports not"));
    expect(unsupported).toMatch(solid);
    const still = css.slice(css.indexOf("prefers-reduced-motion"));
    expect(still).toMatch(/animation: none;/);
  });

  it("fades out only where the browser keeps a closing dialog on top", () => {
    const css = build(["modal-fade"]);
    const gated = css.slice(css.indexOf("@supports (overlay: auto)"));
    expect(gated).toContain(
      "overlay var(--transition-duration-fast) allow-discrete",
    );
    expect(gated).toContain(
      "display var(--transition-duration-fast) allow-discrete",
    );
    expect(css.indexOf("transition:")).toBeGreaterThan(
      css.indexOf("@supports (overlay: auto)"),
    );
  });

  it("Backdrop draws the scrim while open, and nothing once gone", () => {
    expect(html(<Backdrop open onClose={() => {}} />)).toMatch(
      /^<div aria-hidden="true" data-backdrop="" class="[^"]*\bscrim\b/,
    );
    expect(html(<Backdrop open={false} />)).toBe("");
  });

  const host = (open = false) => ({
    open,
    showModal: vi.fn(function (this: { open: boolean }) {
      this.open = true;
    }),
    close: vi.fn(function (this: { open: boolean }) {
      this.open = false;
    }),
  });
  const target = (isConnected = true) => ({ isConnected, focus: vi.fn() });

  it("opens as a modal, and gives the focus back to the opener on close", () => {
    const dialog = host();
    const button = target();
    const opener = { current: null };
    syncModal(dialog, true, opener, () => button);
    expect(dialog.showModal).toHaveBeenCalledOnce();
    expect(button.focus).not.toHaveBeenCalled();

    syncModal(dialog, false, opener, () => null);
    expect(dialog.close).toHaveBeenCalledOnce();
    expect(button.focus).toHaveBeenCalledOnce();
    expect(opener.current).toBeNull();
  });

  // A strict render runs the effect twice. The second time the focus is
  // already inside the dialog, and that is not the opener.
  it("remembers the opener from the moment it really opened", () => {
    const dialog = host();
    const button = target();
    const inside = target();
    const opener = { current: null };
    syncModal(dialog, true, opener, () => button);
    syncModal(dialog, true, opener, () => inside);
    expect(dialog.showModal).toHaveBeenCalledOnce();
    syncModal(dialog, false, opener, () => null);
    expect(button.focus).toHaveBeenCalledOnce();
    expect(inside.focus).not.toHaveBeenCalled();
  });

  it("does not focus an opener that has left the page, or close twice", () => {
    const dialog = host();
    const gone = target(false);
    const opener = { current: null };
    syncModal(dialog, true, opener, () => gone);
    syncModal(dialog, false, opener, () => null);
    syncModal(dialog, false, opener, () => null);
    expect(dialog.close).toHaveBeenCalledOnce();
    expect(gone.focus).not.toHaveBeenCalled();
  });

  // The box is 100 to 300 across and 100 to 200 down.
  const boxed = {
    getBoundingClientRect: () => ({
      left: 100,
      right: 300,
      top: 100,
      bottom: 200,
    }),
  };
  const at = (target: unknown, clientX: number, clientY: number) => ({
    target,
    clientX,
    clientY,
  });

  it("only a point outside the box is the backdrop, not the dialog's padding", () => {
    expect(onBackdrop(boxed, at(boxed, 10, 10))).toBe(true);
    expect(onBackdrop(boxed, at(boxed, 301, 150))).toBe(true);
    expect(onBackdrop(boxed, at(boxed, 104, 104))).toBe(false);
    // Something inside the dialog, wherever the pointer says it is.
    expect(onBackdrop(boxed, at({}, 10, 10))).toBe(false);
    expect(onBackdrop(null, at(boxed, 10, 10))).toBe(false);
  });

  it("a press and release on the backdrop closes", () => {
    const press = backdropPress(() => boxed);
    press.down(at(boxed, 10, 10));
    expect(press.click(at(boxed, 12, 10))).toBe(true);
  });

  // The click lands on the dialog, the nearest thing the two ends share.
  it("a selection dragged out of a field and let go on the backdrop does not", () => {
    const press = backdropPress(() => boxed);
    press.down(at({}, 150, 150));
    expect(press.click(at(boxed, 10, 10))).toBe(false);
  });

  it("a click with no press of its own does not, and one press is one click", () => {
    const press = backdropPress(() => boxed);
    expect(press.click(at(boxed, 10, 10))).toBe(false);
    press.down(at(boxed, 10, 10));
    expect(press.click(at(boxed, 150, 150))).toBe(false);
    expect(press.click(at(boxed, 10, 10))).toBe(false);
  });

  it("ConfirmDialog asks with Cancel first and the danger answer last", () => {
    const markup = html(
      <ConfirmDialog
        open
        title="Delete this listing?"
        confirmLabel="Delete listing"
        onConfirm={() => {}}
        onCancel={() => {}}
      >
        Its photos go with it.
      </ConfirmDialog>,
    );
    const buttons = [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)];
    expect(buttons.map((b) => b[1])).toEqual(["Cancel", "Delete listing"]);
    expect(buttons[1][0]).toContain("bg-warn");
    // Its own Cancel is the way out; there is no second one in the corner.
    expect(markup).not.toContain('aria-label="Close"');
  });

  it("holds both answers while the work is under way", () => {
    const markup = html(
      <ConfirmDialog
        open
        busy
        title="Delete?"
        confirmLabel="Delete"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(markup.match(/<button[^>]* disabled=""/g)).toHaveLength(2);
  });
});

describe("S8: an icon-only Button needs a name", () => {
  // The rule is a type, so the test is the type checker: `npm run build` runs
  // `tsc -b` over ui/, and an unused @ts-expect-error fails it. If the rule
  // were lost, the two marked lines below would stop being errors.
  it("is enforced by the compiler", () => {
    const named = (
      <Button icon aria-label="Notifications">
        <i />
      </Button>
    );
    // @ts-expect-error icon without aria-label
    const unnamed = <Button icon />;
    // @ts-expect-error icon as a link without aria-label
    const unnamedLink = <Button icon href="/community" />;
    const labelled = <Button>Reply</Button>;
    const link = (
      <Button href="/market" variant="primary">
        Sell
      </Button>
    );
    expect(html(named)).toContain('aria-label="Notifications"');
    expect([unnamed, unnamedLink, labelled, link]).toHaveLength(4);
  });

  it("an icon button is a circle as wide as it is tall", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const classes = buttonStyles({ icon: true, size }).split(" ");
      expect(classes).toContain(`h-control-${size}`);
      expect(classes).toContain(`w-control-${size}`);
      expect(classes).toContain("rounded-full");
      expect(classes).toContain("p-0");
      expect(classes.some((c) => /^px-/.test(c))).toBe(false);
    }
  });

  it("SearchField needs one too", () => {
    // @ts-expect-error a search field has no visible label
    const unnamed = <SearchField />;
    expect(unnamed).toBeTruthy();
    const markup = html(<SearchField aria-label="Search threads" busy />);
    expect(markup).toContain('type="search"');
    expect(markup).toContain('aria-label="Search threads"');
    expect(markup).toContain('aria-busy="true"');
  });
});

describe("S9: the gallery is for development only", () => {
  it("is not exported from the kit", () => {
    expect(Object.keys(kit)).not.toContain("Gallery");
    expect(read("index.ts")).not.toMatch(/from "\.\/Gallery"/);
  });

  // The mode is a constant in a build, and `vite build` is "production"
  // whatever NODE_ENV the shell exports, so the import it guards is removed and
  // the gallery is never written to the output. `import.meta.env.DEV` follows
  // NODE_ENV instead, and is not the guard.
  it("is reached from src/main.tsx only in development mode", () => {
    const main = readFileSync(resolve(UI, "../src/main.tsx"), "utf8");
    expect(main).toMatch(
      /import\.meta\.env\.MODE === "development"\s*\?\s*React\.lazy\(\(\) => import\("\.\.\/ui\/Gallery"\)\)\s*:\s*null/,
    );
    expect(main.match(/ui\/Gallery/g)).toHaveLength(1);
  });
});

describe("the components, rendered", () => {
  it("Button is a button of type button, or a link with an href", () => {
    expect(html(<Button>Reply</Button>)).toMatch(/^<button type="button" /);
    expect(html(<Button type="submit">Post</Button>)).toContain(
      'type="submit"',
    );
    const link = html(<Button href="/community">Community</Button>);
    expect(link).toMatch(/^<a href="\/community" /);
    expect(link).not.toContain("type=");
  });

  it("a pressed link is the current one, since a link cannot be pressed", () => {
    const link = html(
      <Button href="/community" pressed>
        Latest
      </Button>,
    );
    expect(link).toContain('aria-current="true"');
    expect(link).not.toContain("aria-pressed");
  });

  it("a caller's className has the last word", () => {
    expect(html(<Button className="rounded-control">x</Button>)).not.toContain(
      "rounded-full",
    );
  });

  it("Chip, Pane and Surface pass their attributes through", () => {
    expect(html(<Chip eyebrow>New</Chip>)).toContain("uppercase");
    expect(html(<Pane kind="sunken" id="p" />)).toMatch(/id="p"/);
    expect(html(<Pane kind="sunken" />)).not.toContain("border-line");
    expect(html(<Surface role="region" />)).toMatch(/^<div role="region"/);
  });

  // Over a moving map a translucent panel is a second, blurred map: the
  // Surface is solid paper, and costs the phone no backdrop filter.
  it("Surface blurs nothing behind it", () => {
    expect(surfaceStyles()).not.toMatch(/backdrop/);
  });

  it("Avatar draws initials, or the photo with no second telling", () => {
    expect(initials("Aoife Ní Bhriain")).toBe("AB");
    expect(initials("  conor ")).toBe("C");
    expect(initials("")).toBe("?");
    expect(html(<Avatar name="Aoife Byrne" />)).toMatch(
      /^<span [^>]*aria-hidden="true">AB<\/span>$/,
    );
    const photo = html(<Avatar name="Aoife Byrne" src="/a.jpg" size="lg" />);
    expect(photo).toContain(
      '<img class="size-full object-cover" src="/a.jpg" alt=""/>',
    );
    expect(photo).not.toContain("AB");
  });

  it("Count draws nothing for zero and stops counting at 99", () => {
    expect(html(<Count value={0} />)).toBe("");
    expect(html(<Count value={4} />)).toMatch(/aria-hidden="true">4<\/span>$/);
    expect(html(<Count value={120} />)).toContain(">99+<");
    const spoken = html(<Count value={4} label="unread" />);
    expect(spoken).not.toContain("aria-hidden");
    expect(spoken).toContain('<span class="sr-only"> unread</span>');
  });

  it("Notice interrupts only when it warns", () => {
    expect(html(<Notice>Saved</Notice>)).toContain('role="status"');
    const warn = html(<Notice kind="warn">Offline</Notice>);
    expect(warn).toContain('role="alert"');
    expect(warn).toContain("bg-warn-ground");
  });

  it("Empty is a pane with a title and what to do next", () => {
    const markup = html(
      <Empty title="No threads yet">
        <p>Start one.</p>
      </Empty>,
    );
    expect(markup).toContain("bg-card");
    expect(markup).toContain("No threads yet");
    expect(markup).toContain("<p>Start one.</p>");
  });

  it("Pager is absent for one page and stops at both ends", () => {
    const noop = () => {};
    expect(
      html(<Pager page={1} pageSize={20} total={20} onPage={noop} />),
    ).toBe("");
    const first = html(
      <Pager page={1} pageSize={20} total={45} onPage={noop} />,
    );
    expect(first).toContain("Page 1 of 3");
    expect(first.match(/<button[^>]*>/g)![0]).toContain('disabled=""');
    expect(first.match(/<button[^>]*>/g)![1]).not.toContain('disabled=""');
    const last = html(
      <Pager page={3} pageSize={20} total={45} onPage={noop} />,
    );
    expect(last.match(/<button[^>]*>/g)![1]).toContain('disabled=""');
  });

  it("Field names its control and says what is wrong", () => {
    const ok = html(
      <Field label="Title" hint="Optional" htmlFor="t">
        <TextInput id="t" />
      </Field>,
    );
    expect(ok).toContain('<label class="');
    expect(ok).toContain('for="t"');
    expect(ok).not.toContain("data-invalid=");
    expect(ok).not.toContain('role="alert"');
    const wrong = html(
      <Field label="Title" error="Give it a title" htmlFor="t">
        <TextInput id="t" />
      </Field>,
    );
    expect(wrong).toContain('data-invalid=""');
    expect(wrong).toMatch(/role="alert">Give it a title</);
  });

  /*
   * The measures the design bundle always drew these at, which the marketplace's
   * forms were laid out from and are held to (market-tw-sell-me): a label at
   * the label leading (1.3, not a paragraph's 1.5), a text area three large
   * controls tall, and an empty state's icon well a large control and a gap
   * across. Each is a box that moves every field or line under it.
   */
  it("Field, TextArea and Empty keep the design bundle's measures", () => {
    const field = fieldStyles();
    expect(field.label().split(" ")).toContain("leading-tight");
    expect(field.hint().split(" ")).toContain("leading-tight");
    expect(controlStyles({ kind: "area" }).input().split(" ")).toContain(
      "min-h-34.5",
    );
    expect(emptyStyles().icon().split(" ")).toContain("size-14.5");
  });

  it("TextInput, TextArea and Select keep the native element", () => {
    const input = html(<TextInput prefix="€" active placeholder="0" />);
    expect(input).toContain("€");
    expect(input).toContain("border-accent");
    expect(input).toMatch(/<input [^>]*placeholder="0"/);
    expect(html(<TextArea rows={4} />)).toMatch(/<textarea [^>]*rows="4"/);
    const select = html(
      <Select defaultValue="a">
        <option value="a">Any</option>
      </Select>,
    );
    expect(select).toMatch(/<select /);
    expect(select).toContain("appearance-none");
    expect(select).toMatch(/<svg [^>]*aria-hidden="true"/);
  });

  /*
   * The tick is what says checked: a mark that is there or is not, which no
   * colour is needed to read. So the fill under it is the kit's ink and never
   * the accent — the accent is the one filled action on a view, and this is
   * not it. The whole row is the label, and the label is part of the target.
   */
  it("Checkbox is a native box, named, and not drawn in the accent", () => {
    const markup = html(
      <Checkbox checked readOnly>
        Buyers can message this number
      </Checkbox>,
    );
    expect(markup).toMatch(/^<label /);
    expect(markup).toMatch(/<input [^>]*type="checkbox"/);
    expect(markup).toContain("Buyers can message this number");
    const classes = checkboxStyles();
    expect(classes.input().split(" ")).toContain("accent-inverse");
    expect(classes.input()).not.toContain("accent-accent");
    // A row a thumb has to find, and one ring, the kit's.
    expect(classes.base().split(" ")).toContain("min-h-touch");
    expect(classes.input()).toContain(RING);
  });

  it("Checkbox says disabled through the whole row", () => {
    const markup = html(
      <Checkbox disabled>Buyers can message this number</Checkbox>,
    );
    expect(markup).toMatch(/<input [^>]*disabled=""/);
    expect(checkboxStyles().base()).toContain("has-disabled:text-ink-disabled");
  });

  it("Segmented is a named group with exactly one pressed", () => {
    const markup = html(
      <Segmented
        aria-label="Notify me"
        value="mentions"
        onChange={() => {}}
        options={[
          { value: "all", label: "Every reply" },
          { value: "mentions", label: "Mentions only" },
          { value: "none", label: "Nothing", disabled: true },
        ]}
      />,
    );
    expect(markup).toMatch(/^<div role="group" aria-label="Notify me"/);
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Mentions only</);
    expect(markup).toMatch(/disabled=""[^>]*>Nothing</);
  });

  it("Skeleton and Link", () => {
    expect(html(<Skeleton shape="block" />)).toContain('aria-hidden="true"');
    expect(html(<Skeleton />)).toContain("motion-reduce:animate-none");
    expect(html(<Link href="/market">Gear</Link>)).toContain("underline");
    expect(html(<Link href="/market" plain />)).toContain("no-underline");
  });
});

describe("the chart's own primitives", () => {
  it("Wordmark is the name in words, with .ie in magenta italic", () => {
    const markup = html(<Wordmark />);
    expect(markup).toMatch(/>wingfoil<span class="[^"]*text-chart-magenta[^"]*">\.ie<\/span><\/span>$/);
    const base = wordmarkStyles().base().split(" ");
    for (const name of ["font-display", "font-extrabold", "optical-display"])
      expect(base).toContain(name);
    expect(wordmarkStyles().domain().split(" ")).toContain("italic");
  });

  it("Kicker is the mono label, and a heading where it is asked to be one", () => {
    expect(kickerStyles().split(" ")).toEqual(
      expect.arrayContaining(MONO_LABEL.split(" ")),
    );
    expect(html(<Kicker as="h3">Best Mon</Kicker>)).toMatch(/^<h3 class="/);
    expect(kickerStyles({ tone: "pen" })).toContain("text-pen-ink");
  });

  it("SectionHeading is a heading on a rule, with its figures set right", () => {
    const markup = html(
      <SectionHeading as="h3" aside="12–16">
        Monday 5
      </SectionHeading>,
    );
    expect(markup).toMatch(/<h3 class="[^"]*font-display[^"]*">Monday 5<\/h3>/);
    expect(markup).toContain("12–16");
    expect(sectionHeadingStyles().base()).toContain("border-b-2");
    expect(sectionHeadingStyles({ rule: "double" }).base()).toContain(
      "border-double",
    );
  });

  it("Headline is one heading, at the headline step on the display cut", () => {
    const markup = html(<Headline>Donabate</Headline>);
    expect(markup).toMatch(/^<h1 class="/);
    for (const name of ["text-headline", "optical-display", "max-wide:text-title"])
      expect(headlineStyles().base().split(" ")).toContain(name);
  });

  it("Figure puts the number first, the gust raised and the unit small", () => {
    const markup = html(<Figure value={14} sup={22} unit="kn" />);
    expect(markup.indexOf(">14<")).toBeLessThan(markup.indexOf(">22<"));
    expect(markup.indexOf(">22<")).toBeLessThan(markup.indexOf(">kn<"));
    expect(figureStyles().base().split(" ")).toContain("tabular-nums");
    expect(figureStyles({ alarm: true }).sup()).toContain("text-pen-ink");
    expect(html(<Figure value={14} label="14 knots" />)).toContain(
      'role="img" aria-label="14 knots"',
    );
  });

  it("BeaufortGlyph draws the force's feathers and writes its number", () => {
    const five = html(<BeaufortGlyph force={5} size={17} />);
    expect(five).toContain('aria-label="Force 5"');
    expect(five).toContain('role="img"');
    expect(five).toMatch(/>5<\/span>/);
    // The staff and three feathers: two whole and a half.
    const d = five.match(/ d="([^"]+)"/)![1];
    expect(d.match(/M/g)).toHaveLength(4);
    expect(html(<BeaufortGlyph force={5} bare />)).not.toMatch(/>5<\/span>/);
    expect(html(<BeaufortGlyph force={3} label="" />)).toContain(
      'aria-hidden="true"',
    );
  });

  it("BeaufortGlyph flies a pennant from Force 10, so the staff stays clear", () => {
    expect(html(<BeaufortGlyph force={9} />)).not.toContain("Z");
    const ten = html(<BeaufortGlyph force={10} size={10} />);
    expect(ten).toMatch(/d="M[^"]*Z"/);
    expect(beaufortPath(12, 10).stroke.match(/M/g)).toHaveLength(2);
    // Every feather on the staff, inside the box, at the 10px gust size.
    for (let f = 0; f <= 12; f++) {
      const { stroke, height } = beaufortPath(f, 10);
      for (const [, y] of stroke.matchAll(/M[\d.]+ ([\d.]+)/g))
        expect(Number(y)).toBeLessThanOrEqual(height);
    }
  });

  it("StarGlyphs draws five places: solid, faded, then dots", () => {
    const markup = html(<StarGlyphs stars={3} potential={4} />);
    expect(markup).toContain('aria-label="3 of 5 stars, 4 on the wind alone"');
    expect(markup.match(/<path/g)).toHaveLength(4);
    expect(markup.match(/<circle/g)).toHaveLength(1);
    const narrow = html(<StarGlyphs stars={2} potential={2} slots="potential" />);
    expect(narrow.match(/<path/g)).toHaveLength(2);
    expect(narrow).not.toContain("<circle");
  });

  // The dock's columns are 73px with 8px of padding a side: five stars at
  // its 10px must fit in what is left, or every column widens.
  it("StarGlyphs keeps five of the dock's 10px stars inside a column", () => {
    const width = Number(
      html(<StarGlyphs stars={5} size={10} slots="potential" />).match(
        /width="(\d+)"/,
      )?.[1],
    );
    expect(width).toBeLessThanOrEqual(73 - 16);
  });

  it("StarGlyphs leaves the dark unrated, at the width of a rated hour", () => {
    const dark = html(<StarGlyphs stars={null} />);
    const lit = html(<StarGlyphs stars={0} />);
    expect(dark).toContain('aria-label="Dark: not rated"');
    expect(dark).not.toMatch(/<path|<circle/);
    expect(dark.match(/width="(\d+)"/)?.[1]).toBe(
      lit.match(/width="(\d+)"/)?.[1],
    );
  });

  it("the pen draws a loop that overshoots its start, the same each time", () => {
    const d = loopPath(50, 30, 40, 20, 3);
    expect(d).toBe(loopPath(50, 30, 40, 20, 3));
    expect(d).not.toBe(loopPath(50, 30, 40, 20, 4));
    expect(d.startsWith("M")).toBe(true);
    expect(d.split(" L")).toHaveLength(49);
    expect(underlinePath(0, 3, 100)).toBe("M0.0 3.0 q50.0 -4 100.0 1");
    expect(strikePath(100, 10)).toMatch(/^M4\.0 7\.2 L96\.0 3\.0$/);
  });

  it("the pen frames a box on its line, hiding nothing in it, and lifts over what it must not cross", () => {
    const points = (d: string) =>
      [...d.matchAll(/([\d.-]+) ([\d.-]+)/g)].map((m) => [+m[1], +m[2]]);
    const d = framePath(10, 20, 60, 200, 6, 5);
    expect(d).toBe(framePath(10, 20, 60, 200, 6, 5));
    expect(d).not.toBe(framePath(10, 20, 60, 200, 6, 6));
    // One stroke, round and on past its start.
    expect(d.match(/M/g)).toHaveLength(1);
    for (const [x, y] of points(d)) {
      // Along the sides, on the box's line, never inside it beyond the
      // pen's width, nor far out of it.
      if (y > 28 && y < 212) {
        expect(x > 10 + 1.5 && x < 70 - 1.5).toBe(false);
        expect(Math.min(Math.abs(x - 10), Math.abs(x - 70))).toBeLessThan(4.5);
      }
      expect(x).toBeGreaterThan(10 - 5);
      expect(x).toBeLessThan(70 + 5);
    }
    // A figure on the right-hand edge: the pen lifts over it.
    const lifted = framePath(10, 20, 60, 200, 6, 5, [
      { x: 65, y: 100, w: 10, h: 12 },
    ]);
    expect(lifted.match(/M/g)).toHaveLength(2);
    for (const [x, y] of points(lifted))
      expect(x >= 65 && x <= 75 && y >= 100 && y <= 112).toBe(false);
    // The line at now, and its arrow, are as repeatable.
    expect(stemPath(40, 0, 100, 2)).toBe(stemPath(40, 0, 100, 2));
    for (const [x] of points(stemPath(40, 0, 100, 2)))
      expect(Math.abs(x - 40)).toBeLessThan(2);
    const arrow = arrowPath(40, 18, 1, 3);
    expect(arrow.from.x).toBeGreaterThan(40);
    expect(arrow.from.y).toBeLessThan(18);
    expect(arrowPath(40, 18, -1, 3).from.x).toBeLessThan(40);
  });

  it("the pen's marks are decoration, drawn in once and held for less motion", () => {
    const stroke = penStyles().stroke().split(" ");
    for (const name of ["stroke-pen", "animate-ink", "motion-reduce:animate-none"])
      expect(stroke).toContain(name);
    // Not laid out on the server: the loop is drawn round a measured box.
    expect(html(<PenLoop>13:00</PenLoop>)).toBe(
      '<span class="relative inline-block">13:00</span>',
    );
  });

  it("the pen's note is the hand, in the pen's ink that reads", () => {
    const markup = html(<PenNote>Go 13:00–16:00.</PenNote>);
    expect(markup).toMatch(/^<p class="[^"]*font-hand[^"]*text-pen-ink/);
  });

  it("the pen's note takes the attributes it is given, and keeps its classes", () => {
    const markup = html(
      <PenNote
        as="span"
        size="sm"
        id="n"
        data-pen-note
        aria-live="polite"
        className="ml-1"
      >
        best of the week
      </PenNote>,
    );
    expect(markup).toMatch(/^<span /);
    expect(markup).toContain('id="n"');
    expect(markup).toContain('data-pen-note="true"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toMatch(/class="[^"]*font-hand[^"]*ml-1/);
  });

  it("the puffin is decoration unless he is named", () => {
    expect(html(<Puffin />)).toContain('aria-hidden="true"');
    const named = html(<Puffin title="The Almanac" />);
    expect(named).toContain('role="img" aria-label="The Almanac"');
    expect(named).not.toContain("aria-hidden");
    // His wing's hatching names a pattern by an id a url() can hold.
    expect(named).toMatch(/fill="url\(#puffin-\S+?\)"/);
  });

  it("the masthead is a banner on the double rule, with the name and section", () => {
    const markup = html(
      <Masthead>
        <a href="/market">
          <MastheadMark section="Market" />
        </a>
      </Masthead>,
    );
    expect(markup).toMatch(/^<header class="/);
    expect(markup).toContain("wingfoil");
    expect(markup).toContain(">Market</span>");
    for (const name of ["border-b-3", "border-double", "border-ink"])
      expect(mastheadStyles().bar().split(" ")).toContain(name);
  });
});
