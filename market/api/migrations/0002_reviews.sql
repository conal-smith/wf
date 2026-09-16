-- Enquiries, reviews and the per-seller numbers every listing card shows.

-- A signed-in viewer asking for a seller's contact details. This is the
-- marketplace's record of an enquiry: it gates reviews (you rate someone you
-- actually contacted) and gives the seller an enquiry count per listing.
create table if not exists market_contact_reveals (
  user_id    text not null,
  listing_id text not null references market_listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create table if not exists market_reviews (
  id          text primary key,
  seller_id   text not null references market_profiles(user_id),
  reviewer_id text not null references market_profiles(user_id),
  listing_id  text not null references market_listings(id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  comment     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (reviewer_id, listing_id),
  constraint market_reviews_not_self check (seller_id <> reviewer_id)
);

create index if not exists market_reviews_seller
  on market_reviews (seller_id, created_at desc);

-- One row per seller with the numbers every listing card shows.
create or replace view market_seller_stats as
  select p.user_id,
         count(l.id) filter (where l.status = 'active')   as active_count,
         count(l.id) filter (where l.status = 'sold')     as sold_count,
         count(l.id) filter (where l.status <> 'removed') as listing_count,
         (select round(avg(r.rating)::numeric, 2) from market_reviews r where r.seller_id = p.user_id) as rating_avg,
         (select count(*) from market_reviews r where r.seller_id = p.user_id) as rating_count
  from market_profiles p
  left join market_listings l on l.seller_id = p.user_id
  group by p.user_id;
