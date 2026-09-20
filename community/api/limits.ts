/**
 * The ceiling on how fast one member can write. A token bucket per member and
 * action, kept in this process: a bucket holds `max` tokens, a write takes
 * one, and they come back evenly over `perMs`. An action with two rates takes
 * from both buckets or from neither. Nothing here survives a restart, so the
 * limits counted in days are also counted from the tables (see dayStart).
 */
import { HTTPException } from "hono/http-exception";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type RateAction = "message" | "thread" | "reaction" | "report";

export interface Rate {
  max: number;
  perMs: number;
}

export type Rates = Record<RateAction, readonly Rate[]>;

export const RATES: Rates = {
  message: [
    { max: 1, perMs: 3 * SECOND },
    { max: 60, perMs: HOUR },
  ],
  thread: [{ max: 5, perMs: HOUR }],
  reaction: [{ max: 60, perMs: MINUTE }],
  report: [{ max: 5, perMs: DAY }],
};

export interface Limiter {
  /** Takes a token for the write about to happen, or ends the request with a 429. */
  take(userId: string, action: RateAction): void;
}

/**
 * Ends the request with 429 and how many seconds to wait, in the body and in
 * Retry-After. The limits counted in days say so: their wait is no moment.
 */
export function rateLimited(
  retryAfterMs: number,
  message = "That is a lot at once. Give it a moment and try again.",
): never {
  const retryAfter = Math.max(1, Math.ceil(retryAfterMs / SECOND));
  throw new HTTPException(429, {
    res: Response.json(
      { error: "rate_limited", message, retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    ),
  });
}

/**
 * Midnight UTC before `now`. The limits counted from a table run over the
 * calendar day, so the wait they answer with is exact: see untilTomorrowMs.
 */
export function dayStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / DAY) * DAY);
}

export function untilTomorrowMs(now: Date): number {
  return dayStart(now).getTime() + DAY - now.getTime();
}

/** Full buckets are dropped once the map holds this many, so it cannot grow without end. */
const SWEEP_AT = 10_000;

/** Refilling in fractions leaves a whole token a hair short. */
const WHOLE = 1 - 1e-9;

export function createLimiter(
  now: () => Date = () => new Date(),
  rates: Rates = RATES,
): Limiter {
  const buckets = new Map<string, { tokens: number; at: number; rate: Rate }>();

  const refilled = (b: { tokens: number; at: number; rate: Rate }, t: number) =>
    Math.min(
      b.rate.max,
      b.tokens + (Math.max(0, t - b.at) * b.rate.max) / b.rate.perMs,
    );

  const sweep = (t: number) => {
    for (const [k, b] of buckets)
      if (refilled(b, t) >= b.rate.max) buckets.delete(k);
  };

  return {
    take(userId, action) {
      const t = now().getTime();
      const held = rates[action].map((rate, i) => {
        const k = [userId, action, i].join("\n");
        const b = buckets.get(k) ?? { tokens: rate.max, at: t, rate };
        return { k, rate, tokens: refilled(b, t) };
      });
      const waitMs = Math.max(
        ...held.map(({ rate, tokens }) =>
          tokens >= WHOLE ? 0 : ((1 - tokens) * rate.perMs) / rate.max,
        ),
      );
      // Threads and reports come back in minutes and hours, which is no moment either.
      if (waitMs > MINUTE)
        rateLimited(waitMs, "That is a lot in a short while. Try again later.");
      if (waitMs > 0) rateLimited(waitMs);
      for (const { k, rate, tokens } of held)
        buckets.set(k, { tokens: Math.max(0, tokens - 1), at: t, rate });
      if (buckets.size > SWEEP_AT) sweep(t);
    },
  };
}
