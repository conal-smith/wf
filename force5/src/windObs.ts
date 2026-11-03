/**
 * The wind as it was measured: Met Éireann's weather stations and the Marine
 * Institute's weather buoys, from the hourly `wind-obs` job
 * (force5/ingest/fetch_wind_obs.py, `marine/wind-observations.json`).
 *
 * These are observations, not a forecast. Each reading is the hour as its
 * network published it: the speed the hour's mean, the gust its highest
 * 3-second sample, the direction the wind blew from. The file holds them in
 * metres per second, the pipeline's unit; here they are held in knots, as the
 * rest of the page holds a speed it shows. Nothing is filled, smoothed or
 * moved to an hour it was not measured at.
 *
 * A reading is current for READING_FRESH_HOURS: older than that it is shown
 * faded, as the wind it was rather than the wind it is, and past
 * READING_SHOWN_HOURS it is not shown at all.
 *
 * Both feeds are CC BY 4.0; a display of them credits both (`OBS_CREDIT`), and
 * shows Met Éireann's warnings beside them, as the site already does.
 */
import { KNOTS } from "./units";

/** Where the `wind-obs` job publishes, under the forecast base. */
export const WIND_OBS_URL = "marine/wind-observations.json";
/** How old a reading may be and still stand for the wind now. */
export const READING_FRESH_HOURS = 3;
/** How old a reading may be and still be shown at all, faded. */
export const READING_SHOWN_HOURS = 12;

const HOUR = 3600000;

export type ObsNetwork = "met-eireann" | "marine-institute";
/** Where a station stands: the open sea, an exposed shore, or inland. */
export type ObsKind = "buoy" | "coastal" | "inland";

/** Each network as a rider reads its name. */
export const NETWORK_NAME: Record<ObsNetwork, string> = {
  "met-eireann": "Met Éireann",
  "marine-institute": "Marine Institute",
};

/** The credit a display of the readings carries, both networks' own terms. */
export const OBS_CREDIT: Record<ObsNetwork, string> = {
  "met-eireann": "Contains Met Éireann data, CC BY 4.0",
  "marine-institute": "Weather buoy data © Marine Institute, CC BY 4.0",
};

export interface WindReading {
  /** The instant it was measured, in milliseconds. */
  time: number;
  /** The hour's mean wind, in knots. */
  windKn: number;
  /** The hour's highest 3-second gust, in knots, or null where not given. */
  gustKn: number | null;
  /** Where the wind blew from, degrees true, or null (calm, or no vane). */
  from: number | null;
}

export interface WindStation {
  id: string;
  name: string;
  network: ObsNetwork;
  kind: ObsKind;
  lat: number;
  lon: number;
  /** Oldest first, one an hour at most. */
  readings: WindReading[];
}

export interface WindObs {
  /** The newest observation hour in the file. */
  runTime: number;
  /** When the job wrote it: a file read again is the same while this is. */
  generatedAt: string;
  stations: WindStation[];
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** A speed in metres per second as knots, to a tenth: the file's own resolution. */
export const mpsToKn = (mps: number) => Math.round(mps * KNOTS * 10) / 10;

function reading(row: unknown): WindReading | null {
  if (!Array.isArray(row)) return null;
  const [at, speed, gust, from] = row;
  const time = typeof at === "string" ? Date.parse(at) : NaN;
  if (!Number.isFinite(time) || !finite(speed) || speed < 0) return null;
  return {
    time,
    windKn: mpsToKn(speed),
    // A gust under the mean cannot be right (the job drops those too, with
    // the same allowance for its sources' rounding).
    gustKn:
      finite(gust) && gust + 0.15 >= speed
        ? mpsToKn(Math.max(gust, speed))
        : null,
    from: finite(from) && from >= 0 && from <= 360 ? from % 360 : null,
  };
}

/**
 * The published file as stations with their readings in knots, or null for a
 * file that is not a wind observation file. A station with no usable reading
 * is left out; one with a bad row keeps the rest.
 */
export function readWindObs(json: unknown): WindObs | null {
  if (!json || typeof json !== "object") return null;
  const file = json as Record<string, unknown>;
  if (file.kind !== "observation" || file.observes !== "wind") return null;
  const units = file.units as Record<string, string> | undefined;
  if (units && (units.speed !== "m/s" || units.gust !== "m/s")) return null;
  const runTime = Date.parse(String(file.runTime ?? ""));
  const stations: WindStation[] = [];
  const all = file.stations;
  if (!all || typeof all !== "object") return null;
  for (const [id, value] of Object.entries(all as Record<string, unknown>)) {
    const s = value as Record<string, unknown>;
    if (!s || !finite(s.lat) || !finite(s.lon)) continue;
    const network = s.source;
    if (network !== "met-eireann" && network !== "marine-institute") continue;
    const kind: ObsKind =
      s.class === "buoy" || s.class === "coastal" ? s.class : "inland";
    const rows = Array.isArray(s.readings) ? s.readings : [];
    const readings = rows
      .map(reading)
      .filter((r): r is WindReading => r !== null)
      .sort((a, b) => a.time - b.time)
      .filter((r, i, all) => i === 0 || r.time !== all[i - 1].time);
    if (!readings.length) continue;
    stations.push({
      id,
      name:
        typeof s.name === "string" && s.name.trim()
          ? s.name.trim()
          : String(id),
      network,
      kind,
      lat: s.lat,
      lon: s.lon,
      readings,
    });
  }
  if (!stations.length) return null;
  return {
    runTime: Number.isFinite(runTime)
      ? runTime
      : Math.max(...stations.map((s) => s.readings.at(-1)!.time)),
    generatedAt: String(file.generatedAt ?? file.runTime ?? ""),
    stations,
  };
}

/** How many hours ago a reading was measured, at `now`. */
export const readingAgeHours = (r: WindReading, now: number) =>
  (now - r.time) / HOUR;

/** Whether a reading is too old to stand for the wind now. */
export const isStale = (r: WindReading, now: number) =>
  readingAgeHours(r, now) > READING_FRESH_HOURS;

/**
 * A station's newest reading measured by `now`, or null where it has none
 * young enough to show (READING_SHOWN_HOURS). Never one from after `now`: a
 * page whose clock is behind the file's shows what had been measured by then.
 */
export function latestReading(
  station: WindStation,
  now: number,
): WindReading | null {
  for (let i = station.readings.length - 1; i >= 0; i--) {
    const r = station.readings[i];
    if (r.time > now) continue;
    return readingAgeHours(r, now) <= READING_SHOWN_HOURS ? r : null;
  }
  return null;
}

/**
 * The reading measured at an hour, within half an hour of it, or null. For an
 * hour of a timeline: the readings are hourly, on the hour.
 */
export function readingAt(
  station: WindStation,
  time: number,
  within = HOUR / 2,
): WindReading | null {
  let best: WindReading | null = null;
  for (const r of station.readings) {
    const off = Math.abs(r.time - time);
    if (off <= within && (!best || off < Math.abs(best.time - time))) best = r;
  }
  return best;
}

const HOUR_MINUTE = new Intl.DateTimeFormat("en-IE", {
  timeZone: "Europe/Dublin",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
/** "19:00", Irish time: when a reading was measured. */
export const measuredAt = (time: number) => HOUR_MINUTE.format(new Date(time));

/** "a weather buoy" or "a weather station": what a station is, in a word or two. */
export const stationKind = (station: WindStation) =>
  station.kind === "buoy" ? "Weather buoy" : "Weather station";

/* ---- a spot's own station ---- */

/** How far a station may be from a spot and still stand beside it, in km. */
export const PAIR_MAX_KM = 25;
/**
 * An inland station counts this many times its distance: a mast in a field
 * or an airport reads the land's wind, not the water's, so one on the coast
 * or a buoy is preferred unless the inland one is much nearer.
 */
export const INLAND_WEIGHT = 2;

/** The great-circle distance between two places, in km. */
export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Paired {
  station: WindStation;
  /** How far it is from the spot, in km. */
  km: number;
}

/**
 * The station whose readings stand beside a spot's forecast: the nearest
 * buoy or coastal station within PAIR_MAX_KM, an inland one only where it is
 * nearer by half (INLAND_WEIGHT), or null where none is near enough. Never a
 * station that has no readings. A station is not the beach: wherever its
 * readings are shown, its name and distance go with them.
 */
export function pairStation(
  spot: { lat: number; lon: number },
  stations: readonly WindStation[],
  maxKm = PAIR_MAX_KM,
): Paired | null {
  let best: Paired | null = null;
  let bestScore = Infinity;
  for (const station of stations) {
    if (!station.readings.length) continue;
    const km = distanceKm(spot, station);
    const score = station.kind === "inland" ? km * INLAND_WEIGHT : km;
    if (score <= maxKm && score < bestScore) {
      best = { station, km };
      bestScore = score;
    }
  }
  return best;
}

/** "Malin Head 6 km", a station's name with how far it is, as a rider reads it. */
export const pairedName = ({ station, km }: Paired) =>
  `${station.name} ${km < 1 ? "<1" : Math.round(km)} km`;
