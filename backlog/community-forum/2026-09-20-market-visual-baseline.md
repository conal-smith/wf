---
type: feature
status: ready
difficulty: s
criticality: high
risk: low
epic: community-forum
iteration: 2
---

# Capture a visual baseline of every marketplace view

GOAL: One command writes screenshots of every marketplace route at 1240 and 390 wide, before any conversion starts.
WHY: The marketplace has no e2e coverage (playwright.config.ts:9 testDir e2e is map-only). Conversion needs a reference.
STATE:
- API runs without Postgres: MARKET_DB=memory, MARKET_AUTH_MODE=dev (market/api/src/env.ts:40-70).
- Dev tokens: `Bearer dev:<name>` (market/api/src/auth.ts:33). Client mirror: VITE_MARKET_DEV_USER.
- Vite proxies /api to 127.0.0.1:8787 (vite.config.ts:23-30).
SPEC:
- S1 e2e/market/ spec boots the API in memory + dev mode, seeds a profile, 8 listings (one sold, one with no photo) and one review through the HTTP API.
- S2 Shoots: browse, browse with filters open (390), listing, listing signed out, sell (empty and with errors), me (each tab), seller, not-found, confirm dialog.
- S3 Output: e2e/market/__baseline__/<view>-<width>.png. Deterministic: fixed clock, fixed ids, animations off.
- S4 `npm run market:shots` runs it. A second run produces byte-identical or pixel-identical files.
TOUCH: e2e/market/*, playwright.config.ts (second project), package.json (script).
REUSE: e2e/fixtures.ts clock pinning. market/api/src/app.test.ts:38-67 harness for seed shapes.
AVOID: Changing marketplace code. Asserting pixels in CI yet; this item only records.
ACCEPT:
- [ ] npm run market:shots writes >= 20 PNGs.
- [ ] Two consecutive runs diff clean.
REFS: D7.
