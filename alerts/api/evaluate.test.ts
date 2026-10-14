import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RIDER } from "../../force5/src/stars";
import { matchRule } from "../shared/match";
import { RULE_DEFAULTS, type AlertMatch, type AlertRule } from "../shared/protocol";
import {
  announce,
  compareVersions,
  deliver,
  evaluateOnce,
  MAX_UPDATES,
  planDevice,
  type EvaluatorDeps,
  type PlanInput,
} from "./evaluate";
import { PLACES } from "./forecast";
import type { ExpoMessage, ExpoReceipt, ExpoTicket, PushClient } from "./push";
import type { AlertsRepo, DeviceRow, Notice, OutboxRow } from "./repo";
import { memoryAlertsRepo } from "./repo-memory";
import { blendSource, type BlendFixtureOptions, type HourWind } from "./testing";

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
// Wednesday 14 October 2026, 10:00 Irish summer time.
const NOW = Date.parse("2026-10-14T09:00:00Z");

const rule = (over: Partial<AlertRule> = {}): AlertRule => ({
  id: "r1",
  name: "Brandon",
  spots: ["brandon"],
  ...RULE_DEFAULTS,
  fromHour: 0,
  toHour: 24,
  days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  calledOff: true,
  ...over,
});

const match = (over: Partial<AlertMatch> = {}): AlertMatch => ({
  ruleId: "r1",
  spotId: "brandon",
  day: "2026-10-17",
  start: "2026-10-17T13:00:00.000Z",
  end: "2026-10-17T16:00:00.000Z",
  hours: 3,
  stars: 5,
  peakStars: 5,
  windKn: [18, 18],
  gustKn: 22,
  from: 190,
  wing: 5,
  ownWing: false,
  windows: 1,
  ...over,
});

const shifted = (m: AlertMatch, hours: number): AlertMatch => ({
  ...m,
  start: iso(Date.parse(m.start) + hours * HOUR),
  end: iso(Date.parse(m.end) + hours * HOUR),
});

const toldOf = (m: AlertMatch, r = rule(), over: Partial<Notice> = {}): Notice => ({
  ruleId: m.ruleId,
  spotId: m.spotId,
  day: m.day,
  ruleSig: JSON.stringify([r.minStars, [...r.days].sort(), r.fromHour, r.toHour, r.minHours, r.leadDays]),
  start: m.start,
  end: m.end,
  stars: m.stars,
  state: "told",
  count: 1,
  ...over,
});

const queuedOf = (key: string, kind: OutboxRow["kind"]): OutboxRow => ({
  id: "1",
  deviceId: "d1",
  key,
  kind,
  deliverAfter: new Date(NOW),
  expiresAt: new Date(NOW + 72 * HOUR),
  title: "",
  body: "",
  data: {},
  channelId: "alerts",
  attempts: 0,
});

const plan = (over: Partial<PlanInput> = {}) =>
  planDevice({
    device: { id: "d1", quietHours: true, rules: [rule()] },
    matches: [],
    known: () => true,
    notices: [],
    queued: [],
    now: NOW,
    ...over,
  });

describe("planDevice", () => {
  it("tells a new window once, in the site's words, opening the chart at it", () => {
    const p = plan({ matches: [match()] });
    expect(p.notices.put).toMatchObject([{ day: "2026-10-17", state: "told", count: 1, stars: 5 }]);
    expect(p.outbox.put).toHaveLength(1);
    expect(p.outbox.put[0]).toMatchObject({
      kind: "new",
      key: "r1|brandon|2026-10-17",
      title: "Brandon Bay ★★★★★ Sat 14:00–17:00",
      body: "S 18 kn, gusts 22. About a 5.0 m wing.",
      channelId: "alerts",
      data: {
        kind: "new",
        spot: "brandon",
        t: "2026-10-17T13:00:00.000Z",
        alertId: "r1",
        path: "/?spot=brandon&t=2026-10-17T13%3A00%3A00.000Z",
      },
    });
    expect(p.outbox.put[0].deliverAfter.getTime()).toBe(NOW);
    expect(p.outbox.put[0].expiresAt.toISOString()).toBe("2026-10-17T16:00:00.000Z");
  });

  it("says nothing again for the same window, or one that moved two hours or less", () => {
    const told = [toldOf(match())];
    expect(plan({ matches: [match()], notices: told }).outbox.put).toEqual([]);
    expect(plan({ matches: [shifted(match(), 2)], notices: told }).outbox.put).toEqual([]);
    expect(plan({ matches: [{ ...match(), peakStars: 5, windKn: [17, 21] }], notices: told }).outbox.put).toEqual([]);
  });

  it("updates a window that moved more than two hours or changed its stars", () => {
    const told = [toldOf(match())];
    const moved = plan({ matches: [shifted(match(), -3)], notices: told });
    expect(moved.outbox.put).toMatchObject([{ kind: "update", title: "Brandon Bay ★★★★★ Sat 11:00–14:00" }]);
    expect(moved.outbox.put[0].body).toMatch(/^Update\. Was Sat 14:00–17:00\. /);
    expect(moved.notices.put).toMatchObject([{ count: 2, start: "2026-10-17T10:00:00.000Z" }]);
    const weaker = plan({ matches: [match({ stars: 4 })], notices: told });
    expect(weaker.outbox.put[0].body).toMatch(/^Update\. Was ★★★★★\. /);
  });

  it("stops updating a window that keeps changing", () => {
    const told = [toldOf(match(), rule(), { count: MAX_UPDATES + 1 })];
    expect(plan({ matches: [shifted(match(), 3)], notices: told }).outbox.put).toEqual([]);
  });

  it("compares a window under way from the hour it has reached", () => {
    const told = [toldOf(match({ start: "2026-10-17T08:00:00.000Z" }))];
    const now = Date.parse("2026-10-17T12:30:00Z");
    expect(plan({ now, matches: [match({ start: "2026-10-17T12:00:00.000Z" })], notices: told }).outbox.put).toEqual([]);
  });

  it("calls off a window that is no longer forecast, when the rule asks", () => {
    const told = [toldOf(match())];
    const off = plan({ notices: told });
    expect(off.outbox.put).toMatchObject([
      { kind: "called-off", title: "Off: Brandon Bay Sat 14:00–17:00", body: "No longer ★★★★ or better. The forecast moved on." },
    ]);
    expect(off.notices.put).toMatchObject([{ state: "off", count: 2 }]);
    // Asked not to: nothing said, and what was told is kept.
    const quiet = plan({ device: { id: "d1", quietHours: true, rules: [rule({ calledOff: false })] }, notices: told });
    expect(quiet.outbox.put).toEqual([]);
    expect(quiet.notices).toEqual({ put: [], drop: [] });
    // Once off, it stays off until it comes back, which is news again.
    const offNotice = [toldOf(match(), rule(), { state: "off", count: 2 })];
    expect(plan({ notices: offNotice }).outbox.put).toEqual([]);
    expect(plan({ notices: offNotice, matches: [match()] }).outbox.put).toMatchObject([{ kind: "new" }]);
  });

  it("does not call off a window that has begun, or one the forecast lost the spot of", () => {
    const told = [toldOf(match())];
    expect(plan({ notices: told, now: Date.parse("2026-10-17T14:00:00Z") }).outbox.put).toEqual([]);
    expect(plan({ notices: told, known: () => false }).outbox.put).toEqual([]);
  });

  it("says nothing when the rider changed the question, and forgets switched-off rules", () => {
    const told = [toldOf(match())];
    const changed = plan({ device: { id: "d1", quietHours: true, rules: [rule({ minStars: 5 })] }, notices: told });
    expect(changed.outbox.put).toEqual([]);
    expect(changed.notices.drop).toHaveLength(1);
    const off = plan({ device: { id: "d1", quietHours: true, rules: [rule({ enabled: false })] }, notices: told });
    expect(off.outbox.put).toEqual([]);
    expect(off.notices.drop).toHaveLength(1);
    const gone = plan({ device: { id: "d1", quietHours: true, rules: [] }, notices: told, queued: [queuedOf("r1|brandon|2026-10-17", "update")] });
    expect(gone.outbox.drop).toEqual(["r1|brandon|2026-10-17"]);
  });

  it("holds everything for 07:00 in quiet hours, unless the device lets it through", () => {
    const late = Date.parse("2026-10-14T21:30:00Z"); // 22:30 IST
    expect(plan({ now: late, matches: [match()] }).outbox.put[0].deliverAfter.toISOString()).toBe(
      "2026-10-15T06:00:00.000Z",
    );
    expect(
      plan({ now: late, matches: [match()], device: { id: "d1", quietHours: false, rules: [rule()] } })
        .outbox.put[0].deliverAfter.getTime(),
    ).toBe(late);
  });

  it("withdraws a window still waiting to go when it disappears, and keeps it new when it moves", () => {
    const key = "r1|brandon|2026-10-17";
    const told = [toldOf(match())];
    const withdrawn = plan({ notices: told, queued: [queuedOf(key, "new")] });
    expect(withdrawn.outbox).toEqual({ put: [], drop: [key] });
    expect(withdrawn.notices.drop).toHaveLength(1);
    const moved = plan({ notices: told, queued: [queuedOf(key, "new")], matches: [shifted(match(), 3)] });
    expect(moved.outbox.put).toMatchObject([{ kind: "new", title: "Brandon Bay ★★★★★ Sat 17:00–20:00" }]);
    expect(moved.notices.put).toMatchObject([{ count: 1 }]);
  });

  it("does not announce a window it could only deliver once it is over", () => {
    const now = Date.parse("2026-10-17T21:30:00Z");
    const m = match({ start: "2026-10-17T21:00:00.000Z", end: "2026-10-17T22:00:00.000Z" });
    expect(plan({ now, matches: [m] }).outbox.put).toEqual([]);
  });
});

/* ---- end to end, on a published blend ---- */

/** Wind from across each place's shore, so the shore takes nothing off. */
const cross = (id: string) => ((PLACES.get(id)!.facing ?? 0) + 90) % 360;
/** 18 kn gusting 22 on Saturday 14:00–17:00 Irish time, a breath otherwise. */
const saturday = (id: string) => (t: number): HourWind =>
  t >= Date.parse("2026-10-17T13:00:00Z") && t < Date.parse("2026-10-17T16:00:00Z")
    ? { wind: 18, gust: 22, from: cross(id) }
    : { wind: 4, gust: 6, from: cross(id) };

const blend = (spots: string[], over: Partial<BlendFixtureOptions> = {}): BlendFixtureOptions => ({
  start: "2026-10-14T00:00:00Z",
  hours: 24 * 5,
  generatedAt: iso(NOW - HOUR),
  spots: Object.fromEntries(spots.map((id) => [id, saturday(id)])),
  ...over,
});

function fakePush() {
  const sent: ExpoMessage[] = [];
  const asked: string[][] = [];
  let next = 0;
  const state = {
    sent,
    asked,
    fail: false,
    ticket: (m: ExpoMessage): ExpoTicket => ({ status: "ok", id: `t${++next}:${m.to}` }),
    receipt: (_id: string): ExpoReceipt | undefined => ({ status: "ok" }),
  };
  const client: PushClient = {
    async send(messages) {
      if (state.fail) throw new Error("Expo push answered 503.");
      sent.push(...messages);
      return messages.map((m) => state.ticket(m));
    },
    async receipts(ids) {
      asked.push([...ids]);
      return Object.fromEntries(ids.flatMap((id) => {
        const r = state.receipt(id);
        return r ? [[id, r]] : [];
      }));
    },
  };
  return { client, state };
}

const TOKEN = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";

async function deviceWith(repo: AlertsRepo, rules: AlertRule[], over: Partial<DeviceRow> = {}) {
  const d = await repo.createDevice(
    {
      id: over.id ?? "device0000000001",
      installationId: "install-1",
      secretHash: "x",
      expoPushToken: over.expoPushToken === undefined ? TOKEN : over.expoPushToken,
      platform: over.platform ?? "ios",
      appVariant: over.appVariant ?? "production",
      appVersion: over.appVersion ?? "1.0.0",
      timezone: "Europe/Dublin",
      rider: DEFAULT_RIDER,
      quietHours: over.quietHours ?? true,
      appUpdates: over.appUpdates ?? true,
    },
    new Date(NOW - 2 * HOUR),
  );
  await repo.putRules(d.id, rules, new Date(NOW - 2 * HOUR));
  return d;
}

describe("evaluateOnce", () => {
  let repo: AlertsRepo;
  let clock: number;
  let push: ReturnType<typeof fakePush>;
  let deps: EvaluatorDeps;

  beforeEach(() => {
    repo = memoryAlertsRepo();
    clock = NOW;
    push = fakePush();
    deps = { repo, source: blendSource(blend(["brandon"])), push: push.client, now: () => clock };
  });

  it("sends a window once, and nothing while neither the run nor the rules change", async () => {
    await deviceWith(repo, [rule()]);
    const first = await evaluateOnce(deps);
    expect(first).toMatchObject({ evaluated: 1, planned: 1, sent: 1 });
    expect(push.state.sent).toEqual([
      expect.objectContaining({
        to: TOKEN,
        title: "Brandon Bay ★★★★★ Sat 14:00–17:00",
        channelId: "alerts",
        priority: "high",
        sound: "default",
      }),
    ]);
    // Matches the shared logic on the same blend, so the app's preview agrees.
    expect(push.state.sent[0].data.t).toBe("2026-10-17T13:00:00.000Z");
    clock += 15 * 60_000;
    expect(await evaluateOnce(deps)).toMatchObject({ evaluated: 0, sent: 0 });
    expect(push.state.sent).toHaveLength(1);
  });

  it("evaluates a device again when its rules change, and every device on a new run", async () => {
    const d = await deviceWith(repo, [rule({ minStars: 5, spots: ["dollymount"] })]);
    await evaluateOnce(deps);
    expect(push.state.sent).toHaveLength(0);
    clock += 15 * 60_000;
    await repo.putRules(d.id, [rule()], new Date(clock));
    clock += 60_000;
    expect(await evaluateOnce(deps)).toMatchObject({ evaluated: 1, sent: 1 });
    clock += 15 * 60_000;
    (deps.source as ReturnType<typeof blendSource>).replace(blend(["brandon"], { run: "2026101410", generatedAt: iso(clock) }));
    expect(await evaluateOnce(deps)).toMatchObject({ evaluated: 1, sent: 0 });
  });

  it("evaluates nothing on a stale blend, or with none", async () => {
    await deviceWith(repo, [rule()]);
    clock = NOW + 7 * HOUR;
    expect(await evaluateOnce(deps)).toMatchObject({ skipped: "blend is stale", sent: 0 });
    expect(await evaluateOnce({ ...deps, source: { json: async () => null } })).toMatchObject({
      skipped: "no blend published",
    });
  });

  it("folds four or more new windows into one notification", async () => {
    const spots = ["brandon", "dollymount", "rusheen", "keel", "tramore"];
    deps.source = blendSource(blend(spots));
    await deviceWith(repo, [rule({ spots })]);
    await evaluateOnce(deps);
    expect(push.state.sent).toHaveLength(1);
    expect(push.state.sent[0].title).toBe("★★★★★ at 5 spots");
    expect(push.state.sent[0].body).toMatch(/^Brandon Bay Sat 14:00–17:00 · /);
    expect(push.state.sent[0].data.kind).toBe("digest");
  });

  it("holds a window found at night for 07:00", async () => {
    clock = Date.parse("2026-10-14T21:30:00Z");
    deps.source = blendSource(blend(["brandon"], { generatedAt: iso(clock) }));
    await deviceWith(repo, [rule()]);
    expect(await evaluateOnce(deps)).toMatchObject({ planned: 1, sent: 0 });
    clock = Date.parse("2026-10-15T05:59:00Z");
    expect(await deliver(deps)).toBe(0);
    clock = Date.parse("2026-10-15T06:00:00Z");
    expect(await deliver(deps)).toBe(1);
  });

  it("tries a failed send again, and gives up on a dead token", async () => {
    const d = await deviceWith(repo, [rule()]);
    push.state.fail = true;
    expect(await evaluateOnce(deps)).toMatchObject({ planned: 1, sent: 0 });
    push.state.fail = false;
    clock += 6 * 60_000;
    expect(await deliver(deps)).toBe(1);
    // Its receipt, a quarter of an hour on, says the phone is gone.
    push.state.receipt = () => ({ status: "error", message: "gone", details: { error: "DeviceNotRegistered" } });
    clock += 16 * 60_000;
    await evaluateOnce(deps);
    expect(push.state.asked).toHaveLength(1);
    expect((await repo.getDevice(d.id))!.expoPushToken).toBeNull();
  });

  it("drops a token Expo refuses at once", async () => {
    const d = await deviceWith(repo, [rule()]);
    push.state.ticket = () => ({ status: "error", message: "gone", details: { error: "DeviceNotRegistered" } });
    await evaluateOnce(deps);
    expect((await repo.getDevice(d.id))!.expoPushToken).toBeNull();
  });

  it("finds what the shared logic finds on the same blend", async () => {
    const source = blendSource(blend(["brandon"]));
    const { readBlend, ratingCache } = await import("./forecast");
    const b = (await readBlend(source))!;
    const matches = matchRule(rule(), b.pointer.times, ratingCache(b)(DEFAULT_RIDER), NOW);
    expect(matches.map((m) => [m.start, m.end, m.stars])).toEqual([
      ["2026-10-17T13:00:00.000Z", "2026-10-17T16:00:00.000Z", 5],
    ]);
  });
});

describe("announce", () => {
  it("queues a note for older production installs that asked, once per version", async () => {
    const repo = memoryAlertsRepo();
    await deviceWith(repo, [], { id: "device0000000001", appVersion: "1.2.0", expoPushToken: "ExponentPushToken[a1aaaaaaaaaa]" });
    await deviceWith(repo, [], { id: "device0000000002", appVersion: "1.3.0", expoPushToken: "ExponentPushToken[a2aaaaaaaaaa]" });
    await deviceWith(repo, [], { id: "device0000000003", appVersion: "1.2.0", appUpdates: false, expoPushToken: "ExponentPushToken[a3aaaaaaaaaa]" });
    await deviceWith(repo, [], { id: "device0000000004", appVersion: "1.2.0", appVariant: "staging", expoPushToken: "ExponentPushToken[a4aaaaaaaaaa]" });
    await deviceWith(repo, [], { id: "device0000000005", appVersion: "1.2.0", platform: "android", expoPushToken: "ExponentPushToken[a5aaaaaaaaaa]" });
    const now = () => NOW;
    expect(await announce({ repo, now }, { kind: "app-update", version: "1.3.0", platforms: ["ios"] })).toEqual({
      queued: 1,
      already: false,
    });
    expect(await announce({ repo, now }, { kind: "app-update", version: "1.3.0" })).toEqual({ queued: 0, already: true });
    const push = fakePush();
    await deliver({ repo, source: null, push: push.client, now });
    expect(push.state.sent).toEqual([
      expect.objectContaining({
        to: "ExponentPushToken[a1aaaaaaaaaa]",
        title: "Wingfoil 1.3.0",
        body: "A new version is out. Update from the App Store.",
        channelId: "updates",
        data: { kind: "app-update", path: "/settings/about", version: "1.3.0" },
      }),
    ]);
  });

  it("compares versions number by number", () => {
    expect(compareVersions("1.10.0", "1.9.2")).toBe(1);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.0-beta.1", "1.2.1")).toBe(-1);
  });
});
