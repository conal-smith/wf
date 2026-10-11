// Spot squares and run directories, held to the fixtures the Python pipeline is
// held to (force5/ingest/test_squares.py): the square key in TypeScript and in
// the sample generator's JavaScript copy, and the run directory hash.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SQUARE_DEGREES,
  SQUARE_NAME,
  spotSquare,
  squaresFor,
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
