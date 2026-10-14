import { describe, expect, it } from "vitest";
import {
  DEFAULT_RIDER,
  bestWindow,
  noStarsWhy,
  pickWing,
  rateHour,
  rideableWind,
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
    const rating = rateHour(
      hour({ windKn: 16, gustKn: 19, from: 200 }),
      WEST,
      DEFAULT_RIDER,
    )!;
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
      hour({ from: 270, gustKn: 31 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect(rating.potential).toBe(5);
    expect(rating.stars).toBeLessThan(rating.potential);
    expect(rating.reasons.join(" ")).toMatch(/Onshore.*Gusts to 31 kn/);
  });
  it("rates on the wind alone where the shore is not known", () => {
    expect(
      rateHour(hour({ from: 90 }), { facing: null }, DEFAULT_RIDER)!.stars,
    ).toBe(5);
  });
  it("marks a light, steady day as one for drills", () => {
    const rating = rateHour(
      hour({ windKn: 11, gustKn: 12, from: 200 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect(rating.session).toBe("drills");
    expect(rating.wing.recommended).toBe(7);
  });
  it("lifts a gusty light day toward its gusts: on a foil they get you up", () => {
    // Dublin Bay, 4 Oct 2026: 9 kn gusting 17, cross-shore. Rated nothing
    // when gusts only cost stars; riders were out on big wings all afternoon.
    const gusty = hour({ windKn: 9, gustKn: 17, from: 210 });
    const rating = rateHour(gusty, { facing: 125 }, DEFAULT_RIDER)!;
    expect(rating.rideKn).toBeCloseTo(11.4, 1);
    expect(rating.stars).toBeGreaterThanOrEqual(2);
    expect(rating.reasons).toEqual([]);
    expect(rating.wing.recommended).toBe(8);
    // Steady at the same mean is worth less than gusty.
    expect(
      rateHour(
        hour({ windKn: 9, gustKn: 10, from: 210 }),
        { facing: 125 },
        DEFAULT_RIDER,
      )!.stars,
    ).toBeLessThan(rating.stars);
  });
  it("still costs a learner stars for gusts at any speed", () => {
    const rating = rateHour(
      hour({ windKn: 14, gustKn: 22, from: 200 }),
      WEST,
      rider({ skill: "beginner" }),
    )!;
    expect(rating.stars).toBeLessThan(rating.potential);
    expect(rating.reasons.join(" ")).toMatch(/Gusty/);
  });
  it("costs a star when the gusts pass what the rider can hold", () => {
    const steady = rateHour(
      hour({ windKn: 22, gustKn: 28, from: 200 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    const wild = rateHour(
      hour({ windKn: 22, gustKn: 34, from: 200 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect(wild.stars).toBeLessThan(steady.stars);
    expect(wild.reasons[0]).toMatch(/Gusts to 34 kn/);
  });
  it("treats a gust no stronger than the mean as no gust", () => {
    expect(rideableWind(15, null, DEFAULT_RIDER)).toBe(15);
    expect(rideableWind(15, 14, DEFAULT_RIDER)).toBe(15);
  });
  it("lifts a light day most and a strong one not at all", () => {
    const expert = rider({ skill: "advanced" });
    // At the floor the whole share counts, capped at the mean again.
    expect(rideableWind(8, 40, expert)).toBeCloseTo(10.8, 5);
    expect(rideableWind(28, 40, expert)).toBe(28);
    expect(rideableWind(18, 26, DEFAULT_RIDER) - 18).toBeLessThan(
      rideableWind(10, 18, DEFAULT_RIDER) - 10,
    );
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
  it("says so when models that differ a little cost a star, and only then", () => {
    const rate = (windKn: number, agreement: HourInput["agreement"]) =>
      rateHour(
        hour({ windKn, gustKn: windKn, from: 200, agreement }),
        WEST,
        DEFAULT_RIDER,
      )!;
    const winds = Array.from({ length: 81 }, (_, i) => 8 + i * 0.25);
    const tipped = winds.find(
      (kn) => rate(kn, "moderate").stars < rate(kn, "high").stars,
    );
    const held = winds.find(
      (kn) => rate(kn, "moderate").stars === rate(kn, "high").stars,
    );
    expect(tipped).toBeDefined();
    expect(held).toBeDefined();
    expect(rate(tipped!, "moderate").reasons).toContain(
      "The models differ a little, enough to hold back a star.",
    );
    expect(rate(held!, "moderate").reasons).toEqual(
      rate(held!, "high").reasons,
    );
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

describe("noStarsWhy", () => {
  it("names only the plain reasons an hour has no stars", () => {
    expect(noStarsWhy({ session: "too-light" })).toBe("too light");
    expect(noStarsWhy({ session: "too-strong" })).toBe("too strong");
    expect(noStarsWhy({ session: "offshore" })).toBe("offshore");
    expect(noStarsWhy({ session: "pump" })).toBeNull();
    expect(noStarsWhy({ session: "cruising" })).toBeNull();
  });
});
