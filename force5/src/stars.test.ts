import { describe, expect, it } from "vitest";
import {
  CUSTOM_RATING_VERSION,
  DEFAULT_RIDER,
  SKILLS,
  bestWindow,
  directionCosts,
  gustiness,
  gustsOverLimit,
  gustyCost,
  noStarsWhy,
  parseCustomRating,
  pickWing,
  rateHour,
  rateOn,
  ratedRider,
  rideableWind,
  sameCustomRating,
  savedCustom,
  shoreAngle,
  standardRating,
  starsOn,
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
      hour({ from: 135, gustKn: 27 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect(rating.potential).toBe(5);
    expect(rating.stars).toBe(3);
    expect(rating.reasons).toEqual([
      "Cross-offshore: a drift downwind takes you out, not in.",
      "Gusty",
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
  it("never takes a star for the models' agreement: it is context only", () => {
    const winds = Array.from({ length: 81 }, (_, i) => 8 + i * 0.25);
    for (const windKn of winds) {
      const rate = (agreement: HourInput["agreement"]) =>
        rateHour(
          hour({ windKn, gustKn: windKn, from: 200, agreement }),
          WEST,
          DEFAULT_RIDER,
        )!;
      for (const agreement of ["moderate", "low", null] as const)
        expect(rate(agreement)).toEqual(rate("high"));
    }
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

// The owner's calibration of v6 (24 October 2026): an 80 kg rider who is
// bothered by gusty wind "some", cross-onshore, no wings listed, the models
// agreeing. [wind, gust, stars, potential]. Riding first, as the owner set it:
// steady wind is rated on the mean, gusty wind loses a star and very gusty
// two, and a gust over 30 kn leaves no stars at all.
const CALIBRATION: Record<Skill, [number, number, number, number][]> = {
  intermediate: [
    [9, 17, 1, 1], // under the floor: the gusts are a chance, no more
    [12, 20, 1, 2], // gusty (1.67)
    [15, 20, 4, 4], // steady (1.33)
    [15, 22, 4, 4],
    [15, 27, 2, 4], // very gusty (1.8)
    [18, 24, 5, 5], // steady
    [18, 27, 4, 5], // gusty (1.5)
    [22, 32, 0, 0], // a gust over 30
    [25, 33, 0, 0],
    [25, 38, 0, 0],
  ],
  beginner: [
    [9, 17, 0, 0],
    [10, 16, 0, 0],
    [12, 20, 1, 1],
    [15, 20, 4, 4],
    [15, 22, 4, 4],
    [15, 27, 0, 0], // a gust over 24
    [18, 24, 5, 5],
    [18, 27, 0, 0],
    [22, 32, 0, 0],
    [25, 38, 0, 0],
  ],
  advanced: [
    [9, 17, 0, 2], // over the 8 kn floor, and very gusty
    [10, 16, 1, 2], // gusty (1.6)
    [12, 20, 2, 3],
    [15, 22, 5, 5],
    [15, 27, 3, 5],
    [18, 24, 5, 5],
    [18, 27, 4, 5],
    [22, 32, 5, 5],
    [25, 33, 5, 5],
    [25, 38, 0, 0], // a gust over 35
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
    beginner: [5, 5, 2, 0],
    intermediate: [5, 5, 4, 1],
    advanced: [5, 5, 4, 1],
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

describe("gusts over your limit", () => {
  it("leave the hour no stars, faded ones too, and say so", () => {
    const rating = rateHour(
      hour({ windKn: 22, gustKn: 32, from: 200 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect([rating.stars, rating.potential]).toEqual([0, 0]);
    expect(rating.reasons).toEqual(["Gusts over your limit"]);
    expect(rating.session).toBe("too-gusty");
    expect(noStarsWhy(rating)).toBe("gusts over your limit");
  });
  it("start just over the top of the band: 24, 30 and 35 kn at 80 kg", () => {
    const tops: Record<Skill, number> = {
      beginner: 24,
      intermediate: 30,
      advanced: 35,
    };
    for (const skill of SKILLS) {
      const r = rider({ skill });
      expect(windBand(r).max).toBe(tops[skill]);
      expect(gustsOverLimit(tops[skill], r)).toBe(false);
      expect(gustsOverLimit(tops[skill] + 0.1, r)).toBe(true);
      expect(gustsOverLimit(null, r)).toBe(false);
    }
  });
  it("let a heavier rider hold a little more, as the top of the band does", () => {
    const heavy = rider({ weightKg: 125 });
    const top = 30 * (125 / 80) ** 0.25;
    expect(windBand(heavy).max).toBeCloseTo(top, 9);
    expect(gustsOverLimit(33.5, heavy)).toBe(false);
    expect(gustsOverLimit(33.6, heavy)).toBe(true);
  });
  it("count against the rider's own top, too", () => {
    const own = rider({
      custom: {
        ...standardRating(DEFAULT_RIDER),
        wind: { min: 10, sweetLow: 14, sweetHigh: 22, max: 26 },
      },
    });
    expect(
      rateHour(hour({ windKn: 18, gustKn: 26 }), WEST, own)!.potential,
    ).toBe(5);
    expect(
      rateHour(hour({ windKn: 18, gustKn: 27 }), WEST, own)!.potential,
    ).toBe(0);
  });
  it("leave a wind too strong on its own called too strong", () => {
    const rating = rateHour(
      hour({ windKn: 37, gustKn: 45, from: 200 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect(rating.session).toBe("too-strong");
    expect(rating.reasons).toEqual(["Gusts over your limit"]);
  });
});

describe("gusty wind", () => {
  it("is steady under 1.5 times the mean, gusty from 1.5, very gusty from 1.8", () => {
    expect(gustiness(18, 26.9, DEFAULT_RIDER)).toBe("steady");
    expect(gustiness(18, 27, DEFAULT_RIDER)).toBe("gusty");
    expect(gustiness(15, 26.9, DEFAULT_RIDER)).toBe("gusty");
    expect(gustiness(15, 27, DEFAULT_RIDER)).toBe("very-gusty");
    expect(gustiness(18, null, DEFAULT_RIDER)).toBe("steady");
  });
  it("only counts at or above the rider's floor", () => {
    // Riding's floor is 11 kn: below it a gust is a chance to get up.
    expect(gustiness(10.9, 20, DEFAULT_RIDER)).toBe("steady");
    expect(gustiness(11, 20, DEFAULT_RIDER)).toBe("very-gusty");
  });
  it("costs as much as it bothers the rider", () => {
    const off = (gusty: Rider["gusty"]) =>
      (["steady", "gusty", "very-gusty"] as const).map((kind) =>
        gustyCost(rider({ gusty }), kind),
      );
    expect(off("little")).toEqual([0, 0, 1]);
    expect(off("some")).toEqual([0, 1, 2]);
    expect(off(undefined)).toEqual([0, 1, 2]);
    expect(off("lots")).toEqual([0, 2, 3]);
  });
  it("shows what it cost as faded stars, and names it", () => {
    const rate = (gusty: Rider["gusty"], gustKn: number) => {
      const rating = rateHour(
        hour({ windKn: 18, gustKn, from: 200 }),
        WEST,
        rider({ gusty }),
      )!;
      return [rating.stars, rating.potential, ...rating.reasons];
    };
    expect(rate("some", 24)).toEqual([5, 5]);
    expect(rate("some", 27)).toEqual([4, 5, "Gusty"]);
    expect(rate("lots", 27)).toEqual([3, 5, "Gusty"]);
    expect(rate("little", 27)).toEqual([5, 5]);
    expect(rate("some", 29)).toEqual([4, 5, "Gusty"]);
    const veryGusty = rateHour(
      hour({ windKn: 15, gustKn: 27, from: 200 }),
      WEST,
      rider({ gusty: "little" }),
    )!;
    expect(veryGusty.reasons).toEqual(["Very gusty"]);
  });
  it("is named only when it moved a star", () => {
    // Offshore has taken every star already: the gusts move none.
    const rating = rateHour(
      hour({ windKn: 15, gustKn: 24, from: 90 }),
      WEST,
      DEFAULT_RIDER,
    )!;
    expect(rating.stars).toBe(0);
    expect(rating.reasons).toEqual([
      "Offshore wind: it blows you away from the beach.",
    ]);
  });
});

describe("direction", () => {
  it("costs each level its own stars for each way the wind meets the beach", () => {
    expect(directionCosts(rider({ skill: "beginner" }))).toEqual({
      onshore: 0,
      crossOn: 0,
      cross: 0,
      crossOff: 3,
      offshore: 5,
    });
    expect(directionCosts(DEFAULT_RIDER)).toEqual({
      onshore: 0,
      crossOn: 0,
      cross: 0,
      crossOff: 1.5,
      offshore: 4,
    });
    expect(directionCosts(rider({ skill: "advanced" }))).toEqual({
      onshore: 0,
      crossOn: 0,
      cross: 0,
      crossOff: 1,
      offshore: 4,
    });
  });
  it("never takes a star for cross-shore, onshore or cross-onshore", () => {
    for (const skill of SKILLS)
      for (const from of [270, 225, 180])
        expect(
          rateHour(
            hour({ windKn: 18, gustKn: 22, from }),
            WEST,
            rider({ skill }),
          )!.stars,
        ).toBe(5);
  });
  it("names a direction only when it costs a whole star", () => {
    // A rider's own half star for cross-shore, on an hour where it does not show.
    const halfOff = rider({
      custom: {
        ...standardRating(DEFAULT_RIDER),
        direction: { ...directionCosts(DEFAULT_RIDER), cross: 0.5 },
      },
    });
    const rating = rateHour(
      hour({ windKn: 17, gustKn: 19, from: 180 }),
      WEST,
      halfOff,
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
  direction: { onshore: 0.5, crossOn: 0, cross: 0, crossOff: 2.5, offshore: 4 },
};

describe("a custom rating", () => {
  const own = (over: Partial<Rider> = {}) => rider({ custom: CUSTOM, ...over });
  const rate = (r: Rider, windKn: number, gustKn: number, from = CROSS_ON) => {
    const rating = rateHour(hour({ windKn, gustKn, from }), WEST, r)!;
    return [rating.stars, rating.potential];
  };

  it("rates the mockup's rider who wants about 20 knots, and nothing over 27", () => {
    // design-system/patterns/your-stars.html, the desktop dialog's "Yours".
    expect(rate(own(), 12, 20)).toEqual([1, 1]);
    expect(rate(own(), 15, 22)).toEqual([1, 1]);
    expect(rate(own(), 18, 24)).toEqual([4, 4]);
    expect(rate(own(), 18, 27)).toEqual([3, 4]);
    expect(rate(own(), 22, 32)).toEqual([0, 0]);
    expect(rate(own(), 25, 38)).toEqual([0, 0]);
    expect(rate(own(), 18, 24, 270)).toEqual([4, 4]);
    expect(rate(own(), 18, 24, 135)).toEqual([2, 4]);
    expect(rate(own(), 18, 24, 90)).toEqual([0, 4]);
  });
  it("replaces the band and the directions, whatever the weight", () => {
    for (const weightKg of [null, 55, 120]) {
      const r = own({ weightKg });
      expect(windBand(r)).toEqual(CUSTOM.wind);
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
    expect(start.wind.max).toBeCloseTo(windBand(heavy).max, 1);
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
  it("reads a version 1 rating as version 2, its gust curve left behind", () => {
    const v1 = {
      ...CUSTOM,
      version: 1,
      gust: { fine: 24, worst: 30, most: 3 },
    };
    expect(parseCustomRating(v1)).toEqual(CUSTOM);
    expect(parseCustomRating(JSON.parse(JSON.stringify(v1)))).toEqual(CUSTOM);
    // Its gusts are not checked: they are not read.
    expect(parseCustomRating({ ...v1, gust: { fine: "24" } })).toEqual(CUSTOM);
    expect(CUSTOM_RATING_VERSION).toBe(2);
  });
  it("leaves a gust curve out of a version 2 rating", () => {
    expect(
      parseCustomRating({ ...CUSTOM, gust: { fine: 24, worst: 30, most: 3 } }),
    ).toEqual(CUSTOM);
  });
  it("drops another version, a missing field, a word for a number or no level", () => {
    expect(parseCustomRating({ ...CUSTOM, version: 3 })).toBeNull();
    expect(parseCustomRating({ ...CUSTOM, version: undefined })).toBeNull();
    expect(parseCustomRating({ ...CUSTOM, base: "pro" })).toBeNull();
    expect(
      parseCustomRating({ ...CUSTOM, wind: { ...CUSTOM.wind, max: "27" } }),
    ).toBeNull();
    expect(
      parseCustomRating({ ...CUSTOM, direction: { onshore: 0 } }),
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
    };
    const once = parseCustomRating(odd)!;
    expect(parseCustomRating(once)).toEqual(once);
    expect(sameCustomRating(parseCustomRating(once), once)).toBe(true);
    expect(once.wind.sweetLow - once.wind.min).toBeGreaterThanOrEqual(1);
    expect(once.wind.max - once.wind.sweetHigh).toBeGreaterThanOrEqual(1);
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
    expect(noStarsWhy({ session: "too-gusty" })).toBe("gusts over your limit");
    expect(noStarsWhy({ session: "offshore" })).toBe("offshore");
    expect(noStarsWhy({ session: "pump" })).toBeNull();
    expect(noStarsWhy({ session: "cruising" })).toBeNull();
  });
});

describe("a rider's own rating, rating or kept", () => {
  const own = standardRating(DEFAULT_RIDER, "advanced");
  const onOwn: Rider = { ...DEFAULT_RIDER, custom: own };
  it("goes to a level and back, keeping the rating", () => {
    const level = rateOn(onOwn, "beginner");
    expect(level).toEqual({
      ...DEFAULT_RIDER,
      skill: "beginner",
      keptCustom: own,
    });
    expect(starsOn(level)).toBe("beginner");
    expect(savedCustom(level)).toEqual(own);
    // Rated as the level, not as the rating kept.
    expect(windBand(level)).toEqual(
      windBand({ ...DEFAULT_RIDER, skill: "beginner" }),
    );
    const back = rateOn(level, "custom");
    expect(back).toEqual({ ...DEFAULT_RIDER, skill: "beginner", custom: own });
    expect(starsOn(back)).toBe("custom");
  });
  it("has no custom to go to without one", () => {
    expect(rateOn(DEFAULT_RIDER, "custom")).toEqual(DEFAULT_RIDER);
    expect(savedCustom(DEFAULT_RIDER)).toBeNull();
  });
  it("hands a server only the rating in use", () => {
    expect(ratedRider(rateOn(onOwn, "beginner"))).toEqual({
      ...DEFAULT_RIDER,
      skill: "beginner",
    });
    expect(ratedRider(onOwn)).toEqual(onOwn);
  });
});
