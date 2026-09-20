/**
 * The people of the site. One `users` row per account serves every section,
 * so these types live above the marketplace and the community rather than in
 * either.
 *
 * Everything here is plain data. Nothing imports React, Node or a database,
 * so both sides can depend on it without pulling in the other's runtime.
 */

/** All 32 counties, so a seller in Derry or Down can list alongside Kerry. */
export const COUNTIES = [
  "Antrim",
  "Armagh",
  "Carlow",
  "Cavan",
  "Clare",
  "Cork",
  "Derry",
  "Donegal",
  "Down",
  "Dublin",
  "Fermanagh",
  "Galway",
  "Kerry",
  "Kildare",
  "Kilkenny",
  "Laois",
  "Leitrim",
  "Limerick",
  "Longford",
  "Louth",
  "Mayo",
  "Meath",
  "Monaghan",
  "Offaly",
  "Roscommon",
  "Sligo",
  "Tipperary",
  "Tyrone",
  "Waterford",
  "Westmeath",
  "Wexford",
  "Wicklow",
] as const;

export type County = (typeof COUNTIES)[number];

export const USER_ROLES = ["member", "staff"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_LIMITS = {
  handleMin: 3,
  handleMax: 30,
  displayNameMax: 40,
  bioMax: 400,
} as const;

/** Handles that would collide with a route or pass for the site itself. */
export const RESERVED_HANDLES = [
  "admin",
  "staff",
  "me",
  "new",
  "community",
  "market",
] as const;

/** Your own row, as /api/me returns it. Contact details never leave this shape. */
export interface User {
  id: string;
  /** Unique, lowercase, for @mentions and profile links. */
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  county: County | null;
  bio: string | null;
  role: UserRole;
  /** Until when every write is refused; null or past means not suspended. */
  suspendedUntil: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactWhatsapp: boolean;
  /** Starting or replying to a community thread follows it. On until switched off. */
  autoFollow: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What PUT /api/me accepts. A handle or autoFollow left out keeps the one you have. */
export interface UserInput {
  displayName: string;
  handle?: string;
  county?: County | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactWhatsapp?: boolean;
  bio?: string | null;
  autoFollow?: boolean;
}

/** Whether buyers have any way to reach this person: the gate on publishing a listing. */
export function hasContact(
  user: Pick<User, "contactEmail" | "contactPhone">,
): boolean {
  return Boolean(user.contactEmail || user.contactPhone);
}
