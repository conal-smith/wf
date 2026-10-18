/**
 * The seabed under a point tapped while the foil layer is on (src/App.tsx
 * `probeFoil`): the first foil archive with water under the point.
 */
import { useEffect, useMemo, useState } from "react";
import { areasAt, type FoilManifest, type FoilPoint } from "../../../../force5/src/foilDepth";
import { elevationAt } from "./probe";
import { foilArchiveUrl } from "./useChartLayers";

export interface Probe {
  lon: number;
  lat: number;
  /** The foil area the reading belongs to, or null where no survey covers the point. */
  area: string | null;
  z: FoilPoint;
  done: boolean;
}

export function useFoilProbe(
  point: { lon: number; lat: number } | null,
  on: boolean,
  manifest: FoilManifest | null,
): Probe | null {
  const lon = point?.lon;
  const lat = point?.lat;
  const candidates = useMemo(
    () => (lon !== undefined && lat !== undefined && on && manifest ? areasAt(manifest.areas, lon, lat) : null),
    [lon, lat, on, manifest],
  );
  const key = candidates ? `${lon},${lat}` : "";
  const [found, setFound] = useState<{ key: string; area: string; z: FoilPoint } | null>(null);
  useEffect(() => {
    if (!candidates?.length || !manifest || lon === undefined || lat === undefined) return;
    let live = true;
    (async (): Promise<{ area: string; z: FoilPoint }> => {
      let last: FoilPoint = null;
      for (const area of candidates) {
        const z = await elevationAt(area, foilArchiveUrl(manifest, area), lon, lat, manifest);
        if (z !== null && z !== "none") return { area: area.id, z };
        last = z;
      }
      return { area: candidates[candidates.length - 1].id, z: last };
    })()
      .then((result) => {
        if (live) setFound({ key: `${lon},${lat}`, ...result });
      })
      .catch(() => {
        if (live) setFound({ key: `${lon},${lat}`, area: candidates[0].id, z: "none" });
      });
    return () => {
      live = false;
    };
  }, [candidates, manifest, lon, lat]);

  if (!candidates || lon === undefined || lat === undefined) return null;
  if (!candidates.length) return { lon, lat, area: null, z: null, done: true };
  if (found?.key === key) return { lon, lat, area: found.area, z: found.z, done: true };
  return { lon, lat, area: candidates[0].id, z: null, done: false };
}
