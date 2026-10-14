import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER } from "../../../../force5/src/stars";
import { colors } from "../../theme/tokens";
import type { Camera } from "./mapLogic";
import { appRideStops } from "./mapStyle";
import {
  advance,
  BINS,
  createSim,
  inkAlpha,
  inkWidth,
  LEVELS,
  loadField,
  SLOTS,
  strength,
  traceRuns,
  TRAIL,
  type FieldMessage,
} from "./particleSim";
import {
  arrowGrid,
  hexOf,
  paceOf,
  parseWindStyle,
  rgbOf,
  screenField,
  tonedColour,
  washBox,
  washImage,
  waterMask,
} from "./windLogic";

const camera: Camera = { center: [-9, 53], zoom: 7, width: 200, height: 300 };
/** A westerly of 8 m/s everywhere west of 0°. */
const westerly = (_lat: number, lon: number) => (lon < 0 ? { u: 8, v: 0, gust: 11 } : null);
const stops = appRideStops(DEFAULT_RIDER);
const ink = rgbOf(colors.ink);

describe("the wind's styles", () => {
  it("keeps the stored style, or ink", () => {
    expect(parseWindStyle("wash")).toBe("wash");
    expect(parseWindStyle("arrows")).toBe("arrows");
    expect(parseWindStyle("neon")).toBe("ink");
    expect(parseWindStyle(null)).toBe("ink");
  });

  it("turns colours to hex and back, and tones them toward the ink", () => {
    expect(hexOf([26, 29, 33])).toBe(colors.ink);
    expect(rgbOf(colors.ink)).toEqual([26, 29, 33]);
    const t = tonedColour(stops, 20, ink);
    expect(t.every((v) => v >= 0 && v <= 255)).toBe(true);
  });
});

describe("the screen's field", () => {
  it("samples every ten points, as steps across the screen", () => {
    const f = screenField(camera, westerly);
    expect(f.w).toBe(21);
    expect(f.h).toBe(31);
    expect(f.data).toHaveLength(21 * 31 * 3);
    const k = paceOf(53, 7);
    expect(f.data[0]).toBeCloseTo(8 * k, 9);
    expect(f.data[1]).toBeCloseTo(-0, 9);
    expect(f.data[2]).toBeCloseTo(8, 9);
  });

  it("leaves no wind where the model has none", () => {
    const f = screenField({ ...camera, center: [0, 53] }, westerly);
    expect(Number.isNaN(f.data[(f.w - 1) * 3])).toBe(true);
    expect(Number.isNaN(f.data[0])).toBe(false);
  });

  it("paces lines more slowly in metres as the chart zooms in", () => {
    expect(paceOf(53, 10)).toBeGreaterThan(paceOf(53, 6));
  });
});

describe("the arrows", () => {
  it("point downwind, coloured on the rider's scale", () => {
    const grid = arrowGrid(camera, westerly, stops, ink);
    expect(grid.features.length).toBeGreaterThan(20);
    const a = grid.features[0].properties;
    // From the west, so pointing east.
    expect(a.rot).toBe(90);
    expect(a.kn).toBe(16);
    expect(a.c).toBe(hexOf(tonedColour(stops, 8 * 1.94384449, ink)));
    expect(arrowGrid(camera, westerly, [], ink).features[0].properties.c).toBe(colors.ink);
  });

  it("leave out calm water and no water", () => {
    expect(arrowGrid(camera, () => ({ u: 0.1, v: 0, gust: null }), stops, ink).features).toHaveLength(0);
    expect(arrowGrid(camera, () => null, stops, ink).features).toHaveLength(0);
  });
});

describe("the wash", () => {
  const grid = { west: -20, east: 10, south: 40, north: 65, dx: 0.02, dy: 0.02 };

  it("paints the view and a third past each edge, strong over the sea", () => {
    const box = washBox(camera);
    const sea = new Uint8Array(box.width * box.height).fill(1);
    const image = washImage(camera, westerly, stops, grid, sea);
    expect(image.width).toBe(box.width);
    expect(image.rgba).toHaveLength(box.width * box.height * 4);
    expect(image.rgba[3]).toBe(Math.round(0.72 * 255));
    const [tl, tr, br, bl] = image.coordinates;
    expect(tl[1]).toBe(tr[1]);
    expect(br[0]).toBe(tr[0]);
    expect(bl[0]).toBe(tl[0]);
    // Faint over land, and in between where the sea is not known.
    expect(washImage(camera, westerly, stops, grid, new Uint8Array(box.width * box.height)).rgba[3]).toBe(Math.round(0.42 * 255));
    expect(washImage(camera, westerly, stops, grid, null).rgba[3]).toBe(Math.round(0.55 * 255));
  });

  it("feathers the model's edge", () => {
    const image = washImage(camera, westerly, stops, { ...grid, west: -9.2 }, null);
    const row = Array.from({ length: image.width }, (_, x) => image.rgba[x * 4 + 3]);
    expect(row[0]).toBe(0);
    expect(row[row.length - 1]).toBe(Math.round(0.55 * 255));
  });

  it("draws the basemap's water into its pixels", () => {
    const square = { type: "Polygon", coordinates: [[[2, 2], [6, 2], [6, 6], [2, 6], [2, 2]]] };
    const mask = waterMask([square], 10, 10, (x, y) => [x, y])!;
    expect(mask[3 * 10 + 3]).toBe(1);
    expect(mask[5 * 10 + 5]).toBe(1);
    expect(mask[1 * 10 + 1]).toBe(0);
    expect(mask[3 * 10 + 7]).toBe(0);
    // Two tiles' overlapping copies stay sea; a hole stays land.
    const holed = {
      type: "Polygon",
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[4, 4], [4, 6], [6, 6], [6, 4], [4, 4]],
      ],
    };
    const m2 = waterMask([holed, { type: "MultiPolygon", coordinates: [[[[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]]] }], 10, 10, (x, y) => [x, y])!;
    expect(m2[2 * 10 + 2]).toBe(1);
    expect(m2[5 * 10 + 5]).toBe(0);
    expect(waterMask([], 10, 10, (x, y) => [x, y])).toBeNull();
  });
});

describe("the ink lines", () => {
  const field = (id: number, cam = "a"): FieldMessage => {
    const w = 21;
    const h = 31;
    const data: number[] = [];
    for (let i = 0; i < w * h; i++) data.push(2, 0, 8);
    return { id, camera: cam, width: 200, height: 300, w, h, step: 10, data, density: 0.4 };
  };
  let seed = 1;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  it("fills the view with lines a trail long, faded in from nothing", () => {
    const sim = createSim(600);
    loadField(sim, field(1), random);
    expect(sim.count).toBe(24);
    expect(sim.fieldId).toBe(1);
    // Whole trails, but for the few that ran off the field and were born again.
    const whole = Array.from(sim.held.subarray(0, sim.count)).filter((n) => n === SLOTS).length;
    expect(whole).toBeGreaterThan(sim.count / 2);
    for (let i = 0; i < sim.count; i++) expect(sim.age[i]).toBe(0);
    expect(strength(sim, 0)).toBeCloseTo(1 / 12, 9);
  });

  it("moves each line downwind by its step", () => {
    const sim = createSim(600);
    loadField(sim, field(1), random);
    const head = (i: number) => sim.trail[i * SLOTS * 2 + sim.head[i] * 2];
    const before = Array.from({ length: sim.count }, (_, i) => head(i));
    advance(sim, random);
    for (let i = 0; i < sim.count; i++) if (sim.age[i] === 1) expect(head(i) - before[i]).toBeCloseTo(2, 5);
  });

  it("keeps the cloud for a new hour on the same camera, and starts again on another", () => {
    const sim = createSim(600);
    loadField(sim, field(1), random);
    for (let s = 0; s < 5; s++) advance(sim, random);
    const ages = Array.from(sim.age.subarray(0, sim.count));
    loadField(sim, field(2), random);
    expect(Array.from(sim.age.subarray(0, sim.count))).toEqual(ages);
    loadField(sim, field(3, "b"), random);
    expect(Array.from(sim.age.subarray(0, sim.count)).every((a) => a === 0)).toBe(true);
  });

  it("lets a line off the field coast out rather than stop", () => {
    const sim = createSim(10);
    loadField(sim, field(1), random);
    sim.count = 1;
    const o = 0;
    sim.trail[o + sim.head[0] * 2] = 205;
    sim.age[0] = 50;
    sim.life[0] = 300;
    advance(sim, random);
    expect(sim.coast[0]).toBe(1);
    expect(sim.life[0]).toBeLessThanOrEqual(51 + 16);
  });

  it("traces runs under keys for the two inks' alphas", () => {
    const sim = createSim(600);
    loadField(sim, field(1), random);
    for (let s = 0; s < 30; s++) advance(sim, random);
    const keys = new Set<number>();
    let starts = 0;
    const runs = traceRuns(sim, (key, _x, _y, start) => {
      keys.add(key);
      if (start) starts++;
    });
    expect(runs).toBe(starts);
    expect(runs).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toBeGreaterThanOrEqual(LEVELS); // 8 m/s: the strong ink
      expect(key).toBeLessThan(BINS * LEVELS);
    }
    expect(inkAlpha(LEVELS * 2 - 1)).toBeCloseTo(0.5, 9);
    expect(inkAlpha(LEVELS - 1)).toBeCloseTo(0.3, 9);
    expect(inkWidth(0)).toBe(1);
    expect(inkWidth(LEVELS)).toBe(1.4);
    expect(TRAIL).toBe(24);
  });
});
