import { describe, expect, it } from "vitest";
import { matchRule, materiallyChanged, noticeKey, ruleSignature, type RatedColumn } from "./match";
import { RULE_DEFAULTS, WEEKDAYS, type AlertRule } from "./protocol";

const HOUR = 3_600_000;

/** Every hour of the UTC days given, as ISO times. */
function hourly(from: string, hours: number): string[] {
  const start = Date.parse(from);
  return Array.from({ length: hours }, (_, i) => new Date(start + i * HOUR).toISOString());
}

const rated = (stars: number, over: Partial<RatedColumn> = {}): RatedColumn => ({
  windKn: 18 + stars / 2,
  gustKn: 26,
  from: 250,
  rating: { stars, wing: { recommended: 5, own: null } },
  ...over,
});
/** Wind blowing, but dark: never rated. */
const dark: RatedColumn = { windKn: 25, gustKn: 30, from: 250, rating: null };

/**
 * Columns on `axis`: each UTC hour's stars from `stars` (by "HH" key), dark
 * before 07Z and from 18Z, else a one-star hour.
 */
function day(axis: readonly string[], stars: Record<string, number>) {
  return axis.map((iso) => {
    const key = iso.slice(0, 13);
    const hour = Number(iso.slice(11, 13));
    if (key in stars) return rated(stars[key]);
    return hour < 7 || hour >= 18 ? dark : rated(1);
  });
}

const rule = (over: Partial<AlertRule> = {}): AlertRule => ({
  id: "r1",
  name: "Brandon weekends",
  spots: ["brandon"],
  ...RULE_DEFAULTS,
  fromHour: 0,
  toHour: 24,
  ...over,
});

// Wednesday 14 October 2026, 10:00 IST.
const NOW = Date.parse("2026-10-14T09:00:00Z");
const SAT = hourly("2026-10-17T00:00:00Z", 24);

describe("matchRule", () => {
  const sat = day(SAT, {
    "2026-10-17T13": 4,
    "2026-10-17T14": 5,
    "2026-10-17T15": 4,
  });

  it("finds a window and gives it its weakest hour's stars and its best's as the peak", () => {
    const [m, ...rest] = matchRule(rule(), SAT, () => sat, NOW);
    expect(rest).toEqual([]);
    expect(m).toMatchObject({
      ruleId: "r1",
      spotId: "brandon",
      day: "2026-10-17",
      start: "2026-10-17T13:00:00.000Z",
      end: "2026-10-17T16:00:00.000Z",
      hours: 3,
      stars: 4,
      peakStars: 5,
      windKn: [20, 21],
      gustKn: 26,
      from: 250,
      wing: 5,
      ownWing: false,
      windows: 1,
    });
  });

  it("asks for minHours consecutive hours", () => {
    expect(matchRule(rule({ minHours: 3 }), SAT, () => sat, NOW)).toHaveLength(1);
    expect(matchRule(rule({ minHours: 4 }), SAT, () => sat, NOW)).toHaveLength(0);
    expect(matchRule(rule({ minStars: 5, minHours: 2 }), SAT, () => sat, NOW)).toHaveLength(0);
    expect(matchRule(rule({ minStars: 5, minHours: 1 }), SAT, () => sat, NOW)[0]).toMatchObject({
      start: "2026-10-17T14:00:00.000Z",
      stars: 5,
    });
  });

  it("keeps to the rule's Irish days and hours", () => {
    expect(matchRule(rule({ days: ["sun"] }), SAT, () => sat, NOW)).toEqual([]);
    expect(matchRule(rule({ days: ["sat"] }), SAT, () => sat, NOW)).toHaveLength(1);
    // 15:00–16:00 Irish summer time is 14Z–15Z.
    const [m] = matchRule(rule({ fromHour: 15, toHour: 16, minHours: 1 }), SAT, () => sat, NOW);
    expect([m.start, m.end]).toEqual(["2026-10-17T14:00:00.000Z", "2026-10-17T15:00:00.000Z"]);
  });

  it("looks no further ahead than the lead", () => {
    // Saturday is three days after Wednesday.
    expect(matchRule(rule({ leadDays: 2 }), SAT, () => sat, NOW)).toEqual([]);
    expect(matchRule(rule({ leadDays: 3 }), SAT, () => sat, NOW)).toHaveLength(1);
  });

  it("never rates the night, however good the wind", () => {
    const night = SAT.map((iso) => {
      const hour = Number(iso.slice(11, 13));
      return hour >= 18 || hour < 7 ? dark : rated(1);
    });
    expect(matchRule(rule({ minStars: 1, minHours: 1 }), SAT, () => night, NOW).map((m) => [m.start, m.end])).toEqual([
      ["2026-10-17T07:00:00.000Z", "2026-10-17T18:00:00.000Z"],
    ]);
  });

  it("lets a three-hourly column stand for three hours, and only one before the dark", () => {
    const axis = ["2026-10-17T09:00:00Z", "2026-10-17T12:00:00Z", "2026-10-17T15:00:00Z", "2026-10-17T18:00:00Z"];
    const hours = [rated(1), rated(4), rated(4), dark];
    const [m] = matchRule(rule(), axis, () => hours, NOW);
    expect([m.start, m.end, m.hours]).toEqual(["2026-10-17T12:00:00.000Z", "2026-10-17T16:00:00.000Z", 4]);
  });

  it("gives one window per spot and day, the best, and counts the others", () => {
    const two = day(SAT, {
      "2026-10-17T08": 4,
      "2026-10-17T09": 4,
      "2026-10-17T13": 4,
      "2026-10-17T14": 4,
      "2026-10-17T15": 4,
    });
    const [m, ...rest] = matchRule(rule(), SAT, () => two, NOW);
    expect(rest).toEqual([]);
    expect([m.start, m.hours, m.windows]).toEqual(["2026-10-17T13:00:00.000Z", 3, 2]);
    // More stars beats longer.
    const better = day(SAT, {
      "2026-10-17T08": 5,
      "2026-10-17T09": 5,
      "2026-10-17T13": 4,
      "2026-10-17T14": 4,
      "2026-10-17T15": 4,
    });
    expect(matchRule(rule(), SAT, () => better, NOW)[0]).toMatchObject({
      start: "2026-10-17T08:00:00.000Z",
      stars: 5,
      windows: 2,
    });
  });

  it("splits windows at Irish midnight and lists every spot's, earliest first", () => {
    const weekend = hourly("2026-10-17T00:00:00Z", 48);
    const brandon = day(weekend, { "2026-10-18T10": 4, "2026-10-18T11": 4 });
    const inch = day(weekend, { "2026-10-17T10": 4, "2026-10-17T11": 4 });
    const matches = matchRule(rule({ spots: ["brandon", "inch", "nowhere"], leadDays: 4 }), weekend, (id) =>
      id === "brandon" ? brandon : id === "inch" ? inch : null,
    NOW);
    expect(matches.map((m) => [m.spotId, m.day])).toEqual([
      ["inch", "2026-10-17"],
      ["brandon", "2026-10-18"],
    ]);
  });

  it("drops hours already gone, and keeps the one under way", () => {
    const now = Date.parse("2026-10-17T14:30:00Z");
    const [m] = matchRule(rule({ minHours: 1 }), SAT, () => sat, now);
    expect([m.start, m.hours]).toEqual(["2026-10-17T14:00:00.000Z", 2]);
  });

  it("reads Irish hours on the days the clocks change", () => {
    const spring = hourly("2026-03-29T00:00:00Z", 24);
    const allDay = spring.map((iso) => {
      const hour = Number(iso.slice(11, 13));
      return hour >= 6 && hour < 19 ? rated(4) : dark;
    });
    const sunday = rule({ days: ["sun"], fromHour: 9, toHour: 12 });
    const before = Date.parse("2026-03-27T12:00:00Z");
    expect(matchRule(sunday, spring, () => allDay, before).map((m) => [m.start, m.end])).toEqual([
      ["2026-03-29T08:00:00.000Z", "2026-03-29T11:00:00.000Z"],
    ]);
    const autumn = hourly("2026-10-25T00:00:00Z", 24);
    expect(matchRule(sunday, autumn, () => allDay, Date.parse("2026-10-23T12:00:00Z")).map((m) => [m.start, m.end])).toEqual([
      ["2026-10-25T09:00:00.000Z", "2026-10-25T12:00:00.000Z"],
    ]);
  });

  it("matches nothing for a rule that is off", () => {
    expect(matchRule(rule({ enabled: false }), SAT, () => sat, NOW)).toEqual([]);
  });

  it("names the rider's own wing when they listed one", () => {
    const own = SAT.map((iso) =>
      iso.startsWith("2026-10-17T13") || iso.startsWith("2026-10-17T14")
        ? rated(4, { rating: { stars: 4, wing: { recommended: 4.5, own: 5 } } })
        : dark,
    );
    expect(matchRule(rule(), SAT, () => own, NOW)[0]).toMatchObject({ wing: 5, ownWing: true });
  });
});

describe("dedupe", () => {
  const told = { start: "2026-10-17T13:00:00Z", end: "2026-10-17T16:00:00Z", stars: 4 };
  const shift = (hours: number) => ({
    start: new Date(Date.parse(told.start) + hours * HOUR).toISOString(),
    end: new Date(Date.parse(told.end) + hours * HOUR).toISOString(),
    stars: 4,
  });

  it("keys a notice by rule, spot and Irish day", () => {
    expect(noticeKey({ ruleId: "r1", spotId: "brandon", day: "2026-10-17" })).toBe(
      "r1|brandon|2026-10-17",
    );
  });

  it("calls a window changed when it moves more than two hours or its stars change", () => {
    expect(materiallyChanged(told, shift(0))).toBe(false);
    expect(materiallyChanged(told, shift(2))).toBe(false);
    expect(materiallyChanged(told, shift(-3))).toBe(true);
    expect(materiallyChanged(told, { ...told, end: shift(3).end })).toBe(true);
    expect(materiallyChanged(told, { ...told, stars: 5 })).toBe(true);
  });

  it("signs what a rule asks, not its name, spots or switches", () => {
    const a = rule({ days: ["sat", "sun"] });
    expect(ruleSignature(a)).toBe(ruleSignature({ ...a, days: ["sun", "sat"], name: "x", spots: ["inch"], calledOff: true }));
    expect(ruleSignature(a)).not.toBe(ruleSignature({ ...a, minStars: 3 }));
    expect(ruleSignature(a)).not.toBe(ruleSignature({ ...a, days: [...WEEKDAYS] }));
  });
});
