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
 */
export interface RiderProfile {
  /** Null when the rider rates on their level, or reset their own rating. */
  customStars: CustomRating | null;
  /** When the rating was last set or reset, on whichever device; null if never. */
  updatedAt: string | null;
}

/** PUT /api/me/rider: kept only when it is newer than what the account has. */
export interface RiderProfileInput {
  customStars: CustomRating | null;
  updatedAt: string;
}

/**
 * A rider's own star rating, wherever the API is sent one: the shape is
 * checked and its figures clamped by stars.ts `parseCustomRating`, the one
 * place that is done, and anything it will not take is refused.
 */
export const customRatingSchema = z.unknown().transform((value, ctx) => {
  const rating = parseCustomRating(value);
  if (rating) return rating;
  ctx.addIssue({
    code: "custom",
    message: "Not a star rating this site reads.",
  });
  return z.NEVER;
});

/** PUT /api/me/rider. */
export const riderProfileInputSchema = z.object({
  customStars: customRatingSchema.nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
});
