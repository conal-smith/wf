import { expect, it } from "vitest";
import { framePosition, windTrackBackground } from "../force5/src/timeline";
import { KNOTS, windColor } from "../force5/src/weather";
import { forecastUrl } from "../force5/src/urls";
import { vi } from "vitest";
import { readBundle } from "./bundles";
import {
  nearestFrame,
  validateManifest,
  type Manifest,
} from "../force5/src/weather";

it("positions now between real timestamps, including a mixed-cadence boundary", () => {
  const start = Date.parse("2026-09-13T00:00:00Z");
  const frames = [141, 144, 150, 156].map((hour) => ({
    validTime: new Date(start + hour * 3600000).toISOString(),
  }));
  expect(framePosition(frames, start + 142.5 * 3600000)).toBe(0.5);
  expect(framePosition(frames, start + 147 * 3600000)).toBe(1.5);
  expect(framePosition(frames, start + 156 * 3600000)).toBe(3);
  expect(framePosition(frames, start + 140 * 3600000)).toBeNull();
  expect(framePosition(frames, start + 157 * 3600000)).toBeNull();
  expect(framePosition([], start)).toBeNull();
  expect(framePosition(frames, NaN)).toBeNull();
});

it("track colours sit on the columns the scrubber counts, evenly spaced", () => {
  // The range input's value is a column index, so the stops are too: a stop
  // placed by elapsed time would drift off its own value past the seam.
  const wind = { u: 0, v: 5, gust: null };
  const result = windTrackBackground([wind, wind, wind, wind], 4);
  expect(result).toContain("33.33333333333333%");
  expect(result).toContain("66.66666666666666%");
});

it("ECMWF validates its full native cadence and selects only real timestamps", () => {
  const m = readBundle<Manifest>("ecmwf");
  expect(validateManifest(m).frames).toHaveLength(85);
  expect(m.frames[49].hour).toBe(150);
  expect(m.frames.at(-1).hour).toBe(360);
  const i = nearestFrame(m.frames, Date.parse(m.runTime) + 148 * 3600000);
  expect(m.frames[i].hour).toBe(150);
  expect(() =>
    validateManifest({ ...m, frames: m.frames.slice(0, -1) }),
  ).toThrow(/cadence/);
  expect(() =>
    validateManifest({
      ...m,
      stepRanges: [{ throughHour: 360, stepHours: 0 }],
    }),
  ).toThrow(/cadence/);
});

it("scrubber uses the map's wind-speed palette, not the calendar", () => {
  const result = windTrackBackground(
    [
      { u: 0, v: 5, gust: null },
      { u: 0, v: 20, gust: null },
    ],
    2,
  );
  expect(result).toContain(`rgb(${windColor(5 * KNOTS).join(",")}) 0%`);
  expect(result).toContain(`rgb(${windColor(20 * KNOTS).join(",")}) 100%`);
  expect(windTrackBackground([null, undefined], 2)).toContain("#b8cbd0");
});

it("all forecast URLs can use a separate CDN without redirecting spot metadata", () => {
  vi.stubEnv("VITE_FORECAST_BASE_URL", "https://forecast.example.com/force5");
  expect(forecastUrl("weather/harmonie.json")).toBe(
    "https://forecast.example.com/force5/weather/harmonie.json",
  );
  vi.unstubAllEnvs();
});
