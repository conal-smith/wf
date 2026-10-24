import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fixtureFetch, readBundle, readFrame, readRun } from "./bundles";
import { validateManifest, validateWindSpots } from "../force5/src/weather";
import type { Manifest, Spot } from "../force5/src/weather";
import { clearTileCache, samplePoint } from "../force5/src/tiledField";
import {
  validateWaveManifest,
  validateWaveSpots,
  waveCoverageNote,
  waveHours,
  type WaveManifest,
} from "../force5/src/waves";
import {
  validateWeatherManifest,
  validateWeatherSpots,
  weatherFields,
  weatherHours,
  type WeatherManifest,
} from "../force5/src/surface";

/**
 * A whole published bundle, end to end: every frame file agrees with its
 * manifest, and every precomputed spot summary agrees with the grid it came
 * from. The data is synthetic (tests/fixtures/weather, written by
 * scripts/sample-weather.mjs) because no forecast output is committed, but it is
 * in exactly the published format, so this is the check that the format hangs
 * together — a series that drifted from its frames would fail here.
 *
 * Every manifest carries a series for every riding place. Runs published before
 * `riding-locations.json` existed held only the original eight; their series
 * were recomputed from their own frames by `force5/ingest/backfill_spots.py`, so
 * there is no longer a partial snapshot and the blend is available everywhere
 * the map offers a spot.
 *
 * Each pointer is validated as published, without its spot data, and every
 * spot square of its run is then read through the site's own loader
 * (force5/src/spotData.ts) and checked as it arrives.
 */
const places: Spot[] = JSON.parse(
  readFileSync("public/riding-locations.json", "utf8"),
);
const placeIds = places.map((place) => place.id);
const originalIds: string[] = JSON.parse(
  readFileSync("public/spots.json", "utf8"),
).map((spot: Spot) => spot.id);

describe.each(["latest", "harmonie", "ecmwf", "gfs", "arpege"])(
  "published %s wind bundle",
  (name) => {
    // The tiles are read the way the map reads them: through TiledField, over
    // a fetch that serves the fixtures at the URLs the site asks for.
    const served = fixtureFetch();
    beforeAll(() => {
      clearTileCache();
      vi.stubGlobal("fetch", served);
    });
    afterAll(() => vi.unstubAllGlobals());

    it("all files match the manifest and all spot summaries match their wind grid", async () => {
      validateManifest(readBundle<Manifest>(name));
      const m = validateWindSpots(await readRun<Manifest>(name));
      // A tile stores tenths of a metre per second while the spot series beside
      // it is the full-precision value rounded to hundredths, so the two may
      // differ by the quantisation (0.05) plus both roundings. See
      // force5/ingest/f5bin.py and backfill_spots.py, which allows the same.
      const limit = 0.06;
      // Exactly the published catalogue: no riding place missing, none invented.
      expect(Object.keys(m.spotForecasts!).sort()).toEqual(
        [...placeIds].sort(),
      );
      for (const id of originalIds) expect(m.spotForecasts![id]).toBeTruthy();
      for (const [i, info] of m.frames.entries()) {
        for (const spot of places) {
          // The native tile holding the spot: what a bare point reads too.
          const wind = (await samplePoint(m, i, spot.lat, spot.lon))!;
          const summary = m.spotForecasts![spot.id][i];
          expect(summary.validTime).toBe(info.validTime);
          // Every riding place sits inside every bundled grid, so a null u or v
          // would mean the series and the frames describe different points.
          for (const field of ["u", "v"] as const) {
            expect(typeof summary[field]).toBe("number");
            expect(
              Math.abs(wind[field]! - summary[field]!),
            ).toBeLessThanOrEqual(limit);
          }
          // A null gust is only ever a declared absence, never a quiet gap.
          if (wind.gust === null || summary.gust === null) {
            expect(wind.gust).toBeNull();
            expect(summary.gust).toBeNull();
            expect(
              m.gustAvailable === false ||
                m.gustMissingHours?.includes(info.hour),
            ).toBeTruthy();
            continue;
          }
          expect(Math.abs(wind.gust - summary.gust)).toBeLessThanOrEqual(limit);
        }
      }
      // Only level-0 tiles of this run were read, each from inside its directory.
      expect(served.asked.length).toBeGreaterThan(0);
      for (const url of served.asked)
        expect(url).toMatch(
          new RegExp(`/weather/${m.base}t/0/\\d+/\\d+/\\d{3}\\.bin$`),
        );
      served.asked.length = 0;
    });
  },
);

/**
 * Wave manifests carry one array per declared variable and a `spotSeries` map,
 * not `u`/`v`/`gust` with gust intervals, so they have their own contract and
 * their own validator: `validateWaveManifest`, which the browser now runs on
 * every wave bundle it loads. That covers the manifest; this block adds what
 * only a whole bundle can check, which is that the frame files agree with the
 * manifest and that every spot series matches its own grid.
 */
type WaveGrid = NonNullable<WaveManifest["grid"]>;
type WaveValues = (number | null)[];

/** The importer's sampler: bilinear, and null as soon as a neighbour is null. */
function sampleWave(
  g: WaveGrid,
  values: WaveValues,
  lon: number,
  lat: number,
): number | null {
  const x = (lon - g.west) / g.dx,
    y = (g.north - lat) / g.dy;
  if (x < 0 || y < 0 || x > g.width - 1 || y > g.height - 1) return null;
  const x0 = Math.min(Math.floor(x), g.width - 2),
    y0 = Math.min(Math.floor(y), g.height - 2);
  const tx = x - x0,
    ty = y - y0,
    i = y0 * g.width + x0;
  const corners = [
    values[i],
    values[i + 1],
    values[i + g.width],
    values[i + g.width + 1],
  ];
  if (corners.some((value) => value === null)) return null;
  const [a, b, c, d] = corners as number[];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

describe.each(["gfs-wave"])("published %s wave bundle", (name) => {
  it("every frame matches the manifest and every spot series matches the frames", async () => {
    // The shared validators own the contract: version, kind, the variable map,
    // the frame list, the declared horizon and the shape of every spot series.
    validateWaveManifest(readBundle<WaveManifest>(name));
    const m = validateWaveSpots(await readRun<WaveManifest>(name));
    expect(m.model).toBe(name);
    expect([1, 3]).toContain(m.stepHours);
    expect(m.stepRanges).toBeUndefined();
    expect(waveHours(m)).toEqual(m.frames.map((frame) => frame.hour));
    for (const field of ["provider", "attribution", "licenseUrl", "processing"])
      expect(typeof m[field as keyof WaveManifest]).toBe("string");

    const g: WaveGrid = m.grid!;
    expect(Number.isInteger(g.width) && g.width >= 2).toBe(true);
    expect(Number.isInteger(g.height) && g.height >= 2).toBe(true);
    expect(Math.abs(g.east - g.west - (g.width - 1) * g.dx)).toBeLessThan(1e-5);
    expect(Math.abs(g.north - g.south - (g.height - 1) * g.dy)).toBeLessThan(
      1e-5,
    );
    const cells = g.width * g.height;

    const variables = Object.keys(m.variables);
    expect(variables.length).toBeGreaterThan(0);
    for (const key of variables) {
      expect(key).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
      for (const field of ["units", "label", "description"] as const)
        expect(m.variables[key][field].trim().length).toBeGreaterThan(0);
    }

    /** Wave bundles carry the same full catalogue as the wind manifests. */
    expect(Object.keys(m.spotSeries!).sort()).toEqual([...placeIds].sort());
    const covered = places;
    for (const place of places) {
      const coverage = m.spotCoverage![place.id];
      expect(typeof coverage.landMasked).toBe("boolean");
      expect(coverage.note!.trim().length).toBeGreaterThan(0);
      // The browser reads this note only where there is something to explain.
      expect(waveCoverageNote(m, place.id) === null).toBe(
        !coverage.landMasked && coverage.resolved !== false,
      );
    }

    expect(m.frames.length).toBeGreaterThan(0);
    m.frames.forEach(
      (info: { hour: number; validTime: string; url: string }, i: number) => {
        expect(info.hour).toBe(i * m.stepHours);
        expect(Date.parse(info.validTime)).toBe(
          Date.parse(m.runTime) + info.hour * 3600000,
        );
        // Inside the run directory, named for the hour alone.
        expect(info.url).toBe(
          `frames/${String(info.hour).padStart(3, "0")}.json`,
        );
        const frame = readFrame<Record<string, WaveValues>>(m, info.url);
        expect([frame.model, frame.run, frame.hour, frame.validTime]).toEqual([
          m.model,
          m.run,
          info.hour,
          info.validTime,
        ]);
        expect(frame.grid).toEqual(g);
        for (const key of variables) {
          const values: WaveValues = frame[key];
          expect(values).toHaveLength(cells);
          // Land, ice and unresolved cells are null; they are never zeroed.
          expect(
            values.every(
              (value) =>
                value === null ||
                (Number.isFinite(value) && Math.abs(value) <= 1000),
            ),
          ).toBe(true);
        }
        for (const place of covered) {
          const step = m.spotSeries![place.id][i];
          expect(step.validTime).toBe(info.validTime);
          expect(Object.keys(step.values).sort()).toEqual(
            [...variables].sort(),
          );
          for (const key of variables) {
            const wave = sampleWave(g, frame[key], place.lon, place.lat);
            const summary = step.values[key];
            if (wave === null || summary === null) {
              expect(wave).toBeNull();
              expect(summary).toBeNull();
              continue;
            }
            expect(Math.abs(wave - summary)).toBeLessThanOrEqual(0.00501);
          }
        }
      },
    );
  });
});

/**
 * The surface-weather bundle, the same way round: every gridded variable's spot
 * series has to agree with the frames it was taken from.
 *
 * Two kinds of variable, and they are read differently on purpose. A measurement
 * is interpolated bilinearly, like wind and waves. A present-weather code is a
 * code-table entry — a mean of "fog" and "rain" is nothing at all — so it is
 * read from the cell containing the location and compared for equality, which is
 * what the manifest's own `presentWeatherNote` promises and what
 * `sample_variable` in force5/ingest/fetch_icon_weather.py does.
 *
 * The tolerance for a measurement is wider than the wind bundle's 0.005 because
 * a surface variable is published at its own precision: cloud in whole per cent,
 * temperature in tenths. The frame nodes are rounded to that precision and so is
 * the series, and bilinear interpolation carries the nodes' rounding through
 * unchanged, so the two can differ by one published step and no more.
 */
const decimalsOf = (value: number) =>
  (String(value).split(".")[1] ?? "").length;

describe.each(["icon-eu-weather"])("published %s weather bundle", (name) => {
  it("every frame matches the manifest and every spot series matches the frames", async () => {
    validateWeatherManifest(readBundle<WeatherManifest>(name));
    const m = validateWeatherSpots(await readRun<WeatherManifest>(name));
    expect(m.model).toBe(name);
    expect(m.provider).toBe("Synthetic sample data");
    expect(weatherHours(m)).toEqual(m.frames.map((frame) => frame.hour));
    expect(Object.keys(m.spotSeries!).sort()).toEqual([...placeIds].sort());

    const g = m.grid!;
    expect(Math.abs(g.east - g.west - (g.width - 1) * g.dx)).toBeLessThan(1e-5);
    expect(Math.abs(g.north - g.south - (g.height - 1) * g.dy)).toBeLessThan(
      1e-5,
    );
    // A square grid would let a sampler divide longitude by dy and still pass.
    expect(g.dx).not.toBe(g.dy);
    const cells = g.width * g.height;

    // The frames carry the rain alone, which the chart's Rain layer draws;
    // the series carry every variable.
    const gridded = m.frameVariables!;
    expect(gridded).toEqual(["precip"]);
    const codes = new Set(
      Object.entries(m.variables)
        .filter(([, meta]) => meta.kind === "code")
        .map(([key]) => key),
    );

    expect(m.frames.length).toBeGreaterThan(0);
    m.frames.forEach((info, i) => {
      const frame = readFrame<Record<string, (number | null)[]>>(m, info.url);
      expect([frame.model, frame.run, frame.hour, frame.validTime]).toEqual([
        m.model,
        m.run,
        info.hour,
        info.validTime,
      ]);
      expect(frame.grid).toEqual(g);
      for (const key of gridded) expect(frame[key]).toHaveLength(cells);
      for (const place of places) {
        const step = m.spotSeries![place.id][i];
        expect(step.validTime).toBe(info.validTime);
        for (const key of gridded) {
          const values = frame[key];
          const summary = step.values[key];
          if (codes.has(key)) {
            // The containing cell: the nearest node on each axis, no blending.
            const x = Math.round((place.lon - g.west) / g.dx);
            const y = Math.round((g.north - place.lat) / g.dy);
            expect(summary).toBe(values[y * g.width + x]);
            continue;
          }
          const point = sampleWave(g, values, place.lon, place.lat);
          if (point === null || summary === null) {
            expect(point).toBeNull();
            expect(summary).toBeNull();
            continue;
          }
          const step10 =
            10 **
            -Math.max(
              ...values.map((value) =>
                value === null ? 0 : decimalsOf(value),
              ),
              decimalsOf(summary),
            );
          expect(Math.abs(point - summary)).toBeLessThanOrEqual(
            step10 + 0.00501,
          );
        }
      }
    });
  });

  it("publishes no rain at initialization, and rain that is not one flat sheet", () => {
    const m = validateWeatherManifest(readBundle<WeatherManifest>(name));
    const rain = weatherFields(m).rain!;
    const frames = m.frames.map((info) =>
      readFrame<Record<string, (number | null)[]>>(m, info.url),
    );
    // The run's own hour has no interval: nulls, never a field of zeros.
    expect(frames[0][rain].every((value) => value === null)).toBe(true);
    expect(frames[1][rain].every((value) => typeof value === "number")).toBe(
      true,
    );
    // And rain varies across the map rather than being one scalar per frame.
    const spread = frames
      .map((frame) => frame[rain].filter((value) => value !== null))
      .filter((values) => values.length)
      .map(
        (values) =>
          Math.max(...(values as number[])) - Math.min(...(values as number[])),
      );
    expect(spread.length).toBeGreaterThan(0);
    expect(spread.every((range) => range > 0)).toBe(true);
  });
});
