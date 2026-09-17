-- Marketplace schema, version 1.
-- Every table is prefixed market_ so it can share a database with anything
-- else that lands on Railway later without colliding.

create table if not exists market_profiles (
  user_id          text primary key,            -- Clerk user id ("user_...")
  display_name     text not null,
  county           text,
  contact_email    text,
  contact_phone    text,
  contact_whatsapp boolean not null default false,
  bio              text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint market_profiles_contact check (contact_email is not null or contact_phone is not null)
);

create table if not exists market_listings (
  id           text primary key,                -- short public id, see ids.ts
  seller_id    text not null references market_profiles(user_id),
  title        text not null,
  description  text not null,
  category     text not null,
  condition    text not null,
  brand        text,
  size_label   text,
  year         smallint,
  price_cents  integer not null check (price_cents >= 0),
  currency     text not null default 'EUR' check (currency in ('EUR', 'GBP')),
  county       text not null,
  town         text,
  status       text not null default 'active' check (status in ('active', 'sold', 'removed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  sold_at      timestamptz
);

create index if not exists market_listings_browse
  on market_listings (status, created_at desc, id);
create index if not exists market_listings_seller
  on market_listings (seller_id, created_at desc);
create index if not exists market_listings_category
  on market_listings (category) where status = 'active';
create index if not exists market_listings_county
  on market_listings (county) where status = 'active';
create index if not exists market_listings_search
  on market_listings using gin (
    to_tsvector('english', title || ' ' || coalesce(brand, '') || ' ' || description)
  );

create table if not exists market_listing_photos (
  id          text primary key,
  listing_id  text not null references market_listings(id) on delete cascade,
  storage_key text not null unique,
  url         text not null,
  width       integer,
  height      integer,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists market_listing_photos_listing
  on market_listing_photos (listing_id, position);

create table if not exists market_saved (
  user_id    text not null,                    -- Clerk user id; a viewer can save before they have a profile
  listing_id text not null references market_listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
