import { describe, expect, it } from "vitest";
import type { HourWind } from "../../mcp/api/forecast";
import {
  headlineName,
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
    lead: null,
    gust_lead: null,
  } satisfies HourWind;

  it("reads the frame aloud without the ensembles", () => {
    expect(rangeWords(wind, band, "kn")).toBe(
      "blend 10 gusting 26, 4 models 8–11, 2 under your minimum, 12",
    );
    expect(rangeWords({ ...wind, models: 1, gust_kn: null }, band, "kn")).toBe(
      "blend 10, 2 under your minimum, 12",
    );
  });

  it("names HARMONIE as the headline while it leads the hour", () => {
    const led = { ...wind, lead: "harmonie", gust_lead: "harmonie" };
    expect(rangeWords(led, band, "kn")).toBe(
      "HARMONIE 10 gusting 26, 4 models 8–11, 2 under your minimum, 12",
    );
    expect(headlineName(led)).toBe("HARMONIE");
    expect(headlineName(wind)).toBe("Blend");
  });
});
