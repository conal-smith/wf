---
type: feature
status: ready
difficulty: m
criticality: high
risk: normal
epic: community-forum
iteration: 1
dependsOn: ui-kit, shared-web-extract, community-api-core
mockups: backlog/mockups/2026-09-20-community-atlantic.html
---

# Community web bundle: routing, shell, rail, API client

GOAL: /community loads a third bundle with the header, the channel rail and an empty main column, signed in or out.
STATE: Sections: force5/src/siteNav.ts:31 (map, market). Bundle switch src/main.tsx:13-18. SPA fallback public/_redirects (two /market rules). Router to copy: market/web/router.tsx.
SPEC:
- S1 siteNav: section { id community, href /community, label Community }, isCommunityPath. Site menu shows three rows in every bundle. e2e/site-menu.spec.ts updated.
- S2 src/main.tsx lazy-loads community/web/CommunityApp for /community paths. public/_redirects gains /community and /community/*.
- S3 Routes: /community, /community/following, /community/mentions, /community/c/:slug, /community/t/:id/:slug?, /community/u/:handle, /community/notifications. Unknown -> not-found Empty.
- S4 Shell: page measure 1200, header bar as the marketplace's with the chip reading Community, two-column grid 236px + 1fr, rail collapses to a full page below 900 (mockups 6a).
- S5 Header: New thread (primary only when the view has no primary of its own), bell with count, Clerk UserButton; signed out: Sign in.
- S6 Rail: search, Latest / Following / Mentions, categories with collapsible heads, channels with unread count (weight plus count, never colour alone), lock icon for staff-only channels, aria-current on the open channel.
- S7 community/web/api.ts on shared/web/http.ts. Hooks: useChannels, useNotificationsCount (on load, on focus, every 60 s).
- S8 Tailwind and ui/ only. No CSS file in community/web.
TOUCH: community/web/**, force5/src/siteNav.ts, force5/src/SiteMenu.tsx (icon map), src/main.tsx, public/_redirects, tsconfig.json, e2e/site-menu.spec.ts, deploy/local Caddyfile only if its fallback is path-listed (VERIFY).
AVOID: Page content (sibling items). Arbitrary values.
GATES: npm run ui:lint; npm run build; npm run test:e2e.
ACCEPT:
- [ ] /community renders shell and rail from the API in dev (memory repo): 4 categories, 10 channels.
- [ ] The map and marketplace bundles do not contain community code (check build chunks).
- [ ] Keyboard: rail is reachable, aria-current correct.
REFS: D22. Plan 7.1. Mockups 1, 6a.
