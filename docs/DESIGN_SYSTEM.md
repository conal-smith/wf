# The design system bundle

`design-system/` is the site's design (see [BRAND.md](BRAND.md)) written down
as a SprintEngine Studio design-system bundle: tokens, principles, components
for the kit in `ui/` and for the map's own vocabulary, a few patterns, the
glyphs, and a single-file catalog. It exists so the owner can look at the whole
system in the Studio's Design door, and so an agent can read it before it
draws.

## How it relates to `ui/theme.css`

**The product reads `ui/theme.css`, not the bundle.** The theme is the one
place a design value is written for the site, and `ui/` is the kit. The
bundle restates both:

| Product | Bundle |
| --- | --- |
| `--color-ink-muted` in `ui/theme.css` | `sem.color.ink-muted` in `foundations/tokens.tokens.json`, emitted as `--sem-color-ink-muted` |
| `--color-accent`, `-hover`, `-ink` | `sem.color.accent.primary`, `.hover`, `.ink` |
| `--text-lead`, `--text-lead--line-height`, `--font-weight`, `--letter-spacing` | `sem.font.size.lead`, `sem.font.line.lead`, `sem.font.weight.lead`, `sem.font.tracking.lead` |
| `--spacing` (4px), `p-5` | `sem.space.step`, `sem.space.x5` |
| `ui/Button.tsx` (`buttonStyles`) | `components/button/` (`component.css`, `.html`, `.md`) |

The full map, theme property to token path, is `MAP` in
`scripts/lint-design-tokens.mjs`, and that script fails `npm run ui:lint` when
the two disagree. So **a value changes in both places, together**: edit
`ui/theme.css`, edit `design-system/foundations/tokens.tokens.json`, then
`npm run design:build` to regenerate the derived `foundations/tokens.css` and
`catalog/index.html` (never edit those by hand).

### Two themes

Dark is the site's default and white the other (ruling of 2026-11-01 in
[DESIGN_PRINCIPLES.md](DESIGN_PRINCIPLES.md#rulings)). The theme's light values
sit in `@theme`; the dark block (`/* ==== dark ==== */`,
`:root[data-theme="dark"]`) re-declares the same names. In the bundle each
semantic token carries both, as its `light` and `dark` modes
(`$extensions["com.sprintengine"].modes`), and the drift check compares the
dark block with each token's dark mode as it compares the light values with
the tokens. A dark value whose token has no dark mode is a warning.

### Shape and elevation

The corners and the shadows, as the tokens hold them (light values; the dark
mode of each shadow is a deeper, plainer black):

| Theme | Bundle | Value | For |
| --- | --- | --- | --- |
| `--radius-control` | `sem.radius.control` | 10px | a control that is not a capsule: a field, a tooltip, a key |
| `--radius-surface` | `sem.radius.surface` | 14px | a card on a page, a box on the chart |
| `--radius-dialog` | `sem.radius.dialog` | 18px | a sheet: a dialog, the dock, the menu |
| `--radius-pill`, `--radius-full` | `sem.radius.pill`, `.full` | 9999px | what is pressed: buttons, chips, tags, segmented controls, search fields |
| `--radius-mark` | `sem.radius.mark` | 5px | the small square of a `NoticeMark` |
| `--shadow-float` | `sem.shadow.float` | `0 1px 1px #1111141a, 0 3px 6px -2px #1111141f, 0 14px 28px -12px #00000066` | anything on the map, a popover |
| `--shadow-sheet` | `sem.shadow.sheet` | `0 1px 1px #1111141a, 0 6px 12px -4px #11111424, 0 24px 48px -16px #00000080` | a dialog, the menu |
| `--shadow-dock` | `sem.shadow.dock` | the sheet's stack with each offset upward | the dock, on the foot of the screen |
| `--shadow-control` | `sem.shadow.control` | `0 1px 2px #11111433` | the chosen segment, a switch's thumb |

A card on a page casts no shadow: it is `bg-sunken rounded-surface` and
nothing else. Inside it, a control's fill is the second grey: controls fill
with `--color-well` (`bg-well`), which is `sunken` on the ground, and the
`on-card` utility that a soft card carries sets it to `--color-raised`
(`#e6e6eb` white, `#26262c` dark). There are no frames, sheens or gradients, so the bundle holds
none.

The mobile app reads the theme's values through
`mobile/src/theme/css.generated.ts` (`npm run tokens` in `mobile/`), which is
regenerated with them, but its components still draw from the hand-written
`radius` and `shadow` in `mobile/src/theme/tokens.ts`, which are still in the
old look: porting them is its own piece of work.

A section that adds values of its own appends them to the end of the theme
under a banner, `/* ==== <section> ==== … */`. Until they are in the bundle
the drift check lists them as warnings, "to add to the bundle", rather than
failing; an unmapped value in the kit's own theme above the first banner
fails.

### Components

The kit's parts are listed in `ui/index.ts`, and BRAND.md says when to use
each. The bundle has a component folder for avatar, beaufort-glyph, button,
checkbox, chip, count, dialog, empty, field, figure, link, notice, pager,
search-field, segmented, select, skeleton, star-glyphs, tag, text-area,
text-input and wordmark, and for the map's own hour-cell, shore-compass,
spot-light, tide-label and wind-figure. The kit's newer parts are not in the
bundle yet: `Card`, `Disclosure`, `Heading`, `Rows`, `Switch`, `Slider`, `NumberField`,
`Tabs`, `TopBar`, `SpotSearch`, `ThemeButton` and `RatingTip`. Until they are,
the kit's own files and the `/ui` gallery are their reference.

## The rules it enforces in the project

`npm run ui:lint` runs, in order:

- `scripts/lint-ui.mjs` and its probe: no arbitrary values, no colour literals
  outside the theme.
- `scripts/lint-design-tokens.mjs` and its probe: the theme and the bundle hold
  the same values, in both themes.
- `scripts/lint-raw-primitives.mjs` and its probe: no new raw `<button>`,
  `<input>`, `<select>` or `<textarea>` outside `ui/`, against the per-area
  counts in `scripts/raw-primitives.baseline.json`, which only go down. Under
  the number fails too, naming the number to write. When the sections being
  rebuilt are integrated, regenerate it from the merged tree and review the
  diff: `node scripts/lint-raw-primitives.mjs --write-baseline`.
- `design-system/scripts/lint.mjs`: the bundle's own gate (no colour literals
  in components, no `--ref-*` outside the tokens, full metadata on every
  token).

## Registering it in the Studio

1. Open the Studio's **Design** door.
2. Choose **Point at a folder** (in the door's bar, or on its first-run
   screen).
3. Pick the folder that holds `design-system.json`: `design-system/` in the
   checkout.

The door reads the folder live and never writes to it; a commit or a
`npm run design:build` shows up on the next read. If the folder moves, the
row says so and offers **Re-point…**.

The faces (Inter, and Fraunces for the wordmark) are named by the tokens but
not shipped in the bundle; the door and the catalog draw them where they are
installed, and fall back to the system sans and Georgia otherwise.
`catalog/index.html` opens directly in a browser too.
