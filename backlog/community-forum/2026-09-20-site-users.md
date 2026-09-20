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
- Client: market/web/pages/ProfileForm.tsx, MePage.tsx; identity prefill market/web/auth.tsx:86.
SPEC:
- S1 Migration 0003: `users (id text pk, handle text unique not null, display_name, avatar_url, county, bio, role text default 'member' check in (member,staff), suspended_until, contact_email, contact_phone, contact_whatsapp bool default false, created_at, updated_at)`. market_profiles dropped; FKs and market_seller_stats re-pointed. No row copying (D15).
- S2 site/api/: users repo (pg + memory), `ensureUser(sub)`: on first need, fetch name and image from Clerk via @clerk/backend (dev mode: derive from the dev name), generate a unique handle (slug of name, numeric suffix on clash).
- S3 GET/PUT /api/me at site level, mounted beside /api/market. /api/market/me keeps working by delegating, or the client moves; pick one and record it in LOG.
- S4 Contact is nullable on the table. POST /listings and PUT /listings/:id fail 409 `contact_required` when the seller has neither email nor phone.
- S5 handle: 3-30 chars, [a-z0-9-], reserved list (admin, staff, me, new, community, market).
- S6 Suspended user: every write route answers 403 `suspended`.
TOUCH: market/api/migrations/0003_users.sql, site/api/*, site/shared/*, market/api/src/{app,repo,repo-pg,repo-memory,index}.ts, market/shared/{types,validate}.ts, market/web/pages/{ProfileForm,MePage}.tsx, market/api/src/app.test.ts, market/api/tsconfig.json, tsconfig.json, vitest.config.ts, market/web/pages/SellPage.tsx, market/api/src/db.ts, market/Dockerfile, .dockerignore, package.json, market/README.md.
AVOID: Compatibility views, data backfill, keeping both tables.
TRAP: tsconfig include lists (tsconfig.json:9, market/api/tsconfig.json:17) must gain site/ or the build silently skips it. site/ sits outside market/, so market/api/tsconfig.json rootDir moves to the repository root and the emitted entry becomes market/api/dist/market/api/src/index.js.
GATES: npm test; npm run market:api:build; npm run build.
ACCEPT:
- [x] Fresh database: migrations apply; `\d users` matches S1; market_profiles absent.
- [x] Tests: first call creates the row with a handle; clash gets a suffix; listing without contact -> 409 contact_required; suspended -> 403.
- [x] Existing app.test.ts cases pass, updated only where the profile shape changed.
REFS: D15 D16. Plan 6.2.
OPEN:
- OPEN: PUT /api/me does not write avatar_url. Plan 6.2 says the person can change name, avatar and handle, but no avatar upload exists yet and accepting an arbitrary image URL would let one member log every viewer's address. The column is filled from Clerk once; a later item needs an upload route under the site's storage prefix.
- OPEN: a seller with live listings can clear their contact through PUT /api/me (the site level knows nothing of listings). The listings stay up and the contact endpoint then answers with nulls. The marketplace form asks for contact while you have live listings; the API does not enforce it.
- OPEN: GET /listings/:id/contact records an enquiry, so it is a write behind a GET and S6 (keyed on the method) lets a suspended member through it.
- OPEN: the `profile-required` review reason is still in ReviewEligibility and market/web/pages/ListingPage.tsx:546, but the API no longer answers it (the reviewer's row is made on PUT review). Remove both when ListingPage is next open.
LOG:
- 2026-09-20 agent: anchors re-verified against d6ece75. Two had drifted: market/api/tsconfig.json include is :17 not :27; the identity prefill in market/web/auth.tsx is :86. Corrected above.
- 2026-09-20 agent: S3 choice: /api/market/me delegates. PUT /api/market/me is the site's own PUT /api/me handler (meHandlers in site/api/router.ts); GET /api/market/me builds its MePayload around ensureUser, so `profile` is never null now. The client keeps calling /api/market/me and market/web/api.ts (hot) is untouched.
- 2026-09-20 agent: S1: 0003 truncates market_listings and everything hanging off it before re-pointing the FKs. With no row copying (D15) the old seller ids would break the new constraint and boot would fail; proved on a database loaded with 0001+0002 rows. Added `users_handle_shape` check (S5 in the table).
- 2026-09-20 agent: S2: handle = slug of the name (accents folded), then -2, -3 on clash, cut to 30; names with nothing usable become "member"; reserved handles are skipped, so "Admin" gets admin-2. With only CLERK_JWT_KEY set, or when the lookup fails, the row starts as "Member" and the request still succeeds.
- 2026-09-20 agent: S6: one middleware, blockSuspended (site/api/router.ts), on the whole market router and on /api/me; it acts on any non-GET carrying a user. Added UsersRepo.setSuspendedUntil so tests (and community-safety later) can suspend.
- 2026-09-20 agent: PUT /api/me answers 409 `handle_taken` with details.handle; a handle left out of the body is kept, so the old client body still saves.
- 2026-09-20 agent: TOUCH grew. SellPage.tsx: its gate was `!profile`, which is never true now, so a seller with no contact would fill the whole form and meet a bare 409; it now gates on hasContact. db.ts, Dockerfile, .dockerignore, package.json (market:api:start): forced by the rootDir move in TRAP (new dist path, migrations lookup, site/ copied into the image). market/README.md: it documented the dropped table and the old gate.
- 2026-09-20 agent: COUNTIES moved to site/shared/types.ts (users.county validates against it); market/shared/types.ts re-exports it, and Profile / ProfileInput are now aliases of the site's User / UserInput.
- 2026-09-20 agent: proved. npm test 341 passed (30 files); npm run market:api:build; npm run build. Postgres 16 in a throwaway container (not the market:db volume, which 0003 would have emptied): built API started with `node market/api/dist/market/api/src/index.js` applied 0001-0003; `\d users` matched S1; market_profiles absent; three FKs and market_seller_stats point at users; through HTTP on the pg repos: first GET /api/me made the row, second "Aoife" got aoife-2, listing without contact 409 contact_required, handle clash 409, suspended 403 on writes and 200 on reads, review by a member with no prior row 201.
- 2026-09-20 agent: also proved: npm run test:e2e 65 passed (PREVIEW_PORT=4302); `docker build -f market/Dockerfile .` builds with site/ in the image, and the image booted against Postgres, found market/api/migrations from the new dist path, applied 0001-0003 and answered GET /api/me. npm run ui:lint skipped: the script does not exist yet.
- 2026-09-20 agent: not proved: the Clerk lookup against a real Clerk instance (no key here; typechecked against @clerk/backend 3.18.1 only). Stopped here; status left for whoever merges.
