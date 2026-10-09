import { describe, expect, it, vi } from "vitest";
import {
  NO_USAGE,
  costMicros,
  createBudget,
  isPriced,
  memoryLedger,
  monthOf,
  nextMonth,
} from "./budget";

const usage = (input: number, output: number, write = 0, read = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_creation_input_tokens: write,
  cache_read_input_tokens: read,
});

describe("costMicros", () => {
  it("prices Haiku 5.5 at list: input, output, cache writes and reads", () => {
    // 10k in at $0.10, 1k out at $0.50, 2k written at 1.25x, 20k read at $0.01.
    expect(
      costMicros("claude-haiku-5-5", usage(10_000, 1_000, 2_000, 20_000)),
    ).toBe(1000 + 500 + 250 + 200);
  });

  it("moves to the long-prompt card past 100k prompt tokens, cache included", () => {
    expect(costMicros("claude-haiku-5-5", usage(50_000, 0, 0, 50_000))).toBe(
      5000 + 500,
    );
    expect(costMicros("claude-haiku-5-5", usage(50_001, 0, 0, 50_000))).toBe(
      Math.ceil(50_001 * 0.5 + 50_000 * 0.05),
    );
  });

  it("rounds every call up, so the estimate errs high", () => {
    expect(costMicros("claude-haiku-5-5", usage(1, 0))).toBe(1);
  });

  it("costs nothing for a model it has no price for, which env.ts refuses", () => {
    expect(isPriced("fake")).toBe(false);
    expect(costMicros("fake", usage(1_000_000, 1_000_000))).toBe(0);
    expect(isPriced("claude-haiku-5-5")).toBe(true);
  });
});

describe("months", () => {
  it("are calendar months in UTC", () => {
    expect(monthOf(Date.parse("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(nextMonth(Date.parse("2026-10-09T12:00:00Z")).toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    expect(nextMonth(Date.parse("2026-12-15T00:00:00Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});

describe("createBudget", () => {
  it("adds each call up and is spent once the month reaches the cap", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = Date.parse("2026-10-09T12:00:00Z");
    const ledger = memoryLedger();
    const budget = createBudget({
      monthlyUsd: 0.002,
      ledger,
      model: "claude-haiku-5-5",
      now: () => now,
    });
    expect((await budget.state()).spent).toBe(false);
    await budget.record("claude-haiku-5-5", usage(10_000, 1_000)); // 1500
    expect((await budget.state()).spent).toBe(false);
    await budget.record("claude-haiku-5-5", usage(5_000, 0)); // 500
    const state = await budget.state();
    expect(state.spent).toBe(true);
    expect(state.usage).toMatchObject({
      calls: 2,
      inputTokens: 15_000,
      outputTokens: 1_000,
      costMicros: 2_000,
    });
    expect(console.warn).toHaveBeenCalledOnce();

    // A new month starts afresh.
    now = Date.parse("2026-11-01T00:00:00Z");
    expect(await budget.state()).toMatchObject({
      spent: false,
      usage: NO_USAGE,
      resumes: "2026-12-01T00:00:00.000Z",
    });
  });

  it("prices a call served by an unpriced model at the model Gust asked for", async () => {
    const ledger = memoryLedger();
    const budget = createBudget({
      monthlyUsd: 1,
      ledger,
      model: "claude-haiku-5-5",
      now: () => Date.parse("2026-10-09T12:00:00Z"),
    });
    await budget.record("something-else", usage(10_000, 0));
    expect((await ledger.read("2026-10")).costMicros).toBe(1000);
  });

  it("is never spent without a cap", async () => {
    const ledger = memoryLedger();
    await ledger.add("2026-10", { ...NO_USAGE, costMicros: 1e12 });
    const budget = createBudget({
      monthlyUsd: null,
      ledger,
      model: "claude-haiku-5-5",
      now: () => Date.parse("2026-10-09T12:00:00Z"),
    });
    expect((await budget.state()).spent).toBe(false);
  });
});
