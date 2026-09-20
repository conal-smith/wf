/**
 * Validation for the `users` row, shared by the API (authoritative) and the
 * profile form (for immediate feedback), the same way the marketplace shares
 * its listing schema.
 */
import { z } from "zod";
import { COUNTIES, RESERVED_HANDLES, USER_LIMITS } from "./types.js";

export const trimmed = (max: number) => z.string().trim().max(max);
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s.length ? s : null))
    .nullable()
    .optional();

export const county = z.enum(COUNTIES);

export const HANDLE_PATTERN = /^[a-z0-9-]+$/;

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(
    USER_LIMITS.handleMin,
    `Use a handle of at least ${USER_LIMITS.handleMin} characters`,
  )
  .max(
    USER_LIMITS.handleMax,
    `Keep your handle to ${USER_LIMITS.handleMax} characters or fewer`,
  )
  .regex(HANDLE_PATTERN, "Use only lowercase letters, numbers and hyphens")
  .refine((h) => !isReservedHandle(h), "That handle is reserved");

export function isReservedHandle(handle: string): boolean {
  return (RESERVED_HANDLES as readonly string[]).includes(handle);
}

const phone = z
  .string()
  .trim()
  .regex(
    /^\+?[0-9 ()-]{7,20}$/,
    "Enter a phone number with digits, spaces or a leading +",
  )
  .transform((s) => s.replace(/[^0-9+]/g, ""));

/** PUT /api/me. Contact is optional here; only publishing a listing asks for it. */
export const userInputSchema = z.object({
  displayName: trimmed(USER_LIMITS.displayNameMax).min(
    2,
    "Use a name of at least 2 characters",
  ),
  handle: handleSchema.optional(),
  county: county.nullable().optional(),
  contactEmail: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .max(120)
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  contactPhone: phone
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  contactWhatsapp: z.boolean().optional().default(false),
  bio: optionalText(USER_LIMITS.bioMax),
});

export type UserInputParsed = z.infer<typeof userInputSchema>;
