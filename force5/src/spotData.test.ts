import { describe, expect, it } from "vitest";
import {
  checkBase,
  loadSpotSquares,
  runPath,
  squarePath,
  withSpotSquares,
  type ReadJson,
} from "./spotData";
import {
  ensembleManifest,
  pointerOf,
  squareReader,
  waveManifest,
  windManifest,
} from "./testing";
import type { Manifest } from "./weather";

/** A run with spots in three squares, as a reader holds it merged. */
const whole = windManifest({
  model: "harmonie",
  extra: {
    spotForecasts: {
      brandon: windManifest().spotForecasts!.brandon,
      keel: windManifest().spotForecasts!.brandon,
      dollymount: windManifest().spotForecasts!.brandon,
    },
  },
});
const run = pointerOf(whole);
const POINTER = "weather/harmonie.json";

describe("the spot square loader", () => {
  it("reads every listed square and gives back exactly what was split", async () => {
    expect(run.spots.squares).toEqual(["n52w008", "n52w012"]);
    const read = squareReader(whole);
    const data = await loadSpotSquares(read, POINTER, run);
    expect(data).toEqual({ spotForecasts: whole.spotForecasts });
    expect(read.asked).toEqual([
      "weather/harmonie-2026091400-test-v1-0a0b0c0d/spots/n52w008.json",
      "weather/harmonie-2026091400-test-v1-0a0b0c0d/spots/n52w012.json",
    ]);
  });
  it("reads only the squares asked for, and skips one the run does not list", async () => {
    const read = squareReader(whole);
    const data = await loadSpotSquares<Manifest>(read, POINTER, run, [
      "n52w008",
      "s10e010",
      "n52w008",
    ]);
    expect(Object.keys(data.spotForecasts!)).toEqual(["dollymount"]);
    expect(read.asked).toHaveLength(1);
  });
  it("keeps what it read, and shares a read still in flight", async () => {
    const read = squareReader(whole);
    const [a, b] = await Promise.all([
      loadSpotSquares(read, POINTER, run, ["n52w012"]),
      loadSpotSquares(read, POINTER, run, ["n52w012"]),
    ]);
    expect(a).toEqual(b);
    await loadSpotSquares(read, POINTER, run);
    expect(read.asked).toHaveLength(2);
    // Another reader keeps its own: a cache is per reader.
    const other = squareReader(whole);
    await loadSpotSquares(other, POINTER, run, ["n52w012"]);
    expect(other.asked).toHaveLength(1);
  });
  it("tries again after a failed read", async () => {
    const good = squareReader(whole);
    let fail = true;
    const flaky: ReadJson = async (path) => {
      if (fail) throw new Error("offline");
      return good(path);
    };
    await expect(loadSpotSquares(flaky, POINTER, run)).rejects.toThrow(
      "offline",
    );
    fail = false;
    expect(await loadSpotSquares(flaky, POINTER, run)).toEqual({
      spotForecasts: whole.spotForecasts,
    });
  });
  it("carries every per-spot key the run declares, members and coverage too", async () => {
    const ens = ensembleManifest({ withFrames: true });
    const data = await loadSpotSquares(
      squareReader(ens),
      "weather/ecmwf-ens.json",
      pointerOf(ens),
    );
    expect(data).toEqual({
      spotForecasts: ens.spotForecasts,
      spotMembers: ens.spotMembers,
    });
    const wave = waveManifest({
      extra: {
        spotCoverage: { brandon: { landMasked: false, resolved: true } },
      },
    });
    expect(
      await withSpotSquares(
        squareReader(wave),
        "weather/gfs-wave.json",
        pointerOf(wave),
      ),
    ).toEqual(wave);
  });
  it("refuses a missing square, a square of another run, and a spot in two squares", async () => {
    const read = squareReader(whole);
    await expect(
      loadSpotSquares(async () => null, POINTER, run),
    ).rejects.toThrow(/missing/);
    const relabel =
      (change: Record<string, unknown>): ReadJson =>
      async (path) => ({ ...((await read(path)) as object), ...change });
    for (const change of [
      { run: "2026091300" },
      { model: "gfs" },
      { square: "n54w010" },
      { schemaVersion: 1 },
      { spotSeries: { brandon: [] } },
      { spotForecasts: {} },
    ])
      await expect(
        loadSpotSquares(relabel(change), POINTER, run),
      ).rejects.toThrow();
    const twice: ReadJson = async (path) => {
      const body = (await read(path)) as Record<string, unknown>;
      return {
        ...body,
        spotForecasts: { ...(body.spotForecasts as object), keel: [] },
      };
    };
    await expect(loadSpotSquares(twice, POINTER, run)).rejects.toThrow(
      /two spot squares/,
    );
  });
  it("treats spots named like an object's own properties as spots", async () => {
    // Parsed from JSON, as every square is: `__proto__` is then an own key.
    const named: ReadJson = async (path) => {
      const square = path.match(/([ns]\d\d[ew]\d{3})\.json$/)![1];
      return JSON.parse(
        JSON.stringify({
          schemaVersion: 2,
          model: run.model,
          run: run.run,
          square,
        }).replace(
          /}$/,
          square === "n52w008"
            ? ',"spotForecasts":{"constructor":[1],"__proto__":[2]}}'
            : ',"spotForecasts":{"toString":[3]}}',
        ),
      );
    };
    const data = await loadSpotSquares(named, POINTER, run);
    const spots = data.spotForecasts!;
    expect(Object.keys(spots).sort()).toEqual([
      "__proto__",
      "constructor",
      "toString",
    ]);
    expect(Object.hasOwn(spots, "__proto__")).toBe(true);
    expect(spots["__proto__"]).toEqual([2]);
    expect(spots.constructor).toEqual([1]);
    // And a spot in two squares is refused whatever it is called.
    const twice: ReadJson = async (path) =>
      JSON.parse(
        JSON.stringify({
          schemaVersion: 2,
          model: run.model,
          run: run.run,
          square: path.match(/([ns]\d\d[ew]\d{3})\.json$/)![1],
        }).replace(/}$/, ',"spotForecasts":{"__proto__":[1]}}'),
      );
    await expect(loadSpotSquares(twice, POINTER, run)).rejects.toThrow(
      /__proto__ appears in two spot squares/,
    );
  });
  it("never reads outside the run directory", async () => {
    for (const base of [
      "../harmonie-2026091400-test-v1-0a0b0c0d/",
      "harmonie-2026091400-test-v1-0a0b0c0d",
      "/harmonie-2026091400-test-v1-0a0b0c0d/",
      "a/harmonie-2026091400-test-v1-0a0b0c0d/",
    ])
      await expect(
        loadSpotSquares(squareReader(whole), POINTER, { ...run, base }),
      ).rejects.toThrow(/run directory/);
    expect(() => checkBase("harmonie-2026091400-test-v1-0A0B0C0D/")).toThrow();
    for (const relative of [
      "../x",
      "frames/../../x",
      "/x",
      "frames//x",
      "a\\b",
      // What a URL parser reads as something else: an encoded `..` or `/`, a
      // tab or newline it drops, a query or a fragment.
      "%2e%2e/x",
      "frames/%2E%2E/%2e%2e/x",
      "frames%2F000.bin",
      "frames/.\t./x",
      "frames/.\n./x",
      "frames/000.bin?x",
      "frames/000.bin#x",
      "frames/0 0.bin",
    ])
      expect(() =>
        runPath(POINTER, "harmonie-2026091400-test-v1-0a0b0c0d/", relative),
      ).toThrow();
    // Each of those, as a browser would have fetched it, leaves the run.
    const base =
      "https://forecast.example/weather/harmonie-2026091400-test-v1-0a0b0c0d/";
    for (const escape of ["%2e%2e/x", "frames/.\t./.\n./x"])
      expect(new URL(escape, base).pathname).not.toContain(
        "harmonie-2026091400-test-v1-0a0b0c0d",
      );
    expect(squarePath("weather/latest.json", pointerOf(whole), "n52w010")).toBe(
      "weather/harmonie-2026091400-test-v1-0a0b0c0d/spots/n52w010.json",
    );
  });
});
