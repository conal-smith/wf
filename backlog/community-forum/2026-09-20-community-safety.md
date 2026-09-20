---
type: feature
status: ready
difficulty: m
criticality: high
risk: normal
epic: community-forum
iteration: 1
dependsOn: community-follow-notify
---

# Safety floor: staff actions, reports, limits

GOAL: The forum can be opened to the public: abuse has a ceiling, a report reaches staff, staff can act from the thread.
SPEC:
- S1 users.role staff is set by hand in the database. No UI grants it.
- S2 POST /messages/:id/report {reason, note?} -> row in community_reports and one notification, kind report, to every staff user. 5 per reporter per day.
- S3 Staff only: POST /threads/:id/pin|unpin|lock {reason}|unlock|remove; DELETE /messages/:id on any message; PUT /users/:id/suspend {until|null}. Each writes community_mod_log.
- S4 Removed message renders as removed (no body) to everyone but staff. Removed thread 404s for non-staff.
- S5 Rate limits, in-process token bucket per user per action: message 1 per 3 s and 60 per hour; thread 5 per hour; reaction 60 per minute; report 5 per day. 429 { error: "rate_limited", retryAfter }.
- S6 New member = account under 24 h or fewer than 3 visible messages: no http(s) links in bodies (400 `links_not_yet`), 3 threads per day, no mentions.
- S7 Suspended users: 403 on every write (from site-users S6).
TOUCH: community/api/{limits,handlers/moderation,handlers/reports}.ts, router.test.ts.
AVOID: A moderation queue screen, a moderator role, word filters, email (D21).
ACCEPT:
- [ ] Tests for S2-S6 including the clock: limits reset, new-member state ends at the third message.
- [ ] A member calling a staff route gets 403 and no mod_log row.
REFS: D21. Plan 6.5.
