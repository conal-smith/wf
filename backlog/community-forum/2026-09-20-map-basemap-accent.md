---
type: feature
status: ready
difficulty: s
criticality: normal
risk: normal
epic: community-forum
iteration: 2
dependsOn: map-theme-styles-compact, map-theme-dock
---

# Basemap water colour and the accent check

GOAL: The basemap sits in the Atlantic ramp, and the filled action is proven not to read as a wind value.
STATE: force5/src/WindMap.tsx:159 land #f0f1e8, :161 water #b8d0d7, applied only when VITE_BASEMAP_STYLE_URL is unset.
SPEC:
- S1 Water moves to the navy ramp near step 300 (#c3cfe2). Land stays. Values come from the theme, read once in TS, not re-typed.
- S2 Light-wind check: with a 0 to 9 kn field on screen (wind-k00..k09 blues), screenshot the dock with Play visible. If Play is confusable with the field, Play takes inverse (D13) and LOG records it.
- S3 meta theme-color in index.html updated to ground.
TOUCH: force5/src/WindMap.tsx, index.html, src/*.css (only for S2).
ACCEPT:
- [ ] Screenshot of the light-wind dock attached in LOG with the ruling.
- [ ] npm run test:e2e passes.
REFS: D13.
