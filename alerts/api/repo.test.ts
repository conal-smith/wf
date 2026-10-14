/**
 * One contract, two stores. Everything runs against the memory repo always,
 * and against Postgres when DATABASE_URL is set (npm run market:db), in a
 * schema of its own made by the real migrations and dropped afterwards:
 *
 *   DATABASE_URL=postgres://market:market@127.0.0.1:55432/market npm test
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_RIDER } from "../../force5/src/stars";
import { ALERTS_LEDGER, ALERTS_MIGRATIONS_DIR, migrate, type Db } from "../../market/api/src/db";
import { RULE_DEFAULTS, type AlertRule } from "../shared/protocol";
import { evaluateOnce } from "./evaluate";
import { PLACES } from "./forecast";
import type { ExpoMessage } from "./push";
import { blendSource } from "./testing";
import type { AlertsRepo, NewDevice, Notice, OutboxMessage } from "./repo";
import { memoryAlertsRepo } from "./repo-memory";
import { pgAlertsRepo, pgEvaluatorLock } from "./repo-pg";

const T0 = new Date("2026-10-14T09:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
let n = 0;
const device = (over: Partial<NewDevice> = {}): NewDevice => ({
  id: `dev${String(++n).padStart(13, "0")}`,
  installationId: "install-1",
  secretHash: "hash",
  expoPushToken: `ExponentPushToken[t${n}xxxxxxxxx]`,
  platform: "ios",
  appVariant: "production",
  appVersion: "1.0.0",
  timezone: "Europe/Dublin",
  rider: DEFAULT_RIDER,
  quietHours: true,
  appUpdates: true,
  ...over,
});
const rule = (over: Partial<AlertRule> = {}): AlertRule => ({
  id: "r1",
  name: "Brandon",
  spots: ["brandon"],
  ...RULE_DEFAULTS,
  ...over,
});
const notice = (over: Partial<Notice> = {}): Notice => ({
  ruleId: "r1",
  spotId: "brandon",
  day: "2026-10-17",
  ruleSig: "sig",
  start: "2026-10-17T13:00:00.000Z",
  end: "2026-10-17T16:00:00.000Z",
  stars: 4,
  state: "told",
  count: 1,
  ...over,
});
const message = (deviceId: string, over: Partial<OutboxMessage> = {}): OutboxMessage => ({
  deviceId,
  key: "r1|brandon|2026-10-17",
  kind: "new",
  deliverAfter: T0,
  expiresAt: at(600),
  title: "Brandon Bay ★★★★ Sat 14:00–17:00",
  body: "S 18 kn.",
  data: { kind: "new", path: "/?spot=brandon" },
  channelId: "alerts",
  ...over,
});

function contract(name: string, fresh: () => AlertsRepo | Promise<AlertsRepo>) {
  const make = () => fresh();
  describe(name, () => {
    it("keeps a device, its rules and its token, one device per token", async () => {
      const repo = await make();
      const a = await repo.createDevice(device(), T0);
      expect(a).toMatchObject({ rules: [], rider: DEFAULT_RIDER, quietHours: true });
      const b = await repo.createDevice(device({ expoPushToken: a.expoPushToken }), at(1));
      expect((await repo.getDevice(a.id))!.expoPushToken).toBeNull();
      expect((await repo.getDevice(b.id))!.expoPushToken).toBe(a.expoPushToken);
      const updated = await repo.updateDevice(a.id, { expoPushToken: b.expoPushToken, quietHours: false }, at(2));
      expect(updated).toMatchObject({ expoPushToken: b.expoPushToken, quietHours: false, appVersion: "1.0.0" });
      expect((await repo.getDevice(b.id))!.expoPushToken).toBeNull();
      const withRules = await repo.putRules(a.id, [rule(), rule({ id: "r2", enabled: false })], at(3));
      expect(withRules!.rules.map((r) => r.id)).toEqual(["r1", "r2"]);
      expect(withRules!.rulesUpdatedAt.getTime()).toBe(at(3).getTime());
      expect(await repo.updateDevice("dev-missing-0000", {}, at(4))).toBeNull();
      expect(await repo.putRules("dev-missing-0000", [], at(4))).toBeNull();
    });

    it("lists what to evaluate: devices with a token and something to say, changed since a time", async () => {
      const repo = await make();
      const a = await repo.createDevice(device(), T0);
      await repo.putRules(a.id, [rule()], T0);
      const off = await repo.createDevice(device(), T0);
      await repo.putRules(off.id, [rule({ enabled: false })], T0);
      const silent = await repo.createDevice(device({ expoPushToken: null }), T0);
      await repo.putRules(silent.id, [rule()], T0);
      expect((await repo.devicesToEvaluate(null)).map((d) => d.id)).toEqual([a.id]);
      expect(await repo.devicesToEvaluate(at(1))).toEqual([]);
      await repo.putRules(off.id, [rule()], at(2));
      expect((await repo.devicesToEvaluate(at(1))).map((d) => d.id)).toEqual([off.id]);
      // A device with only a notice left is still settled (to forget it, or call it off).
      await repo.putRules(a.id, [], at(3));
      await repo.applyPlan({ deviceId: a.id, notices: { put: [notice()], drop: [] }, outbox: { put: [], drop: [] } });
      expect((await repo.devicesToEvaluate(at(2))).map((d) => d.id)).toEqual([a.id]);
    });

    it("applies a plan: notices and the outbox, one message per key", async () => {
      const repo = await make();
      const d = await repo.createDevice(device(), T0);
      await repo.applyPlan({
        deviceId: d.id,
        notices: { put: [notice(), notice({ day: "2026-10-18" })], drop: [] },
        outbox: { put: [message(d.id), message(d.id, { key: "other" })], drop: [] },
      });
      await repo.applyPlan({
        deviceId: d.id,
        notices: { put: [notice({ stars: 5, count: 2 })], drop: [{ ruleId: "r1", spotId: "brandon", day: "2026-10-18" }] },
        outbox: { put: [message(d.id, { kind: "update", title: "again" })], drop: ["other"] },
      });
      expect(await repo.notices(d.id)).toEqual([notice({ stars: 5, count: 2 })]);
      const queued = await repo.queued(d.id);
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({ kind: "update", title: "again", data: { kind: "new" }, attempts: 0 });
      // A plan for a device that is gone does nothing.
      await repo.applyPlan({ deviceId: "dev-missing-0000", notices: { put: [notice()], drop: [] }, outbox: { put: [], drop: [] } });
    });

    it("hands each due message out once, holds the rest, and drops the expired", async () => {
      const repo = await make();
      const d = await repo.createDevice(device(), T0);
      await repo.enqueue([
        message(d.id, { key: "now" }),
        message(d.id, { key: "later", deliverAfter: at(60) }),
        message(d.id, { key: "gone", expiresAt: at(-1) }),
        message("dev-missing-0000", { key: "orphan" }),
      ]);
      const [first, second] = await Promise.all([repo.claimDue(T0, 10), repo.claimDue(T0, 10)]);
      expect([...first, ...second].map((r) => r.key)).toEqual(["now"]);
      expect((await repo.queued(d.id)).map((r) => r.key)).toEqual(["later"]);
      await repo.requeue(first.length ? first : second, at(5));
      expect(await repo.claimDue(at(4), 10)).toEqual([]);
      const again = await repo.claimDue(at(5), 10);
      expect(again).toMatchObject([{ key: "now", attempts: 1 }]);
    });

    it("keeps tickets for their receipts and clears a dead token only if it is still held", async () => {
      const repo = await make();
      const d = await repo.createDevice(device(), T0);
      await repo.addTickets([
        { id: "t1", deviceId: d.id, token: d.expoPushToken!, createdAt: T0 },
        { id: "t2", deviceId: d.id, token: d.expoPushToken!, createdAt: at(30) },
      ]);
      expect((await repo.ticketsBefore(at(15), 10)).map((t) => t.id)).toEqual(["t1"]);
      await repo.dropTickets(["t1"]);
      expect((await repo.ticketsBefore(at(60), 10)).map((t) => t.id)).toEqual(["t2"]);
      await repo.clearToken(d.id, "ExponentPushToken[other]");
      expect((await repo.getDevice(d.id))!.expoPushToken).not.toBeNull();
      await repo.clearToken(d.id, d.expoPushToken!);
      expect((await repo.getDevice(d.id))!.expoPushToken).toBeNull();
    });

    it("finds app-update subscribers by platform and variant", async () => {
      const repo = await make();
      const ios = await repo.createDevice(device(), T0);
      await repo.createDevice(device({ platform: "android" }), T0);
      await repo.createDevice(device({ appVariant: "staging" }), T0);
      await repo.createDevice(device({ appUpdates: false }), T0);
      expect((await repo.updateSubscribers(["ios"], ["production"])).map((d) => d.id)).toEqual([ios.id]);
      expect(await repo.updateSubscribers([], ["production"])).toEqual([]);
    });

    it("keeps a little state, and claims a key once", async () => {
      const repo = await make();
      expect(await repo.getState("evaluated")).toBeNull();
      await repo.setState("evaluated", { run: "a" });
      await repo.setState("evaluated", { run: "b" });
      expect(await repo.getState("evaluated")).toEqual({ run: "b" });
      expect(await repo.claimState("announce:1", { at: 1 })).toBe(true);
      expect(await repo.claimState("announce:1", { at: 2 })).toBe(false);
    });

    it("forgets a device with everything about it, and stale devices and past notices", async () => {
      const repo = await make();
      const d = await repo.createDevice(device(), T0);
      await repo.applyPlan({ deviceId: d.id, notices: { put: [notice()], drop: [] }, outbox: { put: [message(d.id)], drop: [] } });
      await repo.addTickets([{ id: "t9", deviceId: d.id, token: "x", createdAt: T0 }]);
      expect(await repo.deleteDevice(d.id)).toBe(true);
      expect(await repo.deleteDevice(d.id)).toBe(false);
      expect(await repo.notices(d.id)).toEqual([]);
      expect(await repo.queued(d.id)).toEqual([]);
      expect(await repo.ticketsBefore(at(100), 10)).toEqual([]);

      const old = await repo.createDevice(device(), new Date("2026-01-01T00:00:00Z"));
      const kept = await repo.createDevice(device(), T0);
      await repo.applyPlan({ deviceId: kept.id, notices: { put: [notice({ end: "2026-10-12T16:00:00.000Z" }), notice({ day: "2026-10-18" })], drop: [] }, outbox: { put: [], drop: [] } });
      await repo.prune(T0);
      expect(await repo.getDevice(old.id)).toBeNull();
      expect((await repo.notices(kept.id)).map((x) => x.day)).toEqual(["2026-10-18"]);
    });

    it("runs an evaluation end to end, a digest and all", async () => {
      const repo = await make();
      const spots = ["brandon", "dollymount", "rusheen", "keel"];
      const d = await repo.createDevice(device(), T0);
      await repo.putRules(d.id, [rule({ spots, fromHour: 0, toHour: 24, days: ["sat"] })], T0);
      const sent: ExpoMessage[] = [];
      const source = blendSource({
        start: "2026-10-14T00:00:00Z",
        hours: 120,
        generatedAt: T0.toISOString(),
        spots: Object.fromEntries(
          spots.map((id) => [
            id,
            (t: number) =>
              t >= Date.parse("2026-10-17T13:00:00Z") && t < Date.parse("2026-10-17T16:00:00Z")
                ? { wind: 18, gust: 22, from: ((PLACES.get(id)!.facing ?? 0) + 90) % 360 }
                : { wind: 3, gust: 5, from: 0 },
          ]),
        ),
      });
      const deps = {
        repo,
        source,
        push: {
          send: async (messages: readonly ExpoMessage[]) => {
            sent.push(...messages);
            return messages.map((_, i) => ({ status: "ok" as const, id: `ticket-${i}` }));
          },
          receipts: async () => ({}),
        },
        now: () => T0.getTime(),
      };
      expect(await evaluateOnce(deps)).toMatchObject({ evaluated: 1, planned: 4, sent: 1 });
      expect(sent).toMatchObject([{ title: "★★★★★ at 4 spots", data: { kind: "digest", spot: "brandon" } }]);
      expect(await repo.notices(d.id)).toHaveLength(4);
      expect(await repo.ticketsBefore(at(1), 10)).toHaveLength(1);
      expect(await evaluateOnce(deps)).toMatchObject({ evaluated: 0, sent: 0 });
    });
  });
}

contract("memory repo", memoryAlertsRepo);

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("Postgres", () => {
  const schema = `alerts_test_${Date.now().toString(36)}`;
  let sql: Db;

  beforeAll(async () => {
    sql = postgres(url!, { max: 10, onnotice: () => {}, connection: { search_path: schema } });
    await sql`create schema ${sql(schema)}`;
    expect(await migrate(sql, ALERTS_MIGRATIONS_DIR, ALERTS_LEDGER)).toEqual(["0001_init.sql"]);
    expect(await migrate(sql, ALERTS_MIGRATIONS_DIR, ALERTS_LEDGER)).toEqual([]);
  }, 60_000);

  afterAll(async () => {
    await sql`drop schema ${sql(schema)} cascade`;
    await sql.end({ timeout: 5 });
  });

  // Each test starts from empty tables, in the one schema.
  contract("Postgres repo", async () => {
    await sql`truncate alerts_devices, alerts_notices, alerts_outbox, alerts_tickets, alerts_state`;
    return { ...pgAlertsRepo(sql), close: async () => {} };
  });

  it("lets one evaluator in at a time", async () => {
    const lock = pgEvaluatorLock(sql);
    let release!: () => void;
    const held = lock(() => new Promise<string>((resolve) => (release = () => resolve("first"))));
    await new Promise((r) => setTimeout(r, 50));
    expect(await lock(async () => "second")).toBeNull();
    release();
    expect(await held).toBe("first");
    expect(await lock(async () => "third")).toBe("third");
  });
});
