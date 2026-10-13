import { useEffect, useState } from "react";
import type { IntertidalManifest } from "../force5/src/intertidal";

/** Where the index is served from, under the site's BASE_URL: it ships with the site. */
export const INTERTIDAL_INDEX_PATH = "intertidal/index.json";

/**
 * The zoom the intertidal heights are drawn from: a 10 m pixel is a few
 * screen pixels there, and a bay's flats fill the view. Further out the foil
 * archives' own foreshore is all that shows, and nothing here is loaded.
 */
export const INTERTIDAL_FROM_ZOOM = 10;

type Index = typeof import("../force5/src/intertidal");

export interface IntertidalState {
  manifest: IntertidalManifest | null;
  /** The module that reads the index, loaded with it. */
  index: Index | null;
  error: string | null;
}

/**
 * The intertidal heights' index and the module that reads it, loaded the
 * first time they are `wanted` (the foil layer on, the map zoomed in to the
 * shore) and kept after. Until then nothing is fetched.
 */
export function useIntertidal(wanted: boolean): IntertidalState {
  const [state, setState] = useState<IntertidalState>({
    manifest: null,
    index: null,
    error: null,
  });
  const load = wanted && !state.manifest && !state.error;
  useEffect(() => {
    if (!load) return;
    const controller = new AbortController();
    Promise.all([
      import("../force5/src/intertidal"),
      fetch(`${import.meta.env.BASE_URL}${INTERTIDAL_INDEX_PATH}`, {
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok)
          throw new Error("The intertidal heights are missing.");
        return response.json() as Promise<unknown>;
      }),
    ])
      .then(([index, json]) => {
        if (controller.signal.aborted) return;
        setState({
          manifest: index.validateIntertidalManifest(json),
          index,
          error: null,
        });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        // Not shown: the foil archives' own foreshore stands in.
        setState({
          manifest: null,
          index: null,
          error:
            e instanceof Error
              ? e.message
              : "The intertidal heights are unavailable.",
        });
      });
    return () => controller.abort();
  }, [load]);
  return state;
}
