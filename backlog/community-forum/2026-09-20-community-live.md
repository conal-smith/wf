---
type: feature
status: ready
difficulty: m
criticality: high
risk: normal
epic: community-forum
iteration: 1
dependsOn: community-api-core
---

# Live replies in the open thread

GOAL: A reply posted in one browser appears in another browser's open thread within two seconds, with no refresh.
SPEC:
- S1 After commit, writes issue `NOTIFY community, '{"t":"msg|edit|remove|react","thread":"<id>","id":"<id>","seq":n}'`. Ids only.
- S2 community/api/hub.ts: one listening connection per process (postgres.js sql.listen), fan-out to subscribers in memory, keyed by thread. Memory repo: an in-process emitter with the same interface.
- S3 GET /threads/:id/events: text/event-stream, public, a comment line every 25 s, closes cleanly on client abort, caps subscribers per thread (200) and per IP (10).
- S4 The event carries ids; the client fetches messages?after=<last seq>. Reconnect uses the same call, so a dropped stream loses nothing.
- S5 Fallback: if the stream errors 3 times, the client polls messages?after= every 10 s.
TOUCH: community/api/{hub,handlers/events}.ts, community/api/hub.test.ts, market/api/src/index.ts (listener lifecycle on shutdown).
AVOID: WebSockets. A per-user stream. Typing indicators, presence (D24). Payloads with message bodies.
TRAP: the listening connection must not come from the pooled `max: 5` client used for queries (db.ts:8); open a dedicated one and close it on SIGTERM.
ACCEPT:
- [ ] hub.test.ts: publish -> subscriber receives once; unsubscribe on abort; heartbeat present.
- [ ] Manual or e2e: two contexts, reply in A shows in B < 2 s.
REFS: D20. Plan 6.4.
