import { describe, expect, it } from "vitest";
import {
  CUSTOM_RATING_VERSION,
  DEFAULT_RIDER,
  shoreAngle,
  standardRating,
  type CustomRating,
} from "../../force5/src/stars";
import { UNITS } from "../../force5/src/units";
import {
  DIRECTION_KEYS,
  EXAMPLES,
  FROM,
  GUST_TOP,
  WIND_TOP,
  breakdown,
  gridStars,
  halfStars,
  knotsOf,
  moveGust,
  moveWind,
  onLevel,
  rateExample,
  setDirection,
  shown,
  stepped,
  unitScale,
  withRating,
} from "./yourStars";

// The mockup's desktop rider: about 20 knots, and no gusts much over 25.
const MOCKUP: CustomRating = {
  version: CUSTOM_RATING_VERSION,
  base: "intermediate",
  wind: { min: 15, sweetLow: 18, sweetHigh: 23, max: 27 },
  gust: { fine: 24, worst: 30, most: 3 },
  direction: { onshore: 0.5, crossOn: 0, cross: 0, crossOff: 2.5, offshore: 4 },
};

describe("units", () => {
  it("shows every handle's position as the figure it was set to, in every unit", () => {
    for (const { id } of UNITS) {
      const unit = unitScale(id);
      for (let v = 0; v <= GUST_TOP * unit.perKn; v += unit.step) {
        const kn = knotsOf(v, unit);
        expect(Number(shown(kn, unit)), `${v} ${id}`).toBeCloseTo(v, 6);
        // Kept to the tenth of a knot.
        expect(Math.round(kn * 10) / 10).toBe(kn);
      }
    }
  });
  it("snaps a figure between steps to the nearest", () => {
    expect(knotsOf(7.3, unitScale("m/s"))).toBe(knotsOf(7.5, unitScale("m/s")));
    expect(knotsOf(14.6, unitScale("kn"))).toBe(15);
    expect(shown(15, unitScale("mph"))).toBe("17");
    expect(shown(15, unitScale("km/h"))).toBe("28");
    expect(shown(15, unitScale("m/s"))).toBe("7.7");
  });
  it("steps a handle one unit at a time", () => {
    const mph = unitScale("mph");
    expect(shown(stepped(knotsOf(20, mph), 1, mph), mph)).toBe("21");
    expect(shown(stepped(knotsOf(20, mph), -1, mph), mph)).toBe("19");
    const ms = unitScale("m/s");
    expect(shown(stepped(knotsOf(7.5, ms), 1, ms), ms)).toBe("8.0");
  });
});

describe("the handles", () => {
  it("keep their order, a knot apart, however far one is pulled", () => {
    const pulled = moveWind(MOCKUP, "sweetLow", 30);
    expect(pulled.wind).toEqual({
      min: 15,
      sweetLow: 22,
      sweetHigh: 23,
      max: 27,
    });
    expect(moveWind(MOCKUP, "sweetHigh", 5).wind.sweetHigh).toBe(19);
    expect(moveWind(MOCKUP, "min", 0).wind.min).toBe(2);
    expect(moveWind(MOCKUP, "max", 99).wind.max).toBe(WIND_TOP);
    expect(moveGust(MOCKUP, "fine", 45).gust).toEqual({
      fine: 29,
      worst: 30,
      most: 3,
    });
    expect(moveGust(MOCKUP, "worst", 3).gust.worst).toBe(25);
    expect(moveGust(MOCKUP, "worst", 80).gust.worst).toBe(GUST_TOP);
  });
  it("set a direction in half stars, offshore as freely as any", () => {
    expect(setDirection(MOCKUP, "offshore", 0).direction.offshore).toBe(0);
    expect(setDirection(MOCKUP, "offshore", 5.4).direction.offshore).toBe(5);
    expect(setDirection(MOCKUP, "cross", 1.3).direction.cross).toBe(1.5);
    expect(setDirection(MOCKUP, "onshore", -1).direction.onshore).toBe(0);
  });
  it("names stars off as the dialog does", () => {
    expect([0, 0.5, 1, 2.5, 3].map(halfStars)).toEqual([
      "0",
      "−½",
      "−1",
      "−2½",
      "−3",
    ]);
  });
});

describe("the examples", () => {
  it("read each direction as the beach does", () => {
    for (const key of DIRECTION_KEYS)
      expect(shoreAngle(FROM[key], 270)).toBe(
        {
          onshore: "onshore",
          crossOn: "cross-on",
          cross: "cross",
          crossOff: "cross-off",
          offshore: "offshore",
        }[key],
      );
  });
  it("give the mockup's stars, the level's against the rider's own", () => {
    const rider = { ...DEFAULT_RIDER, wings: [3] };
    const stars = (r: typeof rider) =>
      EXAMPLES.map(([w, g, d]) => rateExample(r, w, g, d).stars);
    expect(stars(onLevel(rider, MOCKUP))).toEqual([
      1, 2, 4, 5, 5, 4, 2, 4, 4, 1,
    ]);
    expect(stars(withRating(rider, MOCKUP))).toEqual([
      0, 1, 1, 4, 3, 2, 0, 4, 2, 0,
    ]);
    const learning = standardRating(rider, "beginner");
    expect(stars(onLevel(rider, learning))).toEqual(
      stars(withRating(rider, learning)),
    );
    expect(stars(onLevel(rider, learning))).toEqual([
      0, 1, 3, 4, 2, 0, 0, 3, 1, 0,
    ]);
  });
  it("break an hour down as the readout says it", () => {
    const { rating, wind, gusts, direction } = breakdown(
      withRating(DEFAULT_RIDER, standardRating(DEFAULT_RIDER, "beginner")),
      18,
      27,
      "crossOn",
    );
    expect(rating.stars).toBe(2);
    expect(wind).toBe(5);
    expect(gusts).toBeCloseTo(2.625, 9);
    expect(direction).toBe(0);
  });
});

describe("the grid", () => {
  it("rates every wind and gust two knots a square, blank under the wind", () => {
    const grid = gridStars(withRating(DEFAULT_RIDER, MOCKUP), "crossOn");
    expect(grid).toHaveLength(WIND_TOP / 2);
    expect(grid[0]).toHaveLength(GUST_TOP / 2);
    // 18–20 kn gusting 24–26 kn is the mockup's four stars.
    expect(grid[9][12]).toBe(4);
    expect(grid[10][2]).toBeNull();
  });
});
