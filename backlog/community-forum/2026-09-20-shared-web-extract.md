---
type: feature
status: ready
difficulty: s
criticality: high
risk: normal
epic: community-forum
iteration: 1
dependsOn: site-users
---

# Move the auth bridge and fetch core to shared/web

GOAL: The marketplace and the community import one Clerk bridge, one fetch core and one usePageTitle.
STATE: market/web/auth.tsx (100 lines, useMarketAuth, providers clerk|dev|none), market/web/api.ts:52-105 (fetch, bearer, error shape), usePageTitle components.tsx:719.
SPEC:
- S1 shared/web/auth.tsx exports useSiteAuth (same contract as useMarketAuth). market/web re-exports or imports it.
- S2 shared/web/http.ts: request(), bearer token, ApiError with { error, message, details }. market/web/api.ts keeps only marketplace endpoints.
- S3 shared/web/usePageTitle takes the section suffix as an argument.
- S4 No behaviour change in the marketplace.
TOUCH: shared/web/*, market/web/{auth.tsx,api.ts,components.tsx,api.test.ts}, tsconfig.json, vitest.config.ts.
AVOID: Restyling. Changing the env var names (VITE_CLERK_PUBLISHABLE_KEY, VITE_MARKET_API_URL, VITE_MARKET_DEV_USER).
GATES: npm test; npm run build.
ACCEPT:
- [x] market/web/api.test.ts passes.
- [x] grep: no fetch( outside shared/web/http.ts in market/web.
LOG:
- 2026-09-20 agent: anchors re-verified against 4dd1733, none had drifted: market/web/auth.tsx is 100 lines, the request core is market/web/api.ts:52-105, usePageTitle is market/web/components.tsx:719. STATE above describes the code before this item.
- 2026-09-20 agent: TOUCH grew by vitest.config.ts: its include list had no shared/**/*.test.ts, so the tests beside shared/web would never have run. One line added.
- 2026-09-20 agent: S1: shared/web/auth.tsx is the old file moved (git mv), MarketAuth -> SiteAuth, useMarketAuth -> useSiteAuth, MarketAuthProvider -> SiteAuthProvider. The one marketplace thing in it was BASE (where a sign-out lands), now the provider's `home` prop. market/web/auth.tsx re-exports the hook and type under the old names and wraps the provider with home={BASE}, so no page changed.
- 2026-09-20 agent: S2: shared/web/http.ts exports request(settings, method, path, body), ApiSettings { prefix, subject, getToken }, the ApiError body shape, ApiRequestError, API_ROOT (VITE_MARKET_API_URL) and sendBytes() for presigned upload slots. `subject` carries the section's name into the three fallback messages, so the marketplace's copy is word for word what it was and the community gets its own. sendBytes exists because ACCEPT bans fetch( from market/web and uploadPhoto had the second one. market/web/api.ts re-exports ApiRequestError, so the pages' imports stand. market/shared/types.ts still declares ApiError for the API side; it is outside TOUCH and the browser no longer reads it.
- 2026-09-20 agent: S3: shared/web/usePageTitle.ts exports usePageTitle(title, section) and the pure pageTitle(); the title is `${title} — wingfoil.ie ${section}`. market/web/components.tsx keeps a one-line usePageTitle(title) that passes "Market", so the five pages are untouched.
- 2026-09-20 agent: proved. npm test 379 passed (34 files; 17 tests are new: shared/web/{http,auth,usePageTitle}.test.ts and three S4 cases in market/web/api.test.ts pinning the /api/market URL, the bearer header and the offline copy); npm run build ok; npm run market:api:build ok; PREVIEW_PORT=4303 npm run test:e2e 65 passed, the marketplace specs in e2e/site-menu.spec.ts among them; `grep -rn "fetch(" market/web` finds nothing. npm run ui:lint skipped, the script does not exist.
- 2026-09-20 agent: not proved: the Clerk branch of the bridge (needs a browser and a real key; it is the old code with BASE read from a prop, typechecked only), and the usePageTitle effect itself (no DOM in the unit tests; pageTitle() is tested, the effect is the old one verbatim). No signed-in marketplace flow was driven by hand. Stopped here; status left for whoever merges.
- 2026-09-20 agent: review r1, fixed: the site image could not build. deploy/local/Dockerfile.web copies sources by name and .dockerignore is an allowlist, so shared/ never reached the image (nor did site/shared, which market/web has read since site-users). Both are copied now and `!shared/**` is allowed; `docker build -f deploy/local/Dockerfile.web --target build .` runs npm run build to the end. TOUCH grew by those two files.
- 2026-09-20 agent: review r1, fixed: the two "not proved" lines above now have tests. shared/web/auth.test.ts stands in for the identity provider's package and pins that `home` reaches afterSignOutUrl, signInFallbackRedirectUrl and signOut's redirectUrl, for /community and, through MarketAuthProvider, for /market. shared/web/usePageTitle.test.ts runs the effect by hand (title set, then restored) and the marketplace's own usePageTitle still ends "— wingfoil.ie Market". Each was checked to fail when the behaviour is broken. Also corrected http.ts's header, which said no other browser file calls fetch; the map does, for forecast files.
- 2026-09-20 agent: review r1, gates: npm test 383 passed (34 files); npm run build ok; npm run market:api:build ok; PREVIEW_PORT=4303 npm run test:e2e 65 passed; `grep -rn "fetch(" market/web` finds nothing; npm run ui:lint does not exist on this branch. Left for the owner: a real sign-in and sign-out against a live key. For the next item: ApiError is declared twice, shared/web/http.ts for the browser and market/shared/types.ts for the API (outside TOUCH); API_ROOT is exported and unused until the community's live stream needs the origin.
