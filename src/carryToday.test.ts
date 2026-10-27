import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER } from "../force5/src/stars";
import { windManifest } from "../force5/src/testing";
import { dockColumns } from "../force5/src/timeline";
import type { RatedPlace } from "./ratings";
import {
  blendColumnModels,
  buildSpotBlend,
  carryToday,
  checkBlendSpots,
  spotBlendHours,
  type BlendRun,
} from "./spotBlend";
import { stripColumns } from "./strip";
import { todayRow } from "./finder/finder";

const HOUR = 3600000;
const brandon: RatedPlace = {
  id: "brandon",
  lat: 52.27,
  lon: -10.16,
  facing: 315,
};
const hourly = (n: number) => Array.from({ length: n + 1 }, (_, i) => i);
const harmonie = (runTime: string, knots = 0) =>
  windManifest({
    model: "harmonie",
    runTime,
    hours: hourly(48),
    // A different wind in every run, so where an hour came from shows.
    wind: (h) => ({ u: 4 + knots + h / 10, v: 1, gust: 8 + knots }),
    extra: { resolutionKm: 2 },
  });
const ecmwf = (runTime: string, u = -3) =>
  windManifest({
    model: "ecmwf",
    runTime,
    hours: Array.from({ length: 41 }, (_, i) => i * 3),
    wind: (h) => ({ u, v: 6 - h / 30, gust: 12 }),
    extra: { resolutionKm: null },
  });
/** Through JSON, as the job writes it and the next job reads it back. */
const blendOf = (manifests: Parameters<typeof buildSpotBlend>[0], at: string) =>
  JSON.parse(
    JSON.stringify(buildSpotBlend(manifests, new Date(at))),
  ) as BlendRun;
const modelAt = (blend: BlendRun, time: string) => {
  const c = blend.spotBlend.brandon.lead![blend.times.indexOf(time)];
  return !c || c === "-" ? null : blend.sources[parseInt(c, 36)].id;
};
const windAt = (blend: BlendRun, time: string) =>
  blend.spotBlend.brandon.wind[blend.times.indexOf(time)];
const utc = (from: string, hours: number) =>
  new Date(Date.parse(from) + hours * HOUR).toISOString();

// 25 October 2026, the day the clocks go back: Irish midnight was 23:00 UTC
// on the 24th, and the day is 25 hours long.
const MIDNIGHT = "2026-10-24T23:00:00.000Z";
const ECMWF = ecmwf("2026-10-24T12:00:00.000Z");
// At 14:05 the blend read HARMONIE's 21 UTC run of the evening before...
const morning = blendOf(
  [harmonie("2026-10-24T21:00:00.000Z", 1), ECMWF],
  "2026-10-25T14:05:00.000Z",
);
// ...and at 18:05 its 15 UTC run, which covers nothing before 15:00.
const evening = blendOf(
  [harmonie("2026-10-25T15:00:00.000Z", 5), ECMWF],
  "2026-10-25T18:05:00.000Z",
);

describe("carryToday", () => {
  const { blend, carried } = carryToday(evening, morning);

  it("keeps today's hours from midnight that the new run does not cover", () => {
    expect(carried).toEqual(hourly(15).map((h) => utc(MIDNIGHT, h)));
    expect(blend.coverage.from).toBe(blend.times[0]);
    expect(blend.coverage.to).toBe(evening.coverage.to);
    for (const time of carried) {
      expect(modelAt(blend, time)).toBe("harmonie");
      expect(windAt(blend, time)).toBe(windAt(morning, time));
    }
    // HARMONIE over ECMWF's own steps, where the new blend had only ECMWF.
    expect(modelAt(evening, "2026-10-25T09:00:00.000Z")).toBe("ecmwf");
    expect(windAt(blend, "2026-10-25T09:00:00.000Z")).toBe(
      windAt(morning, "2026-10-25T09:00:00.000Z"),
    );
    // From the new run's first hour on, the new run is the word.
    for (const time of [
      "2026-10-25T15:00:00.000Z",
      "2026-10-26T12:00:00.000Z",
    ]) {
      expect(windAt(blend, time)).toBe(windAt(evening, time));
      expect(modelAt(blend, time)).toBe(modelAt(evening, time));
    }
  });

  it("does not keep yesterday", () => {
    // The 21 UTC run's 21:00 and 22:00 UTC on the 24th are the 24th in Ireland.
    expect(morning.times).toContain("2026-10-24T22:00:00.000Z");
    expect(carried.every((t) => Date.parse(t) >= Date.parse(MIDNIGHT))).toBe(
      true,
    );
    expect(modelAt(blend, "2026-10-24T22:00:00.000Z")).toBeNull();
  });

  it("holds together as the site and the worker check it", () => {
    expect(() => checkBlendSpots(blend, blend.spotBlend)).not.toThrow();
    const n = blend.times.length;
    for (const source of blend.sources) {
      expect(source.columns.every((c) => c >= 0 && c < n)).toBe(true);
      expect([...source.columns].sort((a, b) => a - b)).toEqual(source.columns);
    }
    const stamps = blend.times.map(Date.parse);
    expect(stamps.every((t, i) => i === 0 || t > stamps[i - 1])).toBe(true);
    // Each source's run is still its newest: the carried hours are its columns.
    const h = blend.sources.find((s) => s.id === "harmonie")!;
    expect(h.runTime).toBe("2026-10-25T15:00:00.000Z");
    expect(blend.times[h.columns[0]]).toBe(MIDNIGHT);
  });

  it("gives the dock and the spot finder the whole of today", () => {
    const now = Date.parse("2026-10-25T18:05:00.000Z");
    const columns = dockColumns(blendColumnModels(blend), now);
    expect(columns[0]).toEqual({ validTime: MIDNIGHT, model: "harmonie" });
    const strip = stripColumns(columns, now);
    expect(strip.filter((c) => c.day === 0).map((c) => c.hour)).toEqual(
      // 00:00 to 01:00 in summer time, then 01:00 again in winter time.
      [0, 1, ...hourly(23).slice(1)],
    );
    // Without it the day began at 15:00.
    const before = stripColumns(
      dockColumns(blendColumnModels(evening), now),
      now,
    );
    // (ECMWF's first step since midnight is 00 UTC, 01:00 in summer time.)
    expect(before[0].hour).toBe(1);
    expect(before.slice(0, 6).map((c) => c.model)).toEqual(
      Array(5).fill("ecmwf").concat("harmonie"),
    );
    // The finder's row of today: from the hour before first light, every hour
    // has its column and its wind, and the gone ones are gone.
    const axis = strip.map((c) => c.validTime);
    const hours = spotBlendHours(blend, brandon, axis, DEFAULT_RIDER)!;
    const row = todayRow(strip, brandon, now)!;
    const morningHours = row.hours.filter(
      (h) => h.time < Date.parse("2026-10-25T15:00:00.000Z"),
    );
    expect(morningHours.length).toBeGreaterThan(6);
    for (const h of morningHours) {
      expect(h.at).not.toBeNull();
      expect(h.gone).toBe(true);
      expect(hours[h.at!].windKn).not.toBeNull();
      expect(hours[h.at!].model).toBe("harmonie");
    }
  });

  it("chains: each blend keeps what the one before it had kept", () => {
    const later = blendOf(
      [harmonie("2026-10-25T18:00:00.000Z", 9), ECMWF],
      "2026-10-25T21:05:00.000Z",
    );
    const next = carryToday(later, blend).blend;
    const h = next.sources.find((s) => s.id === "harmonie")!;
    expect(next.times[h.columns[0]]).toBe(MIDNIGHT);
    // The morning from the 21 UTC run, the afternoon from the 15 UTC run.
    expect(windAt(next, "2026-10-25T08:00:00.000Z")).toBe(
      windAt(morning, "2026-10-25T08:00:00.000Z"),
    );
    expect(windAt(next, "2026-10-25T16:00:00.000Z")).toBe(
      windAt(evening, "2026-10-25T16:00:00.000Z"),
    );
    expect(windAt(next, "2026-10-25T18:00:00.000Z")).toBe(
      windAt(later, "2026-10-25T18:00:00.000Z"),
    );
  });

  it("starts again at midnight: the first blend of a day drops the day before", () => {
    // Winter time: the 26th begins at 00:00 UTC. The 21 UTC run's blend held
    // the whole of the 25th's evening; the 03 UTC run's keeps 00:00 to 02:00.
    const lastNight = carryToday(
      blendOf(
        [harmonie("2026-10-25T21:00:00.000Z", 2), ECMWF],
        "2026-10-26T01:05:00.000Z",
      ),
      blend,
    ).blend;
    // The first blend of the 26th already leaves the 25th's morning behind.
    expect(modelAt(lastNight, "2026-10-25T10:00:00.000Z")).toBeNull();
    expect(modelAt(blend, "2026-10-25T10:00:00.000Z")).toBe("harmonie");
    const early = blendOf(
      [harmonie("2026-10-26T03:00:00.000Z", 7), ECMWF],
      "2026-10-26T06:05:00.000Z",
    );
    const { blend: kept, carried: times } = carryToday(early, lastNight);
    expect(times).toEqual([
      "2026-10-26T00:00:00.000Z",
      "2026-10-26T01:00:00.000Z",
      "2026-10-26T02:00:00.000Z",
    ]);
    // The 25th's hours are gone: ECMWF's own step is all there is of them.
    expect(kept.times).not.toContain("2026-10-25T10:00:00.000Z");
    expect(modelAt(kept, "2026-10-25T09:00:00.000Z")).toBe("ecmwf");
  });

  it("keeps the new run's own word where neither is the lead model", () => {
    // HARMONIE's run began at 06 UTC: before it, the earlier blend had only an
    // older ECMWF run, and the new one has a newer ECMWF run. ECMWF's newer
    // steps stay, rather than the older run's.
    const old = blendOf(
      [harmonie("2026-10-25T06:00:00.000Z"), ECMWF],
      "2026-10-25T09:05:00.000Z",
    );
    const newer = blendOf(
      [
        harmonie("2026-10-25T15:00:00.000Z"),
        ecmwf("2026-10-25T00:00:00.000Z", 2),
      ],
      "2026-10-25T18:05:00.000Z",
    );
    const { blend: kept } = carryToday(newer, old);
    expect(windAt(kept, "2026-10-25T03:00:00.000Z")).toBe(
      windAt(newer, "2026-10-25T03:00:00.000Z"),
    );
    expect(windAt(kept, "2026-10-25T03:00:00.000Z")).not.toBe(
      windAt(old, "2026-10-25T03:00:00.000Z"),
    );
    expect(modelAt(kept, "2026-10-25T06:00:00.000Z")).toBe("harmonie");
    expect(windAt(kept, "2026-10-25T06:00:00.000Z")).toBe(
      windAt(old, "2026-10-25T06:00:00.000Z"),
    );
  });

  it("reads which model an hour was by name, whatever order the sources were in", () => {
    const reordered = blendOf(
      [ECMWF, harmonie("2026-10-24T21:00:00.000Z", 1)],
      "2026-10-25T14:05:00.000Z",
    );
    expect(reordered.sources[0].id).toBe("ecmwf");
    const kept = carryToday(evening, reordered).blend;
    expect(modelAt(kept, "2026-10-25T07:00:00.000Z")).toBe("harmonie");
    expect(windAt(kept, "2026-10-25T07:00:00.000Z")).toBe(
      windAt(morning, "2026-10-25T07:00:00.000Z"),
    );
  });

  it("keeps nothing it cannot stand behind", () => {
    expect(carryToday(evening, null)).toEqual({ blend: evening, carried: [] });
    // A blend built for another order of models.
    const other = { ...morning, lead: { model: "icon-eu", then: "ecmwf" } };
    expect(carryToday(evening, other).carried).toEqual([]);
    // No HARMONIE run in the new blend: nothing says where carrying stops.
    const ecmwfOnly = blendOf([ECMWF], "2026-10-25T18:05:00.000Z");
    expect(carryToday(ecmwfOnly, morning).carried).toEqual([]);
    // A place the new blend no longer has is not brought back.
    const gone = {
      ...morning,
      spotBlend: { ...morning.spotBlend, elsewhere: morning.spotBlend.brandon },
    };
    expect(Object.keys(carryToday(evening, gone).blend.spotBlend)).toEqual([
      "brandon",
    ]);
  });
});

describe("carryToday and HARMONIE's first hour", () => {
  // As Met Éireann publishes it: a run's gust is the most over the hour
  // before each time, so its first time, its initialisation, has none
  // (force5/ingest/fetch_harmonie.py, `gustMissingHours`).
  const published = (runTime: string, knots: number) =>
    windManifest({
      model: "harmonie",
      runTime,
      hours: hourly(48),
      wind: (h) => ({
        u: 4 + knots + h / 10,
        v: 1,
        gust: h === 0 ? null : 8 + knots,
      }),
      extra: { resolutionKm: 2, gustMissingHours: [0] },
    });
  const DAY = "2026-10-27T00:00:00.000Z";
  const at = (hours: number) => utc(DAY, hours);
  // 27 October 2026 as the bucket served it: the runs the hourly blends read
  // through the day, each a few hours after it began.
  const runs: [built: number, run: number][] = [
    [-2, -3],
    [5, 3],
    [8, 6],
    [11, 9],
    [16.75, 14],
    [19.75, 17],
    [20, 17],
  ];
  const ecmwf27 = ecmwf("2026-10-27T00:00:00.000Z");
  const day = runs.reduce<BlendRun | null>(
    (previous, [built, run]) =>
      carryToday(
        blendOf([published(at(run), run + 3), ecmwf27], at(built)),
        previous,
      ).blend,
    null,
  )!;
  const today = day.times.filter((time) => time >= DAY && time < at(24));
  const gaps = (blend: BlendRun) =>
    today.filter((time) => {
      const i = blend.times.indexOf(time);
      const spot = blend.spotBlend.brandon;
      return spot.wind[i] !== null && spot.gust[i] === null;
    });

  it("gives every hour of today with a wind a gust, as the run before had", () => {
    // Before, each run's first hour was kept without its gust, and every
    // blend after it carried the gap on: 03, 06, 09, 14 and 17 by 20:00.
    expect(gaps(day)).toEqual([]);
    for (const time of today)
      if (time < at(21)) expect(modelAt(day, time)).toBe("harmonie");
  });

  it("keeps the earlier run's whole hour there, its wind with its gust", () => {
    // 17:00 is the 14 UTC run's three hours ahead, not the 17 UTC run's
    // initialisation: one run's wind, gust and bearing, never a mixture.
    const i = day.times.indexOf(at(17));
    const fourteen = blendOf([published(at(14), 17), ecmwf27], at(16.75));
    const j = fourteen.times.indexOf(at(17));
    expect(day.spotBlend.brandon.wind[i]).toBe(
      fourteen.spotBlend.brandon.wind[j],
    );
    expect(day.spotBlend.brandon.gust[i]).toBe(
      fourteen.spotBlend.brandon.gust[j],
    );
    expect(day.spotBlend.brandon.from[i]).toBe(
      fourteen.spotBlend.brandon.from[j],
    );
    // After it, the 17 UTC run is the word.
    const seventeen = blendOf([published(at(17), 20), ecmwf27], at(20));
    expect(windAt(day, at(18))).toBe(windAt(seventeen, at(18)));
    expect(() => checkBlendSpots(day, day.spotBlend)).not.toThrow();
  });

  it("leaves the hour without a gust where no earlier blend had one", () => {
    // The first blend there is, with nothing before it: the run's first hour
    // says it has no gust rather than borrowing another model's.
    const alone = carryToday(
      blendOf([published(at(17), 20), ecmwf27], at(20)),
      null,
    ).blend;
    const i = alone.times.indexOf(at(17));
    expect(alone.spotBlend.brandon.wind[i]).not.toBeNull();
    expect(alone.spotBlend.brandon.gust[i]).toBeNull();
  });
});
