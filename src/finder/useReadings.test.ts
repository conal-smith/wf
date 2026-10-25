import { describe, expect, it } from "vitest";
import { waveManifest, weatherManifest } from "../../force5/src/testing";
import { readingsFor } from "./useReadings";

// The test runs' own clock: three-hourly steps from 18:00 UTC on 16 September.
const at = (hour: number) =>
  new Date(Date.parse("2026-09-16T18:00:00Z") + hour * 3600000).toISOString();

describe("a card's readings", () => {
  it("are the dock's: the sky's code, the air, and the sea's height and period", () => {
    const read = readingsFor([waveManifest()], [weatherManifest()], "brandon", [
      at(0),
      at(3),
      at(6),
    ]);
    // ww 3 is cloudy; 61 slight rain.
    expect(read.sky.map((s) => s?.icon)).toEqual(["cloudy", "rain", "rain"]);
    expect(read.air).toEqual([15, 15.3, 15.6]);
    expect(read.sea).toEqual([
      { height: 1, period: 9 },
      { height: 1.3, period: 9 },
      { height: 1.6, period: 9 },
    ]);
  });

  it("are nothing where no step is near, and nothing for a place no run reaches", () => {
    const read = readingsFor([waveManifest()], [weatherManifest()], "brandon", [
      at(30),
    ]);
    expect(read.sky).toEqual([null]);
    expect(read.air).toEqual([null]);
    expect(read.sea).toEqual([null]);
    const none = readingsFor([waveManifest()], [weatherManifest()], "nowhere", [
      at(0),
    ]);
    expect(none).toEqual({ sky: [], air: [], sea: [] });
  });
});
