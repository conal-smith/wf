import { describe, expect, it } from "vitest";
import {
  currentText,
  currentsFrameAt,
  modelArrows,
  streamFeature,
  streamFeatures,
  towards,
  validateCurrentsFrame,
  validateCurrentsManifest,
  type CurrentsManifest,
} from "./currents";
import { TIDAL_STREAM_SITES } from "./tidalStreams";
import { pointerOf, testGrid, waveManifest } from "./testing";

const VARIABLES = {
  u: { units: "m/s", label: "Current, east", description: "East." },
  v: { units: "m/s", label: "Current, north", description: "North." },
};

const manifest = (): CurrentsManifest =>
  ({
    ...pointerOf(
      waveManifest({
        model: "currents",
        runTime: "2026-10-22T00:00:00Z",
        hours: [0, 1, 2],
        variables: VARIABLES,
        values: () => ({ u: 0.1, v: -0.2 }),
        withFrames: true,
      }),
    ),
    kind: "current",
  }) as unknown as CurrentsManifest;

describe("towards", () => {
  it("is the bearing the water runs to", () => {
    expect(towards(0, 1)).toBeCloseTo(0);
    expect(towards(1, 0)).toBeCloseTo(90);
    expect(towards(0, -1)).toBeCloseTo(180);
    expect(towards(-1, 0)).toBeCloseTo(270);
  });
});

describe("the currents pointer and frames", () => {
  it("accepts a current run and refuses a wave run", () => {
    expect(validateCurrentsManifest(manifest()).kind).toBe("current");
    expect(() =>
      validateCurrentsManifest({ ...manifest(), kind: "wave" } as never),
    ).toThrow();
  });

  it("finds the frame of the hour, and none past half an hour away", () => {
    const m = manifest();
    const t = Date.parse("2026-10-22T01:20:00Z");
    expect(currentsFrameAt(m, t)?.hour).toBe(1);
    expect(currentsFrameAt(m, Date.parse("2026-10-22T03:00:00Z"))).toBeNull();
  });

  it("checks a frame against its grid and run", () => {
    const m = manifest();
    const info = m.frames[1];
    const frame = {
      model: "currents",
      run: m.run,
      hour: 1,
      validTime: info.validTime,
      grid: testGrid,
      u: [0.1, null, 0.3, 0.02],
      v: [0.2, null, -0.4, 0.01],
    };
    expect(validateCurrentsFrame(frame, m, info)).toBe(frame);
    expect(() =>
      validateCurrentsFrame({ ...frame, u: [0.1] }, m, info),
    ).toThrow();
    expect(() =>
      validateCurrentsFrame({ ...frame, v: [0.2, null, 99, 0] }, m, info),
    ).toThrow();
    expect(() =>
      validateCurrentsFrame({ ...frame, hour: 2 }, m, info),
    ).toThrow();
  });
});

describe("modelArrows", () => {
  it("draws every wet cell worth an arrow, rows north to south", () => {
    const arrows = modelArrows(
      { u: [0.1, null, 0.3, 0.02], v: [0.2, null, -0.4, 0.01] },
      testGrid,
      "kn",
    );
    // Land and the cell under 0.05 m/s are left out.
    expect(arrows).toHaveLength(2);
    expect(arrows[0].geometry.coordinates).toEqual([-10, 54]);
    expect(arrows[1].geometry.coordinates).toEqual([-10, 53]);
    expect(arrows[1].properties.speed).toBeCloseTo(0.5);
    expect(arrows[1].properties.towards).toBe(143);
    expect(arrows[1].properties.label).toBe("1.0 kn");
    // The faster arrow is placed first.
    expect(arrows[1].properties.rank).toBeLessThan(arrows[0].properties.rank);
  });
});

describe("the channels' streams on the map", () => {
  const narrows = TIDAL_STREAM_SITES.find(
    (s) => s.id === "strangford-narrows",
  )!;

  it("labels a stream in the rider's units, and slack as slack", () => {
    const stream = {
      stream: "ebb" as const,
      slack: false,
      knots: 6.2,
      towards: 160,
      peakKnots: 7.4,
      rangeMetres: 2.9,
      from: 0,
      until: 1,
    };
    expect(streamFeature(narrows, stream, "kn").properties).toMatchObject({
      kind: "ebb",
      towards: 160,
      label: "Ebb 6.2 kn",
      rank: -1000,
    });
    expect(streamFeature(narrows, stream, "km/h").properties.label).toBe(
      "Ebb 11.5 km/h",
    );
    expect(
      streamFeature(narrows, { ...stream, slack: true, knots: 0.2 }, "kn")
        .properties,
    ).toMatchObject({ kind: "slack", label: "slack" });
    expect(currentText(1, "m/s")).toBe("1.0 m/s");
  });

  it("leaves out a site whose station has no curve", () => {
    expect(streamFeatures({}, Date.now(), "kn")).toEqual([]);
  });
});
