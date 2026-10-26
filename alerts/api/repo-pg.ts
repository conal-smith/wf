/**
 * The alerts store in Postgres (migrations/0001_init.sql, ledger
 * alerts_migrations). JSON goes in as text cast to jsonb and comes back
 * parsed; times come back as Dates.
 */
import type { JSONValue } from "postgres";
import type { Db } from "../../market/api/src/db.js";
import type { AlertRule, AppVariant, NoticeKind, Platform } from "../shared/protocol.js";
import { storedRider } from "../shared/schema.js";
import {
  DEVICE_TTL_DAYS,
  TICKET_TTL_MS,
  type AlertsRepo,
  type DeviceRow,
  type Notice,
  type OutboxMessage,
  type OutboxRow,
  type Ticket,
} from "./repo.js";

interface DeviceRecord {
  id: string;
  installation_id: string;
  secret_hash: string;
  expo_push_token: string | null;
  platform: Platform;
  app_variant: AppVariant;
  app_version: string;
  timezone: string;
  rider: unknown;
  quiet_hours: boolean;
  app_updates: boolean;
  rules: AlertRule[];
  created_at: Date;
  updated_at: Date;
  rules_updated_at: Date;
  last_seen_at: Date;
}

const device = (r: DeviceRecord): DeviceRow => ({
  id: r.id,
  installationId: r.installation_id,
  secretHash: r.secret_hash,
  expoPushToken: r.expo_push_token,
  platform: r.platform,
  appVariant: r.app_variant,
  appVersion: r.app_version,
  timezone: r.timezone,
  rider: storedRider(r.rider),
  quietHours: r.quiet_hours,
  appUpdates: r.app_updates,
  rules: r.rules,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  rulesUpdatedAt: r.rules_updated_at,
  lastSeenAt: r.last_seen_at,
});

interface NoticeRecord {
  rule_id: string;
  spot_id: string;
  day: string;
  rule_sig: string;
  start_at: Date;
  end_at: Date;
  stars: number;
  state: "told" | "off";
  sent_count: number;
}

const notice = (r: NoticeRecord): Notice => ({
  ruleId: r.rule_id,
  spotId: r.spot_id,
  day: r.day,
  ruleSig: r.rule_sig,
  start: r.start_at.toISOString(),
  end: r.end_at.toISOString(),
  stars: Number(r.stars),
  state: r.state,
  count: Number(r.sent_count),
});

interface OutboxRecord {
  id: string;
  device_id: string;
  key: string;
  kind: NoticeKind;
  deliver_after: Date;
  expires_at: Date;
  message: Pick<OutboxMessage, "title" | "body" | "data" | "channelId" | "fold">;
  attempts: number;
}

const outboxRow = (r: OutboxRecord): OutboxRow => ({
  id: String(r.id),
  deviceId: r.device_id,
  key: r.key,
  kind: r.kind,
  deliverAfter: r.deliver_after,
  expiresAt: r.expires_at,
  attempts: Number(r.attempts),
  ...r.message,
});

const message = (m: OutboxMessage) => ({
  title: m.title,
  body: m.body,
  data: m.data,
  channelId: m.channelId,
  ...(m.fold ? { fold: m.fold } : {}),
});

const ticket = (r: { id: string; device_id: string; token: string; created_at: Date }): Ticket => ({
  id: r.id,
  deviceId: r.device_id,
  token: r.token,
  createdAt: r.created_at,
});

export function pgAlertsRepo(sql: Db): AlertsRepo {
  // A jsonb parameter: postgres.js serialises it once.
  const json = (value: unknown) => sql.json(value as JSONValue);
  return {
    async createDevice(d, now) {
      const [row] = await sql.begin(async (tx) => {
        if (d.expoPushToken)
          await tx`update alerts_devices set expo_push_token = null, updated_at = ${now}
                   where expo_push_token = ${d.expoPushToken}`;
        return tx<DeviceRecord[]>`
          insert into alerts_devices (
            id, installation_id, secret_hash, expo_push_token, platform, app_variant,
            app_version, timezone, rider, quiet_hours, app_updates,
            created_at, updated_at, rules_updated_at, last_seen_at
          ) values (
            ${d.id}, ${d.installationId}, ${d.secretHash}, ${d.expoPushToken}, ${d.platform},
            ${d.appVariant}, ${d.appVersion}, ${d.timezone}, ${json(d.rider)},
            ${d.quietHours}, ${d.appUpdates}, ${now}, ${now}, ${now}, ${now}
          ) returning *`;
      });
      return device(row);
    },

    async getDevice(id) {
      const [row] = await sql<DeviceRecord[]>`select * from alerts_devices where id = ${id}`;
      return row ? device(row) : null;
    },

    async updateDevice(id, patch, now) {
      return sql.begin(async (tx) => {
        const [current] = await tx<DeviceRecord[]>`select * from alerts_devices where id = ${id} for update`;
        if (!current) return null;
        const next = { ...device(current), ...patch };
        if (patch.expoPushToken)
          await tx`update alerts_devices set expo_push_token = null, updated_at = ${now}
                   where expo_push_token = ${patch.expoPushToken} and id <> ${id}`;
        const [row] = await tx<DeviceRecord[]>`
          update alerts_devices set
            expo_push_token = ${next.expoPushToken},
            app_variant = ${next.appVariant},
            app_version = ${next.appVersion},
            timezone = ${next.timezone},
            rider = ${json(next.rider)},
            quiet_hours = ${next.quietHours},
            app_updates = ${next.appUpdates},
            updated_at = ${now},
            last_seen_at = ${now}
          where id = ${id} returning *`;
        return device(row);
      });
    },

    async touchDevice(id, now) {
      await sql`update alerts_devices set last_seen_at = ${now} where id = ${id}`;
    },

    async deleteDevice(id) {
      const rows = await sql`delete from alerts_devices where id = ${id} returning id`;
      return rows.length > 0;
    },

    async putRules(id, rules, now) {
      const [row] = await sql<DeviceRecord[]>`
        update alerts_devices set rules = ${json(rules)},
          rules_updated_at = ${now}, last_seen_at = ${now}
        where id = ${id} returning *`;
      return row ? device(row) : null;
    },

    async devicesToEvaluate(since) {
      const rows = await sql<DeviceRecord[]>`
        select d.* from alerts_devices d
        where d.expo_push_token is not null
          and (
            exists (select 1 from jsonb_array_elements(d.rules) r where (r ->> 'enabled')::boolean)
            or exists (select 1 from alerts_notices n where n.device_id = d.id)
          )
          and (${since}::timestamptz is null or d.updated_at > ${since} or d.rules_updated_at > ${since})
        order by d.id`;
      return rows.map(device);
    },

    async notices(deviceId) {
      const rows = await sql<NoticeRecord[]>`select * from alerts_notices where device_id = ${deviceId}`;
      return rows.map(notice);
    },

    async queued(deviceId) {
      const rows = await sql<OutboxRecord[]>`select * from alerts_outbox where device_id = ${deviceId} order by id`;
      return rows.map(outboxRow);
    },

    async applyPlan(plan) {
      await sql.begin(async (tx) => {
        const [held] = await tx`select 1 from alerts_devices where id = ${plan.deviceId} for share`;
        if (!held) return;
        for (const n of plan.notices.drop)
          await tx`delete from alerts_notices where device_id = ${plan.deviceId}
                   and rule_id = ${n.ruleId} and spot_id = ${n.spotId} and day = ${n.day}`;
        for (const n of plan.notices.put)
          await tx`
            insert into alerts_notices (device_id, rule_id, spot_id, day, rule_sig, start_at, end_at, stars, state, sent_count)
            values (${plan.deviceId}, ${n.ruleId}, ${n.spotId}, ${n.day}, ${n.ruleSig}, ${n.start}, ${n.end}, ${n.stars}, ${n.state}, ${n.count})
            on conflict (device_id, rule_id, spot_id, day) do update set
              rule_sig = excluded.rule_sig, start_at = excluded.start_at, end_at = excluded.end_at,
              stars = excluded.stars, state = excluded.state, sent_count = excluded.sent_count,
              updated_at = now()`;
        for (const key of plan.outbox.drop)
          await tx`delete from alerts_outbox where device_id = ${plan.deviceId} and key = ${key}`;
        for (const m of plan.outbox.put)
          await tx`
            insert into alerts_outbox (device_id, key, kind, deliver_after, expires_at, message)
            values (${m.deviceId}, ${m.key}, ${m.kind}, ${m.deliverAfter}, ${m.expiresAt}, ${json(message(m))})
            on conflict (device_id, key) do update set
              kind = excluded.kind, deliver_after = excluded.deliver_after,
              expires_at = excluded.expires_at, message = excluded.message, attempts = 0`;
      });
    },

    async updateSubscribers(platforms, variants) {
      if (!platforms.length || !variants.length) return [];
      const rows = await sql<DeviceRecord[]>`
        select * from alerts_devices
        where app_updates and expo_push_token is not null
          and platform in ${sql(platforms as Platform[])}
          and app_variant in ${sql(variants as AppVariant[])}
        order by id`;
      return rows.map(device);
    },

    async enqueue(messages) {
      for (const m of messages)
        await sql`
          insert into alerts_outbox (device_id, key, kind, deliver_after, expires_at, message)
          select ${m.deviceId}, ${m.key}, ${m.kind}, ${m.deliverAfter}, ${m.expiresAt}, ${json(message(m))}
          where exists (select 1 from alerts_devices where id = ${m.deviceId})
          on conflict (device_id, key) do update set
            kind = excluded.kind, deliver_after = excluded.deliver_after,
            expires_at = excluded.expires_at, message = excluded.message, attempts = 0`;
    },

    async claimDue(now, limit) {
      await sql`delete from alerts_outbox where expires_at <= ${now}`;
      // Deleted as it is read, rows another instance holds skipped: a message
      // is sent by whoever took it, once.
      const rows = await sql<OutboxRecord[]>`
        with due as (
          select id from alerts_outbox
          where deliver_after <= ${now} and expires_at > ${now}
          order by id limit ${limit}
          for update skip locked
        )
        delete from alerts_outbox o using due where o.id = due.id
        returning o.*`;
      return rows.map(outboxRow).sort((a, b) => Number(a.id) - Number(b.id));
    },

    async requeue(rows, at) {
      for (const r of rows)
        await sql`
          insert into alerts_outbox (device_id, key, kind, deliver_after, expires_at, message, attempts)
          select ${r.deviceId}, ${r.key}, ${r.kind}, ${at}, ${r.expiresAt}, ${json(message(r))}, ${r.attempts + 1}
          where exists (select 1 from alerts_devices where id = ${r.deviceId})
          on conflict (device_id, key) do nothing`;
    },

    async addTickets(list) {
      for (const t of list)
        await sql`
          insert into alerts_tickets (id, device_id, token, created_at)
          select ${t.id}, ${t.deviceId}, ${t.token}, ${t.createdAt}
          where exists (select 1 from alerts_devices where id = ${t.deviceId})
          on conflict (id) do nothing`;
    },

    async ticketsBefore(before, limit) {
      const rows = await sql<{ id: string; device_id: string; token: string; created_at: Date }[]>`
        select * from alerts_tickets where created_at <= ${before} order by created_at limit ${limit}`;
      return rows.map(ticket);
    },

    async dropTickets(ids) {
      if (ids.length) await sql`delete from alerts_tickets where id in ${sql(ids)}`;
    },

    async clearToken(deviceId, token) {
      await sql`update alerts_devices set expo_push_token = null
                where id = ${deviceId} and expo_push_token = ${token}`;
    },

    async getState(key) {
      const [row] = await sql<{ value: unknown }[]>`select value from alerts_state where key = ${key}`;
      return row ? row.value : null;
    },

    async setState(key, value) {
      await sql`
        insert into alerts_state (key, value) values (${key}, ${json(value)})
        on conflict (key) do update set value = excluded.value, updated_at = now()`;
    },

    async claimState(key, value) {
      const rows = await sql`
        insert into alerts_state (key, value) values (${key}, ${json(value)})
        on conflict (key) do nothing returning key`;
      return rows.length > 0;
    },

    async prune(now) {
      const stale = new Date(now.getTime() - DEVICE_TTL_DAYS * 24 * 3_600_000);
      await sql`delete from alerts_devices where last_seen_at < ${stale}`;
      await sql`delete from alerts_notices where end_at < ${new Date(now.getTime() - 24 * 3_600_000)}`;
      await sql`delete from alerts_tickets where created_at < ${new Date(now.getTime() - TICKET_TTL_MS)}`;
    },

    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

/**
 * One evaluator at a time across instances: a session advisory lock on a
 * connection of its own, held while `work` runs. Another instance that finds
 * it taken skips its turn (null) rather than waiting.
 */
export function pgEvaluatorLock(sql: Db) {
  const KEY = 7205759403792794;
  return async <T>(work: () => Promise<T>): Promise<T | null> => {
    const conn = await sql.reserve();
    try {
      const [row] = await conn<{ locked: boolean }[]>`select pg_try_advisory_lock(${KEY}) as locked`;
      if (!row?.locked) return null;
      try {
        return await work();
      } finally {
        await conn`select pg_advisory_unlock(${KEY})`;
      }
    } finally {
      conn.release();
    }
  };
}
