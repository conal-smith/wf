-- Community schema, version 1.
-- Every table is prefixed community_ and keeps its own ledger
-- (community_migrations), so it shares the marketplace's database without
-- colliding. People are rows of the site's `users` table, which the
-- marketplace's migrations create: those run first.
--
-- Timestamps that a cursor pages on are timestamptz(3): a cursor travels
-- through JSON at millisecond precision, and the column has to compare equal
-- to what came back out of it.

create table if not exists community_categories (
  id       text primary key,
  name     text not null,
  position integer not null
);

create table if not exists community_channels (
  id              text primary key,
  slug            text not null unique,
  category_id     text not null references community_categories(id),
  name            text not null,
  description     text not null default '',
  post_policy     text not null default 'everyone' check (post_policy in ('everyone', 'staff')),
  status          text not null default 'active' check (status in ('active', 'archived')),
  position        integer not null,
  thread_count    integer not null default 0,      -- threads not removed
  follower_count  integer not null default 0,
  last_message_at timestamptz(3)
);

create table if not exists community_tags (
  id         text primary key,
  channel_id text not null references community_channels(id) on delete cascade,
  label      text not null,
  position   integer not null,
  unique (channel_id, label)
);

create table if not exists community_threads (
  id                text primary key,              -- short public id, see ids.ts
  channel_id        text not null references community_channels(id),
  author_id         text not null references users(id),
  title             text not null,
  slug              text not null,                 -- decoration in the URL; the id resolves
  spot_id           text,                          -- a riding location from public/riding-locations.json
  status            text not null default 'open' check (status in ('open', 'locked', 'removed')),
  pinned            boolean not null default false,
  locked_reason     text,
  last_seq          integer not null default 0,    -- highest message seq, drives unread
  reply_count       integer not null default 0,    -- visible messages after the opening post
  participant_count integer not null default 1,    -- distinct authors of visible messages
  last_message_at   timestamptz(3) not null default now(),
  last_message_by   text references users(id),
  created_at        timestamptz(3) not null default now()
);

-- The channel list, by cursor: pinned first, then most recent activity.
create index if not exists community_threads_channel
  on community_threads (channel_id, pinned desc, last_message_at desc, id);
-- The home feed.
create index if not exists community_threads_feed
  on community_threads (last_message_at desc, id) where status <> 'removed';
create index if not exists community_threads_author
  on community_threads (author_id, created_at desc);
create index if not exists community_threads_search
  on community_threads using gin (to_tsvector('english', title));

create table if not exists community_thread_tags (
  thread_id text not null references community_threads(id) on delete cascade,
  tag_id    text not null references community_tags(id) on delete cascade,
  primary key (thread_id, tag_id)
);

create index if not exists community_thread_tags_tag
  on community_thread_tags (tag_id);

-- Everything that is said. The opening post is seq 0; unique (thread_id, seq)
-- is also the index the stream pages on.
create table if not exists community_messages (
  id          text primary key,
  thread_id   text not null references community_threads(id) on delete cascade,
  seq         integer not null check (seq >= 0),
  author_id   text not null references users(id),
  body        text not null,
  reply_to_id text references community_messages(id),   -- a reference, never a parent: the stream stays flat
  reactions   jsonb not null default '{}',               -- {"<emoji>": count}, denormalised from community_reactions
  status      text not null default 'visible' check (status in ('visible', 'removed')),
  removed_by  text references users(id),
  edited_at   timestamptz,
  created_at  timestamptz(3) not null default now(),
  constraint community_messages_thread_seq unique (thread_id, seq)
);

create index if not exists community_messages_author
  on community_messages (author_id, created_at desc);
create index if not exists community_messages_search
  on community_messages using gin (to_tsvector('english', body));

create table if not exists community_message_photos (
  id          text primary key,
  message_id  text not null references community_messages(id) on delete cascade,
  storage_key text not null unique,
  url         text not null,
  width       integer,
  height      integer,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists community_message_photos_message
  on community_message_photos (message_id, position);

create table if not exists community_reactions (
  message_id text not null references community_messages(id) on delete cascade,
  user_id    text not null references users(id),
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists community_mentions (
  message_id text not null references community_messages(id) on delete cascade,
  user_id    text not null references users(id),
  primary key (message_id, user_id)
);

create index if not exists community_mentions_user
  on community_mentions (user_id);

-- Reading needs no row in users: a signed-in viewer can read before they
-- have ever written anything.
create table if not exists community_reads (
  user_id       text not null,
  thread_id     text not null references community_threads(id) on delete cascade,
  last_read_seq integer not null,
  updated_at    timestamptz not null default now(),
  primary key (user_id, thread_id)
);

-- When the viewer last looked at a channel: the unread count in the rail.
create table if not exists community_channel_seen (
  user_id    text not null,
  channel_id text not null references community_channels(id) on delete cascade,
  seen_at    timestamptz(3) not null default now(),
  primary key (user_id, channel_id)
);

create table if not exists community_follows (
  user_id     text not null references users(id),
  target_type text not null check (target_type in ('thread', 'channel')),
  target_id   text not null,
  level       text not null default 'all' check (level in ('all', 'mentions', 'none')),
  source      text not null default 'manual' check (source in ('auto', 'manual')),
  created_at  timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

-- Who to tell when something happens to a target.
create index if not exists community_follows_target
  on community_follows (target_type, target_id);

create table if not exists community_notifications (
  id         text primary key,
  user_id    text not null references users(id),
  kind       text not null check (kind in ('reply', 'mention', 'thread', 'reaction', 'report')),
  thread_id  text references community_threads(id) on delete cascade,
  message_id text references community_messages(id) on delete cascade,
  actor_id   text references users(id),
  count      integer not null default 1,
  read_at    timestamptz,
  created_at timestamptz(3) not null default now()
);

create index if not exists community_notifications_user
  on community_notifications (user_id, read_at, created_at desc);
-- One unread row per person, thread and kind: a second event folds into it.
create unique index if not exists community_notifications_unread
  on community_notifications (user_id, thread_id, kind) where read_at is null;

create table if not exists community_reports (
  id          text primary key,
  reporter_id text not null references users(id),
  message_id  text not null references community_messages(id) on delete cascade,
  reason      text not null,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists community_reports_reporter
  on community_reports (reporter_id, created_at desc);

create table if not exists community_mod_log (
  id          text primary key,
  actor_id    text not null references users(id),
  action      text not null,
  target_type text not null,
  target_id   text not null,
  reason      text,
  created_at  timestamptz not null default now()
);

create index if not exists community_mod_log_recent
  on community_mod_log (created_at desc);

-- The only rows a migration ever writes: the categories, the ten channels and
-- their tags. No threads, messages or people. Ids are the first 16 characters
-- of an md5, which is inside the id alphabet, and community/api/seed.ts derives
-- the same ids for the memory repo.

insert into community_categories (id, name, position)
select substr(md5('community_category:' || v.key), 1, 16), v.name, v.position
from (values
  ('community', 'Community', 0),
  ('gear',      'Gear',      1),
  ('riding',    'Riding',    2),
  ('social',    'Social',    3)
) as v(key, name, position)
on conflict (id) do nothing;

insert into community_channels (id, slug, category_id, name, description, post_policy, position)
select substr(md5('community_channel:' || v.slug), 1, 16), v.slug,
       substr(md5('community_category:' || v.category), 1, 16),
       v.name, v.description, v.post_policy, v.position
from (values
  ('announcements',        'community', 'Announcements',        'News about the site, from the people who run it.',              'staff',    0),
  ('general',              'community', 'General',              'Anything wingfoiling that has no better home.',                 'everyone', 1),
  ('wings',                'gear',      'Wings',                'Sizes, reviews, repairs and what is new.',                      'everyone', 0),
  ('boards',               'gear',      'Boards',               'Volume, shapes, reviews and repairs.',                          'everyone', 1),
  ('foils',                'gear',      'Foils',                'Front wings, masts, stabilisers and how they go together.',     'everyone', 2),
  ('spots-and-conditions', 'riding',    'Spots and conditions', 'Where to launch, what to watch for and how it is today.',       'everyone', 0),
  ('sessions',             'riding',    'Sessions',             'Who is going out, where and when.',                             'everyone', 1),
  ('technique',            'riding',    'Technique',            'Getting up, staying up, gybes, tacks and the rest.',            'everyone', 2),
  ('meetups',              'social',    'Meetups',              'Days out, demo days and getting together off the water.',       'everyone', 0),
  ('off-topic',            'social',    'Off-topic',            'Everything else.',                                              'everyone', 1)
) as v(slug, category, name, description, post_policy, position)
on conflict (id) do nothing;

insert into community_tags (id, channel_id, label, position)
select substr(md5('community_tag:' || c.slug || ':' || v.label), 1, 16),
       substr(md5('community_channel:' || c.slug), 1, 16), v.label, v.position
from (values
  ('gear', 'Question', 0), ('gear', 'Review', 1), ('gear', 'Sizing', 2),
  ('gear', 'Repair', 3), ('gear', 'New release', 4),
  ('spots', 'Question', 0), ('spots', 'Conditions', 1), ('spots', 'Access', 2),
  ('spots', 'Hazard', 3), ('spots', 'Leinster', 4), ('spots', 'Munster', 5),
  ('spots', 'Connacht', 6), ('spots', 'Ulster', 7),
  ('area', 'Dublin', 0), ('area', 'East', 1), ('area', 'South', 2),
  ('area', 'West', 3), ('area', 'North', 4),
  ('technique', 'Question', 0), ('technique', 'Beginner', 1),
  ('technique', 'Gybes and tacks', 2), ('technique', 'Jumps', 3),
  ('technique', 'Waves', 4), ('technique', 'Light wind', 5)
) as v(tag_set, label, position)
join (values
  ('wings', 'gear'), ('boards', 'gear'), ('foils', 'gear'),
  ('spots-and-conditions', 'spots'),
  ('sessions', 'area'), ('meetups', 'area'),
  ('technique', 'technique')
) as c(slug, tag_set) on c.tag_set = v.tag_set
on conflict (id) do nothing;
