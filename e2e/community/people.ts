/**
 * Who the community suite is. Dev identities, which the API's dev mode makes a
 * member of on their first request: `Bearer dev:aoife` is dev_aoife, whose
 * display name and handle are "aoife".
 *
 * Read by the specs and by the API the suite boots (api.ts), so the one person
 * nothing over HTTP can make, the staff member, is the same name in both.
 */
export const AOIFE = "aoife";
export const CIAN = "cian";
/** On the site's team. users.role is written by hand; api.ts is that hand. */
export const STAFF = "sorcha";

export const userId = (name: string) => `dev_${name}`;
