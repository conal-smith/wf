# Force5 design system — for agents

You are about to build or change UI in this repo. Read this first; it is the
short version of `USAGE.md`, which is normative.

## Before you write any UI

1. Read `foundations/principles.md`. It settles what the tokens only imply — the
   accent rule, the ceilings, the Don't list, and the dated rulings.
2. Open `catalog/index.html` (or scan `contents.components` in
   `design-system.json`) to see what already exists.
3. **Use what is there.** A component that nearly fits is the right component;
   add a variant to it rather than a new one beside it.

## The rules you will be linted on

- Consume `--sem-*` custom properties only. Never `--ref-*`.
- No raw hex, `rgb()`, px, ms, or z-index for anything the system tokenises.
  A missing value is a missing step in a scale — add it to
  `foundations/tokens.tokens.json` with a `$description`, a `role` and a `use`,
  then regenerate. Never a local literal.
- The one escape hatch is `/* ds-lint-allow: <reason> */` on the line, and it
  needs a real reason.
- Never hand-edit `foundations/tokens.css` or `catalog/index.html`. They are
  generated.

## Adding or changing a component

The trio, or it does not exist:

- `component.md` — Anatomy, Variants, States, Usage, Accessibility. All five.
- `component.css` — `--sem-*` only.
- `component.html` — both modes, every state named in the spec.

Then: add the name to `contents.components`, regenerate, and make the gate pass.

```bash
node scripts/build-tokens.mjs && node scripts/build-catalog.mjs && node scripts/lint.mjs
```

`lint.mjs` must exit 0. If it does not, you are not finished.

## When you are unsure

- A value that does not fit the scale is usually the wrong value, not a missing
  token. Check the scale before you extend it.
- A surface that does not fit pane / pill / dock / dialog usually should not be a
  surface.
- If you settle a design question in conversation, write it into the Rulings
  section of `foundations/principles.md` **with the date**. An undated rule gets
  relitigated.
- If you find something the system cannot express, add it to the Gaps section
  rather than working around it silently.
