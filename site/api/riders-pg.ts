/** The riders seam (./riders.ts) on Postgres: the `rider_profiles` table (market/api/migrations/0005). */
import type { Sql } from "postgres";
import { parseCustomRating } from "../../force5/src/stars.js";
import type { RiderProfile } from "../shared/rider.js";
import type { RidersRepo } from "./riders.js";

interface RiderRow {
  custom_stars: unknown;
  updated_at: Date;
}

/** What is kept, read back through the same validation it was written through. */
const toProfile = (r: RiderRow | undefined): RiderProfile => ({
  customStars: r ? parseCustomRating(r.custom_stars) : null,
  updatedAt: r ? r.updated_at.toISOString() : null,
});

export function pgRidersRepo(sql: Sql): RidersRepo {
  const get = async (id: string) => {
    const rows = await sql<RiderRow[]>`
      select custom_stars, updated_at from rider_profiles where user_id = ${id}`;
    return toProfile(rows[0]);
  };
  return {
    get,
    async put(id, input) {
      // The newer wins: an older write, from a device that was offline or
      // behind, leaves the row as it is.
      const stars =
        input.customStars === null
          ? null
          : sql.json(input.customStars as never);
      await sql`
        insert into rider_profiles (user_id, custom_stars, updated_at)
        values (${id}, ${stars}, ${input.updatedAt})
        on conflict (user_id) do update
          set custom_stars = excluded.custom_stars,
              updated_at = excluded.updated_at
          where rider_profiles.updated_at < excluded.updated_at`;
      return get(id);
    },
  };
}
