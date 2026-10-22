import { describe, expect, it } from "vitest";
import {
  offshoreSpans,
  rideRange,
  rideRose,
  rideWedge,
  upwindAngle,
} from "./rideWedge";
import { DEFAULT_RIDER, shoreAngle, windBand, type Rider } from "./stars";

const rider = (over: Partial<Rider> = {}): Rider => ({
  ...DEFAULT_RIDER,
  ...over,
});
// A south-east-facing beach: north-easterly and south-westerly are cross-shore.
const SE = 135;
const width = (w: { from: number; to: number }) => w.to - w.from;
/** Every bearing in the wedge is within 90° of the sea. */
const onWater = (w: { from: number; to: number }, facing: number) =>
  [w.from, (w.from + w.to) / 2, w.to].every(
    (b) => Math.abs(((((b - facing) % 360) + 540) % 360) - 180) <= 90 + 1e-9,
  );

/** The range in the middle of the rider's sweet spot. */
const sweet = (skill: Rider["skill"], over: Partial<Rider> = {}) => {
  const r = rider({ skill, ...over });
  const band = windBand(r);
  return rideRange(r, (band.sweetLow + band.sweetHigh) / 2)!.range;
};

describe("rideRange", () => {
  it("is nothing below the rider's floor", () => {
    const { min } = windBand(rider());
    expect(rideRange(rider(), min - 0.5)).toBeNull();
  });

  it("opens from the floor to the sweet spot, then narrows overpowered", () => {
    const band = windBand(rider());
    const floor = rideRange(rider(), band.min)!;
    const sweet = rideRange(rider(), (band.sweetLow + band.sweetHigh) / 2)!;
    const top = rideRange(rider(), band.max)!;
    expect(floor.state).toBe("building");
    expect(sweet.state).toBe("sweet");
    expect(top.state).toBe("overpowered");
    expect(rideRange(rider(), band.max + 1)!.state).toBe("over");
    // Higher upwind and deeper downwind once powered up...
    expect(sweet.range[0]).toBeLessThan(floor.range[0]);
    expect(sweet.range[1]).toBeGreaterThan(floor.range[1]);
    // ...and less deep downwind at the top.
    expect(top.range[1]).toBeLessThan(sweet.range[1]);
    expect(floor.power).toBeLessThan(sweet.power);
    expect(top.power).toBeLessThan(sweet.power);
  });

  it("points as a session rider holds it, powered up: 90°, 70° and 55° off the wind", () => {
    // docs/RIDE_ROSE.md: a learner holds a beam reach at best; a riding and
    // an advanced rider 10° short of the 60° and 45° the GPS tracks and the
    // schools give, which is the good end.
    expect(sweet("beginner")).toEqual([90, 105]);
    expect(sweet("intermediate")).toEqual([70, 105]);
    expect(sweet("advanced")).toEqual([55, 110]);
    // Just foiling, about 15° lower; at the top of the band, about 5°.
    for (const skill of ["intermediate", "advanced"] as const) {
      const band = windBand(rider({ skill }));
      expect(rideRange(rider({ skill }), band.min)!.range[0]).toBe(
        sweet(skill)[0] + 15,
      );
      expect(rideRange(rider({ skill }), band.max)!.range[0]).toBe(
        sweet(skill)[0] + 5,
      );
    }
  });

  it("lets an advanced rider point higher than a beginner", () => {
    const at = 17;
    const beginner = rideRange(rider({ skill: "beginner" }), at)!;
    const advanced = rideRange(rider({ skill: "advanced" }), at)!;
    expect(advanced.range[0]).toBeLessThan(beginner.range[0]);
    expect(advanced.range[1]).toBeGreaterThan(beginner.range[1]);
  });
});

describe("pointing", () => {
  it("points 10° higher when sharp, back to the sources' good end, and 10° lower when cautious", () => {
    // Sharp is what the schools and the GPS tracks give: 60° and 45°.
    expect(sweet("intermediate", { pointing: "sharp" })).toEqual([60, 105]);
    expect(sweet("advanced", { pointing: "sharp" })).toEqual([45, 110]);
    expect(sweet("intermediate", { pointing: "cautious" })).toEqual([80, 105]);
    expect(sweet("advanced", { pointing: "cautious" })).toEqual([65, 110]);
    expect(sweet("intermediate", { pointing: "typical" })).toEqual(
      sweet("intermediate"),
    );
  });

  it("moves only the upwind edge, at every wind the rider can ride", () => {
    for (const skill of ["beginner", "intermediate", "advanced"] as const) {
      const band = windBand(rider({ skill }));
      for (let kn = band.min; kn <= band.max + 2; kn += 0.5) {
        const typical = rideRange(rider({ skill }), kn)!;
        const sharp = rideRange(rider({ skill, pointing: "sharp" }), kn)!;
        const cautious = rideRange(rider({ skill, pointing: "cautious" }), kn)!;
        expect(sharp.range[0]).toBeCloseTo(typical.range[0] - 10);
        expect(cautious.range[0]).toBeGreaterThanOrEqual(typical.range[0]);
        for (const r of [sharp, cautious]) {
          expect(r.range[1]).toBe(typical.range[1]);
          expect(r.power).toBe(typical.power);
          expect(r.state).toBe(typical.state);
        }
      }
    }
  });

  it("never closes the reach for a cautious rider", () => {
    // A learner powered up keeps 10° of reach, 95°–105°; just foiling, the
    // 95°–100° the level has.
    expect(sweet("beginner", { pointing: "cautious" })).toEqual([95, 105]);
    const learner = rider({ skill: "beginner", pointing: "cautious" });
    expect(rideRange(learner, windBand(learner).min)!.range).toEqual([95, 100]);
    for (const skill of ["beginner", "intermediate", "advanced"] as const) {
      const r = rider({ skill, pointing: "cautious" });
      const band = windBand(r);
      for (let kn = band.min; kn <= band.max; kn += 0.5) {
        const [up, down] = rideRange(r, kn)!.range;
        expect(down - up).toBeGreaterThanOrEqual(5 - 1e-9);
      }
    }
  });

  it("says the angle the display options show, powered up", () => {
    expect(upwindAngle(rider())).toBe(70);
    expect(upwindAngle(rider({ pointing: "sharp" }))).toBe(60);
    expect(
      upwindAngle(rider({ skill: "advanced", pointing: "cautious" })),
    ).toBe(65);
    expect(upwindAngle(rider({ skill: "beginner" }))).toBe(90);
  });

  it("widens the loupe's no-go, and the light's wedge with it", () => {
    const typical = rideRose(rider(), hour(225), DOLLY)!;
    const sharp = rideRose(rider({ pointing: "sharp" }), hour(225), DOLLY)!;
    const cautious = rideRose(
      rider({ pointing: "cautious" }),
      hour(225),
      DOLLY,
    )!;
    expect(sharp.nogo).toEqual({ from: 165, to: 285 });
    expect(typical.nogo).toEqual({ from: 155, to: 295 });
    expect(cautious.nogo).toEqual({ from: 145, to: 305 });
    const wedge = (pointing: Rider["pointing"]) =>
      rideWedge(rider({ pointing }), 18, 22, 45, SE)!;
    expect(width(wedge("sharp"))).toBeGreaterThan(width(wedge("typical")));
    expect(width(wedge("typical"))).toBeGreaterThan(width(wedge("cautious")));
  });
});

describe("rideWedge", () => {
  it("lies on the water in a cross-shore wind, along the beach", () => {
    const w = rideWedge(rider(), 18, 22, 45, SE)!;
    expect(onWater(w, SE)).toBe(true);
    // Intermediate in the sweet spot: 70°–105° off a north-easterly.
    expect(w.from).toBeCloseTo(115);
    expect(w.to).toBeCloseTo(150);
  });

  it("never runs far off the wind: across it, and up, not down", () => {
    for (const skill of ["beginner", "intermediate", "advanced"] as const)
      for (let from = 0; from < 360; from += 15) {
        const w = rideWedge(rider({ skill }), 18, 22, from, SE);
        if (!w) continue;
        // Every edge stays within 110° of where the wind comes from.
        for (const b of [w.from, w.to]) {
          const off = Math.abs(((((b - from) % 360) + 540) % 360) - 180);
          expect(off).toBeLessThanOrEqual(110 + 1e-9);
        }
      }
  });

  it("is cut off at the beach, never pointing inland", () => {
    for (let from = 0; from < 360; from += 15) {
      const w = rideWedge(rider({ skill: "advanced" }), 18, 22, from, SE);
      if (w) expect(onWater(w, SE)).toBe(true);
    }
  });

  it("leaves a learner nothing to hold out to sea in an onshore wind", () => {
    expect(rideWedge(rider({ skill: "beginner" }), 18, 20, SE, SE)).toBeNull();
    // An advanced rider can still work out through it.
    expect(
      rideWedge(rider({ skill: "advanced" }), 18, 20, SE, SE),
    ).not.toBeNull();
  });

  it("is wider for an advanced rider, and absent without a wind or a beach", () => {
    const beginner = rideWedge(rider({ skill: "beginner" }), 17, 20, 45, SE)!;
    const advanced = rideWedge(rider({ skill: "advanced" }), 17, 20, 45, SE)!;
    expect(width(advanced)).toBeGreaterThan(width(beginner));
    expect(rideWedge(rider(), null, null, 45, SE)).toBeNull();
    expect(rideWedge(rider(), 18, 22, null, SE)).toBeNull();
    expect(rideWedge(rider(), 18, 22, 45, null)).toBeNull();
  });

  it("counts the gusts the rider can use, as the stars do", () => {
    const { min } = windBand(rider());
    expect(rideWedge(rider(), min - 1, null, 45, SE)).toBeNull();
    expect(rideWedge(rider(), min - 1, min + 8, 45, SE)).not.toBeNull();
  });
});

// Dollymount: the beach looks out to the south-east.
const DOLLY = 125;
const hour = (
  from: number | null,
  over: Partial<{ windKn: number; gustKn: number; daylight: boolean }> = {},
) => ({
  windKn: 16,
  gustKn: 22,
  from,
  daylight: true,
  ...over,
});

describe("rideRose", () => {
  it("draws Dollymount's cross-shore afternoon: out to the south-east, home to the north-west", () => {
    const rose = rideRose(rider(), hour(225), DOLLY)!;
    expect(rose.shore).toBe("cross");
    // Within 70° of a south-westerly, for a riding rider.
    expect(rose.nogo).toEqual({ from: 155, to: 295 });
    expect(rose.reaches).toEqual([
      { from: 295, to: 330, kind: "home" },
      { from: 120, to: 155, kind: "out" },
    ]);
    expect(rose.drift).toBe(45);
    expect(rose.driftOut).toBe(false);
  });

  it("follows the rider's level", () => {
    const learner = rideRose(rider({ skill: "beginner" }), hour(225), DOLLY)!;
    const advanced = rideRose(rider({ skill: "advanced" }), hour(225), DOLLY)!;
    expect(learner.nogo).toEqual({ from: 135, to: 315 });
    expect(advanced.nogo).toEqual({ from: 170, to: 280 });
  });

  it("rounds every bearing to 5°", () => {
    for (let from = 0; from < 360; from += 7) {
      const rose = rideRose(rider(), hour(from + 0.4), DOLLY);
      if (!rose?.nogo) continue;
      const all = [rose.nogo, ...rose.reaches].flatMap((s) => [s.from, s.to]);
      for (const b of [...all, rose.drift!]) expect(b % 5).toBe(0);
    }
  });

  it("drifts out to sea, in red, in an offshore or cross-offshore wind, with no out or home", () => {
    const off = rideRose(rider(), hour(305), DOLLY)!;
    expect(off.shore).toBe("offshore");
    expect(off.driftOut).toBe(true);
    expect(off.reaches.map((r) => r.kind)).toEqual(["reach", "reach"]);
    const crossOff = rideRose(rider(), hour(265), DOLLY)!;
    expect(crossOff.shore).toBe("cross-off");
    expect(crossOff.driftOut).toBe(true);
    expect(crossOff.reaches.map((r) => r.kind).sort()).toEqual(["home", "out"]);
  });

  it("names no out or home with no beach, and leaves both reaches whole", () => {
    const rose = rideRose(rider(), hour(225), null)!;
    expect(rose.shore).toBeNull();
    expect(rose.driftOut).toBe(false);
    expect(rose.reaches).toEqual([
      { from: 295, to: 330, kind: "reach" },
      { from: 120, to: 155, kind: "reach" },
    ]);
  });

  it("keeps only the wind in the dark, below the floor, or where nothing heads out", () => {
    const bare = (r: ReturnType<typeof rideRose>) =>
      r !== null &&
      r.nogo === null &&
      r.reaches.length === 0 &&
      r.drift === null;
    expect(bare(rideRose(rider(), hour(225, { daylight: false }), DOLLY))).toBe(
      true,
    );
    expect(
      bare(rideRose(rider(), hour(225, { windKn: 6, gustKn: 7 }), DOLLY)),
    ).toBe(true);
    // A learner in an onshore wind: the light's wedge is empty too.
    expect(
      rideWedge(rider({ skill: "beginner" }), 18, 20, DOLLY, DOLLY),
    ).toBeNull();
    expect(
      bare(
        rideRose(
          rider({ skill: "beginner" }),
          hour(DOLLY, { windKn: 18, gustKn: 20 }),
          DOLLY,
        ),
      ),
    ).toBe(true);
    // The wind is still there to show.
    expect(
      rideRose(rider(), hour(225, { daylight: false }), DOLLY)!.windFrom,
    ).toBe(225);
    expect(rideRose(rider(), hour(null), DOLLY)).toBeNull();
  });

  it("puts the tack out where the light's wedge is", () => {
    for (let from = 0; from < 360; from += 10) {
      const wedge = rideWedge(rider(), 16, 22, from, DOLLY);
      const rose = rideRose(rider(), hour(from), DOLLY)!;
      const outs = rose.reaches.filter((r) => r.kind === "out");
      if (rose.shore === "offshore") continue;
      expect(outs.length > 0).toBe(wedge !== null);
    }
  });
});

describe("offshoreSpans", () => {
  it("hatches what shoreAngle calls offshore and cross-offshore", () => {
    const { offshore, crossOff } = offshoreSpans(DOLLY);
    expect(offshore).toEqual({ from: 275, to: 335 });
    expect(crossOff).toEqual([
      { from: 235, to: 275 },
      { from: 335, to: 375 },
    ]);
    for (let b = offshore.from + 1; b < offshore.to; b++)
      expect(shoreAngle(b, DOLLY)).toBe("offshore");
    for (const s of crossOff)
      for (let b = s.from + 1; b < s.to; b++)
        expect(shoreAngle(b % 360, DOLLY)).toBe("cross-off");
  });
});
