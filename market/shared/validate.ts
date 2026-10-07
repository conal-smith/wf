/**
 * Validation and formatting shared by the API (authoritative) and the form
 * (for immediate feedback). The same schema runs on both sides, so what the
 * form accepts is exactly what the server accepts.
 */
import { z } from "zod";
import {
  CATEGORY_IDS,
  CONDITION_IDS,
  CURRENCIES,
  LIMITS,
  PHOTO_CONTENT_TYPES,
  SORTS,
  type Currency,
  type ListingQuery,
} from "./types.js";
import {
  county,
  optionalText,
  trimmed,
  userInputSchema,
} from "../../site/shared/validate.js";

export const photoInputSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    key: z.string().min(1).max(200).optional(),
    width: z.number().int().positive().max(20000).nullable().optional(),
    height: z.number().int().positive().max(20000).nullable().optional(),
  })
  .refine((p) => Boolean(p.id) !== Boolean(p.key), {
    message: "A photo is either an existing id or a new upload key, not both",
  });

export const listingInputSchema = z.object({
  title: trimmed(LIMITS.titleMax).min(
    4,
    "Give the listing a title of at least 4 characters",
  ),
  description: trimmed(LIMITS.descriptionMax).min(
    20,
    "Describe the item in at least 20 characters: age, use, damage, what is included",
  ),
  // The form starts these three on "Choose…", so an empty one is the seller
  // not having chosen yet: say that, not zod's list of every allowed id.
  category: z.enum(CATEGORY_IDS as [string, ...string[]], {
    error: "Choose what kind of gear this is",
  }),
  condition: z.enum(CONDITION_IDS as [string, ...string[]], {
    error: "Choose the condition it is in",
  }),
  brand: optionalText(LIMITS.brandMax),
  sizeLabel: optionalText(LIMITS.sizeMax),
  year: z
    .number()
    .int()
    .min(2010, "Wingfoiling gear predates 2010 only in spirit")
    .max(new Date().getUTCFullYear() + 1)
    .nullable()
    .optional(),
  priceCents: z
    .number()
    .int()
    .min(0)
    .max(LIMITS.priceCentsMax, "That price is above the marketplace ceiling"),
  currency: z.enum(CURRENCIES),
  county: z.enum(county.options, {
    error: "Choose the county the gear is in",
  }),
  town: optionalText(LIMITS.townMax),
  photos: z.array(photoInputSchema).max(LIMITS.photosPerListing),
});

export type ListingInputParsed = z.infer<typeof listingInputSchema>;

/**
 * The seller's form: the site's own profile fields, plus the one thing only
 * the marketplace asks for. PUT /me itself accepts a row with no contact;
 * publishing a listing is where the API insists (contact_required).
 */
export const profileInputSchema = userInputSchema.refine(
  (p) => p.contactEmail || p.contactPhone,
  {
    message:
      "Buyers need at least one way to reach you: an email or a phone number",
    path: ["contactEmail"],
  },
);

export const reviewInputSchema = z.object({
  rating: z
    .number()
    .int()
    .min(1, "Pick between 1 and 5 stars")
    .max(5, "Pick between 1 and 5 stars"),
  comment: optionalText(LIMITS.reviewCommentMax),
});

export type ReviewInputParsed = z.infer<typeof reviewInputSchema>;

export const presignRequestSchema = z.object({
  contentType: z.enum(PHOTO_CONTENT_TYPES),
  byteLength: z.number().int().positive().max(LIMITS.photoBytesMax),
});

const intParam = z.coerce.number().int();

export const listingQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((s) => (s ? s : undefined)),
  category: z.enum(CATEGORY_IDS as [string, ...string[]]).optional(),
  county: county.optional(),
  condition: z.enum(CONDITION_IDS as [string, ...string[]]).optional(),
  minPriceCents: intParam.min(0).optional(),
  maxPriceCents: intParam.min(0).optional(),
  sort: z.enum(SORTS).default("newest"),
  page: intParam.min(1).max(500).default(1),
});

/** Parse URL search params into a ListingQuery, dropping anything invalid. */
export function parseListingQuery(params: URLSearchParams): ListingQuery {
  const raw: Record<string, string> = {};
  for (const key of [
    "q",
    "category",
    "county",
    "condition",
    "minPriceCents",
    "maxPriceCents",
    "sort",
    "page",
  ]) {
    const value = params.get(key);
    if (value !== null && value !== "") raw[key] = value;
  }
  const result = listingQuerySchema.safeParse(raw);
  if (result.success) return result.data as ListingQuery;
  // Keep the fields that did parse, so one bad filter does not blank the page.
  const bad = new Set(result.error.issues.map((i) => String(i.path[0])));
  for (const key of bad) delete raw[key];
  return listingQuerySchema.parse(raw) as ListingQuery;
}

/** The inverse of parseListingQuery, omitting defaults so URLs stay short. */
export function listingQueryToParams(
  query: Partial<ListingQuery>,
): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.county) params.set("county", query.county);
  if (query.condition) params.set("condition", query.condition);
  if (query.minPriceCents != null)
    params.set("minPriceCents", String(query.minPriceCents));
  if (query.maxPriceCents != null)
    params.set("maxPriceCents", String(query.maxPriceCents));
  if (query.sort && query.sort !== "newest") params.set("sort", query.sort);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  return params;
}

const SYMBOL: Record<Currency, string> = { EUR: "€", GBP: "£" };

/** "€1,250" for whole amounts, "€1,249.50" otherwise, "Free" for zero. */
export function formatPrice(cents: number, currency: Currency): string {
  if (cents === 0) return "Free";
  const whole = Math.floor(cents / 100);
  const minor = cents % 100;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${SYMBOL[currency]}${grouped}${minor ? "." + String(minor).padStart(2, "0") : ""}`;
}

/** Turn what a person types into a price box into cents, or null if it is not a price. */
export function parsePriceInput(text: string): number | null {
  const cleaned = text.replace(/[€£,\s]/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, minor = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(minor.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Human "3 days ago" style age for listing cards. */
export function relativeAge(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/** Flatten zod issues into { field: message } for a form. */
export function issuesByField(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
