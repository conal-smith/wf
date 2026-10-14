-- Star-condition alerts (alerts/api). Its own ledger, alerts_migrations;
-- nothing here references another section's tables.

-- One row per install. No account: the app holds the secret, this the hash.
create table alerts_devices (
  id                text primary key,
  installation_id   text not null,
  secret_hash       text not null,
  -- One install per token: a token registered again is taken from the old row.
  expo_push_token   text unique,
  platform          text not null check (platform in ('ios', 'android')),
  app_variant       text not null check (app_variant in ('development', 'staging', 'production')),
  app_version       text not null,
  timezone          text not null,
  rider             jsonb not null,
  quiet_hours       boolean not null default true,
  app_updates       boolean not null default true,
  -- The whole list of rules, replaced at once (at most 20, alerts/shared/protocol.ts).
  rules             jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  rules_updated_at  timestamptz not null default now(),
  last_seen_at      timestamptz not null default now()
);
create index alerts_devices_seen on alerts_devices (last_seen_at);

-- What each device has been told about each window: rule, spot, Irish day.
create table alerts_notices (
  device_id   text not null references alerts_devices (id) on delete cascade,
  rule_id     text not null,
  spot_id     text not null,
  day         text not null,
  rule_sig    text not null,
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  stars       smallint not null,
  state       text not null check (state in ('told', 'off')),
  sent_count  integer not null default 1,
  updated_at  timestamptz not null default now(),
  primary key (device_id, rule_id, spot_id, day)
);
create index alerts_notices_end on alerts_notices (end_at);

-- Notifications waiting: due now, or at 07:00 after quiet hours.
create table alerts_outbox (
  id             bigserial primary key,
  device_id      text not null references alerts_devices (id) on delete cascade,
  key            text not null,
  kind           text not null,
  deliver_after  timestamptz not null,
  expires_at     timestamptz not null,
  message        jsonb not null,
  attempts       integer not null default 0,
  unique (device_id, key)
);
create index alerts_outbox_due on alerts_outbox (deliver_after);

-- Expo push tickets whose receipts are still to be read.
create table alerts_tickets (
  id          text primary key,
  device_id   text not null references alerts_devices (id) on delete cascade,
  token       text not null,
  created_at  timestamptz not null default now()
);
create index alerts_tickets_created on alerts_tickets (created_at);

-- The last run evaluated, announcements made: a little shared memory.
create table alerts_state (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
