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
STATE: Router pattern to copy: market/api/src/app.ts:65-479. Upload presign: app.ts POST /uploads with key ownership storage.ts:52.
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
TOUCH: community/api/{router,handlers/*}.ts, community/api/router.test.ts, market/api/src/app.ts, market/api/src/storage.ts (prefix parameter).
REUSE: fail(), onError, requireAuth, newId, ID_PATTERN, bodyLimit, the storage drivers.
AVOID: Follows, notifications, SSE, moderation (sibling items). Fetching any external URL.
GATES: npm test; npm run market:api:build.
ACCEPT:
- [ ] router.test.ts covers S2-S9 with dev tokens over the memory repo, including 401, 403, 404-on-bad-id, 409 locked, cursor paging across 65 messages.
- [ ] Signed-out GETs carry no viewer fields.
REFS: D16 D17 D18. Plan 6.3.
