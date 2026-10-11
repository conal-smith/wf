import { useEffect, useState } from "react";
import {
  FOIL_INDEX_PATH,
  validateFoilManifest,
  type FoilArea,
  type FoilManifest,
} from "../force5/src/foilDepth";
import {
  tideForStation,
  type TideCurve,
  type TideStation,
} from "../force5/src/tides";
import { forecastUrl } from "../force5/src/urls";
import { tideManifest } from "./useBlend";

export interface FoilDepthState {
  manifest: FoilManifest | null;
  /** The curves loaded so far, by station id: only the stations asked for. */
  tides: Record<string, { station: TideStation; curve: TideCurve }>;
  error: string | null;
}

const EMPTY: FoilDepthState = { manifest: null, tides: {}, error: null };
const TIDE_ERROR =
  "Tide predictions are unavailable, so the depths cannot follow the tide.";

/**
 * An area's archive, as an absolute URL: under the index's `base` on the data
 * host (the forecast's, force5/src/urls.ts), or for an index with no base,
 * beside the site.
 */
export function foilArchiveUrl(manifest: FoilManifest, area: FoilArea) {
  const path = manifest.base
    ? forecastUrl(`${manifest.base}${area.url}`)
    : `${import.meta.env.BASE_URL}${area.url}`;
  return new URL(path, window.location.href).href;
}

/**
 * The foilable-depth index, loaded the first time the layer is turned on and
 * kept after, and the tide curves of `stations` (the stations of the areas
 * in view): each loaded the first time it is asked for and kept, so a pan
 * along the coast fetches a curve per new station and never all of them.
 */
export function useFoilDepth(
  enabled: boolean,
  stations: readonly string[],
): FoilDepthState {
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
      return validateFoilManifest(await response.json());
    })()
      .then((manifest) => {
        if (!controller.signal.aborted)
          setState((s) => ({ ...s, manifest, error: null }));
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

  // The curves wanted and not yet here, as one key so a pan that keeps the
  // same stations in view starts nothing.
  const missing = stations.filter((id) => !state.tides[id]).sort();
  const key = enabled && loaded ? missing.join("|") : "";
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    (async () => {
      const manifest = await tideManifest(controller.signal);
      const got: FoilDepthState["tides"] = {};
      for (const id of key.split("|")) {
        const tide = await tideForStation(manifest, id, controller.signal);
        if (tide) got[id] = tide;
      }
      return got;
    })()
      .then((got) => {
        if (controller.signal.aborted) return;
        setState((s) => ({ ...s, tides: { ...s.tides, ...got } }));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState((s) => ({ ...s, error: TIDE_ERROR }));
      });
    return () => controller.abort();
  }, [key]);
  return state;
}
