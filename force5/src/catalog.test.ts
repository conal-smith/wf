import { describe, expect, it } from "vitest";
import {
  DEFAULT_STALE_AFTER_HOURS,
  MODEL_CATALOG,
  isStale,
  liveModels,
  staleAfterHours,
} from "./catalog";

const HOUR = 3600000;
const RUN = Date.parse("2026-10-21T00:00:00Z");
const after = (hours: number) => RUN + hours * HOUR;

// Stale means later than the schedule allows (issue #120), and the limits are
// force5/ingest/registry.py's: scripts/release/test_monitor.py holds the two
// lists equal, and force5/ingest/test_scheduler.py holds them to the schedule.
describe("staleAfterHours", () => {
  it("gives every model the site reads a limit of its own", () => {
    for (const model of liveModels())
      expect(model.staleAfterHours, model.id).toBeGreaterThan(0);
    // Planned models have no schedule yet, so no limit either.
    for (const model of MODEL_CATALOG.filter(
      (m) => m.planned && m.id !== "harmonie-eps",
    ))
      expect(model.staleAfterHours, model.id).toBeUndefined();
  });

  it("keeps a once-a-day ICON-EU run fresh until the next day's slot is late", () => {
    // 00 UTC, fetched at 03:30: the next day's lands about 28.5 h on.
    expect(isStale("icon-eu", RUN, after(28.5))).toBe(false);
    expect(isStale("icon-eu-weather", RUN, after(28.5))).toBe(false);
    expect(isStale("icon-eu", RUN, after(31))).toBe(true);
  });

  it("keeps MI SWAN's daily run fresh until the next day's has had its slot", () => {
    // Published about 09 UTC and read at 10:15; 19:00 Irish time is 18 h.
    expect(isStale("mi-swan", RUN, after(18))).toBe(false);
    expect(isStale("mi-swan", RUN, after(34.5))).toBe(false);
    expect(isStale("mi-swan", RUN, after(37))).toBe(true);
  });

  it("keeps ECMWF's 00 UTC run fresh while the 12 UTC run is still publishing", () => {
    // The 12 UTC run is complete about 19:35 UTC, its retry slot is 22:20.
    expect(isStale("ecmwf", RUN, after(22.5))).toBe(false);
    // A whole failed cycle is left to the next one's retry.
    expect(isStale("ecmwf", RUN, after(41))).toBe(true);
  });

  it("calls HARMONIE and GFS stale sooner, because they run more often", () => {
    expect(staleAfterHours("harmonie")).toBeLessThan(18);
    expect(isStale("harmonie", RUN, after(9.5))).toBe(false);
    expect(isStale("harmonie", RUN, after(16))).toBe(true);
    expect(isStale("gfs", RUN, after(11.5))).toBe(false);
    expect(isStale("gfs", RUN, after(14))).toBe(true);
    expect(isStale("gfs-wave", RUN, after(14))).toBe(true);
  });

  it("falls back to the old single cutoff for a model it does not know", () => {
    expect(staleAfterHours("not-a-model")).toBe(DEFAULT_STALE_AFTER_HOURS);
    expect(staleAfterHours(undefined)).toBe(DEFAULT_STALE_AFTER_HOURS);
    expect(isStale(undefined, RUN, after(17))).toBe(false);
    expect(isStale(undefined, RUN, after(19))).toBe(true);
  });
});
