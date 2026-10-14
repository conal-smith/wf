import { describe, expect, it } from "vitest";
import {
  addDays,
  afterQuietHours,
  daysBetween,
  inQuietHours,
  irishInstant,
  irishTime,
  windowLabel,
} from "./time";

const at = (iso: string) => Date.parse(iso);

describe("irishTime", () => {
  it("is UTC in winter and an hour on in summer", () => {
    expect(irishTime(at("2026-01-10T13:00:00Z"))).toEqual({
      date: "2026-01-10",
      hour: 13,
      minute: 0,
      weekday: "sat",
    });
    expect(irishTime(at("2026-07-11T13:30:00Z"))).toMatchObject({ hour: 14, minute: 30 });
  });

  it("moves the day over at Irish midnight, not UTC's", () => {
    expect(irishTime(at("2026-07-11T23:30:00Z"))).toMatchObject({
      date: "2026-07-12",
      hour: 0,
      weekday: "sun",
    });
  });

  it("follows the clocks forward on 29 March 2026 and back on 25 October", () => {
    expect(irishTime(at("2026-03-29T00:59:00Z")).hour).toBe(0);
    expect(irishTime(at("2026-03-29T01:00:00Z")).hour).toBe(2);
    expect(irishTime(at("2026-10-25T00:30:00Z")).hour).toBe(1);
    expect(irishTime(at("2026-10-25T01:30:00Z")).hour).toBe(1);
  });
});

describe("irishInstant", () => {
  it("finds the instant an Irish hour begins, either side of a change", () => {
    expect(new Date(irishInstant("2026-03-29", 9)).toISOString()).toBe("2026-03-29T08:00:00.000Z");
    expect(new Date(irishInstant("2026-03-28", 9)).toISOString()).toBe("2026-03-28T09:00:00.000Z");
    expect(new Date(irishInstant("2026-10-25", 9)).toISOString()).toBe("2026-10-25T09:00:00.000Z");
    expect(new Date(irishInstant("2026-10-24", 9)).toISOString()).toBe("2026-10-24T08:00:00.000Z");
  });

  it("reads 24 as the next midnight, the skipped hour as the jump and the repeated one first time round", () => {
    expect(new Date(irishInstant("2026-07-11", 24)).toISOString()).toBe("2026-07-11T23:00:00.000Z");
    expect(new Date(irishInstant("2026-03-29", 1)).toISOString()).toBe("2026-03-29T01:00:00.000Z");
    expect(new Date(irishInstant("2026-10-25", 1)).toISOString()).toBe("2026-10-25T00:00:00.000Z");
  });
});

describe("quiet hours", () => {
  it("holds 22:00 to 07:00 Irish time", () => {
    expect(inQuietHours(at("2026-07-11T20:59:00Z"))).toBe(false); // 21:59 IST
    expect(inQuietHours(at("2026-07-11T21:00:00Z"))).toBe(true); // 22:00 IST
    expect(inQuietHours(at("2026-07-12T05:59:00Z"))).toBe(true); // 06:59 IST
    expect(inQuietHours(at("2026-07-12T06:00:00Z"))).toBe(false); // 07:00 IST
  });

  it("queues for the next 07:00, the same morning after midnight", () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    expect(iso(afterQuietHours(at("2026-07-11T21:30:00Z")))).toBe("2026-07-12T06:00:00.000Z");
    expect(iso(afterQuietHours(at("2026-07-12T02:00:00Z")))).toBe("2026-07-12T06:00:00.000Z");
    expect(afterQuietHours(at("2026-07-12T10:00:00Z"))).toBe(at("2026-07-12T10:00:00Z"));
  });

  it("gets 07:00 right on the nights the clocks change", () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    // Saturday 23:30 GMT; Sunday 07:00 is already summer time.
    expect(iso(afterQuietHours(at("2026-03-28T23:30:00Z")))).toBe("2026-03-29T06:00:00.000Z");
    // Saturday 23:30 IST; Sunday 07:00 is back on GMT.
    expect(iso(afterQuietHours(at("2026-10-24T22:30:00Z")))).toBe("2026-10-25T07:00:00.000Z");
  });
});

describe("calendar days", () => {
  it("adds and counts days across months and years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(daysBetween("2026-10-14", "2026-10-17")).toBe(3);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });
});

describe("windowLabel", () => {
  it("reads Irish time by the window's first day", () => {
    expect(windowLabel(at("2026-10-17T13:00:00Z"), at("2026-10-17T16:00:00Z"))).toBe(
      "Sat 14:00–17:00",
    );
    expect(windowLabel(at("2026-06-20T20:00:00Z"), at("2026-06-20T23:00:00Z"))).toBe(
      "Sat 21:00–24:00",
    );
  });
});
