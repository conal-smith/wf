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
- [ ] >= 24 PNGs written.
- [ ] Second run diffs clean.
