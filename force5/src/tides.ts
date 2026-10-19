// Tide predictions. A tide manifest is not a wind manifest: it maps spots to
// gauge stations and points at one curve file per station. Heights are metres
// above the station's own datum, which must be shown with every reading.
import { distanceKm } from "./foilDepth";
import { forecastUrl } from "./urls";

export const TIDES_URL = "marine/tides.json";
/** Fallback layout when a station entry carries no explicit url. */
const stationPath = (id: string) => `marine/tides/${id}.json`;

export interface TideStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Vertical reference, e.g. "LAT" or "OD Malin"; never assume one. */
  datum?: string;
  /**
   * Height above LAT minus height above OD Malin, metres (fetch_tides.py). The
   * Marine Institute's stations only: Northern Ireland's have none.
   */
  odMalinOffsetMetres?: number;
  url?: string;
  sourceUrl?: string;
  /** Who predicts this station: "Marine Institute", or "wingfoil.ie" in Northern Ireland. */
  provider?: string;
  /** The credit to show with this station's tides; the manifest's covers every station. */
  attribution?: string;
  licenseUrl?: string;
  /** A model's point rather than a gauge. */
  modelled?: boolean;
  datumNote?: string;
  /** A basin's station: another station's tide, this many minutes later. */
  lagOf?: string;
  lagMinutes?: number;
}
export interface TideSpotLink {
  /**
   * Null when no station is within the adapter's distance limit. Those spots
   * are published deliberately, with a `reason`, rather than being dropped or
   * given a station that says nothing about them.
   */
  station: string | null;
  distanceKm: number;
  reason?: string;
  /** On water the sea does not reach (a freshwater lake): no tide at all. */
  noTide?: boolean;
}
export interface TideManifest {
  schemaVersion: number;
  kind: "tide";
  generatedAt?: string;
  stations: TideStation[] | Record<string, TideStation>;
  spots: Record<string, TideSpotLink>;
  /** The adapter's station limit, km: no spot is given a station farther off. */
  maxDistanceKm?: number;
  attribution?: string;
  licenseUrl?: string;
  sourceUrl?: string;
}
export interface TideEvent {
  time: string;
  kind: "high" | "low";
  height: number;
}
export interface TideCurve {
  stepMinutes: number;
  from: string;
  to: string;
  datum: string;
  /** Heights in metres above `datum`, every `stepMinutes` from `from`. */
  curve: number[];
  events: TideEvent[];
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Stations as a list whether the manifest used an array or an id map. */
export function tideStations(manifest: TideManifest): TideStation[] {
  const stations = manifest.stations;
  return Array.isArray(stations)
    ? stations
    : Object.entries(stations ?? {}).map(([id, station]) => ({
        ...station,
        id: station.id ?? id,
      }));
}
export const tideStation = (manifest: TideManifest, id: string) =>
  tideStations(manifest).find((station) => station.id === id);

export function validateTideManifest(m: TideManifest): TideManifest {
  const stations = m && typeof m === "object" ? tideStations(m) : [];
  if (
    !m ||
    m.schemaVersion !== 1 ||
    m.kind !== "tide" ||
    !stations.length ||
    !stations.every(
      (station) =>
        typeof station.id === "string" &&
        station.id &&
        typeof station.name === "string" &&
        finite(station.lat) &&
        finite(station.lon) &&
        Math.abs(station.lat) <= 90 &&
        Math.abs(station.lon) <= 180,
    ) ||
    !m.spots ||
    typeof m.spots !== "object" ||
    !Object.values(m.spots).every(
      (link) =>
        link &&
        finite(link.distanceKm) &&
        link.distanceKm >= 0 &&
        (link.station === null ||
          (typeof link.station === "string" &&
            stations.some((station) => station.id === link.station))),
    )
  )
    throw new Error("Invalid tide manifest. Refresh the tide predictions.");
  return m;
}

export function validateTideCurve(c: TideCurve): TideCurve {
  if (
    !c ||
    !Number.isInteger(c.stepMinutes) ||
    c.stepMinutes < 1 ||
    c.stepMinutes > 60 ||
    typeof c.datum !== "string" ||
    !c.datum ||
    !Number.isFinite(Date.parse(c.from)) ||
    !Number.isFinite(Date.parse(c.to)) ||
    Date.parse(c.to) <= Date.parse(c.from) ||
    !Array.isArray(c.curve) ||
    c.curve.length < 2 ||
    !c.curve.every((height) => finite(height) && Math.abs(height) <= 20) ||
    Math.abs(
      Date.parse(c.from) +
        (c.curve.length - 1) * c.stepMinutes * 60000 -
        Date.parse(c.to),
    ) > 1000 ||
    !Array.isArray(c.events) ||
    !c.events.every(
      (event) =>
        Number.isFinite(Date.parse(event.time)) &&
        (event.kind === "high" || event.kind === "low") &&
        finite(event.height) &&
        Math.abs(event.height) <= 20,
    )
  )
    throw new Error("Invalid tide curve for this station.");
  return c;
}

async function loadJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(forecastUrl(path), {
    cache: "no-cache",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw Object.assign(
      new Error("Tide predictions are unavailable for this location."),
      { status: response.status },
    );
  return response.json();
}

export async function loadTides(signal?: AbortSignal): Promise<TideManifest> {
  return validateTideManifest(
    (await loadJson(TIDES_URL, signal)) as TideManifest,
  );
}

export interface SpotTide {
  station: TideStation;
  distanceKm: number;
  curve: TideCurve;
}

/**
 * Why a spot has no tide curve, or null when it has one. The manifest states
 * the reason for a spot it deliberately left unmapped; the UI shows that rather
 * than implying the predictions failed.
 */
export function tideSpotNote(
  manifest: TideManifest,
  spotId: string,
): string | null {
  const link = manifest.spots?.[spotId];
  if (!link) return "This spot is not in the tide predictions.";
  if (link.station === null)
    return link.reason ?? "No tide station is close enough to this spot.";
  return tideStation(manifest, link.station)
    ? null
    : "This spot's tide station is missing from the predictions.";
}

/**
 * The credit for a station's tides: its own (the Marine Institute's, or in
 * Northern Ireland wingfoil.ie's from the Environment Agency's gauges and
 * EOT20), else the manifest's, which names every source.
 */
export function tideCredit(
  manifest: TideManifest,
  station: TideStation | string,
): string | null {
  const entry =
    typeof station === "string" ? tideStation(manifest, station) : station;
  return entry?.attribution ?? manifest.attribution ?? null;
}

/**
 * The station limit when a manifest does not state its own: fetch_tides.py's
 * MAX_DISTANCE_KM, which it publishes as the manifest's `maxDistanceKm`.
 */
export const TIDE_STATION_LIMIT_KM = 40;
/** fetch_tides.py's PREFER_MI_KM: how much farther a Marine Institute station may be and still win. */
const PREFER_MI_KM = 5;
const MARINE_INSTITUTE = "Marine Institute";

export interface PointTideLink {
  /** Null beyond the station limit, or on a freshwater lake. */
  station: TideStation | null;
  distanceKm: number;
  /** Why there is no station, said as a spot's link says it. */
  reason?: string;
}

/**
 * The tide station for a point that is not a spot, as fetch_tides.py's
 * assign_stations links a spot: the nearest by great-circle distance, unless a Marine Institute station is at most PREFER_MI_KM
 * farther than another provider's nearest; within the manifest's limit, and
 * never for water the sea does not reach. A basin's or a modelled station is
 * taken as it is published.
 */
export function tideStationNear(
  manifest: TideManifest,
  lat: number,
  lon: number,
  freshwater = false,
): PointTideLink {
  const limit = finite(manifest.maxDistanceKm)
    ? manifest.maxDistanceKm
    : TIDE_STATION_LIMIT_KM;
  const ranked = tideStations(manifest)
    .map((station) => ({
      station,
      km: distanceKm(lon, lat, station.lon, station.lat),
    }))
    // As Python sorts (km, id): an exact tie goes to the first id.
    .sort((a, b) => a.km - b.km || (a.station.id < b.station.id ? -1 : 1));
  let nearest = ranked[0];
  if (!nearest)
    return {
      station: null,
      distanceKm: Infinity,
      reason: "No tide station is close enough to this point.",
    };
  if (
    nearest.station.provider &&
    nearest.station.provider !== MARINE_INSTITUTE
  ) {
    const mi = ranked.find((r) => r.station.provider === MARINE_INSTITUTE);
    if (mi && mi.km <= Math.min(limit, nearest.km + PREFER_MI_KM)) nearest = mi;
  }
  const km = Math.round(nearest.km * 10) / 10;
  if (freshwater)
    return {
      station: null,
      distanceKm: km,
      reason: "No tide: a freshwater lake.",
    };
  if (nearest.km > limit)
    return {
      station: null,
      distanceKm: km,
      reason: `No tide station within ${limit.toFixed(0)} km: the nearest, ${nearest.station.name}, is ${nearest.km.toFixed(0)} km away.`,
    };
  return { station: nearest.station, distanceKm: km };
}

/** "Dublin Port, 4.8 km away": the station a tide is read at, and how far off. */
export function tideStationLine(
  tide: Pick<SpotTide, "station" | "distanceKm">,
): string {
  const km = tide.distanceKm;
  return `${tide.station.name}, ${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
}

/** Curve for the station nearest a spot, or null when no station is mapped. */
export async function tideForSpot(
  manifest: TideManifest,
  spotId: string,
  signal?: AbortSignal,
): Promise<SpotTide | null> {
  const link = manifest.spots?.[spotId];
  const station =
    link && link.station ? tideStation(manifest, link.station) : undefined;
  if (!link || !station) return null;
  const curve = await stationCurve(station, signal);
  return { station, distanceKm: link.distanceKm, curve };
}

const stationCurve = async (station: TideStation, signal?: AbortSignal) =>
  validateTideCurve(
    (await loadJson(
      station.url ?? stationPath(station.id),
      signal,
    )) as TideCurve,
  );

/** A named station's curve, for a place that is not a spot; null if unknown. */
export async function tideForStation(
  manifest: TideManifest,
  stationId: string,
  signal?: AbortSignal,
): Promise<{ station: TideStation; curve: TideCurve } | null> {
  const station = tideStation(manifest, stationId);
  if (!station) return null;
  return { station, curve: await stationCurve(station, signal) };
}

const millis = (time: string | number | Date) =>
  time instanceof Date ? time.getTime() : new Date(time).getTime();

/** Height in metres above the curve's datum, interpolated; null outside it. */
export function tideAt(
  curve: TideCurve,
  time: string | number | Date,
): number | null {
  const t = millis(time);
  const from = Date.parse(curve.from);
  const step = curve.stepMinutes * 60000;
  const position = (t - from) / step;
  if (
    !Number.isFinite(position) ||
    position < 0 ||
    position > curve.curve.length - 1
  )
    return null;
  const index = Math.floor(position);
  const fraction = position - index;
  if (fraction === 0) return curve.curve[index];
  const a = curve.curve[index];
  return a + (curve.curve[index + 1] - a) * fraction;
}

/** High and low waters inside a window, inclusive of both ends, in order. */
export function eventsBetween(
  curve: TideCurve,
  from: string | number | Date,
  to: string | number | Date,
): TideEvent[] {
  const start = millis(from);
  const end = millis(to);
  return curve.events
    .filter((event) => {
      const t = Date.parse(event.time);
      return t >= start && t <= end;
    })
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}
