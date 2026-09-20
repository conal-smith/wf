---
type: feature
status: ready
difficulty: l
criticality: high
risk: normal
epic: community-forum
iteration: 1
dependsOn: community-schema-repo
---

# Community API: channels, feed, threads, messages, reactions, photos, search

GOAL: A signed-out reader can browse and a signed-in member can start threads, reply, react and attach photos, all through /api/community.
STATE: Router pattern to copy: market/api/src/app.ts:70-511 (createApp :70, mounts :498-509). Upload presign: app.ts:452 POST /uploads with key ownership storage.ts:55.
SPEC:
- S1 community/api/router.ts exports createCommunityRouter(deps); mounted at /api/community in createApp with optionalAuth on the subtree.
- S2 GET /meta; GET /channels (with unread when signed in); GET /feed?tab=latest&cursor; GET /channels/:slug/threads?tag&cursor (pinned first, then last activity); GET /threads/:id (thread, opening post, a page around the viewer's last read); GET /threads/:id/messages?after|before|around (by seq); GET /search?q&cursor.
- S3 POST /channels/:slug/threads {title, body, tagIds, photoKeys, spotId?} -> 201. post_policy staff -> 403 for members.
- S4 POST /threads/:id/messages {body, replyToId?, photoKeys} -> 201. Locked thread -> 409 `locked`.
- S5 PUT /messages/:id (author, within editWindowMin) ; DELETE /messages/:id (author any time, soft). Deleting seq 0 removes the thread.
- S6 PUT /messages/:id/reactions/:emoji {on}. Emoji outside REACTIONS -> 400. messages.reactions jsonb kept in step in the same transaction.
- S7 Photos reuse the presign flow with prefix `community`; keys not issued to the caller are rejected.
- S8 Body sanitising: stored as typed; mention tokens <@user_id> resolved and validated at write; at most 5.
- S9 Every :id checked against ID_PATTERN before any query. Errors { error, message, details? }. bodyLimit 64 KB on writes.
- S10 ensureUser(sub) on first write.
TOUCH: community/api/{router,handlers/*}.ts, community/api/router.test.ts, market/api/src/app.ts, market/api/src/storage.ts (prefix parameter), market/api/src/errors.ts (fail(), moved out of app.ts), market/api/src/index.ts and market/api/src/app.test.ts (createApp takes the community repo), community/shared/types.ts (MetaPayload, ThreadView).
REUSE: fail(), onError, requireAuth, newId, ID_PATTERN, bodyLimit, the storage drivers.
AVOID: Follows, notifications, SSE, moderation (sibling items). Fetching any external URL.
GATES: npm test; npm run market:api:build.
ACCEPT:
- [x] router.test.ts covers S2-S9 with dev tokens over the memory repo, including 401, 403, 404-on-bad-id, 409 locked, cursor paging across 65 messages.
- [x] Signed-out GETs carry no viewer fields.
REFS: D16 D17 D18. Plan 6.3.
LOG:
- 2026-09-20 agent: anchors re-verified against 213a3fd and corrected in STATE. app.ts had drifted: createApp was :73 and the mount :501 (the item said 65-479); storage.ts:52 keyBelongsTo was right. STATE now gives the lines as this change leaves them.
- 2026-09-20 agent: TOUCH grew, four files. market/api/src/errors.ts: REUSE names fail(), which was a private function of app.ts, and a router that app.ts imports cannot import it back, so it moved to a file of its own, unchanged. market/api/src/index.ts and app.test.ts: AppDeps gained `community` (the repo) and the two callers of createApp pass one; index.ts builds the Postgres or memory repo beside the marketplace's and closes both on shutdown. community/shared/types.ts: MetaPayload and ThreadView, the two response shapes the web items will read.
- 2026-09-20 agent: S1: createCommunityRouter(deps) in community/api/router.ts, routes in handlers/{read,write,uploads}.ts over handlers/context.ts. createApp gives /api/community/* the same CORS and optionalAuth as the marketplace and mounts the router; the app's onError and notFound serve it too. blockSuspended runs on the subtree, as it does on the marketplace: a suspended member reads and cannot write.
- 2026-09-20 agent: S2: /meta adds reactions, limits and auth to the repo's Meta. /feed takes tab=latest only and answers 400 for another tab; following and mentions are community-follow-notify's. GET /threads/:id answers { thread, opening, messages }: messages around thread.lastReadSeq, or from seq 0 for a signed-out reader and for a member who never opened it. /messages takes exactly one of after, before, around (a seq, digits only); none means from the opening post. /search needs q of 1 to 100 characters. A cursor this API did not make is a 400, not an empty page.
- 2026-09-20 agent: S3: a tag that is not one of the channel's is a 400; an archived channel takes no new threads (409 `archived`). S4: a replyToId outside the thread is a 400; a removed thread is a 404 even to staff. S5: outside the window is 409 `edit_window`; the clock is AppDeps.now so the test moves it. Editing is not refused in a locked thread: the item does not say, and the repo allows it.
- 2026-09-20 agent: S7: Storage.keyFor takes an optional prefix, defaulting to the configured one, and POST /api/community/uploads asks for `community`. With the local driver the signed link still points at /api/market/uploads/*, which verifies the signature and not the prefix, so no second pair of byte routes. S9: a body over 64 KB answers 413 { error: too_large } in the API's shape (the marketplace's bodyLimit answers plain text; left alone). Channel slugs are shape-checked before any query as ids are.
- 2026-09-20 agent: S10: ensureUser runs on starting a thread, replying and reacting, after the cheap refusals (404, locked, bad emoji), so a refused request makes no row. Edit and delete need no call: their author has a row already.
- 2026-09-20 agent: proved. community/api/router.test.ts, 35 tests over app.request() with dev tokens on the memory repo: S2 every route, feed, channel and search cursors, 65 messages paged forwards, backwards and around; S3 201, 403 staff channel, tags; S4 201, reply-to, 409 locked; S5 edit window, author only, soft delete, seq 0 removes the thread; S6 on, off, idempotent, counts re-read, 400 outside REACTIONS; S7 prefix, another member's key, a marketplace key, a traversal, a repeat, five photos, and the local driver end to end (sign, PUT, GET); S8 as typed, resolved, unknown, six; S9 four malformed ids on six routes with repo.getThread and getMessage never called, 401 on six writes, 413, not JSON; S10 rows made on first write. Signed-out reads of feed, channel list, search, thread, messages, channels and meta carry none of unread, following, lastReadSeq, myReactions; the same reads with a token do.
- 2026-09-20 agent: gates. npm test 702 passed, 50 skipped; with DATABASE_URL on npm run market:db 752 passed, 0 skipped. npm run market:api:build ok; npm run build ok; npm run ui:lint clean. The two test files typecheck strict (one-off tsc; no tsconfig includes tests). Built API on PORT=8806: over memory, and over Postgres in a database of its own (dropped after): 403 staff channel, thread, 64 replies with a mention, after=59 gives seq 60-64, a first reaction from a member with no row, community_messages.reactions {"👍": 1} beside 1 row in community_reactions, 400s, 409 locked, delete of seq 0 then 404, clean shutdown with both repos closed. npm run test:e2e 65 passed (PREVIEW_PORT=4306). Not exercised by a test: 409 `archived` (no repo method archives a channel), the 404 for a reply in a removed thread as staff, and the lock that lands between the check and the insert. The container and the database this run started are stopped and dropped. Stopped here; status left for whoever merges.
