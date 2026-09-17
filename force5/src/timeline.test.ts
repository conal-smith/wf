import { describe, expect, it } from "vitest";
import {
  dockColumns,
  frameForTime,
  framePosition,
  windTrackBackground,
  type ColumnModel,
} from "./timeline";
import { freshness, type FrameInfo, type Manifest, type Wind } from "./weather";

const HOUR = 3600000;
const NOW = Date.parse("2026-09-14T00:00:00Z");

const at = (from: string, hour: number) =>
  new Date(Date.parse(from) + hour * HOUR).toISOString();

const frames = (from: string, hours: readonly number[]): FrameInfo[] =>
  hours.map((hour) => ({
    hour,
    validTime: at(from, hour),
    url: `weather/run/${hour}.json`,
    gustIntervalHours: null,
  }));

/** Every hour from zero to `through`, at `step`. */
const every = (through: number, step: number) =>
  Array.from({ length: Math.floor(through / step) + 1 }, (_, i) => i * step);

/** Only the fields `dockColumns` reads; the rest of the contract is elsewhere. */
function model(
  id: string,
  options: {
    runTime: string;
    hours: number[];
    km: number | null;
    ensemble?: boolean;
    spotsOnly?: boolean;
  },
): ColumnModel {
  const list = frames(options.runTime, options.hours);
  const manifest = {
    model: id,
    runTime: options.runTime,
    resolutionKm: options.km,
    frames: options.spotsOnly ? [] : list,
    spotForecasts: {
      brandon: list.map((frame) => ({
        hour: frame.hour,
        validTime: frame.validTime,
        u: 1,
        v: 1,
        gust: null,
      })),
    },
  } as unknown as Manifest;
  return { id, manifest, ensemble: options.ensemble };
}

/** The models the fixtures and the live site actually offer, around `NOW`. */
const harmonie = () =>
  model("harmonie", {
    runTime: "2026-09-13T18:00:00Z",
    hours: every(60, 1),
    km: 2,
  });
const iconEu = () =>
  model("icon-eu", {
    runTime: "2026-09-13T18:00:00Z",
    hours: every(72, 3),
    km: 6.5,
  });
const ecmwf = () =>
  model("ecmwf", {
    runTime: "2026-09-13T00:00:00Z",
    hours: [...every(144, 3), ...every(360, 6).filter((h) => h > 144)],
    km: 28,
  });
const gfs = () =>
  model("gfs", {
    runTime: "2026-09-13T18:00:00Z",
    hours: every(240, 3),
    km: 28,
  });

const owners = (columns: readonly { model: string }[]) =>
  columns.reduce<string[]>(
    (list, column) =>
      list[list.length - 1] === column.model ? list : [...list, column.model],
    [],
  );

describe("dockColumns", () => {
  it("joins the finest run to the longest one at a single seam", () => {
    const columns = dockColumns([harmonie(), iconEu(), ecmwf(), gfs()], NOW);
    expect(owners(columns)).toEqual(["harmonie", "ecmwf"]);
    // Hourly HARMONIE to +60 h, then ECMWF from its first time past that.
    expect(columns[0].validTime).toBe(at("2026-09-13T18:00:00Z", 0));
    expect(columns[60].validTime).toBe(at("2026-09-13T18:00:00Z", 60));
    expect(columns[61].validTime).toBe(at("2026-09-13T00:00:00Z", 81));
    expect(columns.at(-1)!.validTime).toBe(at("2026-09-13T00:00:00Z", 360));
    // Strictly increasing, with no time published twice at the join.
    const stamps = columns.map((column) => Date.parse(column.validTime));
    expect(stamps.every((time, i) => i === 0 || time > stamps[i - 1])).toBe(
      true,
    );
  });

  it("mixes one-, three- and six-hour cadences without losing a step", () => {
    const columns = dockColumns([harmonie(), ecmwf()], NOW);
    const gaps = columns.map((column, index) =>
      index === 0
        ? 0
        : (Date.parse(column.validTime) -
            Date.parse(columns[index - 1].validTime)) /
          HOUR,
    );
    expect(new Set(gaps.slice(1, 61))).toEqual(new Set([1]));
    expect(gaps[61]).toBe(3);
    expect(new Set(gaps.slice(62))).toEqual(new Set([3, 6]));
  });

  it("drops a model whose run has already ended", () => {
    // Ends at +60 h from a run two and a half days before NOW.
    const stale = model("harmonie", {
      runTime: "2026-09-10T00:00:00Z",
      hours: every(60, 1),
      km: 2,
    });
    const columns = dockColumns([stale, iconEu(), ecmwf()], NOW);
    expect(owners(columns)).toEqual(["icon-eu", "ecmwf"]);
    expect(dockColumns([stale], NOW)).toEqual([]);
  });

  it("keeps a run older than eighteen hours: stale is not expired", () => {
    // ECMWF at 00 UTC lands hours late and reads as stale twice a day. Gating
    // on that would cut the dock from fifteen days to whatever GFS reaches.
    expect(freshness(ecmwf().manifest, NOW)).toBe("stale");
    const columns = dockColumns([harmonie(), ecmwf(), gfs()], NOW);
    expect(owners(columns)).toContain("ecmwf");
    expect(columns.at(-1)!.validTime).toBe(at("2026-09-13T00:00:00Z", 360));
  });

  it("ignores which model the map is drawing", () => {
    // GFS on the map owns no column: it is neither the finest nor the longest.
    const columns = dockColumns([harmonie(), iconEu(), ecmwf(), gfs()], NOW);
    expect(columns.some((column) => column.model === "gfs")).toBe(false);
  });

  it("leaves out an ensemble mean, which is a summary not a timeline", () => {
    const ens = model("ecmwf-ens", {
      runTime: "2026-09-13T00:00:00Z",
      hours: every(1080, 6),
      km: 28,
      ensemble: true,
    });
    const columns = dockColumns([harmonie(), ecmwf(), ens], NOW);
    expect(owners(columns)).toEqual(["harmonie", "ecmwf"]);
  });

  it("falls back to ICON-EU for the near term when HARMONIE is missing", () => {
    expect(owners(dockColumns([iconEu(), ecmwf()], NOW))).toEqual([
      "icon-eu",
      "ecmwf",
    ]);
    // And to GFS for the long range when ECMWF is missing.
    expect(owners(dockColumns([harmonie(), gfs()], NOW))).toEqual([
      "harmonie",
      "gfs",
    ]);
  });

  it("makes no seam when one run is both the finest and the longest", () => {
    const only = dockColumns([ecmwf()], NOW);
    expect(owners(only)).toEqual(["ecmwf"]);
    expect(only).toHaveLength(ecmwf().manifest.frames.length);
    // A long run that the finest one already outlives adds nothing either.
    const short = model("aifs", {
      runTime: "2026-09-13T18:00:00Z",
      hours: every(24, 6),
      km: 28,
    });
    expect(owners(dockColumns([harmonie(), short], NOW))).toEqual(["harmonie"]);
  });

  it("reads a run that publishes spot series but no map frames", () => {
    const seriesOnly = model("harmonie-eps", {
      runTime: "2026-09-13T18:00:00Z",
      hours: every(54, 3),
      km: 2,
      spotsOnly: true,
    });
    expect(owners(dockColumns([seriesOnly, ecmwf()], NOW))).toEqual([
      "harmonie-eps",
      "ecmwf",
    ]);
  });

  it("has no columns at all before the availability sweep answers", () => {
    expect(dockColumns([], NOW)).toEqual([]);
  });
});

describe("frameForTime", () => {
  const list = frames("2026-09-14T00:00:00Z", [0, 3, 6]);
  it("takes the nearest frame inside half the run's own step", () => {
    expect(frameForTime(list, Date.parse("2026-09-14T03:00:00Z"))).toBe(1);
    expect(frameForTime(list, Date.parse("2026-09-14T04:00:00Z"))).toBe(1);
    expect(frameForTime(list, Date.parse("2026-09-14T04:30:00Z"))).toBe(1);
  });
  it("reaches no further than half a step past its own end", () => {
    expect(frameForTime(list, Date.parse("2026-09-14T07:00:00Z"))).toBe(2);
    expect(frameForTime(list, Date.parse("2026-09-14T08:00:00Z"))).toBeNull();
    expect(frameForTime(list, Date.parse("2026-09-13T22:00:00Z"))).toBeNull();
    expect(frameForTime([], NOW)).toBeNull();
  });
  it("gives a single-frame run only its own hour", () => {
    const one = frames("2026-09-14T00:00:00Z", [0]);
    expect(frameForTime(one, Date.parse("2026-09-14T00:00:00Z"))).toBe(0);
    expect(frameForTime(one, Date.parse("2026-09-14T02:00:00Z"))).toBeNull();
  });
});

describe("windTrackBackground", () => {
  const wind = (u: number): Wind => ({ u, v: 0, gust: null });
  it("places each stop by time, so a wider column keeps its share", () => {
    const track = windTrackBackground(
      [wind(5), wind(5), wind(5)],
      ["2026-09-14T00:00:00Z", "2026-09-14T03:00:00Z", "2026-09-14T09:00:00Z"],
    );
    expect(track).toContain("0%");
    expect(track).toMatch(/33\.3/);
    expect(track).toContain("100%");
  });
  it("greys out what has not loaded, and survives an empty axis", () => {
    expect(windTrackBackground([], [])).toBe("#b8cbd0");
    expect(
      windTrackBackground([null, null], ["2026-09-14T00:00:00Z"]),
    ).toContain("#b8cbd0");
  });
});

describe("framePosition", () => {
  it("still interpolates between column times", () => {
    const list = frames("2026-09-14T00:00:00Z", [0, 3, 6]);
    expect(framePosition(list, Date.parse("2026-09-14T01:30:00Z"))).toBe(0.5);
    expect(framePosition(list, Date.parse("2026-09-14T06:00:00Z"))).toBe(2);
    expect(framePosition(list, Date.parse("2026-09-14T07:00:00Z"))).toBeNull();
  });
});
