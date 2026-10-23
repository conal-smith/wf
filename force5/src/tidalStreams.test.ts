import { describe, expect, it } from "vitest";
import {
  RANGE_SCALE,
  TIDAL_STREAM_SITES,
  streamTurns,
  tidalStreamAt,
  tideRange,
  type TidalStreamSite,
} from "./tidalStreams";
import type { TideEvent } from "./tides";

const site = (id: string) =>
  TIDAL_STREAM_SITES.find((entry) => entry.id === id)!;
const at = (clock: string) => Date.parse(`2026-10-22T${clock}:00Z`);
const HOUR = 3600000;

/** A semi-diurnal day at the station: highs 12:00 and 00:25, lows either side. */
function day(range = 2.95): TideEvent[] {
  const low = 0.4;
  return [
    { time: "2026-10-21T23:35:00Z", kind: "high", height: low + range },
    { time: "2026-10-22T05:45:00Z", kind: "low", height: low },
    { time: "2026-10-22T12:00:00Z", kind: "high", height: low + range },
    { time: "2026-10-22T18:15:00Z", kind: "low", height: low },
    { time: "2026-10-23T00:25:00Z", kind: "high", height: low + range },
    { time: "2026-10-23T06:35:00Z", kind: "low", height: low },
  ];
}

describe("the tidal stream sites", () => {
  it("each has a station, opposed streams, a spring range and its sources", () => {
    expect(TIDAL_STREAM_SITES.length).toBeGreaterThanOrEqual(2);
    for (const s of TIDAL_STREAM_SITES) {
      expect(s.station).toBeTruthy();
      expect(s.springRangeMetres).toBeGreaterThan(1);
      const turn = Math.abs(s.flood.towards - s.ebb.towards);
      expect(Math.abs(turn - 180)).toBeLessThanOrEqual(30);
      expect(new Set(s.turns.map((t) => t.begins))).toEqual(
        new Set(["flood", "ebb"]),
      );
      expect(s.sources.length).toBeGreaterThan(0);
      // UKHO tidal stream figures are copyright: never a source here.
      for (const source of s.sources)
        expect(source.url).not.toMatch(/ukho|admiralty/i);
    }
  });

  it("times Strangford Narrows from Bangor, and Malahide from Dublin Port", () => {
    expect(site("strangford-narrows").station).toBe("Bangor");
    expect(site("malahide-channel").station).toBe("Dublin_Port");
  });
});

describe("streamTurns", () => {
  it("puts Strangford's flood 3½ h before high water and its ebb 2½ h after", () => {
    const turns = streamTurns(site("strangford-narrows"), day());
    const noon = turns.filter((t) => Math.abs(t.time - at("12:00")) < 4 * HOUR);
    expect(noon).toEqual([
      { time: at("08:30"), begins: "flood" },
      { time: at("14:30"), begins: "ebb" },
    ]);
  });

  it("runs Malahide in from low water and out from high, 5 minutes on", () => {
    const turns = streamTurns(site("malahide-channel"), day());
    expect(turns).toContainEqual({ time: at("05:50"), begins: "flood" });
    expect(turns).toContainEqual({ time: at("12:05"), begins: "ebb" });
  });
});

describe("tideRange", () => {
  it("is the high water nearest the middle, less the lows either side", () => {
    expect(tideRange(day(3), at("12:30"))).toBeCloseTo(3);
    const uneven = day(3).map((e) =>
      e.time === "2026-10-22T18:15:00Z" ? { ...e, height: 1.4 } : e,
    );
    // Lows of 0.4 and 1.4 round the noon high of 3.4: a range of 2.5.
    expect(tideRange(uneven, at("12:30"))).toBeCloseTo(2.5);
  });

  it("is null without a high water or a low beside it", () => {
    expect(tideRange([], at("12:00"))).toBeNull();
    expect(
      tideRange(
        [{ time: "2026-10-22T12:00:00Z", kind: "high", height: 3 }],
        at("12:00"),
      ),
    ).toBeNull();
  });
});

describe("tidalStreamAt", () => {
  const narrows = site("strangford-narrows");

  it("peaks half way between the turns at the spring rate for a spring tide", () => {
    const flood = tidalStreamAt(narrows, { events: day(2.91) }, at("11:30"))!;
    expect(flood.stream).toBe("flood");
    expect(flood.slack).toBe(false);
    expect(flood.towards).toBe(narrows.flood.towards);
    expect(flood.knots).toBeCloseTo(5, 5);
    // The ebb runs from 14:30 to 20:55; half way is 17:42:30.
    const ebb = tidalStreamAt(
      narrows,
      { events: day(2.91) },
      at("17:42") + 30000,
    )!;
    expect(ebb.stream).toBe("ebb");
    expect(ebb.towards).toBe(narrows.ebb.towards);
    expect(ebb.knots).toBeCloseTo(7.5, 5);
  });

  it("rises and falls as half a sine", () => {
    const events = { events: day(2.91) };
    const third = tidalStreamAt(narrows, events, at("10:30"))!;
    expect(third.knots).toBeCloseTo(5 * Math.sin(Math.PI / 3), 5);
  });

  it("is slack in the quarter hour round a turn, and under half a knot", () => {
    const events = { events: day(2.91) };
    expect(tidalStreamAt(narrows, events, at("08:35"))!.slack).toBe(true);
    expect(tidalStreamAt(narrows, events, at("14:25"))!.slack).toBe(true);
    expect(tidalStreamAt(narrows, events, at("09:00"))!.slack).toBe(false);
  });

  it("scales the peak by the day's range, within limits", () => {
    const neap = tidalStreamAt(narrows, { events: day(1.455) }, at("11:30"))!;
    expect(neap.peakKnots).toBeCloseTo(2.5, 5);
    const tiny = tidalStreamAt(narrows, { events: day(0.2) }, at("11:30"))!;
    expect(tiny.peakKnots).toBeCloseTo(5 * RANGE_SCALE[0], 5);
    const huge = tidalStreamAt(narrows, { events: day(9) }, at("11:30"))!;
    expect(huge.peakKnots).toBeCloseTo(5 * RANGE_SCALE[1], 5);
  });

  it("is null outside the predictions or across a missing event", () => {
    expect(
      tidalStreamAt(narrows, { events: day() }, at("02:00") - 2 * 86400000),
    ).toBeNull();
    const gappy: TidalStreamSite = {
      ...narrows,
      turns: [{ at: "high", offsetMinutes: 0, begins: "flood" }],
    };
    expect(tidalStreamAt(gappy, { events: day() }, at("13:00"))).toBeNull();
  });
});
