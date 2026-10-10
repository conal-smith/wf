import { useEffect, useState } from "react";
import {
  FOIL_INDEX_PATH,
  validateFoilManifest,
  type FoilManifest,
} from "../force5/src/foilDepth";
import {
  tideForStation,
  type TideCurve,
  type TideStation,
} from "../force5/src/tides";
import { tideManifest } from "./useBlend";

export interface FoilDepthState {
  manifest: FoilManifest | null;
  /** Each area's station and curve, by station id. */
  tides: Record<string, { station: TideStation; curve: TideCurve }>;
  error: string | null;
}

const EMPTY: FoilDepthState = { manifest: null, tides: {}, error: null };

/**
 * The foilable-depth index and the tide curve of each of its areas' stations,
 * loaded the first time the layer is turned on and kept after.
 */
export function useFoilDepth(enabled: boolean): FoilDepthState {
  const [state, setState] = useState<FoilDepthState>(EMPTY);
  const loaded = !!state.manifest;
  useEffect(() => {
    if (!enabled || loaded) return;
    const controller = new AbortController();
    (async () => {
      const response = await fetch(
        `${import.meta.env.BASE_URL}${FOIL_INDEX_PATH}`,
        { signal: controller.signal },
      );
      if (!response.ok)
        throw new Error("The foilable-depth survey is missing.");
      const manifest = validateFoilManifest(await response.json());
      const tides: FoilDepthState["tides"] = {};
      let error: string | null = null;
      try {
        const stations = await tideManifest(controller.signal);
        for (const id of new Set(manifest.areas.map((a) => a.station))) {
          const tide = await tideForStation(stations, id, controller.signal);
          if (tide) tides[id] = tide;
        }
      } catch {
        if (controller.signal.aborted) throw new Error("aborted");
        error =
          "Tide predictions are unavailable, so the depths cannot follow the tide.";
      }
      return { manifest, tides, error };
    })()
      .then((next) => {
        if (!controller.signal.aborted) setState(next);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          ...EMPTY,
          error:
            e instanceof Error ? e.message : "Foilable depth is unavailable.",
        });
      });
    return () => controller.abort();
  }, [enabled, loaded]);
  return state;
}
