/**
 * The token buckets on a clock the test moves by hand. The routes that take
 * from them are covered over HTTP in router.test.ts.
 */
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import {
  createLimiter,
  dayStart,
  RATES,
  untilTomorrowMs,
  type RateAction,
} from "./limits";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

function clocked() {
  let at = Date.parse("2026-01-01T12:00:00.000Z");
  const limiter = createLimiter(() => new Date(at));
  /** Null when the token was given, or the refusal's body. */
  const take = async (userId: string, action: RateAction) => {
    try {
      limiter.take(userId, action);
      return null;
    } catch (err) {
      if (!(err instanceof HTTPException)) throw err;
      const res = err.getResponse();
      expect(res.status).toBe(429);
      const body = (await res.json()) as {
        error: string;
        message: string;
        retryAfter: number;
      };
      expect(res.headers.get("Retry-After")).toBe(String(body.retryAfter));
      return body;
    }
  };
  return { take, wait: (ms: number) => void (at += ms) };
}

describe("rate limits", () => {
  it("fixes the rates the plan names", () => {
    expect(RATES).toEqual({
      message: [
        { max: 1, perMs: 3 * SECOND },
        { max: 60, perMs: HOUR },
      ],
      thread: [{ max: 5, perMs: HOUR }],
      reaction: [{ max: 60, perMs: MINUTE }],
      report: [{ max: 5, perMs: 24 * HOUR }],
    });
  });

  it("gives a message every three seconds and says how long is left", async () => {
    const { take, wait } = clocked();
    expect(await take("aoife", "message")).toBeNull();
    expect(await take("aoife", "message")).toMatchObject({
      error: "rate_limited",
      message: expect.any(String),
      retryAfter: 3,
    });
    wait(1200);
    expect((await take("aoife", "message"))!.retryAfter).toBe(2);
    wait(1799);
    expect((await take("aoife", "message"))!.retryAfter).toBe(1);
    wait(1);
    expect(await take("aoife", "message")).toBeNull();
  });

  it("stops at sixty messages in the hour, and a refusal costs nothing", async () => {
    const { take, wait } = clocked();
    // One every three seconds is as fast as the first bucket allows: a token
    // comes back every minute, so three minutes in there are 63, not 60.
    let sent = 0;
    while ((await take("aoife", "message")) === null) {
      sent += 1;
      wait(3 * SECOND);
    }
    expect(sent).toBe(63);
    const refused = (await take("aoife", "message"))!;
    expect(refused.retryAfter).toBeGreaterThan(3);
    expect(refused.retryAfter).toBeLessThanOrEqual(60);
    // Asking again and again moved nothing: the wait it named is still the wait.
    wait(refused.retryAfter * SECOND);
    expect(await take("aoife", "message")).toBeNull();
    // An hour of quiet fills it to sixty again, and no higher.
    wait(5 * HOUR);
    sent = 0;
    while ((await take("aoife", "message")) === null) {
      sent += 1;
      wait(3 * SECOND);
    }
    expect(sent).toBe(63);
  });

  it("counts each member and each action on their own", async () => {
    const { take, wait } = clocked();
    for (let i = 0; i < 5; i++)
      expect(await take("aoife", "thread")).toBeNull();
    expect((await take("aoife", "thread"))!.retryAfter).toBe(12 * 60);
    expect(await take("brian", "thread")).toBeNull();
    expect(await take("aoife", "message")).toBeNull();
    for (let i = 0; i < 60; i++)
      expect(await take("aoife", "reaction")).toBeNull();
    expect((await take("aoife", "reaction"))!.retryAfter).toBe(1);
    for (let i = 0; i < 5; i++)
      expect(await take("aoife", "report")).toBeNull();
    expect((await take("aoife", "report"))!.retryAfter).toBe(
      (24 * 60 * 60) / 5,
    );

    // Twelve minutes is one thread; a minute is every reaction; a day is every report.
    wait(12 * MINUTE);
    expect(await take("aoife", "thread")).toBeNull();
    expect(await take("aoife", "thread")).not.toBeNull();
    for (let i = 0; i < 60; i++)
      expect(await take("aoife", "reaction")).toBeNull();
    wait(24 * HOUR);
    for (let i = 0; i < 5; i++)
      expect(await take("aoife", "report")).toBeNull();
    expect(await take("aoife", "report")).not.toBeNull();
  });

  it("measures a table's day from midnight UTC", () => {
    const now = new Date("2026-03-04T21:30:00.250Z");
    expect(dayStart(now).toISOString()).toBe("2026-03-04T00:00:00.000Z");
    expect(untilTomorrowMs(now)).toBe(2.5 * HOUR - 250);
    const midnight = new Date("2026-03-05T00:00:00.000Z");
    expect(dayStart(midnight)).toEqual(midnight);
    expect(untilTomorrowMs(midnight)).toBe(24 * HOUR);
  });
});
