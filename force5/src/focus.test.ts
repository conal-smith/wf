import { describe, expect, it } from "vitest";
import {
  arcPath,
  bezelTicks,
  dialDrawing,
  footBox,
  isFocusStyle,
  loupeRose,
  metresPerPixel,
  polar,
  rangeRing,
  roseDrawing,
  roseFitRadius,
  roseRadius,
  roseScale,
  sectorPath,
  washHoles,
  zoomFor,
  ROSE_MIN_PX,
} from "./focus";
import { rideRose } from "./rideWedge";
import { DEFAULT_RIDER } from "./stars";

describe("the mark round the chosen spot", () => {
  it("knows its three styles and nothing else", () => {
    expect(isFocusStyle("loupe")).toBe(true);
    expect(isFocusStyle("ring")).toBe(true);
    expect(isFocusStyle("off")).toBe(true);
    expect(isFocusStyle("spotlight")).toBe(false);
    expect(isFocusStyle(null)).toBe(false);
  });

  it("measures the ground under a pixel as MapLibre draws it", () => {
    // Portrane, at the zoom a chosen spot is flown to: about 34 m a pixel.
    expect(metresPerPixel(10.4, 53.49)).toBeCloseTo(34.4, 0);
    expect(metresPerPixel(11.4, 53.49)).toBeCloseTo(17.2, 0);
  });

  it("reaches the round distance nearest a kilometre, in the rider's units", () => {
    expect(roseScale("kn")).toEqual({
      metres: 926,
      label: "0.5 NM",
      inner: 463,
      innerLabel: "0.25 NM",
    });
    const mph = roseScale("mph");
    expect(mph.label).toBe("0.5 mi");
    expect(mph.innerLabel).toBe("0.25 mi");
    expect(mph.metres).toBeCloseTo(804.67, 1);
    for (const units of ["km/h", "m/s"] as const)
      expect(roseScale(units)).toEqual({
        metres: 1000,
        label: "1 km",
        inner: 500,
        innerLabel: "500 m",
      });
  });

  it("draws the rose to scale, and holds it at its smallest zoomed far out", () => {
    // A kilometre at 5 m a pixel: 200 px, to scale, and twice that one zoom in.
    expect(roseRadius(1000, 5)).toEqual({ r: 200, toScale: true });
    expect(roseRadius(1000, 2.5).r).toBe(400);
    // At 34 m a pixel a kilometre is 29 px: drawn at the floor, not to scale.
    expect(roseRadius(1000, 34.4)).toEqual({ r: ROSE_MIN_PX, toScale: false });
  });

  it("flies a chosen spot in close enough for the rose to fill the clear map", () => {
    // A desktop's clear map: the rose at 200 px; a phone's, a little under half its width.
    expect(roseFitRadius(1340, 700)).toBe(200);
    expect(roseFitRadius(358, 480)).toBe(148);
    expect(roseFitRadius(100, 100)).toBe(ROSE_MIN_PX + 20);
    // Half a nautical mile in 148 px at Dollymount (53.36° N): about zoom 12.9.
    const z = zoomFor(926, 148, 53.36);
    expect(z).toBeCloseTo(12.87, 1);
    expect(926 / metresPerPixel(z, 53.36)).toBeCloseTo(148);
  });

  it("rules the bezel every 5°, longer every 30°, with north left for its letter", () => {
    const ticks = bezelTicks(100);
    expect(ticks).toHaveLength(71);
    expect(ticks.filter((t) => t.long)).toHaveLength(11);
    // East, 90° round: a long tick straight out to the right.
    const east = ticks[17];
    expect(east.long).toBe(true);
    expect(east.x1).toBeCloseTo(101.5);
    expect(east.x2).toBeCloseTo(108);
    expect(east.y2).toBeCloseTo(0);
  });

  it("draws the ring at the longest round distance inside 42% of the view", () => {
    // 3 NM is 161 px at 34.4 m a pixel; 5 NM, 269 px, is over 260.
    expect(rangeRing(34.4, 620)).toEqual({
      metres: 3 * 1852,
      label: "3 NM",
      px: (3 * 1852) / 34.4,
    });
    // Two zooms in, four times the pixels a mile: 1 NM is 215 px.
    expect(rangeRing(8.6, 620).label).toBe("1 NM");
    // Nothing fits: the shortest, rather than none.
    expect(rangeRing(1, 620).label).toBe("0.25 NM");
  });

  it("measures the ring in the distance that goes with the rider's speed units", () => {
    // 0.5 of each fits in 260 px at 3.7 m a pixel; 1 of none of them does.
    expect(rangeRing(3.7, 620, "kn").label).toBe("0.5 NM");
    expect(rangeRing(3.7, 620, "mph").label).toBe("0.5 mi");
    expect(rangeRing(3.7, 620, "km/h").label).toBe("0.5 km");
    expect(rangeRing(3.7, 620, "m/s").label).toBe("500 m");
    expect(rangeRing(3.7, 620, "m/s").px).toBeCloseTo(500 / 3.7);
    // Past a kilometre, metres a second writes kilometres.
    expect(rangeRing(30, 620, "m/s").label).toBe("5 km");
  });

  it("washes lightly beyond the loupe, and more lightly still beyond the ring", () => {
    expect(washHoles("loupe", 200)).toEqual({
      holes: [206.5],
      opacity: [0.18],
    });
    const ring = washHoles("ring", 100);
    expect(ring.holes).toEqual([145, 185, 225, 265, 305]);
    // Each band as strong as the sheets of paper once stacked there: one
    // sheet's worth past the first hole, and 10% beyond the last.
    const sheet = ring.opacity[0];
    ring.opacity.forEach((o, i) =>
      expect(o).toBeCloseTo(1 - (1 - sheet) ** (i + 1), 10),
    );
    expect(ring.opacity[4]).toBeCloseTo(0.1);
    expect(washHoles("off", 100)).toEqual({ holes: [], opacity: [] });
  });
});

// Dollymount: the beach looks out to the south-east, 125°.
const DOLLYMOUNT = 125;
const rider = { ...DEFAULT_RIDER };
const day = { windKn: 16, gustKn: 22, daylight: true };

describe("the ride rose's geometry", () => {
  it("puts north up and east right, as the screen draws them", () => {
    const [nx, ny] = polar(0, 10);
    expect(nx).toBeCloseTo(0);
    expect(ny).toBeCloseTo(-10);
    const [ex, ey] = polar(90, 10);
    expect(ex).toBeCloseTo(10);
    expect(ey).toBeCloseTo(0);
    expect(arcPath({ from: 0, to: 90 }, 10)).toBe(
      "M0 -10.0A10.0 10.0 0 0 1 10.0 0",
    );
    expect(sectorPath({ from: 0, to: 270 }, 0, 10)).toContain(" 0 1 1 ");
  });

  it("draws the no-go, the tack out washed, the tack home dashed and the drift", () => {
    const rose = rideRose(rider, { ...day, from: 225 }, DOLLYMOUNT)!;
    const d = roseDrawing(rose, 150, roseScale("kn"));
    expect(d.nogo).not.toBeNull();
    expect(d.fans.map((f) => f.kind).sort()).toEqual(["home", "out"]);
    const out = d.fans.find((f) => f.kind === "out")!;
    expect(out.fill).not.toBeNull();
    expect(out.head).not.toBeNull();
    expect(d.fans.find((f) => f.kind === "home")!.fill).toBeNull();
    expect(d.drift?.out).toBe(false);
    const words = d.labels.map((l) => l.text);
    expect(words).toEqual(
      expect.arrayContaining([
        "NO-GO",
        "OUT",
        "120–155°",
        "HOME",
        "295–330°",
        "DRIFT",
        "0.5 NM",
      ]),
    );
    // The half-way ring, half the radius out, with its distance.
    expect(d.rings).toHaveLength(1);
    expect(d.rings[0].r).toBeCloseTo(75);
    expect(d.rings[0].label.text).toBe("0.25 NM");
  });

  it("writes the drift out to sea in the pen's words when it is", () => {
    const rose = rideRose(rider, { ...day, from: 305 }, DOLLYMOUNT)!;
    const d = roseDrawing(rose, 150, null);
    expect(d.drift?.out).toBe(true);
    expect(
      d.labels.filter((l) => l.kind === "warn").map((l) => l.text),
    ).toEqual(["DRIFT", "OUT TO SEA"]);
    expect(d.rings).toHaveLength(0);
  });

  it("drops the words on a small rose, and everything under its floor", () => {
    const rose = rideRose(rider, { ...day, from: 225 }, DOLLYMOUNT)!;
    const small = roseDrawing(rose, 100, null);
    expect(small.labels.map((l) => l.text)).not.toContain("120–155°");
    expect(small.labels.map((l) => l.text)).toContain("OUT");
    const tiny = roseDrawing(rose, 80, null);
    expect(tiny.labels).toHaveLength(0);
    expect(tiny.fans).toHaveLength(2);
    expect(roseDrawing(rose, ROSE_MIN_PX - 1, null).fans).toHaveLength(0);
  });

  it("hatches the offshore winds on the bezel, and none without a beach", () => {
    const dial = dialDrawing(225, DOLLYMOUNT, 150);
    expect(dial.offshore).not.toBeNull();
    expect(dial.crossOff).toHaveLength(2);
    // The offshore words on the upper half run clockwise; on the lower, back.
    expect(dial.offshore!.text).toContain(" 0 0 1 ");
    expect(dialDrawing(225, 0, 150).offshore!.text).toContain(" 0 0 0 ");
    const bare = dialDrawing(225, null, 150);
    expect(bare.offshore).toBeNull();
    expect(bare.crossOff).toHaveLength(0);
    // The needle's tip 30 px inside the rim, on the wind's bearing.
    expect(bare.needle.startsWith("M-84.9 84.9")).toBe(true);
  });

  it("keeps the foot box on the bezel, or pinned inside the clear map", () => {
    expect(footBox("SW 16 g22", "CROSS", 150)).toMatchObject({
      x: 0,
      y: 156.5,
    });
    const pinned = footBox("SW 16 g22", "CROSS", 900, {
      left: -195,
      right: 195,
      bottom: 300,
    });
    expect(pinned.y).toBe(286);
    expect(pinned.x).toBe(0);
    const edge = footBox("SW 16 g22", "CROSS", 150, {
      left: -20,
      right: 400,
      bottom: 900,
    });
    expect(edge.x - edge.w / 2).toBeGreaterThanOrEqual(-20);
  });
});

describe("the loupe's reading", () => {
  it("writes the wind in the rider's units with the way it meets the beach", () => {
    const loupe = loupeRose(rider, { ...day, from: 225 }, DOLLYMOUNT, "kn")!;
    expect(loupe.reading).toBe("SW 16 g22");
    expect(loupe.relation).toBe("CROSS");
    expect(loupe.warn).toBe(false);
    const kmh = loupeRose(rider, { ...day, from: 225 }, DOLLYMOUNT, "km/h")!;
    expect(kmh.reading).toBe("SW 30 g41");
    const off = loupeRose(rider, { ...day, from: 300 }, DOLLYMOUNT, "kn")!;
    expect(off.relation).toBe("OFF");
    expect(off.warn).toBe(true);
    expect(
      loupeRose(rider, { ...day, from: 265 }, DOLLYMOUNT, "kn")!.relation,
    ).toBe("CROSS-OFF");
  });

  it("names the units where there is no beach, and drops a gust no stronger than the wind", () => {
    const point = loupeRose(
      rider,
      { ...day, gustKn: 15, from: 225 },
      null,
      "mph",
    )!;
    expect(point.reading).toBe("SW 18");
    expect(point.relation).toBe("MPH");
    expect(point.warn).toBe(false);
    expect(loupeRose(rider, { ...day, from: null }, null, "kn")).toBeNull();
  });
});
