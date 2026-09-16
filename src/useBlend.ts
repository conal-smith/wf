import { useEffect, useMemo, useState } from "react";
import {
  blendInputs,
  blendStats,
  type BlendInput,
  type HourStats,
} from "../force5/src/blend";
import {
  availableModels,
  type ModelAvailability,
} from "../force5/src/manifests";
import { spotSeries } from "../force5/src/series";
import {
  loadTides,
  tideForSpot,
  tideSpotNote,
  type SpotTide,
  type TideManifest,
} from "../force5/src/tides";
import type { Manifest } from "../force5/src/weather";
import { axisVectors, meanDirections } from "./chart";

/**
 * Availability of every live model, resolved once. Missing models are a normal
 * state: `availableModels` never throws, and the map keeps working regardless.
 */
export function useModelAvailability(): {
  models: ModelAvailability[];
  resolved: boolean;
} {
  const [models, setModels] = useState<ModelAvailability[]>([]);
  const [resolved, setResolved] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    availableModels(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setModels(result);
        setResolved(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setResolved(true);
      });
    return () => controller.abort();
  }, []);
  return { models, resolved };
}

export interface TideState {
  tide: SpotTide | null;
  manifest: TideManifest | null;
  /** Why there is no tide row; a missing manifest is expected, not a fault. */
  error: string | null;
  loading: boolean;
}

/** The nearest tide station's curve for a named spot, or an explained absence. */
export function useSpotTide(spotId: string | undefined): TideState {
  const [state, setState] = useState<TideState>({
    tide: null,
    manifest: null,
    error: null,
    loading: !!spotId,
  });
  useEffect(() => {
    if (!spotId) {
      setState({ tide: null, manifest: null, error: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true }));
    (async () => {
      const manifest = await loadTides(controller.signal);
      const tide = await tideForSpot(manifest, spotId, controller.signal);
      return { manifest, tide };
    })()
      .then(({ manifest, tide }) => {
        if (controller.signal.aborted) return;
        setState({
          tide,
          manifest,
          error: tide ? null : tideSpotNote(manifest, spotId),
          loading: false,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          tide: null,
          manifest: null,
          error:
            error instanceof Error
              ? "Tide predictions are not published yet. Run npm run tides:refresh."
              : "Tide predictions are unavailable.",
          loading: false,
        });
      });
    return () => controller.abort();
  }, [spotId]);
  return state;
}

export interface Blend {
  /** One line per deterministic model and per ensemble member. */
  lines: BlendInput[];
  stats: HourStats[];
  /** Mean bearing per axis hour across the contributing models. */
  directions: (number | null)[];
  /** Models that actually contributed a line, in registry order. */
  contributing: string[];
  manifests: Manifest[];
}

const EMPTY: Blend = {
  lines: [],
  stats: [],
  directions: [],
  contributing: [],
  manifests: [],
};

/**
 * The probability blend for one spot on the axis the dock's columns already
 * use. Precomputed series only: the chart must never trigger a frame download.
 */
export function useBlend(
  models: readonly ModelAvailability[],
  selected: readonly string[],
  spotId: string | undefined,
  axis: readonly string[],
): Blend {
  const selectedKey = [...selected].sort().join(",");
  const axisKey = axis.length ? `${axis[0]}/${axis.at(-1)}/${axis.length}` : "";
  const manifests = useMemo(
    () =>
      models
        .filter(
          (model) => model.manifest !== null && selected.includes(model.id),
        )
        .map((model) => model.manifest!),
    // The sorted selection key is what actually changes the result.
    [models, selectedKey],
  );
  return useMemo(() => {
    if (!spotId || !axis.length) return EMPTY;
    const usable = manifests.filter(
      (manifest) => spotSeries(manifest, spotId) !== null,
    );
    if (!usable.length) return EMPTY;
    const ids = usable.map((manifest) => manifest.model);
    const lines = blendInputs(usable, spotId, ids, axis);
    if (!lines.length) return EMPTY;
    return {
      lines,
      stats: blendStats(lines, axis),
      directions: meanDirections(
        usable.map((manifest) =>
          axisVectors(spotSeries(manifest, spotId)!, axis),
        ),
        axis.length,
      ),
      contributing: Array.from(new Set(lines.map((line) => line.model))),
      manifests: usable,
    };
    // axisKey stands in for the axis array, which is rebuilt every render.
  }, [manifests, spotId, axisKey]);
}
