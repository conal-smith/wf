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
WHY: The marketplace has no e2e coverage (playwright.config.ts testDir e2e holds the map's specs and the community's, none of them marketplace). Conversion needs a reference.
STATE:
- API runs without Postgres: MARKET_DB=memory, MARKET_AUTH_MODE=dev (market/api/src/env.ts:40-70).
- Dev tokens: `Bearer dev:<name>` (market/api/src/auth.ts:33). Client mirror: VITE_MARKET_DEV_USER; the e2e build reads the name from localStorage instead (VITE_MARKET_DEV_SWITCH, shared/web/auth.tsx).
- Vite proxies /api to 127.0.0.1:8787 (vite.config.ts:23-30); the e2e preview proxies to MARKET_API_PROXY.
- playwright.config.ts already boots that API in memory + dev mode for the community suite (e2e/community/api.ts) and has two projects, desktop and phone.
SPEC:
- S1 e2e/market/ spec boots the API in memory + dev mode, seeds a profile, 8 listings (one sold, one with no photo) and one review through the HTTP API.
- S2 Shoots: browse, browse with filters open (390), listing, listing signed out, sell (empty and with errors), me (each tab), seller, not-found, confirm dialog.
- S3 Output: e2e/market/__baseline__/<view>-<width>.png. Deterministic: fixed clock, fixed ids, animations off.
- S4 `npm run market:shots` runs it. A second run produces byte-identical or pixel-identical files.
TOUCH: e2e/market/*, playwright.config.ts (second project), package.json (script).
REUSE: e2e/fixtures.ts clock pinning. market/api/src/app.test.ts:38-67 harness for seed shapes.
AVOID: Changing marketplace code. Asserting pixels in CI yet; this item only records.
ACCEPT:
- [x] npm run market:shots writes >= 20 PNGs.
- [x] Two consecutive runs diff clean.
REFS: D7.
OPEN:
- The sell form's placeholders name real makers (market/web/pages/SellPage.tsx:314,366), so the sell shots record them. Editing that copy is marketplace code (AVOID); a later item could replace it with sizes and conditions instead.
- "Member since" comes from when the dev identity first asked the API for anything, so it is the month the shots were taken: two runs agree, two months do not. Pinning it needs a clock seam in e2e/community/api.ts, which the community specs share.
LOG:
- 2026-09-20 agent: STATE's "playwright.config.ts:9 testDir e2e is map-only" was stale on both counts — line 9 is the API port, and the community suite lives under e2e too. Corrected in place.
- 2026-09-20 agent: reused the API playwright.config.ts already boots (e2e/community/api.ts, memory repos + dev identities) rather than booting a second one; the shots seed over HTTP through the preview's /api proxy, so no third web server.
- 2026-09-20 agent: the shots do NOT run under `npm run test:e2e` (still 85 pass, ~4m). They write committed files, which a gate must not do as a side effect, and they would add ~40s of screenshotting to it. The market-shots project is only in the config when MARKET_SHOTS is set, so `playwright test` cannot pick it up and `npm run test:e2e` is untouched.
- 2026-09-20 agent: determinism is a clock pinned three days past the seed (the API stamps rows with the wall clock, so a constant would drift), photos drawn in e2e/market/photos.ts, reducedMotion + animations disabled, fonts awaited, every image forced eager and decoded, and the page scrolled to the top before the shutter. Ids are random but never drawn.
- 2026-09-20 agent: 35 PNGs, two consecutive runs byte-identical (sha256 over all 35). S2's list plus listing-review, listing-no-photo, listing-sold and listing-owner, which is where the rating form, the empty gallery, the sold chip and the owner's actions are the only time they are drawn.
- 2026-09-20 agent: added e2e/market/photos.ts to TOUCH's e2e/market/* — the baseline needs photos, and drawing them beats committing images.
