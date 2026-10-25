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
import { parseRider } from "../force5/src/prefs";
import { ensembleManifest, windManifest } from "../force5/src/testing";
import type { Manifest } from "../force5/src/weather";
import { axisVectors } from "./chart";
import {
  DEFAULT_STARS_FROM,
  leadFor,
  leadOrder,
  pickModel,
  type StarsFrom,
} from "../force5/src/lead";
import { direction } from "../force5/src/weather";
import {
  daylightOn,
  handedPointHours,
  hourWind,
  offshoreMark,
  placeConsensus,
  placeHours,
  pointHours,
  type PlaceHour,
} from "./ratings";
import { warnHours } from "./warnHours";
import type { HourRating } from "../force5/src/stars";
import type { PlaceWarning } from "../force5/src/warnings";
import { readWindRun } from "../tests/bundles";

/** The bundled sample wind runs, each with every spot square merged in. */
const real: Manifest[] = await Promise.all(
  ["latest", "harmonie", "ecmwf", "gfs", "arpege"].map(readWindRun),
);

/** The dock's own path, verbatim: what the fast one has to match. */
function slow(
  manifests: Manifest[],
  ids: string[],
  id: string,
  axis: string[],
  from: StarsFrom = DEFAULT_STARS_FROM,
) {
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
  // The headline: the two models the stars come from, in or out of the blend.
  const heads = leadOrder(from).flatMap((model) => {
    const m = manifests.find((x) => x.model === model);
    return m && spotSeries(m, id) ? [m] : [];
  });
  const headline = blendInputs(
    heads,
    id,
    heads.map((m) => m.model),
    axis,
  );
  const consensus = blendStats(
    perModelLines(lines),
    axis,
    weightOf,
    leadOf,
    headline,
  );
  const bearings = axis.map((_, at) => {
    const model = pickModel(from, (m) =>
      Number.isFinite(headline.find((l) => l.model === m)?.speed[at] ?? NaN),
    );
    const m = heads.find((x) => x.model === model);
    const vector = m ? axisVectors(spotSeries(m, id)!, axis)[at] : null;
    return vector && Math.hypot(vector.u, vector.v) >= 0.1
      ? direction(vector.u, vector.v)
      : null;
  });
  return { consensus, from: bearings };
}

const close = (a: number | null, b: number | null) =>
  a === null || b === null ? a === b : Math.abs(a - b) < 1e-9;

function same(
  manifests: Manifest[],
  ids: string[],
  id: string,
  axis: string[],
  from: StarsFrom = DEFAULT_STARS_FROM,
) {
  const fast = placeConsensus(manifests, ids, id, axis, from);
  const ref = slow(manifests, ids, id, axis, from);
  axis.forEach((_, at) => {
    expect(close(fast.median[at], ref.consensus[at].median)).toBe(true);
    expect(close(fast.gust[at], ref.consensus[at].gust.median)).toBe(true);
    expect(fast.model[at]).toBe(ref.consensus[at].lead);
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

  it("rates every hour from one model: HARMONIE's own, then ECMWF's, never a blend", () => {
    const steady = (model: string, km: number) =>
      windManifest({
        model,
        hours: [0, 3, 6, 9],
        wind: () => ({ u: 0, v: 3, gust: 5 }),
        extra: { resolutionKm: km },
      });
    // HARMONIE from the west at 9 m/s for three hours, then its run ends.
    const harmonie = windManifest({
      model: "harmonie",
      hours: [0, 1, 2, 3],
      wind: (h) => ({ u: 9, v: 0, gust: h === 2 ? null : 13 }),
      extra: { resolutionKm: 2 },
    });
    // ECMWF from the east at 6 m/s, every three hours to +9.
    const ecmwf = windManifest({
      model: "ecmwf",
      hours: [0, 3, 6, 9],
      wind: () => ({ u: -6, v: 0, gust: 8 }),
      extra: { resolutionKm: 9 },
    });
    const others = ["icon-eu", "gfs", "arome", "gefs"];
    const manifests = [harmonie, ecmwf, ...others.map((id) => steady(id, 7))];
    const ids = ["harmonie", "ecmwf", ...others];
    const axis = hourly("2026-09-14T00:00:00Z", 12);
    const c = placeConsensus(manifests, ids, "brandon", axis);
    // HARMONIE's own hour, however many models say otherwise.
    expect(c.model[0]).toBe("harmonie");
    expect(c.median[0]).toBeCloseTo(9);
    expect(c.gust[0]).toBeCloseTo(13);
    expect(c.from[0]).toBeCloseTo(270);
    // An hour HARMONIE gives no gust: its wind, and no gust from anyone else.
    expect(c.median[2]).toBeCloseTo(9);
    expect(c.gust[2]).toBeNull();
    // The agreement is still read across every model, as context.
    expect(c.agreement[0]).toBe("low");
    // Past HARMONIE's run, ECMWF alone, though four models say 3 m/s.
    for (const at of [4, 6, 9]) {
      expect(c.model[at]).toBe("ecmwf");
      expect(c.median[at]).toBeCloseTo(6);
      expect(c.gust[at]).toBeCloseTo(8);
      expect(c.from[at]).toBeCloseTo(90);
    }
    // Past ECMWF too: no stars, not the others' wind.
    expect(c.model[10]).toBeNull();
    expect(c.median[10]).toBeNull();
    // Leaving HARMONIE out of the blend changes the agreement, not the hours.
    const without = placeConsensus(manifests, ["ecmwf", ...others], "brandon", axis);
    expect(without.median).toEqual(c.median);
    expect(without.model).toEqual(c.model);
    // A rider who picked GFS gets GFS's own, then ECMWF's.
    const gfs = placeConsensus(manifests, ids, "brandon", axis, leadFor("gfs"));
    expect(gfs.model[0]).toBe("gfs");
    expect(gfs.median[0]).toBeCloseTo(3);
    expect(gfs.model[10]).toBeNull();
    same(manifests, ids, "brandon", axis);
    same(manifests, ids, "brandon", axis, leadFor("icon-eu"));
    same(manifests, ids, "brandon", axis, leadFor("ecmwf"));
  });

  it("leaves a model out where it publishes nothing for the place", () => {
    const m = windManifest({ model: "harmonie", spotId: "elsewhere" });
    const out = placeConsensus([m], ["harmonie"], "brandon", hourly("2026-09-14T00:00:00Z", 3));
    expect(out.median).toEqual([null, null, null]);
  });

  // The real thing: the bundled sample wind runs, every spot square merged in.
  it.runIf(real.length > 0)("matches the blend on the bundled runs", () => {
    const ids = real.map((m) => m.model);
    const spots = Object.keys(real[0].spotForecasts!).slice(0, 12);
    const first = real[0].frames[0].validTime;
    const axis = hourly(first, 30);
    for (const id of spots) same(real, ids, id, axis);
  });
});

describe("daylightOn", () => {
  const place = { lat: 52.27, lon: -10.02 };
  // Brandon Bay on 5 October 2026: sunset about 18:10 UTC, last light (civil
  // dusk) about 18:45 UTC; first light about 06:15 UTC, sunrise 06:50 UTC.
  const axis = hourly("2026-10-05T00:00:00Z", 24);
  const sun = daylightOn(place, axis);
  const civil = daylightOn(place, axis, { boundary: "civil" });
  const at = (h: number) => [sun[h], civil[h]];

  it("is light from sunrise to sunset, by default", () => {
    expect(at(12)).toEqual([true, true]);
    expect(at(2)).toEqual([false, false]);
    expect(at(22)).toEqual([false, false]);
  });

  it("is light from first to last light with the civil boundary", () => {
    // 18:30 is after sunset but before last light: dark by the sun, lit by
    // the civil boundary; 19:30 is dark by both.
    const half = daylightOn(
      place,
      ["2026-10-05T18:30:00Z", "2026-10-05T19:30:00Z", "2026-10-05T22:00:00Z"],
      { boundary: "civil" },
    );
    expect(half.slice(0, 2)).toEqual([true, false]);
    expect(
      daylightOn(place, ["2026-10-05T18:30:00Z", "2026-10-05T22:00:00Z"])[0],
    ).toBe(false);
    // Every hour lit by the sun is lit by the civil boundary too.
    sun.forEach((lit, h) => lit && expect(civil[h]).toBe(true));
    expect(civil.filter(Boolean).length).toBeGreaterThanOrEqual(
      sun.filter(Boolean).length,
    );
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
    expect(noon.model).toBe("harmonie");
  });

  it("rates every spot from the rider's model, an old choice's own spots and fallback left out", () => {
    const steady = (model: string, u: number) =>
      windManifest({
        model,
        runTime: "2026-10-05T00:00:00Z",
        hours: Array.from({ length: 24 }, (_, i) => i),
        wind: () => ({ u, v: 0, gust: null }),
      });
    const manifests = [steady("harmonie", -7), steady("gfs", -4), steady("ecmwf", -5)];
    const ids = ["harmonie", "gfs", "ecmwf"];
    const axis = hourly("2026-10-05T12:00:00Z", 1);
    const place = { id: "brandon", lat: 52.27, lon: -10.02, facing: 270 };
    const rider = parseRider({
      ...DEFAULT_RIDER,
      starsFrom: { model: "gfs", then: "harmonie", spots: { brandon: "ecmwf" } },
    });
    const hour = placeHours(manifests, ids, place, axis, rider)[0];
    expect(hour.model).toBe("gfs");
    expect(hour.windKn).toBeCloseTo(4 * 1.94384449, 6);
    // The default rider: HARMONIE.
    expect(placeHours(manifests, ids, place, axis, DEFAULT_RIDER)[0].model).toBe("harmonie");
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

describe("handedPointHours", () => {
  const HOUR = 3600000;
  const from = (start: string, hours: readonly number[]) =>
    hours.map((hour) => ({
      hour,
      validTime: new Date(Date.parse(start) + hour * HOUR).toISOString(),
    }));
  // HARMONIE's run, hourly to 13:00; ECMWF's, three-hourly over the same day.
  const harmonie = from("2026-10-24T11:00:00Z", [0, 1, 2]);
  const ecmwf = from("2026-10-24T00:00:00Z", [9, 12, 15, 18, 21]);
  const own = [
    { u: -6, v: 0, gust: 9 },
    { u: -6, v: 0, gust: 9 },
    { u: -6, v: 0, gust: 9 },
  ];
  const axis = [
    "2026-10-24T12:00:00Z",
    "2026-10-24T13:00:00Z",
    "2026-10-24T15:00:00Z",
    "2026-10-24T16:00:00Z",
    "2026-10-24T21:00:00Z",
  ];
  const stretches = [
    {
      from: Date.parse("2026-10-24T15:00:00Z"),
      to: Date.parse("2026-10-24T21:00:00Z"),
    },
  ];
  const place = { lat: 53.52, lon: -6.36 };
  it("goes on past the reader's run in the run handed over to", () => {
    // Only the frames the stretch needs were read: none before 15:00.
    const values = [
      null,
      null,
      { u: 0, v: -10, gust: null },
      { u: 0, v: -13, gust: null },
      { u: 0, v: -12, gust: null },
    ];
    const out = handedPointHours(
      harmonie,
      own,
      [{ manifest: { frames: ecmwf }, values, stretches }],
      place,
      axis,
    );
    // Within HARMONIE's run, HARMONIE's wind.
    expect(out[0].windKn).toBeCloseTo(6 * 1.94384449, 6);
    expect(out[1].windKn).toBeCloseTo(6 * 1.94384449, 6);
    // Past it, ECMWF's: at its own steps and between them.
    expect(out[2].windKn).toBeCloseTo(10 * 1.94384449, 6);
    expect(out[3].windKn).toBeCloseTo(11 * 1.94384449, 6);
    expect(out[3].from).toBe(0);
    expect(out[4].windKn).toBeCloseTo(12 * 1.94384449, 6);
    // Still a point: no stars, whichever run the wind is from.
    expect(out.every((hour) => hour.rating === null)).toBe(true);
  });
  it("leaves a handed hour empty until its run is read, and is the point's own without one", () => {
    const unread = handedPointHours(
      harmonie,
      own,
      [
        {
          manifest: { frames: ecmwf },
          values: ecmwf.map(() => null),
          stretches,
        },
      ],
      place,
      axis,
    );
    expect(unread.slice(2).every((hour) => hour.windKn === null)).toBe(true);
    expect(handedPointHours(harmonie, own, [], place, axis)).toEqual(
      pointHours(harmonie, own, place, axis),
    );
  });
});

describe("an hour, in a line", () => {
  const hour = { windKn: 17.6, gustKn: 23.8, from: 225 };

  it("gives the wind as a list gives it", () => {
    expect(hourWind(hour)).toBe("SW 18g24");
    expect(hourWind({ ...hour, gustKn: null, from: null })).toBe("18");
    expect(hourWind({ ...hour, windKn: null })).toBe("");
  });
});

describe("warnHours", () => {
  const axis = [
    "2026-10-25T10:00:00Z",
    "2026-10-25T11:00:00Z",
    "2026-10-25T12:00:00Z",
    "2026-10-25T15:00:00Z",
  ];
  const rated = { stars: 4, potential: 4 } as HourRating;
  const row = (): PlaceHour => ({
    windKn: 18,
    gustKn: 24,
    from: 250,
    agreement: "high",
    daylight: true,
    rating: rated,
    model: "harmonie",
  });
  const warning = (
    level: "yellow" | "orange",
    onset: string,
    expiry: string,
  ): PlaceWarning =>
    ({
      level,
      onset: Date.parse(onset),
      expiry: Date.parse(expiry),
      marine: false,
      areas: ["EI07"],
      warning: {} as PlaceWarning["warning"],
    }) as PlaceWarning;

  it("leaves the rows alone with no warnings", () => {
    const rows = axis.map(row);
    expect(warnHours(rows, axis, [])).toBe(rows);
  });

  it("takes the stars from the columns an orange warning covers, and names a yellow one", () => {
    const out = warnHours(axis.map(row), axis, [
      warning("yellow", "2026-10-25T09:00:00Z", "2026-10-25T11:00:00Z"),
      // From 13:00: inside the 12:00 column, which runs to 15:00.
      warning("orange", "2026-10-25T13:00:00Z", "2026-10-25T16:00:00Z"),
    ]);
    expect(out.map((h) => h.rating)).toEqual([rated, rated, null, null]);
    expect(out.map((h) => h.warning ?? null)).toEqual([
      { level: "yellow", replacesRating: false },
      null,
      { level: "orange", replacesRating: true },
      { level: "orange", replacesRating: true },
    ]);
    // The wind is still there to read under the warning.
    expect(out[2].windKn).toBe(18);
  });
});
