import { useEffect, useState } from "react";
import {
  loadFrame,
  sample,
  type Manifest,
  type Point,
  type Wind,
} from "../force5/src/weather";

export interface PointSeries {
  /** Identifies the model run and position the values belong to. */
  key: string;
  values: (Wind | null | undefined)[];
  /** True when the manifest already publishes a series for this spot. */
  named: boolean;
  pending: boolean;
  failures: number;
  retry: () => void;
}

const EMPTY: (Wind | null | undefined)[] = [];

/**
 * The selected position's series: the manifest's precomputed one for a named
 * spot, otherwise sampled from the map frames progressively, two requests at a
 * time, with a retry. Lifted out of `ForecastSheet` so every dock view — and
 * the scrubber's colours — read the same values.
 */
export function usePointSeries(manifest: Manifest, point: Point): PointSeries {
  const [samples, setSamples] = useState<{
    key: string;
    values: (Wind | null)[];
    failures: number;
    pending: boolean;
  }>({ key: "", values: [], failures: 0, pending: false });
  const [retry, setRetry] = useState(0);
  const key = `${manifest.model}/${manifest.run}/${point.lon}/${point.lat}`;
  const named = point.id ? manifest.spotForecasts[point.id] : undefined;

  useEffect(() => {
    if (named) return;
    let cancelled = false;
    let next = 0;
    const result: (Wind | null)[] = manifest.frames.map(() => null);
    let failures = 0;
    setSamples({ key, values: result, failures: 0, pending: true });
    const worker = async () => {
      while (!cancelled && next < manifest.frames.length) {
        const i = next++;
        try {
          result[i] = sample(
            await loadFrame(manifest, i),
            point.lon,
            point.lat,
          );
        } catch {
          failures++;
        }
        if (!cancelled)
          setSamples({ key, values: [...result], failures, pending: true });
      }
    };
    // Bound downloads, stop queueing on selection changes, and never reuse old point readings.
    void Promise.all([worker(), worker()]).then(() => {
      if (!cancelled)
        setSamples({ key, values: [...result], failures, pending: false });
    });
    return () => {
      cancelled = true;
    };
  }, [manifest, named, key, point.lon, point.lat, retry]);

  return {
    key,
    values: named || (samples.key === key ? samples.values : EMPTY),
    named: !!named,
    pending: !named && samples.key === key && samples.pending,
    failures: named ? 0 : samples.key === key ? samples.failures : 0,
    retry: () => setRetry((value) => value + 1),
  };
}
