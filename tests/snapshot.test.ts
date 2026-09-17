import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readBundle, readFrame } from "./bundles";
import { sample, validateFrame, validateManifest } from "../force5/src/weather";
import type { Spot } from "../force5/src/weather";
import {
  validateWaveManifest,
  waveCoverageNote,
  waveHours,
  type WaveManifest,
} from "../force5/src/waves";

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
    it("all files match the manifest and all spot summaries match their wind grid", () => {
      const m = validateManifest(readBundle(name));
      // Exactly the published catalogue: no riding place missing, none invented.
      expect(Object.keys(m.spotForecasts).sort()).toEqual([...placeIds].sort());
      for (const id of originalIds) expect(m.spotForecasts[id]).toBeTruthy();
      m.frames.forEach((info, i) => {
        const frame = validateFrame(readFrame(info.url), m, info);
        for (const spot of places) {
          const wind = sample(frame, spot.lon, spot.lat)!;
          const summary = m.spotForecasts[spot.id][i];
          expect(summary.validTime).toBe(info.validTime);
          // Every riding place sits inside every bundled grid, so a null u or v
          // would mean the series and the frames describe different points.
          for (const field of ["u", "v"] as const) {
            expect(typeof summary[field]).toBe("number");
            expect(
              Math.abs(wind[field]! - summary[field]!),
            ).toBeLessThanOrEqual(0.00501);
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
          expect(Math.abs(wind.gust - summary.gust)).toBeLessThanOrEqual(
            0.00501,
          );
        }
      });
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
  it("every frame matches the manifest and every spot series matches the frames", () => {
    // The shared validator owns the contract: version, kind, the variable map,
    // the frame list, the declared horizon and the shape of every spot series.
    const m = validateWaveManifest(readBundle<WaveManifest>(name));
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
    expect(Object.keys(m.spotSeries).sort()).toEqual([...placeIds].sort());
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
        expect(
          info.url.startsWith("weather/") && !info.url.includes(".."),
        ).toBe(true);
        const frame = readFrame<Record<string, WaveValues>>(info.url);
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
          const step = m.spotSeries[place.id][i];
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
