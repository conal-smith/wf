---
type: feature
status: ready
difficulty: s
criticality: normal
risk: low
epic: community-forum
iteration: 1
dependsOn: community-web-thread
---

# A spot on a thread

GOAL: A thread that names a spot shows that spot's name, a link to its forecast on the map and, if cheap, the current wind.
STATE: Spots: public/riding-locations.json (25). Per-point series on the map: src/usePointSeries.ts. VERIFY it can be called outside the map bundle without importing maplibre.
SPEC:
- S1 The card sits under the opening post: name, county, link to the map focused on the spot.
- S2 Wind reading (speed, direction, gust, now) only if the series loader imports cleanly into the community bundle with < 15 KB added. Otherwise ship S1 and record the finding in LOG.
- S3 The swatch colour is the wind ramp stop for the speed; the number stays in ink.
- S4 The API stores spot_id only and knows nothing about weather.
TOUCH: community/web/components/SpotCard.tsx, force5/src (read-only reuse).
AVOID: A spots panel on any other page. Requesting or adding spots (D24).
ACCEPT:
- [ ] A thread with a spot shows the card; one without shows nothing.
- [ ] Bundle-size delta recorded in LOG.
REFS: D12 D24. Plan 4.
