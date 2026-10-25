/**
 * The chart's arithmetic, with no React Native in it: where a place is on the
 * screen for a camera, what the camera shows, the stored layer choices, and
 * the small sums the site's map does inline (src/App.tsx, WindMap.tsx).
 *
 * The camera never rotates or tilts here (the map is a chart, north up), so
 * the screen is Web Mercator scaled and shifted: 512 points a world at zoom
 * 0, as MapLibre counts it on both platforms.
 */
import { CHART_BOUNDS, IRELAND } from "../../../../force5/src/chartStyle";
import { parseSatelliteOption, type SatelliteOption } from "../../../../force5/src/satellite";
import type { ViewBounds } from "../../../../force5/src/squares";
import type { MapView } from "../../../../force5/src/tiledField";
import type { Spot } from "../../../../force5/src/weather";
import { clock, dayShort } from "../../../../src/strip";

export { IRELAND };

/* ---- the camera ---------------------------------------------------------- */

/** What the native map reports when it comes to rest, and what the overlay draws with. */
export interface Camera {
  /** [lon, lat] of the view's centre. */
  center: [number, number];
  zoom: number;
  /** The map's size in points. */
  width: number;
  height: number;
}

export const WORLD = 512;

/** Longitude to Mercator x, 0–1 round the world. */
export const mercX = (lon: number) => (lon + 180) / 360;
/** Latitude to Mercator y, 0 at the top. */
export const mercY = (lat: number) =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
export const lonOf = (x: number) => x * 360 - 180;
export const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/** Screen point of a place for a camera. */
export function project(camera: Camera, lon: number, lat: number): [number, number] {
  const scale = WORLD * 2 ** camera.zoom;
  return [
    (mercX(lon) - mercX(camera.center[0])) * scale + camera.width / 2,
    (mercY(lat) - mercY(camera.center[1])) * scale + camera.height / 2,
  ];
}

/** The place under a screen point for a camera, [lon, lat]. */
export function unproject(camera: Camera, x: number, y: number): [number, number] {
  const scale = WORLD * 2 ** camera.zoom;
  return [
    lonOf(mercX(camera.center[0]) + (x - camera.width / 2) / scale),
    latOf(mercY(camera.center[1]) + (y - camera.height / 2) / scale),
  ];
}

/** What the camera shows, in degrees. */
export function boundsOf(camera: Camera): ViewBounds {
  const [west, north] = unproject(camera, 0, 0);
  const [east, south] = unproject(camera, camera.width, camera.height);
  return { west, south, east, north };
}

/** The view as the forecast's squares want it (setView), from MapLibre's [west, south, east, north]. */
export function viewFromBounds(bounds: readonly number[] | null | undefined): ViewBounds | null {
  if (!bounds || bounds.length < 4) return null;
  const [west, south, east, north] = bounds;
  return [west, east, south, north].every(Number.isFinite) && east >= west && north >= south
    ? { west, south, east, north }
    : null;
}

/** Two views the same to a few metres: a camera that has not really moved reads nothing new. */
export const sameView = (a: ViewBounds | null, b: ViewBounds | null) =>
  !!a &&
  !!b &&
  Math.abs(a.west - b.west) < 1e-4 &&
  Math.abs(a.east - b.east) < 1e-4 &&
  Math.abs(a.south - b.south) < 1e-4 &&
  Math.abs(a.north - b.north) < 1e-4;

/** The quiet round a focused spot (WindMap.tsx): paper over the world, three rings cut out. */
export function focusFeatures(lon: number, lat: number, metres: number) {
  const WORLD_RING = [
    [-40, 35],
    [25, 35],
    [25, 72],
    [-40, 72],
    [-40, 35],
  ];
  const ring = (m: number) => {
    const out: number[][] = [];
    for (let i = 0; i <= 56; i++) {
      // Clockwise, against the world's ring: a hole in it, not another sheet.
      const a = (i / 56) * Math.PI * 2;
      out.push([
        lon + (m * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180)),
        lat + (m * Math.cos(a)) / 110574,
      ]);
    }
    return out;
  };
  return {
    type: "FeatureCollection" as const,
    features: [1, 1.4, 1.85].map((k) => ({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Polygon" as const, coordinates: [WORLD_RING, ring(metres * k)] },
    })),
  };
}

/** The radius of the quiet round a focus, in metres: a third of the visible chart (WindMap.tsx). */
export function focusRadius(camera: Camera, lat: number, bottomInset: number): number {
  const visible = camera.height - bottomInset - 70;
  const points = Math.max(90, 0.3 * Math.min(camera.width, visible));
  return points * metresPerPoint(lat, camera.zoom);
}

/**
 * What the wind's tiles want to know (tiledField.ts, `MapView`): the box the
 * wash paints — the view and a third of it again past each edge — and points
 * per degree at the view's centre.
 */
export function mapViewOf(camera: Camera): MapView {
  const mx = camera.width / 3;
  const my = camera.height / 3;
  const [west, north] = unproject(camera, -mx, -my);
  const [east, south] = unproject(camera, camera.width + mx, camera.height + my);
  const lat = camera.center[1];
  const scale = WORLD * 2 ** camera.zoom;
  return {
    west,
    north,
    east,
    south,
    pxPerLon: scale / 360,
    pxPerLat: Math.abs(mercY(lat + 0.5) - mercY(lat - 0.5)) * scale,
  };
}

/** Metres a point covers at a latitude and zoom. */
export const metresPerPoint = (lat: number, zoom: number) =>
  (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (WORLD * 2 ** zoom);

/** "SCALE 1 : 2 400 000", as the site's map key gives it (a CSS pixel is 1/3779.5 m). */
export function scaleLabel(lat: number, zoom: number): string {
  let n = metresPerPoint(lat, zoom) * 3779.5;
  const p = 10 ** (Math.floor(Math.log10(n)) - 1);
  n = Math.round(n / p) * p;
  const digits = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `SCALE 1 : ${digits}`;
}

/** A point a little out to sea from a spot, so the shore sits off-centre (WindMap.tsx). */
export function seaward(spot: Pick<Spot, "lat" | "lon" | "facing">, metres = 500): [number, number] {
  if (spot.facing === null || spot.facing === undefined) return [spot.lon, spot.lat];
  const a = (spot.facing * Math.PI) / 180;
  return [
    spot.lon + (metres * Math.sin(a)) / (111320 * Math.cos((spot.lat * Math.PI) / 180)),
    spot.lat + (metres * Math.cos(a)) / 111320,
  ];
}

/** The zoom a spot is flown to: at least a bay's. */
export const SPOT_ZOOM = 10.4;

/**
 * A flight as long as the trip (WindMap.tsx `flyTo`): the next bay over is a
 * short glide, the length of the country a longer flight.
 */
export function flightMs(from: Camera, to: { center: [number, number]; zoom: number }): number {
  const a = project(from, from.center[0], from.center[1]);
  const b = project(from, to.center[0], to.center[1]);
  const across = Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.hypot(from.width, from.height);
  const climb = Math.abs(to.zoom - from.zoom);
  return Math.round(Math.min(1600, 450 + 300 * Math.min(climb, 3) + 500 * Math.min(across, 1.5)));
}

/** The site's CHART_BOUNDS, as MapLibre React Native's [west, south, east, north]. */
export const CHART_PAN_BOUNDS: [number, number, number, number] = [
  CHART_BOUNDS[0][0],
  CHART_BOUNDS[0][1],
  CHART_BOUNDS[1][0],
  CHART_BOUNDS[1][1],
];

/** IRELAND as MapLibre React Native's [west, south, east, north]. */
export const IRELAND_BOUNDS: [number, number, number, number] = [
  IRELAND[0][0],
  IRELAND[0][1],
  IRELAND[1][0],
  IRELAND[1][1],
];

/* ---- the rider's choices ------------------------------------------------- */

export const WIND_KEY = "wingfoil.map.wind.v1";
export const LAYERS_KEY = "wingfoil.map.layers.v1";

/** Which parts of the chart are drawn (force5/src/WindMap.tsx `ChartLayers`). */
export interface ChartLayers {
  tints: boolean;
  soundings: boolean;
  relief: boolean;
  names: boolean;
  /** Foilable depth at the selected tide, round the coast. */
  foil: boolean;
}

/** The chart's switches and, in the same store, the satellite's choice (src/App.tsx). */
export type MapLayers = ChartLayers & { satellite: SatelliteOption };

export const DEFAULT_LAYERS: MapLayers = {
  tints: true,
  soundings: true,
  relief: true,
  names: true,
  foil: true,
  satellite: "off",
};

/** The stored layers, read as the site reads them: unknown keys kept, bad JSON the defaults. */
export function parseLayers(saved: string | null): MapLayers {
  try {
    const parsed = JSON.parse(saved ?? "{}") as Partial<MapLayers> | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return DEFAULT_LAYERS;
    const out = { ...DEFAULT_LAYERS, ...parsed, satellite: parseSatelliteOption(parsed.satellite) };
    for (const key of ["tints", "soundings", "relief", "names", "foil"] as const)
      if (typeof out[key] !== "boolean") out[key] = DEFAULT_LAYERS[key];
    return out;
  } catch {
    return DEFAULT_LAYERS;
  }
}

/** The labels the layers sheet gives each switch (src/MapControls.tsx). */
export const CHART_LABEL: Record<keyof ChartLayers, string> = {
  tints: "Depth tints",
  soundings: "Contours, soundings",
  relief: "Land relief",
  names: "Spot names",
  foil: "Tidal depth",
};

/** A store that never throws: the choice still holds for this session. */
export const store = {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Best effort.
    }
  },
};

/* ---- the model on the chart --------------------------------------------- */

type Staleness = "fresh" | "stale" | "expired";

/**
 * What the chart's model label says, and says aloud: the rider's model and
 * its run, or past either end of that run the model drawn in its place and
 * from when ("ECMWF from Sat 09:00"), as the site's map says it on a phone.
 * The label is how the jump in detail at the seam reads as a hand-over, not a
 * fault. `warn` where the run drawn is an older or an archived one.
 */
export function modelLabel(
  model: { name: string; run: string | null; staleness: Staleness },
  handover: {
    name: string;
    side: "before" | "after";
    at: number | null;
    staleness: Staleness;
  } | null,
): { text: string; spoken: string; warn: boolean } {
  const staleness = handover?.staleness ?? model.staleness;
  const shown = staleness === "expired" ? " · archived" : staleness === "stale" ? " · older run" : "";
  const said = staleness === "expired" ? ", archived" : staleness === "stale" ? ", an older run" : "";
  if (!handover)
    return {
      text: `${model.name} · ${model.run}${shown}`,
      spoken: `${model.name} on the map, ${model.run} run${said}. Opens Layers.`,
      warn: staleness !== "fresh",
    };
  const when =
    handover.at === null
      ? ""
      : ` ${handover.side === "before" ? "until" : "from"} ${dayShort(handover.at)} ${clock(handover.at)}`;
  const why =
    handover.side === "before" ? `before ${model.name}’s run starts` : `past the end of ${model.name}’s run`;
  return {
    text: `${handover.name}${when}${shown}`,
    spoken: `${handover.name} on the map${when}, ${why}${said}. Opens Layers.`,
    warn: staleness !== "fresh",
  };
}

/** "52.12° N, 10.05° W", for a point tapped on the open map (src/App.tsx). */
export const degrees = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? "W" : "E"}`;
