// The bundled real manifests are read in tests/blend.test.ts.
import { describe, expect, it } from "vitest";
import {
  POINT_SERIES_ID,
  memberSeries,
  modelSeries,
  sampledSeries,
  spotSeries,
  withPointSeries,
} from "./series";
import type { Manifest } from "./weather";
import { ensembleManifest, windManifest } from "./testing";

describe("precomputed spot series", () => {
  it("returns the manifest's own series and null for an unknown spot", () => {
    const manifest = windManifest({ hours: [0, 3, 6] });
    expect(spotSeries(manifest, "brandon")).toHaveLength(3);
    expect(spotSeries(manifest, "dollymount")).toBeNull();
    expect(
      spotSeries({ ...manifest, spotForecasts: { brandon: [] } }, "brandon"),
    ).toBeNull();
  });
  it("treats an all-null series as no coverage, not as calm wind", () => {
    // AROME lists every riding place but can only forecast inside its own
    // domain; a series of nulls means "not covered", so the blend must not see
    // it as a model reporting zero wind.
    const manifest = windManifest({ hours: [0, 3, 6] });
    const uncovered: Manifest = {
      ...manifest,
      spotForecasts: {
        brandon: manifest.spotForecasts!.brandon.map((point) => ({
          ...point,
          u: null as unknown as number,
          v: null as unknown as number,
          gust: null,
        })),
      },
    };
    expect(spotSeries(uncovered, "brandon")).toBeNull();
    expect(modelSeries(uncovered, "brandon")).toEqual([]);
  });
  it("files a point's sampled frames as its series, leaving out what was not read", () => {
    const manifest = ensembleManifest({
      members: 3,
      hours: [0, 3, 6, 9],
      withFrames: true,
    });
    // Read: 0 and 6; 3 not yet; 9 outside the model's domain.
    const series = sampledSeries(manifest.frames, [
      { u: 3, v: 4, gust: 8 },
      undefined,
      { u: 0, v: 2, gust: null },
      null,
    ])!;
    expect(series.map((point) => point.hour)).toEqual([0, 6]);
    expect(series[0]).toMatchObject({ u: 3, v: 4, gust: 8 });
    expect(sampledSeries(manifest.frames, [null, undefined])).toBeNull();
    // One line for the point: the mean's, with no members to stand for it.
    const point = withPointSeries(manifest, series);
    expect(spotSeries(point, POINT_SERIES_ID)).toHaveLength(2);
    expect(memberSeries(point, POINT_SERIES_ID)).toBeNull();
    expect(modelSeries(point, POINT_SERIES_ID)).toHaveLength(1);
    expect(spotSeries(point, "brandon")).toBeNull();
    expect(
      spotSeries(withPointSeries(manifest, null), POINT_SERIES_ID),
    ).toBeNull();
  });
});

describe("ensemble member series", () => {
  it("transposes member arrays into one series per member", () => {
    const manifest = ensembleManifest({ members: 3, hours: [0, 3] });
    const members = memberSeries(manifest, "brandon")!;
    expect(members).toHaveLength(3);
    expect(members[0].control).toBe(true);
    expect(members[1].control).toBe(false);
    expect(members.map((m) => m.points[1].v)).toEqual([3, 4, 5]);
    expect(members[2].points[0]).toMatchObject({
      hour: 0,
      u: 0,
      v: 2,
      gust: 4,
    });
  });
  it("is null for deterministic models and unknown spots", () => {
    expect(memberSeries(windManifest(), "brandon")).toBeNull();
    expect(memberSeries(ensembleManifest(), "keel")).toBeNull();
  });
  it("prefers members over the mean, and falls back to the mean", () => {
    const ensemble = ensembleManifest({ members: 3 });
    expect(
      modelSeries(ensemble, "brandon").map((line) => line.memberIndex),
    ).toEqual([0, 1, 2]);
    const meanOnly: Manifest = { ...ensemble, spotMembers: undefined };
    const lines = modelSeries(meanOnly, "brandon");
    expect(lines).toHaveLength(1);
    expect(lines[0].memberIndex).toBeUndefined();
    expect(lines[0].points[1].v).toBeCloseTo(4, 10);
    expect(modelSeries(windManifest(), "keel")).toEqual([]);
  });
});
