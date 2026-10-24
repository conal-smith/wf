import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentsManifest } from "../force5/src/currents";
import { runPath } from "../force5/src/spotData";
import { pointerOf, squareReader, waveManifest } from "../force5/src/testing";

/**
 * The dock's Current row as src/currentsData.ts reads it: a riding place's
 * published series from its spot square, a tapped point's nearest water in
 * the run's frames, and a note in place of the row when there is nothing.
 */

const VARIABLES = {
  u: { units: "m/s", label: "Current, east", description: "East." },
  v: { units: "m/s", label: "Current, north", description: "North." },
};
const RUN = "2026-10-22T00:00:00Z";
const hourAt = (hour: number) =>
  new Date(Date.parse(RUN) + hour * 3600000).toISOString();
/** Round Brandon Bay, every fourth cell of ROMS's grid as the frames take. */
const GRID = {
  width: 4,
  height: 3,
  west: -10.15,
  east: -10.0,
  north: 52.35,
  south: 52.25,
  dx: 0.05,
  dy: 0.05,
};
const LAND = new Set([0, 4, 8]); // the western column

function merged(series: (hour: number) => Record<string, number | null>) {
  return {
    ...waveManifest({
      model: "currents",
      runTime: RUN,
      hours: [0, 1, 2],
      spotId: "brandon",
      variables: VARIABLES as never,
      values: series,
      withFrames: true,
      extra: { grid: GRID },
    }),
    kind: "current",
    modelName: "NE Atlantic ROMS",
  } as unknown as CurrentsManifest & { spotSeries: unknown };
}

/** Each hour the water runs east a tenth of a metre a second faster. */
const frameOf = (manifest: CurrentsManifest, hour: number) => ({
  model: "currents",
  run: manifest.run,
  hour,
  validTime: hourAt(hour),
  grid: GRID,
  u: Array.from({ length: 12 }, (_, i) =>
    LAND.has(i) ? null : 0.1 * (hour + 1),
  ),
  v: Array.from({ length: 12 }, (_, i) => (LAND.has(i) ? null : 0)),
});

let asked: string[];
function serve(manifest: ReturnType<typeof merged> | null) {
  asked = [];
  const squares = manifest ? squareReader(manifest as never) : null;
  vi.stubGlobal("fetch", async (url: string) => {
    const path = url.replace(/^\//, "");
    asked.push(path);
    const body = await (async () => {
      if (!manifest) return null;
      if (path === "weather/currents.json") return pointerOf(manifest);
      const frame = /frames\/(\d{3})\.json$/.exec(path);
      if (
        frame &&
        path ===
          runPath(
            "weather/currents.json",
            manifest.base,
            `frames/${frame[1]}.json`,
          )
      )
        return frameOf(manifest, Number(frame[1]));
      return squares!(path);
    })();
    return body === null
      ? new Response("", { status: 404 })
      : new Response(JSON.stringify(body), { status: 200 });
  });
}

// The module keeps the pointer and the frames it has read: each test a fresh one.
const load = () => import("./currentsData");
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

const AXIS = [hourAt(-1), hourAt(0), hourAt(1), hourAt(2), hourAt(6)];

describe("a riding place's Current row", () => {
  it("reads the place's series from its one square, on the dock's columns", async () => {
    serve(merged((hour) => ({ u: 0, v: hour ? 0.3 : 0.02 })));
    const { spotCurrentRow } = await load();
    const row = await spotCurrentRow(
      { id: "brandon", lat: 52.27, lon: -10.08 },
      AXIS,
    );
    expect(row.note).toBeNull();
    expect(row.model).toBe("NE Atlantic ROMS");
    expect(row.columns.map((c) => c && +c.speed.toFixed(2))).toEqual([
      null,
      0.02,
      0.3,
      0.3,
      null,
    ]);
    expect(row.columns[2]?.towards).toBeCloseTo(0);
    // The pointer and the square, and no frame.
    expect(asked.some((path) => /frames\//.test(path))).toBe(false);
    expect(asked.filter((path) => /\/spots\//.test(path))).toHaveLength(1);
  });

  it("says so once when the model has no water near the place", async () => {
    serve(merged(() => ({ u: null, v: null })));
    const { spotCurrentRow } = await load();
    const row = await spotCurrentRow(
      { id: "brandon", lat: 52.27, lon: -10.08 },
      AXIS,
    );
    expect(row).toEqual({
      columns: [],
      note: "No current model reaches this spot",
      model: null,
    });
  });

  it("and when its run does not reach the dock's hours", async () => {
    serve(merged(() => ({ u: 0.2, v: 0 })));
    const { spotCurrentRow } = await load();
    const row = await spotCurrentRow(
      { id: "brandon", lat: 52.27, lon: -10.08 },
      [hourAt(30), hourAt(31)],
    );
    expect(row.note).toBe("The current forecast does not reach these hours");
  });

  it("and when no current forecast is published", async () => {
    serve(null);
    const { spotCurrentRow, pointCurrentRow } = await load();
    const spot = await spotCurrentRow(
      { id: "brandon", lat: 52.27, lon: -10.08 },
      AXIS,
    );
    expect(spot.note).toBe("No current forecast is published just now");
    const point = await pointCurrentRow(52.3, -10.05, AXIS);
    expect(point.note).toBe("No current forecast is published just now");
  });
});

describe("a tapped point's Current row", () => {
  it("reads the nearest water in each hour's frame", async () => {
    serve(merged(() => ({ u: 0, v: 0 })));
    const { pointCurrentRow } = await load();
    // On the western column's land: the water a cell east.
    const row = await pointCurrentRow(52.3, -10.14, AXIS);
    expect(row.note).toBeNull();
    expect(row.columns.map((c) => c && +c.speed.toFixed(2))).toEqual([
      null,
      0.1,
      0.2,
      0.3,
      null,
    ]);
    expect(row.columns[1]?.towards).toBeCloseTo(90);
    // The run's three frames, each once, and no spot square.
    const frames = asked.filter((path) => /frames\//.test(path));
    expect(new Set(frames).size).toBe(3);
    expect(frames).toHaveLength(3);
    expect(asked.some((path) => /\/spots\//.test(path))).toBe(false);
  });

  it("says so once off the model's grid, having read one frame at most", async () => {
    serve(merged(() => ({ u: 0, v: 0 })));
    const { pointCurrentRow } = await load();
    const row = await pointCurrentRow(53.5, -6.2, AXIS);
    expect(row).toEqual({
      columns: [],
      note: "No current model reaches this point",
      model: null,
    });
    expect(
      asked.filter((path) => /frames\//.test(path)).length,
    ).toBeLessThanOrEqual(1);
  });
});
