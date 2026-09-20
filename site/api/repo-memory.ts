/**
 * An in-memory UsersRepo with the same semantics as the Postgres one. The
 * marketplace's memory repo reads people through `peek`, which stands in for
 * the join its Postgres twin does.
 */
import { HandleTakenError, type NewUser, type UsersRepo } from "./repo.js";
import type { User } from "../shared/types.js";
import type { UserInputParsed } from "../shared/validate.js";

export interface MemoryUsersRepo extends UsersRepo {
  /** Synchronous read, for other in-memory repos only. */
  peek(id: string): User | undefined;
}

export function memoryUsersRepo(
  now: () => Date = () => new Date(),
): MemoryUsersRepo {
  const users = new Map<string, User>();

  const handleOwner = (handle: string) =>
    [...users.values()].find((u) => u.handle === handle);

  return {
    peek: (id) => users.get(id),

    async getUser(id) {
      return users.get(id) ?? null;
    },

    async insertUser(row: NewUser) {
      if (users.has(row.id) || handleOwner(row.handle)) return null;
      const at = now().toISOString();
      const user: User = {
        id: row.id,
        handle: row.handle,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        county: null,
        bio: null,
        role: "member",
        suspendedUntil: null,
        contactEmail: null,
        contactPhone: null,
        contactWhatsapp: false,
        createdAt: at,
        updatedAt: at,
      };
      users.set(row.id, user);
      return user;
    },

    async updateUser(id, input: UserInputParsed) {
      const existing = users.get(id);
      if (!existing) return null;
      if (input.handle) {
        const owner = handleOwner(input.handle);
        if (owner && owner.id !== id) throw new HandleTakenError(input.handle);
      }
      const user: User = {
        ...existing,
        displayName: input.displayName,
        handle: input.handle ?? existing.handle,
        county: input.county ?? null,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        contactWhatsapp: input.contactWhatsapp ?? false,
        bio: input.bio ?? null,
        updatedAt: now().toISOString(),
      };
      users.set(id, user);
      return user;
    },

    async setSuspendedUntil(id, until) {
      const existing = users.get(id);
      if (!existing) return null;
      const user: User = {
        ...existing,
        suspendedUntil: until ? until.toISOString() : null,
        updatedAt: now().toISOString(),
      };
      users.set(id, user);
      return user;
    },
  };
}
