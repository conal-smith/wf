import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { avatarStyles } from "./Avatar";
import { buttonStyles } from "./Button";
import { chipStyles } from "./Chip";
import { controlStyles } from "./control";
import { countStyles } from "./Count";
import { dialogStyles, syncModal } from "./Dialog";
import { emptyStyles } from "./Empty";
import { fieldStyles } from "./Field";
import * as kit from "./index";
import { linkStyles } from "./Link";
import { noticeStyles } from "./Notice";
import { pagerStyles } from "./Pager";
import { paneStyles } from "./Pane";
import { searchFieldStyles } from "./SearchField";
import { segmentedStyles } from "./Segmented";
import { skeletonStyles } from "./Skeleton";
import { surfaceStyles } from "./Surface";
import { UI, compileTheme, selector } from "./theme.testkit";
import { RING, RING_WITHIN } from "./tv";

const {
  Avatar,
  Button,
  Chip,
  ConfirmDialog,
  Count,
  Dialog,
  Empty,
  Field,
  Link,
  Notice,
  Pager,
  Pane,
  SearchField,
  Segmented,
  Select,
  Skeleton,
  Surface,
  TextArea,
  TextInput,
  initials,
} = kit;

const RECIPES = {
  avatarStyles,
  buttonStyles,
  chipStyles,
  controlStyles,
  countStyles,
  dialogStyles,
  emptyStyles,
  fieldStyles,
  linkStyles,
  noticeStyles,
  pagerStyles,
  paneStyles,
  searchFieldStyles,
  segmentedStyles,
  skeletonStyles,
  surfaceStyles,
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
        expect(css, name).toContain(selector(name));
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

  it("imports nothing from design/, and no stylesheet", () => {
    for (const file of sources) {
      expect(read(file), file).not.toMatch(/from\s+["'][^"']*design\//);
      expect(read(file), file).not.toMatch(/import\s+["'][^"']+\.css["']/);
    }
  });
});

describe("S2: what ui/ exports", () => {
  it("is the nineteen components, by name", () => {
    const components = Object.keys(kit).filter((name) => /^[A-Z]/.test(name));
    expect(components.sort()).toEqual(
      [
        "Avatar",
        "Button",
        "Chip",
        "ConfirmDialog",
        "Count",
        "Dialog",
        "Empty",
        "Field",
        "Link",
        "Notice",
        "Pager",
        "Pane",
        "SearchField",
        "Segmented",
        "Select",
        "Skeleton",
        "Surface",
        "TextArea",
        "TextInput",
      ].sort(),
    );
  });

  it.each([
    [
      "Button",
      buttonStyles,
      "variant",
      ["quiet", "primary", "pill", "link", "danger"],
    ],
    ["Button", buttonStyles, "size", ["sm", "md", "lg"]],
    ["Button", buttonStyles, "icon", ["true"]],
    ["Button", buttonStyles, "pressed", ["true"]],
    ["Chip", chipStyles, "tone", ["neutral", "warn"]],
    ["Chip", chipStyles, "eyebrow", ["true"]],
    ["Pane", paneStyles, "kind", ["card", "sunken"]],
    ["Avatar", avatarStyles, "size", ["sm", "md", "lg"]],
  ] as const)("%s has %s: %j", (_, recipe, variant, values) => {
    const variants = (recipe as unknown as { variants: Record<string, object> })
      .variants;
    expect(Object.keys(variants[variant])).toEqual([...values]);
  });
});

describe("S3: the content ground is the default", () => {
  it("a pill is the card fill, the ink hairline and a capsule", () => {
    const pill = buttonStyles({ variant: "pill" }).split(" ");
    for (const name of [
      "bg-card",
      "border",
      "border-line",
      "shadow-control",
      "rounded-full",
    ])
      expect(pill).toContain(name);
  });

  it("the filled action is a capsule, and lg takes the prose step", () => {
    const primary = buttonStyles({ variant: "primary", size: "lg" }).split(" ");
    expect(primary).toContain("rounded-full");
    expect(primary).toContain("text-prose");
    expect(primary).not.toContain("text-label");
  });

  it("a chip is sunken with second ink, not glass", () => {
    const chip = chipStyles().split(" ");
    expect(chip).toContain("bg-sunken");
    expect(chip).toContain("text-ink-2");
    expect(chipStyles({ tone: "warn" })).toContain("bg-warn-ground text-warn");
  });

  it("only Surface is glass", () => {
    for (const [name, recipe] of Object.entries(RECIPES)) {
      const glass = classesOf(recipe as Recipe).some((c) => /glass/.test(c));
      expect(glass, name).toBe(name === "surfaceStyles");
    }
  });
});

describe("S4: states", () => {
  it("every pressable control carries the one ring", () => {
    for (const variant of [
      "quiet",
      "primary",
      "pill",
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

  it("pressed is raised, filled and heavier, not only recoloured", () => {
    const pressed = buttonStyles({ variant: "pill", pressed: true }).split(" ");
    for (const name of [
      "bg-inverse",
      "text-ink-inverse",
      "shadow-control",
      "font-bold",
    ])
      expect(pressed).toContain(name);
    expect(pressed).not.toContain("bg-card");
    const item = segmentedStyles().item();
    for (const name of ["aria-pressed:bg-card", "aria-pressed:shadow-control"])
      expect(item).toContain(name);
  });

  it("hover and disabled are written for every button", () => {
    for (const variant of [
      "quiet",
      "primary",
      "pill",
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
    for (const variant of ["quiet", "pill", "link", "danger"] as const)
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
  it("take the lead step, 17px, under pointer: coarse", () => {
    for (const input of [
      controlStyles().input(),
      searchFieldStyles().input(),
    ]) {
      expect(input).toContain("text-prose");
      expect(input).toContain("pointer-coarse:text-lead");
      // The lead step brings its weight with it; a field stays regular.
      expect(input).toContain("font-normal");
    }
    const css = build(["pointer-coarse:text-lead"]);
    const at = css.indexOf(`${selector("pointer-coarse:text-lead")} {`);
    const rule = css.slice(css.lastIndexOf("@media", at), css.indexOf("}", at));
    expect(rule).toMatch(/^@media \(pointer: coarse\) \{/);
    expect(rule).toContain("font-size: var(--text-lead);");
    expect(css).toMatch(/--text-lead: 17px;/);
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
    expect(markup).toContain(`<h2 class="m-0 text-lead text-ink" id="${id}">`);
    expect(markup).toContain('aria-label="Close"');
  });

  it("only takes a display of its own while open", () => {
    const base = dialogStyles().base().split(" ");
    expect(base).toContain("open:grid");
    for (const name of ["grid", "flex", "block"])
      expect(base).not.toContain(name);
  });

  it("has the scrim and a 5px blur for a backdrop", () => {
    const base = dialogStyles().base();
    expect(base).toContain("backdrop:bg-scrim");
    expect(base).toContain("backdrop:backdrop-blur-scrim");
    const css = build(["backdrop:bg-scrim", "backdrop:backdrop-blur-scrim"]);
    expect(css).toContain(
      "::backdrop {\n  background-color: var(--color-scrim);",
    );
    expect(css).toContain("--tw-backdrop-blur: blur(var(--blur-scrim));");
    expect(css).toMatch(/--blur-scrim: 5px;/);
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
    expect(html(<Surface role="region" />)).toContain("backdrop-blur-glass");
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
