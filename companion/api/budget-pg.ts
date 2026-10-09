import type { Db } from "../../market/api/src/db.js";
import { NO_USAGE, type MonthUsage, type UsageLedger } from "./budget.js";

interface UsageRow {
  calls: string;
  input_tokens: string;
  output_tokens: string;
  cache_read_tokens: string;
  cache_write_tokens: string;
  cost_micro_usd: string;
}

/** Gust's monthly totals in `companion_usage` (migrations/0001_usage.sql). */
export function pgLedger(sql: Db): UsageLedger {
  return {
    async read(month) {
      const [row] = await sql<UsageRow[]>`
        select calls, input_tokens, output_tokens, cache_read_tokens,
               cache_write_tokens, cost_micro_usd
        from companion_usage where month = ${month}`;
      if (!row) return NO_USAGE;
      return {
        calls: Number(row.calls),
        inputTokens: Number(row.input_tokens),
        outputTokens: Number(row.output_tokens),
        cacheReadTokens: Number(row.cache_read_tokens),
        cacheWriteTokens: Number(row.cache_write_tokens),
        costMicros: Number(row.cost_micro_usd),
      };
    },
    async add(month, u: MonthUsage) {
      // One statement, so two instances adding at once both count.
      await sql`
        insert into companion_usage as t (
          month, calls, input_tokens, output_tokens, cache_read_tokens,
          cache_write_tokens, cost_micro_usd
        ) values (
          ${month}, ${u.calls}, ${u.inputTokens}, ${u.outputTokens},
          ${u.cacheReadTokens}, ${u.cacheWriteTokens}, ${u.costMicros}
        )
        on conflict (month) do update set
          calls = t.calls + excluded.calls,
          input_tokens = t.input_tokens + excluded.input_tokens,
          output_tokens = t.output_tokens + excluded.output_tokens,
          cache_read_tokens = t.cache_read_tokens + excluded.cache_read_tokens,
          cache_write_tokens = t.cache_write_tokens + excluded.cache_write_tokens,
          cost_micro_usd = t.cost_micro_usd + excluded.cost_micro_usd,
          updated_at = now()`;
    },
  };
}
