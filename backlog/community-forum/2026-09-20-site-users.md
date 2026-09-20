---
type: feature
status: ready
difficulty: m
criticality: high
risk: high
epic: community-forum
iteration: 1
---

# Replace market_profiles with one users table for the whole site

GOAL: One `users` row per Clerk account serves the marketplace and the community; /api/me reads and writes it.
STATE:
- market_profiles: market/api/migrations/0001_init.sql:5, contact check :15. FKs :20, 0002_reviews.sql:15-16, view :37.
- Repo: getProfile / upsertProfile repo.ts:57-58; 5 references in repo-pg.ts; mirrored in repo-memory.ts.
- Handlers: GET /me app.ts:407, PUT /me app.ts:426, listing gate "profile_required" app.ts:225.
- Client: market/web/pages/ProfileForm.tsx, MePage.tsx; identity prefill market/web/auth.tsx:87.
SPEC:
- S1 Migration 0003: `users (id text pk, handle text unique not null, display_name, avatar_url, county, bio, role text default 'member' check in (member,staff), suspended_until, contact_email, contact_phone, contact_whatsapp bool default false, created_at, updated_at)`. market_profiles dropped; FKs and market_seller_stats re-pointed. No row copying (D15).
- S2 site/api/: users repo (pg + memory), `ensureUser(sub)`: on first need, fetch name and image from Clerk via @clerk/backend (dev mode: derive from the dev name), generate a unique handle (slug of name, numeric suffix on clash).
- S3 GET/PUT /api/me at site level, mounted beside /api/market. /api/market/me keeps working by delegating, or the client moves; pick one and record it in LOG.
- S4 Contact is nullable on the table. POST /listings and PUT /listings/:id fail 409 `contact_required` when the seller has neither email nor phone.
- S5 handle: 3-30 chars, [a-z0-9-], reserved list (admin, staff, me, new, community, market).
- S6 Suspended user: every write route answers 403 `suspended`.
TOUCH: market/api/migrations/0003_users.sql, site/api/*, site/shared/*, market/api/src/{app,repo,repo-pg,repo-memory,index}.ts, market/shared/{types,validate}.ts, market/web/pages/{ProfileForm,MePage}.tsx, market/api/src/app.test.ts, market/api/tsconfig.json, tsconfig.json, vitest.config.ts.
AVOID: Compatibility views, data backfill, keeping both tables.
TRAP: tsconfig include lists (tsconfig.json:9, market/api/tsconfig.json:27) must gain site/ or the build silently skips it.
GATES: npm test; npm run market:api:build; npm run build.
ACCEPT:
- [ ] Fresh database: migrations apply; `\d users` matches S1; market_profiles absent.
- [ ] Tests: first call creates the row with a handle; clash gets a suffix; listing without contact -> 409 contact_required; suspended -> 403.
- [ ] Existing app.test.ts cases pass, updated only where the profile shape changed.
REFS: D15 D16. Plan 6.2.
