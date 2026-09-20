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

# Convert the sell and account pages, then delete market.css

GOAL: SellPage, MePage and ProfileForm use ui/; market/web/market.css no longer exists.
STATE:
- market/web/pages/SellPage.tsx (648), MePage.tsx (372), ProfileForm.tsx (182).
- CSS: forms market.css:1056-1211, photo uploader :1213-1298, list rows :971-1054.
SPEC:
- S1 Field, TextInput, TextArea, Select from ui/. Invalid field = warn border and warn ground plus the message, never colour alone.
- S2 Photo uploader: tiles 4:3, add tile dashed, busy = dimmed, cover badge, reorder tools on glass.
- S3 Me tabs use Segmented; count badge inside the tab.
- S4 Whole-page sign-in gate stays an Empty with one primary (MePage.tsx:50-70).
- S5 When this and market-tw-listing-seller are both merged: market.css and its import are deleted, and the @import of design/* in it goes with it.
TOUCH: market/web/pages/SellPage.tsx, MePage.tsx, ProfileForm.tsx, market/web/components.tsx, market/web/market.css, market/web/MarketApp.tsx (css import).
AVOID: Validation or upload logic. market/shared.
TRAP: site-users rewrites ProfileForm's data shape and lands in iteration 1. Re-verify every anchor here against it.
GATES: npm run ui:lint; npm test; market:shots compare.
ACCEPT:
- [ ] Sell, me and profile shots differ from baseline in colour only.
- [ ] market/web/market.css is absent; `grep -r "mk-" market/web` returns nothing.
- [ ] npm run build output contains no .f5- or .mk- selectors from the marketplace chunk.
REFS: D7.
