# Using the Force5 design system

This file is normative. Where it disagrees with a habit, this file wins.

The bundle is a folder in this repo, versioned with the product. Nothing outside
it writes to it; the Studio's Design door reads it live.

```
design/
  design-system.json        the manifest
  USAGE.md                  this file
  AGENTS.md                 the short version, for agents
  foundations/
    principles.md           what tokens cannot decide - read it first
    tokens.tokens.json      THE source of every value
    tokens.css              DERIVED - do not edit
  <component>/              one kebab-case folder per component
    component.md            Anatomy / Variants / States / Usage / Accessibility
    component.css           the real source; consumes --sem-* only
    component.html          a live demo, both modes, every state
  catalog/index.html        DERIVED - do not edit
  patterns/ glyphs/ assets/
  scripts/                  build-tokens, build-catalog, lint
```

## Consume it

Load the derived stylesheet once, before your app's own CSS:

```html
<link rel="stylesheet" href="/design/foundations/tokens.css" />
```

Then use the components' CSS, and consume tokens as custom properties:

```css
.my-thing {
  padding: var(--sem-space-pad-surface);
  border-radius: var(--sem-radius-surface);
  color: var(--sem-color-text-primary);
}
```

**Three rules, and they are the whole contract:**

1. **Consume `--sem-*` only.** `--ref-*` is the raw scale; reaching into it
   bypasses the meaning layer and the lint refuses it. If no `sem` token fits,
   that is a missing semantic token, not a reason to use `ref`.
2. **No literal values for anything the system tokenises** — colour, spacing,
   radius, type step, weight, stroke, duration, control height, z-index. A value
   the system does not cover is a missing step in a scale: add the step with
   semantics and regenerate.
3. **Reuse before adding.** A token with the right *meaning* is the right token
   even when its value is not your first aesthetic choice.

The one escape hatch is a justified exception, on the line that needs it:

```css
opacity: 0.4; /* ds-lint-allow: opacity is unitless and not a tokenised scale */
```

`ds-lint-allow:` requires a reason. "temporary" is not a reason.

## Modes

`modes` in the manifest is `["light", "dark"]`. Light is the default and lives on
bare `:root`. Dark applies on `[data-mode="dark"]`, and — unless a
`[data-mode="light"]` ancestor opts out — on `prefers-color-scheme: dark`.

A token whose value differs by mode declares both under
`$extensions["com.multicode"].modes`, and its `$value` always holds the light
value so a consumer that ignores modes still renders something correct:

```json
"primary": {
  "$value": "{ref.color.teal.800}",
  "$description": "Everything read at length.",
  "$extensions": { "com.multicode": {
    "role": "text",
    "use": "Body, headings, the wind reading.",
    "modes": { "light": "{ref.color.teal.800}", "dark": "{ref.color.teal.100}" }
  } }
}
```

**No component CSS writes a per-mode override.** Both modes ship from that one
declaration. A `@media (prefers-color-scheme: dark)` block inside a
`component.css` means a token is missing.

Note the one deliberate exception: `sem.color.wind.*` does not vary by mode. See
the wind-scale ruling in `foundations/principles.md`.

## The naming grammar

`<tier>.<category>.<subject>[.<variant>][.<step>]`, as declared in the manifest.

- `ref.*` names a value and nothing about where it is used. It holds literals,
  and may compose other `ref.*` tokens (a shadow references a `ref` colour). It
  may never reference `sem.*`.
- `sem.*` names a meaning. It aliases `ref.*`, carries a `role` and a `use`, and
  is the only tier a component may consume.
- Colour steps run light to dark (50 lightest, 950 darkest). Dimension steps run
  small to large. Wind steps are named for the knot value they anchor: `k35` is
  the colour at 35 knots.
- Custom properties are the dotted path, kebab-cased:
  `sem.color.action.bgHover` → `--sem-color-action-bg-hover`.

## Contribute

**Changing a value** happens in `foundations/tokens.tokens.json` and nowhere
else. Then regenerate and lint.

**Adding a component** means all three files, plus the name in
`contents.components`, plus a regenerated catalog, plus a clean lint:

- `component.md` with all five sections: Anatomy, Variants, States, Usage,
  Accessibility. The States section lists each state as `` - `selector` `` so the
  lint and the catalog can count them.
- `component.css` consuming `--sem-*` only.
- `component.html` showing **both modes** (`data-mode="light"` and
  `data-mode="dark"` containers) and **every state the spec names** — hover,
  `:focus-visible`, disabled, pressed, each variant. One state proves the
  component exists; it does not prove it works. Where a state cannot be captured
  in a still, force it with an `.is-hover` / `.is-focus` class in the demo's own
  scaffolding, which is clearly marked as not part of the component.

**Derived files are never hand-edited.** The manifest's `derived` map names each
one's generator. Run each one **twice and diff**: a second run that changes the
output means the generator reads something unordered, and every future diff is
noise.

```bash
node scripts/build-tokens.mjs && node scripts/build-catalog.mjs && node scripts/lint.mjs
```

`lint.mjs` is the gate and must exit 0. It checks the manifest shape, that every
token has a `$type` and a `$description`, that every `sem` token has a `role` and
a `use` and aliases only `ref`, that every alias resolves, that every component is
a complete trio with all five spec sections and a both-modes demo, that no
component CSS touches `--ref-*` or a raw value, and that both derived files are
up to date.

**Version the bundle with the product.** Bump `version` in the manifest on any
change that alters a token's value or a component's contract.

## Scope of this lint

`scripts/lint.mjs` governs **this bundle's own sources**. It does not, and cannot,
stop product code from going around the system with a raw hex.

That is a separate rule that belongs to the project — over `src/` and
`force5/src/`, wired into the project's lint and CI, with a per-area baseline
that only ever drains, and a probe that injects the defect the rule exists to
catch and fails if the rule stays quiet. A passing lint proves the rule found
nothing; only a probe proves it would find something.

**That project-side rule does not exist yet.** Until it does, this system is
available, not enforced.
