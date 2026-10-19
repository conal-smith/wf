import { useEffect, useMemo, useState } from "react";
import type { ModelAvailability } from "../force5/src/manifests";
import { sampledSeries, withPointSeries } from "../force5/src/series";
import { samplePoint } from "../force5/src/tiledField";
import { pointReadQueue } from "../force5/src/timeline";
import type { Wind } from "../force5/src/weather";

/** Reads in flight at once, across every model: the map's own tiles come first. */
const WORKERS = 4;
/** Points whose reads are kept, so going back to the table and the blend again costs nothing. */
const KEPT_POINTS = 3;

interface Read {
  values: (Wind | null)[];
  done: boolean[];
}
/** What has been read, per model run and point: `${model}/${run}/${lon}/${lat}`. */
const reads = new Map<string, Read>();
const pointsKept: string[] = [];

function readFor(key: string, frames: number, point: string): Read {
  let read = reads.get(key);
  if (!read) {
    read = {
      values: Array.from({ length: frames }, () => null),
      done: Array.from({ length: frames }, () => false),
    };
    reads.set(key, read);
  }
  // The last few points' reads are kept; an older point's go.
  if (!pointsKept.includes(point)) {
    pointsKept.push(point);
    while (pointsKept.length > KEPT_POINTS) {
      const gone = pointsKept.shift()!;
      for (const k of reads.keys()) if (k.endsWith(`/${gone}`)) reads.delete(k);
    }
  }
  return read;
}

export interface PointModels {
  /** The models, each wind manifest carrying the point's series (`POINT_SERIES_ID`). */
  models: ModelAvailability[];
  pending: boolean;
}

const NONE: PointModels = { models: [], pending: false };

/**
 * Every given wind model's wind at a tapped point, for the blend: a point has
 * no published series, so each run's map frames are sampled at it, one tile an
 * hour as `usePointSeries` reads the map model's (tiles the map already holds
 * are read from its cache, and the reads fill no cache of their own). Only the
 * frames inside the dock's hours are asked for, a model at a time in turn and
 * four at once, so every line fills in together; the caller asks only while
 * the blend is the view. What has been read is kept for the last few points.
 */
export function usePointModels(
  models: readonly ModelAvailability[],
  point: { lat: number; lon: number } | null,
  axis: readonly string[],
): PointModels {
  const winds = useMemo(
    () => models.filter((model) => model.wind?.frames.length),
    [models],
  );
  const at = point ? `${point.lon}/${point.lat}` : "";
  const keys = useMemo(
    () => winds.map((model) => `${model.id}/${model.wind!.run}/${at}`),
    [winds, at],
  );
  const from = axis.length ? Date.parse(axis[0]) : NaN;
  const to = axis.length ? Date.parse(axis[axis.length - 1]) : NaN;
  const asked = `${keys.join("|")}@${from}-${to}`;
  const [version, setVersion] = useState(0);
  // Which question the reads are for: until its effect has run, a new one
  // is pending rather than answered with nothing.
  const [state, setState] = useState({ asked: "", pending: false });
  const setPending = (pending: boolean) => setState({ asked, pending });

  useEffect(() => {
    if (!point || !winds.length || !Number.isFinite(from)) {
      setPending(false);
      return;
    }
    let cancelled = false;
    const runs = winds.map((model, i) =>
      readFor(keys[i], model.wind!.frames.length, at),
    );
    const queue = pointReadQueue(
      winds.map((model, i) => ({
        frames: model.wind!.frames,
        done: runs[i].done,
      })),
      from,
      to,
    );
    if (!queue.length) {
      setPending(false);
      setVersion((v) => v + 1);
      return;
    }
    setPending(true);
    // One repaint a frame, not one per file (usePointSeries).
    let queued = 0;
    const publish = () => {
      if (cancelled || queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        if (!cancelled) setVersion((v) => v + 1);
      });
    };
    let next = 0;
    const worker = async () => {
      while (!cancelled && next < queue.length) {
        const [run, frame] = queue[next++];
        try {
          runs[run].values[frame] = await samplePoint(
            winds[run].wind!,
            frame,
            point.lat,
            point.lon,
            { keep: false },
          );
          runs[run].done[frame] = true;
        } catch {
          // Left unread: the next time the blend is asked for, it is tried again.
        }
        publish();
      }
    };
    void Promise.all(Array.from({ length: WORKERS }, worker)).then(() => {
      if (cancelled) return;
      cancelAnimationFrame(queued);
      setPending(false);
      setVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(queued);
    };
    // The keys carry each run and the point; the axis's ends are its hours.
  }, [asked]);

  return useMemo(() => {
    if (!point || !winds.length) return NONE;
    return {
      models: winds.map((model, i) => {
        const read = reads.get(keys[i]);
        const wind = withPointSeries(
          model.wind!,
          read ? sampledSeries(model.wind!.frames, read.values) : null,
        );
        return { ...model, manifest: wind, wind };
      }),
      pending: state.asked !== asked || state.pending,
    };
  }, [winds, keys, version, state, asked, !!point]);
}
