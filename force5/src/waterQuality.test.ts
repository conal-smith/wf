import { describe, expect, it } from "vitest";
// What the `water-quality` job published from the EPA's alerts of 15 September
// 2025 (force5/ingest/test_water_quality.py writes and checks the same file).
import published from "../ingest/fixtures/water-quality-published-20250915.json" with { type: "json" };
import {
  WATER_QUALITY_MAX_AGE_HOURS,
  applyWaterQuality,
  noticeName,
  noticeReplacesStars,
  noticeWhen,
  noticesDuring,
  readWaterQualityManifest,
  spotWaterQuality,
  waterQualityStatus,
  type WaterQualityManifest,
} from "./waterQuality";

const HOUR = 3600000;
/** Mon 15 Sept 2025 13:30 UTC: the job read the API at 13:30. */
const NOW = Date.parse("2025-09-15T13:30:00Z");
const file = published as unknown as WaterQualityManifest;
const copy = (): WaterQualityManifest => JSON.parse(JSON.stringify(file));

describe("the published file", () => {
  it("reads what the job publishes", () => {
    expect(readWaterQualityManifest(published)).toBe(published);
  });

  it("refuses a file it cannot trust, rather than reading it as clear", () => {
    const breakages: ((m: Record<string, unknown>) => void)[] = [
      (m) => (m.kind = "warnings"),
      (m) => delete m.spots,
      (m) => (m.notices = {}),
      (m) => ((m.notices as Record<string, unknown>[])[0].kind = "purple"),
      (m) => ((m.notices as Record<string, unknown>[])[0].from = "soon"),
      (m) =>
        ((m.spots as Record<string, Record<string, unknown>[]>).portmarnock[0].km =
          "near"),
    ];
    for (const breakage of breakages) {
      const m = copy() as unknown as Record<string, unknown>;
      breakage(m);
      expect(readWaterQualityManifest(m)).toBeNull();
    }
    expect(readWaterQualityManifest(null)).toBeNull();
  });

  it("trusts a file for as long as the registry gives the job", () => {
    const run = Date.parse(file.runTime);
    expect(waterQualityStatus(file, run + WATER_QUALITY_MAX_AGE_HOURS * HOUR)).toBe(
      "current",
    );
    expect(
      waterQualityStatus(file, run + WATER_QUALITY_MAX_AGE_HOURS * HOUR + 1),
    ).toBe("stale");
    expect(waterQualityStatus(null, NOW)).toBe("unavailable");
  });
});

describe("a place's notices", () => {
  it("takes the notices of its own bathing water", () => {
    const found = spotWaterQuality(file, "portmarnock", NOW);
    expect(found.status).toBe("current");
    expect(found.waters.map((w) => w.name)).toEqual([
      "Portmarnock, Velvet Strand Beach",
    ]);
    expect(found.notices).toHaveLength(1);
    const [n] = found.notices;
    expect(n.notice.restriction).toBe("Bathing is prohibited");
    expect(n.notice.description).toBe(
      "Water quality deteriorated due to suspected storm water overflow",
    );
    expect(n.replacesStars).toBe(true);
    // From the start of 14 Sept, Irish summer time; open until lifted.
    expect(new Date(n.from).toISOString()).toBe("2025-09-13T23:00:00.000Z");
    expect(n.until).toBe(Infinity);
  });

  it("puts what takes the stars first, and a beach's own water before the next", () => {
    const harbour = spotWaterQuality(file, "dun-laoghaire", NOW);
    expect(harbour.waters.map((w) => [w.name, w.km])).toEqual([
      ["Dun Laoghaire Baths", 0.92],
      ["Seapoint", 1.45],
    ]);
    expect(harbour.notices.map((n) => [n.notice.kind, n.replacesStars])).toEqual([
      ["all-season", false],
    ]);
  });

  it("knows nothing where no bathing water is near, and says nothing when stale", () => {
    expect(spotWaterQuality(file, "kilcrea", NOW)).toMatchObject({
      status: "current",
      waters: [],
      notices: [],
      maxDistanceKm: 1.5,
    });
    expect(
      spotWaterQuality(file, "portmarnock", NOW + 4 * HOUR),
    ).toMatchObject({ status: "stale", notices: [] });
  });

  it("drops a notice past its end by the clock", () => {
    const m = copy();
    m.notices[0].until = "2025-09-15T14:00:00Z";
    expect(spotWaterQuality(m, "portmarnock", NOW).notices).toHaveLength(1);
    expect(
      spotWaterQuality(m, "portmarnock", Date.parse("2025-09-15T14:00:00Z"))
        .notices,
    ).toHaveLength(0);
  });
});

describe("the rule", () => {
  it("takes the stars under a prohibition or advice against bathing, and only then", () => {
    expect(noticeReplacesStars("prohibition")).toBe(true);
    expect(noticeReplacesStars("advice-against")).toBe(true);
    expect(noticeReplacesStars("restriction")).toBe(true);
    expect(noticeReplacesStars("prior-warning")).toBe(false);
    expect(noticeReplacesStars("all-season")).toBe(false);
    expect(applyWaterQuality({ stars: 5 }, [])).toEqual({
      rating: { stars: 5 },
      withheld: false,
    });
    expect(
      applyWaterQuality({ stars: 5 }, [
        { replacesStars: false },
        { replacesStars: true },
      ]),
    ).toEqual({ rating: null, withheld: true });
  });

  it("covers the hours between a notice's start and end", () => {
    const m = copy();
    m.notices[0].until = "2025-09-19T23:00:00Z";
    const { notices } = spotWaterQuality(m, "portmarnock", NOW);
    const start = Date.parse("2025-09-13T23:00:00Z");
    const end = Date.parse("2025-09-19T23:00:00Z");
    expect(noticesDuring(notices, start - HOUR)).toHaveLength(0);
    expect(noticesDuring(notices, start)).toHaveLength(1);
    expect(noticesDuring(notices, end - HOUR)).toHaveLength(1);
    expect(noticesDuring(notices, end)).toHaveLength(0);
    // A three-hour row that starts before it.
    expect(noticesDuring(notices, start - 2 * HOUR, start + HOUR)).toHaveLength(
      1,
    );
  });
});

describe("in words", () => {
  it("says what a notice restricts in the EPA's words, and when, in Irish days", () => {
    const [open] = spotWaterQuality(file, "portmarnock", NOW).notices;
    expect(noticeName(open.notice)).toBe("Bathing is prohibited");
    expect(noticeWhen(open)).toBe(
      "From Sun 14 Sept, expected to last 5 days, until lifted",
    );
    const closed = {
      ...open,
      until: Date.parse("2025-09-18T23:00:00Z"),
    };
    expect(noticeWhen(closed)).toBe("Sun 14 Sept – Thu 18 Sept");
    const [season] = spotWaterQuality(file, "dun-laoghaire", NOW).notices;
    expect(noticeName(season.notice)).toBe(
      "Bathing restricted for the whole season",
    );
    expect(noticeWhen(season)).toBe("All season, until lifted");
  });
});
