import { describe, expect, it } from "vitest";
import {
  CUSTOM_RATING_VERSION,
  DEFAULT_RIDER,
  SKILLS,
  bestWindow,
  directionCosts,
  gustCurve,
  gustLoss,
  noStarsWhy,
  parseCustomRating,
  pickWing,
  rateHour,
  rideableWind,
  sameCustomRating,
  shoreAngle,
  standardRating,
  starsText,
  windBand,
  windScore,
  wingSize,
  type CustomRating,
  type HourInput,
  type HourRating,
  type Rider,
  type Skill,
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
  it("takes offshore off like any other direction, and says why", () => {
    const rating = rateHour(hour({ from: 90 }), WEST, DEFAULT_RIDER)!;
    expect(rating.stars).toBe(1);
    expect(rating.potential).toBe(5);
    expect(rating.session).toBe("offshore");
    expect(rating.reasons[0]).toMatch(/Offshore/);
    expect(
      rateHour(hour({ from: 90 }), WEST, rider({ skill: "beginner" }))!.stars,
    ).toBe(0);
  });
  it("keeps the wind's worth as faded stars when the spot takes some away", () => {
    const rating = rateHour(
      hour({ from: 270, gustKn: 34 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect(rating.potential).toBe(5);
    expect(rating.stars).toBe(3);
    expect(rating.reasons).toEqual([
      "Onshore: slow to get out through the chop.",
      "Gusts to 34 kn: more than you will want to hold.",
    ]);
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

// The owner's calibration, and the mockup's levels (design-system/patterns/
// your-stars.html): an 80 kg rider, cross-onshore, no wings listed, the models
// agreeing. [wind, gust, stars, potential].
const CALIBRATION: Record<Skill, [number, number, number, number][]> = {
  intermediate: [
    [9, 17, 1, 1],
    [12, 20, 2, 2],
    [15, 27, 4, 4],
    [18, 24, 5, 5],
    [18, 27, 5, 5],
    [22, 32, 4, 5],
    [25, 38, 2, 4],
  ],
  beginner: [
    [9, 17, 0, 0],
    [10, 16, 0, 0],
    [12, 20, 1, 1],
    [15, 22, 3, 4],
    [15, 27, 1, 4],
    [18, 24, 4, 5],
    [18, 27, 2, 5],
    [22, 32, 0, 3],
    [25, 38, 0, 2],
  ],
  advanced: [
    [9, 17, 2, 2],
    [10, 16, 2, 2],
    [12, 20, 3, 3],
    [15, 22, 5, 5],
    [15, 27, 5, 5],
    [18, 24, 5, 5],
    [18, 27, 5, 5],
    [22, 32, 5, 5],
    [25, 38, 4, 5],
  ],
};
// A west-facing beach: wind from 225 is cross-onshore.
const CROSS_ON = 225;

describe("the calibration", () => {
  for (const skill of SKILLS)
    for (const [windKn, gustKn, stars, potential] of CALIBRATION[skill])
      it(`rates ${windKn} gusting ${gustKn} as ${stars} for ${skill}`, () => {
        const rating = rateHour(
          hour({ windKn, gustKn, from: CROSS_ON }),
          WEST,
          rider({ skill }),
        )!;
        expect(rating.shore).toBe("cross-on");
        expect([rating.stars, rating.potential]).toEqual([stars, potential]);
      });

  // 18 gusting 24 from each way round the beach: [onshore, cross, cross-off, offshore].
  const AROUND: Record<Skill, number[]> = {
    beginner: [3, 3, 1, 0],
    intermediate: [4, 5, 4, 1],
    advanced: [4, 5, 4, 1],
  };
  for (const skill of SKILLS)
    it(`rates 18 gusting 24 round the beach for ${skill}`, () => {
      const stars = [270, 180, 135, 90].map(
        (from) =>
          rateHour(
            hour({ windKn: 18, gustKn: 24, from }),
            WEST,
            rider({ skill }),
          )!.stars,
      );
      expect(stars).toEqual(AROUND[skill]);
    });
});

describe("gusts, by how strong they are", () => {
  it("cost nothing up to the level's fine, ramp to the most at its worst, and no more", () => {
    const curves: Record<Skill, [number, number, number]> = {
      beginner: [20, 28, 3],
      intermediate: [28, 40, 2],
      advanced: [33, 45, 2],
    };
    for (const skill of SKILLS) {
      const [fine, worst, most] = curves[skill];
      const curve = gustCurve(rider({ skill }));
      expect(curve).toEqual({ fine, worst, most });
      expect(gustLoss(fine, curve)).toBe(0);
      expect(gustLoss((fine + worst) / 2, curve)).toBeCloseTo(most / 2, 9);
      expect(gustLoss(worst, curve)).toBe(most);
      expect(gustLoss(worst + 20, curve)).toBe(most);
      expect(gustLoss(null, curve)).toBe(0);
    }
  });
  it("do not care how far the gust runs over the mean, only how strong it is", () => {
    // 10 kn over at 14 kn costs nothing; 6 kn over at 30 kn does.
    expect(gustLoss(24, gustCurve(DEFAULT_RIDER))).toBe(0);
    expect(gustLoss(36, gustCurve(DEFAULT_RIDER))).toBeCloseTo(4 / 3, 9);
  });
  it("let a heavier rider hold a little more, as the top of the band does", () => {
    const heavy = rider({ weightKg: 125 });
    const scale = (125 / 80) ** 0.25;
    expect(gustCurve(heavy).fine).toBeCloseTo(28 * scale, 9);
    expect(gustCurve(heavy).worst).toBeCloseTo(40 * scale, 9);
    expect(gustCurve(heavy).most).toBe(2);
    expect(windBand(heavy).max).toBeCloseTo(30 * scale, 9);
  });
  it("are named only when they cost a whole star", () => {
    const gentle = rateHour(
      hour({ windKn: 18, gustKn: 31, from: 200 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect(gentle.stars).toBe(5);
    expect(gentle.reasons).toEqual([]);
    const strong = rateHour(
      hour({ windKn: 22, gustKn: 32, from: 200 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect(strong.stars).toBe(4);
    expect(strong.reasons).toEqual([
      "Gusts to 32 kn: more than you will want to hold.",
    ]);
  });
});

describe("direction", () => {
  it("costs each level its own stars for each way the wind meets the beach", () => {
    expect(directionCosts(rider({ skill: "beginner" }))).toEqual({
      onshore: 1,
      crossOn: 0,
      cross: 0.5,
      crossOff: 3,
      offshore: 5,
    });
    expect(directionCosts(DEFAULT_RIDER)).toEqual({
      onshore: 1,
      crossOn: 0,
      cross: 0,
      crossOff: 1.5,
      offshore: 4,
    });
    expect(directionCosts(rider({ skill: "advanced" }))).toEqual({
      onshore: 1,
      crossOn: 0,
      cross: 0,
      crossOff: 1,
      offshore: 4,
    });
  });
  it("names a direction only when it costs a whole star", () => {
    // A learner's half star for cross-shore, on an hour where it does not show.
    const learner = rider({ skill: "beginner" });
    const rating = rateHour(
      hour({ windKn: 17, gustKn: 19, from: 180 }),
      WEST,
      learner,
    )!;
    expect(rating.stars).toBe(5);
    expect(rating.reasons).toEqual([]);
  });
  it("says offshore only when offshore is what cost the stars", () => {
    const light = rateHour(
      hour({ windKn: 5, gustKn: 7, from: 90 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect(light.stars).toBe(0);
    expect(light.session).toBe("too-light");
    expect(light.reasons).toEqual([]);
  });
});

const CUSTOM: CustomRating = {
  version: CUSTOM_RATING_VERSION,
  base: "intermediate",
  wind: { min: 15, sweetLow: 18, sweetHigh: 23, max: 27 },
  gust: { fine: 24, worst: 30, most: 3 },
  direction: { onshore: 0.5, crossOn: 0, cross: 0, crossOff: 2.5, offshore: 4 },
};

describe("a custom rating", () => {
  const own = (over: Partial<Rider> = {}) => rider({ custom: CUSTOM, ...over });
  const rate = (r: Rider, windKn: number, gustKn: number, from = CROSS_ON) => {
    const rating = rateHour(hour({ windKn, gustKn, from }), WEST, r)!;
    return [rating.stars, rating.potential];
  };

  it("rates the mockup's rider who wants about 20 knots, and no gusts much over 25", () => {
    // design-system/patterns/your-stars.html, the desktop dialog's "Yours".
    expect(rate(own(), 12, 20)).toEqual([1, 1]);
    expect(rate(own(), 15, 22)).toEqual([1, 1]);
    expect(rate(own(), 18, 24)).toEqual([4, 4]);
    expect(rate(own(), 18, 27)).toEqual([3, 4]);
    expect(rate(own(), 22, 32)).toEqual([2, 5]);
    expect(rate(own(), 25, 38)).toEqual([0, 3]);
    expect(rate(own(), 18, 24, 270)).toEqual([4, 4]);
    expect(rate(own(), 18, 24, 135)).toEqual([2, 4]);
    expect(rate(own(), 18, 24, 90)).toEqual([0, 4]);
  });
  it("replaces the band, the gusts and the directions, whatever the weight", () => {
    for (const weightKg of [null, 55, 120]) {
      const r = own({ weightKg });
      expect(windBand(r)).toEqual(CUSTOM.wind);
      expect(gustCurve(r)).toEqual(CUSTOM.gust);
      expect(directionCosts(r)).toEqual(CUSTOM.direction);
    }
  });
  it("replaces the level the rider has set, too", () => {
    expect(rate(own({ skill: "beginner" }), 22, 32)).toEqual(
      rate(own({ skill: "advanced" }), 22, 32),
    );
  });
  it("keeps its base level's share of a gust below the floor and its wing sizes", () => {
    const learner = own({ custom: { ...CUSTOM, base: "beginner" } });
    const expert = own({ custom: { ...CUSTOM, base: "advanced" } });
    // 12 gusting 20 under a 15 kn floor: 12 + share × 8.
    expect(rideableWind(12, 20, learner)).toBeCloseTo(13.6, 9);
    expect(rideableWind(12, 20, expert)).toBeCloseTo(14.8, 9);
    expect(wingSize(learner, 16)).toBe(
      wingSize(rider({ skill: "beginner" }), 16),
    );
    expect(wingSize(expert, 16)).toBe(
      wingSize(rider({ skill: "advanced" }), 16),
    );
  });
  it("can let offshore cost nothing at all", () => {
    const fearless = own({
      custom: { ...CUSTOM, direction: { ...CUSTOM.direction, offshore: 0 } },
    });
    const rating = rateHour(
      hour({ windKn: 20, gustKn: 22, from: 90 }),
      WEST,
      fearless,
    )!;
    expect(rating.stars).toBe(5);
    expect(rating.session).not.toBe("offshore");
    expect(rating.reasons).toEqual([]);
  });
  it("can take all five stars off for a direction", () => {
    const careful = own({
      custom: { ...CUSTOM, direction: { ...CUSTOM.direction, onshore: 5 } },
    });
    expect(rate(careful, 20, 22, 270)).toEqual([0, 5]);
  });
  it("is what standardRating gives back for a level, rating as the level does", () => {
    for (const skill of SKILLS)
      for (const weightKg of [null, 80]) {
        const plain = rider({ skill, weightKg });
        const saved = rider({ skill, weightKg, custom: standardRating(plain) });
        for (let windKn = 4; windKn <= 36; windKn += 1)
          for (const gustKn of [windKn, windKn + 6, windKn + 12])
            for (const from of [270, 225, 180, 135, 90])
              expect(rate(saved, windKn, gustKn, from)).toEqual(
                rate(plain, windKn, gustKn, from),
              );
      }
  });
  it("starts from a heavier rider's own band, to the tenth of a knot", () => {
    const heavy = rider({ weightKg: 120 });
    const start = standardRating(heavy);
    expect(start.wind.min).toBeCloseTo(windBand(heavy).min, 1);
    expect(start.gust.worst).toBeCloseTo(gustCurve(heavy).worst, 1);
    expect(start.base).toBe("intermediate");
    expect(standardRating(heavy, "advanced").base).toBe("advanced");
  });
});

describe("a custom rating, read and made safe", () => {
  it("takes a good one as it is", () => {
    expect(parseCustomRating(CUSTOM)).toEqual(CUSTOM);
    expect(parseCustomRating(JSON.parse(JSON.stringify(CUSTOM)))).toEqual(
      CUSTOM,
    );
  });
  it("drops another version, a missing field, a word for a number or no level", () => {
    expect(parseCustomRating({ ...CUSTOM, version: 2 })).toBeNull();
    expect(parseCustomRating({ ...CUSTOM, version: undefined })).toBeNull();
    expect(parseCustomRating({ ...CUSTOM, base: "pro" })).toBeNull();
    expect(
      parseCustomRating({ ...CUSTOM, wind: { ...CUSTOM.wind, max: "27" } }),
    ).toBeNull();
    expect(
      parseCustomRating({ ...CUSTOM, gust: { fine: 24, worst: 30 } }),
    ).toBeNull();
    expect(
      parseCustomRating({
        ...CUSTOM,
        direction: { ...CUSTOM.direction, offshore: Number.NaN },
      }),
    ).toBeNull();
    expect(parseCustomRating(null)).toBeNull();
    expect(parseCustomRating("custom")).toBeNull();
  });
  it("puts the wind handles in order, a knot apart, within 2 to 40", () => {
    const wind = (w: CustomRating["wind"]) =>
      parseCustomRating({ ...CUSTOM, wind: w })!.wind;
    expect(wind({ min: 20, sweetLow: 18, sweetHigh: 18, max: 10 })).toEqual({
      min: 20,
      sweetLow: 21,
      sweetHigh: 22,
      max: 23,
    });
    expect(wind({ min: 0, sweetLow: 0, sweetHigh: 60, max: 90 })).toEqual({
      min: 2,
      sweetLow: 3,
      sweetHigh: 39,
      max: 40,
    });
    expect(wind({ min: 45, sweetLow: 45, sweetHigh: 45, max: 45 })).toEqual({
      min: 37,
      sweetLow: 38,
      sweetHigh: 39,
      max: 40,
    });
    expect(
      wind({ min: 12.345, sweetLow: 13.01, sweetHigh: 20, max: 26 }),
    ).toEqual({ min: 12.3, sweetLow: 13.3, sweetHigh: 20, max: 26 });
  });
  it("keeps the gusts' no-effect a knot under their most-off, within 1 to 50", () => {
    const gust = (g: CustomRating["gust"]) =>
      parseCustomRating({ ...CUSTOM, gust: g })!.gust;
    expect(gust({ fine: 30, worst: 25, most: 2 })).toEqual({
      fine: 30,
      worst: 31,
      most: 2,
    });
    expect(gust({ fine: 70, worst: 80, most: 9 })).toEqual({
      fine: 49,
      worst: 50,
      most: 5,
    });
    expect(gust({ fine: -3, worst: 0, most: -1 })).toEqual({
      fine: 1,
      worst: 2,
      most: 0,
    });
  });
  it("holds every direction, offshore too, to 0–5 in half stars", () => {
    expect(
      parseCustomRating({
        ...CUSTOM,
        direction: {
          onshore: 0.3,
          crossOn: -2,
          cross: 1.74,
          crossOff: 9,
          offshore: 5,
        },
      })!.direction,
    ).toEqual({
      onshore: 0.5,
      crossOn: 0,
      cross: 1.5,
      crossOff: 5,
      offshore: 5,
    });
  });
  it("comes out the same when read twice", () => {
    const odd = {
      ...CUSTOM,
      wind: { min: 9.72, sweetLow: 10.1, sweetHigh: 30.06, max: 30.5 },
      gust: { fine: 33.33, worst: 33.9, most: 2.2 },
    };
    const once = parseCustomRating(odd)!;
    expect(parseCustomRating(once)).toEqual(once);
    expect(sameCustomRating(parseCustomRating(once), once)).toBe(true);
    expect(once.wind.sweetLow - once.wind.min).toBeGreaterThanOrEqual(1);
    expect(once.gust.worst - once.gust.fine).toBeGreaterThanOrEqual(1);
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
