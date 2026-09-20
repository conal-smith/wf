/**
 * Making a person's row the first time anything needs one. Nobody fills in a
 * form to join: the name and picture come from the identity provider, the
 * handle is made from the name, and all of it is theirs to change afterwards.
 */
import type { IdentityLookup } from "./identity.js";
import type { UsersRepo } from "./repo.js";
import { USER_LIMITS, type User } from "../shared/types.js";
import { isReservedHandle } from "../shared/validate.js";

export interface People {
  users: UsersRepo;
  identity: IdentityLookup;
}

const FALLBACK_NAME = "Member";
const FALLBACK_HANDLE = "member";

/** A clash this deep means something other than a popular name is wrong. */
const MAX_HANDLE_TRIES = 1000;

/** "Siobhán Ní Bhriain" -> "siobhan-ni-bhriain". Always the right shape; ensureUser skips the reserved ones. */
export function slugifyHandle(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base =
    slug.length >= USER_LIMITS.handleMin
      ? slug
      : slug
        ? `${FALLBACK_HANDLE}-${slug}`
        : FALLBACK_HANDLE;
  return base.slice(0, USER_LIMITS.handleMax).replace(/-+$/, "");
}

/** The nth handle to try: "aoife", then "aoife-2", "aoife-3", cut to fit the limit. */
export function handleCandidate(base: string, n: number): string {
  if (n <= 1) return base;
  const suffix = `-${n}`;
  return (
    base.slice(0, USER_LIMITS.handleMax - suffix.length).replace(/-+$/, "") +
    suffix
  );
}

function startingName(name: string | null): string {
  const clean = (name ?? "").trim().slice(0, USER_LIMITS.displayNameMax).trim();
  return clean.length >= 2 ? clean : FALLBACK_NAME;
}

/**
 * The caller's row, made now if this is the first time anything needed it.
 * Safe to call on every request and from two requests at once: the insert
 * either lands or reports that the id or the handle was already there.
 */
export async function ensureUser(people: People, id: string): Promise<User> {
  const existing = await people.users.getUser(id);
  if (existing) return existing;

  const identity = await people.identity(id);
  const displayName = startingName(identity.name);
  const base = slugifyHandle(displayName);
  for (let n = 1; n <= MAX_HANDLE_TRIES; n++) {
    const handle = handleCandidate(base, n);
    if (isReservedHandle(handle)) continue;
    const made = await people.users.insertUser({
      id,
      handle,
      displayName,
      avatarUrl: identity.avatarUrl,
    });
    if (made) return made;
    // Nothing inserted: a twin request made the row, or the handle is taken.
    const raced = await people.users.getUser(id);
    if (raced) return raced;
  }
  throw new Error(`No free handle for ${id} after ${MAX_HANDLE_TRIES} tries`);
}
