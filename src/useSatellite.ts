import { useEffect, useMemo, useState } from "react";
import {
  SATELLITE_INDEX_PATH,
  type SatelliteOption,
} from "../force5/src/satellite";
import type {
  SatelliteManifest,
  SatelliteStation,
} from "../force5/src/satelliteIndex";
import type { SatelliteImage } from "../force5/src/WindMap";
import { forecastUrl } from "../force5/src/urls";

type Index = typeof import("../force5/src/satelliteIndex");

export interface SatelliteState {
  /** The images to draw over the view, or null with the layer off. */
  image: SatelliteImage | null;
  /** The station nearest the view's centre, once the index is here. */
  station: SatelliteStation | null;
  /** The key's line: "Satellite: high tide (≈4.6 m)", or null when off. */
  note: string | null;
  /** The index's own credit, once it is here. */
  attribution: string | null;
  error: string | null;
}

/**
 * The satellite imagery over a view: its index and the module that reads it,
 * loaded the first time an image is chosen and kept after. With the layer off
 * (the default) nothing is fetched and none of that code is loaded; once on,
 * only the areas whose box meets the view are drawn, so only their archives
 * are opened.
 */
export function useSatellite(
  option: SatelliteOption,
  view: {
    west: number;
    south: number;
    east: number;
    north: number;
    zoom: number;
  } | null,
): SatelliteState {
  const [loaded, setLoaded] = useState<{
    index: Index;
    manifest: SatelliteManifest;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wanted = option !== "off" && !loaded;
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    Promise.all([
      import("../force5/src/satelliteIndex"),
      fetch(`${import.meta.env.BASE_URL}${SATELLITE_INDEX_PATH}`, {
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok) throw new Error("The satellite imagery is missing.");
        return response.json() as Promise<unknown>;
      }),
    ])
      .then(([index, json]) => {
        if (controller.signal.aborted) return;
        setLoaded({ index, manifest: index.validateSatelliteManifest(json) });
        setError(null);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          e instanceof Error
            ? e.message
            : "The satellite imagery is unavailable.",
        );
      });
    return () => controller.abort();
  }, [wanted]);

  return useMemo<SatelliteState>(() => {
    if (!loaded)
      return {
        image: null,
        station: null,
        note: null,
        attribution: null,
        error: option === "off" ? null : error,
      };
    const { index, manifest } = loaded;
    const station = view
      ? index.nearestSatelliteStation(
          manifest.areas,
          (view.west + view.east) / 2,
          (view.south + view.north) / 2,
        )
      : null;
    return {
      image:
        option === "off"
          ? null
          : {
              option,
              layers: view
                ? index
                    .satelliteLayers(manifest, option, view, view.zoom)
                    .map((layer) => ({
                      ...layer,
                      url: new URL(
                        forecastUrl(layer.path),
                        window.location.href,
                      ).href,
                      attribution: manifest.attribution,
                    }))
                : [],
            },
      station,
      note: index.satelliteNote(option, station),
      attribution: manifest.attribution,
      error: null,
    };
  }, [option, view, loaded, error]);
}
