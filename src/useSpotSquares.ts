import { useEffect, useState } from "react";
import { withSpots, type ModelAvailability } from "../force5/src/manifests";

/** Every square a run lists: what a reader that needs every spot asks for. */
export const ALL_SQUARES = "all";

/** What `useSpotSquaresState` has merged in, and for which squares. */
export interface SquaresState {
  models: ModelAvailability[];
  /**
   * The squares whose spot data `models` carry: `ALL_SQUARES`, a list, or
   * null while nothing has been read. A spot outside them is unknown, not calm.
   */
  squares: readonly string[] | typeof ALL_SQUARES | null;
}

const keyOf = (squares: readonly string[] | typeof ALL_SQUARES | null) =>
  squares === null
    ? null
    : squares === ALL_SQUARES
      ? ALL_SQUARES
      : [...squares].sort().join(",");

const squaresOf = (key: string): readonly string[] | typeof ALL_SQUARES =>
  key === ALL_SQUARES ? ALL_SQUARES : key ? key.split(",") : [];

/**
 * The models with the spot data of `squares` merged into their manifests, once
 * it has been read (force5/src/spotData.ts through `withSpots`). A manifest
 * carries no spot data of its own, so this is how the dock, the browser's own
 * blend and the waves read a spot's series: the dock and the rows of one place
 * ask for that place's square, the browser's own blend for the squares in view
 * and the reader's own spots'.
 *
 * Until the squares are in it answers no models, as the availability sweep did
 * before its first answer, and `null` asks for nothing at all. An answer for
 * models or squares that have since changed is never shown — unless `keep` is
 * set: then, for the same models, the last answer stays while the next set of
 * squares is read, which is right for a reader that only adds places (the
 * lights, as the map moves) and wrong for one about a single place.
 */
export function useSpotSquaresState(
  models: readonly ModelAvailability[],
  squares: readonly string[] | typeof ALL_SQUARES | null,
  keep = false,
): SquaresState {
  const key = keyOf(squares);
  const [state, setState] = useState<{
    models: readonly ModelAvailability[];
    key: string;
    answer: SquaresState;
  } | null>(null);
  useEffect(() => {
    if (key === null || !models.length) return;
    let current = true;
    const squares = squaresOf(key);
    void withSpots(
      models,
      squares === ALL_SQUARES ? undefined : squares,
    ).then((merged) => {
      if (current)
        setState({ models, key, answer: { models: merged, squares } });
    });
    return () => {
      current = false;
    };
  }, [models, key]);
  return state &&
    state.models === models &&
    key !== null &&
    (state.key === key || keep)
    ? state.answer
    : NOTHING;
}

/** The merged models alone: `useSpotSquaresState` without the squares. */
export function useSpotSquares(
  models: readonly ModelAvailability[],
  squares: readonly string[] | typeof ALL_SQUARES | null,
): ModelAvailability[] {
  return useSpotSquaresState(models, squares).models;
}

const NONE: ModelAvailability[] = [];
const NOTHING: SquaresState = { models: NONE, squares: null };
