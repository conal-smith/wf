import { useEffect, useMemo, useRef, useState } from "react";
import {
  blendInputs,
  blendStats,
  leadHours,
  modelWeight,
  perModelLines,
  type BlendInput,
  type HourStats,
} from "../force5/src/blend";
import {
  abortable,
  availableModels,
  loadAnyManifest,
  waveModels,
  weatherModels,
  windModels,
  type AnyManifest,
  type ModelAvailability,
} from "../force5/src/manifests";
import { onPageReturn, pageVisible } from "../force5/src/pageLife";
import { shouldRevalidate } from "../force5/src/revalidate";
import { spotSeries } from "../force5/src/series";
import {
  loadSeaTemperature,
  seaTemperatureForSpot,
  seaTemperatureNote,
  type SeaTemperatureManifest,
  type SpotSeaTemperature,
} from "../force5/src/seaTemperature";
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

const runOf = (manifest: AnyManifest | null) => manifest?.runTime ?? null;
/** Two sweeps that say the same thing, so the chart is not rebuilt for nothing. */
const sameSweep = (
  a: readonly ModelAvailability[],
  b: readonly ModelAvailability[],
) =>
  a.length === b.length &&
  a.every(
    (model, index) =>
      model.id === b[index].id &&
      model.available === b[index].available &&
      runOf(model.manifest) === runOf(b[index].manifest),
  );

/**
 * Availability of every live model. Missing models are a normal state:
 * `availableModels` never throws, and the map keeps working regardless.
 *
 * The sweep repeats on the same five-minute cadence the map model's own
 * revalidation uses, so a tab left open picks up the new runs the chart reads
 * rather than only the one the map draws. `busy` holds it off while the reader
 * is scrubbing or playing; an unchanged sweep keeps the previous array, so the
 * blend is only recomputed when a model has actually published a new run.
 */
/** The model the map opens on (src/App.tsx), which the dock reads first. */
const MAP_MODEL = "harmonie";

export function useModelAvailability(
  busy = false,
  /**
   * The models to sweep. The map's dock reads the wind alone, so it leaves
   * the wave and weather manifests (megabytes of JSON) to the spot page.
   */
  entries = windModels(),
  /**
   * Whether to sweep at all. The map's stars come from the published blend
   * (src/spotBlend.ts), so the manifests are only fetched once something needs
   * them: the blend chart, the model list, a reader's own blend, or no blend
   * published. Once on, it stays on.
   */
  enabled = true,
): {
  models: ModelAvailability[];
  resolved: boolean;
} {
  const [models, setModels] = useState<ModelAvailability[]>([]);
  const [resolved, setResolved] = useState(false);
  const lastCheck = useRef(Date.now());
  const busyNow = useRef(busy);
  busyNow.current = busy;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const commit = (result: ModelAvailability[]) =>
      setModels((previous) =>
        sameSweep(previous, result) ? previous : result,
      );
    const sweep = () =>
      availableModels(controller.signal, entries)
        .then((result) => {
          if (controller.signal.aborted) return;
          commit(result);
          setResolved(true);
        })
        .catch(() => {
          if (!controller.signal.aborted) setResolved(true);
        });
    // The map's own model first, alone. The dock and the map need it before
    // anything else, and asked for at the same moment as the eight others,
    // two and a half megabytes between them, it shared the line with all of
    // them: on a phone the dock waited seconds for a file it could have had in
    // half of one. The rest follow once it is in (or has failed); the sweep
    // then finds it in the manifest cache.
    const lead = entries.find((m) => m.id === MAP_MODEL);
    void (
      lead ? loadAnyManifest(lead.id, controller.signal) : Promise.resolve()
    )
      .catch(() => {})
      .then(() => {
        if (!controller.signal.aborted) void sweep();
      });
    const tick = () => {
      if (
        !shouldRevalidate(
          lastCheck.current,
          Date.now(),
          pageVisible(),
          busyNow.current,
        )
      )
        return;
      lastCheck.current = Date.now();
      void sweep();
    };
    // A minute's heartbeat, so a check that comes due mid-gesture is retried
    // shortly afterwards instead of waiting out another whole interval.
    const timer = window.setInterval(tick, 60000);
    const stopListening = onPageReturn(tick);
    return () => {
      controller.abort();
      clearInterval(timer);
      stopListening();
    };
  }, [enabled]);
  return { models, resolved };
}

/**
 * The wave and surface-weather manifests, read once the dock's extra rows are
 * first opened and kept from then on: megabytes of JSON a reader who never
 * opens them should not pay for.
 */
export function useMarineModels(enabled: boolean): ModelAvailability[] {
  const [models, setModels] = useState<ModelAvailability[]>([]);
  const asked = useRef(false);
  useEffect(() => {
    if (!enabled || asked.current) return;
    asked.current = true;
    availableModels(undefined, [...waveModels(), ...weatherModels()])
      .then(setModels)
      .catch(() => setModels([]));
  }, [enabled]);
  return models;
}

/** A 404: the bundle has not been published, as against failing to arrive. */
const notPublished = (error: unknown) =>
  (error as { status?: number } | null)?.status === 404;

/**
 * The tide and sea-temperature bundles are one file each for the whole coast,
 * so a spot change has no reason to download them again: they are kept for the
 * same five minutes the forecast manifests are. A request is shared and made
 * without the caller's signal, so a spot clicked past mid-request aborts only
 * its own wait; a failure is not kept.
 */
const MARINE_TTL_MS = 5 * 60 * 1000;
function kept<T>(load: () => Promise<T>) {
  let hit: { at: number; value: Promise<T> } | null = null;
  return (signal?: AbortSignal): Promise<T> => {
    if (!hit || Date.now() - hit.at > MARINE_TTL_MS) {
      const value = load();
      hit = { at: Date.now(), value };
      value.catch(() => {
        if (hit?.value === value) hit = null;
      });
    }
    return abortable(hit.value, signal);
  };
}
/** The tide manifest, shared with the foilable-depth layer (src/useFoilDepth.ts). */
export const tideManifest = kept(() => loadTides());
const seaManifest = kept(() => loadSeaTemperature());
/** A station's curve, per manifest: the files are named by content. */
const tideCurves = new WeakMap<
  TideManifest,
  Map<string, Promise<SpotTide | null>>
>();
function spotTide(
  manifest: TideManifest,
  spotId: string,
  signal: AbortSignal,
): Promise<SpotTide | null> {
  let curves = tideCurves.get(manifest);
  if (!curves) tideCurves.set(manifest, (curves = new Map()));
  let curve = curves.get(spotId);
  if (!curve) {
    const loading = tideForSpot(manifest, spotId);
    curves.set(spotId, (curve = loading));
    loading.catch(() => curves!.delete(spotId));
  }
  return abortable(curve, signal);
}

export interface SeaTemperatureState {
  /** What the nearest reporting station measured, or null when none covers it. */
  observed: SpotSeaTemperature | null;
  manifest: SeaTemperatureManifest | null;
  /** Why there is no observation; a missing manifest is expected, not a fault. */
  note: string | null;
  loading: boolean;
}

const NO_SEA_TEMPERATURE: SeaTemperatureState = {
  observed: null,
  manifest: null,
  note: null,
  loading: false,
};

/**
 * The nearest station's water temperature for a named spot, on the same fetch
 * discipline as the tides: one manifest, aborted with the spot, and a 404 is an
 * absence with a reason rather than an error anybody is shown. The Sea row falls
 * back to the model's skin temperature when this says no.
 */
export function useSpotSeaTemperature(
  spotId: string | undefined,
): SeaTemperatureState {
  const [state, setState] = useState<SeaTemperatureState>(() =>
    spotId ? { ...NO_SEA_TEMPERATURE, loading: true } : NO_SEA_TEMPERATURE,
  );
  useEffect(() => {
    if (!spotId) {
      setState(NO_SEA_TEMPERATURE);
      return;
    }
    const controller = new AbortController();
    // Another spot's station must not be shown under this one while it loads.
    setState({ ...NO_SEA_TEMPERATURE, loading: true });
    seaManifest(controller.signal)
      .then((manifest) => {
        if (controller.signal.aborted) return;
        const observed = seaTemperatureForSpot(manifest, spotId);
        setState({
          observed,
          manifest,
          note: observed ? null : seaTemperatureNote(manifest, spotId),
          loading: false,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          observed: null,
          manifest: null,
          // Only a file that is not there is one nobody has published; a
          // timeout or a dropped connection is not the reader's to fix with npm.
          note: notPublished(error)
            ? "Sea temperature observations are not published yet. Run npm run sea:refresh."
            : "Sea temperature observations are unavailable.",
          loading: false,
        });
      });
    return () => controller.abort();
  }, [spotId]);
  return state;
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
    // Nor another spot's tide curve, station or credit.
    setState({ tide: null, manifest: null, error: null, loading: true });
    (async () => {
      const manifest = await tideManifest(controller.signal);
      const tide = await spotTide(manifest, spotId, controller.signal);
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
          error: notPublished(error)
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
    // The preferred source first; one whose run is over (nothing on these
    // columns) gives way to the next that has something to say.
    let left = [...waves];
    while (left.length) {
      const source = preferredWaveSource(left, spotId);
      if (!source) break;
      const columns = waveAtAxis(source.series, axis);
      if (columns.some(Boolean) || !axis.length)
        return { source, published: true, columns };
      left = left.filter((m) => m !== source.manifest);
    }
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
    let left = [...published];
    while (left.length) {
      const source = preferredWeatherSource(left, spotId);
      if (!source) break;
      const columns = weatherAtAxis(source.series, axis);
      if (columns.some(Boolean) || !axis.length)
        return { source, published: true, columns };
      left = left.filter((m) => m !== source.manifest);
    }
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
  /**
   * The same statistics with each ensemble counted once, as its member mean,
   * and each model at its grid's weight: the consensus the stars rate, and the
   * one the forecast server reports.
   */
  consensus: HourStats[];
  /** Mean bearing per axis hour across the contributing models. */
  directions: (number | null)[];
  /** Models that actually contributed a line, in registry order. */
  contributing: string[];
  manifests: Manifest[];
}

const EMPTY: Blend = {
  lines: [],
  stats: [],
  consensus: [],
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
    const times = axis.map((time) => Date.parse(time));
    const weightAt = (manifest: (typeof usable)[number], at: number) =>
      modelWeight(
        manifest.model,
        leadHours(manifest.runTime, times[at]),
        manifest.resolutionKm,
      );
    const byId = new Map(usable.map((manifest) => [manifest.model, manifest]));
    const weightOf = (model: string, at: number) =>
      weightAt(byId.get(model)!, at);
    // How far ahead each hour is: from the newest run that has it.
    const runs = new Map(
      usable.map((manifest) => [manifest.model, Date.parse(manifest.runTime)]),
    );
    const leadOf = (at: number) =>
      leadHours(
        Math.max(
          ...lines
            .filter((line) => line.speed[at] !== null)
            .map((line) => runs.get(line.model)!),
        ),
        times[at],
      );
    return {
      lines,
      stats: blendStats(lines, axis, undefined, leadOf),
      consensus: blendStats(perModelLines(lines), axis, weightOf, leadOf),
      directions: meanDirections(
        usable.map((manifest) =>
          axisVectors(spotSeries(manifest, spotId)!, axis),
        ),
        axis.length,
        (model, at) => weightAt(usable[model], at),
      ),
      contributing: Array.from(new Set(lines.map((line) => line.model))),
      manifests: usable,
    };
    // axisKey stands in for the axis array, which is rebuilt every render.
  }, [manifests, spotId, axisKey]);
}
