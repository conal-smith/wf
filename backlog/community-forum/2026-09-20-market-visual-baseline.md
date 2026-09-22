---
type: feature
status: completed
difficulty: s
criticality: high
risk: low
epic: community-forum
iteration: 2
updated: 2026-09-20T22:54:48.129Z
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
- The sell form's placeholders name real makers (market/web/pages/SellPage.tsx:314,366), so the sell shots record them. Editing that copy is marketplace code (AVOID); a later item could replace it with sizes and conditions instead. The contact rows name a messaging service too (ListingPage.tsx:390, ProfileForm.tsx:182), which is harder to drop: there the name is the feature, not decoration.
- The baseline is this machine's. The site's type is fetched, not bundled (src/styles.css:1), so another Chromium or another font build draws it differently; the shots now fail rather than record a fallback face, but they cannot make two machines agree. The item that compares them should recapture, not diff across machines.
LOG:
- 2026-09-20 agent: STATE's "playwright.config.ts:9 testDir e2e is map-only" was stale on both counts — line 9 is the API port, and the community suite lives under e2e too. Corrected in place.
- 2026-09-20 agent: reused the API playwright.config.ts already boots (e2e/community/api.ts, memory repos + dev identities) rather than booting a second one; the shots seed over HTTP through the preview's /api proxy, so no third web server.
- 2026-09-20 agent: the shots do NOT run under `npm run test:e2e` (still 85 pass, ~4m). They write committed files, which a gate must not do as a side effect, and they would add ~40s of screenshotting to it. The market-shots project is only in the config when MARKET_SHOTS is set, so `playwright test` cannot pick it up and `npm run test:e2e` is untouched.
- 2026-09-20 agent: determinism is a clock pinned three days past the seed (the API stamps rows with the wall clock, so a constant would drift), photos drawn in e2e/market/photos.ts, reducedMotion + animations disabled, fonts awaited, every image forced eager and decoded, and the page scrolled to the top before the shutter. Ids are random but never drawn.
- 2026-09-20 agent: 35 PNGs, two consecutive runs byte-identical (sha256 over all 35). S2's list plus listing-review, listing-no-photo, listing-sold and listing-owner, which is where the rating form, the empty gallery, the sold chip and the owner's actions are the only time they are drawn.
- 2026-09-20 agent: added e2e/market/photos.ts to TOUCH's e2e/market/* — the baseline needs photos, and drawing them beats committing images.
- 2026-09-20 reviewer: checked each S line against the tree rather than the report. S1 seeds over HTTP as the two of them (8 listings, one sold, one with no photo, one review, one saved); S2's ten views are all present; S3's names, widths and determinism are as written; S4 runs the shots and nothing else. `npm run test:e2e` still collects 85 and rewrote no PNG.
- 2026-09-20 reviewer: one shot was not reproducible. seller-reviews-1240 flipped between two hashes roughly every other run — one shade of antialiasing along the left corner of the segmented control. Rastering a tile on several threads and reusing part of an earlier raster both move it, so the market-shots project now launches with --num-raster-threads=1 and --disable-partial-raster: twelve runs of that test, one hash, and two full runs of all 49 byte-identical with a clean tree after.
- 2026-09-20 reviewer: closed the "Member since" OPEN without the clock seam the community specs would have shared. The field is rewritten in the reply on its way into the browser (fixtures.ts pinMemberSince, which lets the photos past), so the seller page says April 2024 in whatever month the shots are taken. 17 shots redrawn.
- 2026-09-20 reviewer: the type comes over the network, which nothing said. A run without it would have recorded a fallback face and moved every line of all 49 files, silently. settle() now fails unless a DM Sans face is loaded; document.fonts.check is no use for this, it answers true for a family nobody has.
- 2026-09-20 reviewer: 14 shots added, each of them the only place something is drawn — sell-edit (the photo tiles, the cover chip, the reorder and remove tools), listing-contact (the panel behind the button, on the listing they had already enquired on so the shot records nothing new), browse-empty (also the only search box with anything in it, and the filter tokens), sell-contact (step 1, someone the API has never heard of), sell-signed-out (the only warn notice), me-signed-out (the gate), seller-sold (the only grid with a status on the cards).
- 2026-09-20 reviewer: left out, and why. The loading skeletons and the "could not be loaded" panes: the shutter refuses both on purpose, and reaching one means stalling or breaking the API mid-flight. The pager: pageSize is the constant 24 (market/shared/types.ts:90), so drawing one needs 25 listings, which would swamp the browse shot the conversion actually needs. The share control's "Link copied": a two-second icon swap behind a clipboard permission. The uploader's drag-over, busy and failed tiles: each needs a file drop. The profile form's errors: the same invalid Field that sell-errors already records at both widths.
- 2026-09-20 integrator: merged 4c210b7 into community-forum-2. playwright.config.ts conflicted with map-visual-baseline; both projects kept and the pattern renamed MARKET_SHOTS beside MAP_SHOTS. On the merged branch: npm test 1148 pass, build, market:api:build, ui:lint green, test:e2e 85 pass, then market:shots (49) and map:shots (36) re-shot with the tree left clean.
