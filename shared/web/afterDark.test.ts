import { describe, expect, it } from "vitest";
import { sunTimes } from "../../force5/src/sun";
import { afterDark, fold, keptShares, keptSpans, unfolded } from "./afterDark";

const HOUR = 3600000;
const DUBLIN = { lat: 53.35, lon: -6.26 };

/** Every hour from one instant to another, UTC. */
const hourly = (from: string, to: string) => {
  const out: number[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += HOUR) out.push(t);
  return out;
};

/** First and last light on a UTC day at Dublin. */
const light = (date: string) => {
  const sun = sunTimes(DUBLIN.lat, DUBLIN.lon, new Date(`${date}T12:00:00Z`));
  return { first: sun.civilDawn!.getTime(), last: sun.civilDusk!.getTime() };
};

describe("the hours after dark", () => {
  it("are those from last light to first, across the autumn clock change", () => {
    // Sunday 25 October 2026: Irish time goes back an hour at 02:00 IST.
    const times = hourly("2026-10-24T12:00:00Z", "2026-10-26T12:00:00Z");
    const dark = afterDark(DUBLIN, times);
    for (const date of ["2026-10-24", "2026-10-25", "2026-10-26"]) {
      const { first, last } = light(date);
      times.forEach((time, at) => {
        if (new Date(time).toISOString().slice(0, 10) !== date) return;
        expect(dark[at]).toBe(time < first || time >= last);
      });
    }
    // The small hours of the clock change are dark, midday is not.
    expect(dark[times.indexOf(Date.parse("2026-10-25T01:00:00Z"))]).toBe(true);
    expect(dark[times.indexOf(Date.parse("2026-10-25T12:00:00Z"))]).toBe(false);
    // The last time asked about is not cut short: its night runs on past it.
    expect(afterDark(DUBLIN, [Date.parse("2026-10-25T23:00:00Z")])).toEqual([
      true,
    ]);
  });

  it("move with the spring clock change too, the light an hour later by the clock", () => {
    // Sunday 29 March 2026: Irish time goes forward at 01:00 GMT.
    const times = hourly("2026-03-28T00:00:00Z", "2026-03-30T00:00:00Z");
    const dark = afterDark(DUBLIN, times);
    const kept = times.filter((_, at) => !dark[at]);
    // Each day keeps the same daylight in UTC, the clock change or not.
    const perDay = (date: string) =>
      kept.filter((t) => new Date(t).toISOString().startsWith(date)).length;
    expect(perDay("2026-03-28")).toBe(perDay("2026-03-29"));
    expect(perDay("2026-03-29")).toBeGreaterThanOrEqual(12);
  });

  it("join what is left into stretches, a day each", () => {
    const times = hourly("2026-10-24T00:00:00Z", "2026-10-26T23:00:00Z");
    const dark = afterDark(DUBLIN, times);
    const spans = keptSpans(
      times.map((time) => ({ time, step: 1 })),
      dark,
    );
    expect(spans).toHaveLength(3);
    for (const span of spans) {
      const { first, last } = light(
        new Date(span.from).toISOString().slice(0, 10),
      );
      // From the first hour at or after first light to the end of the last
      // hour that starts before last light.
      expect(span.from).toBeGreaterThanOrEqual(first);
      expect(span.from - first).toBeLessThan(HOUR);
      expect(span.to).toBeGreaterThan(last);
      expect(span.to - last).toBeLessThanOrEqual(HOUR);
    }
  });

  it("take each step's own length, three-hourly further out", () => {
    const at = Date.parse("2026-10-30T00:00:00Z");
    const times = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => at + h * HOUR);
    // As points on a curve, each its share of the line either side of it.
    expect(
      keptShares([at, at + HOUR, at + 4 * HOUR], [false, false, false]),
    ).toEqual([{ from: at - HOUR / 2, to: at + 5.5 * HOUR }]);
    expect(
      keptShares(
        [at, at + HOUR, at + 4 * HOUR, at + 7 * HOUR],
        [false, true, false, false],
      ),
    ).toEqual([
      { from: at - HOUR / 2, to: at + HOUR / 2 },
      { from: at + 2.5 * HOUR, to: at + 8.5 * HOUR },
    ]);
    const spans = keptSpans(
      times.map((time) => ({ time, step: 3 })),
      [true, true, true, false, false, false, true, true],
    );
    expect(spans).toEqual([{ from: at + 9 * HOUR, to: at + 18 * HOUR }]);
  });
});

describe("a fold", () => {
  const day = (h0: number, h1: number) => ({ from: h0 * HOUR, to: h1 * HOUR });
  // Two days, 08:00 to 17:00 and 32:00 (08:00 the next) to 41:00.
  const f = fold([day(8, 17), day(32, 41)]);

  it("joins the kept stretches end to end", () => {
    expect(f.length).toBe(18 * HOUR);
    expect(f.joins).toEqual([9 * HOUR]);
    expect(f.at(8 * HOUR)).toBe(0);
    expect(f.at(12 * HOUR)).toBe(4 * HOUR);
    expect(f.at(32 * HOUR)).toBe(9 * HOUR);
    expect(f.at(40 * HOUR)).toBe(17 * HOUR);
  });

  it("puts a time after dark at the next first light", () => {
    expect(f.at(20 * HOUR)).toBe(9 * HOUR);
    expect(f.time(f.at(20 * HOUR))).toBe(32 * HOUR);
    expect(f.kept(20 * HOUR)).toBe(false);
    expect(f.kept(16.5 * HOUR)).toBe(true);
    expect(f.kept(17 * HOUR)).toBe(false);
  });

  it("goes back to the same times, never into the night", () => {
    for (const h of [8, 9.5, 16.99, 32, 35, 40.5])
      expect(f.time(f.at(h * HOUR))).toBeCloseTo(h * HOUR, 0);
    for (let at = 0; at < f.length; at += HOUR / 4)
      expect(f.kept(f.time(at))).toBe(true);
  });

  it("hides either side of the kept stretches too, or runs on straight", () => {
    expect(f.at(6 * HOUR)).toBe(0);
    expect(f.time(-2 * HOUR)).toBe(8 * HOUR);
    expect(f.at(43 * HOUR)).toBe(18 * HOUR);
    expect(f.time(20 * HOUR)).toBe(41 * HOUR);
    const run = fold([day(8, 17), day(32, 41)], "run");
    expect(run.at(6 * HOUR)).toBe(-2 * HOUR);
    expect(run.time(-2 * HOUR)).toBe(6 * HOUR);
    expect(run.at(43 * HOUR)).toBe(20 * HOUR);
    expect(run.time(20 * HOUR)).toBe(43 * HOUR);
  });

  it("is the plain timeline with nothing taken out", () => {
    const plain = unfolded(10 * HOUR, 30 * HOUR);
    expect(plain.joins).toEqual([]);
    expect(plain.at(15 * HOUR)).toBe(5 * HOUR);
    expect(plain.time(5 * HOUR)).toBe(15 * HOUR);
    expect(plain.length).toBe(20 * HOUR);
  });
});
