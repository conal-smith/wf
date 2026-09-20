-- The one setting a person has in the community: whether starting or replying
-- to a thread follows it. It sits on users because the profile page edits it
-- through /api/me with the rest of the row.

alter table users
  add column if not exists auto_follow boolean not null default true;
