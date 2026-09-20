---
type: feature
status: ready
difficulty: s
criticality: normal
risk: low
epic: community-forum
iteration: 2
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
- [x] >= 24 PNGs written.
- [x] Second run diffs clean.
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
