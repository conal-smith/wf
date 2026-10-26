/**
 * The protocol's bodies, checked (zod). The API parses every body it is sent
 * with these; each is held to its type in protocol.ts, so the two cannot
 * drift. The app does not import this file: its bundle carries no zod, and it
 * only ever sends what it built from the same types.
 */
import { z } from "zod";
import {
  DEFAULT_RIDER,
  MAX_WEIGHT_KG,
  MAX_WING_M2,
  MIN_WEIGHT_KG,
  MIN_WING_M2,
} from "../../force5/src/stars.js";
import {
  LIMITS,
  WEEKDAYS,
  type AlertRule,
  type Announcement,
  type DeviceRegistration,
  type DeviceUpdate,
  type Rider,
  type RulesPayload,
} from "./protocol.js";
import { customRatingSchema } from "../../site/shared/rider.js";
import { parseStarsChoice } from "../../force5/src/lead.js";

const int = (min: number, max: number) => z.number().int().min(min).max(max);

const starsModel = z.string().regex(/^[a-z0-9-]{1,24}$/, "Not a model id.");
// An app from before 23 October 2026 also sends the model for after the run's
// end (`then`) and spots of the rider's own (`spots`): no longer choices, they
// are taken and dropped.
const starsChoiceSchema = z
  .object({
    model: starsModel,
    then: starsModel.optional(),
    spots: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/), starsModel).optional(),
  })
  .refine((choice) => Object.keys(choice.spots ?? {}).length <= 200, "Too many spots.")
  .transform((choice) => parseStarsChoice(choice));

/**
 * How far into the wind, or below straight across it, a rider rides: whole
 * degrees, 0–45, held to that range rather than refused. The same as
 * force5/src/rideWedge.ts `clampUpwind` and `clampDownwind` (schema.test.ts
 * holds them together), repeated because that module is the browser's and
 * does not load on the server.
 */
export const ANGLE_MAX = 45;
const degrees = z
  .number()
  .finite()
  .transform((deg) => Math.min(ANGLE_MAX, Math.max(0, Math.round(deg))));

// An app from before 25 October 2026 also sends its level (`skill`), how
// much gusty wind bothers it (`gusty`) and a rating kept aside (`keptCustom`):
// no longer settings, they are not in the schema, so they are taken and
// dropped. Its own rating, made from a level (version 1 or 2), reads as none
// (`customRatingSchema`), and ours rates.
export const riderSchema = z.object({
  weightKg: z.number().min(MIN_WEIGHT_KG).max(MAX_WEIGHT_KG).nullable(),
  // How far into the wind, and below straight across it, they ride: neither
  // moves a star. Left out, ours.
  upwind: degrees.optional(),
  downwind: degrees.optional(),
  wings: z.array(z.number().min(MIN_WING_M2).max(MAX_WING_M2)).max(12),
  // The rider's own star rating, which the server then rates with.
  custom: customRatingSchema.optional(),
  // The one model the rider picked (force5/src/lead.ts), checked again by
  // `parseStarsChoice` so a model no longer published is the default.
  starsFrom: starsChoiceSchema.optional(),
}) satisfies z.ZodType<Rider>;

/**
 * A rider as a device's row keeps it, read again through `riderSchema`: a
 * row written by an app from before 25 October 2026 may hold a level and a
 * rating made from it, and is rated on ours. Never throws.
 */
export function storedRider(value: unknown): Rider {
  const read = riderSchema.safeParse(value);
  return read.success ? read.data : DEFAULT_RIDER;
}

/** A place id as the catalogue writes them: `brandon`, `fi-inchydoney-east-beach`. */
const spotId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "Not a spot id.");

export const ruleSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "Not a rule id."),
    name: z.string().trim().min(1).max(LIMITS.nameChars),
    spots: z
      .array(spotId)
      .min(1, "Pick at least one spot.")
      .max(LIMITS.spotsPerRule, `At most ${LIMITS.spotsPerRule} spots.`)
      .refine((s) => new Set(s).size === s.length, "A spot is listed twice."),
    minStars: int(LIMITS.minStars.min, LIMITS.minStars.max),
    days: z
      .array(z.enum(WEEKDAYS))
      .min(1, "Pick at least one day.")
      .max(7)
      .refine((d) => new Set(d).size === d.length, "A day is listed twice."),
    fromHour: int(0, 23),
    toHour: int(1, 24),
    minHours: int(LIMITS.minHours.min, LIMITS.minHours.max),
    leadDays: int(LIMITS.leadDays.min, LIMITS.leadDays.max),
    calledOff: z.boolean(),
    enabled: z.boolean(),
  })
  .refine((r) => r.fromHour < r.toHour, {
    message: "The hours must start before they end.",
    path: ["toHour"],
  }) satisfies z.ZodType<AlertRule>;

export const rulesPayloadSchema = z.object({
  rules: z
    .array(ruleSchema)
    .max(LIMITS.rules, `At most ${LIMITS.rules} alerts.`)
    .refine(
      (rules) => new Set(rules.map((r) => r.id)).size === rules.length,
      "Two alerts share an id.",
    ),
}) satisfies z.ZodType<RulesPayload>;

/** `ExponentPushToken[…]` (or the newer `ExpoPushToken[…]`). */
export const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/;
const pushToken = z.string().regex(EXPO_TOKEN, "Not an Expo push token.").nullable();

const deviceFields = {
  expoPushToken: pushToken,
  appVariant: z.enum(["development", "staging", "production"]),
  appVersion: z.string().regex(/^[0-9A-Za-z.+-]{1,32}$/, "Not a version."),
  timezone: z.string().min(1).max(64),
  rider: riderSchema,
  quietHours: z.boolean(),
  appUpdates: z.boolean(),
};

export const registrationSchema = z.object({
  installationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Not an installation id."),
  platform: z.enum(["ios", "android"]),
  ...deviceFields,
}) satisfies z.ZodType<DeviceRegistration>;

export const deviceUpdateSchema = z
  .object(deviceFields)
  .partial() satisfies z.ZodType<DeviceUpdate>;

export const announcementSchema = z.object({
  kind: z.literal("app-update"),
  version: z.string().regex(/^[0-9]+(\.[0-9]+){0,3}([+-][0-9A-Za-z.-]+)?$/, "Not a version."),
  platforms: z.array(z.enum(["ios", "android"])).min(1).max(2).optional(),
  title: z.string().trim().min(1).max(80).optional(),
  body: z.string().trim().min(1).max(240).optional(),
}) satisfies z.ZodType<Announcement>;
