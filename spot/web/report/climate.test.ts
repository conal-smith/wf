import { describe, expect, it } from "vitest";
import {
  climatePath,
  daysFigure,
  daysWords,
  metresWords,
  niceScale,
  parseClimate,
  percent,
} from "./climate";

const row = (n: number, v = 1) => Array.from({ length: n }, () => v);
const wind = {
  at: [53.4, -6.1],
  years: [2007, 2026],
  months: Array.from({ length: 12 }, () => [200, 150, 50, 5]),
  rose: Array.from({ length: 16 }, () => [10, 8, 4, 1]),
};
const waves = {
  at: [53.49, -6.06],
  km: 3.4,
  years: [2000, 2026],
  height: Array.from({ length: 12 }, () => [0.2, 0.6, 1.4]),
  rose: Array.from({ length: 16 }, () => [5, 4, 3, 1]),
  swell: Array.from({ length: 4 }, () => Array.from({ length: 3 }, () => row(12, 2.5))),
  candles: Array.from({ length: 3 }, () =>
    Array.from({ length: 12 }, (_, m) => (m === 6 ? [0, null, null, null] : [3.2, 0.3, 0.6, 1.1])),
  ),
};

describe("parseClimate", () => {
  it("reads a sea spot's file whole", () => {
    const c = parseClimate({ id: "donabate", credit: "x", wind, waves });
    expect(c?.id).toBe("donabate");
    expect(c?.waves?.km).toBe(3.4);
    expect(c?.waves?.candles[0][6][1]).toBeNull();
  });

  it("keeps the wind and drops waves that do not add up", () => {
    const c = parseClimate({ id: "keel-lake", wind, waves: { ...waves, swell: [] } });
    expect(c?.wind.months).toHaveLength(12);
    expect(c?.waves).toBeUndefined();
  });

  it("reads a lake's file, which has no waves", () => {
    expect(parseClimate({ id: "blessington", wind })?.waves).toBeUndefined();
  });

  it("refuses what is not one: the host's page for a missing file, or a short month list", () => {
    expect(parseClimate("<!doctype html>")).toBeNull();
    expect(parseClimate(null)).toBeNull();
    expect(parseClimate({ id: "x", wind: { ...wind, months: wind.months.slice(1) } })).toBeNull();
    expect(parseClimate({ id: "x", wind: { ...wind, rose: [[1, 2, 3, "4"]] } })).toBeNull();
  });
});

describe("words", () => {
  it("says a share of the time plainly", () => {
    expect(percent(0)).toBe("none");
    expect(percent(0.003)).toBe("under 1%");
    expect(percent(0.384)).toBe("38%");
  });

  it("says days a month plainly, and the rare ones as years", () => {
    expect(daysWords(0)).toBe("none");
    expect(daysWords(0.04)).toBe("1 day in 2 years");
    expect(daysWords(0.01)).toBe("1 day in 8 years");
    expect(daysWords(0.9)).toBe("1 day");
    expect(daysWords(12.4)).toBe("12 days");
  });

  it("writes the figure above a candle", () => {
    expect(daysFigure(0)).toBe("");
    expect(daysFigure(0.2)).toBe("<1");
    expect(daysFigure(0.6)).toBe("1");
    expect(daysFigure(22.6)).toBe("23");
  });

  it("gives heights in metres and feet", () => {
    expect(metresWords(1.37)).toBe("1.4 m (4 ft)");
  });

  it("finds a tidy scale", () => {
    expect(niceScale(2.66)).toEqual({ step: 1, top: 3 });
    expect(niceScale(24.7)).toEqual({ step: 10, top: 30 });
    expect(niceScale(0.9)).toEqual({ step: 0.25, top: 1 });
  });

  it("names each spot's file", () => {
    expect(climatePath("portrush")).toBe("climate/portrush.json");
  });
});
