import { describe, expect, it } from "vitest";
import {
  CURRENT_POINT_KM,
  currentAt,
  currentText,
  currentsAtAxis,
  currentsFrameAt,
  nearestWetCell,
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

describe("nearestWetCell: a tapped point's cell in the map's frames", () => {
  // The frames' own spacing (every fourth cell of ROMS's 0.0125°), five by
  // five, rows north to south as modelArrows reads them.
  const grid = {
    width: 5,
    height: 5,
    west: -10,
    east: -9.8,
    north: 53,
    south: 52.8,
    dx: 0.05,
    dy: 0.05,
  };
  const at = (x: number, y: number) => y * grid.width + x;
  /** Water everywhere but the cells named, which are land (null). */
  const frame = (...land: [number, number][]) => {
    const u: (number | null)[] = Array(25).fill(0.2);
    const v: (number | null)[] = Array(25).fill(-0.1);
    for (const [x, y] of land) u[at(x, y)] = v[at(x, y)] = null;
    return { u, v };
  };

  it("reads the cell the point is on", () => {
    const cell = nearestWetCell(frame(), grid, 52.9, -9.9);
    expect(cell?.index).toBe(at(2, 2));
    expect(cell?.km).toBeCloseTo(0, 6);
    expect(cell?.lat).toBeCloseTo(52.9);
    expect(cell?.lon).toBeCloseTo(-9.9);
  });

  it("goes to the nearest water when the point's own cell is land", () => {
    // Land on the point's cell and those north and south of it: the water
    // a cell east or west (3.4 km) is nearer than a cell north (5.6 km).
    const cell = nearestWetCell(
      frame([2, 2], [2, 1], [2, 3]),
      grid,
      52.9,
      -9.89,
    );
    expect(cell?.index).toBe(at(3, 2));
    expect(cell?.km).toBeGreaterThan(2);
    expect(cell?.km).toBeLessThan(3);
  });

  it("reaches one cell's diagonal where the cells are further apart than 5 km", () => {
    // Every cell of the ring round the point is land but a corner one,
    // 6.5 km off: past CURRENT_POINT_KM, inside a cell's diagonal.
    const ring: [number, number][] = [
      [2, 2],
      [1, 1],
      [2, 1],
      [1, 2],
      [3, 2],
      [1, 3],
      [2, 3],
      [3, 3],
    ];
    const cell = nearestWetCell(frame(...ring), grid, 52.9, -9.9);
    expect(cell?.index).toBe(at(3, 1));
    expect(cell!.km).toBeGreaterThan(CURRENT_POINT_KM);
  });

  it("finds none beyond that, inland or off the grid", () => {
    const land: [number, number][] = [];
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 5; x++) if (x < 4) land.push([x, y]);
    // The only water two cells and more east of a point at the west edge.
    expect(nearestWetCell(frame(...land), grid, 52.9, -10)).toBeNull();
    expect(nearestWetCell(frame(), grid, 53.5, -9.9)).toBeNull();
    expect(nearestWetCell(frame(), grid, 52.9, -8)).toBeNull();
  });

  it("reads the cell's current, and none on land", () => {
    const f = frame([0, 0]);
    expect(currentAt(f, at(0, 0))).toBeNull();
    const reading = currentAt(f, at(1, 1))!;
    expect(reading.speed).toBeCloseTo(Math.hypot(0.2, 0.1));
    expect(reading.towards).toBeCloseTo(towards(0.2, -0.1));
  });
});

describe("currentsAtAxis: a spot's series on the dock's columns", () => {
  const step = (time: string, u: number | null, v: number | null) => ({
    validTime: time,
    values: { u, v },
  });
  const series = [
    step("2026-10-22T00:00:00Z", 0, 0.5),
    step("2026-10-22T01:00:00Z", 0.5, 0),
    step("2026-10-22T02:00:00Z", null, null),
  ];

  it("takes the step of each column's hour, and none past half an hour", () => {
    const columns = currentsAtAxis(series, [
      "2026-10-21T23:00:00Z",
      "2026-10-22T00:00:00Z",
      "2026-10-22T01:20:00Z",
      "2026-10-22T02:00:00Z",
      "2026-10-22T03:00:00Z",
    ]);
    expect(columns[0]).toBeNull();
    expect(columns[1]).toEqual({ speed: 0.5, towards: 0 });
    // Twenty minutes off its step is still that hour's current.
    expect(columns[2]?.speed).toBeCloseTo(0.5);
    expect(columns[2]?.towards).toBeCloseTo(90);
    // A step with no water, and past the run's end: nothing.
    expect(columns[3]).toBeNull();
    expect(columns[4]).toBeNull();
  });

  it("says the speed in the rider's units, to a tenth", () => {
    expect(currentText(0.5, "kn")).toBe("1.0 kn");
    expect(currentText(0.5, "km/h")).toBe("1.8 km/h");
    expect(currentText(0.5, "m/s")).toBe("0.5 m/s");
  });
});
