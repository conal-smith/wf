-- One table for the people of the site. The marketplace points at it now and
-- the community will too, so it carries no market_ prefix. It replaces
-- market_profiles outright: nothing has been made public, so no row is carried
-- over and whatever listings a development database held go with their sellers.

create table if not exists users (
  id               text primary key,            -- Clerk user id ("user_...")
  handle           text not null unique,        -- for @mentions and profile links
  display_name     text not null,
  avatar_url       text,
  county           text,
  bio              text,
  role             text not null default 'member' check (role in ('member', 'staff')),
  suspended_until  timestamptz,
  contact_email    text,                        -- asked for when you sell, and only then
  contact_phone    text,
  contact_whatsapp boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint users_handle_shape check (handle ~ '^[a-z0-9-]{3,30}$')
);

-- Listings and reviews name sellers that will not exist in users. Photos,
-- saves and enquiries hang off listings and go with them.
truncate market_listings, market_reviews, market_listing_photos,
         market_saved, market_contact_reveals;

drop view if exists market_seller_stats;

alter table market_listings
  drop constraint if exists market_listings_seller_id_fkey;
alter table market_reviews
  drop constraint if exists market_reviews_seller_id_fkey,
  drop constraint if exists market_reviews_reviewer_id_fkey;

drop table if exists market_profiles;

alter table market_listings
  add constraint market_listings_seller_id_fkey foreign key (seller_id) references users(id);
alter table market_reviews
  add constraint market_reviews_seller_id_fkey foreign key (seller_id) references users(id),
  add constraint market_reviews_reviewer_id_fkey foreign key (reviewer_id) references users(id);

-- One row per person with the numbers every listing card shows.
create view market_seller_stats as
  select u.id as user_id,
         count(l.id) filter (where l.status = 'active')   as active_count,
         count(l.id) filter (where l.status = 'sold')     as sold_count,
         count(l.id) filter (where l.status <> 'removed') as listing_count,
         (select round(avg(r.rating)::numeric, 2) from market_reviews r where r.seller_id = u.id) as rating_avg,
         (select count(*) from market_reviews r where r.seller_id = u.id) as rating_count
  from users u
  left join market_listings l on l.seller_id = u.id
  group by u.id;
