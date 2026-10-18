-- What the account keeps of the rider, so it follows them from device to
-- device: for now their own star rating (force5/src/stars.ts CustomRating, as
-- parseCustomRating leaves it), or null once they reset it. `updated_at` is
-- when the rider set or reset it, on whichever device: the newer of the
-- account's copy and a device's wins, so a write that is older than what is
-- kept changes nothing. One row per person, gone with them.

create table if not exists rider_profiles (
  user_id      text primary key references users(id) on delete cascade,
  custom_stars jsonb,
  updated_at   timestamptz not null
);
