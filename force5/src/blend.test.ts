// Synthetic-manifest coverage for the blend primitives. The bundled real
// snapshots are exercised in tests/blend.test.ts, which may read files.
import { describe, expect, it } from "vitest";
import {
  AGREEMENT_HIGH_KN,
  AGREEMENT_MODERATE_KN,
  agreementFor,
  bandPath,
  blendInputs,
  blendStats,
  bridgeableGapHours,
  candles,
  commonAxis,
  interpolateSeries,
  linearScale,
  manifestRange,
  pathData,
  pathPoints,
  quantile,
  type BlendInput,
} from "./blend";
import { KNOTS } from "./units";
import type { SeriesPoint } from "./series";
import { ensembleManifest, windManifest } from "./testing";

const series = (
  runTime: string,
  hours: number[],
  wind: (hour: number) => { u: number; v: number; gust: number | null },
): SeriesPoint[] =>
  hours.map((hour) => ({
    hour,
    validTime: new Date(Date.parse(runTime) + hour * 3600000).toISOString(),
    ...wind(hour),
  }));

describe("common axis", () => {
  const short = windManifest({
    model: "harmonie",
    runTime: "2026-09-14T00:00:00Z",
    hours: [0, 3, 6],
  });
  const long = windManifest({
    model: "ecmwf",
    runTime: "2026-09-13T12:00:00Z",
    hours: [0, 12, 24],
  });

  it("spans the union of the selected models, hourly", () => {
    const axis = commonAxis([short, long]);
    expect(axis[0]).toBe("2026-09-13T12:00:00.000Z");
    expect(axis.at(-1)).toBe("2026-09-14T12:00:00.000Z");
    expect(axis).toHaveLength(25);
  });
  it("can restrict itself to the hours every model covers", () => {
    const axis = commonAxis([short, long], { coverage: "intersection" });
    expect(axis[0]).toBe("2026-09-14T00:00:00.000Z");
    expect(axis.at(-1)).toBe("2026-09-14T06:00:00.000Z");
    expect(axis).toHaveLength(7);
  });
  it("honours explicit bounds and a wider step", () => {
    const axis = commonAxis([long], {
      from: "2026-09-13T13:00:00Z",
      to: "2026-09-14T01:00:00Z",
      stepHours: 3,
    });
    // A three-hour axis lands on whole 00/03/06 UTC steps, not on 13:00.
    expect(axis[0]).toBe("2026-09-13T15:00:00.000Z");
    expect(axis[1]).toBe("2026-09-13T18:00:00.000Z");
    expect(axis).toHaveLength(4);
    expect(commonAxis([])).toEqual([]);
    expect(() => commonAxis([short], { stepHours: 0 })).toThrow(/step/);
  });
  it("starts on the first whole step inside the coverage", () => {
    const offset = windManifest({
      runTime: "2026-09-14T00:30:00Z",
      hours: [0, 3],
    });
    expect(commonAxis([offset])[0]).toBe("2026-09-14T01:00:00.000Z");
  });
  it("reads an ensemble's range from its member series when it has no frames", () => {
    const chartOnly = ensembleManifest({
      runTime: "2026-09-14T00:00:00Z",
      hours: [0, 6],
    });
    expect(manifestRange(chartOnly)).toEqual({
      from: Date.parse("2026-09-14T00:00:00Z"),
      to: Date.parse("2026-09-14T06:00:00Z"),
    });
    expect(commonAxis([chartOnly])).toHaveLength(7);
    expect(
      manifestRange({ ...chartOnly, spotMembers: {}, spotForecasts: {} }),
    ).toBeNull();
  });
});

describe("interpolation onto the axis", () => {
  it("interpolates in u/v space, not between speeds or bearings", () => {
    // Opposed vectors: the vector mean is calm at the midpoint, while an
    // average of the two speeds would claim a steady wind.
    const opposed = series("2026-09-14T00:00:00Z", [0, 6], (hour) => ({
      u: hour === 0 ? 10 : -10,
      v: 0,
      gust: 12,
    }));
    const values = interpolateSeries(opposed, [
      "2026-09-14T00:00:00Z",
      "2026-09-14T03:00:00Z",
      "2026-09-14T06:00:00Z",
    ]);
    expect(values.speed).toEqual([10, 0, 10]);
    expect(values.gust).toEqual([12, 12, 12]);
  });
  it("returns null outside the series and keeps null gusts null", () => {
    const points = series("2026-09-14T00:00:00Z", [0, 3], () => ({
      u: 0,
      v: 5,
      gust: null,
    }));
    const values = interpolateSeries(points, [
      "2026-09-13T23:00:00Z",
      "2026-09-14T01:30:00Z",
      "2026-09-14T04:00:00Z",
    ]);
    expect(values.speed).toEqual([null, 5, null]);
    expect(values.gust).toEqual([null, null, null]);
  });
  it("refuses to bridge a gap wider than the model's cadence", () => {
    const holed = series("2026-09-14T00:00:00Z", [0, 3, 6, 24, 27], () => ({
      u: 0,
      v: 5,
      gust: 6,
    }));
    expect(bridgeableGapHours(holed)).toBe(6);
    const values = interpolateSeries(holed, [
      "2026-09-14T06:00:00Z",
      "2026-09-14T12:00:00Z",
      "2026-09-15T00:00:00Z",
    ]);
    expect(values.speed[0]).toBe(5);
    expect(values.speed[1]).toBeNull();
    expect(values.speed[2]).toBe(5);
    expect(
      interpolateSeries(holed, ["2026-09-14T12:00:00Z"], { maxGapHours: 24 })
        .speed[0],
    ).toBe(5);
  });
  it("interpolates a single-point series only at its own time", () => {
    const one = series("2026-09-14T00:00:00Z", [0], () => ({
      u: 3,
      v: 4,
      gust: 8,
    }));
    const values = interpolateSeries(one, [
      "2026-09-14T00:00:00Z",
      "2026-09-14T01:00:00Z",
    ]);
    expect(values.speed).toEqual([5, null]);
    expect(values.gust).toEqual([8, null]);
  });
});

describe("blend inputs", () => {
  it("gives one line per deterministic model and one per ensemble member", () => {
    const deterministic = windManifest({ model: "gfs", hours: [0, 3, 6] });
    const ensemble = ensembleManifest({ members: 3, hours: [0, 3, 6] });
    const axis = commonAxis([deterministic, ensemble]);
    const inputs = blendInputs(
      [deterministic, ensemble],
      "brandon",
      ["gfs", "ecmwf-ens"],
      axis,
    );
    expect(inputs).toHaveLength(4);
    expect(inputs[0]).toMatchObject({ model: "gfs" });
    expect(inputs[0].memberIndex).toBeUndefined();
    expect(inputs.slice(1).map((input) => input.memberIndex)).toEqual([
      0, 1, 2,
    ]);
    expect(inputs[1].speed).toHaveLength(axis.length);
    expect(blendStats(inputs, axis)[3].n).toBe(4);
  });
  it("falls back to an ensemble's mean when a spot has no member series", () => {
    const ensemble = ensembleManifest({ members: 3 });
    const axis = commonAxis([ensemble]);
    const inputs = blendInputs(
      [{ ...ensemble, spotMembers: undefined }],
      "brandon",
      ["ecmwf-ens"],
      axis,
    );
    expect(inputs).toHaveLength(1);
    expect(inputs[0].memberIndex).toBeUndefined();
  });
  it("ignores unselected models, absent models and unknown spots", () => {
    const harmonie = windManifest({ model: "harmonie" });
    const icon = windManifest({ model: "icon-eu" });
    const axis = commonAxis([harmonie, icon]);
    expect(
      blendInputs([harmonie, icon], "brandon", ["harmonie"], axis).map(
        (input) => input.model,
      ),
    ).toEqual(["harmonie"]);
    expect(blendInputs([harmonie], "brandon", ["gfs"], axis)).toEqual([]);
    expect(blendInputs([harmonie], "mizen", ["harmonie"], axis)).toEqual([]);
  });
});

describe("per-hour statistics", () => {
  const axis = ["2026-09-14T00:00:00Z", "2026-09-14T01:00:00Z"];
  const line = (
    model: string,
    speed: (number | null)[],
    gust: (number | null)[],
  ): BlendInput => ({ model, speed, gust });

  it("summarises the distribution across the input lines", () => {
    const stats = blendStats(
      [
        line("a", [5, null], [7, null]),
        line("b", [7, 9], [9, 11]),
        line("c", [9, 11], [null, 13]),
      ],
      axis,
    );
    expect(stats[0]).toMatchObject({
      time: axis[0],
      n: 3,
      min: 5,
      max: 9,
      q25: 6,
      median: 7,
      q75: 8,
      mean: 7,
      spread: 4,
    });
    expect(stats[0].gust).toEqual({ n: 2, min: 7, max: 9, median: 8 });
    expect(stats[1]).toMatchObject({ n: 2, min: 9, max: 11, median: 10 });
    expect(stats[1].gust).toEqual({ n: 2, min: 11, max: 13, median: 12 });
  });
  it("keeps empty hours explicit rather than pretending they are calm", () => {
    const stats = blendStats([line("a", [null, null], [null, null])], axis);
    expect(stats[0]).toMatchObject({
      n: 0,
      min: null,
      max: null,
      median: null,
      spread: null,
      agreement: null,
    });
    expect(stats[0].gust.n).toBe(0);
    expect(blendStats([], axis)[0].n).toBe(0);
  });
  it("labels agreement by spread in knots at the documented thresholds", () => {
    expect(AGREEMENT_HIGH_KN).toBe(4);
    expect(AGREEMENT_MODERATE_KN).toBe(8);
    expect(agreementFor(0)).toBe("high");
    expect(agreementFor((AGREEMENT_HIGH_KN - 0.01) / KNOTS)).toBe("high");
    expect(agreementFor(AGREEMENT_HIGH_KN / KNOTS)).toBe("moderate");
    expect(agreementFor((AGREEMENT_MODERATE_KN - 0.01) / KNOTS)).toBe(
      "moderate",
    );
    expect(agreementFor(AGREEMENT_MODERATE_KN / KNOTS)).toBe("low");
    const stats = blendStats(
      [
        line("a", [5, 5], [null, null]),
        line("b", [5 + 10 / KNOTS, 5], [null, null]),
      ],
      axis,
    );
    expect(stats[0].agreement).toBe("low");
    expect(stats[1].agreement).toBe("high");
  });
  it("interpolates quantiles between order statistics", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 10);
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 10);
    expect(quantile([4], 0.75)).toBe(4);
  });
});

describe("candle columns", () => {
  const axis = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.parse("2026-09-14T00:00:00Z") + i * 3600000).toISOString(),
  );
  const stats = blendStats(
    [
      {
        model: "a",
        speed: axis.map((_, i) => 5 + i),
        gust: axis.map(() => 20),
      },
      {
        model: "b",
        speed: axis.map((_, i) => (i === 6 ? null : 7 + i)),
        gust: axis.map(() => 25),
      },
    ],
    axis,
  );

  it("aggregates three hours into one column", () => {
    const columns = candles(stats, 3);
    expect(columns).toHaveLength(3);
    expect(columns[0]).toMatchObject({
      time: axis[0],
      hours: 3,
      lo: 5,
      hi: 9,
      median: 7,
    });
    expect(columns[0].gust).toEqual({ lo: 20, hi: 25 });
    expect(columns[2]).toMatchObject({ hours: 1, lo: 11, hi: 11 });
  });
  it("drops columns with no data and rejects a nonsense width", () => {
    expect(candles(blendStats([], axis))).toEqual([]);
    expect(candles(stats, 1)).toHaveLength(7);
    expect(() => candles(stats, 0)).toThrow(/whole number/);
    expect(() => candles(stats, 1.5)).toThrow(/whole number/);
  });
});

describe("plot helpers", () => {
  const scale = { pxPerHour: 10, y: linearScale([0, 20], [100, 0]) };

  it("clamps the value scale into the plot box", () => {
    expect(scale.y(0)).toBe(100);
    expect(scale.y(10)).toBe(50);
    expect(scale.y(25)).toBe(0);
    expect(scale.y(-5)).toBe(100);
    expect(linearScale([5, 5], [0, 40])(5)).toBe(0);
  });
  it("splits a line at gaps instead of jumping across them", () => {
    const segments = pathPoints([10, null, 5, 5], scale);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual([{ x: 0, y: 50, index: 0 }]);
    expect(segments[1].map((point) => point.x)).toEqual([20, 30]);
    expect(pathData([10, null, 5, 5], scale)).toBe("M0 50 M20 75 L30 75");
    expect(pathPoints([null, NaN], scale)).toEqual([]);
  });
  it("offsets and widens columns with x0 and stepHours", () => {
    const columns = { pxPerHour: 4, y: scale.y, x0: 6, stepHours: 3 };
    expect(
      pathPoints([10, 10], columns)
        .flat()
        .map((point) => point.x),
    ).toEqual([6, 18]);
  });
  it("closes a band between two series per gap-free run", () => {
    expect(bandPath([5, null, 5], [15, 15, 15], scale)).toBe(
      "M0 25 L0 75 Z M20 25 L20 75 Z",
    );
    expect(bandPath([5, 5], [15, 15], scale)).toBe(
      "M0 25 L10 25 L10 75 L0 75 Z",
    );
  });
});
