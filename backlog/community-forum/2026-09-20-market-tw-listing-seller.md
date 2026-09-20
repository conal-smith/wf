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
