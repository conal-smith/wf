/**
 * What the identity provider knows about a person, asked once, when their
 * `users` row is first made. After that the row is theirs to edit and the
 * provider is not consulted again.
 */
import { createClerkClient } from "@clerk/backend";

export interface Identity {
  name: string | null;
  avatarUrl: string | null;
}

export type IdentityLookup = (userId: string) => Promise<Identity>;

const UNKNOWN: Identity = { name: null, avatarUrl: null };

/**
 * A lookup that fails must not fail the request that needed the row: the
 * person gets a placeholder name and handle, and can change both.
 */
export function clerkIdentity(secretKey: string | null): IdentityLookup {
  // With only CLERK_JWT_KEY set, tokens verify offline and there is no key to ask with.
  if (!secretKey) return async () => UNKNOWN;
  const clerk = createClerkClient({ secretKey });
  return async (userId) => {
    try {
      const user = await clerk.users.getUser(userId);
      return {
        name: user.fullName ?? user.firstName ?? user.username ?? null,
        avatarUrl: user.hasImage ? user.imageUrl : null,
      };
    } catch (err) {
      console.warn(
        `site: identity lookup failed for ${userId}:`,
        err instanceof Error ? err.message : err,
      );
      return UNKNOWN;
    }
  };
}

/** Development only: "dev_aoife" is called "aoife", the name the token carried. */
export function devIdentity(): IdentityLookup {
  return async (userId) => ({
    name: userId.replace(/^dev_/, ""),
    avatarUrl: null,
  });
}
