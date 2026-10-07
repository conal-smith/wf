import { useEffect, useRef, useState } from "react";
import {
  loadFrame,
  sample,
  type Manifest,
  type Point,
  type Wind,
} from "../force5/src/weather";
import { loadOrder } from "../force5/src/timeline";

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
 *
 * A bare point costs one file per forecast hour, so the order matters more than
 * the total: `loadOrder` starts at the hour the reader is looking at and, for a
 * run finer than three-hourly, takes every third hour before filling the rest
 * in. The table is readable long before the last file lands.
 */
export function usePointSeries(
  manifest: Manifest | null,
  point: Point | null,
): PointSeries {
  const [samples, setSamples] = useState<{
    key: string;
    values: (Wind | null)[];
    failures: number;
    pending: boolean;
  }>({ key: "", values: [], failures: 0, pending: false });
  const [retry, setRetry] = useState(0);
  const key =
    manifest && point
      ? `${manifest.model}/${manifest.run}/${point.lon}/${point.lat}`
      : "";
  const named =
    manifest && point?.id ? manifest.spotForecasts[point.id] : undefined;
  /** The hours already read for a key, so a retry asks only for the rest. */
  const read = useRef<{
    key: string;
    values: (Wind | null)[];
    done: boolean[];
  }>({ key: "", values: [], done: [] });

  useEffect(() => {
    if (named || !manifest || !point) return;
    let cancelled = false;
    let next = 0;
    // A retry keeps what it has: the table stays filled in, and only the hours
    // that failed are fetched again rather than the whole run.
    const again = read.current.key === key;
    const result: (Wind | null)[] = again
      ? [...read.current.values]
      : manifest.frames.map(() => null);
    const done: boolean[] = again
      ? [...read.current.done]
      : manifest.frames.map(() => false);
    read.current = { key, values: result, done };
    // Read once, when the point is chosen: a series that restarted every time
    // the clock ticked would never finish.
    const order = loadOrder(manifest.frames, Date.now()).filter(
      (i) => !done[i],
    );
    let failures = 0;
    setSamples({ key, values: [...result], failures: 0, pending: true });
    // One repaint a frame, not one per file. Every sample used to publish a new
    // array, and the dock rebuilt a hundred and more columns eighty-five times
    // over for a single click; the reader cannot see eighty-five paints anyway.
    let queued = 0;
    const publish = () => {
      if (cancelled || queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        if (!cancelled)
          setSamples({ key, values: [...result], failures, pending: true });
      });
    };
    const worker = async () => {
      while (!cancelled && next < order.length) {
        const i = order[next++];
        try {
          result[i] = sample(
            await loadFrame(manifest, i, { keep: false }),
            point.lon,
            point.lat,
          );
          done[i] = true;
        } catch {
          failures++;
        }
        publish();
      }
    };
    // Bound downloads, stop queueing on selection changes, and never reuse old point readings.
    void Promise.all([worker(), worker()]).then(() => {
      if (cancelled) return;
      cancelAnimationFrame(queued);
      queued = 0;
      setSamples({ key, values: [...result], failures, pending: false });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(queued);
    };
  }, [manifest, named, key, retry]);

  return {
    key,
    values: named || (samples.key === key ? samples.values : EMPTY),
    named: !!named,
    pending: !named && samples.key === key && samples.pending,
    failures: named ? 0 : samples.key === key ? samples.failures : 0,
    retry: () => setRetry((value) => value + 1),
  };
}
