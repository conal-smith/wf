/**
 * What the dock reads beside the rated hours, through the site's own hooks
 * (src/useBlend.ts, src/useSpotSquares.ts): the tide, and, only once they are
 * asked for, the blend's every model line and the waves, sky and sea. The
 * manifests carry no spot data, so each model's one square holding the spot
 * is read for them, and nothing else.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ModelAvailability } from "../../../../force5/src/manifests";
import { spotSquare } from "../../../../force5/src/spotData";
import type { Spot } from "../../../../force5/src/weather";
import {
  useBlend,
  useMarineModels,
  useSpotSeaTemperature,
  useSpotTide,
  useSpotWaves,
  useSpotWeather,
} from "../../../../src/useBlend";
import { useSpotSquares } from "../../../../src/useSpotSquares";

const NO_MODELS: readonly ModelAvailability[] = [];

export function useSpotSquare(spot: Spot | null) {
  const lat = spot?.lat;
  const lon = spot?.lon;
  return useMemo(
    () => (lat === undefined || lon === undefined ? null : [spotSquare(lat, lon)]),
    [lat, lon],
  );
}

/** The waves, the sky, the air, the rain and the sea, once wanted. */
export function useMarine(spot: Spot | null, axis: readonly string[], wanted: boolean) {
  const square = useSpotSquare(spot);
  const marine = useMarineModels(wanted && !!spot);
  const models = useSpotSquares(wanted && spot ? marine : NO_MODELS, square);
  const id = spot?.id;
  const waves = useSpotWaves(wanted ? models : NO_MODELS, id, axis);
  const weather = useSpotWeather(wanted ? models : NO_MODELS, id, axis);
  const sea = useSpotSeaTemperature(wanted ? id : undefined);
  return { waves, weather, sea };
}

/** Every wind model's line for the spot, while the blend chart is the view. */
export function useDockBlend(
  spot: Spot | null,
  models: readonly ModelAvailability[],
  blendModels: readonly string[],
  axis: readonly string[],
  wanted: boolean,
  wantModels: () => void,
) {
  useEffect(() => {
    if (wanted && spot) wantModels();
  }, [wanted, spot, wantModels]);
  const square = useSpotSquare(spot);
  const merged = useSpotSquares(wanted && spot ? models : NO_MODELS, square);
  return useBlend(wanted && spot ? merged : NO_MODELS, blendModels, spot?.id, axis);
}

export { useSpotTide };

/**
 * The hour under the cursor while the finger moves: a little store outside
 * React's tree, so the readout and the cursor's own marks redraw as the hour
 * turns and nothing else does.
 */
export interface ScrubStore {
  get: () => number;
  set: (column: number) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createScrubStore(initial: number): ScrubStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (column) => {
      if (column === value) return;
      value = column;
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const useScrub = (store: ScrubStore) => useSyncExternalStore(store.subscribe, store.get);
