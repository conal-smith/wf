import { describe, expect, it } from "vitest";
import {
  COURSE_DEEP,
  UPWIND_DEFAULT,
  offshoreSpans,
  rideRange,
  rideRose,
  rideWedge,
  upwindAngle,
  upwindOf,
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
const SKILLS = ["beginner", "intermediate", "advanced"] as const;

describe("rideRange", () => {
  it("is nothing below the rider's floor", () => {
    const { min } = windBand(rider());
    expect(rideRange(rider(), min - 0.5)).toBeNull();
  });

  it("says how powered the hour is: building, sweet, overpowered, over", () => {
    const band = windBand(rider());
    const floor = rideRange(rider(), band.min)!;
    const sweet = rideRange(rider(), (band.sweetLow + band.sweetHigh) / 2)!;
    const top = rideRange(rider(), band.max)!;
    expect(floor.state).toBe("building");
    expect(sweet.state).toBe("sweet");
    expect(top.state).toBe("overpowered");
    expect(rideRange(rider(), band.max + 1)!.state).toBe("over");
    expect(floor.power).toBeLessThan(sweet.power);
    expect(top.power).toBeLessThan(sweet.power);
  });

  it("runs from 90° less the degrees into the wind to 120° off it, at each level's start", () => {
    // docs/RIDE_ROSE.md, 24 October 2026: Learning 0°, Riding 20°, Advanced 35°.
    expect(sweet("beginner")).toEqual([90, 120]);
    expect(sweet("intermediate")).toEqual([70, 120]);
    expect(sweet("advanced")).toEqual([55, 120]);
  });

  it("is one angle in every wind: how powered the hour is never moves it", () => {
    for (const skill of SKILLS)
      for (const upwind of [undefined, 0, 12, 45]) {
        const r = rider({ skill, upwind });
        const band = windBand(r);
        for (let kn = band.min; kn <= band.max + 4; kn += 0.5)
          expect(rideRange(r, kn)!.range).toEqual([
            90 - upwindOf(r),
            COURSE_DEEP,
          ]);
      }
  });

  it("follows the rider's own number, whatever their level", () => {
    expect(sweet("beginner", { upwind: 20 })).toEqual([70, 120]);
    expect(sweet("advanced", { upwind: 0 })).toEqual([90, 120]);
    expect(sweet("intermediate", { upwind: 45 })).toEqual([45, 120]);
    // Held to 0–45 however it got there.
    expect(sweet("intermediate", { upwind: 60 })).toEqual([45, 120]);
    expect(sweet("intermediate", { upwind: -10 })).toEqual([90, 120]);
  });
});

describe("degrees into the wind", () => {
  it("starts each level where the owner set it", () => {
    expect(UPWIND_DEFAULT).toEqual({
      beginner: 0,
      intermediate: 20,
      advanced: 35,
    });
    for (const skill of SKILLS)
      expect(upwindOf(rider({ skill }))).toBe(UPWIND_DEFAULT[skill]);
  });

  it("is the no-go's half-angle taken from 90°", () => {
    expect(upwindAngle(rider())).toBe(70);
    expect(upwindAngle(rider({ skill: "beginner" }))).toBe(90);
    expect(upwindAngle(rider({ skill: "advanced" }))).toBe(55);
    expect(upwindAngle(rider({ upwind: 5 }))).toBe(85);
    expect(upwindAngle(rider({ upwind: 45 }))).toBe(45);
  });

  it("never closes the course: at 0° it still runs 90° to 120° off the wind", () => {
    const [up, down] = sweet("beginner", { upwind: 0 });
    expect(down - up).toBe(30);
  });

  it("narrows the loupe's no-go, and widens the light's wedge, as it goes up", () => {
    const at = (upwind: number) => rideRose(rider({ upwind }), hour(225), DOLLY)!;
    expect(at(0).nogo).toEqual({ from: 135, to: 315 });
    expect(at(20).nogo).toEqual({ from: 155, to: 295 });
    expect(at(45).nogo).toEqual({ from: 180, to: 270 });
    const wedge = (upwind: number) =>
      rideWedge(rider({ upwind }), 18, 22, 45, SE)!;
    expect(width(wedge(30))).toBeGreaterThan(width(wedge(20)));
    expect(width(wedge(20))).toBeGreaterThan(width(wedge(10)));
  });

  it("never moves the power or the state the light draws", () => {
    for (const kn of [12, 16, 22, 30]) {
      const low = rideRange(rider({ upwind: 0 }), kn);
      const high = rideRange(rider({ upwind: 45 }), kn);
      expect(high?.power).toEqual(low?.power);
      expect(high?.state).toEqual(low?.state);
    }
  });
});

describe("rideWedge", () => {
  it("lies on the water in a cross-shore wind, along the beach", () => {
    const w = rideWedge(rider(), 18, 22, 45, SE)!;
    expect(onWater(w, SE)).toBe(true);
    // Riding, 20° into the wind: 70°–120° off a north-easterly.
    expect(w.from).toBeCloseTo(115);
    expect(w.to).toBeCloseTo(165);
  });

  it("never runs far off the wind: across it, and up, not down", () => {
    for (const skill of SKILLS)
      for (let from = 0; from < 360; from += 15) {
        const w = rideWedge(rider({ skill }), 18, 22, from, SE);
        if (!w) continue;
        // Every edge stays within 120° of where the wind comes from.
        for (const b of [w.from, w.to]) {
          const off = Math.abs(((((b - from) % 360) + 540) % 360) - 180);
          expect(off).toBeLessThanOrEqual(COURSE_DEEP + 1e-9);
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
      { from: 295, to: 345, kind: "home" },
      { from: 105, to: 155, kind: "out" },
    ]);
    // Past 120° off the wind each side: slow, drawn faintly.
    expect(rose.slow).toEqual({ from: 345, to: 465 });
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
      const all = [rose.nogo, rose.slow!, ...rose.reaches].flatMap((s) => [
        s.from,
        s.to,
      ]);
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
      { from: 295, to: 345, kind: "reach" },
      { from: 105, to: 155, kind: "reach" },
    ]);
  });

  it("keeps only the wind in the dark, below the floor, or where nothing heads out", () => {
    const bare = (r: ReturnType<typeof rideRose>) =>
      r !== null &&
      r.nogo === null &&
      r.reaches.length === 0 &&
      r.slow === null &&
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
