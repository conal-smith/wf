import { describe, expect, it } from "vitest";
import {
  DEFAULT_RIDER,
  bestWindow,
  gustCost,
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
  it("gives a light day with big gusts one star: a chance to get up, no more", () => {
    // Dublin Bay, 4 Oct 2026: 9 kn gusting 17, cross-shore, riders out on big
    // wings. The gusts lift it to the floor, never past it.
    const gusty = hour({ windKn: 9, gustKn: 17, from: 210 });
    const rating = rateHour(gusty, { facing: 125 }, DEFAULT_RIDER)!;
    expect(rating.rideKn).toBe(11);
    expect(rating.stars).toBe(1);
    expect(rating.reasons).toEqual([]);
    expect(rating.wing.recommended).toBe(8);
    // Steady at the same mean is not even that.
    expect(
      rateHour(
        hour({ windKn: 9, gustKn: 10, from: 210 }),
        { facing: 125 },
        DEFAULT_RIDER,
      )!.stars,
    ).toBe(0);
  });
  it("rates the mean, not the gusts: 12 gusting 20 is a light day", () => {
    const rating = rateHour(
      hour({ windKn: 12, gustKn: 20, from: 200 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect(rating.rideKn).toBe(12);
    expect(rating.stars).toBe(2);
  });
  it("takes an ordinary gust in its stride", () => {
    // The models' gust is the hour's strongest: 8 or 9 knots over is usual.
    const stars = [24, 27, 28].map(
      (gustKn) =>
        rateHour(hour({ gustKn, from: 200 }), WEST, DEFAULT_RIDER)!.stars,
    );
    expect(stars).toEqual([5, 5, 5]);
  });
  it("costs half a star a knot once the gusts run more than ten over", () => {
    expect(gustCost(18, 28, DEFAULT_RIDER)!.gustiness).toBe(0);
    expect(gustCost(18, 31, DEFAULT_RIDER)!.gustiness).toBe(1.5);
    expect(gustCost(10, 40, DEFAULT_RIDER)!.gustiness).toBe(2);
    const rating = rateHour(
      hour({ windKn: 15, gustKn: 27, from: 200 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect(rating.stars).toBe(3);
    expect(rating.reasons.join(" ")).toMatch(/Gusty: gusts 27 kn on a 15 kn/);
  });
  it("lets a learner take less of a spread", () => {
    const learner = rider({ skill: "beginner" });
    expect(gustCost(16, 22, learner)!.gustiness).toBe(0);
    expect(gustCost(16, 25, learner)!.gustiness).toBe(1);
    const rating = rateHour(
      hour({ windKn: 16, gustKn: 25, from: 200 }),
      WEST,
      learner,
    )!;
    expect(rating.stars).toBeLessThan(rating.potential);
    expect(rating.reasons.join(" ")).toMatch(/Gusty/);
  });
  it("costs a little more when the gusts pass what the rider can hold", () => {
    const steady = rateHour(
      hour({ windKn: 22, gustKn: 28, from: 200 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    const past = rateHour(
      hour({ windKn: 22, gustKn: 32, from: 200 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect(steady.stars).toBe(5);
    expect(past.stars).toBe(4);
    expect(past.reasons).toEqual([
      "Gusts to 32 kn: more than you will want to hold.",
    ]);
  });
  it("rates a strong, gusty wind low but not as nothing", () => {
    const strong = hour({ windKn: 25, gustKn: 38, from: 200 });
    expect(rateHour(strong, WEST, DEFAULT_RIDER)!.stars).toBe(2);
    expect(rateHour(strong, WEST, rider({ skill: "advanced" }))!.stars).toBe(3);
  });
  it("names the gusts only when they cost a star", () => {
    const rating = rateHour(
      hour({ windKn: 18, gustKn: 29, from: 200 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect(rating.stars).toBe(5);
    expect(rating.reasons).toEqual([]);
  });
  it("treats a gust no stronger than the mean as no gust", () => {
    expect(rideableWind(15, null, DEFAULT_RIDER)).toBe(15);
    expect(rideableWind(15, 14, DEFAULT_RIDER)).toBe(15);
  });
  it("never lifts a wind past the floor, nor one already over it", () => {
    const expert = rider({ skill: "advanced" });
    expect(rideableWind(6, 40, expert)).toBe(8);
    expect(rideableWind(7, 9, expert)).toBeCloseTo(7.7, 5);
    expect(rideableWind(14, 24, DEFAULT_RIDER)).toBe(14);
    expect(rideableWind(28, 40, expert)).toBe(28);
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
