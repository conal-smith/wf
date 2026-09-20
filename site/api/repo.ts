/**
 * The persistence seam for the `users` table. The marketplace and the
 * community both reach people through this interface; `repo-pg.ts` implements
 * it on Postgres and `repo-memory.ts` on a plain map for tests and for running
 * the API with no database at all.
 */
import type { User } from "../shared/types.js";
import type { UserInputParsed } from "../shared/validate.js";

/** What a first row is made of: everything else takes the table's default. */
export interface NewUser {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Thrown by updateUser when the handle asked for belongs to someone else. */
export class HandleTakenError extends Error {
  constructor(public handle: string) {
    super(`Handle ${handle} is taken`);
  }
}

export interface UsersRepo {
  getUser(id: string): Promise<User | null>;
  /**
   * Inserts the row, or returns null and changes nothing when either the id
   * or the handle is already there. The caller tells the two apart.
   */
  insertUser(row: NewUser): Promise<User | null>;
  /** Null when there is no such user. A handle left out is kept. */
  updateUser(id: string, input: UserInputParsed): Promise<User | null>;
  /** Null lifts the suspension. */
  setSuspendedUntil(id: string, until: Date | null): Promise<User | null>;
  /** Everyone with a row: the community's member count. */
  countUsers(): Promise<number>;
}
