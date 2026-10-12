import { useEffect, useState } from "react";
import {
  SATELLITE_INDEX_PATH,
  validateSatelliteManifest,
  type SatelliteManifest,
  type SatelliteOption,
} from "../force5/src/satellite";
import { forecastUrl } from "../force5/src/urls";

export interface SatelliteState {
  manifest: SatelliteManifest | null;
  error: string | null;
}

/** An option's archive, as an absolute URL under the index's `base` on the data host. */
export function satelliteArchiveUrl(
  manifest: SatelliteManifest,
  option: Exclude<SatelliteOption, "off">,
) {
  return new URL(
    forecastUrl(`${manifest.base}${manifest.options[option].url}`),
    window.location.href,
  ).href;
}

/**
 * The satellite imagery's index, loaded the first time an image is asked for
 * and kept after: with the layer off (the default) nothing is fetched.
 */
export function useSatellite(option: SatelliteOption): SatelliteState {
  const [state, setState] = useState<SatelliteState>({
    manifest: null,
    error: null,
  });
  const wanted = option !== "off" && !state.manifest;
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}${SATELLITE_INDEX_PATH}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("The satellite imagery is missing.");
        return validateSatelliteManifest(await response.json());
      })
      .then((manifest) => {
        if (!controller.signal.aborted) setState({ manifest, error: null });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          manifest: null,
          error:
            e instanceof Error
              ? e.message
              : "The satellite imagery is unavailable.",
        });
      });
    return () => controller.abort();
  }, [wanted]);
  return state;
}
