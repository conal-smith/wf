/**
 * The evaluator: every fifteen minutes (ALERTS_EVALUATE=1, one instance at a
 * time under an advisory lock), it reads the blend's pointer and, when the
 * run has changed or a device or its rules have, rates each device's spots for
 * its rider, matches its rules (alerts/shared/match.ts) and decides what to
 * say (`planDevice`). Then it sends what is due, reads Expo's receipts and
 * forgets what is stale.
 *
 * What a rider hears about one window (rule, spot, Irish day):
 *   - once when it is first forecast;
 *   - again only when it materially changes (moves more than two hours, or its
 *     stars change), at most MAX_UPDATES times;
 *   - "off", if the rule asks for it, when a window not yet begun is no longer
 *     forecast. A window that was never delivered (held for quiet hours) is
 *     simply withdrawn; one that disappears because the rider changed the rule
 *     was not called off, and nothing is said.
 * Nothing is delivered from 22:00 to 07:00 Irish time on a device that keeps
 * quiet hours: it waits in the outbox, and a later word on the same window
 * replaces it. Four or more new windows due at once go as one digest.
 */
import type { ForecastSource } from "../../mcp/api/source.js";
import { appUpdateCopy, calledOffCopy, digestCopy, newCopy, updateCopy } from "../shared/copy.js";
import { matchRule, materiallyChanged, noticeKey, ruleSignature } from "../shared/match.js";
import {
  CHANNELS,
  type AlertMatch,
  type AppVariant,
  type Announcement,
  type Platform,
  type PushData,
} from "../shared/protocol.js";
import { afterQuietHours, HOUR_MS } from "../shared/time.js";
import {
  placeName,
  ratingCache,
  readBlend,
  readModelWind,
  ridesApart,
  readBlendPointer,
  staleBlend,
} from "./forecast.js";
import { deadToken, type ExpoMessage, type PushClient } from "./push.js";
import type { AlertsRepo, DevicePlan, DeviceRow, Notice, OutboxMessage, OutboxRow } from "./repo.js";

export const EVALUATE_EVERY_MS = 15 * 60_000;
/** Updates one window may send after the first word (called-off aside). */
export const MAX_UPDATES = 2;
/** This many new windows due at once for one device go as one notification. */
export const DIGEST_AT = 4;
/** Receipts are ready some minutes after the tickets; Expo suggests waiting a quarter of an hour. */
export const RECEIPT_DELAY_MS = 15 * 60_000;
/** A failed send is tried again after this, this many times. */
export const RETRY_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 5;
/** How long an app-update note may wait for a phone that is off. */
export const ANNOUNCE_TTL_MS = 3 * 24 * HOUR_MS;

const iso = (ms: number) => new Date(ms).toISOString();
const hourFloor = (ms: number) => ms - (ms % HOUR_MS);

export interface PlanInput {
  device: Pick<DeviceRow, "id" | "quietHours" | "rules">;
  /** Every match of the device's enabled rules, from now on. */
  matches: readonly AlertMatch[];
  /** Whether the forecast knows a spot: a spot it lost says nothing about its windows. */
  known: (spotId: string) => boolean;
  notices: readonly Notice[];
  queued: readonly OutboxRow[];
  now: number;
  spotName?: (spotId: string) => string;
}

function alertData(kind: PushData["kind"], m: Pick<AlertMatch, "spotId" | "start" | "ruleId">): Record<string, string> {
  const data: PushData = {
    kind,
    path: `/?spot=${encodeURIComponent(m.spotId)}&t=${encodeURIComponent(m.start)}`,
    spot: m.spotId,
    t: m.start,
    alertId: m.ruleId,
  };
  return data as unknown as Record<string, string>;
}

/** What to tell one device, from its matches and what it has been told. Pure. */
export function planDevice(input: PlanInput): DevicePlan {
  const { device, now } = input;
  const name = input.spotName ?? placeName;
  const rules = new Map(device.rules.map((r) => [r.id, r]));
  const told = new Map(input.notices.map((n) => [noticeKey(n), n]));
  const pending = new Map(input.queued.map((q) => [q.key, q]));
  const deliverAt = device.quietHours ? afterQuietHours(now) : now;
  const plan: DevicePlan = {
    deviceId: device.id,
    notices: { put: [], drop: [] },
    outbox: { put: [], drop: [] },
  };
  const message = (
    key: string,
    kind: OutboxMessage["kind"],
    expiresAt: number,
    copy: { title: string; body: string },
    data: Record<string, string>,
    fold?: OutboxMessage["fold"],
  ): OutboxMessage => ({
    deviceId: device.id,
    key,
    kind,
    deliverAfter: new Date(deliverAt),
    expiresAt: new Date(expiresAt),
    ...copy,
    data,
    channelId: CHANNELS.alerts,
    ...(fold ? { fold } : {}),
  });

  const seen = new Set<string>();
  for (const m of input.matches) {
    const rule = rules.get(m.ruleId);
    if (!rule) continue;
    const key = noticeKey(m);
    seen.add(key);
    const n = told.get(key);
    const q = pending.get(key);
    const end = Date.parse(m.end);
    const sig = ruleSignature(rule);
    const notice = (count: number): Notice => ({
      ruleId: m.ruleId,
      spotId: m.spotId,
      day: m.day,
      ruleSig: sig,
      start: m.start,
      end: m.end,
      stars: m.stars,
      state: "told",
      count,
    });
    const spotName = name(m.spotId);
    if (!n || n.state === "off" || (q && q.kind === "new")) {
      // New to the rider (or back after being called off, or not delivered yet).
      if (deliverAt >= end) continue;
      plan.notices.put.push(notice(n && n.state !== "off" ? n.count : (n?.count ?? 0) + 1));
      plan.outbox.put.push(
        message(key, "new", end, newCopy(m, spotName), alertData("new", m), { spotName, match: m }),
      );
      continue;
    }
    // A window under way is compared from the hour it has reached.
    const was = { ...n, start: iso(Math.max(Date.parse(n.start), hourFloor(now))) };
    if (materiallyChanged(was, m)) {
      if (n.count > MAX_UPDATES || deliverAt >= end) continue;
      plan.notices.put.push(notice(n.count + 1));
      plan.outbox.put.push(message(key, "update", end, updateCopy(m, spotName, n), alertData("update", m)));
    } else if (n.ruleSig !== sig) {
      plan.notices.put.push({ ...n, ruleSig: sig });
    }
  }

  for (const n of input.notices) {
    const key = noticeKey(n);
    if (seen.has(key)) continue;
    const rule = rules.get(n.ruleId);
    const q = pending.get(key);
    const drop = () => {
      plan.notices.drop.push(n);
      if (q) plan.outbox.drop.push(key);
    };
    if (Date.parse(n.end) <= now) drop();
    else if (!rule || !rule.enabled || !rule.spots.includes(n.spotId)) drop();
    else if (!input.known(n.spotId) || n.state === "off") continue;
    else if (q?.kind === "new") drop();
    else if (n.ruleSig !== ruleSignature(rule)) drop();
    else if (rule.calledOff && Date.parse(n.start) > now && deliverAt < Date.parse(n.end)) {
      plan.notices.put.push({ ...n, state: "off", count: n.count + 1 });
      plan.outbox.put.push(
        message(key, "called-off", Date.parse(n.end), calledOffCopy(n, name(n.spotId), rule), alertData("called-off", n)),
      );
    } else if (q) plan.outbox.drop.push(key);
  }
  return plan;
}

export interface EvaluatorDeps {
  repo: AlertsRepo;
  /** Where the blend is read; null and nothing is evaluated (announcements still go). */
  source: ForecastSource | null;
  push: PushClient;
  now?: () => number;
  log?: (line: string) => void;
}

export interface EvaluationReport {
  run: string | null;
  evaluated: number;
  planned: number;
  sent: number;
  skipped?: string;
}

interface Evaluated {
  run: string;
  generatedAt: string;
  at: string;
}

/** One pass: match what changed, then send what is due and read receipts. */
export async function evaluateOnce(deps: EvaluatorDeps): Promise<EvaluationReport> {
  const now = (deps.now ?? Date.now)();
  const log = deps.log ?? (() => {});
  const report: EvaluationReport = { run: null, evaluated: 0, planned: 0, sent: 0 };
  try {
    await evaluateRules(deps, now, report);
  } catch (error) {
    report.skipped = error instanceof Error ? error.message : String(error);
    log(`alerts: evaluation failed: ${report.skipped}`);
  }
  report.sent = await deliver(deps);
  await checkReceipts(deps).catch((error) => log(`alerts: receipts failed: ${String(error)}`));
  await deps.repo.prune(new Date(now));
  return report;
}

async function evaluateRules(deps: EvaluatorDeps, now: number, report: EvaluationReport) {
  if (!deps.source) {
    report.skipped = "no forecast source";
    return;
  }
  const pointer = await readBlendPointer(deps.source);
  if (!pointer) {
    report.skipped = "no blend published";
    return;
  }
  report.run = pointer.run;
  if (staleBlend(pointer, now)) {
    report.skipped = "blend is stale";
    return;
  }
  const last = (await deps.repo.getState("evaluated")) as Evaluated | null;
  const changedRun = !last || last.run !== pointer.run || last.generatedAt !== pointer.generatedAt;
  const devices = await deps.repo.devicesToEvaluate(changedRun || !last ? null : new Date(last.at));
  if (devices.length) {
    const blend = await readBlend(deps.source, pointer);
    if (!blend) return;
    // The models themselves, only for a rider whose stars the blend does not carry.
    const wind = devices.some((device) => ridesApart(blend.pointer, device.rider))
      ? await readModelWind(deps.source, now)
      : null;
    const ratings = ratingCache(blend, wind);
    for (const device of devices) {
      const hoursOf = ratings(device.rider);
      const matches = device.rules.flatMap((rule) =>
        matchRule(rule, blend.pointer.times, hoursOf, now),
      );
      const plan = planDevice({
        device,
        matches,
        known: (id) => hoursOf(id) !== null,
        notices: await deps.repo.notices(device.id),
        queued: await deps.repo.queued(device.id),
        now,
      });
      await deps.repo.applyPlan(plan);
      report.evaluated++;
      report.planned += plan.outbox.put.length;
    }
  }
  const evaluated: Evaluated = { run: pointer.run, generatedAt: pointer.generatedAt, at: iso(now) };
  await deps.repo.setState("evaluated", evaluated);
}

/** The Expo messages for one device's due rows: new windows folded into one past DIGEST_AT. */
function messagesFor(device: DeviceRow, rows: OutboxRow[], now: number): { message: ExpoMessage; rows: OutboxRow[] }[] {
  const token = device.expoPushToken!;
  const ttl = (expires: Date) => Math.max(60, Math.floor((expires.getTime() - now) / 1000));
  const one = (row: OutboxRow, fold: OutboxRow[] = [row]) => ({
    message: {
      to: token,
      title: row.title,
      body: row.body,
      data: row.data,
      sound: "default" as const,
      channelId: row.channelId,
      priority: "high" as const,
      ttl: ttl(row.expiresAt),
    },
    rows: fold,
  });
  const fresh = rows.filter((r) => r.kind === "new" && r.fold);
  if (fresh.length < DIGEST_AT) return rows.map((r) => one(r));
  const lines = fresh
    .map((r) => r.fold!)
    .sort((a, b) => b.match.stars - a.match.stars || Date.parse(a.match.start) - Date.parse(b.match.start));
  const best = lines[0].match;
  const latest = Math.max(...fresh.map((r) => r.expiresAt.getTime()));
  const digest: OutboxRow = {
    ...fresh[0],
    kind: "digest",
    ...digestCopy(lines),
    data: alertData("digest", best),
    expiresAt: new Date(latest),
  };
  return [one(digest, fresh), ...rows.filter((r) => !fresh.includes(r)).map((r) => one(r))];
}

/** Sends everything due. A send that fails goes back in the outbox for a few more tries. */
export async function deliver(deps: EvaluatorDeps): Promise<number> {
  const now = (deps.now ?? Date.now)();
  const log = deps.log ?? (() => {});
  const due = await deps.repo.claimDue(new Date(now), 500);
  if (!due.length) return 0;
  const byDevice = new Map<string, OutboxRow[]>();
  for (const row of due) byDevice.set(row.deviceId, [...(byDevice.get(row.deviceId) ?? []), row]);
  const out: { message: ExpoMessage; rows: OutboxRow[]; device: DeviceRow }[] = [];
  for (const [id, rows] of byDevice) {
    const device = await deps.repo.getDevice(id);
    if (!device?.expoPushToken) continue;
    for (const m of messagesFor(device, rows, now)) out.push({ ...m, device });
  }
  if (!out.length) return 0;
  let tickets;
  try {
    tickets = await deps.push.send(out.map((o) => o.message));
  } catch (error) {
    log(`alerts: push failed, will retry: ${String(error)}`);
    const retry = out.flatMap((o) => o.rows).filter((r) => r.attempts + 1 < MAX_ATTEMPTS);
    await deps.repo.requeue(retry, new Date(now + RETRY_MS));
    return 0;
  }
  let sent = 0;
  const keep = [];
  for (const [i, ticket] of tickets.entries()) {
    const { device, message } = out[i];
    if (ticket.status === "ok") {
      sent++;
      keep.push({ id: ticket.id, deviceId: device.id, token: message.to, createdAt: new Date(now) });
    } else if (deadToken(ticket)) await deps.repo.clearToken(device.id, message.to);
    else log(`alerts: Expo refused a message: ${ticket.message}`);
  }
  await deps.repo.addTickets(keep);
  return sent;
}

/** Reads the receipts of tickets old enough to have them; drops dead tokens. */
export async function checkReceipts(deps: EvaluatorDeps): Promise<void> {
  const now = (deps.now ?? Date.now)();
  const tickets = await deps.repo.ticketsBefore(new Date(now - RECEIPT_DELAY_MS), 1000);
  if (!tickets.length) return;
  const receipts = await deps.push.receipts(tickets.map((t) => t.id));
  const done: string[] = [];
  for (const t of tickets) {
    const receipt = receipts[t.id];
    if (!receipt) continue;
    done.push(t.id);
    if (deadToken(receipt)) await deps.repo.clearToken(t.deviceId, t.token);
  }
  await deps.repo.dropTickets(done);
}

/** -1, 0 or 1: dotted versions compared number by number ("1.10.0" after "1.9.2"). */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[+-]/)[0].split(".").map((p) => Number(p) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** Variants an app-update note goes to: the release pipeline promotes production. */
export const ANNOUNCE_VARIANTS: readonly AppVariant[] = ["production"];

/**
 * Queues an app-update note for every production install that asked for them
 * and is on an older version. Once per kind and version: asked again, it says
 * so and queues nothing.
 */
export async function announce(
  deps: Pick<EvaluatorDeps, "repo" | "now">,
  a: Announcement,
): Promise<{ queued: number; already: boolean }> {
  const now = (deps.now ?? Date.now)();
  const platforms: Platform[] = a.platforms ?? ["ios", "android"];
  const fresh = await deps.repo.claimState(`announce:${a.kind}:${a.version}`, {
    at: iso(now),
    platforms,
  });
  if (!fresh) return { queued: 0, already: true };
  const devices = (await deps.repo.updateSubscribers(platforms, ANNOUNCE_VARIANTS)).filter(
    (d) => compareVersions(d.appVersion, a.version) < 0,
  );
  const data: PushData = { kind: "app-update", path: "/settings/about", version: a.version };
  const messages: OutboxMessage[] = devices.map((d) => ({
    deviceId: d.id,
    key: `app-update|${a.version}`,
    kind: "app-update",
    deliverAfter: new Date(d.quietHours ? afterQuietHours(now) : now),
    expiresAt: new Date(now + ANNOUNCE_TTL_MS),
    ...appUpdateCopy(a.version, d.platform, a),
    data: data as unknown as Record<string, string>,
    channelId: CHANNELS.updates,
  }));
  await deps.repo.enqueue(messages);
  return { queued: messages.length, already: false };
}

/**
 * Runs `evaluateOnce` now and every EVALUATE_EVERY_MS, under `lock` so that
 * of several instances one evaluates at a time. Returns a stop function.
 */
export function startEvaluator(
  deps: EvaluatorDeps,
  options: {
    lock: <T>(work: () => Promise<T>) => Promise<T | null>;
    everyMs?: number;
    firstAfterMs?: number;
  },
): () => void {
  const log = deps.log ?? console.log;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const report = await options.lock(() => evaluateOnce(deps));
      if (report && (report.planned || report.sent || report.skipped))
        log(
          `alerts: run ${report.run ?? "-"}, ${report.evaluated} devices, ` +
            `${report.planned} planned, ${report.sent} sent${report.skipped ? ` (${report.skipped})` : ""}`,
        );
    } catch (error) {
      log(`alerts: evaluator failed: ${String(error)}`);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void tick(), options.firstAfterMs ?? 30_000);
  const timer = setInterval(() => void tick(), options.everyMs ?? EVALUATE_EVERY_MS);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

/** One process, one evaluator: the lock memory mode uses. */
export function memoryLock() {
  let held = false;
  return async <T>(work: () => Promise<T>): Promise<T | null> => {
    if (held) return null;
    held = true;
    try {
      return await work();
    } finally {
      held = false;
    }
  };
}
