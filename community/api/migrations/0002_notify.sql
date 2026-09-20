-- Community schema, version 2: what the bell needs.
--
-- 0001 made one unread row per (user_id, thread_id, kind) for every kind. Only
-- replies fold per thread. A mention is never folded, reactions fold per
-- message, and two reports in one thread are two rows, so the index narrows
-- to replies and reactions get one of their own.

drop index if exists community_notifications_unread;

-- One unread reply row per person and thread: a second reply folds into it.
create unique index if not exists community_notifications_unread
  on community_notifications (user_id, thread_id)
  where read_at is null and kind = 'reply';

-- One unread reaction row per person and message.
create unique index if not exists community_notifications_unread_reaction
  on community_notifications (user_id, message_id)
  where read_at is null and kind = 'reaction';

-- actor_id stays the latest; actor_ids is everyone folded into the row, most
-- recent first, so the bell can say "Tomás and Niamh replied". updated_at is
-- when the row last took an event, which is what the list sorts on.
alter table community_notifications
  add column if not exists actor_ids  text[] not null default '{}',
  add column if not exists emoji      text,
  add column if not exists updated_at timestamptz(3) not null default now();

-- The bell's list, by cursor.
create index if not exists community_notifications_list
  on community_notifications (user_id, updated_at desc, id);
