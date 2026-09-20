---
type: epic
status: ready
difficulty: xl
criticality: high
risk: high
mockups: backlog/mockups/2026-09-20-community-atlantic.html
dependenciesPlanned: true
updated: 2026-09-20T14:59:41.318Z
---

# Community forum, on Tailwind and the Atlantic palette

GOAL: /community ships (channels, threads, live flat conversations, following, a bell) on one Tailwind theme and kit that the marketplace and map then adopt.

CONTEXT:
- One npm package: Vite 7, React 19, Hono 4, postgres.js, zod 4, Clerk. Bundle by pathname: src/main.tsx:14, force5/src/siteNav.ts:31,39.
- API, market/api/src: createApp app.ts:65, optionalAuth :78, fail() :54, onError :80, mount :479, boot index.ts:36, auth (Clerk `sub` only) auth.ts:13-60, migrate() db.ts:38, ids.ts:7,23, upload keys storage.ts:48-57.
- Copy: Repo interface repo.ts:33 (pg + memory); tests over app.request() with `Bearer dev:<name>` (app.test.ts:38-67); zod shared with the browser (market/shared/validate.ts).
- Styling today: design/ (.f5-*, --sem-*); market.css reads only --sem-*; map CSS holds 237 colour literals.
- Long form: docs/COMMUNITY_FORUM_PLAN.md, cited "plan N".
- Gates: npm test; npm run build; npm run market:api:build; npm run ui:lint; npm run test:e2e.
- House rules: one filled action per view; warm = now or degraded; wind colours = wind speed only; state never by colour alone; one focus ring; tap targets >= 44px; sentence case; … not three dots. Name no other product or company in code, copy, comments or docs.

DECISIONS (ACCEPTED unless marked):
- D1 Tailwind 4 via @tailwindcss/vite, CSS-first.
- D2 ui/theme.css @theme is the only source of design values; Tailwind defaults removed.
- D3 No Preflight until the map CSS has no literals.
- D4 Components: React + tailwind-variants in ui/.
- D5 Palette Atlantic (plan 13.1); wind, warm, green unchanged.
- D6 Arbitrary values and colour literals banned; escape `ui-lint-allow: <reason>`.
- D7 Marketplace fully converted; market.css deleted; parity except colour. D8 design/ retired last.
- D9 PROPOSED Light only. D10 PROPOSED Kit gallery /ui, dev only.
- D11 Map CSS: literals -> theme variables, colour only. D12 Wind ramp, model hues, now-marker untouched.
- D13 PROPOSED Map's filled action = accent, or inverse if it reads as wind.
- D14 Categories -> site-made channels -> member threads -> flat messages with reply-to. No votes, no nesting.
- D15 One `users` table replaces market_profiles; no data carried; contact required only to publish a listing.
- D16 Same process and database: /api/community, community_* tables, site-level /api/me.
- D17 Opening post = message seq 0; per-thread seq; cursor pagination everywhere.
- D18 Bodies: text plus a small markdown subset, never HTML; mentions stored <@user_id>.
- D19 Follow: thread on start or reply, channel by choice. Notifications in-site; the bell polls; no email.
- D20 Live: SSE fed by LISTEN/NOTIFY, open thread only; fallback polls messages?after=.
- D21 Safety: member|staff; report -> staff notification; staff act in place; rate and new-member limits.
- D22 Two columns, no right panel; a thread is a page.
- D23 Nothing seeded in production; fixtures test-only.
- D24 Out: member or organisation channels, spot requests, presence, badges, sorts, related threads, typing, marked answers, ads.

CHILDREN, iteration 1 (`->` then, `|` parallel; edges = each item's dependsOn):
- UI: tw-setup-theme -> ui-kit. Any time: atlantic-tokens-interim.
- API: site-users -> community-schema-repo -> community-api-core -> (community-follow-notify -> community-safety | community-live). Also site-users -> shared-web-extract.
- WEB, after ui-kit, shared-web-extract, community-api-core: community-web-shell -> (community-web-feed -> community-web-following | community-web-thread -> community-spot-card) -> community-e2e.
Iteration 2: the nine items marked `iteration: 2`.

HOT FILES (one child at a time): package.json, package-lock.json, vite.config.ts, tsconfig.json, vitest.config.ts, src/main.tsx, force5/src/siteNav.ts, market/api/src/{app,index,db}.ts, market/web/{auth.tsx,api.ts,components.tsx}, community/api/{router,repo*}.ts, community/shared/types.ts, community/web/CommunityApp.tsx.
