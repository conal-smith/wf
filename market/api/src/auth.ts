/**
 * Who is calling. The API only ever needs a stable user id; Clerk owns the
 * rest of the identity (email, name, sessions) and the client sends what it
 * wants stored in the profile explicitly.
 */
import { verifyToken } from "@clerk/backend";
import type { Context, MiddlewareHandler } from "hono";
import type { Config } from "./env.js";

/** Resolve a bearer token to a user id, or null when it does not verify. */
export type Verifier = (token: string) => Promise<string | null>;

export function clerkVerifier(auth: Config["auth"]): Verifier {
  return async (token) => {
    const result = await verifyToken(token, {
      secretKey: auth.clerkSecretKey ?? undefined,
      jwtKey: auth.clerkJwtKey ?? undefined,
      authorizedParties: auth.authorizedParties.length
        ? auth.authorizedParties
        : undefined,
    });
    const payload = result.data as { sub?: unknown } | undefined;
    if (result.errors || typeof payload?.sub !== "string" || !payload.sub)
      return null;
    return payload.sub;
  };
}

/**
 * Development only: the token is the literal user id, prefixed "dev:".
 * loadConfig refuses this mode in production.
 */
export function devVerifier(): Verifier {
  return async (token) => {
    const match = /^dev:([A-Za-z0-9_-]{1,64})$/.exec(token);
    return match ? `dev_${match[1]}` : null;
  };
}

export type AuthVariables = { userId: string | null };

function bearer(c: Context): string | null {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

/** Sets c.var.userId when a valid token is present; never rejects. */
export function optionalAuth(
  verify: Verifier,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const token = bearer(c);
    c.set("userId", token ? await verify(token) : null);
    await next();
  };
}

/** Rejects with 401 unless optionalAuth found a user. Run after it. */
export const requireAuth: MiddlewareHandler<{
  Variables: AuthVariables;
}> = async (c, next) => {
  if (!c.var.userId) {
    return c.json(
      { error: "unauthenticated", message: "Sign in to do that." },
      401,
    );
  }
  await next();
};
