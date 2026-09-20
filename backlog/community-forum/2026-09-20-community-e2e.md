---
type: feature
status: ready
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
TOUCH: e2e/community/*, playwright.config.ts, package.json.
ACCEPT:
- [ ] npm run test:e2e passes locally, map suite included and unchanged.
- [ ] No test writes to a database other than the memory repo.
REFS: D19 D20 D21 D23.
