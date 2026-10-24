/**
 * Which of the map's two pages the rider last had open, the chart or the spot
 * finder, kept on this device: the site's root opens on that one. A link that
 * says where to go wins (`/spots`, `/?spot=keel`, a spot's page), and so does
 * any query on the root, which is the chart's to read.
 *
 * Also where the chart was last centred, which the spot finder falls back on
 * for "near you" when the browser will not say where the rider is.
 *
 * Small and free of the map: src/main.tsx reads it before the map's chunk is
 * asked for.
 */
import { FINDER_HREF, isFinderPath } from "../force5/src/siteNav";

export type MapView = "chart" | "finder";

export const VIEW_KEY = "wingfoil.view.v1";
export const CHART_CENTRE_KEY = "wingfoil.map.centre.v1";

type Store = Pick<Storage, "getItem" | "setItem">;

const device = (): Store | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const read = (storage: Store | null, key: string) => {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const write = (storage: Store | null, key: string, value: string) => {
  try {
    storage?.setItem(key, value);
  } catch {
    // Best effort: the page still opens on the chart.
  }
};

/** The page a path draws. */
export const viewOfPath = (pathname: string): MapView =>
  isFinderPath(pathname) ? "finder" : "chart";

/** The view kept on this device, or null for none. */
export function storedView(storage: Store | null = device()): MapView | null {
  const v = read(storage, VIEW_KEY);
  return v === "chart" || v === "finder" ? v : null;
}

export function saveView(view: MapView, storage: Store | null = device()) {
  write(storage, VIEW_KEY, view);
}

/**
 * Where the root should open instead, or null to stay: the spot finder's
 * path when that is what the rider had last and the link names nothing.
 */
export function openingPath(
  pathname: string,
  search: string,
  stored: MapView | null,
): string | null {
  if (pathname !== "/" || (search && search !== "?")) return null;
  return stored === "finder" ? FINDER_HREF : null;
}

export interface LatLon {
  lat: number;
  lon: number;
}

/** Where the chart was last centred, or null. */
export function chartCentre(storage: Store | null = device()): LatLon | null {
  try {
    const v = JSON.parse(read(storage, CHART_CENTRE_KEY) ?? "null");
    return v && Number.isFinite(v.lat) && Number.isFinite(v.lon)
      ? { lat: v.lat, lon: v.lon }
      : null;
  } catch {
    return null;
  }
}

export function saveChartCentre(at: LatLon, storage: Store | null = device()) {
  write(
    storage,
    CHART_CENTRE_KEY,
    JSON.stringify({ lat: +at.lat.toFixed(4), lon: +at.lon.toFixed(4) }),
  );
}
