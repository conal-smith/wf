import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TIDES_URL,
  eventsBetween,
  freshwaterSpots,
  loadTides,
  tideAt,
  tideCredit,
  tideForSpot,
  tideForStation,
  tideSpotNote,
  tideStation,
  tideStationLine,
  tideStationNear,
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
  it("loads a station's curve by id, for a place that is not a spot", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return ok(curve());
      }),
    );
    const fenit = await tideForStation(manifest(), "fenit");
    expect(fenit?.station.name).toBe("Fenit");
    expect(urls[0]).toContain("marine/tides/fenit.json");
    // Mid-flood between the 01:30 (1.8 m) and 02:00 (2.4 m) samples.
    expect(tideAt(fenit!.curve, "2026-09-14T01:45:00Z")).toBeCloseTo(2.1);
    expect(await tideForStation(manifest(), "cobh")).toBeNull();
    expect(urls).toHaveLength(1);
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
  it("says a freshwater lake has no tide, not that a station is far", () => {
    const m = validateTideManifest({
      ...manifest(),
      spots: {
        ...manifest().spots,
        "oxford-island": {
          station: null,
          distanceKm: 32.1,
          noTide: true,
          reason: "No tide: a freshwater lake.",
        },
      },
    });
    expect(tideSpotNote(m, "oxford-island")).toBe(
      "No tide: a freshwater lake.",
    );
  });
  it("lists the spots on water the sea does not reach", () => {
    const m: TideManifest = {
      ...manifest(),
      spots: {
        brandon: { station: "fenit", distanceKm: 12.4 },
        "lough-derg-killaloe": {
          station: null,
          distanceKm: 64.8,
          noTide: true,
          reason: "No tide: a freshwater lake.",
        },
      },
    };
    expect([...freshwaterSpots(m)]).toEqual(["lough-derg-killaloe"]);
  });
  it("credits each station's own source, the manifest's otherwise", () => {
    const m = validateTideManifest({
      ...manifest(),
      stations: [
        ...(manifest().stations as ReturnType<typeof tideStations>),
        {
          id: "Bangor",
          name: "Bangor",
          lat: 54.665,
          lon: -5.67,
          provider: "wingfoil.ie",
          attribution:
            "Tidal predictions by wingfoil.ie from Environment Agency tide gauge data (Open Government Licence v3.0)",
        },
      ],
      spots: {
        ...manifest().spots,
        ballyholme: { station: "Bangor", distanceKm: 2.4 },
      },
    });
    expect(tideCredit(m, "Bangor")).toMatch(/wingfoil.ie .*Environment Agency/);
    expect(tideCredit(m, "Bangor")).not.toMatch(/Marine Institute/);
    expect(tideCredit(m, tideStation(m, "fenit")!)).toBe(
      "Marine Institute tide predictions, CC BY 4.0",
    );
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

describe("a point's station", () => {
  // Real stations' places, from the published manifest.
  const coast = (maxDistanceKm?: number): TideManifest => ({
    ...manifest(),
    maxDistanceKm,
    stations: {
      Dublin_Port: {
        id: "Dublin_Port",
        name: "Dublin Port",
        lat: 53.34574,
        lon: -6.22166,
        provider: "Marine Institute",
      },
      Howth: {
        id: "Howth",
        name: "Howth",
        lat: 53.39148,
        lon: -6.0683,
        provider: "Marine Institute",
      },
      Galway: {
        id: "Galway",
        name: "Galway",
        lat: 53.26895,
        lon: -9.04796,
        provider: "Marine Institute",
      },
      Killard_MODELLED: {
        id: "Killard_MODELLED",
        name: "Killard Point",
        lat: 54.315,
        lon: -5.525,
        provider: "wingfoil.ie",
        modelled: true,
      },
      Strangford_MODELLED: {
        id: "Strangford_MODELLED",
        name: "Strangford Lough",
        lat: 54.48,
        lon: -5.62,
        provider: "wingfoil.ie",
        modelled: true,
        lagOf: "Killard_MODELLED",
        lagMinutes: 100,
      },
    },
    spots: {},
  });

  it("is the nearest station, with its distance", () => {
    // Off Dollymount, in Dublin Bay: Dublin Port is nearer than Howth.
    const bay = tideStationNear(coast(), 53.355, -6.16);
    expect(bay.station?.id).toBe("Dublin_Port");
    expect(bay.distanceKm).toBe(4.2);
    expect(bay.reason).toBeUndefined();
    // Off the Baily, Howth.
    expect(tideStationNear(coast(), 53.37, -6.05).station?.id).toBe("Howth");
  });
  it("takes a basin's or a modelled station as it is published", () => {
    // Inside Strangford Lough, its own station: Killard's tide, 100 min late.
    const lough = tideStationNear(coast(), 54.45, -5.6);
    expect(lough.station?.id).toBe("Strangford_MODELLED");
    expect(lough.station?.lagOf).toBe("Killard_MODELLED");
    expect(lough.station?.lagMinutes).toBe(100);
  });
  it("says how far the nearest is beyond the publisher's limit", () => {
    // The middle of Ireland: Galway is 76 km off.
    const inland = tideStationNear(coast(), 53.52, -7.98);
    expect(inland.station).toBeNull();
    expect(inland.distanceKm).toBeCloseTo(76.1, 1);
    expect(inland.reason).toBe(
      "No tide station within 40 km: the nearest, Galway, is 76 km away.",
    );
    // The limit is the manifest's own where it states one.
    expect(tideStationNear(coast(80), 53.52, -7.98).station?.id).toBe("Galway");
    expect(tideStationNear(coast(20), 53.43, -9.25).reason).toBe(
      "No tide station within 20 km: the nearest, Galway, is 22 km away.",
    );
  });
  it("gives a freshwater lake no tide, however near a station is", () => {
    // Lough Corrib, 6 km above Galway's docks.
    const corrib = tideStationNear(coast(), 53.31, -9.1, true);
    expect(corrib).toEqual({
      station: null,
      distanceKm: 5.7,
      reason: "No tide: a freshwater lake.",
    });
  });
  it("breaks an exact tie by id, whichever order the manifest lists them", () => {
    const twins = (order: string[]): TideManifest => ({
      ...manifest(),
      stations: order.map((id) => ({
        id,
        name: id,
        lat: 53,
        lon: id === "b-east" ? -5.9 : -6.1,
      })),
      spots: {},
    });
    expect(
      tideStationNear(twins(["b-east", "a-west"]), 53, -6).station?.id,
    ).toBe("a-west");
    expect(
      tideStationNear(twins(["a-west", "b-east"]), 53, -6).station?.id,
    ).toBe("a-west");
  });
  it("keeps a Marine Institute station that is at most 5 km farther, as the publisher does", () => {
    const pair = (miLon: number): TideManifest => ({
      ...manifest(),
      stations: [
        { id: "ni", name: "NI", lat: 54, lon: -6, provider: "wingfoil.ie" },
        {
          id: "mi",
          name: "MI",
          lat: 54,
          lon: miLon,
          provider: "Marine Institute",
        },
      ],
      spots: {},
    });
    // From 54° N, 6.1° W: the NI station 6.5 km east, the MI one 8 or 16 km west.
    expect(tideStationNear(pair(-6.22), 54, -6.1).station?.id).toBe("mi");
    expect(tideStationNear(pair(-6.34), 54, -6.1).station?.id).toBe("ni");
  });
  it("names the station and how far it is", () => {
    const station = { id: "Howth", name: "Howth", lat: 0, lon: 0 };
    expect(tideStationLine({ station, distanceKm: 4.84 })).toBe(
      "Howth, 4.8 km away",
    );
    expect(tideStationLine({ station, distanceKm: 23.6 })).toBe(
      "Howth, 24 km away",
    );
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
