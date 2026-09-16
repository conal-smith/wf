import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TIDES_URL,
  eventsBetween,
  loadTides,
  tideAt,
  tideForSpot,
  tideSpotNote,
  tideStation,
  tideStations,
  validateTideCurve,
  validateTideManifest,
  type TideCurve,
  type TideManifest,
} from "./tides";

const manifest = (): TideManifest => ({
  schemaVersion: 1,
  kind: "tide",
  generatedAt: "2026-09-14T02:00:00Z",
  stations: [
    {
      id: "fenit",
      name: "Fenit",
      lat: 52.27,
      lon: -9.87,
      datum: "LAT",
      url: "marine/tides/fenit.json",
    },
    { id: "dublin-port", name: "Dublin Port", lat: 53.35, lon: -6.22 },
  ],
  spots: {
    brandon: { station: "fenit", distanceKm: 12.4 },
    dollymount: { station: "dublin-port", distanceKm: 4.1 },
  },
  attribution: "Marine Institute tide predictions, CC BY 4.0",
});

// 30-minute samples over six hours: low, high, low.
const curve = (): TideCurve => ({
  stepMinutes: 30,
  from: "2026-09-14T00:00:00Z",
  to: "2026-09-14T06:00:00Z",
  datum: "LAT",
  curve: [0.5, 0.8, 1.2, 1.8, 2.4, 3, 3.4, 3.6, 3.4, 3, 2.4, 1.8, 1.2],
  events: [
    { time: "2026-09-14T00:00:00Z", kind: "low", height: 0.5 },
    { time: "2026-09-14T03:30:00Z", kind: "high", height: 3.6 },
    { time: "2026-09-14T09:30:00Z", kind: "low", height: 0.6 },
  ],
});

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });
afterEach(() => vi.unstubAllGlobals());

describe("tide manifest", () => {
  it("validates stations, spot links and their datum", () => {
    const m = validateTideManifest(manifest());
    expect(tideStations(m)).toHaveLength(2);
    expect(tideStation(m, "fenit")?.datum).toBe("LAT");
    expect(tideStation(m, "cobh")).toBeUndefined();
    expect(() =>
      validateTideManifest({ ...m, kind: "wind" as TideManifest["kind"] }),
    ).toThrow(/Invalid tide manifest/);
    expect(() =>
      validateTideManifest({
        ...m,
        spots: { brandon: { station: "cobh", distanceKm: 1 } },
      }),
    ).toThrow(/Invalid tide manifest/);
    expect(() => validateTideManifest({ ...m, stations: [] })).toThrow(
      /Invalid tide manifest/,
    );
  });
  it("accepts stations keyed by id as well as a list", () => {
    const keyed = validateTideManifest({
      ...manifest(),
      stations: {
        fenit: { id: "fenit", name: "Fenit", lat: 52.27, lon: -9.87 },
        "dublin-port": {
          id: "dublin-port",
          name: "Dublin Port",
          lat: 53.35,
          lon: -6.22,
        },
      },
    });
    expect(tideStations(keyed).map((station) => station.id)).toEqual([
      "fenit",
      "dublin-port",
    ]);
  });
  it("fetches the manifest from the forecast base URL", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return ok(manifest());
      }),
    );
    expect((await loadTides()).kind).toBe("tide");
    expect(urls[0]).toContain(TIDES_URL);
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    await expect(loadTides()).rejects.toThrow(/unavailable/);
  });
});

describe("station curve", () => {
  it("validates the sample count against the declared window", () => {
    expect(validateTideCurve(curve()).curve).toHaveLength(13);
    expect(() =>
      validateTideCurve({ ...curve(), to: "2026-09-14T05:00:00Z" }),
    ).toThrow(/Invalid tide curve/);
    expect(() => validateTideCurve({ ...curve(), datum: "" })).toThrow(
      /Invalid tide curve/,
    );
    expect(() =>
      validateTideCurve({
        ...curve(),
        events: [
          {
            time: "2026-09-14T03:30:00Z",
            kind: "peak" as "high",
            height: 3.6,
          },
        ],
      }),
    ).toThrow(/Invalid tide curve/);
  });
  it("loads the station file a spot maps to, by url or by convention", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return ok(curve());
      }),
    );
    const m = manifest();
    const brandon = await tideForSpot(m, "brandon");
    expect(brandon?.station.id).toBe("fenit");
    expect(brandon?.distanceKm).toBe(12.4);
    expect(brandon?.curve.datum).toBe("LAT");
    expect(urls[0]).toContain("marine/tides/fenit.json");
    await tideForSpot(m, "dollymount");
    expect(urls[1]).toContain("marine/tides/dublin-port.json");
    expect(await tideForSpot(m, "mizen")).toBeNull();
  });
  it("keeps a spot the adapter left unmapped, and explains it", () => {
    const m = validateTideManifest({
      ...manifest(),
      spots: {
        ...manifest().spots,
        ballyholme: {
          station: null,
          distanceKm: 103.9,
          reason: "Nearest station is 104 km away, beyond the 40 km limit.",
        },
        rusheen: { station: null, distanceKm: 61 },
      },
    });
    expect(tideSpotNote(m, "brandon")).toBeNull();
    expect(tideSpotNote(m, "ballyholme")).toBe(
      "Nearest station is 104 km away, beyond the 40 km limit.",
    );
    expect(tideSpotNote(m, "rusheen")).toMatch(/close enough/);
    expect(tideSpotNote(m, "mizen")).toMatch(/not in the tide predictions/);
  });
  it("still refuses a spot pointing at a station that is not published", () => {
    expect(() =>
      validateTideManifest({
        ...manifest(),
        spots: { brandon: { station: "cobh", distanceKm: 1 } },
      }),
    ).toThrow(/Invalid tide manifest/);
  });
  it("returns no curve for an unmapped spot without fetching", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const m = validateTideManifest({
      ...manifest(),
      spots: { ballyholme: { station: null, distanceKm: 103.9 } },
    });
    expect(await tideForSpot(m, "ballyholme")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("reading a curve", () => {
  it("interpolates between samples and refuses to extrapolate", () => {
    const c = curve();
    expect(tideAt(c, "2026-09-14T00:00:00Z")).toBe(0.5);
    expect(tideAt(c, "2026-09-14T00:15:00Z")).toBeCloseTo(0.65, 10);
    expect(tideAt(c, "2026-09-14T03:30:00Z")).toBe(3.6);
    expect(tideAt(c, "2026-09-14T06:00:00Z")).toBe(1.2);
    expect(tideAt(c, "2026-09-13T23:59:00Z")).toBeNull();
    expect(tideAt(c, "2026-09-14T06:01:00Z")).toBeNull();
    expect(tideAt(c, "not a time")).toBeNull();
    expect(tideAt(c, new Date("2026-09-14T01:00:00Z"))).toBe(1.2);
  });
  it("lists high and low waters inside a window, in order", () => {
    const c = curve();
    expect(
      eventsBetween(c, "2026-09-14T00:00:00Z", "2026-09-14T06:00:00Z").map(
        (event) => event.kind,
      ),
    ).toEqual(["low", "high"]);
    expect(
      eventsBetween(c, "2026-09-14T04:00:00Z", "2026-09-14T08:00:00Z"),
    ).toEqual([]);
    expect(
      eventsBetween(c, "2026-09-14T00:00:00Z", "2026-09-14T12:00:00Z"),
    ).toHaveLength(3);
  });
});
