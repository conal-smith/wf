// In-situ sea temperature. This manifest is the only one in the pipeline that
// holds *measurements* rather than a forecast, so nothing in it has a forecast
// hour and nothing may be extrapolated forwards: the newest reading is as recent
// as the water gets. Every reading carries the station it came from and how far
// that station is, because a buoy 50 km offshore is not the water at a beach.
import { forecastUrl } from "./urls";

export const SEA_TEMPERATURE_URL = "marine/sea-temperature.json";
/** Below freezing point at salinity, above anything Irish waters reach. */
export const SEA_TEMPERATURE_RANGE = { min: -2, max: 35 } as const;

/** Nearest-shore first. The adapter prefers them in this order. */
export type SeaTemperatureNetwork = "coastal" | "sentinel" | "buoy";

export interface SeaTemperatureReading {
  /** The instant the station measured it, never a resampled slot label. */
  time: string;
  /** Degrees Celsius. */
  value: number;
}

export interface SeaTemperatureStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  network: SeaTemperatureNetwork;
  /**
   * Metres below the surface, or null when the network publishes no sensor
   * depth. Null means unknown, not zero: the offshore weather buoys do not say.
   */
  depth?: number | null;
  /** The published station name before its deployment-record suffix was trimmed. */
  sourceName?: string;
  dataset?: string;
  sourceUrl?: string;
  observations?: number;
  latest?: SeaTemperatureReading;
}

export interface SeaTemperatureSpot {
  /**
   * Null when no station is in range or none has reported recently enough.
   * Those spots are published deliberately, with a `reason`, rather than being
   * dropped or given a station that says nothing about them.
   */
  station: string | null;
  distanceKm: number;
  latest?: SeaTemperatureReading;
  /** Recent readings, oldest first, thinned to the manifest's `stepMinutes`. */
  series?: SeaTemperatureReading[];
  reason?: string;
}

export interface SeaTemperatureManifest {
  schemaVersion: number;
  kind: "observation";
  model?: string;
  generatedAt?: string;
  /** The newest observation hour, YYYYMMDDHH: this bundle's freshness. */
  run?: string;
  variable?: { name?: string; units?: string; label?: string };
  /** Nominal spacing of `series`; actual readings may be sparser. */
  stepMinutes?: number;
  observationWindow?: { from: string; to: string };
  maxDistanceKm?: number;
  maxObservationAgeHours?: number;
  stations: Record<string, SeaTemperatureStation>;
  spots: Record<string, SeaTemperatureSpot>;
  attribution?: string;
  licenseUrl?: string;
  sourceUrl?: string;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const inRange = (value: unknown): value is number =>
  finite(value) &&
  value >= SEA_TEMPERATURE_RANGE.min &&
  value <= SEA_TEMPERATURE_RANGE.max;

const parsed = (time: unknown) =>
  typeof time === "string" ? Date.parse(time) : NaN;

const reading = (value: unknown): value is SeaTemperatureReading => {
  const r = value as SeaTemperatureReading | null;
  return !!r && Number.isFinite(parsed(r.time)) && inRange(r.value);
};

/** Stations as a list, in the order the manifest published them. */
export function seaTemperatureStations(
  manifest: SeaTemperatureManifest,
): SeaTemperatureStation[] {
  return Object.entries(manifest.stations ?? {}).map(([id, station]) => ({
    ...station,
    id: station.id ?? id,
  }));
}

export const seaTemperatureStation = (
  manifest: SeaTemperatureManifest,
  id: string,
) => seaTemperatureStations(manifest).find((station) => station.id === id);

const NETWORKS: readonly SeaTemperatureNetwork[] = [
  "coastal",
  "sentinel",
  "buoy",
];

export function validateSeaTemperatureManifest(
  m: SeaTemperatureManifest,
): SeaTemperatureManifest {
  const stations = m && typeof m === "object" ? seaTemperatureStations(m) : [];
  if (
    !m ||
    m.schemaVersion !== 1 ||
    m.kind !== "observation" ||
    !stations.length ||
    !stations.every(
      (station) =>
        typeof station.id === "string" &&
        station.id &&
        typeof station.name === "string" &&
        station.name &&
        finite(station.lat) &&
        finite(station.lon) &&
        Math.abs(station.lat) <= 90 &&
        Math.abs(station.lon) <= 180 &&
        NETWORKS.includes(station.network) &&
        (station.depth === undefined ||
          station.depth === null ||
          (finite(station.depth) && station.depth >= 0)) &&
        (station.latest === undefined || reading(station.latest)),
    ) ||
    !m.spots ||
    typeof m.spots !== "object" ||
    !Object.values(m.spots).every((spot) => {
      if (!spot || !finite(spot.distanceKm) || spot.distanceKm < 0)
        return false;
      // A spot with no station must say why; the UI shows the manifest's words.
      if (spot.station === null)
        return typeof spot.reason === "string" && !!spot.reason.trim();
      if (
        typeof spot.station !== "string" ||
        !stations.some((station) => station.id === spot.station) ||
        !reading(spot.latest)
      )
        return false;
      if (spot.series === undefined) return true;
      if (!Array.isArray(spot.series) || !spot.series.every(reading))
        return false;
      // Oldest first and strictly increasing, so a sparkline needs no sorting.
      return spot.series.every(
        (entry, index) =>
          index === 0 ||
          Date.parse(entry.time) > Date.parse(spot.series![index - 1].time),
      );
    })
  )
    throw new Error("Invalid sea temperature data. Refresh the observations.");
  return m;
}

export async function loadSeaTemperature(
  signal?: AbortSignal,
): Promise<SeaTemperatureManifest> {
  const response = await fetch(forecastUrl(SEA_TEMPERATURE_URL), {
    cache: "no-cache",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw Object.assign(
      new Error("Sea temperature observations are unavailable."),
      { status: response.status },
    );
  return validateSeaTemperatureManifest(
    (await response.json()) as SeaTemperatureManifest,
  );
}

export interface SpotSeaTemperature {
  station: SeaTemperatureStation;
  distanceKm: number;
  latest: SeaTemperatureReading;
  series: SeaTemperatureReading[];
  /** Hours since the latest reading, against `now`. */
  ageHours: number;
}

/**
 * What a spot's nearest station measured, or null when it has none. The whole
 * bundle arrives in one file, so this needs no second request and cannot fail.
 */
export function seaTemperatureForSpot(
  manifest: SeaTemperatureManifest,
  spotId: string,
  now: Date | number = Date.now(),
): SpotSeaTemperature | null {
  const spot = manifest.spots?.[spotId];
  if (!spot || spot.station === null || !spot.latest) return null;
  const station = seaTemperatureStation(manifest, spot.station);
  if (!station) return null;
  const at = now instanceof Date ? now.getTime() : now;
  return {
    station,
    distanceKm: spot.distanceKm,
    latest: spot.latest,
    series: spot.series ?? [],
    ageHours: (at - Date.parse(spot.latest.time)) / 3600000,
  };
}

/** What each network is, in the words the row and its tooltip use. */
export const NETWORK_LABEL: Record<SeaTemperatureNetwork, string> = {
  coastal: "coastal logger",
  sentinel: "sentinel buoy",
  buoy: "weather buoy",
};
/** The one word that follows a station's name in the row's own reading. */
export const NETWORK_WORD: Record<SeaTemperatureNetwork, string> = {
  coastal: "logger",
  sentinel: "buoy",
  buoy: "buoy",
};

/**
 * How long ago a reading was taken, in words. The age is half of what an
 * observation says: forty minutes is the water now, thirty hours is yesterday's
 * water, and the row has to be honest about which it is showing.
 */
export function observationAge(ageHours: number): string {
  if (!Number.isFinite(ageHours)) return "age unknown";
  const minutes = Math.round(ageHours * 60);
  // A reading timestamped slightly ahead of the clock is skew, not the future.
  if (minutes < 5) return "just now";
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(ageHours);
  if (hours < 36) return `${hours} h ago`;
  const days = Math.round(ageHours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export interface SeaTemperatureText {
  /** The measurement itself, with its unit. */
  value: string;
  /** Where it was measured, how far away that is, and how old it is. */
  detail: string;
}

/**
 * The reading the Sea row prints, in two parts so the row can weight the
 * measurement above its provenance. One line either way, because an observation
 * is one value and not a column per forecast hour.
 */
export function seaTemperatureText(
  observed: SpotSeaTemperature,
  ageHours: number = observed.ageHours,
): SeaTemperatureText {
  const distance =
    observed.distanceKm < 10
      ? observed.distanceKm.toFixed(1)
      : String(Math.round(observed.distanceKm));
  return {
    value: `${observed.latest.value.toFixed(1)} °C`,
    detail: `${observed.station.name} ${
      NETWORK_WORD[observed.station.network]
    }, ${distance} km, ${observationAge(ageHours)}`,
  };
}

/** The same reading as one line, for a label or an accessible name. */
export function seaTemperatureLabel(
  observed: SpotSeaTemperature,
  ageHours: number = observed.ageHours,
): string {
  const text = seaTemperatureText(observed, ageHours);
  return `${text.value} · ${text.detail}`;
}

/**
 * Polyline points for a sparkline of a reading series, scaled to its own range
 * and spaced by real time so a gap in the readings reads as a gap. Empty for a
 * series too short to draw a line through, which the caller shows nothing for.
 */
export function sparklinePoints(
  series: readonly SeaTemperatureReading[],
  width: number,
  height: number,
): string {
  if (!Array.isArray(series) || series.length < 2 || width <= 0 || height <= 0)
    return "";
  const times = series.map((entry) => Date.parse(entry.time));
  const span = times[times.length - 1] - times[0];
  const values = series.map((entry) => entry.value);
  const low = Math.min(...values);
  const range = Math.max(...values) - low;
  // Half a pixel of room top and bottom, so a 1px stroke is not clipped.
  const top = 0.5;
  const bottom = height - 0.5;
  return series
    .map((entry, index) => {
      const x =
        span > 0
          ? ((times[index] - times[0]) / span) * width
          : (index / (series.length - 1)) * width;
      // A flat series is a flat line down the middle, not a divide by zero.
      const y =
        range > 0
          ? bottom - ((entry.value - low) / range) * (bottom - top)
          : (top + bottom) / 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * Why a spot has no sea temperature, or null when it has one. The manifest
 * states the reason for a spot it deliberately left unmapped; the UI shows that
 * rather than implying the observations failed.
 */
export function seaTemperatureNote(
  manifest: SeaTemperatureManifest,
  spotId: string,
): string | null {
  const spot = manifest.spots?.[spotId];
  if (!spot) return "This spot is not in the sea temperature observations.";
  if (spot.station === null)
    return spot.reason ?? "No sea temperature station is close enough.";
  return seaTemperatureStation(manifest, spot.station)
    ? null
    : "This spot's station is missing from the observations.";
}
