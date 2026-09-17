import { describe, expect, it } from "vitest";
import {
  agreementLabel,
  areaPath,
  axisTicks,
  axisVectors,
  bandPath,
  columnCentres,
  columnEdges,
  candleGroups,
  columnWeights,
  dayGroups,
  displayToKnots,
  dublinDate,
  dublinNoonUtc,
  linePath,
  meanDirections,
  modelSupport,
  niceMax,
  smoothPath,
  timeToX,
  valueRuns,
  valueScale,
  vectorMean,
  windGradientStops,
} from "./chart";
import { dayLabel, type FrameInfo } from "../force5/src/weather";
import type { SeriesPoint } from "../force5/src/series";

const frames = (hours: readonly number[], from = "2026-09-14T00:00:00Z") =>
  hours.map((hour): FrameInfo => ({
    hour,
    validTime: new Date(Date.parse(from) + hour * 3600000).toISOString(),
    url: `weather/run/${hour}.json`,
    gustIntervalHours: null,
  }));
/** Column times, which is what the geometry helpers actually take. */
const times = (hours: readonly number[], from = "2026-09-14T00:00:00Z") =>
  frames(hours, from).map((frame) => frame.validTime);

describe("value axis", () => {
  it("rounds up to whole steps and never collapses", () => {
    expect(niceMax(0)).toBe(20);
    expect(niceMax(4)).toBe(20);
    expect(niceMax(23)).toBe(30);
    expect(niceMax(30)).toBe(30);
    expect(niceMax(31)).toBe(40);
    expect(niceMax(Number.NaN)).toBe(20);
  });
  it("ticks from zero to the top", () => {
    expect(axisTicks(40)).toEqual([0, 10, 20, 30, 40]);
    expect(axisTicks(20, 5)).toEqual([0, 5, 10, 15, 20]);
    expect(axisTicks(0)).toEqual([0]);
  });
  it("maps values to pixels and clamps outside the domain", () => {
    const y = valueScale(40, 143);
    expect(y(0)).toBe(140);
    expect(y(40)).toBe(7);
    expect(y(20)).toBeCloseTo(73.5, 6);
    expect(y(-5)).toBe(140);
    expect(y(400)).toBe(7);
  });
  it("converts a display value back to the knots the palette is keyed on", () => {
    expect(displayToKnots(10, "kn")).toBeCloseTo(10, 6);
    expect(displayToKnots(10, "m/s")).toBeCloseTo(19.4384449, 6);
    expect(displayToKnots(0, "km/h")).toBe(0);
  });
  it("builds wind stops over the axis, rising through the palette", () => {
    const stops = windGradientStops(40, "kn");
    expect(stops.map((stop) => stop.offset)).toEqual([
      0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1,
    ]);
    expect(stops[0].colour).toBe("rgb(53,88,151)");
    expect(stops.at(-1)!.colour).toBe("rgb(234,134,45)");
    expect(windGradientStops(0, "kn")).toEqual([]);
  });
});

describe("column geometry", () => {
  it("gives a six-hour step twice the room of a three-hour one", () => {
    expect(columnWeights(times([0, 3, 6, 9]))).toEqual([1, 1, 1, 1]);
    expect(columnWeights(times([0, 3, 6, 12, 18]))).toEqual([1, 1, 2, 2, 2]);
    expect(columnWeights(times([0]))).toEqual([1]);
    // A seam two hours wide is still one column wide, never a narrower one.
    expect(columnWeights([...times([0, 3]), ...times([5, 8])])).toEqual([
      1, 1, 1, 1,
    ]);
  });
  it("lays edges and centres out across the measured width", () => {
    const weights = [1, 1, 2];
    expect(columnEdges(weights, 400)).toEqual([0, 100, 200, 400]);
    expect(columnCentres(weights, 400)).toEqual([50, 150, 300]);
    expect(columnEdges([], 400)).toEqual([0]);
  });
  it("groups columns into three-hour candles across a change of cadence", () => {
    // Three hourly columns make one candle; a six-hourly column makes its own.
    expect(candleGroups(times([0, 1, 2, 3, 4, 5, 6, 12]))).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6],
      [7],
    ]);
    expect(candleGroups(times([0, 3, 6]))).toEqual([[0], [1], [2]]);
    expect(candleGroups([])).toEqual([]);
    expect(() => candleGroups(times([0]), 0)).toThrow(/positive/);
  });
  it("interpolates a wall-clock time between column centres", () => {
    const list = frames([0, 3, 6]);
    const centres = columnCentres(
      columnWeights(list.map((frame) => frame.validTime)),
      300,
    );
    expect(timeToX(list, Date.parse("2026-09-14T00:00:00Z"), centres)).toBe(50);
    expect(timeToX(list, Date.parse("2026-09-14T01:30:00Z"), centres)).toBe(
      100,
    );
    expect(timeToX(list, Date.parse("2026-09-14T06:00:00Z"), centres)).toBe(
      250,
    );
    // Outside the run there is no position at all, never a clamped one.
    expect(
      timeToX(list, Date.parse("2026-09-13T23:00:00Z"), centres),
    ).toBeNull();
    expect(
      timeToX(list, Date.parse("2026-09-14T07:00:00Z"), centres),
    ).toBeNull();
  });
});

describe("paths", () => {
  it("splits values into gap-free runs", () => {
    expect(valueRuns([1, 2, null, 4, Number.NaN, 6])).toEqual([
      [0, 1],
      [3],
      [5],
    ]);
    expect(valueRuns([null, null])).toEqual([]);
  });
  it("passes a smooth curve through every point", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([{ x: 1, y: 2 }])).toBe("M1 2");
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ]);
    expect(d.startsWith("M0 0 C")).toBe(true);
    // Every anchor is still a real data point: the curve interpolates.
    expect(d).toContain("10 10");
    expect(d.endsWith("20 0")).toBe(true);
  });
  it("draws one subpath per run, and closes a band", () => {
    const y = (value: number) => 100 - value;
    const xs = [0, 10, 20];
    expect(linePath(xs, [1, null, 3], y)).toBe("M0 99 M20 97");
    const band = bandPath(xs, [0, 0, 0], [2, 4, 2], y);
    expect(band.startsWith("M0 98")).toBe(true);
    expect(band.endsWith("Z")).toBe(true);
    expect(band).toContain("L");
    // A missing edge drops the whole column from the band.
    expect(bandPath(xs, [0, null, 0], [2, 4, 2], y)).toBe(
      "M0 98 L0 100 Z M20 98 L20 100 Z",
    );
  });
  it("closes an area onto a baseline", () => {
    const path = areaPath([0, 10], [1, 2], (value) => 50 - value, 60);
    expect(path).toBe("M0 49 C1.67 48.83 8.33 48.17 10 48 L10 60 L0 60 Z");
    expect(areaPath([0, 10], [null, null], (v) => v, 60)).toBe("");
  });
});

describe("model support", () => {
  it("counts distinct models, not lines, and ignores gaps", () => {
    const lines = [
      { model: "harmonie", speed: [5, 5, null] },
      { model: "ecmwf", speed: [6, null, 7] },
      { model: "gefs", speed: [7, 8, 9] },
      // A second member of the same ensemble says nothing new about agreement.
      { model: "gefs", speed: [7, 8, 9] },
    ];
    expect(modelSupport(lines, 3)).toEqual([3, 2, 2]);
    expect(modelSupport([], 2)).toEqual([0, 0]);
    expect(modelSupport([{ model: "a", speed: [Number.NaN] }], 1)).toEqual([0]);
  });
});

describe("Irish days", () => {
  it("uses the Irish calendar day, not the UTC one", () => {
    // 23:30 UTC in September is 00:30 the next day in Dublin.
    expect(dublinDate("2026-09-14T23:30:00Z")).toBe("2026-09-15");
    expect(dublinDate("2026-09-14T12:00:00Z")).toBe("2026-09-14");
    expect(dublinNoonUtc("2026-09-14T23:30:00Z").toISOString()).toBe(
      "2026-09-15T12:00:00.000Z",
    );
  });
  it("groups columns by Irish day with a midday anchor for the sun", () => {
    const groups = dayGroups(
      times([0, 3, 6, 21, 24, 27], "2026-09-14T00:00:00Z"),
      dayLabel,
    );
    // +21 h is 22:00 Irish on the 14th; +24 h is 01:00 Irish on the 15th.
    expect(
      groups.map((group) => [group.date, group.start, group.count]),
    ).toEqual([
      ["2026-09-14", 0, 4],
      ["2026-09-15", 4, 2],
    ]);
    expect(groups[0].noon.toISOString()).toBe("2026-09-14T12:00:00.000Z");
    expect(dayGroups([], dayLabel)).toEqual([]);
  });
});

describe("wind vectors", () => {
  const series = (hours: readonly number[]): SeriesPoint[] =>
    hours.map((hour) => ({
      hour,
      validTime: new Date(
        Date.parse("2026-09-14T00:00:00Z") + hour * 3600000,
      ).toISOString(),
      u: hour,
      v: 0,
      gust: null,
    }));

  it("interpolates components onto the axis and refuses a wide gap", () => {
    const axis = [
      "2026-09-14T00:00:00Z",
      "2026-09-14T01:30:00Z",
      "2026-09-14T03:00:00Z",
      "2026-09-14T09:00:00Z",
    ];
    expect(axisVectors(series([0, 3, 6]), axis)).toEqual([
      { u: 0, v: 0 },
      { u: 1.5, v: 0 },
      { u: 3, v: 0 },
      null,
    ]);
    expect(axisVectors(series([0, 24]), axis, 6)).toEqual([
      { u: 0, v: 0 },
      null,
      null,
      null,
    ]);
  });
  it("averages vectors rather than bearings", () => {
    expect(vectorMean([])).toBeNull();
    expect(
      vectorMean([
        { u: 1, v: 1 },
        { u: 3, v: 3 },
      ]),
    ).toEqual({ u: 2, v: 2 });
    // Northerly and southerly cancel: the mean is calm, not east.
    expect(meanDirections([[{ u: 0, v: 1 }], [{ u: 0, v: -1 }]], 1)).toEqual([
      null,
    ]);
    // A pure westerly (u positive) blows from the west.
    expect(meanDirections([[{ u: 5, v: 0 }]], 1)).toEqual([270]);
    expect(meanDirections([[null]], 1)).toEqual([null]);
  });
});

describe("agreement", () => {
  it("says the agreement in words, never in colour alone", () => {
    expect(agreementLabel("high")).toBe("models agree");
    expect(agreementLabel("moderate")).toBe("some spread");
    expect(agreementLabel("low")).toBe("models disagree");
    expect(agreementLabel(null)).toBe("no data");
  });
});
