// The published blend as a run of spot squares (src/spotBlend.ts,
// docs/TILING_DESIGN.md decision 6): written by the same layout the blend job
// uses (scripts/runs.mjs, through force5/blend/build.ts) and read back through
// the site's one spot loader. Merging every square gives back exactly the
// places that were split; reading some squares gives exactly theirs.
import { describe, expect, it } from "vitest";
import locations from "../public/riding-locations.json";
import { spotSquare } from "../force5/src/squares";
import { indexed, windManifest } from "../force5/src/testing";
import type { Manifest } from "../force5/src/weather";
import {
  BLEND_KEY,
  blendPrefix,
  buildSpotBlend,
  loadBlendSquares,
  parseSpotBlend,
  SPOT_BLEND_PATH,
  spotBlendHours,
} from "../src/spotBlend";
import { DEFAULT_RIDER } from "../force5/src/stars";
import { publishRun } from "../scripts/runs.mjs";

const PLACES = ["brandon", "dollymount", "rusheen", "rossnowlagh", "ballyholme", "keel"];
const NOW = new Date("2026-09-14T00:20:00Z");

/** A run covering several places, each with a series of its own. */
function spread(manifest: Manifest): Manifest {
  const series = manifest.spotForecasts!.brandon;
  return indexed({
    ...manifest,
    spotForecasts: Object.fromEntries(
      PLACES.map((id, i) => [
        id,
        series.map((step) => ({ ...step, u: step.u + i, v: step.v - i / 2 })),
      ]),
    ),
  });
}

const manifests = [
  spread(
    windManifest({
      model: "harmonie",
      hours: [0, 1, 2, 3, 6],
      wind: (h) => ({ u: 4 + h, v: -1 + h / 2, gust: 8 + h }),
      extra: { resolutionKm: 2 },
    }),
  ),
  spread(
    windManifest({
      model: "ecmwf",
      hours: [0, 3, 6, 12],
      wind: (h) => ({ u: -3 + h / 4, v: 5 - h / 3, gust: h % 2 ? null : 10 }),
      extra: { resolutionKm: null },
    }),
  ),
];
const whole = buildSpotBlend(manifests, NOW);
const published = publishRun(whole, blendPrefix(whole), [], locations) as {
  pointer: Record<string, unknown>;
  base: string;
  files: [string, Buffer][];
};
const files = new Map(
  published.files.map(([path, bytes]) => [path, JSON.parse(bytes.toString())]),
);

/** A reader of the published files, recording what it was asked for. */
function reader(missing: readonly string[] = []) {
  const asked: string[] = [];
  const read = async (path: string) => {
    asked.push(path);
    if (missing.some((square) => path.endsWith(`/${square}.json`)))
      throw new Error(`${path} answered 404.`);
    return files.has(path) ? structuredClone(files.get(path)) : null;
  };
  return Object.assign(read, { asked });
}

describe("the blend as a run of spot squares", () => {
  const pointer = parseSpotBlend(JSON.parse(JSON.stringify(published.pointer)));
  const squares = [...new Set(PLACES.map((id) => {
    const place = locations.find((p) => p.id === id)!;
    return spotSquare(place.lat, place.lon);
  }))].sort();

  it("publishes a pointer with the times and the squares, and no places", () => {
    expect(pointer.schemaVersion).toBe(2);
    expect(pointer.base).toMatch(/^blend-2026091400-12h-v2-[0-9a-f]{8}\/$/);
    expect(pointer.spots).toEqual({
      squareDegrees: 2,
      url: "spots/{square}.json",
      squares,
      keys: [BLEND_KEY],
    });
    expect(BLEND_KEY in published.pointer).toBe(false);
    expect("frames" in published.pointer).toBe(false);
    expect(pointer.times).toEqual(whole.times);
    expect(pointer.sources).toEqual(whole.sources);
    // One file per square, inside the run directory beside the pointer.
    expect([...files.keys()]).toEqual(
      squares.map((square) => `weather/${pointer.base}spots/${square}.json`),
    );
    for (const [path, file] of files)
      expect(file).toMatchObject({ schemaVersion: 2, model: "blend", run: whole.run, square: path.slice(-12, -5) });
  });

  it("gives back exactly the places it split, once every square is merged", async () => {
    const loaded = await loadBlendSquares(reader(), pointer, pointer.spots.squares);
    expect(loaded.spotBlend).toEqual(whole.spotBlend);
    expect(loaded.loaded).toEqual(squares);
    expect(loaded.failed).toEqual([]);
  });

  it("reads only the squares asked for, and never one the blend does not list", async () => {
    const read = reader();
    const dublin = spotSquare(53.365, -6.135);
    const loaded = await loadBlendSquares(read, pointer, [dublin, "n40w080"]);
    expect(Object.keys(loaded.spotBlend)).toEqual(["dollymount"]);
    expect(loaded.loaded).toEqual([dublin]);
    expect(read.asked).toEqual([`weather/${pointer.base}spots/${dublin}.json`]);
    expect(spotBlendHours(loaded, { id: "brandon", lat: 52.276, lon: -10.024, facing: null }, whole.times, DEFAULT_RIDER)).toBeNull();
    expect(spotBlendHours(loaded, { id: "dollymount", lat: 53.365, lon: -6.135, facing: null }, whole.times, DEFAULT_RIDER)).toHaveLength(whole.times.length);
  });

  it("keeps the squares it could read when one cannot be", async () => {
    const broken = spotSquare(54.4, -8.3);
    const loaded = await loadBlendSquares(reader([broken]), pointer, squares);
    expect(loaded.failed).toEqual([broken]);
    expect(loaded.loaded).toEqual(squares.filter((square) => square !== broken));
    expect(loaded.spotBlend.rossnowlagh).toBeUndefined();
    expect(loaded.spotBlend.brandon).toEqual(whole.spotBlend.brandon);
  });

  it("refuses a square from another run, as the loader refuses any", async () => {
    const square = squares[0];
    const path = `weather/${pointer.base}spots/${square}.json`;
    const read = async (asked: string) =>
      asked === path ? { ...files.get(path), run: "2026091323" } : null;
    const loaded = await loadBlendSquares(read, pointer, [square]);
    expect(loaded.failed).toEqual([square]);
    expect(loaded.spotBlend).toEqual({});
  });

  it("refuses a place found in two squares, rather than keeping either", async () => {
    // The loader reads a square at a time, so this is the only place the two
    // could meet; it used to keep whichever square came last.
    const [first, second] = squares;
    const extra = files.get(`weather/${pointer.base}spots/${first}.json`).spotBlend;
    const [place] = Object.keys(extra);
    const read = async (path: string) => {
      const file = structuredClone(files.get(path));
      if (path.endsWith(`/${second}.json`))
        file.spotBlend[place] = extra[place];
      return file;
    };
    await expect(
      loadBlendSquares(read, pointer, [first, second]),
    ).rejects.toThrow(`${place} appears in two spot squares`);
  });

  it("keeps a place called __proto__ as a place", async () => {
    const square = squares[0];
    const path = `weather/${pointer.base}spots/${square}.json`;
    const file = files.get(path);
    const [place] = Object.keys(file.spotBlend);
    const read = async () =>
      JSON.parse(
        JSON.stringify(file).replace(`"${place}":`, '"__proto__":'),
      );
    const loaded = await loadBlendSquares(read, pointer, [square]);
    expect(Object.hasOwn(loaded.spotBlend, "__proto__")).toBe(true);
    expect(loaded.spotBlend["__proto__"]).toEqual(file.spotBlend[place]);
    expect(Object.getPrototypeOf(loaded.spotBlend)).toBeNull();
  });

  it("lives where the site reads it", () => {
    expect(SPOT_BLEND_PATH).toBe("weather/blend.json");
  });
});
