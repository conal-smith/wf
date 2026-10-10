import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  blendInputs,
  blendStats,
  leadHours,
  modelWeight,
  perModelLines,
} from "../force5/src/blend";
import { spotSeries } from "../force5/src/series";
import { DEFAULT_RIDER, rateHour } from "../force5/src/stars";
import { ensembleManifest, windManifest } from "../force5/src/testing";
import type { Manifest } from "../force5/src/weather";
import { axisVectors, meanDirections } from "./chart";
import {
  daylightOn,
  offshoreMark,
  placeConsensus,
  placeHours,
  pointHours,
} from "./ratings";

/** The dock's own path, verbatim: what the fast one has to match. */
function slow(manifests: Manifest[], ids: string[], id: string, axis: string[]) {
  const usable = manifests.filter(
    (m) => ids.includes(m.model) && spotSeries(m, id) !== null,
  );
  const lines = blendInputs(
    usable,
    id,
    usable.map((m) => m.model),
    axis,
  );
  const times = axis.map((time) => Date.parse(time));
  const weightAt = (m: Manifest, at: number) =>
    modelWeight(m.model, leadHours(m.runTime, times[at]), m.resolutionKm);
  const weightOf = (model: string, at: number) =>
    weightAt(
      usable.find((m) => m.model === model)!,
      at,
    );
  const leadOf = (at: number) =>
    leadHours(
      Math.max(
        ...lines
          .filter((line) => line.speed[at] !== null)
          .map((line) =>
            Date.parse(usable.find((m) => m.model === line.model)!.runTime),
          ),
      ),
      times[at],
    );
  const consensus = blendStats(perModelLines(lines), axis, weightOf, leadOf);
  const from = meanDirections(
    usable.map((m) => axisVectors(spotSeries(m, id)!, axis)),
    axis.length,
    (model, at) => weightAt(usable[model], at),
  );
  return { consensus, from };
}

const close = (a: number | null, b: number | null) =>
  a === null || b === null ? a === b : Math.abs(a - b) < 1e-9;

function same(manifests: Manifest[], ids: string[], id: string, axis: string[]) {
  const fast = placeConsensus(manifests, ids, id, axis);
  const ref = slow(manifests, ids, id, axis);
  axis.forEach((_, at) => {
    expect(close(fast.median[at], ref.consensus[at].median)).toBe(true);
    expect(close(fast.gust[at], ref.consensus[at].gust.median)).toBe(true);
    expect(fast.agreement[at]).toBe(ref.consensus[at].agreement);
    expect(close(fast.from[at], ref.from[at])).toBe(true);
  });
}

const hourly = (from: string, hours: number) =>
  Array.from({ length: hours }, (_, i) =>
    new Date(Date.parse(from) + i * 3600000).toISOString(),
  );

describe("placeConsensus", () => {
  it("matches the blend for deterministic models between and on their steps", () => {
    const a = windManifest({
      model: "harmonie",
      hours: [0, 1, 2, 3, 4, 5, 6],
      wind: (h) => ({ u: 2 + h, v: -3 + h / 2, gust: 6 + h }),
    });
    const b = windManifest({
      model: "ecmwf",
      hours: [0, 3, 6, 12],
      wind: (h) => ({ u: -1 + h / 3, v: 4 - h, gust: h % 2 ? null : 9 }),
    });
    same([a, b], ["harmonie", "ecmwf"], "brandon", hourly("2026-09-13T23:00:00Z", 16));
  });

  it("counts an ensemble once, as its member mean", () => {
    const det = windManifest({ model: "harmonie", hours: [0, 3, 6] });
    const ens = ensembleManifest({
      hours: [0, 6],
      members: 5,
      member: (m, h) => ({ u: m - 2, v: h / 2 + m, gust: m === 3 ? null : h + 4 }),
    });
    same([det, ens], ["harmonie", "ecmwf-ens"], "brandon", hourly("2026-09-14T00:00:00Z", 8));
  });

  it("matches the blend when the models count for different weights", () => {
    const fine = windManifest({
      model: "harmonie",
      hours: [0, 1, 2, 3, 4, 5, 6],
      wind: (h) => ({ u: 6 + h, v: 1, gust: 10 + h }),
      extra: { resolutionKm: 2 },
    });
    const regional = windManifest({
      model: "icon-eu",
      hours: [0, 3, 6],
      wind: (h) => ({ u: 4, v: -2 + h, gust: 8 }),
      extra: { resolutionKm: 6.5 },
    });
    const coarse = windManifest({
      model: "ecmwf",
      hours: [0, 3, 6],
      wind: (h) => ({ u: -3, v: 2 - h, gust: null }),
      extra: { resolutionKm: 25 },
    });
    same(
      [fine, regional, coarse],
      ["harmonie", "icon-eu", "ecmwf"],
      "brandon",
      hourly("2026-09-14T00:00:00Z", 7),
    );
  });

  it("lets HARMONIE outweigh two global models, and an unjudged model fall back to its grid", () => {
    const calm = (model: string) =>
      windManifest({
        model,
        hours: [0, 3],
        wind: () => ({ u: 0, v: 3, gust: 5 }),
        extra: { resolutionKm: 25 },
      });
    const fine = windManifest({
      model: "harmonie",
      hours: [0, 3],
      wind: () => ({ u: 0, v: 9, gust: 13 }),
      extra: { resolutionKm: 2 },
    });
    const axis = hourly("2026-09-14T00:00:00Z", 1);
    const ids = ["harmonie", "ecmwf", "gfs"];
    const c = placeConsensus([fine, calm("ecmwf"), calm("gfs")], ids, "brandon", axis);
    // Weights 4 : 0.5 : 2 on day 0, so HARMONIE holds the middle on its own...
    expect(c.median[0]).toBeCloseTo(9);
    expect(c.gust[0]).toBeCloseTo(13);
    // ...while the spread, and so the agreement, is still every model's.
    expect(c.agreement[0]).toBe("low");
    // A model the backtest has not judged counts by its grid: 25 km is 1.
    const even = { ...fine, model: "ukv", resolutionKm: 25 };
    const plain = placeConsensus([even, calm("ecmwf"), calm("gfs")], ["ukv", "ecmwf", "gfs"], "brandon", axis);
    expect(plain.median[0]).toBeCloseTo(3);
  });

  it("leaves a model out where it publishes nothing for the place", () => {
    const m = windManifest({ model: "harmonie", spotId: "elsewhere" });
    const out = placeConsensus([m], ["harmonie"], "brandon", hourly("2026-09-14T00:00:00Z", 3));
    expect(out.median).toEqual([null, null, null]);
  });

  // The real thing, where a checkout has the bundled sample runs.
  const dir = "tests/fixtures/weather";
  let real: Manifest[] = [];
  try {
    real = readdirSync(dir)
      .filter((f) => /^[a-z-]+\.json$/.test(f))
      .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as Manifest)
      .filter((m) => m.spotForecasts);
  } catch {
    real = [];
  }
  it.runIf(real.length > 0)("matches the blend on the bundled runs", () => {
    const ids = real.map((m) => m.model);
    const spots = Object.keys(real[0].spotForecasts).slice(0, 12);
    const first = real[0].frames[0].validTime;
    const axis = hourly(first, 30);
    for (const id of spots) same(real, ids, id, axis);
  });
});

describe("placeHours", () => {
  it("rates daylight only, from the consensus in knots", () => {
    const m = windManifest({
      model: "harmonie",
      runTime: "2026-10-05T00:00:00Z",
      hours: Array.from({ length: 24 }, (_, i) => i),
      wind: () => ({ u: -7, v: 0, gust: 9 }),
    });
    const axis = hourly("2026-10-05T00:00:00Z", 24);
    const place = { id: "brandon", lat: 52.27, lon: -10.02, facing: 270 };
    const hours = placeHours([m], ["harmonie"], place, axis, DEFAULT_RIDER);
    const light = daylightOn(place, axis);
    hours.forEach((hour, at) => {
      expect(hour.daylight).toBe(light[at]);
      expect(hour.rating === null).toBe(!light[at]);
    });
    const noon = hours[12];
    expect(noon.windKn).toBeCloseTo(7 * 1.94384449, 6);
    expect(noon.rating).toEqual(
      rateHour(
        { windKn: noon.windKn, gustKn: noon.gustKn, from: noon.from, agreement: "high", daylight: true },
        { facing: 270 },
        DEFAULT_RIDER,
      ),
    );
  });
});

describe("offshoreMark", () => {
  const rated = (shore: "offshore" | "cross-off" | "cross") =>
    ({ shore }) as Parameters<typeof offshoreMark>[0];
  it("strikes only a true offshore, and cross-offshore for a learner", () => {
    expect(offshoreMark(rated("offshore"), DEFAULT_RIDER)).toBe("struck");
    expect(offshoreMark(rated("cross-off"), DEFAULT_RIDER)).toBe("cross-off");
    expect(
      offshoreMark(rated("cross-off"), { ...DEFAULT_RIDER, skill: "beginner" }),
    ).toBe("struck");
    expect(offshoreMark(rated("cross"), DEFAULT_RIDER)).toBe(null);
    expect(offshoreMark(null, DEFAULT_RIDER)).toBe(null);
  });
});

describe("pointHours", () => {
  it("reads the sampled frames between their steps, and rates the wind alone", () => {
    const frames = [0, 1, 2, 3].map((h) => ({
      hour: h,
      validTime: new Date(Date.parse("2026-10-05T11:00:00Z") + h * 3600000).toISOString(),
    }));
    const values = [
      { u: -6, v: 0, gust: 9 },
      null,
      { u: -8, v: 0, gust: 11 },
      { u: -8, v: 0, gust: 11 },
    ];
    const axis = ["2026-10-05T11:00:00Z", "2026-10-05T12:30:00Z", "2026-10-05T20:00:00Z"];
    const out = pointHours(frames, values, { lat: 53, lon: -8 }, axis);
    expect(out[0].windKn).toBeCloseTo(6 * 1.94384449, 6);
    // Halfway from 11:00 to 13:00, across the hour not sampled yet.
    expect(out[1].windKn).toBeCloseTo(7.5 * 1.94384449, 6);
    // No beach to rate against: a point is never given stars.
    expect(out.every((hour) => hour.rating === null)).toBe(true);
    // Past the run: nothing, not a borrowed neighbour.
    expect(out[2].windKn).toBe(null);
  });
});
