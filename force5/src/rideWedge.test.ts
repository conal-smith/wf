import { describe, expect, it } from "vitest";
import { rideRange, rideWedge } from "./rideWedge";
import { DEFAULT_RIDER, windBand, type Rider } from "./stars";

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

  it("lets an advanced rider point higher than a beginner", () => {
    const at = 17;
    const beginner = rideRange(rider({ skill: "beginner" }), at)!;
    const advanced = rideRange(rider({ skill: "advanced" }), at)!;
    expect(advanced.range[0]).toBeLessThan(beginner.range[0]);
    expect(advanced.range[1]).toBeGreaterThan(beginner.range[1]);
  });
});

describe("rideWedge", () => {
  it("lies on the water in a cross-shore wind, along the beach", () => {
    const w = rideWedge(rider(), 18, 22, 45, SE)!;
    expect(onWater(w, SE)).toBe(true);
    // Intermediate in the sweet spot: 60°–105° off a north-easterly.
    expect(w.from).toBeCloseTo(105);
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
