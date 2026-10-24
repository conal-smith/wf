# The design system bundle

`design-system/` is the chart (see [BRAND.md](BRAND.md)) written down as a
SprintEngine Studio design-system bundle: tokens, principles, a component for
every primitive in `ui/` and for the map's own vocabulary, a few patterns, the
glyphs, and a single-file catalog. It exists so the owner can look at the whole
system in the Studio's Design door, and so an agent can read it before it
draws.

## How it relates to `ui/theme.css`

**The product reads `ui/theme.css`, not the bundle.** The theme is still the one
place a design value is written for the site, and `ui/` is still the kit. The
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

### Shape and elevation (mixed and rounded, 24 October 2026)

The owner approved the "mixed and rounded" treatment on 24 October 2026 (the
`body.mixed` style of `backlog/mockups/2026-10-24-layer-rail.html`; the
ruling is in [DESIGN_PRINCIPLES.md](DESIGN_PRINCIPLES.md#rulings)). The rule,
as the tokens hold it:

| Theme | Bundle | Value | For |
| --- | --- | --- | --- |
| `--radius-control` | `sem.radius.control` | 10px | a control that is not a capsule: a field, a small chip, a tooltip, a tile, a key |
| `--radius-surface` | `sem.radius.surface` | 14px | a box: a card on a page, anything on the chart |
| `--radius-dialog` | `sem.radius.dialog` | 18px | a sheet: a dialog, the dock, a menu |
| `--radius-pill`, `--radius-full` | `sem.radius.pill`, `.full` | 9999px | what is pressed: stays a capsule |
| `--inset-shadow-frame` | `sem.shadow.frame` | `inset 0 0 0 2px #f3eee3, inset 0 0 0 3px #1a1d2142` | the hairline inside the 1px ink rule, on every box and sheet |
| `--shadow-card` | `sem.shadow.card` | `0 1px 1px #1a1d211a, 0 2px 4px -2px #1a1d211a` | a card in a page or a dialog |
| `--shadow-float` | `sem.shadow.float` | `0 1px 1px #1a1d211a, 0 3px 6px -2px #1a1d211f, 0 14px 28px -12px #3c2d1466` | anything on the map, a menu, a popover |
| `--shadow-sheet` | `sem.shadow.sheet` | `0 1px 1px #1a1d211a, 0 6px 12px -4px #1a1d2124, 0 24px 48px -16px #3c2d1480` | a dialog or a sheet |
| `--shadow-dock` | `sem.shadow.dock` | the sheet's stack with each offset upward | the dock, on the foot of the screen |
| `--shadow-control` | `sem.shadow.control` | `inset 0 1px 0 #ffffff2e, 0 1px 2px #1a1d2150` | a pressed or filled ink control |
| `--shadow-raised` | `sem.shadow.raised` | `inset 0 1px 0 #ffffff, 0 1px 2px #1a1d2126` | a raised paper button |
| `--gradient-ink` (`sheen-ink`) | `sem.gradient.ink` | `linear-gradient(180deg, #33373d, #15171a)` | under a pressed or filled ink control |
| `--gradient-raised` (`sheen-raised`) | `sem.gradient.raised` | `linear-gradient(180deg, #ffffff, #f0eadd)` | under a raised paper button |
| `--gradient-float` (`paper-float`) | `sem.gradient.float` | `linear-gradient(180deg, #f6f2e9, #f1ebdf)` | under the grain of a small box over the chart |

A box is `border border-ink inset-shadow-frame` plus its corner and its
shadow; in the map's plain CSS, `box-shadow: var(--inset-shadow-frame),
var(--shadow-float)` (`.chart-box` in `src/map.css` is that box). Large
surfaces stay flat, sheens are for small controls, a lit control nudges down a
pixel when pressed, and print rules (double rules under heads, table and
column rules, the dock's day rules) stay square and unshadowed. The bundle
carries a proposed night value for each shadow and gradient.

The mobile app reads the theme's values through
`mobile/src/theme/css.generated.ts` (`npm run tokens` in `mobile/`), which is
regenerated with them, but its components still draw from the hand-written
`radius` and `shadow` in `mobile/src/theme/tokens.ts`, which are still square
and still the old shadows: porting them is its own piece of work.

A section that adds values of its own appends them to the end of the theme
under a banner, `/* ==== <section> ==== … */`. Until they are in the bundle
the drift check lists them as warnings, "to add to the bundle", rather than
failing; an unmapped value in the kit's own theme above the first banner
fails.

The bundle has a proposed night chart for its dark mode, because the Door
requires one. The product has no dark mode; nothing reads it. See the ruling
of 2026-10-05 in `design-system/foundations/principles.md`.

## The rules it enforces in the project

`npm run ui:lint` runs, in order:

- `scripts/lint-ui.mjs` and its probe: no arbitrary values, no colour literals
  outside the theme.
- `scripts/lint-design-tokens.mjs` and its probe: the theme and the bundle hold
  the same values.
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

The faces (Fraunces, Newsreader, IBM Plex Mono, Kalam) are named by the
tokens but not shipped in the bundle; the door and the catalog draw them where
they are installed, and fall back to Georgia and the system monospace
otherwise. `catalog/index.html` opens directly in a browser too.
