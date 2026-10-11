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

/**
 * Whether an answer lost something the question had: a model none of whose
 * squares could be read, or some squares of a model that could be.
 */
export const lostModels = (
  asked: readonly ModelAvailability[],
  answer: readonly ModelAvailability[],
) =>
  answer.some(
    (model, at) =>
      (!!asked[at]?.manifest && !model.manifest) || !!model.unread?.length,
  );

/**
 * The squares an answer really carries: those asked for, less any square some
 * model could not read (`unread`). A place in such a square is unknown, and
 * keeps its pending light, rather than rated from the models that happened to
 * answer for it; every other place is rated from every model.
 */
export function readSquares(
  asked: readonly string[] | typeof ALL_SQUARES,
  answer: readonly ModelAvailability[],
): readonly string[] | typeof ALL_SQUARES {
  const unread = new Set(answer.flatMap((model) => model.unread ?? []));
  if (!unread.size) return asked;
  const squares =
    asked === ALL_SQUARES
      ? [
          ...new Set(
            answer.flatMap((model) => model.manifest?.spots.squares ?? []),
          ),
        ].sort()
      : asked;
  return squares.filter((square) => !unread.has(square));
}

/**
 * The models with the spot data of `squares` merged into their manifests, once
 * it has been read (force5/src/spotData.ts through `withSpots`). A manifest
 * carries no spot data of its own, so this is how the dock, the browser's own
 * blend and the waves read a spot's series: the dock and the rows of one place
 * ask for that place's square, the browser's own blend for the squares in view
 * and the reader's own spots'.
 *
 * Until the squares are in it answers no models, as the availability sweep did
 * before its first answer, and `null` asks for nothing at all. While the
 * squares of new models are read — a new run, every few hours — the last
 * answer for the same squares stays on screen (`shownAnswer`): the blend chart
 * and the waves and weather rows would otherwise go blank for a moment each
 * time. An answer for other squares is never shown — unless `keep` is set:
 * then the last answer stays while the next set of squares is read, which is
 * right for a reader that only adds places (the lights, as the map moves) and
 * wrong for one about a single place, which would be shown another place's.
 *
 * Each square stands alone (`withSpots`): one a model could not read is left
 * out of the answer's `squares`, and only a model with none read comes back
 * unavailable (`withSpots` has already tried the run its pointer names now).
 * The squares are then read again after `SQUARE_RETRY_MS`, rather than staying
 * unread until the next sweep of the manifests.
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
      setState({
        models,
        key,
        answer: { models: merged, squares: readSquares(squares, merged) },
      });
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
  return shownAnswer(state, models, key, keep);
}

/**
 * What `useSpotSquaresState` shows for the question (`models`, `key`) given the
 * last answer it has: that answer while it is for the same squares, whichever
 * models it was read for, or for any squares with `keep`; nothing when nothing
 * is asked.
 */
export function shownAnswer(
  last: { models: readonly ModelAvailability[]; key: string; answer: SquaresState } | null,
  models: readonly ModelAvailability[],
  key: string | null,
  keep: boolean,
): SquaresState {
  if (!last || key === null || !models.length) return NOTHING;
  return last.key === key || keep ? last.answer : NOTHING;
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
