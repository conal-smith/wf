/**
 * Gust's monthly allowance: what every model call cost, added up per calendar
 * month (UTC), and whether this month's allowance is spent.
 *
 * The cost is worked out here from each response's `usage` at the Claude
 * API's list prices, not read back from Anthropic's billing, so it is an
 * estimate, and it errs high: every call rounds up to the next micro-dollar.
 * The allowance is checked when a turn starts, so a turn already under way
 * when it runs out finishes. The overshoot is those few turns, a fraction of a
 * cent each on Haiku.
 */
import type { BetaUsage } from "@anthropic-ai/sdk/resources/beta/messages/messages";

/** US dollars per million tokens. */
interface Rates {
  input: number;
  output: number;
  cacheRead: number;
}

interface RateCard {
  base: Rates;
  /** A dearer card for prompts longer than `above` tokens. */
  long?: Rates & { above: number };
}

/**
 * List prices on the Claude API. A model that is not here cannot be capped,
 * so the server refuses to start Gust on it (env.ts).
 */
export const PRICES: Readonly<Record<string, RateCard>> = {
  "claude-haiku-5-5": {
    base: { input: 0.1, output: 0.5, cacheRead: 0.01 },
    long: { above: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05 },
  },
  "claude-sonnet-5-5": { base: { input: 2, output: 10, cacheRead: 0.2 } },
  "claude-opus-5-5": { base: { input: 4, output: 20, cacheRead: 0.2 } },
};

/** Writing the five-minute prompt cache costs this much more than reading the input. */
const CACHE_WRITE = 1.25;

export function isPriced(model: string): boolean {
  return model in PRICES;
}

export type Usage = Pick<
  BetaUsage,
  | "input_tokens"
  | "output_tokens"
  | "cache_creation_input_tokens"
  | "cache_read_input_tokens"
>;

/** What one call cost, in micro-dollars, rounded up. Zero for a model with no price. */
export function costMicros(model: string, usage: Usage): number {
  const card = PRICES[model];
  if (!card) return 0;
  const input = usage.input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const prompt = input + write + read;
  const rates = card.long && prompt > card.long.above ? card.long : card.base;
  const dollars =
    (input * rates.input +
      write * rates.input * CACHE_WRITE +
      read * rates.cacheRead +
      (usage.output_tokens ?? 0) * rates.output) /
    1_000_000;
  return Math.ceil(dollars * 1_000_000);
}

/** One month's running totals. */
export interface MonthUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicros: number;
}

export const NO_USAGE: MonthUsage = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costMicros: 0,
};

/** Where the totals are kept: Postgres in production (budget-pg.ts), memory otherwise. */
export interface UsageLedger {
  /** `month` is "2026-10". */
  read(month: string): Promise<MonthUsage>;
  add(month: string, usage: MonthUsage): Promise<void>;
}

export function memoryLedger(): UsageLedger {
  const months = new Map<string, MonthUsage>();
  return {
    async read(month) {
      return months.get(month) ?? NO_USAGE;
    },
    async add(month, usage) {
      const was = months.get(month) ?? NO_USAGE;
      months.set(month, {
        calls: was.calls + usage.calls,
        inputTokens: was.inputTokens + usage.inputTokens,
        outputTokens: was.outputTokens + usage.outputTokens,
        cacheReadTokens: was.cacheReadTokens + usage.cacheReadTokens,
        cacheWriteTokens: was.cacheWriteTokens + usage.cacheWriteTokens,
        costMicros: was.costMicros + usage.costMicros,
      });
    },
  };
}

/** "2026-10" for any moment in October 2026, UTC. */
export function monthOf(at: number): string {
  return new Date(at).toISOString().slice(0, 7);
}

/** The first moment of the month after `at`'s, UTC: when the allowance comes back. */
export function nextMonth(at: number): Date {
  const d = new Date(at);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

export interface BudgetState {
  spent: boolean;
  /** ISO: the start of next month. */
  resumes: string;
  usage: MonthUsage;
  /** Micro-dollars, or null with no cap. */
  limitMicros: number | null;
}

export interface Budget {
  state(): Promise<BudgetState>;
  /** Adds one model call. `model` is the model that served it. */
  record(model: string, usage: Usage): Promise<void>;
}

export interface BudgetOptions {
  /** US dollars a calendar month, or null for no cap (the scripted fake only). */
  monthlyUsd: number | null;
  ledger: UsageLedger;
  /** The model Gust asks for: prices a call whose serving model has no price of its own. */
  model: string;
  now?: () => number;
}

export function createBudget(options: BudgetOptions): Budget {
  const { ledger } = options;
  const now = options.now ?? Date.now;
  const limitMicros =
    options.monthlyUsd === null
      ? null
      : Math.round(options.monthlyUsd * 1_000_000);
  return {
    async state() {
      const at = now();
      const usage = await ledger.read(monthOf(at));
      return {
        spent: limitMicros !== null && usage.costMicros >= limitMicros,
        resumes: nextMonth(at).toISOString(),
        usage,
        limitMicros,
      };
    },
    async record(model, usage) {
      const month = monthOf(now());
      const cost = costMicros(isPriced(model) ? model : options.model, usage);
      const before =
        limitMicros === null ? null : (await ledger.read(month)).costMicros;
      await ledger.add(month, {
        calls: 1,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        costMicros: cost,
      });
      if (
        limitMicros !== null &&
        before !== null &&
        before < limitMicros &&
        before + cost >= limitMicros
      )
        console.warn(
          `companion: ${month}'s budget of $${(limitMicros / 1e6).toFixed(2)} is spent; Gust rests until ${nextMonth(now()).toISOString().slice(0, 10)}`,
        );
    },
  };
}
