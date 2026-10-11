import { useEffect, useState } from "react";
import { withSpots, type ModelAvailability } from "../force5/src/manifests";

/** Every square a run lists: what a reader that needs every spot asks for. */
export const ALL_SQUARES = "all";

/**
 * The models with the spot data of `squares` merged into their manifests, once
 * it has been read (force5/src/spotData.ts through `withSpots`). A manifest
 * carries no spot data of its own, so this is how the dock, the browser's own
 * blend and the waves read a spot's series: the dock and the rows of one place
 * ask for that place's square, the lights for `ALL_SQUARES`.
 *
 * Until the squares are in it answers no models, as the availability sweep did
 * before its first answer, and `null` asks for nothing at all. An answer for
 * models or squares that have since changed is never shown.
 */
export function useSpotSquares(
  models: readonly ModelAvailability[],
  squares: readonly string[] | typeof ALL_SQUARES | null,
): ModelAvailability[] {
  const key =
    squares === null
      ? null
      : squares === ALL_SQUARES
        ? ALL_SQUARES
        : [...squares].sort().join(",");
  const [state, setState] = useState<{
    models: readonly ModelAvailability[];
    key: string | null;
    merged: ModelAvailability[];
  } | null>(null);
  useEffect(() => {
    if (key === null || !models.length) return;
    let current = true;
    void withSpots(
      models,
      key === ALL_SQUARES ? undefined : key ? key.split(",") : [],
    ).then((merged) => {
      if (current) setState({ models, key, merged });
    });
    return () => {
      current = false;
    };
  }, [models, key]);
  return state && state.models === models && state.key === key && key !== null
    ? state.merged
    : NONE;
}

const NONE: ModelAvailability[] = [];
