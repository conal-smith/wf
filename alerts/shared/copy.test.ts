import { describe, expect, it } from "vitest";
import {
  appUpdateCopy,
  calledOffCopy,
  daysSummary,
  digestCopy,
  hoursSummary,
  newCopy,
  ruleSummary,
  updateCopy,
} from "./copy";
import type { AlertMatch } from "./protocol";

const match: AlertMatch = {
  ruleId: "r1",
  spotId: "brandon",
  day: "2026-10-17",
  start: "2026-10-17T13:00:00.000Z",
  end: "2026-10-17T16:00:00.000Z",
  hours: 3,
  stars: 4,
  peakStars: 5,
  windKn: [18, 22],
  gustKn: 26,
  from: 250,
  wing: 5,
  ownWing: true,
  windows: 1,
};

describe("notification copy", () => {
  it("puts the figures first", () => {
    expect(newCopy(match, "Brandon Bay")).toEqual({
      title: "Brandon Bay ★★★★ Sat 14:00–17:00",
      body: "WSW 18–22 kn, gusts 26. Your 5.0 m wing.",
    });
  });

  it("recommends a wing when the rider listed none, and leaves out what is not known", () => {
    expect(
      newCopy({ ...match, ownWing: false, wing: 4.5, gustKn: null, from: null, windKn: [15, 15] }, "Inch").body,
    ).toBe("15 kn. About a 4.5 m wing.");
  });

  it("says what changed in an update", () => {
    expect(updateCopy(match, "Brandon Bay", { ...match, stars: 3 }).body).toBe(
      "Update. Was ★★★. WSW 18–22 kn, gusts 26. Your 5.0 m wing.",
    );
    expect(
      updateCopy(match, "Brandon Bay", {
        start: "2026-10-17T09:00:00Z",
        end: "2026-10-17T12:00:00Z",
        stars: 4,
      }).body,
    ).toMatch(/^Update\. Was Sat 10:00–13:00\. /);
  });

  it("calls a window off", () => {
    expect(calledOffCopy(match, "Brandon Bay", { minStars: 4 })).toEqual({
      title: "Off: Brandon Bay Sat 14:00–17:00",
      body: "No longer ★★★★ or better. The forecast moved on.",
    });
  });

  it("folds many windows into one", () => {
    const lines = ["A", "B", "C", "D", "E"].map((spotName) => ({ spotName, match }));
    expect(digestCopy(lines)).toEqual({
      title: "★★★★ at 5 spots",
      body: "A Sat 14:00–17:00 · B Sat 14:00–17:00 · C Sat 14:00–17:00 · D Sat 14:00–17:00 and 1 more.",
    });
  });

  it("names the store for an app update unless told what to say", () => {
    expect(appUpdateCopy("1.4.0", "ios")).toEqual({
      title: "Wingfoil 1.4.0",
      body: "A new version is out. Update from the App Store.",
    });
    expect(appUpdateCopy("1.4.0", "android", { body: "Tides on the chart." }).body).toBe(
      "Tides on the chart.",
    );
  });
});

describe("summaries", () => {
  it("names the usual sets of days", () => {
    expect(daysSummary(["sun", "sat"])).toBe("Weekends");
    expect(daysSummary(["mon", "tue", "wed", "thu", "fri"])).toBe("Weekdays");
    expect(daysSummary(["sun", "mon", "tue", "wed", "thu", "fri", "sat"])).toBe("Every day");
    expect(daysSummary(["sat", "wed", "mon"])).toBe("Mon, Wed, Sat");
  });

  it("reads hours as a clock range, the whole day as daylight", () => {
    expect(hoursSummary(9, 18)).toBe("09:00–18:00");
    expect(hoursSummary(0, 24)).toBe("Daylight");
    expect(ruleSummary({ days: ["sat", "sun"], fromHour: 9, toHour: 18, minHours: 2 })).toBe(
      "Weekends · 09:00–18:00 · 2 h or more",
    );
  });
});
