---
type: feature
status: ready
difficulty: m
criticality: high
risk: high
epic: community-forum
iteration: 2
dependsOn: ui-kit, market-visual-baseline
---

# Convert the marketplace shell and browse page to Tailwind

GOAL: MarketApp shell, header, footer, browse page and listing cards use ui/ and utilities; none of their .mk-* rules remain.
STATE:
- Shell: market/web/MarketApp.tsx:38-51 (.mk-root, data-mode="light").
- Header: components.tsx:104-173. Footer: components.tsx:671-688. ListingCard:297, ListingGrid:375, GridSkeleton:394.
- Browse: market/web/pages/BrowsePage.tsx (381 lines).
- Accent rule in code: accentSell, MarketApp.tsx:33-36.
SPEC:
- S1 Layout, spacing and breakpoints (720, 900) match the baseline. Colour changes to Atlantic; nothing else.
- S2 Page measure 1200px, form measure 760px, as market.css:104-129.
- S3 Phone (<720): labels drop from header, category rail scrolls on one line bleeding to the edge, filters fold behind one 44px toggle, 2-up grid (market.css:1500-1600).
- S4 accentSell behaviour unchanged.
- S5 Card hover lift, image zoom, sold = greyscale, all off under prefers-reduced-motion.
- S6 The rules converted here are deleted from market.css in the same change.
TOUCH: market/web/MarketApp.tsx, market/web/components.tsx, market/web/pages/BrowsePage.tsx, market/web/market.css.
REUSE: ui/ kit. Do not restyle a control locally; add a variant to ui/ if one is missing, and say so in LOG.
AVOID: Behaviour changes. Router, api.ts, auth.tsx. Arbitrary values.
GATES: npm run ui:lint; npm test; npm run market:shots then compare to baseline.
ACCEPT:
- [ ] Browse and header shots at 1240 and 390 differ from baseline in colour only (overlay check, reviewer signs off in LOG).
- [ ] grep finds no `mk-header`, `mk-card`, `mk-grid`, `mk-rail`, `mk-filters`, `mk-footer` in market/web.
- [ ] Keyboard: tab order and focus ring unchanged.
REFS: D7.
