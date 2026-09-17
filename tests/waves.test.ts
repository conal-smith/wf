// The browser's wave readers against a GFS-Wave-shaped sample bundle, which is
// the acceptance data. The contract itself is unit-tested with hand-built
// fixtures in force5/src/waves.test.ts; this is a whole published bundle, in the
// published format, written by scripts/sample-weather.mjs.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readBundle } from "./bundles";
import {
  preferredWaveSource,
  validateWaveManifest,
  waveAtAxis,
  waveCoverageNote,
  waveFields,
  waveHours,
  waveSeries,
  waveSeriesHasData,
  type WaveManifest,
} from "../force5/src/waves";

const manifest = validateWaveManifest(readBundle<WaveManifest>("gfs-wave"));

describe("the sample GFS-Wave bundle", () => {
  it("validates as published", () => {
    expect(manifest.model).toBe("gfs-wave");
    expect(manifest.stepHours).toBe(3);
    expect(waveHours(manifest)).toEqual(
      manifest.frames.map((frame) => frame.hour),
    );
    expect(Object.keys(manifest.variables)).toContain("swh");
    expect(manifest.directionConvention).toMatch(/FROM/);
  });
  it("reads Brandon Bay as resolved open water", () => {
    const series = waveSeries(manifest, "brandon")!;
    expect(series).toHaveLength(manifest.frames.length);
    expect(waveSeriesHasData(series)).toBe(true);
    expect(series[0].values.swh).toBeCloseTo(2.95, 2);
    expect(series[0].values.pp1d).toBeCloseTo(7.29, 2);
    expect(series[0].values.mwd).toBeCloseTo(295.53, 2);
    expect(waveCoverageNote(manifest, "brandon")).toBeNull();
  });
  it("reads a land-masked spot as nulls with the reason stated", () => {
    const series = waveSeries(manifest, "rusheen")!;
    expect(series.every((step) => step.values.swh === null)).toBe(true);
    expect(waveSeriesHasData(series)).toBe(false);
    expect(waveCoverageNote(manifest, "rusheen")).toMatch(/land, ice/);
  });
  it("says when a neighbouring water cell stood in for the beach", () => {
    expect(waveCoverageNote(manifest, "inchydoney")).toMatch(/nearby open sea/);
    expect(waveSeriesHasData(waveSeries(manifest, "inchydoney"))).toBe(true);
  });
  it("lands its three-hourly steps on three-hourly dock columns", () => {
    const axis = manifest.frames.map((frame) => frame.validTime);
    const columns = waveAtAxis(waveSeries(manifest, "brandon")!, axis);
    expect(columns.map((step) => step?.hour ?? null)).toEqual([0, 3, 6, 9]);
  });
  it("leaves a column empty when no step is close enough", () => {
    // An hour and a half past the last step, which is a wind column ECMWF has
    // and GFS-Wave does not.
    const [past] = waveAtAxis(waveSeries(manifest, "brandon")!, [
      "2026-09-17T05:00:00Z",
    ]);
    expect(past).toBeNull();
  });
  it("offers both partitions and is the source when it is the only one", () => {
    const fields = waveFields(manifest)!;
    expect(fields.total).toEqual({
      height: "swh",
      period: "pp1d",
      direction: "mwd",
    });
    expect(fields.swell?.height).toBe("swell1_h");
    expect(fields.windsea?.height).toBe("shww");
    const source = preferredWaveSource([manifest], "brandon")!;
    expect(source.manifest.model).toBe("gfs-wave");
    expect(source.note).toBeNull();
  });
  it("covers every riding location, resolved or not", () => {
    const places: { id: string }[] = JSON.parse(
      readFileSync("public/riding-locations.json", "utf8"),
    );
    for (const place of places)
      expect(waveSeries(manifest, place.id)).toBeTruthy();
    // At least one is deliberately published as nulls with a reason, which is
    // the statement the dock turns into "no wave data at this spot".
    expect(
      places.filter(
        (place) => !waveSeriesHasData(waveSeries(manifest, place.id)),
      ).length,
    ).toBeGreaterThan(0);
  });
});
