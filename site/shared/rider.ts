/**
 * The rider the account keeps, so it follows them from device to device: for
 * now their own star rating. Its own file, apart from the people's types and
 * checks, because it reads the stars (force5/src/stars.ts) and the sections
 * that only need people must not.
 */
import { z } from "zod";
import {
  parseCustomRating,
  type CustomRating,
} from "../../force5/src/stars.js";

/**
 * What the account keeps of the rider, so it follows them from device to
 * device: for now their own star rating. GET and PUT /api/me/rider.
 *
 * Until 25 October 2026 a rating could also be kept aside while a level
 * (Learning, Riding, Advanced) rated, as `keptStars`. The levels are gone and
 * so is that: the account no longer answers `keptStars`, and a device from
 * before reads its absence as none kept, which is what it should do.
 */
export interface RiderProfile {
  /**
   * The rider's own rating (stars.ts `CustomRating`, version 3); null while
   * ours rates. A rating kept from before version 3 reads as null.
   */
  customStars: CustomRating | null;
  /** When the rating was last saved or deleted, on whichever device; null if never. */
  updatedAt: string | null;
}

/** PUT /api/me/rider: kept only when it is newer than what the account has. */
export interface RiderProfileInput {
  customStars: CustomRating | null;
  updatedAt: string;
}

/** What the account keeps of an input. */
export const profileOf = (input: RiderProfileInput): RiderProfile => ({
  customStars: input.customStars,
  updatedAt: new Date(input.updatedAt).toISOString(),
});

/**
 * A rider's own star rating, wherever the API is sent one: the shape is
 * checked and its figures clamped by stars.ts `parseCustomRating`, the one
 * place that is done. Anything it will not read — a rating from before
 * version 3, made for a level, above all — is null, and ours rates: an
 * older app is never refused for it.
 */
export const customRatingSchema = z
  .unknown()
  .transform((value) => parseCustomRating(value));

/**
 * PUT /api/me/rider. A device from before 25 October 2026 may also send
 * `keptStars`, which is taken and dropped, and a rating from before version
 * 3, which this site no longer reads: that write is not refused but let go
 * (null), and the account keeps what it has, so an old page left open
 * somewhere cannot wipe out a rating made since. Null for a rating sent is
 * still a reset, as it always was.
 */
export const riderProfileInputSchema = z
  .object({
    customStars: z.union([z.null(), z.record(z.string(), z.unknown())]),
    keptStars: z.unknown().optional(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .transform(({ customStars, updatedAt }): RiderProfileInput | null => {
    const rating = parseCustomRating(customStars);
    return customStars !== null && !rating
      ? null
      : { customStars: rating, updatedAt };
  });
