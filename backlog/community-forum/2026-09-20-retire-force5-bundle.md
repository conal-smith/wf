---
type: feature
status: ready
difficulty: s
criticality: normal
risk: normal
epic: community-forum
iteration: 2
dependsOn: market-tw-listing-seller, market-tw-sell-me, map-theme-dock, map-theme-styles-compact
---

# Retire the Force5 bundle

GOAL: design/ and the design:* scripts are gone; the rules that mattered live in docs/DESIGN_PRINCIPLES.md; Preflight is on.
STATE:
- package.json scripts design:build, design:lint. design/scripts/*.mjs.
- Importers of design/*: force5/src/siteMenu.css, market/web/market.css (deleted by then). VERIFY with grep before starting.
SPEC:
- S1 force5/src/SiteMenu.tsx renders with ui/ components; force5/src/siteMenu.css deleted. Behaviour (Escape capture, focus return, blur close) unchanged: e2e/site-menu.spec.ts passes untouched.
- S2 docs/DESIGN_PRINCIPLES.md: accent rule, warm rule, wind rule, ceilings, Don't list, plus dated rulings: Atlantic (plan 13), Tailwind as the system (plan 14), one neutral family and one accent.
- S3 design/ removed. design:* scripts removed. README sections that cite them updated.
- S4 Preflight enabled (D3 lifted) only if map-atlantic is complete; the e2e suite proves no shift.
TOUCH: design/**, package.json, force5/src/SiteMenu.tsx, force5/src/siteMenu.css, README.md, market/README.md, ui/theme.css, docs/DESIGN_PRINCIPLES.md.
AVOID: Deleting design/ while any import of it remains.
OPEN: design/ is registered in the Studio Design door. Owner unregisters it there; agents must not edit .sprintengine/.
ACCEPT:
- [ ] `grep -r "design/" src force5 market community ui --include=*.css --include=*.ts --include=*.tsx` returns nothing.
- [ ] npm run build, npm test, npm run test:e2e pass.
REFS: D3 D8.
LOG:
- 2026-09-22 integrator (market-tw-sell-me): market/web/market.css is deleted, so force5/src/siteMenu.css is the only importer of design/ left in the ACCEPT grep's dirs. When it went, its site-menu overrides moved into siteMenu.css: SiteMenu now takes `ground?: "map" | "content"` (data-ground), and the marketplace header passes `ground="content"` for a card pill (card fill, ink hairline, control shadow), a solid unblurred panel, and the quiet hover on every row. S1 has to keep that look for the marketplace when the menu is drawn from ui/; the 49 market shots and 36 map shots are the check.
