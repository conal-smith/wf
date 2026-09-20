---
type: feature
status: completed
difficulty: s
criticality: normal
risk: low
epic: community-forum
iteration: 2
updated: 2026-09-20T22:29:43.853Z
---

# Capture a visual baseline of the map

GOAL: One command writes screenshots of every map state at 1440 and 390 wide from the pinned-clock e2e site.
STATE: e2e specs assert behaviour, not appearance. No screenshots are kept.
SPEC:
- S1 States: idle map, search open, layers panel, spot popup, forecast dock (grid, blend chart, candle chart), display filter, model picker, forecast sheet (390), info dialog, site menu open, error state, stale-snapshot warning.
- S2 Output e2e/map/__baseline__/<state>-<width>.png. Animations and particles frozen.
- S3 `npm run map:shots`. Two consecutive runs diff clean.
TOUCH: e2e/map/*, playwright.config.ts, package.json.
REUSE: e2e/fixtures.ts, scripts/e2e-site.mjs.
AVOID: Changing map code.
ACCEPT:
- [x] >= 24 PNGs written. 36, at e2e/map/__baseline__.
- [x] Second run diffs clean. Proved by the reviewer over all 36, sha256.
LOG:
- 2026-09-20 agent: built as e2e/map/shots.spec.ts, 14 states x 2 widths = 28 PNGs in
  e2e/map/__baseline__. Anchors verified: e2e/fixtures.ts (SAMPLE_CLOCK), scripts/e2e-site.mjs,
  playwright.config.ts and package.json are all where SPEC says.
- 2026-09-20 agent: the shots do NOT run under `npm run test:e2e` (still 85 pass, 3.9m).
  A gate that rewrites the files it will later be compared against is not a gate, and the
  capture adds a minute and a network dependency on the font and basemap-style hosts.
  playwright.config.ts gives them a `map-shots` project that exists only when MAP_SHOTS is
  set, and `npm run map:shots` is the one caller; the desktop project ignores the file.
- 2026-09-20 agent: basemap tiles. The suite fetches them from the real endpoint and stubs
  it only to test the failure (e2e/map.spec.ts:708), so there is no fixture to reuse and no
  way to pin them without touching src/ (AVOID). The shots therefore keep the raster out of
  the comparison: a test-side style rule hides .maplibregl-canvas, leaving everything the
  map's own CSS draws — container, markers, popout, panels, dock. The style is still
  fetched, so the map still loads and the error state is still reachable. Wind colours and
  the particle field ride on that canvas and are not in the baseline; both are D12
  (untouched by the colour work) anyway.
- 2026-09-20 agent: determinism. reducedMotion: reduce for the whole file freezes the
  particle field, the camera easing and the transitions; `animations: "disabled"` at the
  shutter; document.fonts.ready awaited (styles.css:1 fetches its faces); the clock comes
  from e2e/fixtures.ts over the fixed sample calendar (--profile fixtures, FIXTURE_RUNS),
  which is the same bytes every run and every day. One consequence is visible: the layers
  panel shows Moving particles unchecked and disabled, with its reduced-motion note.
- 2026-09-20 agent: two states needed a correction after looking at the PNGs. The stale
  warning used page.clock.install as e2e/map.spec.ts:679 does; an installed clock holds the
  timers the map loads through, and the shot was of "Opening Ireland…" — setFixedTime
  instead. And the idle shot was byte-identical to the blend one, since the dock opens on
  the nearest spot: the idle shot now closes the forecast panel first.
- 2026-09-20 agent: S1's "forecast sheet (390)" is captured at both widths like every other
  state, so the baseline is a uniform pair per state; at 1440 it is the same sheet, docked.
- 2026-09-20 reviewer: ran the shots against the committed PNGs on another machine. Twenty
  seven of the twenty eight came back byte for byte; idle-390 did not. Closing the forecast
  panel at 390 gives the map its height back a frame later, and `settled` watched only the
  marker, which does not move when the map resizes — the committed shot was of the map at
  its old size. `settled` now watches the map panel and the credits too, and runs inside
  `shoot`, so every state waits rather than the four that remembered to ask.
- 2026-09-20 reviewer: `document.fonts.ready` resolves on a failed fetch as happily as on a
  good one, so a run with the font host unreachable would have written the whole baseline in
  the fallback face and said nothing. `shoot` now fails unless a DM Sans face reports
  `loaded` and no face reports `error`. Manrope is the wordmark's alone and the map never
  draws it, so it is not asked after.
- 2026-09-20 reviewer: four states added, 36 PNGs. The warm banner (.frame-status.is-error,
  #854d31 on #fff4e8), the spinner (#c0d4d4, #286a7a), the focus ring (#176b91, the one ring
  the house rules allow) and hover (#ffffff40) were in no shot: warning, model-loading,
  focus-ring and row-hover reach all four, from recipes e2e/map.spec.ts already uses.
- 2026-09-20 reviewer: checked the rest. The staged weather is the fixtures profile, whose
  runs are the fixed FIXTURE_RUNS and whose `generatedAt` is that run time, so Date.now() is
  never read and the shots are the same tomorrow. Two consecutive runs of all 36 were
  byte-identical. `npm run test:e2e` neither runs the file nor rewrites a PNG: 85 tests, and
  the 36 sha256 were unchanged after it. Gates green: npm test 1148, build, market:api:build,
  ui:lint, test:e2e 84 of 85, the odd one out being model-layout at 820px, which is a 1px
  disagreement in a spec this branch does not touch and which passes on its own.
- 2026-09-20 reviewer: left as found. The basemap style is still fetched even though the
  canvas is hidden, and one run in four lost it: the map drew no markers and `openMap` timed
  out, so the run failed loudly and wrote nothing rather than writing something else. Pinning
  it would mean inventing a style, and a symbol layer wants glyphs, so the retry stands. The
  display options dialog is clipped by its own scroll at both widths, so the swatches below
  ECMWF ENS and GEFS are in no shot — model hues, which D12 holds untouched. `.legend*` in
  styles.css is drawn by nothing in src/ and cannot be shot at all.
- 2026-09-20 integrator: merged ce8b380 into community-forum-2; npm test 1148 pass, build, market:api:build, ui:lint green. test:e2e is re-run once both baselines are merged.
