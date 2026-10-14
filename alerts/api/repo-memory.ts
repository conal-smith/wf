/**
 * The alerts store in memory: development with MARKET_DB=memory, and the
 * tests. Same contract as repo-pg.ts (repo.test.ts runs both).
 */
import {
  DEVICE_TTL_DAYS,
  TICKET_TTL_MS,
  type AlertsRepo,
  type DeviceRow,
  type Notice,
  type OutboxRow,
  type Ticket,
} from "./repo.js";

const DAY = 24 * 3_600_000;
const clone = <T>(v: T): T => structuredClone(v);
const noticeId = (n: Pick<Notice, "ruleId" | "spotId" | "day">) => `${n.ruleId}|${n.spotId}|${n.day}`;

export function memoryAlertsRepo(): AlertsRepo {
  const devices = new Map<string, DeviceRow>();
  const notices = new Map<string, Map<string, Notice>>();
  const outbox = new Map<string, OutboxRow>();
  const tickets = new Map<string, Ticket>();
  const state = new Map<string, unknown>();
  let seq = 0;

  const outboxKey = (deviceId: string, key: string) => `${deviceId}\n${key}`;
  const takeToken = (token: string | null, owner: string, now: Date) => {
    if (!token) return;
    for (const d of devices.values())
      if (d.id !== owner && d.expoPushToken === token) {
        d.expoPushToken = null;
        d.updatedAt = now;
      }
  };
  const forget = (id: string) => {
    devices.delete(id);
    notices.delete(id);
    for (const [k, row] of outbox) if (row.deviceId === id) outbox.delete(k);
    for (const [k, t] of tickets) if (t.deviceId === id) tickets.delete(k);
  };

  return {
    async createDevice(device, now) {
      takeToken(device.expoPushToken, device.id, now);
      const row: DeviceRow = {
        ...clone(device),
        rules: [],
        createdAt: now,
        updatedAt: now,
        rulesUpdatedAt: now,
        lastSeenAt: now,
      };
      devices.set(row.id, row);
      return clone(row);
    },
    async getDevice(id) {
      const row = devices.get(id);
      return row ? clone(row) : null;
    },
    async updateDevice(id, patch, now) {
      const row = devices.get(id);
      if (!row) return null;
      if (patch.expoPushToken !== undefined) takeToken(patch.expoPushToken, id, now);
      Object.assign(row, clone(patch), { updatedAt: now, lastSeenAt: now });
      return clone(row);
    },
    async touchDevice(id, now) {
      const row = devices.get(id);
      if (row) row.lastSeenAt = now;
    },
    async deleteDevice(id) {
      const had = devices.has(id);
      forget(id);
      return had;
    },
    async putRules(id, rules, now) {
      const row = devices.get(id);
      if (!row) return null;
      row.rules = clone(rules);
      row.rulesUpdatedAt = now;
      row.lastSeenAt = now;
      return clone(row);
    },

    async devicesToEvaluate(since) {
      return [...devices.values()]
        .filter(
          (d) =>
            d.expoPushToken !== null &&
            (d.rules.some((r) => r.enabled) || (notices.get(d.id)?.size ?? 0) > 0) &&
            (!since || d.updatedAt > since || d.rulesUpdatedAt > since),
        )
        .map(clone);
    },
    async notices(deviceId) {
      return [...(notices.get(deviceId)?.values() ?? [])].map(clone);
    },
    async queued(deviceId) {
      return [...outbox.values()].filter((r) => r.deviceId === deviceId).map(clone);
    },
    async applyPlan(plan) {
      if (!devices.has(plan.deviceId)) return;
      let mine = notices.get(plan.deviceId);
      if (!mine) notices.set(plan.deviceId, (mine = new Map()));
      for (const n of plan.notices.drop) mine.delete(noticeId(n));
      for (const n of plan.notices.put) mine.set(noticeId(n), clone(n));
      for (const key of plan.outbox.drop) outbox.delete(outboxKey(plan.deviceId, key));
      for (const m of plan.outbox.put) {
        const k = outboxKey(m.deviceId, m.key);
        outbox.set(k, { ...clone(m), id: String(++seq), attempts: 0 });
      }
    },

    async updateSubscribers(platforms, variants) {
      return [...devices.values()]
        .filter(
          (d) =>
            d.appUpdates &&
            d.expoPushToken !== null &&
            platforms.includes(d.platform) &&
            variants.includes(d.appVariant),
        )
        .map(clone);
    },
    async enqueue(messages) {
      for (const m of messages) {
        if (!devices.has(m.deviceId)) continue;
        outbox.set(outboxKey(m.deviceId, m.key), { ...clone(m), id: String(++seq), attempts: 0 });
      }
    },
    async claimDue(now, limit) {
      const out: OutboxRow[] = [];
      for (const [k, row] of [...outbox].sort((a, b) => Number(a[1].id) - Number(b[1].id))) {
        if (row.expiresAt <= now) {
          outbox.delete(k);
          continue;
        }
        if (row.deliverAfter > now || out.length >= limit) continue;
        outbox.delete(k);
        out.push(clone(row));
      }
      return out;
    },
    async requeue(rows, at) {
      for (const row of rows) {
        const k = outboxKey(row.deviceId, row.key);
        if (outbox.has(k) || !devices.has(row.deviceId)) continue;
        outbox.set(k, { ...clone(row), deliverAfter: at, attempts: row.attempts + 1 });
      }
    },

    async addTickets(list) {
      for (const t of list) tickets.set(t.id, clone(t));
    },
    async ticketsBefore(before, limit) {
      return [...tickets.values()]
        .filter((t) => t.createdAt <= before)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit)
        .map(clone);
    },
    async dropTickets(ids) {
      for (const id of ids) tickets.delete(id);
    },
    async clearToken(deviceId, token) {
      const row = devices.get(deviceId);
      if (row?.expoPushToken === token) row.expoPushToken = null;
    },

    async getState(key) {
      return state.has(key) ? clone(state.get(key)) : null;
    },
    async setState(key, value) {
      state.set(key, clone(value));
    },
    async claimState(key, value) {
      if (state.has(key)) return false;
      state.set(key, clone(value));
      return true;
    },

    async prune(now) {
      const stale = now.getTime() - DEVICE_TTL_DAYS * DAY;
      for (const d of [...devices.values()]) if (d.lastSeenAt.getTime() < stale) forget(d.id);
      for (const mine of notices.values())
        for (const [k, n] of mine) if (Date.parse(n.end) < now.getTime() - DAY) mine.delete(k);
      for (const [k, t] of tickets) if (t.createdAt.getTime() < now.getTime() - TICKET_TTL_MS) tickets.delete(k);
    },
    async close() {},
  };
}
