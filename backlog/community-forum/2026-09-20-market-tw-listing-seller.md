---
type: feature
status: ready
difficulty: m
criticality: high
risk: high
epic: community-forum
iteration: 2
dependsOn: market-tw-shell-browse
---

# Convert the listing and seller pages to Tailwind

GOAL: ListingPage and SellerPage use ui/ and utilities; their .mk-* rules are deleted.
STATE:
- market/web/pages/ListingPage.tsx (598 lines): gallery, thumbs, price, spec list, contact reveal, save, share, review form.
- market/web/pages/SellerPage.tsx (226 lines): seller head, stats, histogram, reviews, tabs.
- CSS: market.css:671-969.
SPEC:
- S1 Detail grid 3fr / minmax(320px, 2fr); aside sticky under the header; below 900 the aside moves above the body (market.css:1483-1498).
- S2 Gallery 4:3, object-fit contain; thumbs 76x57, selected = outline, not opacity alone.
- S3 Stars, rating picker and histogram use accent for filled, line-strong for empty.
- S4 Sign-in gate unchanged: the action is offered and pressing it opens sign-in (ListingPage.tsx:227, :240, :404-415).
- S5 Converted rules deleted from market.css in the same change.
TOUCH: market/web/pages/ListingPage.tsx, market/web/pages/SellerPage.tsx, market/web/components.tsx (Stars, RatingPicker, SellerRating, SaveButton), market/web/market.css.
AVOID: Touching SellPage, MePage, ProfileForm (sibling market-tw-sell-me). Behaviour changes.
GATES: npm run ui:lint; npm test; market:shots compare.
ACCEPT:
- [ ] Listing and seller shots differ from baseline in colour only.
- [ ] grep finds no `mk-detail`, `mk-gallery`, `mk-thumb`, `mk-specs`, `mk-seller`, `mk-stars`, `mk-histogram`, `mk-review` in market/web.
REFS: D7.
LOG:
- 2026-09-22 agent: anchors re-verified against b891ab0. ListingPage.tsx 598 and SellerPage.tsx 226 lines, exact. The sign-in gate sits at :225, :238 and :402-415, not :227, :240, :404-415. market.css drifted when shell-browse deleted its rules: the detail, seller and rating rules are :256-557, not :671-969, and the <900 block is :1032-1047, not :1483-1498. Stars :227, RatingPicker :259, SellerRating :301, SaveButton :820 in components.tsx.
- 2026-09-22 agent: resumed an interrupted run. b891ab0 (the kit's Pane `standing`, Button `pressed="worded"`, and grid-cols-detail/-specs/-meter, all pinned in ui/tv.test.ts and ui/kit.test.tsx) was already committed. The page conversion was nearly done but not committed. Finished it as below, then committed it.
- 2026-09-22 agent: THE PATTERN kept. Recipes live beside what they draw and are exported: listingStyles in pages/ListingPage.tsx, sellerStyles in pages/SellerPage.tsx, ratingStyles in components.tsx. All three are in RECIPES, and both pages are in CONVERTED. The only literal classNames left are the shared `mk-empty__actions` and `mk-skeleton` hooks. Links that look like buttons wear `buttonStyles` (All listings, Edit listing), and links in text wear `linkStyles`. shell.test.ts's GONE list uses the tightened `\.mk-<name>(?:__…|--…)?(?![\w-])` pattern, over market.css and over the markup of the three converted files. No new ui/theme.css value in this change, so nothing new to pin.
- 2026-09-22 agent: S1 `rail:grid-cols-detail`. Every placement class carries `rail:`, so below 900 the children stack in source order: gallery, aside, body. The aside is `rail:sticky rail:top-22.5`, which is 90px, the same sum market.css wrote, and it clears the 70px header. S2: 4:3 frame, object-contain, thumbs `w-19 aspect-4/3` (76x57). The chosen thumb is marked with an outline (2px, offset 1, accent) as well as opacity. S3: accent for earned and line-strong for empty, on the marks, the picker and the histogram fill. S4: the gate is lifted into an exported `gated()` with the same branches, and tested both ways, plus an SSR render of the aside signed in and signed out. S5: every converted rule is deleted, plus the `.f5-button--pill[aria-pressed]` override that the worded toggle replaces.
- 2026-09-22 agent: fixes to the inherited diff. (1) The prior run turned four `<section>`s per page into Pane `<div>`s, which dropped the "Seller" region and the aria-labelledby regions (a behaviour change). They are `<section className={paneStyles(…)}>` again, and a test asserts the labelled region. (2) The kit's sunken Pane has no border, but `.mk-pane--sunken` had a transparent 1px one. The rating breakdown and the contact box are `border border-transparent` again, which takes back a 2px shrink of both boxes (seller-1240 was 1262 -> 1260). (3) The thumb's chosen state was a box-shadow ring with a card-coloured offset. It is an outline again, as market.css had it, written `aria-pressed:not-focus-visible:` so the focus ring still takes its place. (4) At 390 the kit Button's `shrink-0 whitespace-nowrap` pushed the share button 23px past the panel edge. The primary is now `min-w-0 … leading-tight whitespace-normal`, so it wraps inside its 46px as before, at the old 18.2px leading. (5) Tabs got `py-0 leading-tight`, back to the old 15.6px leading. (6) A hovered picker star gets no hover box (`not-disabled:hover:bg-transparent`), as `[data-lit]` had `background: none`. (7) The ACCEPT grep hit a comment in shell.test.ts, now reworded.
- 2026-09-22 agent: measured parity. Every element's box, font, padding, outline, position and top was dumped after settle in the shots' own contexts, on this tree and on a scratch worktree of b891ab0, and diffed element by element. At 1240, all 11 listing and seller views match to the 0.1px. The only differences are line-height and a 1px UA block padding on fixed-height kit buttons, which move no box (shell-browse delta f). At 390, every size change is the ruled coarse-pointer minimum: All listings 30->44, gallery steps 40->44, Mark as sold / Update review 40->44, picker stars 30->44, tabs 34->44 (track 42->52). Everything else is those growths pushing boxes down.
- 2026-09-22 agent: the deltas that were taken. (a) The 390 tap targets above: +14 on every page, +18 or +32 with the review form, +24 on seller. The body colour under the footer grows with them, as ruled in the shell-browse LOG. (b) At 390 the share button is 46 wide where market.css let flex squeeze it to 39.4-42.7, under the 44 minimum. The primary beside it gives back 3.3-6.7px (164.5->159.1 on listing-390). (c) The seller head reuses `grid-cols-detail`, whose second-column floor is 320 where `.mk-seller-head` had 260. That moves nothing at 1240 or below 900; the only difference is between 900 and about 920px wide. One template instead of a near-copy in the theme. (d) "Remove listing" and "About <listing>" take the kit's link underline offset (shell-browse delta c). (e) The sunken panes take the kit's bg-sunken where .mk-pane--sunken was bg-content (colour). (f) Ids lost their prefix (seller-name, listing-review-title, listing-review-comment). Nothing else reads them.
- 2026-09-22 agent: gates. npm run ui:lint clean (83 files, probe 7). npm test: 57 files, 1235 pass, 75 skipped. npm run build and market:api:build green. market:shots then shots:compare: 49 shots, 27 identical, 12 colour only, 0 over 1.00%, 10 resized. All 11 listing/seller shots at 1240 have structure <= 0.22%; the 0.22% on listing-owner is the link underline in (d). The 10 resized are the 390 listing/seller shots, all of it (a) and (b). PREVIEW_PORT=4421 PORT=8921 npm run test:e2e: 84 passed, 1 failed (model-layout.spec.ts "dock geometry at 390px", a map spec). Run on its own it passed 4/4. Re-shot PNGs not committed.
- 2026-09-22 agent: ACCEPT grep. Clean for mk-detail, mk-gallery, mk-thumb, mk-specs, mk-seller, mk-stars and mk-histogram. `mk-review` still hits market.css:278-293 and MePage.tsx:334, which is market-tw-sell-me's page (AVOID). The seller page no longer reads it. The sibling's branch converts MePage but keeps the rule, so ON MERGE: delete `.mk-review` and its two pseudo-class rules from market.css, and the grep is clean. `.mk-avatar` stays here too, because Avatar in components.tsx is not in this item's TOUCH.
