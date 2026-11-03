import { describe, expect, it } from "vitest";
import {
  INLAND_WEIGHT,
  PAIR_MAX_KM,
  READING_FRESH_HOURS,
  distanceKm,
  pairStation,
  pairedName,
  isStale,
  latestReading,
  measuredAt,
  mpsToKn,
  readWindObs,
  readingAt,
  type WindStation,
} from "./windObs";

const HOUR = 3600000;
const END = Date.parse("2026-11-03T19:00:00Z");
const at = (hoursBack: number) =>
  new Date(END - hoursBack * HOUR).toISOString().replace(".000Z", "Z");

/** A file in the `wind-obs` job's shape (force5/ingest/fetch_wind_obs.py). */
const file = (stations: Record<string, unknown>) => ({
  schemaVersion: 1,
  kind: "observation",
  observes: "wind",
  model: "wind-obs",
  run: "2026110319",
  runTime: "2026-11-03T19:00:00Z",
  generatedAt: "2026-11-03T19:50:25Z",
  units: { speed: "m/s", gust: "m/s", direction: "degrees true, blowing from" },
  readingFields: ["time", "speed", "gust", "direction"],
  stations,
});

const MALIN = {
  name: "Malin Head",
  lat: 55.37194,
  lon: -7.33917,
  source: "met-eireann",
  class: "coastal",
  readings: [
    [at(2), 6.2, 8.9, 265],
    [at(1), 7.0, 9.8, 270],
    [at(0), 7.2, 10.0, 360],
  ],
};

describe("readWindObs", () => {
  it("reads the stations, their readings in knots, oldest first", () => {
    const obs = readWindObs(
      file({
        ME_03980: { ...MALIN, readings: [...MALIN.readings].reverse() },
        MI_M2: {
          name: "M2 Irish Sea buoy",
          lat: 53.48,
          lon: -5.43,
          source: "marine-institute",
          class: "buoy",
          readings: [[at(0), 5.1, null, 180]],
        },
      }),
    )!;
    expect(obs.runTime).toBe(END);
    expect(obs.generatedAt).toBe("2026-11-03T19:50:25Z");
    const malin = obs.stations.find((s) => s.id === "ME_03980")!;
    expect([malin.name, malin.network, malin.kind]).toEqual([
      "Malin Head",
      "met-eireann",
      "coastal",
    ]);
    expect(malin.readings.map((r) => r.time)).toEqual([
      END - 2 * HOUR,
      END - HOUR,
      END,
    ]);
    // 7.2 m/s is 14.0 kn, 10.0 m/s 19.4 kn; north is 0, not 360.
    expect(malin.readings.at(-1)).toEqual({
      time: END,
      windKn: 14,
      gustKn: 19.4,
      from: 0,
    });
    const buoy = obs.stations.find((s) => s.id === "MI_M2")!;
    expect([buoy.network, buoy.kind, buoy.readings[0].gustKn]).toEqual([
      "marine-institute",
      "buoy",
      null,
    ]);
  });

  it("converts metres per second to knots to a tenth", () => {
    expect(mpsToKn(1)).toBe(1.9);
    expect(mpsToKn(10)).toBe(19.4);
    expect(mpsToKn(0)).toBe(0);
  });

  it("drops a bad row and keeps the rest; drops a station with nothing left", () => {
    const obs = readWindObs(
      file({
        ME_03980: {
          ...MALIN,
          readings: [
            ["not a time", 5, 6, 90],
            [at(1), null, 6, 90],
            [at(1), -1, 6, 90],
            // A gust under the mean cannot be right: the gust goes.
            [at(0), 7.2, 5.0, 400],
          ],
        },
        ME_EMPTY: { ...MALIN, readings: [[at(0), null, null, null]] },
        ME_NOWHERE: { ...MALIN, lat: null },
        XX_OTHER: { ...MALIN, source: "somebody-else" },
      }),
    )!;
    expect(obs.stations.map((s) => s.id)).toEqual(["ME_03980"]);
    expect(obs.stations[0].readings).toEqual([
      { time: END, windKn: 14, gustKn: null, from: null },
    ]);
  });

  it("is null for anything that is not a wind observation file", () => {
    expect(readWindObs(null)).toBeNull();
    expect(
      readWindObs({ ...file({ ME_03980: MALIN }), observes: "sea" }),
    ).toBeNull();
    expect(
      readWindObs({ ...file({ ME_03980: MALIN }), kind: "forecast" }),
    ).toBeNull();
    expect(
      readWindObs({
        ...file({ ME_03980: MALIN }),
        units: { speed: "kn", gust: "kn" },
      }),
    ).toBeNull();
    expect(readWindObs(file({}))).toBeNull();
  });
});

describe("how old a reading is", () => {
  const station = readWindObs(file({ ME_03980: MALIN }))!.stations[0];

  it("is fresh for three hours, then stale", () => {
    const latest = station.readings.at(-1)!;
    expect(READING_FRESH_HOURS).toBe(3);
    expect(isStale(latest, END + 3 * HOUR)).toBe(false);
    expect(isStale(latest, END + 3 * HOUR + 60000)).toBe(true);
  });

  it("gives the latest reading measured by now, faded past three hours, none past twelve", () => {
    expect(latestReading(station, END + 20 * 60000)?.time).toBe(END);
    // A page whose clock is behind the file's sees what had been measured by then.
    expect(latestReading(station, END - 30 * 60000)?.time).toBe(END - HOUR);
    expect(latestReading(station, END + 5 * HOUR)?.time).toBe(END);
    expect(latestReading(station, END + 12 * HOUR)?.time).toBe(END);
    expect(latestReading(station, END + 12 * HOUR + 60000)).toBeNull();
    expect(latestReading(station, END - 5 * HOUR)).toBeNull();
  });

  it("finds the reading at an hour, within half an hour", () => {
    const s: WindStation = station;
    expect(readingAt(s, END - HOUR + 20 * 60000)?.time).toBe(END - HOUR);
    expect(readingAt(s, END + 40 * 60000)).toBeNull();
  });

  it("says when it was measured in Irish time", () => {
    // 19:00 UTC on 3 November is 19:00 in Ireland (winter time); in summer
    // the clock is an hour ahead.
    expect(measuredAt(END)).toBe("19:00");
    expect(measuredAt(Date.parse("2026-07-01T19:00:00Z"))).toBe("20:00");
  });
});

describe("pairStation", () => {
  const station = (
    id: string,
    lat: number,
    lon: number,
    kind: WindStation["kind"],
    readings = 1,
  ): WindStation => ({
    id,
    name: id,
    network: kind === "buoy" ? "marine-institute" : "met-eireann",
    kind,
    lat,
    lon,
    readings: Array.from({ length: readings }, (_, i) => ({
      time: END - i * HOUR,
      windKn: 10,
      gustKn: 14,
      from: 270,
    })),
  });
  // Belmullet's beach, and the stations round it (force5/ingest/wind_stations.json).
  const BEACH = { lat: 54.2234, lon: -9.9919 };
  const BELMULLET = station("Belmullet", 54.2275, -10.00694, "coastal");
  const NEWPORT = station("Newport Furnace", 53.92361, -9.57278, "inland");
  const M4 = station("M4", 54.6667, -9.0667, "buoy");

  it("measures distances on the sphere", () => {
    expect(distanceKm(BEACH, BELMULLET)).toBeCloseTo(1.1, 1);
    // A degree of latitude is about 111 km.
    expect(distanceKm({ lat: 53, lon: -8 }, { lat: 54, lon: -8 })).toBeCloseTo(
      111.2,
      0,
    );
  });

  it("is the nearest station within 25 km, with its distance", () => {
    const paired = pairStation(BEACH, [M4, NEWPORT, BELMULLET])!;
    expect(paired.station.id).toBe("Belmullet");
    expect(paired.km).toBeCloseTo(1.1, 1);
    expect(pairedName(paired)).toBe("Belmullet 1 km");
    expect(pairedName({ station: BELMULLET, km: 0.4 })).toBe("Belmullet <1 km");
  });

  it("is none where no station is near enough", () => {
    expect(PAIR_MAX_KM).toBe(25);
    expect(
      pairStation({ lat: 52.276, lon: -10.024 }, [BELMULLET, M4]),
    ).toBeNull();
    expect(pairStation(BEACH, [])).toBeNull();
  });

  it("prefers a coastal station or a buoy to a nearer inland one, unless that is much nearer", () => {
    const shore = station("Shore", 53.0, -9.0, "coastal");
    // 10 km off on the coast, 8 km inland: the coast's.
    const at = { lat: 53.0 + 10 / 111.2, lon: -9.0 };
    const inland = station("Inland", at.lat - 8 / 111.2, -9.0, "inland");
    expect(pairStation(at, [inland, shore])!.station.id).toBe("Shore");
    // 3 km inland is nearer by more than half: the inland one.
    const near = station("Near", at.lat - 3 / 111.2, -9.0, "inland");
    expect(pairStation(at, [near, shore])!.station.id).toBe("Near");
    // An inland station counts double: 13 km of it is past the limit.
    const far = station("Far", at.lat - 13 / 111.2, -9.0, "inland");
    expect(pairStation(at, [far])).toBeNull();
    expect(INLAND_WEIGHT).toBe(2);
  });

  it("never pairs a station with no readings", () => {
    const silent = station("Silent", BEACH.lat, BEACH.lon, "coastal", 0);
    expect(pairStation(BEACH, [silent, BELMULLET])!.station.id).toBe(
      "Belmullet",
    );
  });
});
