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
import {
  preferredWeatherSource,
  weatherAtAxis,
  type WeatherSource,
  type WeatherStep,
} from "../force5/src/surface";
import {
  preferredWaveSource,
  waveAtAxis,
  type WaveSource,
  type WaveStep,
} from "../force5/src/waves";
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

export interface SpotWaves {
  /** The source actually read for this spot, or null when none covers it. */
  source: WaveSource | null;
  /** Whether any wave manifest answered at all, however it covers this spot. */
  published: boolean;
  /** The nearest native wave step per dock column; null where none is close. */
  columns: (WaveStep | null)[];
}

const NO_WAVES: SpotWaves = { source: null, published: false, columns: [] };

/**
 * Waves for one spot on the dock's own columns. The wave manifests come from
 * the same availability sweep the blend uses, so no extra request is made, and
 * the columns hold native forecast steps rather than interpolated sea states.
 */
export function useSpotWaves(
  models: readonly ModelAvailability[],
  spotId: string | undefined,
  axis: readonly string[],
): SpotWaves {
  const axisKey = axis.length ? `${axis[0]}/${axis.at(-1)}/${axis.length}` : "";
  const waves = useMemo(
    () =>
      models.filter((model) => model.wave !== null).map((model) => model.wave!),
    [models],
  );
  return useMemo(() => {
    if (!waves.length) return NO_WAVES;
    const source = preferredWaveSource(waves, spotId);
    return {
      source,
      published: true,
      columns: source ? waveAtAxis(source.series, axis) : [],
    };
    // axisKey stands in for the axis array, which is rebuilt every render.
  }, [waves, spotId, axisKey]);
}

export interface SpotWeather {
  /** The source actually read for this spot, or null when none covers it. */
  source: WeatherSource | null;
  /** Whether any weather manifest answered at all, however it covers this spot. */
  published: boolean;
  /** The nearest native step per dock column; null where none is close. */
  columns: (WeatherStep | null)[];
}

const NO_WEATHER: SpotWeather = {
  source: null,
  published: false,
  columns: [],
};

/**
 * Surface weather for one spot on the dock's own columns, from the same
 * availability sweep the blend and the waves use, so no extra request is made.
 * The columns hold native forecast steps: a present-weather code is an index
 * into a table and a rain total belongs to an interval, so neither survives
 * being interpolated onto a column the model did not publish.
 */
export function useSpotWeather(
  models: readonly ModelAvailability[],
  spotId: string | undefined,
  axis: readonly string[],
): SpotWeather {
  const axisKey = axis.length ? `${axis[0]}/${axis.at(-1)}/${axis.length}` : "";
  const published = useMemo(
    () =>
      models
        .filter((model) => model.weather !== null)
        .map((model) => model.weather!),
    [models],
  );
  return useMemo(() => {
    if (!published.length) return NO_WEATHER;
    const source = preferredWeatherSource(published, spotId);
    return {
      source,
      published: true,
      columns: source ? weatherAtAxis(source.series, axis) : [],
    };
    // axisKey stands in for the axis array, which is rebuilt every render.
  }, [published, spotId, axisKey]);
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
        .filter((model) => model.wind !== null && selected.includes(model.id))
        .map((model) => model.wind!),
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
