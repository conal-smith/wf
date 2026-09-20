---
type: feature
status: ready
difficulty: l
criticality: high
risk: normal
epic: community-forum
iteration: 1
dependsOn: site-users
---

# Community schema, shared types and the two repos

GOAL: The forum's data model exists behind a Repo interface with Postgres and memory implementations that pass one shared test suite.
STATE: No community/ directory. migrate() hard-codes its ledger and directory: market/api/src/db.ts:23,38,42.
SPEC:
- S1 migrate(sql, dir, ledger): ledger table name is a parameter. Market keeps market_migrations; community uses community_migrations. Same advisory-lock pattern.
- S2 community/api/migrations/0001_init.sql, all tables community_*: categories(id,name,position); channels(id,slug unique,category_id,name,description,post_policy check in (everyone,staff),status check in (active,archived),position,thread_count,follower_count,last_message_at); tags(id,channel_id,label,position); threads(id,channel_id,author_id->users,title,slug,spot_id,status check in (open,locked,removed),pinned,locked_reason,last_seq,reply_count,participant_count,last_message_at,last_message_by,created_at); thread_tags; messages(id,thread_id,seq,author_id,body,reply_to_id,reactions jsonb default '{}',status check in (visible,removed),removed_by,edited_at,created_at, unique(thread_id,seq)); message_photos; reactions(message_id,user_id,emoji pk all); mentions; reads(user_id,thread_id,last_read_seq); channel_seen; follows(user_id,target_type,target_id,level,source); notifications(id,user_id,kind,thread_id,message_id,actor_id,count,read_at,created_at, unique(user_id,thread_id,kind) where read_at is null); reports; mod_log.
- S3 Indexes: threads(channel_id, pinned desc, last_message_at desc, id); threads(last_message_at desc, id) where status <> 'removed'; messages(thread_id, seq); GIN tsvector on threads.title and messages.body; notifications(user_id, read_at, created_at desc).
- S4 Same migration inserts the 4 categories, 10 channels and their tags (plan 2, plan 12). No threads, messages or users (D23).
- S5 seq allocation is atomic: `update threads set last_seq = last_seq + 1 ... returning last_seq` inside the insert transaction.
- S6 community/shared/types.ts and validate.ts (zod): LIMITS { titleMax 120, bodyMax 5000, photosPerMessage 4, tagsPerThread 3, mentionsPerMessage 5, editWindowMin 30, pageSize 30 }, REACTIONS (the fixed 12, plan 12), cursor encode/decode.
- S7 community/api/repo.ts interface; repo-pg.ts; repo-memory.ts. Viewer-relative fields (unread, following, myReactions) computed in the same query, omitted when signed out.
DO: migration; types; both repos; community/api/repo.test.ts run against memory always and against Postgres when DATABASE_URL is set.
TOUCH: community/**, market/api/src/db.ts, market/api/src/index.ts, vitest.config.ts, tsconfig.json, market/api/tsconfig.json.
AVOID: An ORM. Offset pagination. Rows other than categories, channels, tags.
ACCEPT:
- [ ] Fresh database: both ledgers exist; 10 channels; 0 threads.
- [ ] repo.test.ts green on memory; green on Postgres with DATABASE_URL (npm run market:db).
- [ ] Concurrency test: 20 parallel replies to one thread produce seq 1..20, no gaps, no duplicates (Postgres run).
REFS: D16 D17 D23. Plan 6.2.
