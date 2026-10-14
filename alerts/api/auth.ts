/**
 * No accounts: a device registers and is given a random secret, which it
 * keeps in the keychain / keystore and sends as `Authorization: Device
 * <id>.<secret>`. Only a SHA-256 of the secret is stored, so a copy of the
 * table cannot speak for a device. The release pipeline's announcements use a
 * shared bearer token (ALERTS_ADMIN_TOKEN), compared in constant time.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DEVICE_SCHEME } from "../shared/protocol.js";

export const newDeviceId = () => randomBytes(12).toString("base64url");
export const newSecret = () => randomBytes(32).toString("base64url");
export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

const DEVICE_ID = /^[A-Za-z0-9_-]{16}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

/** `Device <id>.<secret>` read apart, or null for anything else. */
export function deviceCredentials(header: string | undefined): { id: string; secret: string } | null {
  const match = new RegExp(`^${DEVICE_SCHEME} ([^.\\s]+)\\.(\\S+)$`).exec(header?.trim() ?? "");
  if (!match || !DEVICE_ID.test(match[1]) || !SECRET.test(match[2])) return null;
  return { id: match[1], secret: match[2] };
}

const equal = (a: string, b: string) => {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
};

export const secretMatches = (secret: string, hash: string) => equal(hashSecret(secret), hash);

/** Whether a request carries the admin token. Never true when none is configured. */
export function isAdmin(header: string | undefined, token: string | null): boolean {
  if (!token) return false;
  const given = /^Bearer (\S+)$/.exec(header?.trim() ?? "")?.[1];
  return !!given && equal(given, token);
}
