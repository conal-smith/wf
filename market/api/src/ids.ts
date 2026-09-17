import { randomBytes } from "node:crypto";

/** Crockford base32: no I, L, O or U, so an id reads aloud without ambiguity. */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** A 16-character public id (80 bits of randomness), URL-safe and case-insensitive. */
export function newId(): string {
  const bytes = randomBytes(10);
  let bits = 0,
    value = 0,
    out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

export const ID_PATTERN = /^[0-9a-hjkmnp-tv-z]{16}$/;
