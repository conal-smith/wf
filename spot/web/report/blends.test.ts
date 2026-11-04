import { describe, expect, it } from "vitest";
import type { ForecastHour, ModelWaves } from "../../../mcp/api/forecast";
import { WAVE_BLEND } from "../../../force5/src/waves";
import type { WaveBlendHour } from "../../../force5/src/waveBlend";
import {
  partOf,
  waveHandovers,
  waveOrder,
  waveWeek,
  windBlend,
  type WeekRow,
} from "./blends";

const HOUR = 3600000;
const T0 = Date.parse("2026-11-04T12:00:00Z");
const iso = (h: number) => new Date(T0 + h * HOUR).toISOString();

describe("windBlend", () => {
  it("reads the forecast's blend of every model, and their range", () => {
    const row = (h: number, blend: number | null): WeekRow => ({
      time: T0 + h * HOUR,
      step: 1,
      hour: {
        wind: { blend_kn: blend, min_kn: 10, max_kn: 20, models: 3 },
      } as unknown as ForecastHour,
    });
    const blend = windBlend([row(0, 14.2), row(1, null)]);
    expect(blend.get(T0)).toEqual({ kn: 14.2, low: 10, high: 20, count: 3 });
    expect(blend.has(T0 + HOUR)).toBe(false);
  });
});

describe("waveOrder", () => {
  it("puts the wave models in the handover order, any other after", () => {
    expect(
      waveOrder(["ecmwf-wave", "zz-wave", "gfs-wave", "mi-swan"], [
        "mi-swan",
        "gfs-wave",
        "ecmwf-wave",
      ]),
    ).toEqual(["mi-swan", "gfs-wave", "ecmwf-wave", "zz-wave"]);
  });
});

describe("waveWeek", () => {
  const model = (
    h: number,
    m: number,
    at = h,
    parts?: ModelWaves["parts"],
  ): ModelWaves => ({
    height_m: m,
    period_s: 10,
    direction_deg: 270,
    time: iso(at),
    ...(parts && { parts }),
  });
  const row = (h: number, byModel: Record<string, ModelWaves>): WeekRow => ({
    time: T0 + h * HOUR,
    step: 1,
    hour: {
      waves: {
        height_m: Object.values(byModel)[0]?.height_m ?? null,
        period_s: 10,
        direction_deg: 270,
        by_model: byModel,
      },
    } as unknown as ForecastHour,
  });
  // SWAN hourly to hour 1; GFS-Wave three-hourly, read from its nearest step.
  const swell = { swell: { height_m: 0.8, period_s: null, direction_deg: null } };
  const wind = { windsea: { height_m: 0.3, period_s: 3, direction_deg: 60 } };
  const rows = [0, 1, 2, 3].map((h) =>
    row(h, {
      ...(h < 2 && { "mi-swan": model(h, 1.0, h, swell) }),
      "gfs-wave": model(h, 1.4 + h / 10, Math.round(h / 3) * 3, wind),
    }),
  );
  const ORDER = ["mi-swan", "gfs-wave"];

  it("reads the finest model at each hour, handed on past its run", () => {
    const week = waveWeek(rows, null, ORDER);
    expect(week.blended).toBe(false);
    expect(week.rows[0]).toMatchObject({
      heightM: 1.0,
      lowM: 1.0,
      highM: 1.4,
      lead: "mi-swan",
      blendM: null,
    });
    expect(week.rows[2]?.lead).toBe("gfs-wave");
    expect(week.rows[2]?.heightM).toBeCloseTo(1.6, 6);
    // Each row's partitions are its headline model's own.
    expect(partOf(week.rows[0], "swell1")?.heightM).toBe(0.8);
    expect(partOf(week.rows[0], "windsea")).toBeNull();
    expect(partOf(week.rows[2], "windsea")?.heightM).toBe(0.3);
    expect(waveHandovers(rows, week)).toEqual([
      { time: T0 + 2 * HOUR, to: "gfs-wave" },
    ]);
    // Each line through its own steps: GFS-Wave's at 0 and 3 alone.
    expect(week.lines.map((l) => l.id)).toEqual(["mi-swan", "gfs-wave"]);
    expect(week.lines[1].points.map((p) => p.time)).toEqual([
      T0,
      T0 + 3 * HOUR,
    ]);
    expect(week.lines[0].last).toBe(T0 + HOUR);
  });

  it("reads the rider's chosen model first", () => {
    const week = waveWeek(rows, null, ["gfs-wave", "mi-swan"]);
    expect(week.rows[0]).toMatchObject({ lead: "gfs-wave", heightM: 1.4 });
    expect(partOf(week.rows[0], "windsea")?.heightM).toBe(0.3);
  });

  describe("over ECMWF's real ladder, three-hourly to +144 h then six-hourly", () => {
    const H = (m: number) => Math.round((1 + m / 100) * 100) / 100;
    const ecmwfSteps = [
      ...Array.from({ length: 49 }, (_, i) => i * 3),
      ...Array.from({ length: 36 }, (_, i) => 150 + i * 6),
    ];
    const nearestStep = (steps: number[], h: number) => {
      const best = steps.reduce((a, b) =>
        Math.abs(b - h) < Math.abs(a - h) ? b : a,
      );
      return Math.abs(best - h) <= 1.5 ? best : null;
    };
    /** Three-hourly rows to +360 h, each model read as the server reads it. */
    const ladder = (gfsHours = 240) => {
      const gfsSteps = Array.from(
        { length: gfsHours / 3 + 1 },
        (_, i) => i * 3,
      );
      return Array.from({ length: 121 }, (_, i): WeekRow => {
        const h = i * 3;
        const e = nearestStep(ecmwfSteps, h);
        const g = gfsHours ? nearestStep(gfsSteps, h) : null;
        const waves: Record<string, ModelWaves> = {
          ...(g !== null && { "gfs-wave": model(g, 0.5 + H(g), g, wind) }),
          ...(e !== null && { "ecmwf-wave": model(e, H(e), e) }),
        };
        return { ...row(h, waves), step: 3 };
      });
    };
    const CHAIN = ["gfs-wave", "ecmwf-wave"];
    const flips = (week: ReturnType<typeof waveWeek>) => {
      const leads = week.rows.flatMap((r) => (r?.lead ? [r.lead] : []));
      return leads.filter((id, i) => i > 0 && id !== leads[i - 1]).length;
    };

    it("carries the headline to the last step, past GFS-Wave", () => {
      const rows = ladder();
      const week = waveWeek(rows, null, CHAIN);
      expect(week.rows.every((r) => r?.heightM != null)).toBe(true);
      expect(week.rows.at(-1)).toMatchObject({
        lead: "ecmwf-wave",
        heightM: H(360),
        held: false,
      });
      // One handover, at the end of GFS-Wave's run, and never back.
      expect(waveHandovers(rows, week)).toEqual([
        { time: T0 + 243 * HOUR, to: "ecmwf-wave" },
      ]);
    });

    it("reads an hour between two six-hourly steps from the nearer, the earlier if halfway", () => {
      const week = waveWeek(ladder(), null, CHAIN);
      // Row 87 is +261 h, halfway between ECMWF's +258 h and +264 h.
      expect(week.rows[87]).toMatchObject({
        lead: "ecmwf-wave",
        heightM: H(258),
        held: true,
      });
      expect(week.rows[86]).toMatchObject({ heightM: H(258), held: false });
    });

    it("keeps a rider's ECMWF the headline to its end, over a finer model", () => {
      const rows = ladder();
      const week = waveWeek(rows, null, ["ecmwf-wave", "gfs-wave"]);
      expect(flips(week)).toBe(0);
      expect(waveHandovers(rows, week)).toEqual([]);
      expect(week.rows.every((r) => r?.lead === "ecmwf-wave")).toBe(true);
      // Between its steps the height never jumps to GFS-Wave's.
      expect(week.rows[53]).toMatchObject({ heightM: H(156), held: true });
      expect(week.rows[53]?.models["ecmwf-wave"].height_m).toBe(H(156));
      expect(week.rows[53]?.models["gfs-wave"].height_m).toBe(0.5 + H(159));
    });

    it("gives every model its reading between steps, so the range and the card hold steady", () => {
      const week = waveWeek(ladder(), null, CHAIN);
      for (const r of [52, 53, 54].map((i) => week.rows[i]!)) {
        expect(r.count).toBe(2);
        expect(r.highM! - r.lowM!).toBeGreaterThan(0.4);
      }
    });

    it("needs no GFS-Wave: ECMWF alone reaches the end, with no handover", () => {
      const rows = ladder(0);
      const week = waveWeek(rows, null, CHAIN);
      expect(week.rows.every((r) => r?.lead === "ecmwf-wave")).toBe(true);
      expect(week.rows.map((r) => r?.held)).toContain(true);
      expect(waveHandovers(rows, week)).toEqual([]);
    });

    it("carries the blend over its own six-hourly end, marked held, not a gap", () => {
      const rows = ladder();
      const blend = ecmwfSteps.map(
        (h): WaveBlendHour => ({
          time: iso(h),
          heightM: H(h),
          lowM: H(h) - 0.1,
          highM: H(h) + 0.1,
          periodS: 10,
          from: 270,
          models: ["ecmwf-wave"],
          count: 1,
          lead: null,
          parts: {},
        }),
      );
      const held = waveWeek(rows, blend, CHAIN);
      expect(held.rows[87]).toMatchObject({
        blendM: H(258),
        blendHeld: true,
        lead: "ecmwf-wave",
      });
      expect(held.rows[86]).toMatchObject({ blendHeld: false });
      const fromBlend = waveWeek(rows, blend, CHAIN, true);
      expect(fromBlend.rows.every((r) => r?.lead === WAVE_BLEND)).toBe(true);
      expect(fromBlend.rows[87]).toMatchObject({ heightM: H(258), held: true });
    });

    it("hands on across a real hole in a run, wider than any step", () => {
      const rows = ladder().map((r, i) =>
        i === 90 || i === 91 || i === 92
          ? {
              ...r,
              hour: {
                waves: {
                  height_m: null,
                  period_s: null,
                  direction_deg: null,
                  by_model: { "gfs-wave": model(i * 3, 2, i * 3) },
                },
              } as unknown as ForecastHour,
            }
          : r,
      );
      const week = waveWeek(rows, null, ["ecmwf-wave", "gfs-wave"]);
      expect(week.rows[91]).toMatchObject({ lead: "gfs-wave", held: false });
      expect(week.rows[94]?.lead).toBe("ecmwf-wave");
    });
  });

  it("sets the blend's nearest time beside the headline where it has the place", () => {
    const blend: WaveBlendHour[] = [0, 3].map((h) => ({
      time: iso(h),
      heightM: 1.2,
      lowM: 0.9,
      highM: 1.5,
      periodS: 11,
      from: 280,
      models: ["mi-swan", "gfs-wave"],
      count: 2,
      lead: "mi-swan",
      parts: {},
    }));
    const week = waveWeek(rows, blend, ORDER);
    expect(week.blended).toBe(true);
    // The headline stays the model's own; the blend and its range beside it.
    expect(week.rows[1]).toMatchObject({
      heightM: 1.0,
      blendM: 1.2,
      blendPeriodS: 11,
      lowM: 0.9,
      highM: 1.5,
    });
    expect(week.rows.map((r) => r?.blendM)).toEqual([1.2, 1.2, 1.2, 1.2]);
  });

  it("reads the blend as the headline for a rider who picks it", () => {
    const blend: WaveBlendHour[] = [0, 1].map((h) => ({
      time: iso(h),
      heightM: 1.2,
      lowM: 0.9,
      highM: 1.5,
      periodS: 11,
      from: 280,
      models: ["mi-swan", "gfs-wave"],
      count: 2,
      lead: "mi-swan",
      parts: { swell: { heightM: 0.8, periodS: null, from: null } },
    }));
    const week = waveWeek(rows, blend, ORDER, true);
    expect(week.rows[0]).toMatchObject({
      heightM: 1.2,
      periodS: 11,
      from: 280,
      lead: "blend",
    });
    expect(partOf(week.rows[0], "swell1")?.heightM).toBe(0.8);
    // Past the blend's times, the finest model at each hour stands in.
    expect(week.rows[3]?.lead).toBe("gfs-wave");
  });
});
