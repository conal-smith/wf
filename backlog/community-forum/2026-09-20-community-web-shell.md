---
type: feature
status: completed
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
STATE: Sections: force5/src/siteNav.ts:31 (map, market). Bundle switch src/main.tsx:14-15 (lazy import and flag) and :35-38 (render branch). SPA fallback public/_redirects (two /market rules). Router to copy: market/web/router.tsx.
SPEC:
- S1 siteNav: section { id community, href /community, label Community }, isCommunityPath. Site menu shows three rows in every bundle. e2e/site-menu.spec.ts updated.
- S2 src/main.tsx lazy-loads community/web/CommunityApp for /community paths. public/_redirects gains /community and /community/*.
- S3 Routes: /community, /community/following, /community/mentions, /community/c/:slug, /community/t/:id/:slug?, /community/u/:handle, /community/notifications. Unknown -> not-found Empty.
- S4 Shell: page measure 1200, header bar as the marketplace's with the chip reading Community, two-column grid 236px + 1fr, rail collapses to a full page below 900 (mockups 6a).
- S5 Header: New thread (primary only when the view has no primary of its own), bell with count, Clerk UserButton; signed out: Sign in.
- S6 Rail: search, Latest / Following / Mentions, categories with collapsible heads, channels with unread count (weight plus count, never colour alone), lock icon for staff-only channels, aria-current on the open channel.
- S7 community/web/api.ts on shared/web/http.ts. Hooks: useChannels, useNotificationsCount (on load, on focus, every 60 s).
- S8 Tailwind and ui/ only. No CSS file in community/web.
TOUCH: community/web/**, force5/src/siteNav.ts, force5/src/SiteMenu.tsx (icon map), src/main.tsx, public/_redirects, tsconfig.json, e2e/site-menu.spec.ts, deploy/local Caddyfile only if its fallback is path-listed (VERIFY: it is not). Added: ui/theme.css, ui/tv.ts, ui/tv.test.ts (three theme names), force5/src/siteNav.test.ts, tests/bundle-isolation.test.ts, tests/spa-fallback.test.ts, e2e/community-shell.spec.ts.
AVOID: Page content (sibling items). Arbitrary values.
GATES: npm run ui:lint; npm run build; npm run test:e2e.
ACCEPT:
- [x] /community renders shell and rail from the API in dev (memory repo): 4 categories, 10 channels.
- [x] The map and marketplace bundles do not contain community code (check build chunks).
- [x] Keyboard: rail is reachable, aria-current correct.
REFS: D22. Plan 7.1. Mockups 1, 6a.
LOG:
- 2026-09-20 agent: anchors re-verified against 2dbf632. siteNav.ts:31 and the two /market rules in public/_redirects were right. src/main.tsx had drifted: the lazy import and the flag are :14-15 and the render branch :35-38 (the item said 13-18); STATE corrected. deploy/local/Caddyfile:69 falls back with `try_files {path} /index.html` for every path, so it is not path-listed and is untouched.
- 2026-09-20 agent: TOUCH grew. ui/theme.css, ui/tv.ts, ui/tv.test.ts: S4 needs 1200, 236px + 1fr and 900px and arbitrary values are banned (D6, AVOID), so they are theme names: max-w-page, grid-cols-shell, rail: and max-rail:. force5/src/siteNav.test.ts, tests/bundle-isolation.test.ts, tests/spa-fallback.test.ts (new) and e2e/community-shell.spec.ts (new) are the tests S1, S2 and S3-S6 owe.
- 2026-09-20 agent: S1: the third section and isCommunityPath (/community and under it, not /community-guidelines); the menu's icon map gains its row. e2e/site-menu.spec.ts holds the three rows, in order, in the map, the marketplace and the community, and crosses into the community and back.
- 2026-09-20 agent: S2: tests/spa-fallback.test.ts holds public/_redirects to exactly a root rule and a /* rule per section with a bundle of its own, and to no blanket rule; tests/bundle-isolation.test.ts holds the community's graph clear of the map, the marketplace and community/api, and the reverse.
- 2026-09-20 agent: S3: community/web/router.tsx is the marketplace's router under /community. The seven routes plus not-found; New thread is a URL (?new=1 over the channel, or over home) so a sign-in on the way comes back to it; the dialog is community-web-feed's. Known routes render an empty main column: page content is the sibling items'.
- 2026-09-20 agent: S4: below 900 the rail is the page at /community and hidden elsewhere, where the main column gains a Channels link back (mockups 6a). S5: New thread is filled except on a thread (Reply is that view's primary) and on not-found (its way back is); on a phone the bar drops New thread, as the mockup does. With dev auth the member's name stands where the Clerk UserButton does, as in the marketplace.
- 2026-09-20 agent: S6: a count is quiet up to four and filled from five; the open channel shows none. A thread lights no row: the shell does not know a thread's channel until its page has loaded (community-web-thread can pass it down). Search pushes /community?q=; the results are community-web-feed's.
- 2026-09-20 agent: S7: useChannels reads /meta for categories and /channels for the viewer's unread. useNotificationsCount asks GET /notifications/count, which is community-follow-notify S6 and answers 404 until that item merges; a failed ask keeps the number the bell had, so the bell reads 0 until then. A hidden tab skips its minute and asks on return.
- 2026-09-20 agent: S8: community/web/shell.test.ts checks every class in every recipe against the theme and that the directory holds and imports no stylesheet; npm run ui:lint clean over 51 files.
- 2026-09-20 agent: proved. ACCEPT 1: API on MARKET_DB=memory MARKET_AUTH_MODE=dev MARKET_STORAGE=local PORT=8810, vite dev on 4311 with MARKET_API_PROXY and VITE_MARKET_DEV_USER; a browser at /community/c/wings got 200 /meta and /channels, drew 4 category heads and 10 channel links, aria-current on Wings. ACCEPT 2: npm run build writes CommunityApp-*.js; "api/community", "Search the community" and "community:navigate" occur in that chunk only, not in index-*.js, MarketApp-*.js or the shared http-*.js. ACCEPT 3: e2e/community-shell.spec.ts tabs from the search field through the feeds, heads and channels in order, moves aria-current by Enter without a page load, and folds a head by keyboard.
- 2026-09-20 agent: gates. npm test 796 passed, 51 skipped (the Postgres repo tests, no DATABASE_URL); npm run build ok; npm run ui:lint clean; npm run test:e2e 75 passed (PREVIEW_PORT=4310). The first e2e run failed one assertion: the lock's hidden words began with a comma and the accessible name read "Announcements , staff posts only"; the comma is gone.
- 2026-09-20 agent: review round 1. Read the whole diff against SPEC, ACCEPT and the epic's decisions; nothing in the product code needed changing. Re-proved ACCEPT 1 (API on memory at 8810, vite dev at 4310 as a dev member: 200 /meta and /channels, 4 heads, 10 channels, aria-current on Wings, New thread the one filled control, none on a thread) and ACCEPT 2 (the three marker strings occur in CommunityApp-*.js only). Fixed one gap in the tests: nothing held S7's "nothing is asked of a signed-out reader", so e2e/community-shell.spec.ts now holds a signed-out load to the rail's two reads; it fails when the guard in useNotificationsCount is removed. A trial merge onto community-forum 21d61bd is clean. Gates: npm test 796 passed, 51 skipped; npm run build ok; npm run market:api:build ok; npm run ui:lint clean; npm run test:e2e 75 passed (PREVIEW_PORT=4310).
- 2026-09-20 integrator: merged 765d79c; gates npm test 858 passed, 71 skipped; npm run build ok; npm run market:api:build ok; npm run ui:lint clean (51 files). The merge was clean and package.json did not change. GET /notifications/count is on the epic branch since community-follow-notify merged (d4b60d2), so the bell no longer asks into a 404.
