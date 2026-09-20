import type { Sql } from "postgres";
import { HandleTakenError, type NewUser, type UsersRepo } from "./repo.js";
import type { User } from "../shared/types.js";
import type { UserInputParsed } from "../shared/validate.js";

interface UserRow {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  county: string | null;
  bio: string | null;
  role: string;
  suspended_until: Date | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_whatsapp: boolean;
  auto_follow: boolean;
  created_at: Date;
  updated_at: Date;
}

const iso = (d: Date) => d.toISOString();

function toUser(r: UserRow): User {
  return {
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    county: r.county as User["county"],
    bio: r.bio,
    role: r.role as User["role"],
    suspendedUntil: r.suspended_until ? iso(r.suspended_until) : null,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    contactWhatsapp: r.contact_whatsapp,
    autoFollow: r.auto_follow,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/** Postgres reports a broken unique constraint as 23505 and names the constraint. */
function isHandleClash(err: unknown): boolean {
  const e = err as { code?: string; constraint_name?: string };
  return e?.code === "23505" && e.constraint_name === "users_handle_key";
}

export function pgUsersRepo(sql: Sql): UsersRepo {
  return {
    async getUser(id) {
      const rows = await sql<UserRow[]>`select * from users where id = ${id}`;
      return rows.length ? toUser(rows[0]) : null;
    },

    async insertUser(row: NewUser) {
      // No conflict target: a taken id and a taken handle both insert nothing.
      const rows = await sql<UserRow[]>`
        insert into users (id, handle, display_name, avatar_url)
        values (${row.id}, ${row.handle}, ${row.displayName}, ${row.avatarUrl})
        on conflict do nothing
        returning *`;
      return rows.length ? toUser(rows[0]) : null;
    },

    async updateUser(id, input: UserInputParsed) {
      try {
        const rows = await sql<UserRow[]>`
          update users set
            display_name = ${input.displayName},
            handle = coalesce(${input.handle ?? null}, handle),
            county = ${input.county ?? null},
            contact_email = ${input.contactEmail ?? null},
            contact_phone = ${input.contactPhone ?? null},
            contact_whatsapp = ${input.contactWhatsapp ?? false},
            bio = ${input.bio ?? null},
            auto_follow = coalesce(${input.autoFollow ?? null}, auto_follow),
            updated_at = now()
          where id = ${id}
          returning *`;
        return rows.length ? toUser(rows[0]) : null;
      } catch (err) {
        if (input.handle && isHandleClash(err))
          throw new HandleTakenError(input.handle);
        throw err;
      }
    },

    async setSuspendedUntil(id, until) {
      const rows = await sql<UserRow[]>`
        update users set suspended_until = ${until}, updated_at = now()
        where id = ${id} returning *`;
      return rows.length ? toUser(rows[0]) : null;
    },
  };
}
