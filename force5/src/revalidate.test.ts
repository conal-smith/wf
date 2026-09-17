import { describe, expect, it } from "vitest";
import {
  REVALIDATE_MS,
  revalidateDecision,
  runLabel,
  shouldRevalidate,
} from "./revalidate";

const AT = Date.parse("2026-09-17T09:00:00Z");
const later = (minutes: number) => AT + minutes * 60000;

describe("revalidateDecision", () => {
  it("waits until the run has been trusted for five minutes", () => {
    expect(revalidateDecision(AT, AT, true, false)).toBe("wait");
    expect(revalidateDecision(AT, later(4.9), true, false)).toBe("wait");
    expect(revalidateDecision(AT, later(5), true, false)).toBe("go");
    expect(revalidateDecision(AT, later(90), true, false)).toBe("go");
    expect(REVALIDATE_MS).toBe(5 * 60000);
  });

  it("never fetches for a tab nobody is looking at", () => {
    expect(revalidateDecision(AT, later(90), false, false)).toBe("wait");
    expect(revalidateDecision(AT, later(90), false, true)).toBe("wait");
  });

  it("defers a due check while the reader is in the middle of something", () => {
    expect(revalidateDecision(AT, later(6), true, true)).toBe("defer");
    // Not yet due and busy is still just "not yet": there is nothing to retry.
    expect(revalidateDecision(AT, later(1), true, true)).toBe("wait");
  });

  it("treats a clock that jumped backwards as due, not as locked out", () => {
    expect(revalidateDecision(later(30), AT, true, false)).toBe("go");
  });

  it("answers the same question as a boolean", () => {
    expect(shouldRevalidate(AT, later(5), true, false)).toBe(true);
    expect(shouldRevalidate(AT, later(5), true, true)).toBe(false);
    expect(shouldRevalidate(AT, later(5), false, false)).toBe(false);
    expect(shouldRevalidate(AT, later(2), true, false)).toBe(false);
  });
});

describe("runLabel", () => {
  it("names a run by its UTC hour, as every source publishes it", () => {
    expect(runLabel("2026-09-17T12:00:00Z")).toBe("12:00 UTC");
    expect(runLabel("2026-09-17T06:30:00Z")).toBe("06:30 UTC");
    // Irish summer time is an hour ahead; the run is still named in UTC.
    expect(runLabel("2026-09-17T00:00:00+01:00")).toBe("23:00 UTC");
    expect(runLabel("not a time")).toBe("newest");
  });
});
