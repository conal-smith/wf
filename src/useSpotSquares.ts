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
 * How long to wait before reading again squares that could not be read, by
 * attempt, then give up until the models or the squares change. `withSpots`
 * has already read the model's pointer again and tried the run it names now, so
 * what is left is a network that failed, or a run being replaced right then.
 */
export const SQUARE_RETRY_MS = [5000, 30000, 120000] as const;

/** Whether an answer lost a model the question had: its squares could not be read. */
export const lostModels = (
  asked: readonly ModelAvailability[],
  answer: readonly ModelAvailability[],
) => answer.some((model, at) => !!asked[at]?.manifest && !model.manifest);

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
 *
 * A model whose squares could not be read comes back unavailable (`withSpots`
 * has already tried the run its pointer names now); the squares are then read
 * again after `SQUARE_RETRY_MS`, rather than the model staying unavailable
 * until the next sweep of the manifests.
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
  const [retry, setRetry] = useState<{
    models: readonly ModelAvailability[];
    key: string | null;
    attempt: number;
  } | null>(null);
  const attempt =
    retry && retry.models === models && retry.key === key ? retry.attempt : 0;
  useEffect(() => {
    if (key === null || !models.length) return;
    let current = true;
    let timer = 0;
    const squares = squaresOf(key);
    void withSpots(
      models,
      squares === ALL_SQUARES ? undefined : squares,
    ).then((merged) => {
      if (!current) return;
      setState({ models, key, answer: { models: merged, squares } });
      const wait = SQUARE_RETRY_MS[attempt];
      if (wait !== undefined && lostModels(models, merged))
        timer = window.setTimeout(
          () => setRetry({ models, key, attempt: attempt + 1 }),
          wait,
        );
    });
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [models, key, attempt]);
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
