// Spot squares and run directories, held to the fixtures the Python pipeline is
// held to (force5/ingest/test_squares.py): the square key in TypeScript and in
// the sample generator's JavaScript copy, and the run directory hash.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SQUARE_DEGREES,
  SQUARE_NAME,
  spotSquare,
  squareCorner,
  squaresFor,
  squaresInView,
  squaresToRead,
  VIEW_SQUARE_LIMIT,
} from "../force5/src/squares";
import {
  publishRun,
  runDigest,
  spotSquare as scriptSquare,
  SQUARE_DEGREES as SCRIPT_DEGREES,
} from "../scripts/runs.mjs";

const squares = JSON.parse(
  readFileSync("tests/fixtures/squares.json", "utf8"),
) as {
  squareDegrees: number;
  cases: { name: string; lat: number; lon: number; square: string }[];
};
const digest = JSON.parse(
  readFileSync("tests/fixtures/run-digest.json", "utf8"),
) as {
  files: Record<string, string>;
  digest: string;
  oneByteChanged: { path: string; content: string; digest: string };
};

describe("spot squares", () => {
  it("names every shared case as the Python pipeline does", () => {
    expect(SQUARE_DEGREES).toBe(squares.squareDegrees);
    expect(SCRIPT_DEGREES).toBe(squares.squareDegrees);
    for (const { name, lat, lon, square } of squares.cases) {
      expect(spotSquare(lat, lon), name).toBe(square);
      expect(scriptSquare(lat, lon), name).toBe(square);
    }
  });
  it("always gives a well-formed name, and refuses an impossible point", () => {
    for (let lat = -90; lat <= 90; lat += 7)
      for (let lon = -180; lon <= 180; lon += 13)
        expect(spotSquare(lat, lon)).toMatch(SQUARE_NAME);
    for (const [lat, lon] of [
      [91, 0],
      [-91, 0],
      [NaN, 0],
      [0, Infinity],
    ])
      expect(() => spotSquare(lat, lon)).toThrow();
  });
  it("gives the sorted, distinct squares of a list of places", () => {
    expect(
      squaresFor([
        { lat: 54.5, lon: -9.5 },
        { lat: 53.37, lon: -6.17 },
        { lat: 54.1, lon: -9.9 },
      ]),
    ).toEqual(["n52w008", "n54w010"]);
  });
});

describe("run directories", () => {
  const files = (overrides: Record<string, string> = {}) =>
    Object.entries({ ...digest.files, ...overrides }).map(
      ([path, text]) => [path, Buffer.from(text)] as [string, Buffer],
    );

  it("hash as the Python publisher hashes them", () => {
    expect(runDigest(files())).toBe(digest.digest);
    expect(runDigest(files().reverse())).toBe(digest.digest);
  });
  it("change name when one byte changes", () => {
    const { path, content } = digest.oneByteChanged;
    expect(runDigest(files({ [path]: content }))).toBe(
      digest.oneByteChanged.digest,
    );
  });
  it("land in the same directory for the same content", () => {
    const whole = {
      schemaVersion: 1,
      model: "harmonie",
      run: "2026101106",
      frames: [{ hour: 0, validTime: "2026-10-11T06:00:00Z", url: "x" }],
      spotForecasts: { keel: [{ hour: 0 }], brandon: [{ hour: 0 }] },
    };
    const spots = [
      { id: "keel", lat: 53.971, lon: -10.067 },
      { id: "brandon", lat: 52.276, lon: -10.024 },
    ];
    const frame: [number, string, Buffer][] = [[0, "bin", Buffer.from("F5F1")]];
    const first = publishRun(whole, "harmonie-2026101106-0h-v1", frame, spots);
    const again = publishRun(whole, "harmonie-2026101106-0h-v1", frame, spots);
    expect(again.base).toBe(first.base);
    expect(first.base).toMatch(/^harmonie-2026101106-0h-v1-[0-9a-f]{8}\/$/);
    expect(first.pointer.spots.squares).toEqual(["n52w012"]);
    expect(first.pointer).not.toHaveProperty("spotForecasts");
    expect(first.files.map(([path]) => path)).toEqual([
      `weather/${first.base}frames/000.bin`,
      `weather/${first.base}spots/n52w012.json`,
    ]);
    const changed = publishRun(
      whole,
      "harmonie-2026101106-0h-v1",
      [[0, "bin", Buffer.from("F5F2")]],
      spots,
    );
    expect(changed.base).not.toBe(first.base);
  });
});

describe("the squares in view", () => {
  // Ireland's ten squares, as the blend and the models list them.
  const IRELAND = [
    "n50w008", "n50w010", "n50w012", "n52w008", "n52w010",
    "n52w012", "n54w006", "n54w008", "n54w010", "n54w012",
  ];

  it("reads a square's corner back from its name", () => {
    expect(squareCorner("n52w010")).toEqual({ lat: 52, lon: -10 });
    expect(squareCorner("s02e178")).toEqual({ lat: -2, lon: 178 });
    expect(squareCorner("x52w010")).toBeNull();
  });

  it("takes every listed square a view spans, and none it does not", () => {
    // Dublin Bay, well inside n52w008, with no margin: that square alone.
    const bay = { west: -6.4, south: 53.2, east: -6.0, north: 53.5 };
    expect(squaresInView(bay, IRELAND, { margin: 0 })).toEqual(["n52w008"]);
    // Across the corner of four squares.
    const corner = { west: -8.5, south: 53.5, east: -7.5, north: 54.5 };
    expect(squaresInView(corner, IRELAND, { margin: 0 })).toEqual(
      ["n52w010", "n52w008", "n54w010", "n54w008"].sort(),
    );
    // Touching a square's edge is not overlapping it.
    const edge = { west: -8, south: 52.5, east: -7, north: 53.5 };
    expect(squaresInView(edge, IRELAND, { margin: 0 })).toEqual(["n52w008"]);
  });

  it("grows the view by its margin before it looks", () => {
    const bay = { west: -6.4, south: 53.2, east: -6.0, north: 53.5 };
    // A third of 0.4° west is 0.13°: still inside n52w008.
    expect(squaresInView(bay, IRELAND)).toEqual(["n52w008"]);
    // Galway Bay with a margin reaches over the 10° W line into n52w012.
    const galway = { west: -9.9, south: 53.0, east: -8.9, north: 53.4 };
    expect(squaresInView(galway, IRELAND, { margin: 0 })).toEqual(["n52w010"]);
    expect(squaresInView(galway, IRELAND)).toEqual(["n52w010", "n52w012"]);
  });

  it("takes all of Ireland's squares at the all-Ireland view", () => {
    const all = { west: -11, south: 51.3, east: -5.3, north: 55.5 };
    expect(squaresInView(all, IRELAND)).toEqual(IRELAND);
  });

  it("asks for nothing where the run lists no squares", () => {
    const biscay = { west: -6, south: 44, east: -2, north: 46.5 };
    expect(squaresInView(biscay, IRELAND)).toEqual([]);
    const inverted = { west: 0, south: 0, east: -1, north: 1 };
    expect(squaresInView(inverted, IRELAND)).toEqual([]);
  });

  it("keeps to the squares nearest the centre past its limit", () => {
    // A continent of squares: every 2° from 36° N to 70° N, 20° W to 40° E.
    const europe: string[] = [];
    for (let lat = 36; lat < 70; lat += 2)
      for (let lon = -20; lon < 40; lon += 2)
        europe.push(spotSquare(lat + 1, lon + 1));
    const view = { west: -20, south: 36, east: 40, north: 70 };
    const got = squaresInView(view, europe);
    expect(got).toHaveLength(VIEW_SQUARE_LIMIT);
    // Centred on 53° N 10° E: the square holding the centre is in.
    expect(got).toContain(spotSquare(53, 10));
    expect(got).not.toContain(spotSquare(37, -19));
    expect(squaresInView(view, europe, { limit: 4 })).toHaveLength(4);
  });

  it("wraps round the antimeridian, as MapLibre's bounds do", () => {
    const listed = ["n50e178", "n50w180", "n50w178", "n50w176"];
    // 179° E to 181° E, which MapLibre gives as east 181.
    const across = { west: 179, south: 50.5, east: 181, north: 51.5 };
    expect(squaresInView(across, listed, { margin: 0 })).toEqual([
      "n50e178",
      "n50w180",
    ]);
  });

  it("adds the reader's own places wherever they are, if the run lists them", () => {
    const bay = { west: -6.4, south: 53.2, east: -6.0, north: 53.5 };
    const brandon = { lat: 52.276, lon: -10.024 };
    const lisbon = { lat: 38.7, lon: -9.2 };
    expect(squaresToRead(bay, IRELAND, [brandon, lisbon])).toEqual([
      "n52w008",
      "n52w012",
    ]);
    // Before the map has a view: the reader's own places alone.
    expect(squaresToRead(null, IRELAND, [brandon])).toEqual(["n52w012"]);
  });
});
