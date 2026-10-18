/**
 * The rider the account keeps, so it follows them from device to device: for
 * now their own star rating (site/shared/rider.ts). A seam of its own beside
 * the `users` one, with the routes that read and write it, GET and PUT
 * /api/me/rider, because it reads the stars and the sections that only need
 * people must not (tests/bundle-isolation.test.ts).
 *
 * Each copy carries the moment it was set or reset; the account keeps a write
 * only when it is newer than what it has, and no write is newer than the
 * moment it arrives, so a device whose clock runs ahead cannot win every
 * later change.
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireAuth, type AuthVariables } from "../../market/api/src/auth.js";
import {
  riderProfileInputSchema,
  type RiderProfile,
  type RiderProfileInput,
} from "../shared/rider.js";
import type { UsersRepo } from "./repo.js";
import { ensureUser, type People } from "./users.js";

export interface RidersRepo {
  /** What the account keeps of the rider; nulls when nothing is kept yet. */
  get(userId: string): Promise<RiderProfile>;
  /**
   * Keeps `input` only when it is newer than what is kept, and answers what
   * is kept after: the input, or the newer copy that stood. The user's row
   * must exist.
   */
  put(userId: string, input: RiderProfileInput): Promise<RiderProfile>;
}

/** The same, on a map: for tests and for running the API with no database. */
export function memoryRidersRepo(users: UsersRepo): RidersRepo {
  const kept = new Map<string, RiderProfile>();
  const get = async (id: string): Promise<RiderProfile> =>
    structuredClone(kept.get(id) ?? { customStars: null, updatedAt: null });
  return {
    get,
    async put(id, input) {
      if (!(await users.getUser(id))) throw new Error(`No user ${id}`);
      const was = kept.get(id);
      if (!was || Date.parse(was.updatedAt!) < Date.parse(input.updatedAt))
        kept.set(id, {
          customStars: structuredClone(input.customStars),
          updatedAt: new Date(input.updatedAt).toISOString(),
        });
      return get(id);
    },
  };
}

type Env = { Variables: AuthVariables };

/** A star rating is a few dozen numbers. */
const RIDER_LIMIT = 4 * 1024;

/**
 * Mounted at /api beside the site's /me. Not behind a suspension: it is the
 * rider's own setting, seen by nobody else.
 */
export function createRiderRouter(people: People, riders: RidersRepo) {
  const r = new Hono<Env>();
  r.get("/me/rider", requireAuth, async (c) => {
    const user = await ensureUser(people, c.var.userId!);
    return c.json(await riders.get(user.id));
  });
  r.put(
    "/me/rider",
    requireAuth,
    bodyLimit({ maxSize: RIDER_LIMIT }),
    async (c) => {
      const input = riderProfileInputSchema.parse(await c.req.json());
      const user = await ensureUser(people, c.var.userId!);
      const updatedAt = new Date(
        Math.min(Date.parse(input.updatedAt), Date.now()),
      ).toISOString();
      return c.json(await riders.put(user.id, { ...input, updatedAt }));
    },
  );
  return r;
}
