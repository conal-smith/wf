import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER, type Rider } from "../../force5/src/stars";
import type { ForecastHour, HourWind } from "../../mcp/api/forecast";
import {
  HOUR,
  clock,
  compass,
  darkRuns,
  dayLeadText,
  dayLeads,
  dayNames,
  daySun,
  foldText,
  dublinDate,
  dublinMidnight,
  goodWindArcs,
  groupDays,
  gustJumps,
  handoverWords,
  leadChanges,
  meanBearing,
  nextMidnight,
  placeChanges,
  rowHours,
  rowWarning,
  rowWater,
  shadeBands,
  shoreSummary,
  skyStopsOn,
  spotRows,
  tideCurve,
  tideHeightAt,
  tideTrend,
  windArcs,
  gustShown,
  windIn,
  windSay,
  windWords,
  type TideTurn,
  type SpotDay,
  FACING_UNKNOWN,
  shoreHeading,
  shoreWords,
} from "./spot";

const wind = (knots: number, deg = 270, gust: number | null = null) =>
  ({
    wind_kn: knots,
    min_kn: knots - 1,
    max_kn: knots + 1,
    gust_kn: gust,
    gust_max_kn: gust,
    direction_deg: deg,
    direction: compass(deg),
    agreement: "high",
    models: 5,
    lead: "harmonie",
    gust_lead: null,
  }) satisfies HourWind;

const hour = (
  iso: string,
  knots: number | null,
  daylight = true,
  deg = 270,
): ForecastHour => ({
  time: iso,
  local: iso,
  daylight,
  wind: knots === null ? null : wind(knots, deg),
});

describe("Irish time", () => {
  it("dates an instant on the Irish calendar, across the clock change", () => {
    // 23:30 UTC on 10 Oct is 00:30 on the 11th in Irish summer time.
    expect(dublinDate(Date.parse("2026-10-10T23:30:00Z"))).toBe("2026-10-11");
    // After the clocks go back (25 Oct 2026), UTC and Irish time agree.
    expect(dublinDate(Date.parse("2026-11-10T23:30:00Z"))).toBe("2026-11-10");
    expect(clock(Date.parse("2026-10-11T12:00:00Z"))).toBe("13:00");
  });

  it("finds the instant an Irish day starts, and the next one", () => {
    expect(new Date(dublinMidnight("2026-10-11")).toISOString()).toBe(
      "2026-10-10T23:00:00.000Z",
    );
    expect(new Date(dublinMidnight("2026-11-11")).toISOString()).toBe(
      "2026-11-11T00:00:00.000Z",
    );
    // The day the clocks go back is 25 hours long.
    expect(nextMidnight("2026-10-25") - dublinMidnight("2026-10-25")).toBe(
      25 * HOUR,
    );
  });

  it("names today and tomorrow, then the weekday", () => {
    const now = Date.parse("2026-10-09T10:00:00Z"); // a Friday
    expect(dayNames("2026-10-09", now).relative).toBe("Today");
    expect(dayNames("2026-10-10", now).relative).toBe("Tomorrow");
    const sunday = dayNames("2026-10-11", now);
    expect(sunday.relative).toBe("Sunday");
    expect(sunday.short).toBe("Sun");
    expect(sunday.full).toBe("Sunday 11 October");
  });
});

describe("the shore", () => {
  it("finds the cross and cross-on arcs either side of onshore", () => {
    // A west-facing beach: WSW to WNW is onshore (within 30° of west), E
    // offshore; cross-on and cross run from 30° to 110° either side of west.
    const arcs = goodWindArcs(270);
    expect(arcs.map((a) => `${a.from}–${a.to}`)).toEqual(["S–SW", "NW–N"]);
  });

  it("keeps an arc whole when it runs through north", () => {
    // Facing north: onshore N, the arcs either side of it.
    const arcs = goodWindArcs(0);
    expect(arcs.map((a) => `${a.from}–${a.to}`)).toEqual(["NE–E", "W–NW"]);
    const wide = windArcs(0, ["onshore", "cross-on", "cross"]);
    expect(wide.map((a) => `${a.from}–${a.to}`)).toEqual(["W–E"]);
  });

  it("says it in one line, or nothing where the facing is unknown", () => {
    expect(shoreSummary(292.5)).toBe(
      "Faces WNW · best in SSW–WSW or NNW–NNE winds",
    );
    expect(shoreSummary(null)).toBeNull();
  });
});

describe("wind", () => {
  it("converts knots into the reader's units", () => {
    expect(windIn(15.4, "kn")).toBe(15);
    expect(windIn(19.44, "m/s")).toBe(10);
    expect(windIn(10, "km/h")).toBe(19);
  });

  it("writes a wind in Force as its force: a figure, a line, words", () => {
    expect(windIn(18, "bft")).toBe(5);
    expect(windSay(18, "bft")).toBe("F5");
    expect(windSay(18, "kn")).toBe("18");
    expect(windWords(18, "bft")).toBe("Force 5");
    expect(windWords(18, "kn")).toBe("18 kn");
  });

  it("leaves out a gust in the wind's own force, in Force only", () => {
    expect(gustShown(17, 20, "bft")).toBeNull();
    expect(gustShown(17, 23, "bft")).toBe(23);
    expect(gustShown(17, 20, "kn")).toBe(20);
    expect(gustShown(17, null, "kn")).toBeNull();
  });

  it("averages directions as vectors, weighted by speed", () => {
    expect(
      meanBearing([
        { deg: 350, weight: 1 },
        { deg: 10, weight: 1 },
      ]),
    ).toBeCloseTo(0, 5);
    expect(
      meanBearing([
        { deg: 225, weight: 10 },
        { deg: 270, weight: 10 },
      ]),
    ).toBeCloseTo(247.5, 5);
    expect(meanBearing([])).toBeNull();
  });
});

describe("rows", () => {
  const now = Date.parse("2026-10-09T10:20:00Z");
  const hours = Array.from({ length: 24 * 5 }, (_, i) =>
    hour(
      new Date(Date.parse("2026-10-09T00:00:00Z") + i * HOUR).toISOString(),
      14,
    ),
  );

  it("starts at the current hour, hourly for three days then three-hourly", () => {
    const rows = rowHours(hours, now);
    expect(new Date(rows[0].time).toISOString()).toBe(
      "2026-10-09T10:00:00.000Z",
    );
    const fine = rows.filter((row) => row.step === 1);
    expect(fine).toHaveLength(72);
    const coarse = rows.filter((row) => row.step === 3);
    expect(coarse.length).toBeGreaterThan(0);
    // Every coarse row sits on an Irish hour divisible by three.
    for (const row of coarse)
      expect(Number(clock(row.time).slice(0, 2)) % 3).toBe(0);
  });

  it("rates daylight rows only, and works out the shore angle for all", () => {
    const rows = spotRows(
      [
        hour("2026-10-09T11:00:00Z", 16, true, 225),
        hour("2026-10-09T21:00:00Z", 16, false, 225),
      ],
      now,
      270,
      DEFAULT_RIDER,
    );
    expect(rows[0].rating?.stars).toBeGreaterThan(0);
    expect(rows[0].shore).toBe("cross-on");
    expect(rows[1].rating).toBeNull();
    expect(rows[1].shore).toBe("cross-on");
  });
});

describe("Met Éireann warnings on the rows", () => {
  const now = Date.parse("2026-10-09T06:00:00Z");
  const warned = (
    iso: string,
    level: "yellow" | "orange" | "red" | null,
  ): ForecastHour => ({
    ...hour(iso, 16, true, 225),
    ...(level && {
      warning: { level, ids: [level], replaces_rating: level !== "yellow" },
    }),
  });

  it("takes the stars away under orange and red, and keeps them under yellow", () => {
    const rows = spotRows(
      [
        warned("2026-10-09T11:00:00Z", null),
        warned("2026-10-09T12:00:00Z", "yellow"),
        warned("2026-10-09T13:00:00Z", "orange"),
        warned("2026-10-09T14:00:00Z", "red"),
      ],
      now,
      270,
      DEFAULT_RIDER,
    );
    const stars = rows[0].rating!.stars;
    expect(stars).toBeGreaterThan(0);
    expect(rows.map((row) => row.rating?.stars ?? null)).toEqual([
      stars,
      stars,
      null,
      null,
    ]);
    expect(rows.map((row) => row.warning?.level ?? null)).toEqual([
      null,
      "yellow",
      "orange",
      "red",
    ]);
  });

  it("gives a three-hour row every warning over its three hours", () => {
    const byTime = new Map(
      [
        warned("2026-10-12T09:00:00Z", "yellow"),
        warned("2026-10-12T10:00:00Z", null),
        warned("2026-10-12T11:00:00Z", "orange"),
        warned("2026-10-12T12:00:00Z", null),
      ].map((h) => [Date.parse(h.time), h]),
    );
    const at = Date.parse("2026-10-12T09:00:00Z");
    expect(rowWarning(byTime, at, 3)).toEqual({
      level: "orange",
      ids: ["yellow", "orange"],
      replaces_rating: true,
    });
    expect(rowWarning(byTime, at, 1)).toEqual({
      level: "yellow",
      ids: ["yellow"],
      replaces_rating: false,
    });
    expect(rowWarning(byTime, at + HOUR, 1)).toBeNull();
  });
});

describe("bathing water notices on the rows", () => {
  const now = Date.parse("2026-10-09T06:00:00Z");
  const watered = (
    iso: string,
    replaces: boolean | null,
  ): ForecastHour => ({
    ...hour(iso, 16, true, 225),
    ...(replaces !== null && {
      water: { ids: [replaces ? "ban" : "may"], replaces_rating: replaces },
    }),
  });

  it("takes the stars under a prohibition, and keeps them beside any other notice", () => {
    const rows = spotRows(
      [
        watered("2026-10-09T11:00:00Z", null),
        watered("2026-10-09T12:00:00Z", false),
        watered("2026-10-09T13:00:00Z", true),
      ],
      now,
      270,
      DEFAULT_RIDER,
    );
    const stars = rows[0].rating!.stars;
    expect(stars).toBeGreaterThan(0);
    expect(rows.map((row) => row.rating?.stars ?? null)).toEqual([
      stars,
      stars,
      null,
    ]);
    expect(rows.map((row) => row.water?.replaces_rating ?? null)).toEqual([
      null,
      false,
      true,
    ]);
  });

  it("gives a three-hour row every notice over its three hours", () => {
    const byTime = new Map(
      [
        watered("2026-10-12T09:00:00Z", false),
        watered("2026-10-12T10:00:00Z", null),
        watered("2026-10-12T11:00:00Z", true),
      ].map((h) => [Date.parse(h.time), h]),
    );
    const at = Date.parse("2026-10-12T09:00:00Z");
    expect(rowWater(byTime, at, 3)).toEqual({
      ids: ["may", "ban"],
      replaces_rating: true,
    });
    expect(rowWater(byTime, at + HOUR, 1)).toBeNull();
  });
});

describe("days", () => {
  const now = Date.parse("2026-10-09T06:00:00Z");
  const rider: Rider = { ...DEFAULT_RIDER, wings: [] };
  // A Friday: dark until 07, light 12–18 kn from the SW, dark from 19.
  const friday = Array.from({ length: 18 }, (_, i) => {
    const h = 6 + i;
    const daylight = h >= 7 && h < 19;
    return hour(
      `2026-10-09T${String(h).padStart(2, "0")}:00:00Z`,
      daylight ? 12 + (h % 7) : 8,
      daylight,
      225,
    );
  });

  it("summarises each Irish day's wind from its daylight rows, and rates no day", () => {
    const days = groupDays(spotRows(friday, now, 270, rider));
    // 23:00 UTC is already Saturday in Ireland.
    expect(days.map((d) => d.date)).toEqual(["2026-10-09", "2026-10-10"]);
    const [day] = days;
    expect(day.windMin).toBe(12);
    expect(day.windMax).toBe(18);
    expect(compass(day.direction!)).toBe("SW");
    expect(day.rows.some((row) => row.rating && row.rating.stars > 0)).toBe(
      true,
    );
    expect(day).not.toHaveProperty("stars");
    expect(day).not.toHaveProperty("best");
    const saturday = days[1];
    expect(saturday.windMin).toBeNull();
  });

  it("folds the dark rows either side of the light ones", () => {
    const rows = spotRows(friday, now, 270, rider);
    const { before, light, after } = darkRuns(rows);
    expect(before).toHaveLength(1);
    expect(light).toHaveLength(12);
    expect(after).toHaveLength(5);
    expect(darkRuns(rows.slice(0, 1)).light).toEqual([]);
  });

  it("names the folds by the sun the stars are rated by, not by the rows", () => {
    const rows = spotRows(friday, now, 270, rider);
    const { before, after } = darkRuns(rows);
    const sun = {
      firstLight: Date.parse("2026-10-09T06:21:00Z"),
      sunrise: Date.parse("2026-10-09T06:55:00Z"),
      sunset: Date.parse("2026-10-09T17:59:00Z"),
      lastLight: Date.parse("2026-10-09T18:33:00Z"),
    };
    expect(foldText("before", before, sun, true)).toBe("Before sunrise 07:55");
    expect(foldText("after", after, sun, true)).toBe("After sunset 18:59");
    // Late today, nothing but night left: not "dark till midnight".
    expect(foldText("before", after, sun, false)).toBe(
      "Dark for the rest of the day",
    );
    // With no sun to go by, the rows' own edges.
    const none = {
      firstLight: null,
      sunrise: null,
      sunset: null,
      lastLight: null,
    };
    expect(foldText("before", before, none, true)).toBe("Dark till 08:00");
    expect(foldText("after", after, none, true)).toBe("Dark from 20:00");
  });
});

describe("tide", () => {
  const t = (iso: string) => Date.parse(iso);
  const turns: TideTurn[] = [
    { time: t("2026-10-09T03:00:00Z"), tide: "high", height: 4 },
    { time: t("2026-10-09T09:12:00Z"), tide: "low", height: 1 },
    { time: t("2026-10-09T15:24:00Z"), tide: "high", height: 4.2 },
  ];

  it("passes through every turn and half way at mid-tide", () => {
    expect(tideHeightAt(turns, turns[0].time)).toBeCloseTo(4);
    expect(tideHeightAt(turns, turns[1].time)).toBeCloseTo(1);
    expect(tideHeightAt(turns, t("2026-10-09T06:06:00Z"))).toBeCloseTo(2.5);
  });

  it("is flat at a turn and steepest at mid-tide (cosine, not straight lines)", () => {
    const near = tideHeightAt(turns, turns[1].time - 10 * 60000)!;
    const mid = tideHeightAt(turns, t("2026-10-09T06:06:00Z"))!;
    const midNext = tideHeightAt(turns, t("2026-10-09T06:16:00Z"))!;
    expect(near - 1).toBeLessThan(mid - midNext);
  });

  it("does not extrapolate past the published turns", () => {
    expect(tideHeightAt(turns, t("2026-10-09T02:00:00Z"))).toBeNull();
    expect(tideHeightAt(turns, t("2026-10-09T16:00:00Z"))).toBeNull();
    const curve = tideCurve(
      turns,
      t("2026-10-09T00:00:00Z"),
      t("2026-10-10T00:00:00Z"),
      30,
    );
    expect(curve[0].time).toBe(turns[0].time);
    expect(curve.at(-1)!.time).toBeLessThanOrEqual(turns[2].time);
  });

  it("knows whether it is coming in or going out", () => {
    expect(tideTrend(turns, t("2026-10-09T05:00:00Z"))).toBe("falling");
    expect(tideTrend(turns, t("2026-10-09T12:00:00Z"))).toBe("rising");
    expect(tideTrend(turns, t("2026-10-09T01:00:00Z"))).toBeNull();
  });
});

describe("daylight", () => {
  // Brandon Bay, on an October day.
  const sun = daySun(52.27, -10.0, "2026-10-09");

  it("orders first light, sunrise, sunset and last light", () => {
    expect(sun.firstLight).toBeLessThan(sun.sunrise!);
    expect(sun.sunrise).toBeLessThan(sun.sunset!);
    expect(sun.sunset).toBeLessThan(sun.lastLight!);
    expect(clock(sun.sunrise!)).toMatch(/^0[78]:/);
    expect(clock(sun.sunset!)).toMatch(/^1[89]:/);
  });

  it("shades night and twilight across the day, and nothing in daylight", () => {
    const start = dublinMidnight("2026-10-09");
    const end = nextMidnight("2026-10-09");
    const bands = shadeBands(sun, start, end);
    expect(bands.map((b) => b.kind)).toEqual([
      "night",
      "twilight",
      "twilight",
      "night",
    ]);
    expect(bands[0].from).toBe(start);
    expect(bands[3].to).toBe(end);
    expect(bands[1].to).toBe(sun.sunrise);
    expect(bands[2].from).toBe(sun.sunset);
  });

  it("shades the whole day when the sun never rises", () => {
    expect(
      shadeBands(
        { firstLight: null, sunrise: null, sunset: null, lastLight: null },
        0,
        10,
      ),
    ).toEqual([{ kind: "night", from: 0, to: 10 }]);
  });
});

describe("gusts", () => {
  it("marks a gust that jumps ten knots or sixty per cent", () => {
    expect(gustJumps(8, 13)).toBe(true);
    expect(gustJumps(20, 29)).toBe(false);
    expect(gustJumps(20, 30)).toBe(true);
    expect(gustJumps(12, null)).toBe(false);
  });
});

describe("the one model the stars come from", () => {
  const now = Date.parse("2026-10-21T06:00:00Z");
  const from = { model: "harmonie", then: "ecmwf" };
  // A Wednesday: HARMONIE's run ends at 21:00 UTC (22:00 Irish), ECMWF after.
  const led = (
    iso: string,
    lead: string | null,
    daylight = true,
  ): ForecastHour => {
    const h = hour(iso, lead === null ? null : 15, daylight);
    return lead === null || !h.wind ? h : { ...h, wind: { ...h.wind, lead } };
  };
  const hours = [
    led("2026-10-21T16:00:00Z", "harmonie"),
    led("2026-10-21T17:00:00Z", "harmonie"),
    led("2026-10-21T20:00:00Z", "harmonie", false),
    led("2026-10-21T21:00:00Z", "ecmwf", false),
    led("2026-10-21T22:00:00Z", null, false),
    led("2026-10-21T23:00:00Z", "ecmwf", false),
  ];
  const rows = spotRows(hours, now, 270, DEFAULT_RIDER);

  it("finds where the model rating the rows changes, a gap neither starting nor ending a run", () => {
    expect(leadChanges(rows)).toEqual([
      {
        time: Date.parse("2026-10-21T21:00:00Z"),
        from: "harmonie",
        to: "ecmwf",
      },
    ]);
    expect(leadChanges(rows.slice(0, 2))).toEqual([]);
  });

  it("says who takes over, when, and why, in the site's words", () => {
    const [change] = leadChanges(rows);
    expect(handoverWords(change, from)).toEqual({
      kicker: "ECMWF from Wed 22:00",
      text: "HARMONIE's run ends here. From here the wind and the stars are ECMWF's, which runs fifteen days.",
    });
    expect(
      handoverWords({ ...change, from: "ecmwf", to: "harmonie" }, from).text,
    ).toBe(
      "HARMONIE reaches this far again, so the stars are its own once more.",
    );
  });

  it("puts a handover before the first row drawn after it, or after the last when its rows are folded away", () => {
    const [change] = leadChanges(rows);
    const light = rows.slice(0, 2);
    const placedLight = placeChanges(light, [change]);
    expect(placedLight.before.size).toBe(0);
    expect(placedLight.end).toEqual([change]);
    const placedAll = placeChanges(rows, [change]);
    expect(placedAll.before.get(change.time)).toEqual([change]);
    expect(placedAll.end).toEqual([]);
    expect(placeChanges([], [change]).end).toEqual([]);
  });

  it("names who rates a day in its header only when it is not just the model chosen", () => {
    expect(dayLeads(rows, from)).toEqual([]);
    const later = spotRows(
      [
        led("2026-10-22T10:00:00Z", "harmonie"),
        led("2026-10-22T11:00:00Z", "ecmwf"),
        led("2026-10-22T12:00:00Z", "ecmwf"),
      ],
      Date.parse("2026-10-22T06:00:00Z"),
      270,
      DEFAULT_RIDER,
    );
    expect(dayLeads(later, from)).toEqual(["harmonie", "ecmwf"]);
    expect(dayLeadText(dayLeads(later, from))).toBe("HARMONIE, then ECMWF");
    expect(dayLeads(later.slice(1), from)).toEqual(["ecmwf"]);
    // A rider who chose ECMWF needs no saying of it.
    expect(dayLeads(later.slice(1), { model: "ecmwf", then: "ecmwf" })).toEqual(
      [],
    );
  });
});

describe("where the sky stops", () => {
  // A day of hours from 06:00 to 21:00, light from 08:00 to 18:00, with the
  // sky model's weather up to (not including) `sky` o'clock.
  const day = (date: string, sky: number) =>
    ({
      date,
      rows: Array.from({ length: 16 }, (_, i) => {
        const at = 6 + i;
        return {
          time: Date.parse(`${date}T${String(at).padStart(2, "0")}:00:00Z`),
          hour: {
            daylight: at >= 8 && at <= 18,
            weather: at < sky ? { air_c: 12 } : undefined,
          },
        };
      }),
    }) as unknown as SpotDay;

  it("is the first day whose light the sky no longer reaches", () => {
    const days = [day("2026-10-20", 24), day("2026-10-21", 14)];
    expect(skyStopsOn([...days, day("2026-10-22", 0)])).toBe("2026-10-21");
  });

  it("passes over a day whose sky runs out only after dark", () => {
    const days = [day("2026-10-21", 20), day("2026-10-22", 0)];
    expect(skyStopsOn([...days, day("2026-10-23", 0)])).toBe("2026-10-22");
  });

  it("is no day where the sky reaches them all", () => {
    expect(skyStopsOn([day("2026-10-20", 24), day("2026-10-21", 24)])).toBe(
      null,
    );
  });
});

describe("the header's shore", () => {
  it("gives a beach its facing and the winds it wants", () => {
    expect(shoreHeading("kilcrea")).toEqual({
      kind: "facing",
      facing: 163,
      best: ["ENE–ESE", "SSW–W"],
    });
  });

  it("says nothing of the shore at a spot on the water, like any other spot", () => {
    expect(shoreHeading("malahide-estuary")).toBeNull();
    expect(shoreWords(null, true)).toBeNull();
  });

  it("still says a beach's facing is unknown where it is", () => {
    for (const id of ["bertra", "rossbeigh", "fi-white-strand-doonbeg"])
      expect(shoreHeading(id), id).toEqual({
        kind: "unknown",
        text: FACING_UNKNOWN,
      });
    expect(FACING_UNKNOWN).toBe("Facing unknown: rated on the wind alone");
    expect(shoreWords(null, false)).toBe("facing unknown: the wind alone");
    expect(shoreWords("cross-off", false)).toBe("cross-offshore");
  });
});
