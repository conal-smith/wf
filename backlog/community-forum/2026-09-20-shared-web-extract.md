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
TOUCH: shared/web/*, market/web/{auth.tsx,api.ts,components.tsx,api.test.ts}, tsconfig.json.
AVOID: Restyling. Changing the env var names (VITE_CLERK_PUBLISHABLE_KEY, VITE_MARKET_API_URL, VITE_MARKET_DEV_USER).
GATES: npm test; npm run build.
ACCEPT:
- [ ] market/web/api.test.ts passes.
- [ ] grep: no fetch( outside shared/web/http.ts in market/web.
