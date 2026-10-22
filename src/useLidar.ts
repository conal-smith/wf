import { useEffect, useState } from "react";
import type { LidarIndex, LidarView } from "../force5/src/lidar";
import { forecastUrl } from "../force5/src/urls";

export interface LidarState {
  /** What the map draws, or null with the layer off or its index not here yet. */
  view: LidarView | null;
  /** The index, once loaded: the key's colours and the sources' list. */
  index: LidarIndex | null;
  error: string | null;
}

const absolute = (path: string) =>
  new URL(forecastUrl(path), window.location.href).href;

/**
 * The LiDAR layer's index, and the module that reads and draws it, loaded the
 * first time the layer is turned on and kept after. Off (the default),
 * nothing is fetched and none of its code is loaded.
 */
export function useLidar(on: boolean): LidarState {
  const [loaded, setLoaded] = useState<{
    index: LidarIndex;
    view: LidarView;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wanted = on && !loaded;
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    import("../force5/src/lidar")
      .then((lidar) =>
        lidar.loadLidar(
          `${import.meta.env.BASE_URL}${lidar.LIDAR_INDEX_PATH}`,
          absolute,
          controller.signal,
        ),
      )
      .then((result) => {
        if (controller.signal.aborted) return;
        setLoaded(result);
        setError(null);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          e instanceof Error && e.name !== "SyntaxError"
            ? e.message
            : "The LiDAR data is unavailable.",
        );
      });
    return () => controller.abort();
  }, [wanted]);
  return {
    view: on ? (loaded?.view ?? null) : null,
    index: loaded?.index ?? null,
    error: on ? error : null,
  };
}
