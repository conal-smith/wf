import { describe, expect, it } from "vitest";
import { RULE_DEFAULTS, type AlertMatch } from "../../../../alerts/shared/protocol";
import { defaultPrefs, withCustomStars } from "../../../../force5/src/prefs";
import { DEFAULT_RIDER, standardRating } from "../../../../force5/src/stars";
import {
  deviceFingerprint,
  draftProblem,
  draftRule,
  emptyAlerts,
  newRuleId,
  nextMatch,
  notificationRoute,
  parseLocal,
  pushSupport,
  ruleName,
  spotsSummary,
  syncLine,
  toggleDay,
  upsertRule,
} from "./alertsLogic";

const names: Record<string, string> = { brandon: "Brandon Bay", inch: "Inch Strand", keel: "Keel Beach" };
const nameOf = (id: string) => names[id] ?? id;

describe("what the phone keeps", () => {
  it("starts empty, and from anything it cannot read", () => {
    expect(parseLocal(null)).toEqual(emptyAlerts());
    expect(parseLocal("{nope")).toEqual(emptyAlerts());
    expect(parseLocal(JSON.stringify({ v: 2, rules: [] }))).toEqual(emptyAlerts());
  });

  it("keeps good rules and mends or drops bad ones, field by field", () => {
    const local = parseLocal(
      JSON.stringify({
        v: 1,
        rules: [
          { id: "a", name: "Brandon", spots: ["brandon", "brandon", 3], minStars: 9, days: ["sun", "sat", "xyz"], fromHour: 18, toHour: 9 },
          { name: "no id" },
        ],
        quietHours: false,
        rev: 4,
        syncedRev: 3,
      }),
    );
    expect(local.rules).toEqual([
      {
        id: "a",
        name: "Brandon",
        spots: ["brandon"],
        minStars: RULE_DEFAULTS.minStars,
        days: ["sat", "sun"],
        fromHour: RULE_DEFAULTS.fromHour,
        toHour: RULE_DEFAULTS.toHour,
        minHours: 2,
        leadDays: 3,
        calledOff: false,
        enabled: true,
      },
    ]);
    expect(local).toMatchObject({ quietHours: false, appUpdates: true, rev: 4, syncedRev: 3 });
  });
});

describe("a draft", () => {
  it("starts from the spot it was opened at", () => {
    const rule = draftRule({ id: "brandon", name: "Brandon Bay" }, "r1");
    expect(rule).toMatchObject({ id: "r1", name: "Brandon Bay", spots: ["brandon"], minStars: 4, minHours: 2, leadDays: 3 });
    expect(draftRule(null, "r2").spots).toEqual([]);
  });

  it("says why it cannot be saved", () => {
    const rule = draftRule({ id: "brandon", name: "Brandon Bay" }, "r1");
    expect(draftProblem(rule)).toBeNull();
    expect(draftProblem({ ...rule, spots: [] })).toBe("Pick at least one spot.");
    expect(draftProblem({ ...rule, days: [] })).toBe("Pick at least one day.");
    expect(draftProblem({ ...rule, fromHour: 15, toHour: 16, minHours: 2 })).toBe(
      "The hours are shorter than the window asked for.",
    );
  });

  it("is named by the rider, else by its spots", () => {
    const rule = draftRule(null, "r1");
    expect(ruleName({ ...rule, name: "  Weekend " }, nameOf)).toBe("Weekend");
    expect(ruleName({ ...rule, spots: ["brandon", "inch", "keel"] }, nameOf)).toBe("Brandon Bay +2");
    expect(ruleName(rule, nameOf)).toBe("Alert");
  });

  it("keeps weekdays in week order, and saves in place", () => {
    expect(toggleDay(["sun", "mon"], "sat")).toEqual(["mon", "sat", "sun"]);
    expect(toggleDay(["mon", "sat"], "mon")).toEqual(["sat"]);
    const a = draftRule(null, "a");
    const b = draftRule(null, "b");
    expect(upsertRule([a, b], { ...a, name: "x" }).map((r) => r.name)).toEqual(["x", ""]);
    expect(upsertRule([a], b).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("gets an id the API accepts", () => {
    expect(newRuleId(Date.parse("2026-10-14T09:00:00Z"), () => 0.5)).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
  });
});

describe("a notification, tapped", () => {
  it("opens the chart at the spot and hour", () => {
    expect(notificationRoute({ kind: "new", spot: "brandon", t: "2026-10-17T13:00:00.000Z" })).toEqual({
      pathname: "/",
      params: { spot: "brandon", t: "2026-10-17T13:00:00.000Z" },
    });
    expect(notificationRoute({ kind: "update", path: "/?spot=inch&t=2026-10-17T13%3A00%3A00.000Z" })).toEqual({
      pathname: "/",
      params: { spot: "inch", t: "2026-10-17T13:00:00.000Z" },
    });
  });

  it("opens About for an app update, and nothing for what it does not know", () => {
    expect(notificationRoute({ kind: "app-update", path: "/settings/about", version: "1.3.0" })).toBe("/settings/about");
    expect(notificationRoute({ kind: "new" })).toBeNull();
    expect(notificationRoute(null)).toBeNull();
  });
});

describe("the lines on the screen", () => {
  it("summarises spots", () => {
    expect(spotsSummary(["brandon"], nameOf)).toBe("Brandon Bay");
    expect(spotsSummary(["brandon", "inch", "keel"], nameOf)).toBe("Brandon Bay, Inch Strand +1");
  });

  it("gives the soonest match, the best of equals", () => {
    const m = (start: string, stars: number) => ({ start, stars }) as AlertMatch;
    expect(nextMatch([m("2026-10-18T10:00:00Z", 5), m("2026-10-17T10:00:00Z", 4), m("2026-10-17T10:00:00Z", 5)])).toEqual(
      m("2026-10-17T10:00:00Z", 5),
    );
    expect(nextMatch([])).toBeNull();
  });

  it("says quietly whether wingfoil.ie has what the phone has", () => {
    const clock = () => "14:02";
    const rules = [draftRule(null, "a")];
    expect(syncLine({ rules: [], rev: 1, syncedRev: 0, syncedAt: null }, "idle", clock)).toBe("");
    expect(syncLine({ rules, rev: 2, syncedRev: 2, syncedAt: 1 }, "idle", clock)).toBe("Up to date, 14:02.");
    expect(syncLine({ rules, rev: 3, syncedRev: 2, syncedAt: 1 }, "offline", clock)).toBe(
      "Saved on this phone. Sends when you are online.",
    );
    expect(syncLine({ rules, rev: 3, syncedRev: 2, syncedAt: 1 }, "syncing", clock)).toBe("Saving…");
  });

  it("tells a build without push from a simulator", () => {
    expect(pushSupport(undefined, true)).toBe("no-project");
    expect(pushSupport("abc", false)).toBe("simulator");
    expect(pushSupport("abc", true)).toBe("ok");
  });

  it("fingerprints device fields whatever their order", () => {
    expect(deviceFingerprint({ a: 1, b: [2] })).toBe(deviceFingerprint({ b: [2], a: 1 }));
    expect(deviceFingerprint({ a: 1 })).not.toBe(deviceFingerprint({ a: 2 }));
  });

  it("sends the rider again when their own stars are set or reset", () => {
    // The device's fields carry the whole rider (sync.ts), so the alerts
    // server rates with the rider's own stars once the phone has them.
    const standard = { rider: DEFAULT_RIDER, quietHours: true };
    const prefs = withCustomStars(defaultPrefs(), standardRating(DEFAULT_RIDER, "beginner"));
    const own = { rider: prefs.rider, quietHours: true };
    expect(deviceFingerprint(own)).not.toBe(deviceFingerprint(standard));
    expect(JSON.parse(deviceFingerprint(own))).toContainEqual(["rider", prefs.rider]);
    const reset = withCustomStars(prefs, null);
    expect(deviceFingerprint({ rider: reset.rider, quietHours: true })).toBe(deviceFingerprint(standard));
  });
});
