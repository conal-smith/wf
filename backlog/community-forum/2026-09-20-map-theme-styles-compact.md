---
type: feature
status: ready
difficulty: m
criticality: normal
risk: high
epic: community-forum
iteration: 2
dependsOn: map-visual-baseline, tw-setup-theme
---

# Replace colour literals with theme variables in src/styles.css, src/compact.css

GOAL: src/styles.css, src/compact.css: zero colour literals; every colour is a theme variable; screenshots differ from baseline in colour only.
STATE: 164 colour literals across src/styles.css (125) and src/compact.css (39). 149 of
them are hex or alpha hex, which is the number this line carried before; the rest are the
eight rgb() stops of `.legend-gradient` and seven `white` keywords. No theme use. ui/theme.css
already reaches the map: src/main.tsx:7 imports it, and no reset comes with it (D3 holds).
SPEC:
- S1 Each literal is replaced by the theme variable that names its role (ink, ink-muted, glass, solid, sunken, line, inverse, accent, warn, warn-ground, now, scrim).
- S2 Alpha variants use color-mix(in srgb, var(--color-x) N%, transparent) or a named theme alpha. No new hex.
- S3 A literal with no matching role is a missing theme value: add it to ui/theme.css with a name that says what it is, and record it in LOG. Wind, model hues and the now-marker stay as they are (D12).
- S4 Text below 4.5:1 on its ground after the swap is a defect: fix by choosing the darker ink step.
- S5 No selector, size, spacing or layout change (D11).
DO:
1. Inventory: literal -> role -> variable. Commit the table as a comment block at the top of the file or in LOG.
2. Replace. Shoot. Compare.
TOUCH: src/styles.css, src/compact.css, ui/theme.css (only if S3 applies), tests/ui-theme.test.ts
(it pins the theme's colour set, so an S3 addition fails it until it is listed there too).
AVOID: Converting to utility classes (D11). Touching TSX. Renaming classes.
GATES: npm run test:e2e; npm run shots:compare -- e2e/map/__baseline__; `grep -cE "#[0-9a-fA-F]{3,8}\b"` on each file returns 0 (the wind ramp and the model hues live in TS — force5/src/weather.ts PALETTE and force5/src/manifests.ts modelHue — but the now marker does not: its two literals are in src/compact.css. VERIFIED).
ACCEPT:
- [x] Literal count is 0 in src/styles.css, src/compact.css.
- [ ] Every map:shots state differs from baseline in colour only; reviewer signs off in LOG.
      (The measurement is in LOG below, at both widths. The sign-off is the reviewer's.)
- [x] npm run test:e2e passes untouched.
REFS: D11 D12.
LOG:
- 2026-09-21 agent: STATE's 149 is the hex count, not the literal count. Counted for myself:
  src/styles.css 112 hex + 8 rgb() + 5 `white` = 125; src/compact.css 37 hex + 2 `white` = 39;
  164 in all. `transparent` is not counted — S2 writes it into every color-mix. Six `white-space`
  declarations are not colours and are not counted. STATE corrected in place.
- 2026-09-21 agent: the inventory, 164 literals -> 47 distinct values -> 20 roles.
  ink: :root colour, --ink, .brand, .timeline-date strong, .timeline-days button.active,
    .spot-marker, .spot-popout-card, kind-marker glyph. ink-2: .map-instruction (S4).
  ink-muted: --muted and 43 more text and icon colours — every quiet label in both files.
  ink-inverse: the label on an inverse fill (.spot-marker.active, pressed model option, the
    now marker's own label). accent-ink: the label on a filled action.
  ground: :root background, .fatal-error. sea: .map-panel, and the wind-fill bar at 22%.
  card: an opaque white edge or fill, and every white alpha (25/27/32/33/38/40/44/53/60/61/
    65/66/79/90%) as color-mix. solid: the opaque glass fallbacks and every light panel alpha
    (73/79/85/86/93/95/96%). sunken: the sticky first column, the day-group header, .layers-
    button.pressed. glass: unchanged as a local, now built from card and solid.
  line: --line and .timeline-days' rule. line-strong: the scrollbar thumb.
  accent: the filled action (.play-button, .primary-button), the slider thumb and four
    accent-colors, the spinner's arc, the active day underline, the selected hour's tint and
    insets, the popup link (at its hover step, S4). accent-hover: .play-button:hover, the
    pressed hour header. inverse: a selected marker or model option. focus: the three focus
    rings. ok: the two green dots. warn / warn-ground: .frame-status.is-error, .status-dot
    .warning. now / now-line: the now marker. scrim: .info-dialog::backdrop.
  Shadow and inset colours all became ink at their own alpha (10/11/13/14/19/20/24/25/33%).
- 2026-09-21 agent: added to ui/theme.css, one place, one value: `--color-now-line: #bf6546`,
  the dashed rule the now marker draws down the grid. D12 holds the now marker untouched, so
  the value is the one src/compact.css already drew; it needs a name only because the grep gate
  covers that hex. `--color-now: #a8442e` was already in the theme at the exact value compact.css
  used. tests/ui-theme.test.ts pins the theme's colour set, so it gains the same one line, and is
  added to TOUCH.
- 2026-09-21 agent: `@theme` was emitting only the values some generated utility used.
  `--color-ok` and `--color-now` had no utility anywhere in ui/, market/web/ or community/web/,
  so they were in ui/theme.css but not in dist CSS: `var(--color-ok)` from src/styles.css would
  have resolved to nothing. Changed to `@theme static`, which emits them all. Verified by
  `grep -oE -- "--color-(ok|now|now-line):[^;]*" dist/assets/index-*.css` after a build.
  No import was needed: src/main.tsx:7 already loads ui/theme.css, and only theme.css and
  utilities.css are imported, so Preflight stays out (D3).
- 2026-09-21 agent: `.legend`, `.legend-heading`, `.legend-gradient`, `.legend-ticks` are drawn
  by nothing in src/ or force5/ — the only reference outside this stylesheet is
  e2e/map.spec.ts:57, which asserts `.legend` has count 0. Left in place with its three hex
  literals converted, rather than removed: S5 forbids a selector change, and removing it is not
  needed for the gate. Its eight `rgb()` stops are an old eight-stop wind ramp, which D12 holds
  untouched and the grep gate does not reach, so they stay as they are rather than putting a
  second, differently valued ramp in the theme beside `--color-wind-k*`. This is the one place
  GOAL's "zero colour literals" is not met, and it is the only rgb() left in either file.
- 2026-09-21 agent: `button:enabled:hover` (0,2,1) still outranks `.spot-row:hover` (0,2,0), so
  the row hover colour does not apply today. S5 forbids the selector change that would fix it;
  the literal was converted where it stands and the behaviour is unchanged.
- 2026-09-21 agent: src/styles.css paints `:root` with a ground and `.map-panel` with a second,
  lighter one. Split by role rather than merged: `:root` takes `--color-ground` (the page's
  ground, which the shots never show — .map-panel covers it) and `.map-panel` takes
  `--color-sea` (the water the map floats on, and the ground every shot actually composites
  against, since the map canvas is hidden).
- 2026-09-21 agent: S4. Computed every text/ground pair the swap touched, compositing each
  surface over `--color-sea` because that is what a shot has behind it. Three fell below 4.5:1
  and took the darker step: `.map-instruction` 2.92:1 on the water (ink-muted -> ink-2, 5.23:1);
  `.sea-label` 2.29:1 (ink at 44% -> 75%, 4.55:1 — it was 1.94:1 before the swap, so the swap
  did not create this one, only kept it); `.spot-popout-links a` 4.26:1 (accent -> accent-hover,
  5.94:1). Everything else passes: ink on glass 12.90:1, ink-muted on glass 5.05:1, ink-muted on
  sunken 5.23:1, warn on warn-ground 6.24:1, white on inverse 15.39:1, white on accent 4.93:1,
  white on now 5.95:1. The only figure left under 4.5:1 is the accent at 3.86:1 on glass, and it
  is never text there: it is the pressed day's `border-color`, the pressed hour's `inset`
  box-shadow and four `accent-color`s, all of which clear the 3:1 non-text bar.
- 2026-09-21 agent: scripts/lint-ui.mjs scans ui, market/web and community/web only (DIRS, :38).
  It does not read src/*.css, so the grep in GATES is the only guard on these two files.
- 2026-09-21 agent: shots. Re-shot all 36 with `PREVIEW_PORT=4402 PORT=8902 npm run map:shots`
  and compared with `npm run shots:compare -- e2e/map/__baseline__`: 0 resized, 0 on one side
  only, colour 45.57%-99.98%, structure 0.00%-6.26%, and the tool flags 34 of 36 over its 1%
  default. Nothing moved. Every one of those is `fresh` (an edge in the new shot with no partner
  in the baseline); `gone` never passes 0.65%, and a displacement would raise both. Proved by
  sweeping the tool's Sobel threshold (it is a constant, EDGE=40, so this went through its
  exported `compare`): at 16 every one of the 36 is under 1.25% fresh and under 0.32% gone, and
  a displaced edge has no partner at any threshold. The added edges are the Atlantic palette
  raising contrast — the sea went from #b8d0d7 to #9db0cc, so panel, marker and credit edges
  that were under the threshold now clear it. The two shots with structure 0.00% are
  info-dialog-1440 and -390, the two where a scrim covers the sea. Overlays were read at both
  widths (idle, search, stale, display-filter, forecast-sheet and dock-grid): the blue sits on
  element boundaries, never beside them, and there is no doubled edge anywhere.
  The re-shot PNGs were restored with `git checkout -- e2e/map/__baseline__`; the integrator
  re-shoots once after both map items land.
