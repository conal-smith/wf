import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER } from "../../force5/src/stars";
import { WARNINGS_URL, type MetWarning } from "../../force5/src/warnings";
import {
  findSessions,
  findSpot,
  loadSpots,
  spotForecast,
  windowFor,
} from "./forecast";
import { FIXTURE_NOW, fixtureSource } from "./testing";
import { INSTRUCTIONS, findWind, getSpotForecast, listSpots } from "./tools";
import { NOT_RATED } from "./rating";
import { ratingUnderWarnings } from "./warnings";

const HOUR = 3600000;
const at = (offset: number) =>
  new Date(FIXTURE_NOW + offset * HOUR).toISOString();

/** A warning as Met Éireann's feed writes one, around the fixtures' clock. */
const warning = (over: Partial<MetWarning>): MetWarning => ({
  id: 1,
  capId: "2.49.0.1.372.0.orange",
  type: "Wind",
  severity: "Severe",
  certainty: "Likely",
  level: "orange",
  issued: at(-6),
  updated: at(-6),
  onset: at(2),
  expiry: at(5),
  headline: "Status Orange - Wind warning for Dublin",
  description: "<p>Southwest winds will reach mean speeds of 65 km/h.</p>",
  status: "Warning",
  regions: ["EI07"],
  ...over,
});

const yellowMarine = warning({
  id: 2,
  capId: "2.49.0.1.372.0.yellow",
  type: "small-craft",
  severity: "Moderate",
  level: "yellow",
  onset: at(-2),
  expiry: at(30),
  headline: "Small Craft warning for all coasts of Ireland",
  regions: ["EI809", "EI810", "EI811"],
});

const published = (
  warnings: MetWarning[],
  runTime = at(0).slice(0, 13) + ":00:00.000Z",
) => ({
  schemaVersion: 1,
  kind: "warnings",
  model: "warnings",
  run: runTime.slice(0, 13).replace(/[-T]/g, ""),
  runTime,
  generatedAt: runTime,
  warnings,
});

const source = (warnings: MetWarning[] | null, runTime?: string) =>
  fixtureSource(
    warnings ? { [WARNINGS_URL]: published(warnings, runTime) } : {},
  );

const deps = (warnings: MetWarning[] | null, runTime?: string) => ({
  source: source(warnings, runTime),
  now: () => FIXTURE_NOW,
});

const value = <T>(
  outcome: { ok: boolean } & ({ value: unknown } | { message: string }),
) => {
  if (!("value" in outcome)) throw new Error(outcome.message);
  return outcome.value as T;
};

describe("get_spot_forecast's warnings", () => {
  it("lists every warning for the spot as Met Éireann issued it", async () => {
    const answer = value<{
      warnings: {
        status: string;
        items: Record<string, unknown>[];
        attribution: string;
      };
    }>(
      await getSpotForecast.run(
        { spot: "dollymount", hours: 6 },
        deps([warning({}), yellowMarine]),
      ),
    );
    expect(answer.warnings.status).toBe("current");
    expect(answer.warnings.attribution).toMatch(/Met Éireann/);
    expect(
      answer.warnings.items.map((w) => [w.level, w.type, w.marine]),
    ).toEqual([
      ["orange", "Wind", false],
      ["yellow", "small-craft", true],
    ]);
    const orange = answer.warnings.items[0];
    expect(orange).toMatchObject({
      id: "2.49.0.1.372.0.orange",
      headline: "Status Orange - Wind warning for Dublin",
      onset: at(2),
      expiry: at(5),
      description: "Southwest winds will reach mean speeds of 65 km/h.",
      replaces_ratings: true,
      in_force_now: false,
      areas: ["Dublin"],
    });
    expect(answer.warnings.items[1]).toMatchObject({
      in_force_now: true,
      replaces_ratings: false,
      areas: ["Howth Head to Wicklow Head"],
    });
  });

  it("marks each hour a warning covers, and which take the rating away", async () => {
    const answer = value<{
      hours: {
        time: string;
        warning?: {
          level: string;
          ids: string[];
          replaces_rating: boolean;
        } | null;
      }[];
    }>(
      await getSpotForecast.run(
        { spot: "dollymount", hours: 7 },
        deps([warning({}), yellowMarine]),
      ),
    );
    const marks = answer.hours.map((h) => [
      (Date.parse(h.time) - FIXTURE_NOW) / HOUR,
      h.warning?.level,
      h.warning?.replaces_rating,
      h.warning?.ids.length,
    ]);
    expect(marks).toEqual([
      [0, "yellow", false, 1],
      [1, "yellow", false, 1],
      [2, "orange", true, 2],
      [3, "orange", true, 2],
      [4, "orange", true, 2],
      [5, "yellow", false, 1],
      [6, "yellow", false, 1],
    ]);
  });

  it("gives no stars to an hour under orange, and says why", async () => {
    const answer = value<{
      hours: {
        time: string;
        rating?: unknown;
        why_not_rated?: string;
        warning?: { replaces_rating: boolean } | null;
      }[];
    }>(
      await getSpotForecast.run(
        { spot: "dollymount", hours: 7, level: "intermediate" },
        deps([warning({}), yellowMarine]),
      ),
    );
    const under = answer.hours.filter((h) => h.warning?.replaces_rating);
    expect(under).toHaveLength(3);
    for (const hour of under) {
      expect(hour.rating).toBeNull();
      expect(hour.why_not_rated).toBe(NOT_RATED.warning);
    }
    expect(
      answer.hours.filter((h) => h.why_not_rated === NOT_RATED.warning),
    ).toHaveLength(3);
  });

  it("says nothing on the hours of a spot with no warning", async () => {
    const spots = await loadSpots(fixtureSource());
    const brandon = findSpot(spots, "brandon").spot!;
    const forecast = await spotForecast(
      source([warning({})]),
      brandon,
      windowFor(FIXTURE_NOW, { hours: 3 }),
      { now: FIXTURE_NOW },
    );
    expect(forecast.warnings.items).toEqual([]);
    expect(forecast.hours.every((h) => !("warning" in h))).toBe(true);
  });

  it("drops an expired warning, and trusts no file older than three hours", async () => {
    const expired = warning({ onset: at(-5), expiry: at(0) });
    const now = await getSpotForecast.run(
      { spot: "dollymount", hours: 3 },
      deps([expired]),
    );
    expect(
      value<{ warnings: { items: unknown[] } }>(now).warnings.items,
    ).toEqual([]);

    const old = value<{
      warnings: { status: string; items: unknown[]; note: string };
      hours: { warning?: unknown }[];
    }>(
      await getSpotForecast.run(
        { spot: "dollymount", hours: 3 },
        deps([warning({ onset: at(0) })], at(-4)),
      ),
    );
    expect(old.warnings.status).toBe("stale");
    expect(old.warnings.items).toEqual([]);
    expect(old.warnings.note).toMatch(/met\.ie\/warnings/);
    expect(old.hours.some((h) => "warning" in h)).toBe(false);

    const none = value<{ warnings: { status: string; note: string } }>(
      await getSpotForecast.run({ spot: "dollymount", hours: 3 }, deps(null)),
    );
    expect(none.warnings.status).toBe("unavailable");
    expect(none.warnings.note).toMatch(/could not be read/);
  });

  it("says Met Éireann issues no land warnings in Northern Ireland", async () => {
    const answer = value<{ warnings: { note: string } }>(
      await getSpotForecast.run({ spot: "ballyholme", hours: 3 }, deps([])),
    );
    expect(answer.warnings.note).toMatch(/no land warnings/);
  });
});

describe("find_wind under warnings", () => {
  // Every hour the site rates counts, none or more stars.
  const options = {
    rider: DEFAULT_RIDER,
    minStars: 0,
    daylightOnly: false,
    minSessionHours: 1,
    counties: ["Dublin"],
    limit: 30,
    now: FIXTURE_NOW,
  };
  const window = windowFor(FIXTURE_NOW, { hours: 8, stepHours: 1 });

  it("never counts an hour under orange or red, and counts one under yellow", async () => {
    const spots = await loadSpots(fixtureSource());
    const clear = await findSessions(source([]), spots, window, options);
    const yellow = await findSessions(
      source([yellowMarine]),
      spots,
      window,
      options,
    );
    const orange = await findSessions(
      source([warning({})]),
      spots,
      window,
      options,
    );
    const red = await findSessions(
      source([warning({ level: "red", severity: "Extreme" })]),
      spots,
      window,
      options,
    );
    /** Each spot's rideable hours, as offsets from now. */
    const hours = (found: typeof clear) =>
      Object.fromEntries(
        found.spots.map((s) => [
          s.spot.id,
          s.sessions.flatMap((session) =>
            Array.from(
              { length: session.hours },
              (_, i) => (Date.parse(session.from) - FIXTURE_NOW) / HOUR + i,
            ),
          ),
        ]),
      );
    expect(Object.keys(hours(clear)).length).toBeGreaterThan(1);
    expect(hours(yellow)).toEqual(hours(clear));
    // Orange covers offsets 2-4 at every Dublin spot: exactly those go.
    const withoutOrange = Object.fromEntries(
      Object.entries(hours(clear)).map(([id, list]) => [
        id,
        list.filter((h) => h < 2 || h > 4),
      ]),
    );
    expect(hours(orange)).toEqual(withoutOrange);
    expect(hours(red)).toEqual(hours(orange));
    // The orange hours split each spot's day in two.
    const dolly = orange.spots.find((s) => s.spot.id === "dollymount")!;
    expect(dolly.sessions).toHaveLength(2);
    expect(dolly.warnings).toEqual(["2.49.0.1.372.0.orange"]);
    expect(orange.warnings.items.map((w) => w.id)).toEqual([
      "2.49.0.1.372.0.orange",
    ]);
  });

  it("names the warnings in the tool's answer", async () => {
    const answer = value<{
      warnings: {
        status: string;
        items: { id: string; areas: string[] }[];
        rule: string;
      };
      method: string;
    }>(
      await findWind.run(
        {
          counties: ["Dublin"],
          min_kn: 0,
          max_kn: 80,
          daylight_only: false,
          hours: 8,
        },
        deps([warning({}), yellowMarine]),
      ),
    );
    expect(answer.warnings.status).toBe("current");
    expect(answer.warnings.items.map((w) => w.id)).toEqual([
      "2.49.0.1.372.0.orange",
      "2.49.0.1.372.0.yellow",
    ]);
    expect(answer.warnings.items[1].areas).toEqual([
      "Carlingford Lough to Howth Head",
      "Howth Head to Wicklow Head",
      "Wicklow Head to Carnsore Point",
    ]);
    expect(answer.warnings.rule).toMatch(/orange or red/);
    expect(answer.method).toMatch(/orange or red warning is never counted/);
  });
});

describe("list_spots' warnings", () => {
  it("names each spot's warnings and lists each warning once", async () => {
    const answer = value<{
      spots: { id: string; warnings?: string[] }[];
      warnings: { items: { id: string }[] };
    }>(await listSpots.run({}, deps([warning({}), yellowMarine])));
    const byId = new Map(answer.spots.map((s) => [s.id, s.warnings]));
    expect(byId.get("dollymount")).toEqual([
      "2.49.0.1.372.0.orange",
      "2.49.0.1.372.0.yellow",
    ]);
    expect(byId.get("rosslare")).toEqual(["2.49.0.1.372.0.yellow"]);
    expect(byId.get("brandon")).toBeUndefined();
    expect(answer.warnings.items).toHaveLength(2);
  });
});

describe("the rule, for whatever rates an hour", () => {
  it("passes a rating through a yellow warning and withholds it under orange or red", () => {
    expect(ratingUnderWarnings({ stars: 4 }, null)).toEqual({ stars: 4 });
    expect(ratingUnderWarnings({ stars: 4 }, { level: "yellow" })).toEqual({
      stars: 4,
    });
    expect(ratingUnderWarnings({ stars: 4 }, { level: "orange" })).toBeNull();
    expect(ratingUnderWarnings(true, { level: "red" })).toBeNull();
  });

  it("tells an agent to check the warnings", () => {
    expect(INSTRUCTIONS).toMatch(/Met Éireann's official warnings/);
    expect(INSTRUCTIONS).toMatch(/never call such an hour good or rideable/);
    expect(getSpotForecast.description).toMatch(/warnings/);
    expect(findWind.description).toMatch(/orange or red/);
    expect(listSpots.description).toMatch(/warnings/);
  });
});
