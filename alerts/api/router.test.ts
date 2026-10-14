import { describe, expect, it } from "vitest";
import { createLimiter } from "../../community/api/limits";
import { DEFAULT_RIDER } from "../../force5/src/stars";
import { RULE_DEFAULTS, type AlertRule, type DeviceRegistration, type PreviewPayload, type Registered } from "../shared/protocol";
import { memoryAlertsRepo } from "./repo-memory";
import { ALERTS_RATES, createAlertsRouter, type AlertsDeps } from "./router";
import { blendSource } from "./testing";

const NOW = Date.parse("2026-10-14T09:00:00Z");
const ADMIN = "an-admin-token-long-enough-to-pass";

const registration = (over: Partial<DeviceRegistration> = {}): DeviceRegistration => ({
  installationId: "install-abcdef12",
  expoPushToken: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  platform: "ios",
  appVariant: "production",
  appVersion: "1.2.0",
  timezone: "Europe/Dublin",
  rider: DEFAULT_RIDER,
  quietHours: true,
  appUpdates: true,
  ...over,
});

const rule = (over: Partial<AlertRule> = {}): AlertRule => ({
  id: "r1",
  name: "Brandon on a Saturday",
  spots: ["brandon"],
  ...RULE_DEFAULTS,
  days: ["sat"],
  ...over,
});

function setup(over: Partial<AlertsDeps> = {}) {
  const repo = memoryAlertsRepo();
  const kicked: number[] = [];
  const source = blendSource({
    start: "2026-10-14T00:00:00Z",
    hours: 120,
    generatedAt: "2026-10-14T08:00:00Z",
    spots: {
      // Cross-shore 18 kn on Saturday 14:00–17:00 Irish time.
      brandon: (t) =>
        t >= Date.parse("2026-10-17T13:00:00Z") && t < Date.parse("2026-10-17T16:00:00Z")
          ? { wind: 18, gust: 22, from: 190 }
          : { wind: 3, gust: 5, from: 190 },
    },
  });
  const r = createAlertsRouter({
    repo,
    source,
    adminToken: ADMIN,
    now: () => NOW,
    limiter: { take: () => {} },
    kick: () => kicked.push(1),
    ...over,
  });
  const call = (method: string, path: string, body?: unknown, auth?: string) =>
    r.request(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(auth ? { Authorization: auth } : {}),
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  const register = async (over: Partial<DeviceRegistration> = {}) => {
    const response = await call("POST", "/devices", registration(over));
    expect(response.status).toBe(201);
    const body = (await response.json()) as Registered;
    return { ...body, auth: `Device ${body.device.id}.${body.secret}` };
  };
  return { repo, call, register, kicked };
}

describe("devices", () => {
  it("registers without an account and answers the secret once, keeping only its hash", async () => {
    const { repo, register, call } = setup();
    const { device, secret, auth } = await register();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(device).toMatchObject({ platform: "ios", hasPushToken: true, quietHours: true, appUpdates: true });
    expect(device).not.toHaveProperty("expoPushToken");
    const stored = (await repo.getDevice(device.id))!;
    expect(stored.secretHash).not.toContain(secret);
    expect(await (await call("GET", "/devices/me", undefined, auth)).json()).toMatchObject({ id: device.id });
  });

  it("refuses a missing, malformed or wrong secret", async () => {
    const { register, call } = setup();
    const { device } = await register();
    expect((await call("GET", "/devices/me")).status).toBe(401);
    expect((await call("GET", "/devices/me", undefined, "Bearer x")).status).toBe(401);
    expect((await call("GET", "/devices/me", undefined, `Device ${device.id}.${"a".repeat(43)}`)).status).toBe(401);
  });

  it("says which fields are wrong", async () => {
    const { call } = setup();
    const response = await call("POST", "/devices", registration({ expoPushToken: "nope", platform: "web" as "ios" }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; details: Record<string, string> };
    expect(body.error).toBe("invalid");
    expect(Object.keys(body.details).sort()).toEqual(["expoPushToken", "platform"]);
    expect((await call("POST", "/devices", "{not json")).status).toBe(400);
  });

  it("updates the token, rider and preferences, and gives a token to its newest device only", async () => {
    const { register, call, repo } = setup();
    const a = await register();
    const b = await register({ expoPushToken: null, installationId: "install-second" });
    const put = await call(
      "PUT",
      "/devices/me",
      { expoPushToken: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", rider: { weightKg: 90, skill: "advanced", wings: [4, 5.5] }, quietHours: false },
      b.auth,
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ hasPushToken: true, quietHours: false, rider: { weightKg: 90 } });
    expect((await repo.getDevice(a.device.id))!.expoPushToken).toBeNull();
    expect((await call("PUT", "/devices/me", { rider: { weightKg: 500, skill: "x", wings: [] } }, b.auth)).status).toBe(400);
  });

  it("forgets a device and everything about it", async () => {
    const { register, call, repo } = setup();
    const { device, auth } = await register();
    await call("PUT", "/devices/me/rules", { rules: [rule()] }, auth);
    expect((await call("DELETE", "/devices/me", undefined, auth)).status).toBe(204);
    expect(await repo.getDevice(device.id)).toBeNull();
    expect((await call("GET", "/devices/me/rules", undefined, auth)).status).toBe(401);
  });
});

describe("rules", () => {
  it("replaces the whole list", async () => {
    const { register, call } = setup();
    const { auth } = await register();
    const put = await call("PUT", "/devices/me/rules", { rules: [rule(), rule({ id: "r2", spots: ["inch", "keel"] })] }, auth);
    expect(put.status).toBe(200);
    const got = (await (await call("GET", "/devices/me/rules", undefined, auth)).json()) as { rules: AlertRule[] };
    expect(got.rules.map((r) => r.id)).toEqual(["r1", "r2"]);
    await call("PUT", "/devices/me/rules", { rules: [] }, auth);
    expect(((await (await call("GET", "/devices/me/rules", undefined, auth)).json()) as { rules: [] }).rules).toEqual([]);
  });

  it("refuses rules that cannot match, and more than twenty", async () => {
    const { register, call } = setup();
    const { auth } = await register();
    const bad = async (rules: unknown) => (await call("PUT", "/devices/me/rules", { rules }, auth)).status;
    expect(await bad([rule({ spots: [] })])).toBe(400);
    expect(await bad([rule({ spots: Array.from({ length: 21 }, (_, i) => `s${i}`) })])).toBe(400);
    expect(await bad([rule({ minStars: 6 })])).toBe(400);
    expect(await bad([rule({ days: [] })])).toBe(400);
    expect(await bad([rule({ fromHour: 18, toHour: 9 })])).toBe(400);
    expect(await bad([rule({ leadDays: 8 })])).toBe(400);
    expect(await bad([rule(), rule()])).toBe(400);
    expect(await bad(Array.from({ length: 21 }, (_, i) => rule({ id: `r${i}` })))).toBe(400);
    expect(await bad(Array.from({ length: 20 }, (_, i) => rule({ id: `r${i}` })))).toBe(200);
  });
});

describe("preview", () => {
  it("gives each rule's next windows, rated for the device's rider", async () => {
    const { register, call } = setup();
    const { auth } = await register();
    await call("PUT", "/devices/me/rules", { rules: [rule({ fromHour: 0, toHour: 24 }), rule({ id: "r2", spots: ["nowhere"] })] }, auth);
    const response = await call("GET", "/devices/me/preview", undefined, auth);
    const body = (await response.json()) as PreviewPayload;
    expect(body.run).toBe("2026101400");
    expect(body.rules[0].matches).toMatchObject([
      { spotId: "brandon", start: "2026-10-17T13:00:00.000Z", end: "2026-10-17T16:00:00.000Z", stars: 5 },
    ]);
    expect(body.rules[1].matches).toEqual([]);
    expect(body.unknownSpots).toEqual(["nowhere"]);
  });

  it("says when there is no forecast to preview", async () => {
    const { register, call } = setup({ source: null });
    const { auth } = await register();
    expect((await call("GET", "/devices/me/preview", undefined, auth)).status).toBe(503);
  });
});

describe("announce", () => {
  it("is the release pipeline's, behind its token", async () => {
    const { call, register, kicked } = setup();
    await register({ appVersion: "1.2.0" });
    const body = { kind: "app-update", version: "1.3.0" };
    expect((await call("POST", "/announce", body)).status).toBe(401);
    expect((await call("POST", "/announce", body, "Bearer wrong-token-wrong-token-wrong")).status).toBe(401);
    expect((await call("POST", "/announce", { kind: "news" }, `Bearer ${ADMIN}`)).status).toBe(400);
    const first = await call("POST", "/announce", body, `Bearer ${ADMIN}`);
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ queued: 1, already: false });
    expect(kicked).toHaveLength(1);
    const again = await call("POST", "/announce", body, `Bearer ${ADMIN}`);
    expect([again.status, await again.json()]).toEqual([200, { queued: 0, already: true }]);
  });

  it("is off without a token configured", async () => {
    const { call } = setup({ adminToken: null });
    expect((await call("POST", "/announce", { kind: "app-update", version: "1.0.0" }, "Bearer anything")).status).toBe(503);
  });
});

describe("rate limits", () => {
  it("limits registrations per address and writes per device", async () => {
    let t = NOW;
    const { call } = setup({ limiter: createLimiter(() => new Date(t), ALERTS_RATES) });
    const post = () => call("POST", "/devices", registration({ expoPushToken: null }));
    for (let i = 0; i < 10; i++) expect((await post()).status).toBe(201);
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    t += 3_600_000;
    expect((await post()).status).toBe(201);
  });
});

describe("in the API", () => {
  async function appWith(features: { alerts?: boolean }) {
    const { createApp } = await import("../../market/api/src/app");
    const { devVerifier } = await import("../../market/api/src/auth");
    const { memoryRepo } = await import("../../market/api/src/repo-memory");
    const { memoryRepo: memoryCommunityRepo } = await import("../../community/api/repo-memory");
    const { devIdentity } = await import("../../site/api/identity");
    const { memoryUsersRepo } = await import("../../site/api/repo-memory");
    const users = memoryUsersRepo();
    return createApp({
      repo: memoryRepo(users),
      community: memoryCommunityRepo(users),
      people: { users, identity: devIdentity() },
      storage: {
        keyFor: () => "market/x.jpg",
        publicUrl: (key) => key,
        presign: async (key) => ({ key, uploadUrl: key, method: "PUT", headers: {}, publicUrl: key }),
        delete: async () => {},
      },
      verify: devVerifier(),
      storagePrefix: "market",
      corsOrigins: "*",
      authMode: "dev",
      features,
      alerts: { repo: memoryAlertsRepo(), source: null, adminToken: null, limiter: { take: () => {} } },
    });
  }

  it("is mounted at /api/alerts, and answers 404 off when FEATURE_ALERTS is not 1", async () => {
    const on = await appWith({});
    expect(await (await on.request("/api/alerts/status")).json()).toEqual({
      enabled: true,
      evaluating: false,
      forecast: false,
    });
    const off = await appWith({ alerts: false });
    const status = await off.request("/api/alerts/status");
    expect(status.status).toBe(404);
    expect(await status.json()).toMatchObject({ error: "off" });
    expect((await off.request("/api/market/meta")).status).toBe(200);
  });
});
