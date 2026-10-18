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
  /**
   * The rider's own rating while it rates; null while a level rates, or when
   * they have none. A device from before `keptStars` reads only this, which
   * is what it should rate with.
   */
  customStars: CustomRating | null;
  /** Their own rating, kept while a level rates in its place; null otherwise. Never both. */
  keptStars: CustomRating | null;
  /** When the rating was last saved or deleted, or switched on or off, on whichever device; null if never. */
  updatedAt: string | null;
}

/**
 * PUT /api/me/rider: kept only when it is newer than what the account has. A
 * device from before `keptStars` sends none: its `customStars` is then saved
 * and in use, or with null, deleted, as it meant.
 */
export interface RiderProfileInput {
  customStars: CustomRating | null;
  keptStars?: CustomRating | null;
  updatedAt: string;
}

/** What the account keeps of an input: never a kept rating beside one that rates. */
export const profileOf = (input: RiderProfileInput): RiderProfile => ({
  customStars: input.customStars,
  keptStars: input.customStars ? null : (input.keptStars ?? null),
  updatedAt: new Date(input.updatedAt).toISOString(),
});

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
  keptStars: customRatingSchema.nullable().optional(),
  updatedAt: z.iso.datetime({ offset: true }),
});
