-- The rider's own star rating, kept while a level rates in its place
-- (site/shared/rider.ts `keptStars`), so they can go back to it from any
-- device. `custom_stars` stays the rating in use, which is all a device from
-- before this reads; a row from before has nothing kept, as it had then.

alter table rider_profiles add column if not exists kept_stars jsonb;
