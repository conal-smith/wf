import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { avatarStyles } from "./Avatar";
import { BACKDROP, backdropStyles } from "./Backdrop";
import { beaufortGlyphStyles } from "./BeaufortGlyph";
import { beaufortPath } from "./beaufortPath";
import { buttonStyles } from "./Button";
import { cardStyles } from "./Card";
import { checkboxStyles } from "./Checkbox";
import { chipStyles } from "./Chip";
import { controlStyles } from "./control";
import { countStyles } from "./Count";
import { backdropPress, dialogStyles, onBackdrop, syncModal } from "./Dialog";
import { emptyStyles } from "./Empty";
import { fieldStyles } from "./Field";
import { figureStyles } from "./Figure";
import { headingStyles } from "./Heading";
import * as kit from "./index";
import { linkStyles } from "./Link";
import { noticeMarkStyles, noticeStyles } from "./Notice";
import { numberFieldStyles } from "./NumberField";
import { pagerStyles } from "./Pager";
import { ratingTipStyles } from "./RatingTip";
import { mount, text } from "./render.testkit";
import { rowsStyles } from "./Rows";
import { searchFieldStyles } from "./SearchField";
import { segmentedStyles } from "./Segmented";
import { skeletonStyles } from "./Skeleton";
import { sliderStyles } from "./Slider";
import { spotSearchStyles } from "./SpotSearch";
import { starGlyphsStyles } from "./StarGlyphs";
import { switchStyles } from "./Switch";
import { tabsStyles } from "./Tabs";
import { tagStyles } from "./Tag";
import { UI, compileTheme, holds, selector } from "./theme.testkit";
import { topBarStyles } from "./TopBar";
import { MONO_LABEL, NO_RING, RING, RING_WITHIN } from "./tv";
import { wordmarkStyles } from "./Wordmark";

const {
  Avatar,
  Backdrop,
  BeaufortGlyph,
  Button,
  Card,
  Checkbox,
  Chip,
  ConfirmDialog,
  Count,
  Dialog,
  Empty,
  Field,
  Figure,
  Heading,
  Link,
  Notice,
  NoticeMark,
  NumberField,
  Pager,
  Row,
  Rows,
  SearchField,
  Segmented,
  Select,
  Skeleton,
  Slider,
  StarGlyphs,
  Switch,
  Tabs,
  Tag,
  TextArea,
  TextInput,
  TopBar,
  Wordmark,
  initials,
} = kit;

const RECIPES = {
  avatarStyles,
  backdropStyles,
  beaufortGlyphStyles,
  buttonStyles,
  cardStyles,
  checkboxStyles,
  chipStyles,
  controlStyles,
  countStyles,
  dialogStyles,
  emptyStyles,
  fieldStyles,
  figureStyles,
  headingStyles,
  linkStyles,
  noticeMarkStyles,
  noticeStyles,
  numberFieldStyles,
  pagerStyles,
  ratingTipStyles,
  rowsStyles,
  searchFieldStyles,
  segmentedStyles,
  skeletonStyles,
  sliderStyles,
  spotSearchStyles,
  starGlyphsStyles,
  switchStyles,
  tabsStyles,
  tagStyles,
  topBarStyles,
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
const words = (classes: string) => classes.split(" ");
const sources = readdirSync(UI).filter(
  (file) => /\.tsx?$/.test(file) && !/\.test\.|testkit/.test(file),
);
const read = (file: string) => readFileSync(resolve(UI, file), "utf8");

let build: (names: string[]) => string;
beforeAll(async () => {
  build = await compileTheme();
});

const VARIANTS = [
  "outline",
  "primary",
  "soft",
  "quiet",
  "link",
  "danger",
] as const;
/** The four a view is built from; `link` and `danger` are the two special cases. */
const FOUR = ["primary", "outline", "soft", "quiet"] as const;

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

  // The old look is gone from the code, not hidden: no frame, no grain, no
  // sheen, no broadsheet rule, no tracked capitals, no italic serif heading.
  it.each([
    ["the paper's frame", /inset-shadow-frame/],
    ["the paper's grain", /paper-grain|paper-float/],
    ["a sheen", /\bsheen-/],
    ["a broadsheet rule", /border-double|border-b-3|border-t-2|border-b-2/],
    ["tracked capitals", /\buppercase\b|tracking-(wide|wider|widest)\b/],
    ["the puffin", /puffin|animate-bob/i],
  ])("draws no %s in any recipe", (_, pattern) => {
    for (const [name, recipe] of Object.entries(RECIPES))
      for (const c of classesOf(recipe as Recipe))
        expect(c, `${name}: ${c}`).not.toMatch(pattern);
  });

  // Fraunces is the wordmark's and a spot's name's, and no control's.
  it("sets nothing in the display face but the wordmark", () => {
    const holders = Object.entries(RECIPES)
      .filter(([, recipe]) =>
        classesOf(recipe as Recipe).some((c) => /(^|:)font-display$/.test(c)),
      )
      .map(([name]) => name);
    expect(holders).toEqual(["wordmarkStyles"]);
  });
});

describe("what ui/ exports", () => {
  it("is the kit's components, by name, and none of the old one's", () => {
    const components = Object.keys(kit).filter((name) => /^[A-Z]/.test(name));
    expect(components.sort()).toEqual(
      [
        "Avatar",
        "Backdrop",
        "BeaufortGlyph",
        "Button",
        "Card",
        "Checkbox",
        "Chip",
        "ConfirmDialog",
        "Count",
        "Dialog",
        "Empty",
        "Field",
        "Figure",
        "Heading",
        "Link",
        "Notice",
        "NoticeMark",
        "NumberField",
        "Pager",
        "RatingTip",
        "Row",
        "Rows",
        "SearchField",
        "Segmented",
        "Select",
        "Skeleton",
        "Slider",
        "SpotSearch",
        "StarGlyphs",
        "Switch",
        "Tabs",
        "Tag",
        "TextArea",
        "TextInput",
        "ThemeButton",
        "TopBar",
        "Wordmark",
      ].sort(),
    );
    for (const gone of [
      "Headline",
      "Kicker",
      "Masthead",
      "PageHeader",
      "Pane",
      "Puffin",
      "SectionHeading",
      "Surface",
      "Pen",
      "Lift",
    ])
      expect(Object.keys(kit), gone).not.toContain(gone);
  });

  it.each([
    ["Button", buttonStyles, "variant", [...VARIANTS]],
    ["Button", buttonStyles, "size", ["sm", "md", "lg"]],
    ["Button", buttonStyles, "icon", ["true"]],
    ["Button", buttonStyles, "pressed", ["true", "worded"]],
    ["Card", cardStyles, "kind", ["soft", "float"]],
    ["Card", cardStyles, "pad", ["none", "md"]],
    ["Tag", tagStyles, "tone", ["neutral", "off", "ok", "glass"]],
    ["Segmented", segmentedStyles, "size", ["sm", "md", "lg"]],
    ["Segmented", segmentedStyles, "full", ["true"]],
    ["Tabs", tabsStyles, "vertical", ["true"]],
    ["Heading", headingStyles, "level", ["page", "section", "card"]],
    [
      "Notice",
      noticeStyles,
      "level",
      ["info", "warn", "yellow", "orange", "red", "water", "water-advice"],
    ],
    ["NoticeMark", noticeMarkStyles, "size", ["sm", "md"]],
    ["Wordmark", wordmarkStyles, "size", ["md", "lg"]],
    ["StarGlyphs", starGlyphsStyles, "tone", ["ink", "inverse", "magenta"]],
    ["Avatar", avatarStyles, "size", ["sm", "md", "lg"]],
    ["RatingTip", ratingTipStyles, "size", ["md", "sm"]],
  ] as const)("%s has %s: %j", (_, recipe, variant, values) => {
    const variants = (recipe as unknown as { variants: Record<string, object> })
      .variants;
    expect(Object.keys(variants[variant])).toEqual([...values]);
  });
});

describe("the flat kit's shapes", () => {
  it("every button is round-ended, in Inter, in sentence case", () => {
    for (const variant of FOUR) {
      const classes = words(buttonStyles({ variant }));
      for (const name of ["rounded-full", "font-body", "font-medium"])
        expect(classes, `${variant} ${name}`).toContain(name);
      expect(classes, variant).not.toContain("uppercase");
    }
  });

  it("is flat: no gradient and no raised shadow on any button", () => {
    for (const variant of VARIANTS)
      for (const pressed of [undefined, true] as const) {
        const classes = words(buttonStyles({ variant, pressed }));
        expect(
          classes.filter((c) =>
            /(^|:)(shadow-|bg-(linear|radial|gradient|none))|sheen|active:translate-y/.test(
              c,
            ),
          ),
          `${variant} ${pressed}`,
        ).toEqual([]);
      }
  });

  it.each([
    // The default: a hairline round the words, the ground inside.
    ["outline", ["border-line", "bg-ground"]],
    // The one filled control.
    ["primary", ["bg-accent", "text-accent-ink"]],
    // A grey fill, for a second action inside a card: the well, which is the
    // second grey there.
    ["soft", ["bg-well"]],
    // No edge: Reset, Clear, Skip, Close.
    ["quiet", ["border-transparent", "bg-transparent"]],
  ] as const)("%s is drawn in %j", (variant, names) => {
    const classes = words(buttonStyles({ variant }));
    for (const name of names) expect(classes, name).toContain(name);
  });

  it("only the outline and danger buttons draw an edge", () => {
    for (const variant of VARIANTS) {
      const edged = words(buttonStyles({ variant })).includes("border-line");
      expect(edged, variant).toBe(
        variant === "outline" || variant === "danger",
      );
    }
  });

  it("is 32, 40 and 48px tall, and an icon button is a circle as wide", () => {
    for (const size of ["sm", "md", "lg"] as const)
      expect(words(buttonStyles({ size }))).toContain(`h-control-${size}`);
    const css = build(["h-control-sm"]);
    expect(css).toMatch(/--spacing-control-sm: 32px;/);
    expect(css).toMatch(/--spacing-control-lg: 48px;/);
    for (const [size, width] of [
      ["sm", "w-control-sm"],
      ["md", "w-control-md"],
      ["lg", "w-control-lg"],
    ] as const) {
      const classes = words(buttonStyles({ icon: true, size }));
      for (const name of [width, "rounded-full", "p-0"])
        expect(classes, `${size} ${name}`).toContain(name);
      expect(classes.some((c) => /^px-/.test(c))).toBe(false);
    }
  });

  it("a chip is a soft capsule a press fills in ink", () => {
    const chip = words(chipStyles().base());
    for (const name of [
      "rounded-full",
      "bg-well",
      "font-body",
      "aria-pressed:bg-inverse",
      "aria-pressed:text-ink-inverse",
    ])
      expect(chip, name).toContain(name);
    expect(chip).toContain(RING.split(" ")[0]);
  });

  it("a tag is a small capsule, never in capitals, and only a glass one is glass", () => {
    const tag = words(tagStyles());
    for (const name of ["rounded-full", "font-body", "bg-well", "text-ink-2"])
      expect(tag, name).toContain(name);
    expect(tagStyles({ tone: "off" })).toContain("text-pen-ink");
    for (const [name, recipe] of Object.entries(RECIPES)) {
      const glass = classesOf(recipe as Recipe).some((c) => /glass/.test(c));
      expect(glass, name).toBe(name === "tagStyles");
    }
    expect(tagStyles({ tone: "glass" })).toContain("bg-glass");
  });

  it("a card is soft: a shade off the ground, a box's corner, no rule and no shadow", () => {
    const soft = words(cardStyles());
    for (const name of ["bg-sunken", "on-card", "rounded-surface", "p-5"])
      expect(soft, name).toContain(name);
    expect(soft.some((c) => /^(border|shadow-)/.test(c))).toBe(false);
    // Over the map it floats: the ground, the float shadow, a faint edge in dark.
    const float = words(cardStyles({ kind: "float" }));
    for (const name of [
      "bg-ground",
      "shadow-float",
      "dark:ring-1",
      "dark:ring-line",
    ])
      expect(float, name).toContain(name);
    expect(words(cardStyles({ pad: "none" })).some((c) => /^p-/.test(c))).toBe(
      false,
    );
  });

  it("the segmented control is a grey well, the chosen one lifted out of it", () => {
    const s = segmentedStyles();
    expect(words(s.base())).toContain("bg-well");
    expect(words(s.base())).toContain("rounded-full");
    for (const name of [
      "aria-pressed:bg-ground",
      "aria-pressed:text-ink",
      "aria-pressed:shadow-control",
    ])
      expect(words(s.item()), name).toContain(name);
    expect(words(segmentedStyles({ full: true }).base())).toContain("w-full");
    expect(words(segmentedStyles({ full: true }).item())).toContain("flex-1");
  });

  it("a field is filled: the soft grey, no rule, the label above in grey", () => {
    const box = words(controlStyles().box());
    for (const name of ["bg-well", "border-transparent", "rounded-control"])
      expect(box, name).toContain(name);
    expect(box).not.toContain("border-b");
    const field = fieldStyles();
    expect(words(field.label())).toContain("text-ink-2");
    expect(words(field.label())).toContain("font-body");
    expect(words(field.label())).not.toContain("uppercase");
    expect(words(field.hint())).toContain("text-ink-muted");
    expect(words(controlStyles().input())).toContain(
      "placeholder:text-ink-muted",
    );
  });

  it("a search is a soft grey pill, not a rule to write on", () => {
    const base = words(searchFieldStyles().base());
    for (const name of ["bg-well", "rounded-full", "border-transparent"])
      expect(base, name).toContain(name);
    expect(base).not.toContain("border-b");
    expect(base).not.toContain("bg-transparent");
  });

  it("a heading is Inter at three steps, never the display face, never ruled", () => {
    for (const level of ["page", "section", "card"] as const) {
      const s = headingStyles({ level });
      expect(words(s.title()), level).toContain("font-body");
      expect(s.base(), level).not.toMatch(/border/);
    }
    expect(words(headingStyles({ level: "page" }).title())).toEqual(
      expect.arrayContaining(["text-big", "max-wide:text-big-sm"]),
    );
    expect(words(headingStyles({ level: "section" }).title())).toContain(
      "text-lead",
    );
    expect(words(headingStyles({ level: "card" }).title())).toContain(
      "text-prose",
    );
  });

  it("rows stand in one soft card with a hairline between them", () => {
    const list = words(rowsStyles().list());
    for (const name of [
      "bg-sunken",
      "rounded-surface",
      "divide-y",
      "divide-line",
    ])
      expect(list, name).toContain(name);
    expect(words(rowsStyles().title())).toContain("font-semibold");
  });

  /*
   * A control fills with the well: the soft grey on the ground, the second
   * grey (raised) inside a soft card, which carries `on-card` to set it.
   * So a field, a chip or a segmented well never vanishes into its card.
   */
  it("every soft card sets the well, and every control fills from it", () => {
    for (const [name, classes] of [
      ["Card", cardStyles()],
      ["Rows", rowsStyles().list()],
      ["Notice", noticeStyles().base()],
    ] as const) {
      expect(words(classes), name).toContain("bg-sunken");
      expect(words(classes), name).toContain("on-card");
    }
    expect(words(cardStyles({ kind: "float" }))).not.toContain("on-card");
    for (const [name, classes] of [
      ["soft button", buttonStyles({ variant: "soft" })],
      ["chip", chipStyles().base()],
      ["tag", tagStyles()],
      ["segmented", segmentedStyles().base()],
      ["field", controlStyles().box()],
      ["search", searchFieldStyles().base()],
      ["number", numberFieldStyles().base()],
      ["empty's icon", emptyStyles().icon()],
    ] as const) {
      expect(words(classes), name).toContain("bg-well");
      expect(words(classes), name).not.toContain("bg-sunken");
    }
  });

  it("a switch is a flat track that fills in ink when on", () => {
    const s = switchStyles();
    for (const name of [
      "rounded-full",
      "bg-line-strong",
      "aria-checked:bg-inverse",
    ])
      expect(words(s.base()), name).toContain(name);
    expect(s.base()).not.toMatch(/gradient|sheen/);
    expect(words(s.thumb())).toContain(
      "group-aria-checked/switch:translate-x-4.5",
    );
  });

  it("the wordmark is Fraunces at its own step, .ie in magenta italic", () => {
    const base = words(wordmarkStyles().base());
    for (const name of [
      "font-display",
      "font-semibold",
      "optical-wordmark",
      "text-wordmark",
      "max-wide:text-wordmark-sm",
    ])
      expect(base, name).toContain(name);
    const domain = words(wordmarkStyles().domain());
    expect(domain).toContain("italic");
    expect(domain).toContain("text-chart-magenta");
  });

  it("MONO_LABEL is Inter at 12px now, with no capitals and no tracking", () => {
    expect(MONO_LABEL).toBe("font-mono text-eyebrow");
    const css = build(["font-mono"]);
    expect(css).toMatch(/--font-mono: "Inter Variable"/);
  });
});

describe("states", () => {
  it("every pressable control carries the one ring", () => {
    for (const variant of VARIANTS)
      expect(buttonStyles({ variant }), variant).toContain(RING);
    for (const [name, classes] of [
      ["link", linkStyles()],
      ["chip", chipStyles().base()],
      ["segmented", segmentedStyles().item()],
      ["tab", tabsStyles().tab()],
      ["switch", switchStyles().base()],
      ["number step", numberFieldStyles().step()],
      ["number value", numberFieldStyles().value()],
      ["row", rowsStyles().action()],
      ["rating tip", ratingTipStyles().trigger()],
      ["top bar's wordmark", topBarStyles().brand()],
    ] as const)
      expect(classes, name).toContain(RING);
  });

  // The slider is a native range: the theme draws its ring, the same one.
  it("the slider's native range wears the ring the theme draws", () => {
    const css = build(["range-kit"]).replace(/\s+/g, " ");
    expect(css).toMatch(
      /&:focus-visible \{ outline: 2px solid var\(--color-focus\); outline-offset: 2px;/,
    );
  });

  it("a field's box shows the focus, and the element inside draws none", () => {
    for (const kind of ["text", "area", "select"] as const) {
      const styles = controlStyles({ kind });
      for (const name of [
        "focus-within:border-ink",
        "focus-within:ring-3",
        "focus-within:ring-focus/20",
      ])
        expect(words(styles.box()), `${kind} ${name}`).toContain(name);
      expect(styles.input(), kind).toContain(NO_RING);
    }
    const search = searchFieldStyles();
    expect(words(search.base())).toContain("focus-within:ring-focus/20");
    expect(search.input()).toContain(NO_RING);
  });

  it("no recipe draws an outline of its own, and a ring only as an edge or the soft focus", () => {
    const outline = new Set([
      ...RING.split(" "),
      ...RING_WITHIN.split(" "),
      NO_RING,
      "focus-visible:-outline-offset-2",
    ]);
    const rings = new Set([
      "ring-1",
      "ring-line",
      "max-wide:ring-0",
      "dark:ring-1",
      "dark:ring-line",
      "focus-within:ring-3",
      "focus-within:ring-focus/20",
    ]);
    for (const [name, recipe] of Object.entries(RECIPES))
      for (const c of classesOf(recipe as Recipe)) {
        if (/(^|:)-?outline-/.test(c))
          expect(outline.has(c), `${name}: ${c}`).toBe(true);
        if (/(^|:)ring-/.test(c))
          expect(rings.has(c), `${name}: ${c}`).toBe(true);
      }
  });

  it("pressed is filled in ink, not only recoloured", () => {
    const pressed = words(buttonStyles({ pressed: true }));
    for (const name of ["bg-inverse", "text-ink-inverse"])
      expect(pressed).toContain(name);
    expect(pressed).not.toContain("bg-ground");
  });

  /*
   * The one exception, and it is not a hole: a toggle whose label changes with
   * it — Save becomes Saved, its heart filled in — has said so in words and in
   * a mark before the box is asked. Filling it as well would put a second
   * filled control on a view that is allowed one.
   */
  it("a worded toggle keeps its own box, and still says pressed", () => {
    expect(buttonStyles({ pressed: "worded" })).toBe(buttonStyles());
    expect(html(<Button pressed="worded">Saved</Button>)).toContain(
      'aria-pressed="true"',
    );
  });

  it("hover and disabled are written for every button", () => {
    for (const variant of VARIANTS) {
      const classes = buttonStyles({ variant });
      expect(classes, variant).toMatch(/not-disabled:hover:/);
      expect(classes, variant).toContain("disabled:cursor-default");
      expect(classes, variant).toContain("disabled:opacity-40");
    }
  });

  /*
   * The reset's `button:enabled:hover` lays a wash behind anything that does
   * not name a background of its own, so every variant names one, including
   * `link`, whose answer is "none".
   */
  it.each([
    ["outline", "not-disabled:hover:bg-well"],
    ["primary", "not-disabled:hover:bg-accent"],
    ["soft", "not-disabled:hover:bg-line"],
    ["quiet", "not-disabled:hover:bg-well"],
    ["link", "not-disabled:hover:bg-transparent"],
    ["danger", "not-disabled:hover:bg-warn-ground"],
  ] as const)("%s names the background its hover has", (variant, name) => {
    expect(words(buttonStyles({ variant }))).toContain(name);
  });

  // The epic's tap-target rule: 44px on a touch device, whatever the size.
  it("every control is a touch target under pointer: coarse", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      expect(words(buttonStyles({ size })), size).toContain(
        "pointer-coarse:min-h-touch",
      );
      const icon = words(buttonStyles({ icon: true, size }));
      expect(icon, size).toContain("pointer-coarse:min-h-touch");
      expect(icon, size).toContain("pointer-coarse:min-w-touch");
    }
    for (const size of ["md", "lg"] as const)
      expect(words(searchFieldStyles({ size }).base()), size).toContain(
        "pointer-coarse:min-h-touch",
      );
    expect(words(chipStyles().base())).toContain("pointer-coarse:min-h-touch");
    expect(words(numberFieldStyles().step())).toContain(
      "pointer-coarse:size-11",
    );
    // A switch is smaller than a thumb: a band laid over it reaches touch.
    expect(words(switchStyles().base())).toEqual(
      expect.arrayContaining([
        "pointer-coarse:before:absolute",
        "pointer-coarse:before:-inset-y-2.25",
      ]),
    );
    for (const kind of ["text", "area", "select"] as const)
      expect(words(controlStyles({ kind }).box()), kind).toContain("min-h-11");
    expect(words(checkboxStyles().base())).toContain("min-h-touch");
    expect(words(rowsStyles().row())).toContain("min-h-14");
    // A link in running text has no box of its own to make taller...
    const link = words(buttonStyles({ variant: "link" }));
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

  it("holds still for a reader who asked for less motion", () => {
    for (const [name, classes] of [
      ["switch", switchStyles().base()],
      ["switch thumb", switchStyles().thumb()],
      ["notice chevron", noticeStyles().chevron()],
      ["dialog", dialogStyles().base()],
      ["skeleton", skeletonStyles()],
    ] as const)
      expect(classes, name).toMatch(/motion-reduce:(transition|animate)-none/);
  });
});

describe("one filled control", () => {
  it("the accent fill is written once in the kit: Button primary", () => {
    const holders = Object.entries(RECIPES)
      .filter(([, recipe]) => classesOf(recipe as Recipe).includes("bg-accent"))
      .map(([name]) => name);
    expect(holders).toEqual(["buttonStyles"]);
    for (const variant of VARIANTS.filter((v) => v !== "primary"))
      expect(words(buttonStyles({ variant })), variant).not.toContain(
        "bg-accent",
      );
  });

  it("danger is the outline in the pen's red, and fills nothing", () => {
    const danger = words(buttonStyles({ variant: "danger" }));
    for (const name of ["border-line", "bg-ground", "text-pen-ink"])
      expect(danger).toContain(name);
    expect(danger).not.toContain("bg-warn");
  });

  it("danger is used by ConfirmDialog and by nothing else in the kit", () => {
    const users = sources.filter(
      (file) => file !== "Gallery.tsx" && /variant="danger"/.test(read(file)),
    );
    expect(users).toEqual(["ConfirmDialog.tsx"]);
  });

  it("no other control is drawn in the accent", () => {
    expect(checkboxStyles().input()).toContain("accent-inverse");
    expect(checkboxStyles().input()).not.toContain("accent-accent");
    for (const recipe of [
      switchStyles,
      chipStyles,
      segmentedStyles,
      tabsStyles,
    ])
      expect(
        JSON.stringify(classesOf(recipe as unknown as Recipe)),
      ).not.toMatch(/bg-accent/);
  });
});

describe("fields on a touch device", () => {
  it("take the input step, 16px, under pointer: coarse", () => {
    for (const input of [
      controlStyles().input(),
      searchFieldStyles().input(),
      spotSearchStyles().input(),
    ])
      expect(words(input)).toContain("pointer-coarse:text-input");
    for (const input of [
      controlStyles().input(),
      searchFieldStyles().input(),
    ]) {
      expect(input).toContain("text-prose");
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

describe("Dialog", () => {
  it("is a native dialog, named by its Inter title", () => {
    const markup = html(
      <Dialog open title="Find a spot" onClose={() => {}}>
        Body
      </Dialog>,
    );
    expect(markup).toMatch(/^<dialog /);
    const [, id] = markup.match(/aria-labelledby="([^"]+)"/)!;
    const title = markup.match(new RegExp(`<h2 class="([^"]+)" id="${id}">`));
    expect(title).not.toBeNull();
    expect(words(title![1])).toEqual(
      expect.arrayContaining(["font-body", "text-lead"]),
    );
    expect(title![1]).not.toContain("font-display");
    expect(markup).toContain('aria-label="Close"');
  });

  it("has no frame and no rule under the title; a hairline above the actions only", () => {
    const s = dialogStyles();
    const base = words(s.base());
    expect(base).toContain("border-0");
    expect(base.some((c) => /border-ink|inset-shadow|paper/.test(c))).toBe(
      false,
    );
    // In dark a faint edge, so it separates from the dimmed page.
    expect(base).toEqual(
      expect.arrayContaining(["dark:ring-1", "dark:ring-line"]),
    );
    expect(s.head()).not.toMatch(/border/);
    expect(words(s.actions())).toEqual(
      expect.arrayContaining(["border-t", "border-line"]),
    );
  });

  it("the close button is quiet, with no ring until the keyboard comes", () => {
    const markup = html(
      <Dialog open title="Find a spot" onClose={() => {}}>
        Body
      </Dialog>,
    );
    const close = markup.match(/<button [^>]*aria-label="Close"[^>]*>/)![0];
    expect(close).toContain(
      buttonStyles({ variant: "quiet", icon: true }).split(" ")[0],
    );
    expect(close).not.toContain("border-line");
  });

  // One component, two shapes: under 640px a sheet from the foot of the
  // screen, the whole width, round at the top only, a grabber over its head,
  // and the actions full width within a thumb's reach.
  it("becomes a sheet under 640px", () => {
    const s = dialogStyles();
    for (const name of [
      "max-sm:mb-0",
      "max-sm:w-full",
      "max-sm:max-w-none",
      "max-sm:rounded-b-none",
      "max-sm:open:animate-sheet-in",
    ])
      expect(words(s.base()), name).toContain(name);
    expect(words(s.grabber())).toEqual(
      expect.arrayContaining(["hidden", "max-sm:block"]),
    );
    expect(words(s.actions())).toEqual(
      expect.arrayContaining(["max-sm:*:flex-1", "max-sm:*:h-12"]),
    );
    const css = build(["max-sm:w-full"]);
    expect(css).toMatch(/@media \(width < 40rem\)/);
    const markup = html(
      <Dialog open title="Find a spot" onClose={() => {}}>
        Body
      </Dialog>,
    );
    expect(markup).toMatch(
      /<span class="[^"]*max-sm:block[^"]*" aria-hidden="true"><\/span>/,
    );
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
    const base = words(dialogStyles().base());
    expect(base).toContain("open:flex");
    for (const name of ["grid", "flex", "block"])
      expect(base).not.toContain(name);
  });

  it("has the shared backdrop: a dim wash over a 6px blur, fading in and out", () => {
    const base = words(dialogStyles().base());
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
    expect(buttons[1][0]).toContain("text-pen-ink");
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

describe("an icon-only control needs a name", () => {
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

  it("SearchField needs one too", () => {
    // @ts-expect-error a search field has no visible label
    const unnamed = <SearchField />;
    expect(unnamed).toBeTruthy();
    const markup = html(<SearchField aria-label="Search threads" busy />);
    expect(markup).toContain('type="search"');
    expect(markup).toContain('aria-label="Search threads"');
    expect(markup).toContain('aria-busy="true"');
  });

  it("so do the segmented control, the tabs and the number field", () => {
    const noop = () => {};
    // @ts-expect-error a segmented control names what is chosen
    const seg = <Segmented options={[]} value="a" onChange={noop} />;
    // @ts-expect-error a tab list is named
    const tabs = <Tabs tabs={[]} value="a" onChange={noop} />;
    // @ts-expect-error a number field says what the number is
    const num = <NumberField value={1} min={0} max={2} onChange={noop} />;
    expect([seg, tabs, num]).toHaveLength(3);
  });
});

describe("the gallery is for development only", () => {
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

  it("draws nothing of the old kit", () => {
    const gallery = read("Gallery.tsx");
    for (const gone of [
      "Masthead",
      "Headline",
      "Kicker",
      "Puffin",
      "Pane",
      "Surface",
      "SectionHeading",
      "paper-grain",
      "inset-shadow-frame",
      "border-double",
    ])
      expect(gallery, gone).not.toContain(gone);
    // Fraunces once, for a spot's name beside the wordmark in the type scale.
    const display = gallery.match(/className="[^"]*font-display[^"]*"/g) ?? [];
    expect(display).toHaveLength(1);
    expect(display[0]).toContain("text-name");
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

  // A chip is pressed; a tag is a word that cannot be.
  it("Chip is a button that says pressed; Tag is a span that cannot be pressed", () => {
    const on = html(<Chip pressed>4+ stars</Chip>);
    expect(on).toMatch(/^<button type="button" /);
    expect(on).toContain('aria-pressed="true"');
    expect(html(<Chip pressed={false}>Any stars</Chip>)).toContain(
      'aria-pressed="false"',
    );
    // A filter in use is not a toggle: a press takes it away, and it says so.
    const removable = html(<Chip removable>4+ stars</Chip>);
    expect(removable).not.toContain('aria-pressed="');
    expect(removable).toMatch(/<svg [^>]*aria-hidden="true"/);
    const tag = html(<Tag tone="off">Offshore</Tag>);
    expect(tag).toMatch(/^<span class="[^"]*">Offshore<\/span>$/);
    expect(tag).not.toMatch(/aria-pressed="|role=|tabindex|<button/);
  });

  it("Card passes its attributes through", () => {
    expect(html(<Card id="c" role="region" />)).toMatch(
      /^<div id="c" role="region" class="[^"]*bg-sunken/,
    );
    expect(html(<Card kind="float" />)).toContain("shadow-float");
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

  it("Heading is a heading at its level's tag, or the one asked for", () => {
    expect(html(<Heading level="page">How the stars work</Heading>)).toMatch(
      /<h1 class="[^"]*">How the stars work<\/h1>/,
    );
    expect(html(<Heading>The week</Heading>)).toMatch(/<h2 class="/);
    expect(html(<Heading level="card">Launch</Heading>)).toMatch(/<h3 class="/);
    expect(
      html(
        <Heading level="section" as="h3">
          Dublin
        </Heading>,
      ),
    ).toMatch(/<h3 class="[^"]*text-lead/);
    const page = html(
      <Heading
        level="page"
        id="t"
        lead="We rate every daylight hour."
        aside={<span>149</span>}
      >
        How the stars work
      </Heading>,
    );
    expect(page).toContain('id="t"');
    // The heading, then what is set right on its line, then the lead under it.
    expect(page).toMatch(
      /<\/h1><div class="[^"]*"><span>149<\/span><\/div><\/div><p class="[^"]*">We rate/,
    );
  });

  it("Rows is a list in a card; a Row is a link, a button or a plain row", () => {
    const list = html(
      <Rows>
        <Row
          inList
          href="/spot/dollymount"
          title="Dollymount"
          detail="Dublin"
          chevron
        />
        <Row inList onClick={() => {}} title="Clear the stars" />
        <Row inList title="Cross-offshore" end="1 star off" />
      </Rows>,
    );
    expect(list).toMatch(/^<ul class="[^"]*bg-sunken/);
    expect(list.match(/<li>/g)).toHaveLength(3);
    expect(list).toMatch(
      /<li><a href="\/spot\/dollymount" class="[^"]*cursor-pointer/,
    );
    expect(list).toMatch(
      /<li><button type="button" class="[^"]*cursor-pointer/,
    );
    expect(list).toMatch(/<li><div class="[^"]*">.*Cross-offshore/);
    // The chevron says "opens a page" and is not read.
    expect(list).toMatch(
      /Dublin<\/span><\/span><span class="[^"]*"><svg [^>]*aria-hidden="true"/,
    );
    expect(html(<Rows as="div" />)).toMatch(/^<div /);
    expect(html(<Row title="UKV" dim />)).toContain("text-ink-muted");
  });

  it("Notice says its level with its square and in its title, not a capital chip", () => {
    for (const level of [
      "info",
      "warn",
      "yellow",
      "orange",
      "red",
      "water",
      "water-advice",
    ] as const) {
      const markup = html(<Notice level={level} title={`${level} title`} />);
      expect(markup, level).toContain(`data-level="${level}"`);
      // The square: the level's colour and its sign, hidden from a reader.
      const square = markup.match(
        /<span class="([^"]+)" aria-hidden="true"><svg/,
      );
      expect(square, level).not.toBeNull();
      expect(square![1]).toBe(noticeStyles({ level }).mark());
      expect(markup).not.toMatch(/uppercase|border-l/);
    }
    expect(noticeStyles({ level: "orange" }).mark()).toContain("bg-met-orange");
    expect(noticeStyles({ level: "yellow" }).mark()).toContain("bg-met-yellow");
    expect(noticeStyles({ level: "red" }).mark()).toContain("bg-met-red");
    expect(noticeStyles({ level: "water" }).mark()).toContain("bg-warn-ground");
    // The plain and the advice squares: the second grey, in sight on the card.
    expect(noticeStyles({ level: "info" }).mark()).toContain("bg-raised");
    expect(noticeStyles({ level: "water-advice" }).mark()).toContain(
      "bg-raised",
    );
    expect(noticeMarkStyles({ level: "info" }).square()).toContain("bg-raised");
  });

  it("Notice interrupts only when asked, and has a second line and an action", () => {
    const warning = html(
      <Notice level="orange" title="Orange wind warning for Kerry">
        Mon 14 Sept, 13:00 to 16:00
      </Notice>,
    );
    expect(warning).not.toContain('role="alert"');
    expect(warning).toContain("Mon 14 Sept, 13:00 to 16:00");
    const failed = html(
      <Notice
        alert
        title="The forecast could not be read just now"
        action={<Button size="sm">Try again</Button>}
      >
        Failed to fetch.
      </Notice>,
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain(">Try again</button>");
    // An action takes the chevron's place.
    expect(failed).not.toContain('aria-label="Details"');
  });

  it("Notice's details open and close under a chevron that says so", () => {
    const view = mount(
      <Notice
        level="yellow"
        title="Yellow small craft warning"
        details="Force 6 at times."
      >
        Stars still shown
      </Notice>,
    );
    const toggle = () =>
      view.one(
        (n) => n.type === "button" && n.props["aria-label"] === "Details",
      );
    const details = () =>
      view.one((n) => n.props.id === toggle().props["aria-controls"]);
    expect(toggle().props["aria-expanded"]).toBe(false);
    expect(details().props.hidden).toBe(true);
    expect(text(details())).toBe("Force 6 at times.");
    view.fire(toggle(), "onClick");
    expect(toggle().props["aria-expanded"]).toBe(true);
    expect(details().props.hidden).toBe(false);
    view.fire(toggle(), "onClick");
    expect(toggle().props["aria-expanded"]).toBe(false);
    expect(html(<Notice title="x" details="y" defaultOpen />)).toContain(
      'aria-expanded="true"',
    );
    // A chevron named for what it opens, where a page has several.
    expect(
      html(
        <Notice
          title="x"
          details="y"
          detailsLabel="Details of the orange warning"
        />,
      ),
    ).toContain('aria-label="Details of the orange warning"');
    // No details, no chevron.
    expect(html(<Notice title="x" />)).not.toContain("aria-expanded");
  });

  it("NoticeMark is the level's small square and a word beside it", () => {
    const mark = html(<NoticeMark level="water">Water</NoticeMark>);
    expect(mark).toContain('data-notice-mark="water"');
    expect(mark).toMatch(
      /<span class="[^"]*rounded-mark[^"]*" aria-hidden="true"><svg/,
    );
    expect(mark).toMatch(/<\/span>Water<\/span>$/);
    expect(noticeMarkStyles({ level: "orange" }).square()).toContain(
      "bg-met-orange",
    );
    expect(noticeMarkStyles({ level: "red", size: "md" }).square()).toContain(
      "size-7",
    );
  });

  it("Empty has no frame: a round icon, an Inter title, a line, two buttons", () => {
    const markup = html(
      <Empty
        title="No riding place at this address"
        actions={<Button variant="primary">Dollymount</Button>}
      >
        Did you mean Dollymount?
      </Empty>,
    );
    expect(markup).toMatch(
      /<h2 class="[^"]*font-body[^"]*">No riding place at this address<\/h2>/,
    );
    expect(markup).toContain("Did you mean Dollymount?");
    expect(markup).toContain(">Dollymount</button>");
    const s = emptyStyles();
    expect(s.base()).not.toMatch(/border|shadow|bg-|rounded/);
    expect(words(s.icon())).toEqual(
      expect.arrayContaining(["rounded-full", "bg-well"]),
    );
    expect(s.title()).not.toMatch(/italic|font-display/);
    expect(html(<Empty title="Not found" as="h1" />)).toMatch(/<h1 class="/);
    expect(html(<Empty title="Nothing here" as="p" />)).toMatch(/<p class="/);
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

  it("Field names its control, hints under it and says what is wrong", () => {
    const ok = html(
      <Field label="Title" hint="Optional" htmlFor="t">
        <TextInput id="t" />
      </Field>,
    );
    expect(ok).toContain('<label class="');
    expect(ok).toContain('for="t"');
    expect(ok.indexOf("<label")).toBeLessThan(ok.indexOf("<input"));
    expect(ok.indexOf("<input")).toBeLessThan(ok.indexOf("Optional"));
    expect(ok).not.toContain("data-invalid=");
    expect(ok).not.toContain('role="alert"');
    const wrong = html(
      <Field label="Title" error="Give it a title" htmlFor="t">
        <TextInput id="t" />
      </Field>,
    );
    expect(wrong).toContain('data-invalid=""');
    expect(wrong).toMatch(/role="alert">Give it a title</);
    expect(words(controlStyles().box())).toEqual(
      expect.arrayContaining([
        "group-data-invalid/field:border-warn",
        "group-data-invalid/field:bg-warn-ground",
      ]),
    );
  });

  it("TextInput, TextArea and Select keep the native element", () => {
    const input = html(<TextInput prefix="€" active placeholder="0" />);
    expect(input).toContain("€");
    expect(input).toContain("border-ink");
    expect(input).toMatch(/<input [^>]*placeholder="0"/);
    expect(html(<TextArea rows={4} />)).toMatch(/<textarea [^>]*rows="4"/);
    expect(words(controlStyles({ kind: "area" }).input())).toContain(
      "min-h-34.5",
    );
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
   * the accent. The whole row is the label, and the label is part of the target.
   */
  it("Checkbox is a native box, named, and says disabled through the row", () => {
    const markup = html(
      <Checkbox checked readOnly>
        Buyers can message this number
      </Checkbox>,
    );
    expect(markup).toMatch(/^<label /);
    expect(markup).toMatch(/<input [^>]*type="checkbox"/);
    expect(markup).toContain("Buyers can message this number");
    expect(checkboxStyles().input()).toContain(RING);
    expect(html(<Checkbox disabled>x</Checkbox>)).toMatch(
      /<input [^>]*disabled=""/,
    );
    expect(checkboxStyles().base()).toContain("has-disabled:text-ink-disabled");
  });

  it("Segmented is a named group with exactly one pressed, and a press moves it", () => {
    const options = [
      { value: "kn", label: "Knots" },
      { value: "ms", label: "m/s" },
      { value: "force", label: "Force", disabled: true },
    ] as const;
    const markup = html(
      <Segmented
        aria-label="Wind in"
        value="ms"
        onChange={() => {}}
        options={options}
      />,
    );
    expect(markup).toMatch(/^<div role="group" aria-label="Wind in"/);
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup).toMatch(/aria-pressed="true"[^>]*>m\/s</);
    expect(markup).toMatch(/disabled=""[^>]*>Force</);

    let value: string = "kn";
    const view = mount(
      <Segmented
        aria-label="Wind in"
        value={value}
        onChange={(v) => (value = v)}
        options={options}
      />,
    );
    const knots = view.one((n) => n.type === "button" && text(n) === "Knots");
    expect(knots.props["aria-pressed"]).toBe(true);
    view.fire(
      view.one((n) => n.type === "button" && text(n) === "m/s"),
      "onClick",
    );
    expect(value).toBe("ms");
  });

  it("Skeleton and Link", () => {
    expect(html(<Skeleton shape="block" />)).toContain('aria-hidden="true"');
    expect(html(<Skeleton />)).toContain("motion-reduce:animate-none");
    expect(html(<Link href="/market">Gear</Link>)).toContain("underline");
    expect(html(<Link href="/market" plain />)).toContain("no-underline");
  });
});

describe("the new controls, pressed and keyed", () => {
  const TABS = [
    { value: "key", label: "The map’s key" },
    { value: "stars", label: "Stars" },
    { value: "wind", label: "Wind and gusts" },
  ] as const;

  /** Tabs held in a little state of their own, as a page would hold them. */
  function tabs(vertical = false) {
    let value: string = "key";
    const changes: string[] = [];
    const view = mount(
      <Tabs
        aria-label="About the map"
        tabs={TABS}
        value={value}
        vertical={vertical}
        onChange={(v) => {
          value = v;
          changes.push(v);
        }}
      />,
    );
    const rerender = () =>
      view.update(
        <Tabs
          aria-label="About the map"
          tabs={TABS}
          value={value}
          vertical={vertical}
          onChange={(v) => {
            value = v;
            changes.push(v);
          }}
        />,
      );
    return {
      view,
      changes,
      rerender,
      get value() {
        return value;
      },
    };
  }

  it("Tabs is a tab list with one tab selected and in the tab order", () => {
    const { view } = tabs();
    const list = view.one((n) => n.props.role === "tablist");
    expect(list.props["aria-label"]).toBe("About the map");
    expect(list.props["aria-orientation"]).toBe("horizontal");
    const all = view.byRole("tab");
    expect(all.map((t) => t.props["aria-selected"])).toEqual([
      true,
      false,
      false,
    ]);
    expect(all.map((t) => t.props.tabIndex)).toEqual([0, -1, -1]);
  });

  it("Tabs moves with the arrow keys, wraps, and goes to the ends with Home and End", () => {
    const t = tabs();
    const list = () => t.view.one((n) => n.props.role === "tablist");
    const focusedText = () => text(t.view.focused()!);
    t.view.key(list(), "ArrowRight");
    expect(t.value).toBe("stars");
    t.rerender();
    expect(focusedText()).toBe("Stars");
    expect(t.view.byRole("tab")[1].props["aria-selected"]).toBe(true);
    t.view.key(list(), "ArrowLeft");
    t.rerender();
    t.view.key(list(), "ArrowLeft");
    expect(t.value).toBe("wind");
    t.rerender();
    t.view.key(list(), "Home");
    expect(t.value).toBe("key");
    t.rerender();
    t.view.key(list(), "End");
    expect(t.value).toBe("wind");
    // Down does nothing across; Up and Down are a column's.
    t.rerender();
    t.view.key(list(), "ArrowDown");
    expect(t.value).toBe("wind");
  });

  it("Tabs down the side moves with Up and Down", () => {
    const t = tabs(true);
    const list = () => t.view.one((n) => n.props.role === "tablist");
    expect(list().props["aria-orientation"]).toBe("vertical");
    t.view.key(list(), "ArrowDown");
    expect(t.value).toBe("stars");
    t.rerender();
    t.view.key(list(), "ArrowRight");
    expect(t.value).toBe("stars");
    expect(words(tabsStyles({ vertical: true }).base())).toContain("flex-col");
  });

  it("Switch is a switch that says on or off, and a press turns it over", () => {
    let on = false;
    const draw = () => (
      <Switch checked={on} onChange={(v) => (on = v)} aria-label="Live wind" />
    );
    const view = mount(draw());
    const sw = () => view.one((n) => n.props.role === "switch");
    expect(sw().type).toBe("button");
    expect(sw().props["aria-checked"]).toBe(false);
    expect(sw().props["aria-label"]).toBe("Live wind");
    view.fire(sw(), "onClick");
    expect(on).toBe(true);
    view.update(draw());
    expect(sw().props["aria-checked"]).toBe(true);
    view.fire(sw(), "onClick");
    expect(on).toBe(false);
    expect(
      html(<Switch checked onChange={() => {}} aria-label="x" disabled />),
    ).toMatch(/role="switch" aria-checked="true"/);
  });

  it("Slider is the native range, with its value and unit beside it", () => {
    const markup = html(
      <Slider
        value={35}
        min={10}
        max={50}
        unit="kn"
        onChange={() => {}}
        aria-label="Too strong in gusts above"
      />,
    );
    expect(markup).toMatch(
      /<input [^>]*type="range"[^>]*min="10" max="50"[^>]*value="35"/,
    );
    expect(markup).toContain('aria-label="Too strong in gusts above"');
    expect(markup).toContain("--range-fill:62.5%");
    // The figure beside it is for the eye; the range says its own value.
    expect(markup).toMatch(
      /<span class="[^"]*" aria-hidden="true">35<small class="[^"]*">kn<\/small><\/span>/,
    );
    let value = 35;
    const view = mount(
      <Slider
        value={value}
        min={10}
        max={50}
        onChange={(v) => (value = v)}
        aria-label="x"
      />,
    );
    view.type(
      view.one((n) => n.type === "input"),
      "40",
    );
    expect(value).toBe(40);
  });

  it("NumberField is a spin button the keys step, held inside its bounds", () => {
    let value = 80;
    const draw = () => (
      <NumberField
        aria-label="Weight"
        value={value}
        min={40}
        max={120}
        step={5}
        unit="kg"
        less="Lighter"
        more="Heavier"
        onChange={(v) => (value = v)}
      />
    );
    const view = mount(draw());
    const spin = () => view.one((n) => n.props.role === "spinbutton");
    expect(spin().props).toMatchObject({
      "aria-label": "Weight",
      "aria-valuenow": 80,
      "aria-valuemin": 40,
      "aria-valuemax": 120,
      tabIndex: 0,
    });
    const step = (key: string) => {
      view.key(spin(), key);
      view.update(draw());
    };
    step("ArrowUp");
    expect(value).toBe(85);
    step("ArrowDown");
    step("ArrowLeft");
    expect(value).toBe(75);
    step("End");
    expect(value).toBe(120);
    expect(spin().props["aria-valuenow"]).toBe(120);
    step("ArrowUp");
    expect(value).toBe(120);
    step("Home");
    expect(value).toBe(40);
    step("ArrowDown");
    expect(value).toBe(40);
    // The steps: named, and the one at a bound is disabled.
    const button = (name: string) =>
      view.one((n) => n.type === "button" && n.props["aria-label"] === name);
    expect(button("Lighter").props.disabled).toBe(true);
    expect(button("Heavier").props.disabled).toBe(false);
    view.fire(button("Heavier"), "onClick");
    expect(value).toBe(45);
    // A key it does not use is left to the page.
    let prevented = false;
    view.fire(spin(), "onKeyDown", {
      key: "Tab",
      preventDefault: () => (prevented = true),
    });
    expect(prevented).toBe(false);
  });
});

describe("TopBar", () => {
  const bar = (props: Partial<Parameters<typeof TopBar>[0]> = {}) =>
    html(
      <TopBar
        search={<input data-part="search" aria-label="Search spots" />}
        actions={<button data-part="actions">Sell</button>}
        view={{ to: "chart", href: "/chart" }}
        menu={<button data-part="menu">Menu</button>}
        {...props}
      />,
    );

  it("is a banner: the wordmark home, search, a section's actions, the other view, theme, menu", () => {
    const markup = bar();
    expect(markup).toMatch(/^<header class="[^"]*" data-top-bar="true">/);
    const order = [
      'aria-label="wingfoil.ie, the Spot finder"',
      'data-part="search"',
      'data-part="actions"',
      'data-view-switch="chart"',
      "data-theme-button",
      'data-part="menu"',
    ].map((part) => markup.indexOf(part));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(markup).toMatch(/<a href="\/"[^>]*><span class="[^"]*font-display/);
    expect(markup).toMatch(
      /data-view-switch="chart"[^>]*>.*<span>Chart<\/span><\/a>/,
    );
  });

  it("names the other view, leaves out what it is not given, and is one hairline under", () => {
    expect(bar({ view: { to: "spots", href: "/" } })).toContain(
      "<span>Spots</span>",
    );
    const bare = bar({
      search: undefined,
      actions: undefined,
      view: undefined,
      theme: false,
    });
    expect(bare).not.toMatch(
      /data-part="search"|data-part="actions"|data-view-switch|data-theme-button/,
    );
    expect(bare).toContain('data-part="menu"');
    const base = words(topBarStyles().base());
    expect(base).toEqual(
      expect.arrayContaining([
        "border-b",
        "border-line",
        "h-16",
        "max-wide:h-14",
      ]),
    );
    expect(base.some((c) => /border-(ink|double)|border-b-\d/.test(c))).toBe(
      false,
    );
  });

  it("on a phone moves light or dark into the menu", () => {
    expect(words(topBarStyles().theme())).toContain("max-wide:hidden");
    expect(words(topBarStyles().menu())).toContain("max-wide:order-3");
  });
});

describe("the chart's own primitives", () => {
  it("Wordmark is the name in words, with .ie in magenta italic", () => {
    const markup = html(<Wordmark />);
    expect(markup).toMatch(
      />wingfoil<span class="[^"]*text-chart-magenta[^"]*">\.ie<\/span><\/span>$/,
    );
    expect(html(<Wordmark size="lg" />)).toContain("text-title");
  });

  it("Figure puts the number first, the gust raised and the unit small", () => {
    const markup = html(<Figure value={14} sup={22} unit="kn" />);
    expect(markup.indexOf(">14<")).toBeLessThan(markup.indexOf(">22<"));
    expect(markup.indexOf(">22<")).toBeLessThan(markup.indexOf(">kn<"));
    expect(words(figureStyles().base())).toContain("tabular-nums");
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
    const narrow = html(
      <StarGlyphs stars={2} potential={2} slots="potential" />,
    );
    expect(narrow.match(/<path/g)).toHaveLength(2);
    expect(narrow).not.toContain("<circle");
  });

  it("StarGlyphs coloured fills the earned in their own colour and outlines the rest", () => {
    const three = html(<StarGlyphs stars={3} potential={5} coloured />);
    expect(three).toContain('aria-label="3 of 5 stars"');
    expect(three.match(/<path/g)).toHaveLength(5);
    expect(three.match(/fill-stars-3/g)).toHaveLength(3);
    expect(three).not.toContain("<circle");
    expect(three.match(/fill-none/g)).toHaveLength(2);
    expect(
      html(<StarGlyphs stars={5} coloured />).match(/fill-stars-5/g),
    ).toHaveLength(5);
    const none = html(<StarGlyphs stars={0} coloured />);
    expect(none).not.toMatch(/fill-stars-/);
    expect(none.match(/stroke-ink\/25/g)).toHaveLength(5);
    expect(html(<StarGlyphs stars={null} coloured />)).not.toContain("<path");
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
});
