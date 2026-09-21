---
type: feature
status: ready
difficulty: s
criticality: normal
risk: normal
epic: community-forum
iteration: 2
dependsOn: map-theme-styles-compact, map-theme-dock
---

# Basemap water colour and the accent check

GOAL: The basemap sits in the Atlantic ramp, and the filled action is proven not to read as a wind value.
STATE: force5/src/WindMap.tsx:159 land #f0f1e8, :161 water #b8d0d7, applied only when VITE_BASEMAP_STYLE_URL is unset.
SPEC:
- S1 Water moves to the navy ramp near step 300 (#c3cfe2). Land stays. Values come from the theme, read once in TS, not re-typed.
- S2 Light-wind check: with a 0 to 9 kn field on screen (wind-k00..k09 blues), screenshot the dock with Play visible. If Play is confusable with the field, Play takes inverse (D13) and LOG records it.
- S3 meta theme-color in index.html updated to ground.
TOUCH: force5/src/WindMap.tsx, force5/src/basemap.ts, index.html, src/*.css, ui/theme.css, tests/basemap.test.ts, tests/ui-theme.test.ts, backlog/evidence/2026-09-21-map-basemap-accent/.
ACCEPT:
- [x] Screenshot of the light-wind dock attached in LOG with the ruling.
- [x] npm run test:e2e passes.
REFS: D13.
OPEN: the scrubber's thumb is the accent on a track painted with the wind ramp, and it
is the one accent mark with wind colour under it rather than beside it. Measured on the
light-wind shots it is 77 from the nearest colour the ramp can make and 107 from the
nearest wind cell on the same screen, against 2.2 for a whole knot between neighbouring
cells, and it carries a 3px white ring no wind mark has — so it reads as a control. It
is not the filled action, so D13 does not reach it and nothing was changed. If the owner
ever wants it off the accent, `--color-inverse` is the step the selected marker already
uses and it would read the same way.
OPEN: `.forecast-table .wind-cell`'s wash is drawn by nothing today.
`.compact-layout .forecast-table .wind-cell` sets `background-image: none` (src/compact.css:368),
and `.app-shell` is always `compact-layout` (src/App.tsx:468), so the 22% bar behind a
number never reaches the screen. It is still given its own name here, because the rule
is live code that would draw the water the day the layout stops being compact. Whether
the rule should exist at all is the owner's call, not a colour question.
LOG:
- 2026-09-21 agent: anchors re-verified before editing. force5/src/WindMap.tsx:159 is
  `background-color`, `#f0f1e8`, and :161 is `fill-color`, `#b8d0d7`, both inside the
  `if (!import.meta.env.VITE_BASEMAP_STYLE_URL)` at :156 — STATE was exact and is left
  as it was written. The lines have moved down by the reader this item adds.
- 2026-09-21 agent: the code path is the live one. `VITE_BASEMAP_STYLE_URL` is set in no
  `.env` file (there is none but `.env.example`, where it is commented out), in no script
  and in no CI step, so a dev run and the e2e site both take the default style and both
  run the recolour. Confirmed on the running site: the map's two commonest colours with
  the wind layer switched off are `#f0f1e8` at 42.3% of the frame and `#c3cfe2` at 34.5%.
- 2026-09-21 agent: the two jobs `--color-sea` was doing are now two names, which is the
  first of the two answers the styles-compact OPEN asked for. `--color-sea` #9db0cc keeps
  the ground the map floats on (src/styles.css:109) and the dock's tide underlay
  (src/dock.css:588,594), both of which are water. The forecast cell's fill bar is a
  quantity and not water, so it takes `--color-wash`, added at #9db0cc — the same value
  it draws today, so no pixel moves, and a name of its own so the water could move
  without it. The basemap's own two fills are `--color-basemap-water` #c3cfe2 (the ramp's
  step 300, plan 13.2) and `--color-basemap-land` #f0f1e8 (unchanged; the one map value
  the Atlantic ramp does not hold).
- 2026-09-21 agent: S1, how the values are read. force5/src/basemap.ts takes a
  `Pick<CSSStyleDeclaration, "getPropertyValue">` and returns the two trimmed strings;
  WindMap calls it once, in the map's mount effect, with
  `getComputedStyle(document.documentElement)`. The theme is on the document by then:
  ui/theme.css is `@theme static`, so every `--color-*` is written to `:root` whether a
  utility asks for it or not, and src/main.tsx:7 imports it — a render-blocking
  stylesheet in a build, an injected tag in dev, both before the first effect. There is
  no fallback hex, because a fallback is the re-typing S1 forbids: an empty value makes
  the caller skip `setPaintProperty`, so an embedder who never imported the theme gets a
  legible map in the provider's own palette and, in dev, a console warning saying so.
  Tested in the tests/camera.test.ts idiom (a helper out of the .tsx, tested from
  tests/): tests/basemap.test.ts, four cases — the names match what ui/theme.css declares,
  values are trimmed, an absent theme yields two empty strings, and the paint block in
  WindMap.tsx holds no hex.
- 2026-09-21 agent: S2, the light-wind field. No committed fixture is light enough end to
  end: over all six wind bundles the grid runs 0.2 to 22.6 kn, and only 8 of ECMWF's 85
  frames are under 9 kn everywhere; the longest run of sub-9 kn hours at any spot is 2
  columns. So the field was made rather than found, without touching a committed fixture:
  `.e2e/` is git-ignored scratch that scripts/e2e-site.mjs rewrites from scratch every
  run, and a throwaway script multiplied every u, v and gust there by 0.38 — in each
  manifest's `spotForecasts` and in every frame, the int16 blocks rewritten in place
  (the digest in a frame's file name is cache busting, nothing reads it back). Fastest
  cell anywhere afterwards: 7.7 kn. The site was then built and served at 4405 and shot
  with the canvas VISIBLE, at 1440 and 390, tiles and style over the network, the clock
  pinned to SAMPLE_CLOCK as e2e/fixtures.ts pins it.
  backlog/evidence/2026-09-21-map-basemap-accent/light-wind-dock-1440.png,
  backlog/evidence/2026-09-21-map-basemap-accent/light-wind-dock-390.png,
  backlog/evidence/2026-09-21-map-basemap-accent/light-wind-controls-1440.png.
- 2026-09-21 agent: D13 RULED — the map's filled action stays on the accent. Play does
  not take inverse.
  Read off the pixels of the two shots above, at both widths. The play button is
  rgb(20,99,255). The nearest colour the wind ramp can produce anywhere in its 0-65 kn
  range is 77 away in sRGB, and the nearest wind cell actually on the screen is 107 away
  at 1440 and 118 at 390. For scale, a whole knot between neighbouring cells in that same
  row is worth a median of 2.2 and the nearest pair is 0.0: the accent is two orders of
  magnitude further from a reading than the difference this palette asks a reader to see.
  Looking at the shots rather than the numbers: on a screen where the map, the scrubber
  track and every cell in the wind row are the same soft k05 blue, the play button is the
  only saturated thing in the frame. It is a disc, it is on the glass and not on the
  water, it carries a white glyph, and it sits in a row of controls. A rider glancing at
  the dock reads it as the button that runs the forecast. Nothing in the frame invites
  reading it as a speed — no wind mark is a disc, and no wind mark is that colour.
  This is the case plan 13.2 asked to see before shipping, and it holds at the hard end:
  the whole field under 8 kn, which is further into the blues than any committed fixture
  goes.
- 2026-09-21 agent: the selected hour, looked at in the same light. The dock review
  expected `th.selected-hour`'s 21% accent tint to lie on wind-coloured cells. Measured,
  it does not. `.compact-layout .forecast-table .wind-cell` sets `background-color:
  var(--wind-colour)` at (0,3,0), which outranks `.forecast-table td.selected-hour`'s
  background at (0,2,1), and the map is always `compact-layout` (src/App.tsx:468). So
  the tint reaches the header band and the rows that carry no wind colour, and the wind
  row is marked instead by `.compact-layout .forecast-table .selected-hour`'s inset
  rules, accent at 36% and 21%, down the column's two edges. Sampled: the chosen column's
  wind cell is rgb(100,160,207) and the same cell unchosen is rgb(100,159,207) — the
  choice moves it by 1.0, where a knot is worth 2.2. The selection cannot be read as a
  speed because it does not change the speed's colour. No change, and no OPEN: there is
  nothing here to rule on.
- 2026-09-21 agent: S3. `<meta name="theme-color">` was #f7f8f4, the old palette's
  ground; it is #f4f6fa now, `--color-ground`, which is what `:root` paints
  (src/styles.css:10). index.html cannot read a variable, so the hex is written out with
  a comment saying where it comes from, and tests/ui-theme.test.ts now reads the two and
  asserts they are equal — it already compiled the theme, so the test is three lines.
- 2026-09-21 agent: TOUCH gained five entries. ui/theme.css and tests/ui-theme.test.ts,
  because S1 says the values come from the theme and the theme's colour set is pinned;
  force5/src/basemap.ts and tests/basemap.test.ts, because the repo's way of testing a
  WindMap helper is to keep it out of the .tsx (force5/src/camera.ts, tests/camera.test.ts)
  and there is no DOM environment in vitest to import WindMap.tsx into; and the evidence
  directory. src/*.css was in TOUCH for S2 only — src/styles.css:849 is changed for the
  wash split instead, which is S1's business, since that is the line that would have
  moved with the water.
- 2026-09-21 agent: gates. npm test 57 files, 1170 passed, 75 skipped (56 files and 1160
  on the epic branch: tests/basemap.test.ts is the new file, and ui-theme gains six cases
  — three colours and three assertions). npm run build. npm run market:api:build.
  npm run ui:lint clean, 82 files, probe 7 cases. PREVIEW_PORT=4405 PORT=8905
  npm run test:e2e: 85 passed. Map baseline: re-shot with `PREVIEW_PORT=4405 PORT=8905
  npm run map:shots` and compared with `npm run shots:compare -- e2e/map/__baseline__` —
  "36 shots - 36 identical". The baseline hides the map canvas, so the basemap's two
  colours are not in it, and the wash the split renamed is not drawn in the compact
  layout: nothing this item changes is inside a shot. No re-shoot needed. Re-shot PNGs
  restored with `git checkout -- e2e/map/__baseline__`.
