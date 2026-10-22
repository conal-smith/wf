import { useEffect, useRef, useState } from "react";
import { expireManifest, loadManifest } from "../force5/src/manifests";
import { samplePoint } from "../force5/src/tiledField";
import type { Manifest, Point, Wind } from "../force5/src/weather";
import {
  handedFrames,
  loadOrder,
  type HandedStretch,
} from "../force5/src/timeline";

/** A run the map hands over to past the reader's, read at the point. */
export interface HandedSeries {
  manifest: Manifest;
  values: (Wind | null | undefined)[];
  /** The stretches of the dock's columns this run's wind stands for. */
  stretches: readonly HandedStretch[];
}

export interface PointSeries {
  /** Identifies the model run and position the values belong to. */
  key: string;
  values: (Wind | null | undefined)[];
  /**
   * Past the end of the reader's run, the runs the map hands over to, each
   * read at the point over the columns it stands for; empty for a named spot.
   */
  handed: readonly HandedSeries[];
  /** True when the manifest already publishes a series for this spot. */
  named: boolean;
  pending: boolean;
  /**
   * The reader's own run's hours that could not be read. A handed run's are
   * not counted: the hook asks for that run's manifest again itself, and the
   * reader's run is the one a caller would look for a newer copy of.
   */
  failures: number;
  retry: () => void;
}

const EMPTY: (Wind | null | undefined)[] = [];
const NO_STRETCHES: readonly HandedStretch[] = [];
const NO_RUNS: readonly HandedSeries[] = [];

/** One run's readings at one point, kept while the point is. */
interface Readings {
  values: (Wind | null)[];
  done: boolean[];
}

/**
 * The selected position's series: the precomputed one for a named spot whose
 * square is merged into the manifest, otherwise sampled from the map frames
 * progressively — the one native tile holding the point, for each hour — two
 * requests at a time, with a retry. Lifted out of `ForecastSheet` so every dock view — and
 * the scrubber's colours — read the same values.
 *
 * A bare point costs one tile per forecast hour, so the order matters more than
 * the total: `loadOrder` starts at the hour the reader is looking at and, for a
 * run finer than three-hourly, takes every third hour before filling the rest
 * in. The table is readable long before the last file lands.
 *
 * Past the end of the reader's run the point is read from the runs the map
 * hands over to there (`handovers`, from `pointHandovers`), as a spot's hours
 * go on in ECMWF's past HARMONIE's: only the frames those stretches need, and
 * in turns with the reader's own, so the far hours fill in alongside the near.
 */
export function usePointSeries(
  manifest: Manifest | null,
  point: Point | null,
  handovers: readonly HandedStretch[] = NO_STRETCHES,
): PointSeries {
  const [samples, setSamples] = useState<{
    key: string;
    values: (Wind | null)[];
    handed: readonly HandedSeries[];
    failures: number;
    /** The handed runs' hours that could not be read. */
    handedFailures: number;
    pending: boolean;
  }>({
    key: "",
    values: [],
    handed: NO_RUNS,
    failures: 0,
    handedFailures: 0,
    pending: false,
  });
  const [retry, setRetry] = useState(0);
  /** Asks for the handed runs' manifests again, past the cache's minutes. */
  const [reload, setReload] = useState(0);
  const key =
    manifest && point
      ? `${manifest.model}/${manifest.run}/${point.lon}/${point.lat}`
      : "";
  // Only from a manifest the caller has merged the spot's square into
  // (`loadSpots`); the map's own pointer carries no spot data, so a bare point
  // and a spot whose square was not read are both sampled from the frames.
  const named =
    manifest && point?.id ? manifest.spotForecasts?.[point.id] : undefined;
  // Said as a string, so a clock tick that works out the same stretches again
  // starts nothing: a series that restarted every minute would never finish.
  const handedKey =
    named || !key
      ? ""
      : handovers.map(({ model, from, to }) => `${model}@${from}-${to}`).join();
  const ids = handedKey
    ? [...new Set(handovers.map(({ model }) => model))].join()
    : "";

  /* ---- the runs handed over to, through the manifest cache ---- */
  const [runs, setRuns] = useState<{
    ids: string;
    manifests: readonly Manifest[];
    failed: number;
  }>({ ids: "", manifests: [], failed: 0 });
  useEffect(() => {
    if (!ids) return;
    const controller = new AbortController();
    // The map has usually read the same manifest for its own hand-over, and
    // the cache gives it straight back.
    void Promise.allSettled(
      ids.split(",").map((id) => loadManifest(id, controller.signal)),
    ).then((settled) => {
      if (controller.signal.aborted) return;
      setRuns({
        ids,
        manifests: settled.flatMap((s) =>
          s.status === "fulfilled" ? [s.value] : [],
        ),
        failed: settled.filter((s) => s.status === "rejected").length,
      });
    });
    return () => controller.abort();
  }, [ids, retry, reload]);
  const handedRuns = ids && runs.ids === ids ? runs.manifests : [];
  const runsKey = handedRuns.map((m) => `${m.model}/${m.run}`).join();
  const runsFailed = ids && runs.ids === ids ? runs.failed : 0;

  /**
   * Each run's hours already read at the point, by run and position: a retry,
   * or a hand-over's run found after the point was chosen, asks only for the
   * rest. Dropped once the point or the run is no longer the one in hand.
   */
  const read = useRef(new Map<string, Readings>());

  useEffect(() => {
    if (named || !manifest || !point) return;
    let cancelled = false;
    const kept = read.current;
    const inUse = new Set<string>();
    // A retry keeps what it has: the table stays filled in, and only the hours
    // that failed are fetched again rather than the whole run.
    const readings = (run: Manifest): Readings => {
      const at = `${run.model}/${run.run}/${point.lon}/${point.lat}`;
      inUse.add(at);
      let found = kept.get(at);
      if (!found) {
        found = {
          values: run.frames.map(() => null),
          done: run.frames.map(() => false),
        };
        kept.set(at, found);
      }
      return found;
    };
    const own = readings(manifest);
    const handed = handedRuns.map((run) => {
      const stretches = handovers.filter(({ model }) => model === run.model);
      return { run, stretches, readings: readings(run) };
    });
    for (const at of [...kept.keys()]) if (!inUse.has(at)) kept.delete(at);
    // Read once, when the point is chosen: a series that restarted every time
    // the clock ticked would never finish.
    const now = Date.now();
    const queues = [
      {
        run: manifest,
        readings: own,
        order: loadOrder(manifest.frames, now).filter((i) => !own.done[i]),
      },
      ...handed.map(({ run, stretches, readings }) => {
        const wanted = new Set(handedFrames(run.frames, stretches));
        return {
          run,
          readings,
          order: loadOrder(run.frames, now).filter(
            (i) => wanted.has(i) && !readings.done[i],
          ),
        };
      }),
    ];
    // Taken in turns, so the hours past the reader's run fill in alongside
    // its own rather than after every one of them.
    const jobs: { run: Manifest; readings: Readings; index: number }[] = [];
    const longest = Math.max(...queues.map(({ order }) => order.length));
    for (let i = 0; i < longest; i++)
      for (const { run, readings, order } of queues)
        if (i < order.length) jobs.push({ run, readings, index: order[i] });
    let next = 0;
    let failures = 0;
    let handedFailures = 0;
    const snapshot = (pending: boolean) => ({
      key,
      values: [...own.values],
      handed: handed.map(({ run, stretches, readings }) => ({
        manifest: run,
        values: [...readings.values],
        stretches,
      })),
      failures,
      handedFailures,
      pending,
    });
    setSamples(snapshot(true));
    // One repaint a frame, not one per file. Every sample used to publish a new
    // array, and the dock rebuilt a hundred and more columns eighty-five times
    // over for a single click; the reader cannot see eighty-five paints anyway.
    let queued = 0;
    const publish = () => {
      if (cancelled || queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        if (!cancelled) setSamples(snapshot(true));
      });
    };
    const worker = async () => {
      while (!cancelled && next < jobs.length) {
        const { run, readings, index } = jobs[next++];
        try {
          readings.values[index] = await samplePoint(
            run,
            index,
            point.lat,
            point.lon,
            { keep: false },
          );
          readings.done[index] = true;
        } catch {
          if (run === manifest) failures++;
          else handedFailures++;
        }
        publish();
      }
    };
    // Bound downloads, stop queueing on selection changes, and never reuse old point readings.
    void Promise.all([worker(), worker()]).then(() => {
      if (cancelled) return;
      cancelAnimationFrame(queued);
      queued = 0;
      setSamples(snapshot(false));
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(queued);
    };
  }, [manifest, named, key, retry, handedKey, runsKey]);

  const current = samples.key === key;
  // A handed run whose hours or manifest could not be read may have been
  // replaced, its directory deleted: its manifest is asked for again, past
  // the cache, once for each run in hand, so a run that is simply missing a
  // file is not asked for over and over.
  const asked = useRef("");
  const settled = current && !samples.pending;
  const handedFailed =
    settled && (samples.handedFailures > 0 || runsFailed > 0);
  useEffect(() => {
    const at = `${key}|${ids}|${runsKey}`;
    if (!handedFailed || asked.current === at) return;
    asked.current = at;
    for (const id of ids.split(",")) expireManifest(id);
    setReload((value) => value + 1);
  }, [handedFailed, key, ids, runsKey]);
  return {
    key,
    values: named || (current ? samples.values : EMPTY),
    handed: named || !current ? NO_RUNS : samples.handed,
    named: !!named,
    // The handed runs' manifests still on their way count as reading.
    pending:
      !named && current && (samples.pending || (!!ids && runs.ids !== ids)),
    failures: named ? 0 : current ? samples.failures : 0,
    retry: () => setRetry((value) => value + 1),
  };
}
