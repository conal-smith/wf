import { describe, expect, it } from "vitest";
import {
  CUSTOM_RATING_VERSION,
  DEFAULT_RIDER,
  NEVER,
  OURS,
  oursCopy,
  shoreAngle,
  type CustomRating,
} from "../../force5/src/stars";
import { UNITS, beaufort } from "../../force5/src/units";
import {
  DIRECTION_KEYS,
  ENDS_APART,
  EXAMPLES,
  FROM,
  GUST_TOP,
  WIND_TOP,
  costLabel,
  forceBand,
  forceTicks,
  gridStars,
  knotsOf,
  moveWind,
  moveWindForce,
  moveWindEnd,
  moveWindIn,
  offAt,
  polar,
  sliceAt,
  WEB_DIRS,
  WEB_R,
  webRadius,
  rateExample,
  said,
  setDirection,
  shoreLocked,
  shown,
  starRuns,
  stepped,
  unitScale,
} from "./yourStars";

// A rider who likes about 20 knots, and nothing over 27.
const MOCKUP: CustomRating = {
  version: CUSTOM_RATING_VERSION,
  wind: { min: 15, sweetLow: 18, sweetHigh: 23, max: 27 },
  direction: { onshore: 1, crossOn: 0, cross: 0, crossOff: 3, offshore: NEVER },
};

describe("units", () => {
  it("shows every handle's position as the figure it was set to, in every unit", () => {
    // Force is whole forces, not figures: its own tests are below.
    for (const { id } of UNITS.filter((u) => u.id !== "bft")) {
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
    expect(knotsOf(7.3, unitScale("m/s"))).toBe(knotsOf(7, unitScale("m/s")));
    expect(knotsOf(14.6, unitScale("kn"))).toBe(15);
    expect(shown(15, unitScale("mph"))).toBe("17");
    expect(shown(15, unitScale("km/h"))).toBe("28");
    expect(shown(15, unitScale("m/s"))).toBe("8");
  });
  it("shows ours as whole figures in every unit, as a forecast in it reads (issue 231)", () => {
    const figures = (units: (typeof UNITS)[number]["id"]) =>
      [
        OURS.wind.min,
        OURS.wind.sweetLow,
        OURS.wind.sweetHigh,
        OURS.wind.max,
      ].map((kn) => shown(kn, unitScale(units)));
    // Not 5.7, 7.7, 11.3 and 18.0.
    expect(figures("m/s")).toEqual(["6", "8", "11", "18"]);
    expect(figures("km/h")).toEqual(["20", "28", "41", "65"]);
    expect(figures("mph")).toEqual(["13", "17", "25", "40"]);
    expect(figures("kn")).toEqual(["11", "15", "22", "35"]);
    expect(said(OURS.wind.min, unitScale("m/s"))).toBe("6 m/s");
  });
  it("steps a handle one unit at a time", () => {
    const mph = unitScale("mph");
    expect(shown(stepped(knotsOf(20, mph), 1, mph), mph)).toBe("21");
    expect(shown(stepped(knotsOf(20, mph), -1, mph), mph)).toBe("19");
    const ms = unitScale("m/s");
    expect(shown(stepped(knotsOf(7, ms), 1, ms), ms)).toBe("8");
    // From a number set in knots, a step is from the figure it shows.
    expect(shown(stepped(OURS.wind.min, 1, ms), ms)).toBe("7");
  });
});

describe("moveWindIn: a handle moved in the rider's unit", () => {
  const ours = (): CustomRating => ({
    ...OURS,
    wind: { ...OURS.wind },
    direction: { ...OURS.direction },
  });
  const nonForce = UNITS.filter((u) => u.id !== "bft").map((u) => u.id);
  it("lands on a whole figure, and leaves the others as they were", () => {
    for (const units of nonForce) {
      const unit = unitScale(units);
      for (let kn = 0; kn <= 50; kn += 0.37) {
        const moved = moveWindIn(ours(), "sweetLow", kn, units);
        const figure = moved.wind.sweetLow * unit.perKn;
        // Kept to the tenth of a knot: within a tenth of a km/h of the figure.
        expect(
          Math.abs(figure - Math.round(figure)),
          `${kn} kn in ${units}`,
        ).toBeLessThan(0.1);
        expect(moved.wind.min).toBe(OURS.wind.min);
        expect(moved.wind.sweetHigh).toBe(OURS.wind.sweetHigh);
        expect(moved.wind.max).toBe(OURS.wind.max);
      }
    }
  });
  it("stops on a whole figure short of a neighbour, never on the same figure", () => {
    for (const units of nonForce) {
      const unit = unitScale(units);
      // Pushed as far down as it goes, onto too light (11 kn, "6" in m/s).
      const moved = moveWindIn(ours(), "sweetLow", 0, units);
      expect(moved.wind.sweetLow - moved.wind.min).toBeGreaterThanOrEqual(1);
      expect(shown(moved.wind.sweetLow, unit)).not.toBe(
        shown(moved.wind.min, unit),
      );
      expect(Number(shown(moved.wind.sweetLow, unit))).toBeCloseTo(
        moved.wind.sweetLow * unit.perKn,
        1,
      );
    }
    // 11 kn is 5.66 m/s; a knot on is 6.17, so the next whole figure is 7.
    expect(
      shown(
        moveWindIn(ours(), "sweetLow", 0, "m/s").wind.sweetLow,
        unitScale("m/s"),
      ),
    ).toBe("7");
  });
  it("keeps the band's ends: 2 kn at the bottom, 40 kn at the top", () => {
    for (const units of nonForce) {
      expect(
        moveWindIn(ours(), "min", 0, units).wind.min,
      ).toBeGreaterThanOrEqual(2);
      expect(moveWindIn(ours(), "max", 99, units).wind.max).toBeLessThanOrEqual(
        WIND_TOP,
      );
    }
  });
  it("is moveWindForce in Force", () => {
    expect(moveWindIn(ours(), "max", 30, "bft")).toEqual(
      moveWindForce(ours(), "max", 30),
    );
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
  });
  it("set a direction in whole stars; offshore stays never", () => {
    expect(shoreLocked("offshore")).toBe(true);
    expect(shoreLocked("crossOff")).toBe(false);
    expect(setDirection(MOCKUP, "offshore", 0).direction.offshore).toBe(NEVER);
    expect(setDirection(MOCKUP, "cross", 1.3).direction.cross).toBe(1);
    expect(setDirection(MOCKUP, "cross", 1.6).direction.cross).toBe(2);
    expect(setDirection(MOCKUP, "crossOff", 9).direction.crossOff).toBe(NEVER);
    expect(setDirection(MOCKUP, "onshore", -1).direction.onshore).toBe(0);
  });
  it("name what a direction costs as the wizard does", () => {
    expect([0, 1, 3, NEVER].map(costLabel)).toEqual([
      "no cost",
      "−1★",
      "−3★",
      "never",
    ]);
  });
});

describe("the star strip", () => {
  it("runs ours' whole stars by steady wind, from none to five and back", () => {
    expect(starRuns(OURS.wind)).toEqual([
      { stars: 0, from: 0, to: 10 },
      { stars: 1, from: 11, to: 11 },
      { stars: 2, from: 12, to: 12 },
      { stars: 3, from: 13, to: 13 },
      { stars: 4, from: 14, to: 14 },
      { stars: 5, from: 15, to: 22 },
      { stars: 4, from: 23, to: 25 },
      { stars: 3, from: 26, to: 27 },
      { stars: 2, from: 28, to: 29 },
      { stars: 1, from: 30, to: 31 },
      { stars: 0, from: 32, to: 50 },
    ]);
  });
  it("follows the handles", () => {
    const runs = starRuns(MOCKUP.wind);
    expect(runs.find((r) => r.stars === 5)).toEqual({
      stars: 5,
      from: 18,
      to: 23,
    });
    expect(runs.at(-1)).toEqual({ stars: 0, from: 24, to: 50 });
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
  it("rate an hour for the rider, gusts and direction speaking", () => {
    const rider = { ...DEFAULT_RIDER, custom: MOCKUP };
    const stars = EXAMPLES.map(
      ([w, g, d]) => rateExample(rider, w, g, d).stars,
    );
    expect(stars).toEqual([0, 0, 1, 1, 5, 5, 0, 0, 4, 2, 0]);
    const ours = EXAMPLES.map(
      ([w, g, d]) => rateExample(DEFAULT_RIDER, w, g, d).stars,
    );
    expect(ours).toEqual([0, 2, 5, 5, 5, 5, 3, 2, 5, 4, 0]);
  });
});

describe("the grid", () => {
  it("rates every wind and gust two knots a square, blank under the wind", () => {
    const grid = gridStars({ ...DEFAULT_RIDER, custom: MOCKUP }, "crossOn");
    expect(grid).toHaveLength(WIND_TOP / 2);
    expect(grid[0]).toHaveLength(GUST_TOP / 2);
    // 18–20 kn gusting 24–26 kn is steady and in the sweet spot; gusting
    // 28–30 it is over the rider's 27.
    expect(grid[9][12]).toBe(5);
    expect(grid[9][14]).toBe(0);
    expect(grid[10][2]).toBeNull();
  });
});

describe("the direction web", () => {
  it("puts each direction's dot in its own slice, at its stars off", () => {
    for (const d of WEB_DIRS)
      for (const a of d.at)
        for (const off of [0, 0.5, 2.5, 4.5]) {
          const [x, y] = polar(a, webRadius(off));
          expect(offAt(x, y)).toBeCloseTo(off, 9);
          if (off < 4.5) expect(sliceAt(x * 0.99, y * 0.99)).toBe(d.key);
        }
  });
  it("draws offshore up over the sea and onshore down over the land", () => {
    expect(sliceAt(0, -50)).toBe("offshore");
    expect(sliceAt(0, 50)).toBe("onshore");
    expect(sliceAt(60, 0)).toBe("cross");
    expect(sliceAt(-60, 0)).toBe("cross");
    expect(sliceAt(0, -WEB_R - 1)).toBeNull();
  });
  it("takes nothing off on the rim or past it, and all five at the beach", () => {
    expect(offAt(0, -WEB_R)).toBe(0);
    expect(offAt(WEB_R * 2, 0)).toBe(0);
    expect(offAt(0, 0)).toBe(5);
  });
});

describe("Force: the handles on whole forces", () => {
  const bft = unitScale("bft");
  const band = (r: CustomRating) => [
    r.wind.min,
    r.wind.sweetLow,
    r.wind.sweetHigh,
    r.wind.max,
  ];
  const forces = (r: CustomRating) =>
    band(r).map((kn) => Number(shown(kn, bft)));

  it("shows a force, and says it in full", () => {
    expect(bft.force).toBe(true);
    expect(shown(18, bft)).toBe("5");
    expect(said(18, bft)).toBe("Force 5");
    expect(said(18, unitScale("kn"))).toBe("18 kn");
  });

  it("sets Learning's 13/15/20/26 kn as F4 / F5–F5 / F6, as the mockup does", () => {
    const learning: CustomRating = {
      ...MOCKUP,
      wind: { min: 13, sweetLow: 15, sweetHigh: 20, max: 26 },
    };
    const set = forceBand(learning);
    // The lower two on a force's first knot, the upper two on its last.
    expect(band(set)).toEqual([11, 17, 21, 27]);
    expect(forces(set)).toEqual([4, 5, 5, 6]);
  });

  it("keeps each handle on a force of its own, but the sweet spot's two", () => {
    const squeezed: CustomRating = {
      ...MOCKUP,
      wind: { min: 12, sweetLow: 13, sweetHigh: 14, max: 15 },
    };
    const f = forces(forceBand(squeezed));
    expect(f[1]).toBeGreaterThan(f[0]);
    expect(f[2]).toBeGreaterThanOrEqual(f[1]);
    expect(f[3]).toBeGreaterThan(f[2]);
    // Ours and some riders' own: in order, on the scale, on a force's edge.
    for (const wind of [
      OURS.wind,
      MOCKUP.wind,
      { min: 8, sweetLow: 12, sweetHigh: 28, max: 38 },
      { min: 3, sweetLow: 4, sweetHigh: 5, max: 6 },
    ]) {
      const set = forceBand({ ...MOCKUP, wind });
      const [a, b, c, d] = forces(set);
      expect(a).toBeGreaterThanOrEqual(2);
      expect(b).toBeGreaterThan(a);
      expect(c).toBeGreaterThanOrEqual(b);
      expect(d).toBeGreaterThan(c);
      expect(set.wind.max).toBeLessThanOrEqual(WIND_TOP);
      expect(forceBand(set)).toEqual(set);
    }
  });

  const LEARNING: CustomRating = {
    ...MOCKUP,
    wind: { min: 13, sweetLow: 15, sweetHigh: 20, max: 26 },
  };

  it("moves a handle a force at a time, and never onto a neighbour's", () => {
    const start = forceBand(LEARNING); // F4 / F5–F5 / F6
    expect(forces(start)).toEqual([4, 5, 5, 6]);
    // Pulled into the sweet spot's force, the minimum stops a force short.
    expect(forces(moveWindForce(start, "min", 19))).toEqual([4, 5, 5, 6]);
    // Down a force, to its first knot.
    const lower = moveWindForce(start, "min", 8);
    expect(lower.wind.min).toBe(7);
    // The top of the sweet spot up to F6 pushes nothing: the maximum is F6,
    // so it stops at F5; the maximum up to F7 goes to F7's last knot, 33.
    expect(forces(moveWindForce(start, "sweetHigh", 25))).toEqual([4, 5, 5, 6]);
    const wider = moveWindForce(start, "max", 30);
    expect(wider.wind.max).toBe(33);
    expect(forces(moveWindForce(wider, "sweetHigh", 25))).toEqual([4, 5, 6, 7]);
    // Never past the scale: F8's last knot is the top, 40.
    expect(moveWindForce(wider, "max", 60).wind.max).toBe(40);
  });

  it("steps a handle a whole force from the keyboard", () => {
    const start = forceBand(LEARNING);
    const up = moveWindForce(start, "max", stepped(start.wind.max, 1, bft));
    expect(up.wind.max).toBe(33);
    const down = moveWindForce(up, "max", stepped(up.wind.max, -1, bft));
    expect(down.wind.max).toBe(27);
  });

  it("ticks a scale where each force starts", () => {
    expect(forceTicks(0, WIND_TOP)).toEqual([
      { kn: 1, force: 1 },
      { kn: 4, force: 2 },
      { kn: 7, force: 3 },
      { kn: 11, force: 4 },
      { kn: 17, force: 5 },
      { kn: 22, force: 6 },
      { kn: 28, force: 7 },
      { kn: 34, force: 8 },
    ]);
    expect(forceTicks(10, GUST_TOP).map((t) => t.force)).toEqual([
      4, 5, 6, 7, 8, 9, 10,
    ]);
  });
});

describe("the two ends of the wind, the sweet spot worked out between them", () => {
  it("leaves ours as it is: 11 and 35 make 15 to 22", () => {
    const at = moveWindEnd(oursCopy(), "min", 11, "kn");
    expect(at.wind).toEqual({ min: 11, sweetLow: 15, sweetHigh: 22, max: 35 });
  });
  it("moves the sweet spot with either end, on whole figures", () => {
    expect(moveWindEnd(oursCopy(), "min", 15, "kn").wind).toEqual({
      min: 15,
      sweetLow: 18,
      sweetHigh: 24,
      max: 35,
    });
    expect(moveWindEnd(oursCopy(), "max", 25, "kn").wind).toEqual({
      min: 11,
      sweetLow: 13,
      sweetHigh: 17,
      max: 25,
    });
  });
  it("keeps the ends apart and on the scale", () => {
    const low = moveWindEnd(oursCopy(), "max", 0, "kn").wind;
    expect(low.max).toBe(11 + ENDS_APART);
    expect(low.min).toBeLessThan(low.sweetLow);
    expect(low.sweetLow).toBeLessThan(low.sweetHigh);
    expect(low.sweetHigh).toBeLessThan(low.max);
    expect(moveWindEnd(oursCopy(), "max", 99, "kn").wind.max).toBe(WIND_TOP);
    expect(moveWindEnd(oursCopy(), "min", 0, "kn").wind.min).toBe(2);
  });
  it("shows whole figures in the rider's unit, and whole forces in Force", () => {
    const ms = moveWindEnd(oursCopy(), "min", 8 / 0.514444, "m/s").wind;
    const per = 0.514444;
    for (const kn of Object.values(ms))
      expect(Math.abs(kn * per - Math.round(kn * per))).toBeLessThan(0.06);
    const bft = moveWindEnd(oursCopy(), "max", 30, "bft").wind;
    expect(new Set(Object.values(bft).map(beaufort)).size).toBeGreaterThan(2);
  });
});
