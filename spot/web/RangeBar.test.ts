import { describe, expect, it } from "vitest";
import type { HourWind } from "../../mcp/api/forecast";
import {
  figurePlaces,
  headlineName,
  otherWinds,
  rangeText,
  rangeWords,
  rangeZone,
  type Band,
} from "./RangeBar";

const band: Band = { min: 12, sweetLow: 15, sweetHigh: 25, max: 31 };

describe("the wind against the rider's range", () => {
  it("names the part of the range a wind falls in", () => {
    expect(rangeZone(9, band)).toBe("under");
    expect(rangeZone(12, band)).toBe("light");
    expect(rangeZone(15, band)).toBe("best");
    expect(rangeZone(25, band)).toBe("best");
    expect(rangeZone(28, band)).toBe("strong");
    expect(rangeZone(31, band)).toBe("strong");
    expect(rangeZone(34, band)).toBe("over");
  });

  it("says how far under or over, in the reader's units", () => {
    expect(rangeText(9, band, "kn")).toBe("3 under your minimum, 12");
    expect(rangeText(20, band, "kn")).toBe("in your best, 15–25");
    expect(rangeText(34, band, "kn")).toBe("3 over your most, 31");
    expect(rangeText(20, band, "mph")).toBe("in your best, 17–29");
  });

  const wind = {
    wind_kn: 10,
    min_kn: 8,
    max_kn: 11,
    gust_kn: 26,
    gust_max_kn: 29,
    direction_deg: 290,
    direction: "WNW",
    agreement: "high",
    models: 4,
    lead: "harmonie",
    gust_lead: "harmonie",
  } satisfies HourWind;

  it("reads the frame aloud, naming the model the stars come from", () => {
    expect(rangeWords(wind, band, "kn")).toBe(
      "HARMONIE 10 gusting 26, 4 models 8–11, 2 under your minimum, 12",
    );
    expect(rangeWords({ ...wind, models: 1, gust_kn: null }, band, "kn")).toBe(
      "HARMONIE 10, 2 under your minimum, 12",
    );
    expect(rangeWords({ ...wind, lead: "ecmwf" }, band, "kn")).toBe(
      "ECMWF 10 gusting 26, 4 models 8–11, 2 under your minimum, 12",
    );
  });

  it("names any model as the headline, never a blend", () => {
    expect(headlineName(wind)).toBe("HARMONIE");
    expect(headlineName({ lead: "icon-eu" })).toBe("ICON-EU");
    expect(headlineName({ lead: "ecmwf" })).toBe("ECMWF");
    expect(headlineName({ lead: "gfs" })).toBe("GFS");
  });

  it("ticks every model but the one the stars come from", () => {
    const byModel = (knots: number) => ({
      wind_kn: knots,
      gust_kn: null,
      direction_deg: 290,
    });
    expect(
      otherWinds({
        ...wind,
        by_model: {
          harmonie: byModel(10),
          "icon-eu": byModel(8),
          gfs: byModel(11),
        },
      }),
    ).toEqual([
      { id: "icon-eu", knots: 8 },
      { id: "gfs", knots: 11 },
    ]);
    expect(otherWinds(wind)).toEqual([]);
  });

  it("keeps the mean's and the gust's figures apart under the card's chart", () => {
    expect(figurePlaces(100, 200, 284)).toEqual({
      mean: { x: 100, anchor: "middle" },
      gust: { x: 200, anchor: "middle" },
    });
    expect(figurePlaces(100, null, 284)).toEqual({
      mean: { x: 100, anchor: "middle" },
      gust: null,
    });
    // Too close to share: pushed either side of the point between them.
    expect(figurePlaces(100, 110, 284)).toEqual({
      mean: { x: 103, anchor: "end" },
      gust: { x: 107, anchor: "start" },
    });
    // And never off the chart's edge.
    expect(figurePlaces(280, 282, 284).gust).toEqual({
      x: 260,
      anchor: "start",
    });
  });
});
