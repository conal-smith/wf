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
(it pins the theme's colour set, so an S3 addition fails it until it is listed there too),
tests/shots-compare.test.ts (it pins the map's ground out of the committed baseline).
AVOID: Converting to utility classes (D11). Touching TSX. Renaming classes.
GATES: npm run test:e2e; npm run shots:compare -- e2e/map/__baseline__; `grep -cE "#[0-9a-fA-F]{3,8}\b"` on each file returns 0 (the wind ramp and the model hues live in TS — force5/src/weather.ts PALETTE and force5/src/manifests.ts modelHue — but the now marker does not: its two literals are in src/compact.css. VERIFIED).
ACCEPT:
- [x] Literal count is 0 in src/styles.css, src/compact.css, save the eight `rgb()`
      stops of the dead `.legend-gradient`, which are an old wind ramp (D12) and are
      the one place GOAL's "zero colour literals" is not met. See OPEN.
- [x] Every map:shots state differs from baseline in colour only; reviewer signs off in LOG.
      (The measurement is in LOG below, at both widths. The sign-off is the reviewer's.)
- [x] npm run test:e2e passes untouched.
REFS: D11 D12.
OPEN: seven rule groups in src/styles.css are drawn by nothing in src/ or force5/ and
cannot be shot at all: `.legend*`, `.map-instruction`, `.timeline-date-dot`,
`.status-dot`, `.prototype-tag`, `.unit-control` and `.now-button`. They were converted
where they stand, because S5 forbids a selector change and AVOID forbids renaming a
class. Removing them is the only way GOAL's "zero colour literals" is reached, since
`.legend-gradient`'s eight `rgb()` stops are a stale copy of the wind ramp — the exact
duplication design/wind-scale/component.md names as "how the legend and the map drifted
apart in the first place" — and D12 forbids re-valuing them into the theme beside
`--color-wind-k*`. The owner's call; an item of its own, not this one.
OPEN: `--color-sea` now does two jobs. It is `.map-panel`'s ground, which is right, and
it is also the 22% wash the forecast table paints a `.wind-cell` fill with, which is a
quantity wash and not water. The wash is worth 2/255 on a wind cell either way
(measured), so nothing shows today; but plan 13's basemap step wants the water near
navy.300, and if it moves `--color-sea` the wind bars go with it for no reason.
map-basemap-accent owns both; it should either keep the two apart or say they are one.
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
  (Renamed `--color-now-marker` at review, below.)
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
- 2026-09-21 reviewer: the structure flags are colour, and I have the number for it. In a
  scratch change that is not committed I put `.map-panel` back to `#b8d0d7` and left every
  other line of this branch alone, so the only thing that moved was the field behind
  everything, and re-shot all 36 against HEAD's baseline: 36 of 36 under the 1% threshold,
  structure 0.00%-0.69% (worst stale-390 0.69%), gone <= 0.69%, fresh <= 0.56%, 0 resized,
  0 on one side only. Against 34 of 36 over, 0.00%-6.26%, on the branch as it stands. That
  is the whole of it: the sea going #b8d0d7 -> #9db0cc raises contrast at every panel,
  marker and credit boundary past the tool's Sobel threshold, and the map canvas is hidden
  in a shot so `.map-panel` is what fills the frame.
  I did not stop at the overlays for the rest. For each of the 36 I took the fresh pixels
  (an edge in the new shot with no partner in the baseline at EDGE=40, r=1) and asked how
  many of them fall anywhere that was not already a luminance boundary in the baseline, at
  a Sobel of 8 within a pixel. Across all 36: 0.00%. Every fresh edge, 1046 to 1386 of them
  per shot, sits on a boundary that was already there and was under the threshold. An edge
  that moved would land off one. Read with the overlays at both widths (idle, dock-grid,
  forecast-sheet, popup, stale, warning, layers, info-dialog) the blue lies on the credit
  strip, the marker rings, the selected column and the dock's pressed chip, always on the
  boundary and never beside it: no doubled outline, no shifted text, no resized panel.
  Colour only. ACCEPT's second line is ticked on that.
  The look holds: navy sea, light glass, navy ink, one blue filled action. `--color-sea` is
  a sensible stand-in ground — the basemap draws over it in the real map, and where it does
  show (an overscroll, a tile gap) navy.400 is the value plan 13.1 gives the ground behind
  the map.
- 2026-09-21 reviewer: S4, recomputed from scratch and then measured off the pixels, which
  the swatch arithmetic does not reach. Over `--color-sea` my figures are the agent's to two
  places (ink on glass 12.90, ink-muted on glass 5.05, ink-muted on sunken 5.23, warn on
  warn-ground 6.24, white on inverse 15.39, white on accent 4.93, white on now 5.95,
  .map-instruction 5.23, .sea-label 4.54, .spot-popout-links a 5.94 against 4.26).
  One pair was missed, and it is the one the arithmetic could not see, because the text and
  its ground are both accent: `.forecast-table thead button[aria-pressed="true"]` is the
  pressed hour, and the pressed hour is also `th.selected-hour`, which tints itself
  `--color-accent` at 21%. Sampled out of dock-grid-1440: accent-hover rgb(13,79,209) on
  rgb(186,207,249), 4.38:1, against 5.88:1 before the swap. Under 4.5. Fixed the way S4
  says, with the darker step: the label takes `--color-ink`, measured 10.50:1 on the same
  shot, and the state is still carried by the weight, the column tint and the accent rule
  under it, so it is not colour alone. The unpressed headers were already ink, so the
  pressed one keeps its weight and its rule to tell them apart.
  Nine more pairs read off the pixels rather than modelled, which catches what a swatch
  cannot: the unpressed hour header 14.28, the info dialog's body 4.91 and its dt 5.44, the
  layers panel's body 5.29, the attribution credit 5.39, the dock's sources line 4.85, the
  popup's body 14.27 and its Source link 5.95, the warning banner 6.33. All clear 4.5. The
  dialog's body is the one the arithmetic gets wrong the other way: modelled over the scrim
  it is 4.43, but the dialog's own blur and the backdrop's lighten it and it measures 4.91.
  Over the extremes a real map can put behind glass, rather than the shot's flat sea: with
  the wind raster at 0.86 over the basemap the darkest ground is 60 kn over water, and
  ink-muted on glass is 4.37:1 there (5.73:1 over bare land). `.sea-label`, which has no
  surface at all, is 2.52:1 over that same ground and 6.86:1 over land. Both are better than
  they were (3.98:1 and 1.33:1), so the swap did not make them; a hint with no surface under
  it cannot be fixed by an ink step, and glass over a storm is a `--color-ink` label or a
  less transparent glass. Neither is this item's, and neither is a regression.
- 2026-09-21 reviewer: S2 checked by arithmetic on every alpha, not a sample. All 47
  distinct values reconcile: each color-mix percentage is the literal's alpha byte over 255
  rounded to the nearest whole percent, worst case 0.5pp (`#203e3c20` and `#153b4420`, 12.5%
  written 13%, one part in 255 on a shadow). Two are deliberate and are named in the LOG
  above: `.sea-label` 44% -> 75% for S4, and `--color-line`/`--color-scrim` taken as named
  theme alphas rather than mixes, which S2 allows. The five `white` keywords in styles.css
  became `--color-ink-inverse` (the active marker's number), `--color-accent-ink` twice (the
  play button's glyph and `.primary-button`) and `--color-card` twice (the slider thumb's
  ring, which is a surface and not a label); the two in compact.css became
  `--color-ink-inverse` (the active marker, the now label). No new hex outside ui/theme.css.
- 2026-09-21 reviewer: S5 checked mechanically, not by reading the diff. Both files parse to
  the same declaration list as before, in the same order, under the same selectors: 872 in
  src/styles.css and 349 in src/compact.css on each side, with zero insertions and zero
  deletions and every difference a value. No selector, size, spacing, layout or behaviour
  change.
- 2026-09-21 reviewer: the `@theme static` change emits ten values a plain `@theme` had
  dropped, and nothing else. Diffed the built `:root` before and after: `--color-ok`,
  `--color-now` and `--color-now-marker`, which the map now reads, plus seven nothing reads
  (`--font-weight-medium`, the four `--shadow-*`, `--text-reading` and its line height). No
  value changed and none was removed. MarketApp's CSS is byte-identical across the two
  builds (same content hash), so the marketplace is untouched; the shared index CSS goes
  179.05 kB -> 183.20 kB, 28.98 kB -> 29.02 kB gzipped, nearly all of it the color-mix()
  expressions rather than the theme. Preflight is still out (D3): the built CSS has no
  `-webkit-text-size-adjust` and no `*,::before,::after` reset, only Tailwind's
  `@layer properties` block, which sets `--tw-*` and nothing else. Took the sibling
  cf2/map-theme-dock's wording for the comment verbatim so the two branches make the same
  change to that line and it merges without a conflict.
- 2026-09-21 reviewer: renamed `--color-now-line` to `--color-now-marker` (D12's own word)
  in ui/theme.css, src/compact.css and tests/ui-theme.test.ts, and moved it out of the
  status block to sit after the wind ramp, where cf2/map-theme-dock puts it. That branch
  adds `--color-gust: #e0803a` in the same place and the same name at the same value, so
  after both land the two are one block. Value unchanged: #bf6546, what the map has always
  drawn.
- 2026-09-21 reviewer: tests/shots-compare.test.ts:137 pinned the map's ground to
  `[0xb8, 0xd0, 0xd7]` out of the committed idle-1440.png. `.map-panel` draws
  `--color-sea` now, so that line would have gone red on the integrator's re-shoot — the
  re-shoot this item's LOG asks for. It accepts either value now, with a note to drop the
  teal one once the baseline is navy. The test is about the codec reading an adaptively
  filtered file, not about the palette.
- 2026-09-21 reviewer: D13, what I see, no ruling. The map's accent-filled action is
  `.play-button`, a blue disc on the dock's glass, and plan 13.2 already says that one is
  safe because it is not over the water. Three other things now carry the same accent and
  two of them sit on wind colour: the time slider's thumb rides a track painted with the
  wind ramp, and it is at k00-k09 blue for a third of its length; the `accent-color` on the
  layers panel's checkboxes and the slider; and `th.selected-hour`'s 21% tint, which lies
  directly on top of wind-coloured cells in the forecast grid. In the shots #1463ff is far
  more saturated than k00 #355897 or k05 #2a76b8 and reads as a control rather than a
  reading, and the tint reads as selection because the whole column carries it. But the
  thumb on the ramp is the case worth looking at on a light-wind day before this ships, and
  that is map-basemap-accent's to call.
- 2026-09-21 reviewer: two role notes I looked at and left. `:root`'s background took
  `--color-ground` and `.map-panel` took `--color-sea`, which inverts the plan 13.1 row that
  sends the old teal.400 (`:root`, #83afb9) to navy.400; `.map-panel` is `position:absolute;
  inset:0` inside a full-viewport `.app-shell`, so `:root`'s ground is never seen on the map,
  and `--color-ground` is the honest name for a page's ground and is what `.fatal-error`, the
  one full-page surface that is not the map, takes as well. The wind-cell wash is the other;
  it is in OPEN. `.spinner`'s arc taking `--color-accent` and the two dead green dots taking
  `--color-ok` are both right for what they are.
- 2026-09-21 reviewer: gates on cf2/map-theme-styles-compact-r1. Hex grep 0 on both files;
  so is a grep for `hsl()` and for every CSS named colour. Eight `rgb()` remain, all in
  `.legend-gradient`, and they are in OPEN. npm test 1159 pass, 75 skipped, with the
  baseline restored. npm run build. npm run market:api:build. npm run ui:lint clean, 82
  files, 7 probe cases (it does not read src/*.css, so the grep is the only guard there).
  PREVIEW_PORT=4412 PORT=8912 npm run test:e2e: 85 pass. map:shots 36 pass, three runs, no
  lost basemap style. Re-shot PNGs restored with `git checkout -- e2e/map/__baseline__`.
