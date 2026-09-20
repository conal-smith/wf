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

# Following, mentions, unread and the notification rows

GOAL: Replying follows the thread; followers and mentioned members get grouped notification rows; the API serves the bell.
SPEC:
- S1 Starting or replying sets follows(thread, level all, source auto) unless a manual row exists. PUT /threads/:id/follow {level: all|mentions|none}. PUT /channels/:slug/follow {on}.
- S2 User setting autoFollow (default true) on users; when false S1 writes nothing.
- S3 On a new message, in the same transaction: one notification per thread follower with level all, except the author, kind reply, upserted on (user_id, thread_id, kind) where unread: count += 1, actor and message updated. One per mentioned user, kind mention, never grouped. level none suppresses both; level mentions suppresses reply.
- S4 On a new thread: one notification, kind thread, per follower of the channel except the author.
- S5 Reactions to your message: kind reaction, grouped per message, excluded from the count.
- S6 GET /notifications/count -> { count }. GET /notifications?cursor. PUT /notifications/read { ids? | threadId? | all }.
- S7 PUT /threads/:id/read {seq} updates reads and marks that thread's notifications read. GET /channels unread = threads with last_message_at > channel_seen.seen_at, capped at 99.
- S8 GET /feed?tab=following (followed threads with activity plus new threads in followed channels, each with `why`: started|replied|channel) and tab=mentions.
- S9 New members (S-rule in community-safety) cannot mention.
TOUCH: community/api/handlers/{follow,notifications}.ts, repo*.ts, router.test.ts, site/api (autoFollow).
AVOID: Email, push, SSE for the bell, following members or spots (D24).
ACCEPT:
- [ ] Tests: 4 replies by 2 people -> one unread row, count 4, two actors. Mention -> its own row. level none -> no rows. Opening the thread clears them.
- [ ] Notification writes share the message's transaction: a forced failure leaves neither.
REFS: D19. Plan 3.
