/**
 * Star-condition alerts over HTTP, mounted at /api/alerts by market/api's
 * createApp when FEATURE_ALERTS=1. See alerts/README.md for the contract.
 *
 *   GET    /status                 whether alerts are on and evaluating here
 *   POST   /devices                register an install; answers its secret once
 *   GET    /devices/me             the device as stored (never its token or secret)
 *   PUT    /devices/me             push token, rider, preferences, version
 *   DELETE /devices/me             forget the device, its rules and everything sent
 *   GET    /devices/me/rules       its rules
 *   PUT    /devices/me/rules       replace them (at most 20)
 *   GET    /devices/me/preview     the next windows each rule matches, as evaluated here
 *   POST   /announce               an app-update note (Bearer ALERTS_ADMIN_TOKEN)
 */
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";
import { createLimiter, type Limiter, type Rates } from "../../community/api/limits.js";
import type { ForecastSource } from "../../mcp/api/source.js";
import { matchRule } from "../shared/match.js";
import type { DeviceView, PreviewPayload, Registered } from "../shared/protocol.js";
import {
  announcementSchema,
  deviceUpdateSchema,
  registrationSchema,
  rulesPayloadSchema,
} from "../shared/schema.js";
import { deviceCredentials, hashSecret, isAdmin, newDeviceId, newSecret, secretMatches } from "./auth.js";
import { announce } from "./evaluate.js";
import { PLACES, ratingCache, readBlend, readBlendPointer, staleBlend, type Blend } from "./forecast.js";
import type { AlertsRepo, DeviceRow } from "./repo.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface AlertsDeps {
  repo: AlertsRepo;
  /** Where the blend is read for previews; null answers 503 not_configured. */
  source: ForecastSource | null;
  /** ALERTS_ADMIN_TOKEN; null leaves /announce answering 503. */
  adminToken: string | null;
  /** Whether this instance evaluates (ALERTS_EVALUATE=1), for /status. */
  evaluating?: boolean;
  /** Send what is due now (after an announcement); left out, the next pass sends it. */
  kick?: () => void;
  now?: () => number;
  limiter?: Limiter;
}

/**
 * The community's token buckets under their names: a registration per IP is
 * a "thread", a device's write a "message", a preview a "reaction", an
 * announcement a "report".
 */
export const ALERTS_RATES: Rates = {
  thread: [{ max: 10, perMs: HOUR }],
  message: [
    { max: 20, perMs: MINUTE },
    { max: 300, perMs: HOUR },
  ],
  reaction: [{ max: 20, perMs: MINUTE }],
  report: [{ max: 10, perMs: HOUR }],
};

const JSON_LIMIT = 32 * 1024;
/** How long a preview's blend is kept before the pointer is read again. */
const PREVIEW_BLEND_MS = 5 * MINUTE;
/** Seen-at is written at most this often per device. */
const TOUCH_EVERY_MS = HOUR;

type Env = { Variables: { device: DeviceRow } };

function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const deviceView = (d: DeviceRow): DeviceView => ({
  id: d.id,
  platform: d.platform,
  appVariant: d.appVariant,
  appVersion: d.appVersion,
  timezone: d.timezone,
  hasPushToken: d.expoPushToken !== null,
  rider: d.rider,
  quietHours: d.quietHours,
  appUpdates: d.appUpdates,
  createdAt: d.createdAt.toISOString(),
  rulesUpdatedAt: d.rulesUpdatedAt.toISOString(),
});

const refuse = (c: Context, status: 400 | 401 | 404 | 503, error: string, message: string, details?: Record<string, string>) =>
  c.json({ error, message, ...(details ? { details } : {}) }, status);

async function parse<S extends z.ZodType>(c: Context, schema: S): Promise<{ ok: true; value: z.infer<S> } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, response: refuse(c, 400, "invalid", "Send a JSON body.") };
  }
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, value: result.data };
  const details: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "body";
    details[path] ??= issue.message;
  }
  return { ok: false, response: refuse(c, 400, "invalid", "Some fields need attention.", details) };
}

export function createAlertsRouter(deps: AlertsDeps) {
  const { repo } = deps;
  const now = () => (deps.now ?? Date.now)();
  const limiter = deps.limiter ?? createLimiter(() => new Date(now()), ALERTS_RATES);
  const r = new Hono<Env>();

  const authed = async (c: Context<Env>, next: Next) => {
    const credentials = deviceCredentials(c.req.header("authorization"));
    if (!credentials) return refuse(c, 401, "unauthorized", "Send Authorization: Device <id>.<secret>.");
    const device = await repo.getDevice(credentials.id);
    if (!device || !secretMatches(credentials.secret, device.secretHash))
      return refuse(c, 401, "unauthorized", "This device is not registered here. Register it again.");
    if (now() - device.lastSeenAt.getTime() > TOUCH_EVERY_MS) await repo.touchDevice(device.id, new Date(now()));
    c.set("device", device);
    await next();
  };
  const writes = async (c: Context<Env>, next: Next) => {
    limiter.take(`alerts:${c.var.device.id}`, "message");
    await next();
  };

  r.get("/status", (c) =>
    c.json({ enabled: true, evaluating: !!deps.evaluating, forecast: !!deps.source }),
  );

  r.post("/devices", bodyLimit({ maxSize: JSON_LIMIT }), async (c) => {
    limiter.take(`alerts:${clientIp(c)}`, "thread");
    const parsed = await parse(c, registrationSchema);
    if (!parsed.ok) return parsed.response;
    const secret = newSecret();
    const device = await repo.createDevice(
      { id: newDeviceId(), secretHash: hashSecret(secret), ...parsed.value },
      new Date(now()),
    );
    const body: Registered = { device: deviceView(device), secret };
    return c.json(body, 201);
  });

  r.get("/devices/me", authed, (c) => c.json(deviceView(c.var.device)));

  r.put("/devices/me", authed, writes, bodyLimit({ maxSize: JSON_LIMIT }), async (c) => {
    const parsed = await parse(c, deviceUpdateSchema);
    if (!parsed.ok) return parsed.response;
    const device = await repo.updateDevice(c.var.device.id, parsed.value, new Date(now()));
    if (!device) return refuse(c, 401, "unauthorized", "This device is not registered here. Register it again.");
    return c.json(deviceView(device));
  });

  r.delete("/devices/me", authed, async (c) => {
    await repo.deleteDevice(c.var.device.id);
    return c.body(null, 204);
  });

  r.get("/devices/me/rules", authed, (c) =>
    c.json({ rules: c.var.device.rules, updatedAt: c.var.device.rulesUpdatedAt.toISOString() }),
  );

  r.put("/devices/me/rules", authed, writes, bodyLimit({ maxSize: JSON_LIMIT }), async (c) => {
    const parsed = await parse(c, rulesPayloadSchema);
    if (!parsed.ok) return parsed.response;
    const device = await repo.putRules(c.var.device.id, parsed.value.rules, new Date(now()));
    if (!device) return refuse(c, 401, "unauthorized", "This device is not registered here. Register it again.");
    return c.json({ rules: device.rules, updatedAt: device.rulesUpdatedAt.toISOString() });
  });

  // The blend previews are worked out on, read again at most every five minutes.
  type Held = { at: number; blend: Blend | null; ratings: ReturnType<typeof ratingCache> | null };
  let held: Held | null = null;
  let loading: Promise<Held> | null = null;
  const previewBlend = async (): Promise<Held> => {
    if (held && now() - held.at < PREVIEW_BLEND_MS) return held;
    loading ??= (async (): Promise<Held> => {
      try {
        const pointer = await readBlendPointer(deps.source!);
        const blend =
          pointer && !staleBlend(pointer, now())
            ? held?.blend?.pointer.base === pointer.base
              ? held.blend
              : await readBlend(deps.source!, pointer)
            : null;
        const fresh: Held = { at: now(), blend, ratings: blend ? ratingCache(blend) : null };
        held = fresh;
        return fresh;
      } finally {
        loading = null;
      }
    })();
    return loading;
  };

  r.get("/devices/me/preview", authed, async (c) => {
    limiter.take(`alerts:${c.var.device.id}`, "reaction");
    if (!deps.source) return refuse(c, 503, "not_configured", "The forecast is not configured here.");
    const device = c.var.device;
    const { blend, ratings } = await previewBlend();
    const unknownSpots = [...new Set(device.rules.flatMap((rule) => rule.spots))].filter(
      (id) => !PLACES.has(id) || (blend !== null && !blend.spots[id]),
    );
    if (!blend || !ratings) {
      const empty: PreviewPayload = {
        run: null,
        generatedAt: null,
        rules: device.rules.map((rule) => ({ ruleId: rule.id, matches: [] })),
        unknownSpots,
      };
      return c.json(empty);
    }
    const hoursOf = ratings(device.rider);
    const body: PreviewPayload = {
      run: blend.pointer.run,
      generatedAt: blend.pointer.generatedAt,
      rules: device.rules.map((rule) => ({
        ruleId: rule.id,
        matches: matchRule(rule, blend.pointer.times, hoursOf, now()),
      })),
      unknownSpots,
    };
    return c.json(body);
  });

  r.post("/announce", bodyLimit({ maxSize: JSON_LIMIT }), async (c) => {
    if (!deps.adminToken)
      return refuse(c, 503, "not_configured", "ALERTS_ADMIN_TOKEN is not set here.");
    if (!isAdmin(c.req.header("authorization"), deps.adminToken))
      return refuse(c, 401, "unauthorized", "Send Authorization: Bearer <ALERTS_ADMIN_TOKEN>.");
    limiter.take("alerts:announce", "report");
    const parsed = await parse(c, announcementSchema);
    if (!parsed.ok) return parsed.response;
    const result = await announce({ repo, now: deps.now }, parsed.value);
    if (result.queued) deps.kick?.();
    return c.json(result, result.already ? 200 : 202);
  });

  return r;
}
