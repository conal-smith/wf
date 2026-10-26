/**
 * The riders seam (./riders.ts) on Postgres: the `rider_profiles` table
 * (market/api/migrations/0005). Its `kept_stars` column held a rating kept
 * aside while a level rated, until 25 October 2026: it is written null and
 * never read.
 */
import type { Sql } from "postgres";
import { parseCustomRating } from "../../force5/src/stars.js";
import { profileOf, type RiderProfile } from "../shared/rider.js";
import type { RidersRepo } from "./riders.js";

interface RiderRow {
  custom_stars: unknown;
  updated_at: Date;
}

/**
 * What is kept, read back through the same validation it was written
 * through: a rating from before version 3 reads as none, and ours rates.
 */
const toProfile = (r: RiderRow | undefined): RiderProfile => ({
  customStars: r ? parseCustomRating(r.custom_stars) : null,
  updatedAt: r ? r.updated_at.toISOString() : null,
});

export function pgRidersRepo(sql: Sql): RidersRepo {
  const get = async (id: string) => {
    const rows = await sql<RiderRow[]>`
      select custom_stars, updated_at from rider_profiles
      where user_id = ${id}`;
    return toProfile(rows[0]);
  };
  return {
    get,
    async put(id, input) {
      // The newer wins: an older write, from a device that was offline or
      // behind, leaves the row as it is.
      const kept = profileOf(input);
      const json = (rating: unknown) =>
        rating === null ? null : sql.json(rating as never);
      await sql`
        insert into rider_profiles (user_id, custom_stars, kept_stars, updated_at)
        values (${id}, ${json(kept.customStars)}, null, ${input.updatedAt})
        on conflict (user_id) do update
          set custom_stars = excluded.custom_stars,
              kept_stars = excluded.kept_stars,
              updated_at = excluded.updated_at
          where rider_profiles.updated_at < excluded.updated_at`;
      return get(id);
    },
  };
}
