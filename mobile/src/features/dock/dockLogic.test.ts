import { describe, expect, it } from "vitest";
import { defaultPrefs, setRow } from "../../../../force5/src/prefs";
import { DEFAULT_RIDER, rateHour } from "../../../../force5/src/stars";
import type { TideCurve } from "../../../../force5/src/tides";
import type { PlaceHour } from "../../../../src/ratings";
import {
  stripDays,
  stripGeometry,
  stripTrack,
  type StripColumn,
} from "../../../../src/strip";
import { windScale } from "../../theme/tokens";
import {
  beyondMapModel,
  columnWidths,
  commitDue,
  compassWords,
  darkRuns,
  dayTide,
  dockHandovers,
  dockRowOn,
  handoverLabel,
  hatchPath,
  hourReading,
  nearestCentre,
  prefsView,
  rowLayout,
  speedIn,
  trackCursorAt,
  trackParams,
  trackTimeAt,
  viewFromPrefs,
  windFigures,
  windInk,
  xInDay,
} from "./dockLogic";

const HOUR = 3600000;
const T0 = Date.parse("2026-10-17T00:00:00Z"); // a Saturday; Irish summer time ended Oct 25

function columns(count: number, coarseFrom = Infinity): StripColumn[] {
  const out: StripColumn[] = [];
  let t = T0;
  for (let i = 0; i < count; i++) {
    const time = t;
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Dublin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(time));
    out.push({
      validTime: new Date(time).toISOString(),
      model: i < 48 ? "harmonie" : "ecmwf",
      time,
      date,
      hour: Number(
        new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", hourCycle: "h23" }).format(
          new Date(time),
        ),
      ),
      day: 0,
    } as StripColumn);
    t += i >= coarseFrom ? 3 * HOUR : HOUR;
  }
  return out;
}

const hour = (over: Partial<PlaceHour> = {}): PlaceHour => {
  const base = { windKn: 18, gustKn: 24, from: 247.5, agreement: "high" as const, daylight: true };
  const input = { ...base, ...over };
  return {
    ...input,
    rating: rateHour(input, { facing: 270 }, DEFAULT_RIDER),
    ...over,
  };
};

describe("the scrub track", () => {
  it("agrees with the site's stripTrack at every scroll", () => {
    for (const [count, width] of [
      [120, 360],
      [10, 360],
      [4, 400],
      [60, 300],
    ] as const) {
      const cols = columns(count, 72);
      const g = stripGeometry(cols, 52, 48);
      const site = stripTrack(g, width);
      const p = trackParams(g, width);
      for (let s = -20; s <= g.total + 20; s += 7) {
        expect(trackTimeAt(p, s)).toBeCloseTo(site.timeAt(s), 6);
        expect(trackCursorAt(p, s)).toBeCloseTo(site.cursorAt(s), 6);
      }
    }
  });

  it("finds the column under the cursor at each column's snap", () => {
    const cols = columns(100, 60);
    const g = stripGeometry(cols, 52, 48);
    const site = stripTrack(g, 390);
    const p = trackParams(g, 390);
    const centres = cols.map((_, i) => g.x[i] + g.w[i] / 2);
    for (let i = 0; i < cols.length; i++)
      expect(nearestCentre(centres, trackTimeAt(p, site.scrollFor(i)))).toBe(i);
  });

  it("holds a commit back until the interval has passed", () => {
    expect(commitDue(1000, 900)).toBe(false);
    expect(commitDue(1300, 900, 280)).toBe(true);
  });
});

describe("rows", () => {
  it("peeks at the hours, the stars and the wind", () => {
    const layout = rowLayout({ detent: "peek", view: "table", spot: true, more: false, on: () => true });
    expect(layout.slots.map((s) => s.row)).toEqual(["day", "hour", "stars", "wind"]);
  });

  it("opens on the table, the tide and the fold, or the stars over the blend in its place", () => {
    const table = rowLayout({ detent: "open", view: "table", spot: true, more: true, on: () => true });
    expect(table.slots.map((s) => s.row)).toEqual([
      "day", "hour", "stars", "wind", "from", "wing", "tide", "waves", "sky", "air", "rain", "sea",
    ]);
    const blend = rowLayout({ detent: "open", view: "blend", spot: true, more: false, on: () => true });
    expect(blend.slots.map((s) => s.row)).toEqual(["day", "hour", "stars", "blend", "tide"]);
    const starless = rowLayout({ detent: "open", view: "blend", spot: true, more: false, on: (row) => row !== "stars" });
    expect(starless.slots.map((s) => s.row)).toEqual(["day", "hour", "blend", "tide"]);
    expect(blend.height).toBe(blend.slots.reduce((h, s) => h + s.h, 0));
  });

  it("draws the days and the hours alone with no spot", () => {
    const none = rowLayout({ detent: "open", view: "table", spot: false, more: true, on: () => true });
    expect(none.slots.map((s) => s.row)).toEqual(["day", "hour"]);
  });

  it("grows with Dynamic Type, within reason", () => {
    const big = rowLayout({ detent: "peek", view: "table", spot: true, more: false, on: () => true, scale: 3 });
    const base = rowLayout({ detent: "peek", view: "table", spot: true, more: false, on: () => true });
    expect(big.height).toBeGreaterThan(base.height);
    expect(big.height).toBeLessThanOrEqual(Math.ceil(base.height * 1.35) + 4);
    expect(columnWidths(2).cw).toBe(Math.round(52 * 1.35));
  });

  it("keeps the site's rows on until the rider switches them", () => {
    const prefs = defaultPrefs();
    expect(dockRowOn(prefs, "wing")).toBe(true);
    expect(dockRowOn(prefs, "from")).toBe(true);
    expect(dockRowOn(prefs, "sea", false)).toBe(false);
    expect(dockRowOn(setRow(prefs, "wing", false), "wing")).toBe(false);
    expect(dockRowOn(setRow(prefs, "sea", true), "sea", false)).toBe(true);
    expect(dockRowOn(prefs, "wind")).toBe(true);
  });

  it("opens on the table until the chart is chosen", () => {
    expect(viewFromPrefs(defaultPrefs().view)).toBe("table");
    expect(viewFromPrefs(prefsView("blend"))).toBe("blend");
    expect(viewFromPrefs(prefsView("table"))).toBe("table");
  });
});

describe("words", () => {
  it("reads an hour as a sentence", () => {
    const col = columns(15)[14]; // 15:00 Irish summer time
    const kind = hour({ from: 225 });
    expect(kind.rating!.stars).toBe(kind.rating!.potential);
    expect(hourReading(col, kind, "kn")).toBe(
      `Saturday 15:00, ${kind.rating!.stars} stars, south-west 18 knots gusting 24`,
    );
    const lost = hour();
    expect(hourReading(col, lost, "kn")).toBe(
      `Saturday 15:00, ${lost.rating!.stars} stars, ${lost.rating!.potential} possible, west-south-west 18 knots gusting 24`,
    );
  });

  it("never calls the unknown calm", () => {
    const col = columns(1)[0];
    expect(hourReading(col, null, "kn")).toMatch(/not read yet/);
    expect(hourReading(col, hour({ windKn: null, gustKn: null, rating: null }), "kn")).toMatch(
      /no wind reading/,
    );
    expect(hourReading(col, hour({ daylight: false, rating: null }), "kn")).toMatch(/dark, not rated/);
  });

  it("names the one model the stars came from", () => {
    const col = columns(15)[14];
    const rated = hour({ from: 225, model: "gfs" });
    expect(hourReading(col, rated, "kn")).toBe(
      `Saturday 15:00, ${rated.rating!.stars} stars, south-west 18 knots gusting 24, stars from GFS`,
    );
    // An hour with no stars came from no model worth naming.
    expect(hourReading(col, hour({ daylight: false, rating: null, model: "gfs" }), "kn")).not.toMatch(/stars from/);
  });

  it("marks where the model the stars come from changes", () => {
    const strip = columns(24);
    const models = [...Array(22).fill("harmonie"), "ecmwf", "ecmwf"];
    const hours = models.map((model) => hour({ model }));
    // A column no model reached neither starts nor ends a run.
    hours[5] = hour({ model: null, windKn: null, rating: null });
    expect(dockHandovers(hours, strip)).toEqual([{ at: 22, text: "ECMWF from Sat 23:00" }]);
    expect(dockHandovers(null, strip)).toEqual([]);
    expect(dockHandovers(models.map(() => hour({ model: "gfs" })), strip)).toEqual([]);
  });

  it("puts the handover's words beside its stem, clear of the day's name", () => {
    expect(handoverLabel(300, 900, 90, 120)).toEqual({ x: 304, anchor: "start" });
    // Near the day's start the words wait for the name to end.
    expect(handoverLabel(20, 900, 90, 120)).toEqual({ x: 90, anchor: "start" });
    // Near its end they turn back to the stem's left.
    expect(handoverLabel(850, 900, 90, 120)).toEqual({ x: 846, anchor: "end" });
  });

  it("says offshore", () => {
    const off = hour({ from: 90 });
    expect(off.rating!.shore).toBe("offshore");
    expect(hourReading(columns(1)[0], off, "kn")).toMatch(/offshore$/);
  });

  it("converts speeds as the dock does", () => {
    expect(speedIn(18, "kn")).toBe(18);
    expect(speedIn(19.4384449, "m/s")).toBe(10);
    expect(windFigures(hour(), "kn")).toBe("18 g24 · WSW");
    expect(windFigures(null, "kn")).toBe("–");
    expect(compassWords(0)).toBe("north");
  });
});

describe("ink and paper", () => {
  it("colours the wind from its own scale", () => {
    expect(windInk(0)).toBe(windScale[0][1]);
    expect(windInk(17)).toBe(windScale.find(([k]) => k === 15)![1]);
    expect(windInk(99)).toBe(windScale.at(-1)![1]);
  });

  it("hatches inside the box", () => {
    const d = hatchPath(10, 20, 30);
    const xs = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(xs.length).toBeGreaterThan(4);
    for (const [x, y] of xs) {
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(30);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(30);
    }
  });

  it("joins dark columns into runs, day-local", () => {
    const cols = columns(30);
    const g = stripGeometry(cols, 52, 48);
    const days = stripDays(cols);
    const light = cols.map((c) => c.hour >= 8 && c.hour < 19);
    const runs = darkRuns(light, g, days[0]);
    expect(runs[0].x).toBe(0);
    expect(runs.length).toBe(2);
  });
});

describe("the day", () => {
  it("offers the chart's other run past the map model's", () => {
    const cols = columns(60);
    expect(beyondMapModel(cols[10])).toBe(false);
    expect(beyondMapModel(cols[50])).toBe(true);
  });

  it("draws a day of tide with its turns labelled in their bands", () => {
    const cols = columns(48);
    const g = stripGeometry(cols, 52, 48);
    const days = stripDays(cols);
    const from = new Date(T0 - 6 * HOUR).toISOString();
    const curve: TideCurve = {
      stepMinutes: 10,
      from,
      to: new Date(T0 + 60 * HOUR).toISOString(),
      datum: "LAT",
      curve: Array.from({ length: 6 * 66 + 1 }, (_, i) => 2 + 1.5 * Math.cos((i / 6 / 12.42) * 2 * Math.PI)),
      events: [
        { time: new Date(T0 + 6.21 * HOUR - 6 * HOUR).toISOString(), kind: "low", height: 0.5 },
        { time: new Date(T0 + 12.42 * HOUR - 6 * HOUR).toISOString(), kind: "high", height: 3.5 },
      ],
    };
    const tide = dayTide(curve, cols, days[0], g, 46)!;
    expect(tide.line.startsWith("M")).toBe(true);
    expect(tide.turns.map((t) => t.high)).toEqual([false, true]);
    expect(tide.turns.every((t) => t.label !== null)).toBe(true);
    expect(tide.turns[1].full).toMatch(/^High tide \d\d:\d\d · 3\.5 m$/);
    expect(xInDay(cols, days[0], g, cols[0].time)).toBe(26);
  });
});
