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
3. Pick the folder that holds `design-system.json`: in the main checkout,
   `/Volumes/workdrive/wingfoil/design-system`; before the branch is merged,
   `/Volumes/workdrive/worktrees/wingfoil-brand/design-system`.

The door reads the folder live and never writes to it; a commit or a
`npm run design:build` shows up on the next read. If the folder moves, the
row says so and offers **Re-point…**.

The faces (Fraunces, Newsreader, IBM Plex Mono, Kalam) are named by the
tokens but not shipped in the bundle; the door and the catalog draw them where
they are installed, and fall back to Georgia and the system monospace
otherwise. `catalog/index.html` opens directly in a browser too.
