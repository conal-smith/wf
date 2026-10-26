import { describe, expect, it } from "vitest";
import {
  CUSTOM_RATING_VERSION,
  DEFAULT_RIDER,
  GUST_EASE_KN,
  NEVER,
  OURS,
  bestWindow,
  directionCosts,
  gustsOverLimit,
  isOurs,
  noStarsWhy,
  oursCopy,
  parseCustomRating,
  pickWing,
  rateHour,
  sameCustomRating,
  shoreAngle,
  starsText,
  windBand,
  windStars,
  wingSize,
  type CustomRating,
  type HourInput,
  type HourRating,
  type Rider,
  type WindBand,
} from "./stars";

const hour = (over: Partial<HourInput> = {}): HourInput => ({
  windKn: 18,
  gustKn: 22,
  from: 180,
  agreement: "high",
  daylight: true,
  ...over,
});
// A west-facing beach: westerly is onshore, southerly or northerly cross-shore,
// easterly offshore.
const WEST = { facing: 270 };
const FROM = {
  onshore: 270,
  "cross-on": 225,
  cross: 180,
  "cross-off": 135,
  offshore: 90,
} as const;
const rider = (over: Partial<Rider> = {}): Rider => ({
  ...DEFAULT_RIDER,
  ...over,
});
const own = (
  wind: Partial<WindBand> = {},
  direction: Partial<CustomRating["direction"]> = {},
): CustomRating => ({
  version: CUSTOM_RATING_VERSION,
  wind: { ...OURS.wind, ...wind },
  direction: { ...OURS.direction, ...direction },
});
const rate = (
  windKn: number,
  gustKn: number | null,
  r: Rider = DEFAULT_RIDER,
  angle: keyof typeof FROM = "cross",
) => rateHour(hour({ windKn, gustKn, from: FROM[angle] }), WEST, r)!;

/*
 * The approved mock-up's model, copied as it is
 * (backlog/mockups/2026-10-25-own-star-rating.html, "How the stars come from
 * four numbers"), so the rating is held to the very function the owner
 * approved, and the plan's "ours" (PR #206) it was checked against.
 */
const MOCK_NEVER = 5;
const MOCK_GUST_EASE = 5;
const MOCK_OURS = {
  wind: { min: 11, sweetLow: 15, sweetHigh: 22, max: 35 },
  off: { onshore: 0, crossOn: 0, cross: 0, crossOff: 1, offshore: MOCK_NEVER },
};
type MockS = typeof MOCK_OURS;
function mockWindStars(x: number, w: MockS["wind"]) {
  if (x < w.min) return 0;
  if (x < w.sweetLow)
    return Math.min(4, 1 + (4 * (x - w.min)) / Math.max(1, w.sweetLow - w.min));
  if (x <= w.sweetHigh) return 5;
  const one = w.max - 5,
    zero = w.max - 3;
  let pts: number[][];
  if (one <= w.sweetHigh + 1)
    pts = [
      [w.sweetHigh, 5],
      [Math.max(zero, w.sweetHigh + 1), 0],
    ];
  else {
    const fourTo = Math.max(
      w.sweetHigh + 1,
      Math.min(w.sweetHigh + 3, one - 1),
    );
    pts = [
      [w.sweetHigh, 5],
      [w.sweetHigh + 1, 4],
      [fourTo, 4],
      [one, 1],
      [zero, 0],
    ];
  }
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1],
      [x1, y1] = pts[i];
    if (x <= x1)
      return x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 0;
}
const MOCK_SHORE_KEY = {
  onshore: "onshore",
  "cross-on": "crossOn",
  cross: "cross",
  "cross-off": "crossOff",
  offshore: "offshore",
} as const;
function mockRate(
  mean: number,
  gust: number,
  s: MockS,
  angle: keyof typeof MOCK_SHORE_KEY = "cross",
) {
  const cost = s.off[MOCK_SHORE_KEY[angle]];
  if (angle === "offshore" || cost >= MOCK_NEVER) return { stars: 0, lost: 0 };
  if (gust > s.wind.max) return { stars: 0, lost: 0 };
  const wind = mockWindStars(mean, s.wind),
    potential = Math.round(wind);
  const g = gust - MOCK_GUST_EASE,
    gs = g > s.wind.sweetHigh ? mockWindStars(g, s.wind) : 5;
  if (gs < wind && Math.round(gs) === 0) return { stars: 0, lost: 0 };
  const afterGust = Math.max(
    0,
    Math.min(potential, Math.round(Math.min(wind, gs))),
  );
  const stars = Math.max(0, afterGust - cost);
  return { stars, lost: potential - stars };
}
function planRate(mean: number, gust: number) {
  const s = { fiveTo: 22, allow: 5 };
  const pts = [
    [9, 0],
    [11, 1],
    [15, 5],
    [22, 5],
    [23, 4],
    [25, 4],
    [32, 0],
  ];
  const ws = (x: number) => {
    if (x <= 9) return 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1],
        [x1, y1] = pts[i];
      if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
    return 0;
  };
  const floor = 11,
    ride =
      mean >= floor || gust <= mean
        ? mean
        : Math.min(floor, mean + 0.3 * Math.min(gust - mean, mean));
  const wind = ws(ride),
    g = gust - s.allow,
    gs = g > s.fiveTo ? ws(g) : 5,
    potential = Math.round(wind);
  if (gs < wind && Math.round(gs) === 0) return { stars: 0, lost: 0 };
  const stars = Math.max(
    0,
    Math.min(potential, Math.round(Math.min(wind, gs))),
  );
  return { stars, lost: potential - stars };
}
const solid = (r: HourRating) => ({
  stars: r.stars,
  lost: r.potential - r.stars,
});

describe("ours", () => {
  it("is 11 · 15–22 · 35, cross-offshore one star off and offshore never", () => {
    expect(OURS.wind).toEqual({
      min: 11,
      sweetLow: 15,
      sweetHigh: 22,
      max: 35,
    });
    expect(OURS.direction).toEqual({
      onshore: 0,
      crossOn: 0,
      cross: 0,
      crossOff: 1,
      offshore: NEVER,
    });
    expect(GUST_EASE_KN).toBe(5);
    expect(windBand(DEFAULT_RIDER)).toEqual(OURS.wind);
  });
  it("is what every rider is rated on, whatever they weigh", () => {
    for (const weightKg of [null, 50, 80, 120])
      expect(windBand(rider({ weightKg }))).toEqual(OURS.wind);
    expect(isOurs(null)).toBe(true);
    expect(isOurs(oursCopy())).toBe(true);
    expect(isOurs(own({ min: 10 }))).toBe(false);
  });
});

describe("the agreed table", () => {
  // The brief's table, solid stars and outlined (25 October 2026).
  const AGREED: [number, number, number, number][] = [
    [15, 25, 5, 0],
    [20, 25, 5, 0],
    [20, 30, 4, 1],
    [25, 30, 4, 0],
    [30, 30, 1, 0],
    [22, 35, 1, 4],
    [32, 32, 0, 0],
    [33, 33, 0, 0],
    [36, 36, 0, 0],
    [10, 10, 0, 0],
  ];
  for (const [mean, gust, stars, lost] of AGREED)
    it(`rates ${mean} gusting ${gust} as ${stars}${lost ? ` +${lost}` : ""}`, () => {
      expect(solid(rate(mean, gust))).toEqual({ stars, lost });
    });

  it("matches the mock-up's model on every wind and gust, every way round the beach", () => {
    for (const angle of Object.keys(FROM) as (keyof typeof FROM)[])
      for (let mean = 0; mean <= 40; mean += 0.5)
        for (let gust = mean; gust <= 45; gust += 0.5)
          expect([
            mean,
            gust,
            angle,
            solid(rate(mean, gust, DEFAULT_RIDER, angle)),
          ]).toEqual([
            mean,
            gust,
            angle,
            mockRate(mean, gust, MOCK_OURS, angle),
          ]);
  });

  it("matches the mock-up's model for a rider's own numbers too", () => {
    const winds = [
      { min: 8, sweetLow: 12, sweetHigh: 26, max: 38 },
      { min: 13, sweetLow: 15, sweetHigh: 20, max: 24 },
      { min: 5, sweetLow: 6, sweetHigh: 7, max: 9 },
      { min: 14, sweetLow: 20, sweetHigh: 30, max: 40 },
    ];
    for (const wind of winds) {
      const off = {
        onshore: 1,
        crossOn: 0,
        cross: 0,
        crossOff: 2,
        offshore: 5,
      };
      const r = rider({ custom: own(wind, off) });
      for (const angle of Object.keys(FROM) as (keyof typeof FROM)[])
        for (let mean = 0; mean <= 40; mean += 1)
          for (let gust = mean; gust <= 45; gust += 1)
            expect(solid(rate(mean, gust, r, angle))).toEqual(
              mockRate(mean, gust, { wind, off }, angle),
            );
    }
  });

  it("differs from the plan only where the mock-up says: 10 kn steady and a gust of 36", () => {
    const hours: [number, number][] = [
      [15, 25],
      [20, 25],
      [20, 30],
      [25, 30],
      [30, 30],
      [30, 35],
      [22, 35],
      [28, 35],
      [20, 36],
      [10, 14],
    ];
    const differ = hours.filter(
      ([m, g]) =>
        JSON.stringify(solid(rate(m, g))) !== JSON.stringify(planRate(m, g)),
    );
    expect(differ).toEqual([
      [20, 36],
      [10, 14],
    ]);
    const steady: number[] = [];
    for (let k = 9; k <= 33; k++)
      if (rate(k, k).stars !== planRate(k, k).stars) steady.push(k);
    expect(steady).toEqual([10]);
  });

  it("climbs a star a knot from too light, five through the sweet spot, then down", () => {
    const steady = Array.from(
      { length: 25 },
      (_, i) => rate(9 + i, 9 + i).stars,
    );
    expect(steady).toEqual([
      0, 0, 1, 2, 3, 4, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 3, 3, 2, 2, 1, 1, 0, 0,
    ]);
    expect(windStars(10.9, OURS.wind)).toBe(0);
    expect(windStars(30, OURS.wind)).toBe(1);
    expect(windStars(32, OURS.wind)).toBe(0);
  });
});

describe("gusts", () => {
  it("past too much leave the hour no stars, outlines too, and say so", () => {
    const r = rate(18, 36);
    expect(r).toMatchObject({ stars: 0, potential: 0, session: "too-gusty" });
    expect(r.reasons).toEqual(["Gusts over your limit"]);
    expect(gustsOverLimit(35, DEFAULT_RIDER)).toBe(false);
    expect(gustsOverLimit(35.1, DEFAULT_RIDER)).toBe(true);
    expect(gustsOverLimit(null, DEFAULT_RIDER)).toBe(false);
  });
  it("count against the rider's own too much", () => {
    const r = rider({ custom: own({ max: 28 }) });
    expect(rate(18, 29, r).stars).toBe(0);
    expect(rate(18, 28, r).stars).toBeGreaterThan(0);
  });
  it("are read 5 kn lighter, and what they cost is outlined and named", () => {
    const r = rate(20, 30);
    expect(r).toMatchObject({
      stars: 4,
      potential: 5,
      lost: { gusts: 1, shore: 0 },
    });
    expect(r.reasons).toEqual(["Gusts: 1 star off."]);
    expect(rate(20, 27).reasons).toEqual([]);
  });
  it("cost nothing up to the sweet spot's top plus 5", () => {
    expect(rate(15, 27).stars).toBe(5);
    expect(rate(15, 28).stars).toBe(4);
  });
  it("are no penalty when the model gives none", () => {
    expect(rate(18, null).stars).toBe(5);
  });
  it("leave a wind too strong on its own called too strong", () => {
    expect(rate(33, 36).session).toBe("too-strong");
  });
  it("are judged in knots, not as a ratio: a light gusty day is not marked down", () => {
    // 12 gusting 24 is twice the mean; the gust, read as 19, costs nothing.
    expect(rate(12, 24).stars).toBe(2);
  });
});

describe("the shore", () => {
  it("costs ours nothing onshore, cross-onshore or cross-shore, and a star cross-offshore", () => {
    expect(rate(18, 22, DEFAULT_RIDER, "onshore").stars).toBe(5);
    expect(rate(18, 22, DEFAULT_RIDER, "cross-on").stars).toBe(5);
    expect(rate(18, 22, DEFAULT_RIDER, "cross").stars).toBe(5);
    const x = rate(18, 22, DEFAULT_RIDER, "cross-off");
    expect(x).toMatchObject({
      stars: 4,
      potential: 5,
      lost: { gusts: 0, shore: 1 },
    });
    expect(x.reasons).toEqual([
      "Cross-offshore: a drift downwind takes you out, not in.",
    ]);
  });
  it("is never offshore, whatever the rating says", () => {
    const r = rate(18, 22, DEFAULT_RIDER, "offshore");
    expect(r).toMatchObject({ stars: 0, potential: 0, session: "offshore" });
    expect(noStarsWhy(r)).toBe("offshore");
    const sneaky = rider({
      custom: { ...own(), direction: { ...own().direction, offshore: 0 } },
    });
    expect(rate(18, 22, sneaky, "offshore").stars).toBe(0);
    expect(directionCosts(sneaky).offshore).toBe(NEVER);
  });
  it("takes the rider's own whole stars off, after the gusts", () => {
    const r = rider({ custom: own({}, { onshore: 2, crossOff: 3 }) });
    expect(rate(18, 22, r, "onshore")).toMatchObject({
      stars: 3,
      potential: 5,
    });
    expect(rate(20, 30, r, "cross-off")).toMatchObject({
      stars: 1,
      lost: { gusts: 1, shore: 3 },
    });
    expect(rate(12, 12, r, "cross-off")).toMatchObject({
      stars: 0,
      potential: 2,
    });
  });
  it("can be set to never for any way of wind", () => {
    const r = rate(
      18,
      22,
      rider({ custom: own({}, { onshore: 5 }) }),
      "onshore",
    );
    expect(r).toMatchObject({ stars: 0, potential: 0, session: "never-shore" });
    expect(noStarsWhy(r)).toBe("onshore");
  });
  it("rates on the wind alone where the shore is not known", () => {
    expect(
      rateHour(hour({ from: 90 }), { facing: null }, DEFAULT_RIDER)!.stars,
    ).toBe(5);
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
  it("does not rate the dark or a missing reading", () => {
    expect(rateHour(hour({ daylight: false }), WEST, DEFAULT_RIDER)).toBeNull();
    expect(rateHour(hour({ windKn: null }), WEST, DEFAULT_RIDER)).toBeNull();
  });
  it("never takes a star for the models' agreement: it is context only", () => {
    for (const agreement of ["high", "moderate", "low", null] as const)
      expect(rateHour(hour({ agreement }), WEST, DEFAULT_RIDER)!.stars).toBe(5);
  });
  it("never takes a star for weight or wings", () => {
    const base = rate(18, 24);
    for (const r of [
      rider({ weightKg: 50 }),
      rider({ weightKg: 130 }),
      rider({ wings: [2] }),
      rider({ wings: [8] }),
    ])
      expect(solid(rate(18, 24, r))).toEqual(solid(base));
  });
  it("sorts the hour by its steady wind", () => {
    expect(rate(10, 12).session).toBe("too-light");
    expect(noStarsWhy(rate(10, 12))).toBe("too light");
    expect(rate(13, 14).session).toBe("drills");
    expect(rate(17, 18).session).toBe("cruising");
    expect(rate(21, 22).session).toBe("powered");
    expect(rate(26, 28).session).toBe("overpowered");
    expect(rate(32, 33).session).toBe("too-strong");
    expect(noStarsWhy(rate(17, 18))).toBeNull();
  });
  it("reads as words for a screen reader", () => {
    expect(starsText({ stars: 3, potential: 4 })).toBe(
      "3 of 5 stars, 4 possible",
    );
    expect(starsText({ stars: 1, potential: 1 })).toBe("1 of 5 star");
  });
});

describe("wing size", () => {
  it("follows the size charts for an 80 kg rider", () => {
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

describe("a rider's own rating, read and made safe", () => {
  it("takes a good one as it is", () => {
    const good = own(
      { min: 10, sweetLow: 14, sweetHigh: 24, max: 32 },
      { onshore: 1 },
    );
    expect(parseCustomRating(good)).toEqual(good);
    expect(parseCustomRating(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });
  it("never reads an old level's rating, version 1 or 2: the rider is on ours", () => {
    for (const version of [1, 2, 4, undefined])
      expect(
        parseCustomRating({
          version,
          base: "intermediate",
          wind: { min: 11, sweetLow: 14, sweetHigh: 24, max: 30 },
          direction: {
            onshore: 0,
            crossOn: 0,
            cross: 0,
            crossOff: 1.5,
            offshore: 4,
          },
        }),
      ).toBeNull();
  });
  it("drops a missing field or a word for a number", () => {
    expect(parseCustomRating(null)).toBeNull();
    expect(parseCustomRating("ours")).toBeNull();
    expect(
      parseCustomRating({ ...own(), wind: { ...own().wind, max: "35" } }),
    ).toBeNull();
    const { cross: _gone, ...direction } = own().direction;
    expect(parseCustomRating({ ...own(), direction })).toBeNull();
  });
  it("puts the wind handles in order, a knot apart, within 2 to 40", () => {
    expect(
      parseCustomRating(own({ min: 30, sweetLow: 10, sweetHigh: 5, max: 90 }))!
        .wind,
    ).toEqual({ min: 30, sweetLow: 31, sweetHigh: 32, max: 40 });
    expect(
      parseCustomRating(own({ min: -3, sweetLow: 2.04, sweetHigh: 3, max: 3 }))!
        .wind,
    ).toEqual({ min: 2, sweetLow: 3, sweetHigh: 4, max: 5 });
  });
  it("holds every direction to whole stars 0–5, offshore never", () => {
    const r = parseCustomRating({
      ...own(),
      direction: {
        onshore: 1.4,
        crossOn: -2,
        cross: 9,
        crossOff: 2.5,
        offshore: 0,
      },
    })!;
    expect(r.direction).toEqual({
      onshore: 1,
      crossOn: 0,
      cross: 5,
      crossOff: 3,
      offshore: NEVER,
    });
    const { offshore: _never, ...noOffshore } = own().direction;
    expect(
      parseCustomRating({ ...own(), direction: noOffshore })!.direction
        .offshore,
    ).toBe(NEVER);
  });
  it("ignores fields it does not know", () => {
    expect(
      parseCustomRating({ ...own(), base: "beginner", gust: { fine: 2 } }),
    ).toEqual(own());
  });
  it("compares the same as ours when it is ours", () => {
    expect(sameCustomRating(null, oursCopy())).toBe(true);
    expect(sameCustomRating(own({ max: 34 }), oursCopy())).toBe(false);
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
    expect(noStarsWhy({ session: "cruising" })).toBeNull();
  });
});
