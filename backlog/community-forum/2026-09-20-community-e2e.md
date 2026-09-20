---
type: feature
status: completed
difficulty: m
criticality: high
risk: normal
epic: community-forum
iteration: 1
dependsOn: community-web-thread, community-web-following, community-safety
---

# End-to-end: post, reply, live arrival, follow, report

GOAL: One Playwright run proves the forum's main paths against the memory API with dev users.
SPEC:
- S1 Boot: API with MARKET_DB=memory and MARKET_AUTH_MODE=dev, site preview, fixtures created through the HTTP API in test setup only (D23).
- S2 Signed out: browse home, a channel, a thread; composer shows the sign-in gate.
- S3 aoife starts a thread; cian replies in a second context; aoife's open thread shows the reply without reload; her bell count rises within the poll window (clock stepped).
- S4 cian mentions aoife -> a separate mention row. aoife sets the thread to nothing -> a further reply raises no count.
- S5 aoife reports a message -> the staff user's bell shows it; staff removes it -> both contexts render it as removed.
- S6 Phone project (390): channels -> channel -> thread -> reply.
- S7 Accessibility smoke: axe on home, channel, thread, dialog: no serious or critical violations. NEW-DEP @axe-core/playwright (dev).
TOUCH: e2e/community/*, playwright.config.ts, package.json. Added: package-lock.json, shared/web/auth.tsx, shared/web/auth.test.ts, community/web/components/TagPills.tsx, community/web/feed.test.ts (LOG).
ACCEPT:
- [x] npm run test:e2e passes locally, map suite included and unchanged.
- [x] No test writes to a database other than the memory repo.
REFS: D19 D20 D21 D23.
OPEN:
- S1 says fixtures come through the HTTP API only. Three things cannot: staff (users.role is written by hand, community-safety S1, and no route grants it), a member's age (new for a day: no mentions, no links) and the pace limit (one message every three seconds). e2e/community/api.ts settles them at boot: one named person is staff from their first request, accounts are made two days old, and the limiter never refuses. Threads, replies, follows and reads are all made over HTTP. The three-message half of being new is left in, and the conversation spec posts those.
- The dev identity was one name a build (VITE_MARKET_DEV_USER), and S2 to S5 need nobody, two members and staff on one build. A build made with VITE_MARKET_DEV_SWITCH (only `preview:e2e` sets it) reads the name from localStorage instead. It is a dev identity either way: a build with the identity provider's key never reaches it, and the API refuses `dev:` tokens in production. If a second build is preferred to the switch, that is a decision for the epic.
LOG:
- 2026-09-20 agent: verified against dd6c599. The item holds no path:line anchors. All three dependsOn are on the epic branch. The worktree held an earlier, uncommitted pass at this item on this branch; it was read through, run and finished rather than reset, since the branch had no commits of its own and HEAD was already the epic's.
- 2026-09-20 agent: S1 as built. playwright.config.ts boots two servers: e2e/community/api.ts (createApp over the three memory repos, the memory hub, dev identities and local storage under .cache/, which is ignored) on PORT or 8797, never reused, and the preview with MARKET_API_PROXY at it. api.ts throws unless MARKET_DB=memory and MARKET_AUTH_MODE=dev, and imports nothing of Postgres. Two projects: desktop (every spec there was, plus four new) and phone (e2e/community/phone.spec.ts alone, 390x844, touch). The community specs run on the wall clock, since the API stamps with it; the conversation spec installs a clock on the one page whose bell it steps.
- 2026-09-20 agent: TOUCH grew, and why. shared/web/auth.tsx and its test: the switch above (three tests: the kept name, a build that did not ask, and never under the identity provider). community/web/components/TagPills.tsx: S6 found a channel page scrolling sideways at 390, because the tag strip's nav is a flex item whose least width was the whole unwrapped strip; it takes min-w-0, and the phone spec fails without it (checked by putting the old file back). community/web/feed.test.ts: one assertion pinned the nav's opening tag to having no class. package-lock.json: the NEW-DEP.
- 2026-09-20 agent: the API outlives a test and its people are the same few names, so a spec that counts a bell first marks it read over HTTP (fixtures.ts readAll) and titles are unique per try. Found by the first whole run: cian's bell held a reply from the accessibility spec when the report spec asked it to be empty. npx playwright test e2e/community/ --repeat-each 2 passes against the one API.
- 2026-09-20 agent: proved. ACCEPT 1: PREVIEW_PORT=4315 PORT=8815 npm run test:e2e, 85 passed (80 before, all still there and none of their files changed; five new tests, one per spec file, S2 signed-out, S3 and S4 conversation, S5 report, S6 phone, S7 accessibility). ACCEPT 2: the only API the suite can reach is api.ts, which holds no Postgres code; started with MARKET_DB=postgres and a DATABASE_URL it exits with "The e2e API runs on MARKET_DB=memory and MARKET_AUTH_MODE=dev only"; nothing under e2e/ or in playwright.config.ts reads DATABASE_URL, and the older community specs answer /api by route.
- 2026-09-20 agent: gates. npm test 1148 passed, 75 skipped (the Postgres repo tests, no DATABASE_URL); npm run build ok; npm run market:api:build ok; npm run ui:lint clean over 82 files; npm run test:e2e 85 passed. Both ports were free afterwards.
- 2026-09-20 agent: review r1. Two assertions of a quiet bell could pass without biting: the bell reads "Notifications" both when the count is nothing and before it has drawn the answer, and waitForResponse settles before the page has. S4's "set to nothing" and S5's "the author has heard nothing" now hold the API's own count to 0 as well as the bell (conversation.spec.ts nextCount answers with the number; report.spec.ts reads the count the reload asks for). Proved to bite: with aoife left on every reply the S4 step fails, expected 0 received 1; with TagPills put back the phone spec fails, as the LOG above says. Also checked: e2e/community and playwright.config.ts typecheck under strict with a throwaway tsconfig (no tsconfig of the repo includes e2e/, as before this item); api.ts started with MARKET_DB=postgres exits with its own error. Gates on this head: npm test 1148 passed, 75 skipped; build ok; market:api:build ok; ui:lint clean; test:e2e 85 passed.
- 2026-09-20 agent: not covered: S3's fallback (polling messages?after= when the stream is down) is not driven here, only the stream; S7 runs the rules engine on four views signed in, not on the notifications popover or the report dialog.
- 2026-09-20 integrator: merged f63b0ae; gates npm test 1148 passed, 75 skipped; build ok; market:api:build ok; ui:lint clean over 82 files; test:e2e 85 passed. No conflicts; npm install added the two packages of the NEW-DEP and left the lockfile as merged. The two OPEN lines stand for the owner.
