import { describe, expect, it, vi } from "vitest";
import { RunRecovery, movesForward, type RunSwap } from "./useRunRefresh";

const run = (runTime: string, base: string) => ({ runTime, base });

describe("which pointer moves the map on", () => {
  const shown = run("2026-10-11T06:00:00Z", "harmonie-2026101106-61h-v3-1a2b3c4d/");

  it("a later run, or the same run in another directory", () => {
    expect(
      movesForward(
        shown,
        run("2026-10-11T07:00:00Z", "harmonie-2026101107-61h-v3-2a2b2c2d/"),
      ),
    ).toBe(true);
    expect(
      movesForward(
        shown,
        run("2026-10-11T06:00:00Z", "harmonie-2026101106-61h-v3-9f9f9f9f/"),
      ),
    ).toBe(true);
  });

  it("never the run on screen, nor an earlier one a stale edge still serves", () => {
    expect(movesForward(shown, shown)).toBe(false);
    expect(
      movesForward(
        shown,
        run("2026-10-11T05:00:00Z", "harmonie-2026101105-61h-v3-0a0b0c0d/"),
      ),
    ).toBe(false);
  });
});

describe("recovering a run whose tiles fail", () => {
  const swap = { index: 0 } as unknown as RunSwap;
  const BASE = "harmonie-2026101106-61h-v3-1a2b3c4d/";

  it("looks again after a look that failed before it could compare", async () => {
    const recovery = new RunRecovery();
    const commit = vi.fn();
    const timeout = vi.fn(() => Promise.reject(new Error("timed out")));
    await recovery.attempt(BASE, timeout, commit);
    // The run was deleted later: the next failing tile still finds the new run.
    const found = vi.fn(() => Promise.resolve(swap));
    await recovery.attempt(BASE, found, commit);
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(found).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(swap);
  });

  it("does not read the pointer again once it has been compared for that run", async () => {
    const recovery = new RunRecovery();
    const same = vi.fn(() => Promise.resolve(null));
    await recovery.attempt(BASE, same, vi.fn());
    expect(recovery.attempt(BASE, same, vi.fn())).toBeNull();
    expect(same).toHaveBeenCalledTimes(1);
    // A new run on screen is a new question.
    await recovery.attempt("harmonie-2026101107-61h-v3-2a2b2c2d/", same, vi.fn());
    expect(same).toHaveBeenCalledTimes(2);
  });

  it("reads it once for a burst of failing tiles", async () => {
    const recovery = new RunRecovery();
    let finish: (value: null) => void = () => {};
    const slow = vi.fn(
      () => new Promise<null>((resolve) => (finish = resolve)),
    );
    const first = recovery.attempt(BASE, slow, vi.fn());
    expect(recovery.attempt(BASE, slow, vi.fn())).toBeNull();
    finish(null);
    await first;
    expect(slow).toHaveBeenCalledTimes(1);
  });
});
