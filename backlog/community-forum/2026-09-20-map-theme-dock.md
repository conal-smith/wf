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

# Replace colour literals with theme variables in src/dock.css

GOAL: src/dock.css: zero colour literals; every colour is a theme variable; screenshots differ from baseline in colour only.
STATE: 89 colour literals across src/dock.css: 88 hex and alpha hex, and one
rgb() with a calc() alpha on .rain-cell. 51 distinct values. No named colours.
No theme use. (Corrected from 88 on 2026-09-20; see LOG.)
SPEC:
- S1 Each literal is replaced by the theme variable that names its role (ink, ink-muted, glass, solid, sunken, line, inverse, accent, warn, warn-ground, now, scrim).
- S2 Alpha variants use color-mix(in srgb, var(--color-x) N%, transparent) or a named theme alpha. No new hex.
- S3 A literal with no matching role is a missing theme value: add it to ui/theme.css with a name that says what it is, and record it in LOG. Wind, model hues and the now-marker stay as they are (D12).
- S4 Text below 4.5:1 on its ground after the swap is a defect: fix by choosing the darker ink step.
- S5 No selector, size, spacing or layout change (D11).
DO:
1. Inventory: literal -> role -> variable. Commit the table as a comment block at the top of the file or in LOG.
2. Replace. Shoot. Compare.
TOUCH: src/dock.css, ui/theme.css (only if S3 applies), tests/ui-theme.test.ts
(its COLOURS map pins the theme's colour set exactly, so S3 cannot land without
it; see LOG).
AVOID: Converting to utility classes (D11). Touching TSX. Renaming classes.
GATES: npm run test:e2e; npm run map:shots compare; `grep -cE "#[0-9a-fA-F]{3,8}\b"` on each file returns 0 (wind and model hues live in TS, not here. VERIFY).
ACCEPT:
- [x] Literal count is 0 in src/dock.css.
- [x] Every map:shots state differs from baseline in colour only; reviewer signs off in LOG.
- [x] npm run test:e2e passes untouched.
REFS: D11 D12.
LOG:
- 2026-09-20 agent: STATE said 88 literals. It is 89: 88 hex plus
  `rgb(42 118 184 / calc(0.22 * var(--rain-tint, 0)))` on .rain-cell:437. 51
  distinct values. No rgb/hsl elsewhere and no CSS named colour: the only hits
  for `white` and `blue` are `white-space` and the word blue in a comment.
  Counted with `grep -nE "#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\("`. STATE
  corrected in place.
- 2026-09-20 agent: how the theme reaches the map bundle. ui/theme.css is
  imported at src/main.tsx:7, and src/main.tsx is the one entry for all three
  bundles, so the import is not missing. What was missing is emission: Tailwind
  writes a theme variable into :root only when a scanned class asks for it, and
  theme.css deliberately does not @source the map's sources. Proved by building
  and grepping dist: --color-ok and --color-now were absent, and adding a
  `var(--color-now)` reference to src/dock.css did not bring them back (a plain
  var() in an unscanned file is not a use). So every S3 value I added would have
  resolved to nothing. Smallest fix: `@theme static`, which emits all of them
  and adds 270 bytes of :root declarations and no rule. This is the wiring the
  sibling item map-theme-styles-compact owns; it needs the same thing (its
  scratch script reaches for --color-ok, --color-ground and --color-now, none of
  which were emitted). Integrator: expect one of the two `@theme static` changes
  to be a duplicate.
- 2026-09-20 agent: D3 holds. theme.css imports only tailwindcss/theme.css and
  tailwindcss/utilities.css, never preflight.css, and the built map CSS has no
  `*,::after,::before` reset rule. Unchanged by this item.
- 2026-09-20 agent: D12, where each protected thing lives. The wind ramp is
  PALETTE in force5/src/weather.ts as RGB triples and reaches the element
  through windColor() as an inline style; the model hues are modelHue() in
  force5/src/manifests.ts, likewise inline (src/DisplayFilter.tsx:156,170,
  src/BlendChart.tsx:331,401). Neither is in this file, so the grep gate never
  touched them, and neither is a TSX edit I had to make. .model-swatch and
  .model-line in dock.css carry only geometry. What was in this file: the ramp's
  own 5 kn step #2a76b8, five times (.wave-arrow, .rain-cell, .observed-spark,
  .wave-band fill and stroke) — replaced by var(--color-wind-k05), which holds
  that exact value, so the colour does not move; and the now line #bf6546 on
  .chart-now, whose value the theme did not hold (--color-now is #a8442e, a
  different colour), so it would have been re-themed. Given a home in
  ui/theme.css as --color-now-marker at #bf6546. Same for the candle chart's
  gust cap #e0803a, a chart series with no Atlantic role, as --color-gust.
  Those two are the whole of S3. src/compact.css:332 draws the same now line
  with the same literal, so --color-now-marker is there for the sibling too —
  note that its scratch script names it --color-now-line; one of us renames.
- 2026-09-20 agent: adding to the theme breaks tests/ui-theme.test.ts, which
  asserts the declared --color-* set equals COLOURS plus the wind ramp exactly.
  `npm test` is a gate, so the file is in TOUCH and the two names were added to
  COLOURS with their values. The sibling will hit the same pin.
- 2026-09-20 agent: scripts/lint-ui.mjs scans DIRS = ["ui", "market/web",
  "community/web"] only. src/ is not linted, so for this file the grep in GATES
  is the only guard. ui:lint still passes (82 files) and its probe still fails
  when it should.
- 2026-09-20 agent: the inventory, literal -> role -> variable. 89 literals, 51
  distinct, 17 roles. Read it with the line numbers in the pre-change file.
    ink            #12525f (73,91,711,801) #173d49 (311,380,603,686)
                   #1e4a57 (420,438,450,493) #123c47 (358) #14586b (230)
                   -> var(--color-ink)
    ink-2          #3d636f (68,87,797) #3f6673 (168,190) #1d5a68 (326,338)
                   #2b5f6c (370) #35636e (477) #486d78 (530) #4f737c (137, the
                   day band's sun times) -> var(--color-ink-2)
    ink-muted      #506c77 (45,287,662,855) #567781 (307,534,640)
                   #6a8b94 (155,424,497) #7d949a (778,783,832,836) #7d98a0 (517)
                   #5b8794 (472) #3c5d6a (654) #4f737c (612,696, the eyebrows)
                   -> var(--color-ink-muted)
    ink-inverse    #eaf5f2 (545) -> var(--color-ink-inverse); #a5c9c8 (558) ->
                   72% of it
    card           #ffffffe0 (72,800) #ffffff7a (90) #fff (352,365,375,757) ->
                   var(--color-card); #ffffffa8 (227) #ffffff85 (229)
                   #ffffffc4 (243) -> 66/52/77% of it
    solid          #f4faf8 (599,684) #edf5f4 (191) #eef6f4 (917)
                   -> var(--color-solid)
    sunken         #567b821c (59,790) #cfe0e4 (462) -> var(--color-sunken)
    line           #cddedd (600,682) -> var(--color-line)
    line-strong    #4a7d8a (315) #5c8792 (177) -> var(--color-line-strong);
                   #b9d0d3 (746) -> 60% of it
    inverse        #16404b (544) -> var(--color-inverse)
    scrim          #14344226 (689) -> 33% of var(--color-scrim)
    accent         #2c7f88 (762) #277785 (819) -> var(--color-accent)
    focus          #176b91 (768) -> var(--color-focus)
    warn           #7d5a2e (208) -> var(--color-warn)
    sea            #2b7f95 (570,576), the tide underlay -> var(--color-sea)
    wind-k05       #2a76b8 (428,507,583,585) and the rgb() at 437
                   -> var(--color-wind-k05), same value
    now / gust     #bf6546 (321) #e0803a (384) -> var(--color-now-marker),
                   var(--color-gust), values unchanged (D12)
    shadow ink     #20424a1f (75,803) #1c465024 (758) #123c4b33 (601,685)
                   #12333c3d (548) -> 12/14/20/24% of var(--color-ink)
  The table is not repeated in src/dock.css: a literal in a comment is still a
  literal to the grep gate, so the file's header points here instead.
- 2026-09-20 agent: where an alpha was kept rather than collapsed to the opaque
  role, it was because the alpha carries a state or a depth the flat role would
  lose: .map-reach-chip rest 52% against hover 77% (and its 66% border), the
  switch track at 60% of line-strong so the white knob still reads on it, and
  the four shadow inks. Everything else took the plain role.
- 2026-09-20 agent: S4. Contrast computed for all 41 text/ground pairs the file
  changed, with the dock's real ground — src/compact.css sets .dock to solid at
  85%, and the map canvas is hidden in a shot, so what is behind it is
  .map-panel = --color-sea. Throwaway script, not committed. Nothing below
  4.5:1. Two pairs were pushed up a step to get there, and both are recorded
  because the item asks: .filter-switch.is-unavailable .switch-text and
  .filter-model.is-planned/.is-unavailable would have scored 3.22:1 as
  --color-ink-disabled, so they are --color-ink-muted (5.75:1); the unavailable
  state still reads, because the rows beside them are full ink and each carries
  its own words. .day-max would have scored 2.94:1 as ink-disabled; it is
  ink-muted (5.24:1), and the day band's sun times moved up to ink-2 (9.39:1) so
  the comment's "deliberately quieter than them" still holds. Lowest text pair
  now is 5.24:1 (ink-muted on the dock glass); the rest run 5.75 to 16.48.
  One non-text pair sits under 4.5: .wave-arrow, the ramp's 5 kn blue on the
  dock glass, at 3.90:1. It is a glyph, not text, it clears the 3:1 non-text
  threshold, and its value is D12's and unchanged.
- 2026-09-20 agent: first re-shoot flagged display-filter-1440 and
  display-filter-390 as MOVED — structure 12.45% and 7.78% gone. Cause was
  var(--color-scrim) on .display-filter::backdrop: the theme's scrim is 45%
  where the dock's own was 15%, and at full strength it washed the edges out of
  the map, the chart and the now line behind the panel. That is not "colour
  only". Held at 33% of the scrim, which is the dock's own weight to two
  decimals (0.451 x 0.33 = 0.149; the literal was 0.149), and the role is still
  named. Re-shot: both are colour only, structure 0.23% and 0.25%.
- 2026-09-20 agent: the @media (prefers-reduced-transparency: reduce) rule at
  the foot of the file now sets .chart-hover-card and .display-filter to the
  same --color-solid they already have, so it is a no-op. It was nearly one
  before (two opaque near-neighbours). Left alone because removing it is a
  selector change (S5). Integrator may want to drop it.
- 2026-09-20 agent: src/dock.css still holds nine var(--line) references, which
  are src/styles.css:16's variable, not the theme's --color-line. They are not
  literals, so they are outside this item's GOAL, and the sibling item
  map-theme-styles-compact owns that variable. Integrator: unify var(--line) and
  var(--color-line) once both lanes are in.
- 2026-09-20 agent: proved. Literal count: `grep -cE "#[0-9a-fA-F]{3,8}\b"
  src/dock.css` -> 0, and the same for rgb/hsl/hwb/lab/lch/oklab/oklch -> 0.
  Gates: npm test 56 files, 1160 passed; npm run build clean; npm run
  market:api:build clean; npm run ui:lint clean, 82 files, probe 7 cases;
  PREVIEW_PORT=4403 PORT=8903 npm run test:e2e -> 85 passed in 4.3m with the
  specs untouched, dock.spec.ts and model-layout.spec.ts included and "dock
  geometry at 820px" green on the first run. Shots: PREVIEW_PORT=4403 PORT=8903
  npm run map:shots re-shot all 36; `npm run shots:compare -- e2e/map/__baseline__`
  -> "36 shots - 0 identical, 36 colour only, 0 over 1.00%, 0 resized, 0 on one
  side only". Re-shot PNGs restored with `git checkout -- e2e/map/__baseline__`
  and not committed; the integrator re-shoots once after both map items land.
- 2026-09-20 agent: read the re-shot PNGs myself at both widths — dock-grid,
  dock-blend, dock-candles, display-filter, model-picker, forecast-sheet,
  warning, row-hover and the compare overlay. Every label, tab, chart frame and
  control is legible; the wind greens, the gust caps and the now line are
  exactly as before; nothing moved. Not visible in any shot, so not proved by
  eye: .row-tip and .chart-hover-card (both open on hover, and "row hover" shoots
  the search panel instead), .rain-cell's tint (no rain in the fixtures),
  .map-reach-chip and its hover, .observed-spark, .tide-fill/.tide-stroke, and
  the reduced-transparency rule. The rain tint's new form was checked separately
  in a browser: color-mix with `calc(22% * var(--rain-tint, 0))` computes to the
  same alpha the rgb() did at tint 0.5 and 1, and to fully transparent when the
  variable is unset.
- 2026-09-21 reviewer: signed off, with one role fixed and one question left
  open. What I looked at.
  S5: the two files tokenised with every colour value replaced by a placeholder
  come out as the same 816 declarations in the same order, one token apart (the
  rain cell, which changed form). Built CSS: 1008 top-level rules on each side,
  the same 71 of them differing, every one a colour.
  S1: sampled 39 of the 89 against the rule's selector and what it draws. Three
  were wrong: .median-line, .chart-arrow and .candle-body draw a white mark over
  the band's own wind colour and took --color-card, a surface role. The kit does
  this as `bg-warn text-ink-inverse` (ui/Button.tsx:34), so they are
  --color-ink-inverse now; both are #fff, so no pixel moves. The rest hold,
  including the two readings of #4f737c (sun times as ink-2, eyebrows as
  ink-muted) and the alphas kept for state or depth.
  @theme static: the only effect on the built CSS is eleven more declarations in
  :root (+321 bytes) — --color-gust, --color-now, --color-now-marker,
  --color-ok, --font-weight-medium, the four shadows and the two text-reading
  steps. Nothing removed, no value changed, no rule added, and MarketApp's CSS
  is byte-identical (same content hash) before and after. No Preflight: neither
  bundle holds a `*,::after,::before` rule. The comment says why.
  S2/S3: no hex outside ui/theme.css. Read ten alphas back out of the browser:
  12/14/20/24% of ink, 52/66/77% of card, 72% of ink-inverse, 33% of the scrim
  (0.1488 against the literal's 0.1490) — each the literal's own alpha to the
  rounded percent. --color-now-marker and --color-gust are the pre-existing
  literals unchanged and duplicate nothing in the theme (--color-now is #a8442e,
  --color-warn #854d31).
  D12: PALETTE and modelHue are not in the diff at all. In the shots, every
  pixel that sits exactly on the continuous wind ramp is unchanged — 3278 of
  them in dock-grid-1440, 10029 in dock-candles-1440, 3278 in dock-blend-1440,
  0 changed in each; so are all 386 #bf6546 now-marker pixels and all 477
  #a8442e ones. The gust cap has no opaque pixel (opacity .72), so I inverted
  it: predicting each cap pixel's new value from an unchanged #e0803a over the
  ground that moved under it lands within 1/255 on 81 of 82.
  S4: recomputed 39 text pairs and 14 marks myself, over the dock's real ground
  (src/styles.css --glass, a gradient of #ffffffdb to #edf7f4c9, over .map-panel
  #b8d0d7 — the note above calls this "solid at 85%" and "--color-sea", which is
  the sibling's file, not this one). Nothing below 4.5:1; the floor is 5.46:1
  (ink-muted on the darker gradient stop) and the four stepped-up pairs land at
  5.46 to 9.78. .wave-arrow is 4.06:1 as a glyph. No non-text mark is weaker
  than it was by more than 0.3, and the switch track and the cloud bars are
  stronger.
  Shots: re-shot all 36 at 4413/8913, compare says "36 shots - 0 identical, 36
  colour only, 0 over 1.00%". Opened all 36 overlays and both widths of every
  dock PNG. No edge moved anywhere. The only new edges are the pressed pill and
  the pressed unit button, whose white goes from 88%/48% to opaque card, and
  they are in the same place at the same size. Re-shot PNGs restored.
  The unproven surfaces, reached in a throwaway spec (not committed): .row-tip,
  .chart-hover-card (which also shows .chart-cursor and .wave-band), and
  .map-reach-chip at rest and hovered — all legible and Atlantic. The rain tint
  read back identical to the old rgb() at 0.5 and at 1, and transparent unset.
  .observed-spark, .tide-fill and .tide-stroke have no fixture data; their
  variables are in :root, so they resolve, but note that the tide underlay is
  much fainter under the Atlantic sea (stroke 1.29:1 -> 1.13:1) — worth a look
  when there is tide data.
  Left for the integrator, not changed here: the 5 kn blue reaches .wave-arrow,
  .rain-cell, .observed-spark and .wave-band as var(--color-wind-k05), and none
  of those four is wind. D12 and the file's own comments say the tie to the ramp
  was deliberate, so it stays, but if the epic's "wind colours mean wind speed
  only" is to hold literally, these want a name of their own at the same value.
  Also: the inventory says 51 distinct; it is 50 distinct colour values, 51 if
  the rgb() form is counted apart from the hex of the same colour.
  Gates, all green: npm test 1160 passed; npm run build; npm run
  market:api:build; npm run ui:lint; PREVIEW_PORT=4413 PORT=8913 npm run
  test:e2e 85 passed.
