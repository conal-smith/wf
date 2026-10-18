/**
 * The site-level routes: who you are, whichever section you are in. Mounted
 * at /api beside /api/market, so the marketplace and the community read and
 * write the same row through the same two handlers.
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { requireAuth, type AuthVariables } from "../../market/api/src/auth.js";
import { HandleTakenError, type UsersRepo } from "./repo.js";
import { ensureUser, type People } from "./users.js";
import type { User } from "../shared/types.js";
import { userInputSchema } from "../shared/validate.js";

type Env = { Variables: AuthVariables };

const JSON_LIMIT = 64 * 1024;

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isSuspended(
  user: Pick<User, "suspendedUntil">,
  now = Date.now(),
): boolean {
  return user.suspendedUntil != null && Date.parse(user.suspendedUntil) > now;
}

/**
 * Answers 403 `suspended` to every write from a suspended account. Put it on
 * a whole router, after optionalAuth: reads pass, and so do writes that carry
 * no user (they meet requireAuth, or a signed upload link, further in).
 */
export function blockSuspended(users: UsersRepo): MiddlewareHandler<Env> {
  return async (c, next) => {
    const userId = c.var.userId;
    if (userId && !READ_METHODS.has(c.req.method)) {
      const user = await users.getUser(userId);
      if (user && isSuspended(user)) {
        return c.json(
          {
            error: "suspended",
            message: `Your account is suspended until ${user.suspendedUntil!.slice(0, 10)}. You can still read everything.`,
          },
          403,
        );
      }
    }
    await next();
  };
}

/** GET /me and PUT /me as plain handlers, so a section can answer them under its own path too. */
export function meHandlers(people: People) {
  return {
    get: async (c: Context<Env>) =>
      c.json(await ensureUser(people, c.var.userId!)),

    put: async (c: Context<Env>) => {
      const input = userInputSchema.parse(await c.req.json());
      const current = await ensureUser(people, c.var.userId!);
      try {
        const user = await people.users.updateUser(current.id, input);
        return c.json(user ?? current);
      } catch (err) {
        if (!(err instanceof HandleTakenError)) throw err;
        const message = "Someone already has that handle. Try another.";
        throw new HTTPException(409, {
          res: Response.json(
            { error: "handle_taken", message, details: { handle: message } },
            { status: 409 },
          ),
        });
      }
    },
  };
}

export function createSiteRouter(people: People) {
  const me = meHandlers(people);
  const r = new Hono<Env>();
  // Scoped to /me: a "*" here would also sit in front of every /api/<section> route.
  r.use("/me", blockSuspended(people.users));
  r.get("/me", requireAuth, me.get);
  r.put("/me", requireAuth, bodyLimit({ maxSize: JSON_LIMIT }), me.put);
  return r;
}
