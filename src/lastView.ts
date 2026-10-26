/**
 * Where the site's root opens, and where the chart was last centred.
 *
 * The root is the spot finder (since 26 October 2026), with the chart beside
 * it on a wide screen; the full chart is the root with `?map`, or with a spot
 * (`/?spot=keel`). Two old addresses are still answered: `/spots`, the
 * finder's own until then, is the root, and `/?chart`, the full chart's word,
 * is `/?map`. Both are put right in the address before the map reads it.
 *
 * Where the chart was last centred is what the spot finder falls back on for
 * "near you" when the browser will not say where the rider is.
 *
 * Small and free of the map: src/main.tsx reads it before the map's chunk is
 * asked for.
 */
import {
  MAP_PARAM,
  OLD_CHART_PARAM,
  isOldFinderPath,
} from "../force5/src/siteNav";

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
    // Best effort: the finder falls back on the whole of Ireland.
  }
};

/**
 * The address an old one is now, or null to stay: `/spots` (and under it)
 * is the root, with its query; `?chart` on the root is `?map`.
 */
export function openingPath(pathname: string, search: string): string | null {
  if (isOldFinderPath(pathname)) return "/" + (search === "?" ? "" : search);
  if (pathname !== "/") return null;
  const query = new URLSearchParams(search);
  if (!query.has(OLD_CHART_PARAM)) return null;
  query.delete(OLD_CHART_PARAM);
  query.delete(MAP_PARAM);
  const rest = query.toString();
  if (query.has("spot")) return `/?${rest}`;
  return `/?${MAP_PARAM}${rest ? `&${rest}` : ""}`;
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
