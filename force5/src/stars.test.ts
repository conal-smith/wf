import { describe, expect, it } from "vitest";
import {
  DEFAULT_RIDER,
  bestWindow,
  pickWing,
  rateHour,
  shoreAngle,
  starsText,
  windBand,
  windScore,
  wingSize,
  type HourInput,
  type HourRating,
  type Rider,
} from "./stars";

const hour = (over: Partial<HourInput> = {}): HourInput => ({
  windKn: 18,
  gustKn: 22,
  from: 270,
  agreement: "high",
  daylight: true,
  ...over,
});
// A west-facing beach: westerly is onshore, southerly or northerly cross-shore.
const WEST = { facing: 270 };
const rider = (over: Partial<Rider> = {}): Rider => ({
  ...DEFAULT_RIDER,
  ...over,
});

describe("wing size", () => {
  it("follows the size charts for an 80 kg intermediate", () => {
    expect(wingSize(DEFAULT_RIDER, 12)).toBe(6.5);
    expect(wingSize(DEFAULT_RIDER, 15)).toBe(5.5);
    expect(wingSize(DEFAULT_RIDER, 20)).toBe(4.5);
    expect(wingSize(DEFAULT_RIDER, 30)).toBe(3);
  });
  it("goes up with weight and down with wind, within real sizes", () => {
    expect(wingSize(rider({ weightKg: 100 }), 15)).toBeGreaterThan(
      wingSize(rider({ weightKg: 60 }), 15),
    );
    expect(wingSize(DEFAULT_RIDER, 4)).toBe(8);
    expect(wingSize(DEFAULT_RIDER, 60)).toBe(2);
  });
  it("gives a beginner a bigger wing than an advanced rider", () => {
    expect(wingSize(rider({ skill: "beginner" }), 16)).toBeGreaterThan(
      wingSize(rider({ skill: "advanced" }), 16),
    );
  });
  it("picks from the rider's own quiver, a touch big rather than too small", () => {
    const quiver = rider({ wings: [3, 4, 5, 6] });
    expect(pickWing(quiver, 15)).toEqual({
      recommended: 5.5,
      own: 5,
      fit: "fits",
    });
    expect(pickWing(rider({ wings: [3] }), 12).fit).toBe("underpowered");
    expect(pickWing(rider({ wings: [6] }), 30).fit).toBe("overpowered");
    expect(pickWing(DEFAULT_RIDER, 15).own).toBeNull();
  });
});

describe("wind band", () => {
  it("assumes 80 kg when the rider has not said", () => {
    expect(windBand(DEFAULT_RIDER)).toEqual(windBand(rider({ weightKg: 80 })));
  });
  it("needs more wind to get a heavier rider going", () => {
    expect(windBand(rider({ weightKg: 100 })).min).toBeGreaterThan(
      windBand(rider({ weightKg: 60 })).min,
    );
  });
  it("scores the sweet spot highest and nothing when it is flat", () => {
    const band = windBand(DEFAULT_RIDER);
    expect(windScore(19, band)).toBe(5);
    expect(windScore(5, band)).toBe(0);
    expect(windScore(40, band)).toBe(0);
    expect(windScore(12, band)).toBeGreaterThan(1);
    expect(windScore(12, band)).toBeLessThan(4);
  });
});

describe("shore angle", () => {
  it("reads the wind against the way the shore faces", () => {
    expect(shoreAngle(270, 270)).toBe("onshore");
    expect(shoreAngle(225, 270)).toBe("cross-on");
    expect(shoreAngle(180, 270)).toBe("cross");
    expect(shoreAngle(135, 270)).toBe("cross-off");
    expect(shoreAngle(90, 270)).toBe("offshore");
    // Across north without a seam.
    expect(shoreAngle(350, 10)).toBe("onshore");
    expect(shoreAngle(190, 10)).toBe("offshore");
  });
});

describe("hour rating", () => {
  it("gives a steady cross-shore breeze in the sweet spot five stars", () => {
    const rating = rateHour(hour({ from: 200 }), WEST, DEFAULT_RIDER)!;
    expect(rating).toMatchObject({
      stars: 5,
      potential: 5,
      shore: "cross",
      session: "cruising",
    });
    expect(rating.reasons).toEqual([]);
  });
  it("never lets an offshore hour look good, and says why", () => {
    const rating = rateHour(hour({ from: 90 }), WEST, DEFAULT_RIDER)!;
    expect(rating.stars).toBeLessThanOrEqual(1);
    expect(rating.potential).toBe(5);
    expect(rating.session).toBe("offshore");
    expect(rating.reasons[0]).toMatch(/Offshore/);
    expect(
      rateHour(hour({ from: 90 }), WEST, rider({ skill: "beginner" }))!.stars,
    ).toBe(0);
  });
  it("keeps the wind's worth as faded stars when the spot takes some away", () => {
    const rating = rateHour(
      hour({ from: 270, gustKn: 30 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect(rating.potential).toBe(5);
    expect(rating.stars).toBeLessThan(rating.potential);
    expect(rating.reasons.join(" ")).toMatch(/Onshore.*Gusty/);
  });
  it("rates on the wind alone where the shore is not known", () => {
    expect(
      rateHour(hour({ from: 90 }), { facing: null }, DEFAULT_RIDER)!.stars,
    ).toBe(5);
  });
  it("marks a light, steady day as one for drills", () => {
    const rating = rateHour(
      hour({ windKn: 12, gustKn: 14, from: 200 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect(rating.session).toBe("drills");
    expect(rating.wing.recommended).toBe(6.5);
  });
  it("takes a star when the models disagree", () => {
    const agreed = rateHour(hour({ from: 200 }), WEST, DEFAULT_RIDER)!;
    const split = rateHour(
      hour({ from: 200, agreement: "low" }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect(split.stars).toBe(agreed.stars - 1);
  });
  it("does not rate the dark or a missing reading", () => {
    expect(rateHour(hour({ daylight: false }), WEST, DEFAULT_RIDER)).toBeNull();
    expect(rateHour(hour({ windKn: null }), WEST, DEFAULT_RIDER)).toBeNull();
  });
  it("rates the same wind lower for a rider whose quiver does not fit", () => {
    const light = hour({ windKn: 13, gustKn: 15, from: 200 });
    expect(rateHour(light, WEST, rider({ wings: [3] }))!.stars).toBeLessThan(
      rateHour(light, WEST, rider({ wings: [6] }))!.stars,
    );
  });
  it("reads as words for a screen reader", () => {
    expect(starsText({ stars: 3, potential: 4 })).toBe(
      "3 of 5 stars, 4 possible",
    );
    expect(starsText({ stars: 1, potential: 1 })).toBe("1 of 5 star");
  });
});

describe("best window", () => {
  const r = (stars: number) => ({ stars }) as HourRating;
  it("finds the longest run at the highest level two columns reach", () => {
    expect(
      bestWindow([r(2), r(4), r(4), r(3), r(4), r(5), r(4), null]),
    ).toEqual({ from: 4, to: 6, stars: 4 });
  });
  it("takes the sooner of two equal windows", () => {
    expect(bestWindow([r(4), r(4), r(1), r(4), r(4)])).toEqual({
      from: 0,
      to: 1,
      stars: 4,
    });
  });
  it("is null when nothing holds a star for two columns", () => {
    expect(bestWindow([r(0), r(3), r(0), null])).toBeNull();
  });
});
