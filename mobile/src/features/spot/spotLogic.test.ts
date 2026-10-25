import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER, rateHour } from "../../../../force5/src/stars";
import type { TideCurve } from "../../../../force5/src/tides";
import { daylightOn, type PlaceHour } from "../../../../src/ratings";
import type { StripColumn } from "../../../../src/strip";
import { foldText } from "../../../../spot/web/spot";
import {
  dayItems,
  dayTideCurve,
  dayTurns,
  forecastHour,
  pageDays,
  pageRows,
  parseTimeParam,
  rowAt,
  shareContent,
  tideCeiling,
  tideWords,
  headerLine,
  hourShoreCaption,
} from "./spotLogic";

const HOUR = 3600000;
const NOW = Date.parse("2026-10-17T07:20:00Z"); // Saturday morning, Irish summer time
const PLACE = { lat: 52.27, lon: -10.05 };

function strip(hours: number, coarseAfter = 96): StripColumn[] {
  const out: StripColumn[] = [];
  let t = Date.parse("2026-10-17T00:00:00Z");
  for (let i = 0; i < hours; i++) {
    out.push({ validTime: new Date(t).toISOString(), model: "harmonie", time: t, date: "", hour: 0, day: 0 } as StripColumn);
    t += i >= coarseAfter ? 3 * HOUR : HOUR;
  }
  return out;
}

function rated(columns: readonly StripColumn[], wind = (i: number) => 10 + (i % 24)): PlaceHour[] {
  const light = daylightOn(PLACE, columns.map((c) => c.validTime));
  return columns.map((_, i) => {
    const input = { windKn: wind(i), gustKn: wind(i) + 6, from: 247.5, agreement: "high" as const, daylight: light[i] };
    return { ...input, rating: rateHour(input, { facing: 270 }, DEFAULT_RIDER) };
  });
}

describe("rows", () => {
  it("starts at the hour and goes three-hourly after three days", () => {
    const cols = strip(160);
    const rows = pageRows(cols, rated(cols), NOW, 270, null);
    expect(rows[0].time).toBe(Date.parse("2026-10-17T07:00:00Z"));
    const fine = rows.filter((r) => r.time < NOW + 72 * HOUR);
    expect(fine.every((r, k) => k === 0 || r.time - fine[k - 1].time === HOUR)).toBe(true);
    const far = rows.filter((r) => r.time >= Date.parse("2026-10-17T07:00:00Z") + 72 * HOUR);
    expect(far.length).toBeGreaterThan(3);
    expect(far.every((r) => r.step >= 3 || r === rows.at(-1))).toBe(true);
  });

  it("keeps the forecast's own rating, not a second one", () => {
    const cols = strip(30);
    const hours = rated(cols);
    const rows = pageRows(cols, hours, NOW, 270, null);
    for (const row of rows) expect(row.rating).toBe(hours[row.column].rating);
  });

  it("says no wind when there is none, never calm", () => {
    const place: PlaceHour = { windKn: null, gustKn: null, from: null, agreement: null, daylight: true, rating: null };
    expect(forecastHour({ validTime: "2026-10-17T12:00:00Z" }, place, null, null).wind).toBeNull();
  });
});

describe("days", () => {
  const cols = strip(24 * 8, 200);
  const hours = rated(cols, (i) => (i % 24 >= 11 && i % 24 <= 14 ? 18 : 6));
  const rows = pageRows(cols, hours, NOW, 270, null);
  const days = pageDays(rows, PLACE.lat, PLACE.lon);

  it("groups a week of Irish days, and rates none of them", () => {
    expect(days.length).toBe(7);
    expect(days[0].day.date).toBe("2026-10-17");
    expect(days[1].day.rows.some((r) => r.rating && r.rating.stars >= 2)).toBe(true);
    expect(days[1]).not.toHaveProperty("window");
    expect(days[1].day).not.toHaveProperty("stars");
  });

  it("folds the night, and marks no stretch of the day", () => {
    const items = dayItems(days[1], false, (edge, run) => foldText(edge, run, days[1].sun, true));
    expect(items[0].kind).toBe("fold");
    expect(items.at(-1)!.kind).toBe("tide");
    expect(items.some((i) => "ringed" in i)).toBe(false);
    const open = dayItems(days[1], true, () => "");
    expect(open.filter((i) => i.kind === "row").length).toBe(days[1].day.rows.length);
  });

  it("finds the row a link names", () => {
    const at = rowAt(days, Date.parse("2026-10-18T12:10:00Z"))!;
    expect(at.date).toBe("2026-10-18");
    expect(at.row.time).toBe(Date.parse("2026-10-18T12:00:00Z"));
    expect(rowAt(days, Date.parse("2027-01-01T00:00:00Z"))).toBeNull();
    expect(parseTimeParam("2026-10-18T12:00:00Z", NOW)).toBe(Date.parse("2026-10-18T12:00:00Z"));
    expect(parseTimeParam("14:00", NOW)).toBe(Date.parse("2026-10-17T13:00:00Z"));
    expect(parseTimeParam(undefined, NOW)).toBeNull();
  });
});

describe("tide", () => {
  const from = Date.parse("2026-10-16T22:00:00Z");
  const curve: TideCurve = {
    stepMinutes: 10,
    from: new Date(from).toISOString(),
    to: new Date(from + 30 * HOUR).toISOString(),
    datum: "LAT",
    curve: Array.from({ length: 181 }, (_, i) => 2 + 1.5 * Math.cos((i / 6 / 12.42) * 2 * Math.PI)),
    events: [
      { time: "2026-10-17T05:00:00Z", kind: "low", height: 0.5 },
      { time: "2026-10-17T11:00:00Z", kind: "high", height: 3.5 },
    ],
  };

  it("draws the day from the station's curve and names its turns", () => {
    const points = dayTideCurve(curve, "2026-10-17");
    expect(points[0].time).toBe(Date.parse("2026-10-16T23:00:00Z"));
    expect(points.length).toBe(24 * 6 + 1);
    const turns = dayTurns(curve, "2026-10-17");
    expect(turns.map((t) => t.high)).toEqual([false, true]);
    expect(tideWords(turns, null)).toMatch(/^low tide 06:00, 0\.5 metres; high tide 12:00/);
    expect(tideWords([], "No station near")).toBe("No station near");
    expect(tideCeiling(curve)).toBeCloseTo(4.8);
  });
});

describe("share", () => {
  it("links the site's page for the spot", () => {
    const s = shareContent("Inch Strand", "inch");
    expect(s.url).toBe("https://wingfoil.ie/spot/inch");
    expect(s.message).toBe("Inch Strand wing foil forecast https://wingfoil.ie/spot/inch");
  });
});

describe("the spot's shore", () => {
  it("gives a beach its facing and the winds it wants, as the site does", () => {
    expect(headerLine("kilcrea", "Dublin", 12.34)).toBe(
      "Faces SSE 163° · best ENE–ESE, SSW–W · Dublin · Sea 12.3°",
    );
    expect(hourShoreCaption("kilcrea", "cross", 163)).toBe("cross-shore");
  });

  it("says nothing of the shore at a spot on the water, like any other spot", () => {
    expect(headerLine("malahide-estuary", "Dublin", null)).toBe("Dublin");
    expect(headerLine("malahide-estuary", "Dublin", 14.5)).toBe("Dublin · Sea 14.5°");
    expect(hourShoreCaption("malahide-estuary", null, null)).toBe("");
  });

  it("still says a beach's facing is unknown where it is", () => {
    expect(headerLine("bertra", "Mayo", null)).toBe(
      "Facing unknown: rated on the wind alone · Mayo",
    );
    expect(hourShoreCaption("bertra", null, null)).toBe("facing unknown");
  });
});
