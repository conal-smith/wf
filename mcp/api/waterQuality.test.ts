import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER } from "../../force5/src/stars";
// What the `water-quality` job published from the EPA's alerts of 15 September
// 2025 (force5/ingest/test_water_quality.py writes and checks the same file).
import published from "../../force5/ingest/fixtures/water-quality-published-20250915.json" with { type: "json" };
import {
  WATER_QUALITY_URL,
  type WaterQualityManifest,
} from "../../force5/src/waterQuality";
import { findSessions, loadSpots, windowFor } from "./forecast";
import { NOT_RATED } from "./rating";
import { FIXTURE_NOW, fixtureSource } from "./testing";
import { INSTRUCTIONS, findWind, getSpotForecast } from "./tools";
import { ratingUnderWater, type WaterAnswer } from "./waterQuality";

const HOUR = 3600000;
/** When the job read the API: the fixtures' clock stands in for it. */
const READ = Date.parse("2025-09-15T13:30:00Z");

/**
 * The published file moved to the fixtures' clock, its times by whole days so
 * each still starts at an Irish midnight (366 days: 14 Sept 2025 is 15 Sept 2026).
 */
function file(
  edit: (m: WaterQualityManifest) => void = () => {},
  age = 0,
): WaterQualityManifest {
  const m = JSON.parse(JSON.stringify(published)) as WaterQualityManifest;
  const days = Math.round((FIXTURE_NOW - READ) / (24 * HOUR));
  const shift = (iso: string) =>
    new Date(Date.parse(iso) + days * 24 * HOUR).toISOString();
  const runTime = new Date(
    Math.floor((FIXTURE_NOW - age * HOUR) / HOUR) * HOUR,
  ).toISOString();
  Object.assign(m, { runTime, generatedAt: runTime });
  for (const n of m.notices) {
    if (n.from) n.from = shift(n.from);
    if (n.until) n.until = shift(n.until);
  }
  edit(m);
  return m;
}

const deps = (manifest: WaterQualityManifest | null) => ({
  source: fixtureSource(manifest ? { [WATER_QUALITY_URL]: manifest } : {}),
  now: () => FIXTURE_NOW,
});

const value = <T>(
  outcome: { ok: boolean } & ({ value: unknown } | { message: string }),
) => {
  if (!("value" in outcome)) throw new Error(outcome.message);
  return outcome.value as T;
};

type Forecast = {
  water_quality: WaterAnswer;
  hours: {
    time: string;
    rating?: unknown;
    why_not_rated?: string;
    water?: { ids: string[]; replaces_rating: boolean };
  }[];
};

describe("get_spot_forecast's water quality", () => {
  it("gives the notice at the spot's bathing water as the EPA published it", async () => {
    const answer = value<Forecast>(
      await getSpotForecast.run(
        { spot: "portmarnock", hours: 3 },
        deps(file()),
      ),
    );
    expect(answer.water_quality).toEqual({
      status: "current",
      checked_at: new Date(Math.floor(FIXTURE_NOW / HOUR) * HOUR).toISOString(),
      items: [
        {
          id: "BWI002046",
          beach: "Portmarnock, Velvet Strand Beach",
          km: 0.21,
          restriction: "Bathing is prohibited",
          cause:
            "Water quality deteriorated due to suspected storm water overflow",
          when: "From Tue 15 Sept, expected to last 5 days, until lifted",
          in_force_now: true,
          replaces_ratings: true,
          notice:
            "https://www.beaches.ie/wp-content/files//notice/4f7e4dff-48b5-4677-b15f-e38dc0022eea.pdf",
        },
      ],
      rule: expect.stringMatching(/never call such an hour good or rideable/),
      source: "EPA bathing water notices, beaches.ie, CC BY 4.0",
    });
  });

  it("takes the rating from every hour a prohibition covers, and says why", async () => {
    const answer = value<Forecast>(
      await getSpotForecast.run(
        { spot: "portmarnock", hours: 6, level: "intermediate" },
        deps(file()),
      ),
    );
    expect(answer.hours).toHaveLength(6);
    for (const hour of answer.hours) {
      expect(hour.water).toEqual({
        ids: ["BWI002046"],
        replaces_rating: true,
      });
      expect(hour.rating).toBeNull();
    }
    // Dark hours say so first; the rest say the notice took the stars.
    expect(
      answer.hours.some((h) => h.why_not_rated === NOT_RATED.water),
    ).toBe(true);
  });

  it("leaves the rating beside an all-season restriction, and names it", async () => {
    const answer = value<Forecast>(
      await getSpotForecast.run(
        { spot: "dun-laoghaire", hours: 3 },
        deps(file()),
      ),
    );
    expect(answer.water_quality.items.map((i) => [i.beach, i.km, i.replaces_ratings, i.when])).toEqual([
      ["Dun Laoghaire Baths", 0.92, false, "All season, until lifted"],
    ]);
    for (const hour of answer.hours)
      expect(hour.water).toEqual({
        ids: ["season-IEEABWC090_0000_0060"],
        replaces_rating: false,
      });
  });

  it("says when nothing is known, and is small when there is nothing", async () => {
    const far = value<Forecast>(
      await getSpotForecast.run({ spot: "kilcrea", hours: 3 }, deps(file())),
    );
    expect(far.water_quality).toEqual({
      status: "not-monitored",
      checked_at: expect.any(String),
      items: [],
      note: expect.stringMatching(/No EPA bathing water within 1.5 km.*not a sign it is clean/),
      source: expect.any(String),
    });
    expect(far.hours.every((h) => !("water" in h))).toBe(true);

    const clear = value<Forecast>(
      await getSpotForecast.run(
        { spot: "brandon", hours: 3 },
        deps(file()),
      ),
    );
    expect(clear.water_quality).toEqual({
      status: "current",
      checked_at: expect.any(String),
      items: [],
      source: expect.any(String),
    });
    expect(JSON.stringify(clear.water_quality).length).toBeLessThan(160);
  });

  it("trusts no file older than three hours, and says so", async () => {
    const old = value<Forecast>(
      await getSpotForecast.run(
        { spot: "portmarnock", hours: 3 },
        deps(file(undefined, 4)),
      ),
    );
    expect(old.water_quality.status).toBe("stale");
    expect(old.water_quality.items).toEqual([]);
    expect(old.water_quality.note).toMatch(/beaches\.ie/);
    expect(old.hours.some((h) => "water" in h)).toBe(false);

    const none = value<Forecast>(
      await getSpotForecast.run({ spot: "portmarnock", hours: 3 }, deps(null)),
    );
    expect(none.water_quality.status).toBe("unavailable");
    expect(none.water_quality.note).toMatch(/could not be read/);
  });
});

describe("find_wind under bathing water notices", () => {
  const options = {
    rider: DEFAULT_RIDER,
    minStars: 0,
    daylightOnly: false,
    minSessionHours: 1,
    counties: ["Dublin"],
    limit: 50,
    now: FIXTURE_NOW,
  };
  const window = windowFor(FIXTURE_NOW, { hours: 8, stepHours: 1 });

  it("never counts an hour under a prohibition, and lists the notice with its spots", async () => {
    const spots = await loadSpots(fixtureSource());
    const clear = await findSessions(
      fixtureSource({ [WATER_QUALITY_URL]: file((m) => (m.notices = [])) }),
      spots,
      window,
      options,
    );
    const found = await findSessions(
      fixtureSource({ [WATER_QUALITY_URL]: file() }),
      spots,
      window,
      options,
    );
    const ids = (f: typeof clear) => f.spots.map((s) => s.spot.id);
    expect(ids(clear)).toContain("portmarnock");
    expect(ids(found)).not.toContain("portmarnock");
    expect(ids(found)).toEqual(ids(clear).filter((id) => id !== "portmarnock"));
    // The all-season restriction is named and leaves Dún Laoghaire as it was.
    const harbour = found.spots.find((s) => s.spot.id === "dun-laoghaire")!;
    expect(harbour.water_notices).toEqual(["season-IEEABWC090_0000_0060"]);
    expect(harbour.rideable_hours).toBe(
      clear.spots.find((s) => s.spot.id === "dun-laoghaire")!.rideable_hours,
    );
    expect(
      found.water_quality.items.map((i) => [i.id, i.replaces_ratings, i.spots]),
    ).toEqual([
      ["BWI002046", true, ["portmarnock"]],
      ["season-IEEABWC090_0000_0060", false, ["dun-laoghaire"]],
    ]);
  });

  it("puts water_quality in the tool's answer and its method", async () => {
    const answer = value<{
      water_quality: WaterAnswer;
      method: string;
    }>(
      await findWind.run(
        {
          counties: ["Dublin"],
          min_kn: 0,
          max_kn: 80,
          daylight_only: false,
          hours: 8,
          explain: true,
        },
        deps(file()),
      ),
    );
    expect(answer.water_quality.status).toBe("current");
    expect(answer.water_quality.items.map((i) => i.id)).toContain("BWI002046");
    expect(answer.method).toMatch(/bathing water prohibition/);
  });
});

describe("the rule, for whatever rates an hour", () => {
  it("passes a rating beside a notice and withholds it under one that replaces it", () => {
    expect(ratingUnderWater({ stars: 4 }, null)).toEqual({ stars: 4 });
    expect(ratingUnderWater({ stars: 4 }, { replaces_rating: false })).toEqual({
      stars: 4,
    });
    expect(ratingUnderWater({ stars: 4 }, { replaces_rating: true })).toBeNull();
  });

  it("tells an agent about the water", () => {
    expect(INSTRUCTIONS).toMatch(/Water quality/);
    expect(getSpotForecast.description).toMatch(/water_quality/);
    expect(findWind.description).toMatch(/water_quality/);
  });
});
