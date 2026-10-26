import { describe, expect, it } from "vitest";
import {
  CUSTOM_RATING_VERSION,
  DEFAULT_RIDER,
  NEVER,
  OURS,
  shoreAngle,
  type CustomRating,
} from "../../force5/src/stars";
import { UNITS } from "../../force5/src/units";
import {
  DIRECTION_KEYS,
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
