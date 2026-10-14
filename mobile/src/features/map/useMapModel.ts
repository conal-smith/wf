/**
 * The wind the chart draws: one model's run (HARMONIE until the rider picks
 * another), and its frame for the hour chosen, as the site's map loads them
 * (src/App.tsx): the frame follows the hour a little behind a fast scrub, a
 * frame that cannot be read looks for a newer run, and a model switch is one
 * transaction that leaves the old model drawn until the new one is whole.
 *
 * Past the run's last hour the frame stays the nearest one, and `reachable`
 * names the model whose run reaches the hour, for the chart to offer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { loadManifest } from "../../../../force5/src/manifests";
import { loadModel, MODELS, type ModelId } from "../../../../force5/src/models";
import { REVALIDATE_MS, runLabel } from "../../../../force5/src/revalidate";
import { loadFrame } from "../../../../force5/src/tiledField";
import { frameForTime } from "../../../../force5/src/timeline";
import {
  dayLabel,
  freshness,
  nearestFrame,
  timeLabel,
  type Frame,
  type Manifest,
} from "../../../../force5/src/weather";
import { loadNewerRun } from "../../../../src/useRunRefresh";
import { useForecast } from "../../data/forecast";

/** Follows a value at most every `ms` while it keeps changing, then settles on it. */
function useThrottled<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const wait = last.current + ms - Date.now();
    if (wait <= 0) {
      last.current = Date.now();
      setOut(value);
      return;
    }
    const timer = setTimeout(() => {
      last.current = Date.now();
      setOut(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return out;
}

export interface MapModel {
  manifest: Manifest | null;
  frame: Frame | null;
  /** Loading the frame for the hour, or a model. */
  loading: boolean;
  pendingModel: ModelId | null;
  /** One line for the chart: a switch in flight, an error, a notice; else null. */
  status: { text: string; error: boolean } | null;
  /** "06:00 UTC". */
  run: string | null;
  staleness: "fresh" | "stale" | "expired";
  /** The hour is past this run: the model whose run reaches it, if any. */
  reachable: (typeof MODELS)[number] | null;
  beyond: boolean;
  chooseModel: (id: ModelId, wanted?: string) => void;
  cancel: () => void;
  retry: () => void;
  dismiss: () => void;
  /**
   * A tile the view needs could not be read: the run may have been replaced
   * and its directory deleted. Looks for a newer run, once a run (src/App.tsx
   * `recoverRun`).
   */
  recover: (frame: Frame) => void;
}

export function useMapModel(): MapModel {
  const { strip, selected } = useForecast();
  const column = strip[selected];
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [pendingModel, setPendingModel] = useState<ModelId | null>(null);
  const [modelError, setModelError] = useState("");
  const [modelNotice, setModelNotice] = useState("");
  /** A frame's failure, under the request it was for: a new hour asked for clears it. */
  const [frameFailure, setFrameFailure] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const epoch = useRef(0);
  const request = useRef<AbortController | null>(null);

  /* ---- the first run: HARMONIE's ---- */
  useEffect(() => {
    const controller = new AbortController();
    loadManifest("harmonie", controller.signal)
      .then((m) => {
        if (!controller.signal.aborted) setManifest(m);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFrameFailure({ key: "", message: "The wind could not be loaded." });
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (!modelNotice) return;
    const timer = setTimeout(() => setModelNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [modelNotice]);
  useEffect(() => () => request.current?.abort(), []);

  /* ---- the frame follows the hour ---- */
  const mapTime = useThrottled(column?.validTime ?? null, 200) ?? column?.validTime ?? null;
  const paintedIndex = manifest && frame ? manifest.frames.findIndex((f) => f.hour === frame.hour) : -1;
  const requestedIndex =
    manifest && mapTime
      ? (frameForTime(manifest.frames, Date.parse(mapTime)) ??
        (paintedIndex >= 0 ? paintedIndex : nearestFrame(manifest.frames, Date.parse(mapTime))))
      : 0;

  const commit = useCallback((next: { manifest: Manifest; frame: Frame }, notice?: string) => {
    epoch.current++;
    setManifest(next.manifest);
    setFrame(next.frame);
    setFrameFailure(null);
    setModelError("");
    if (notice) setModelNotice(notice);
  }, []);

  const requestKey = manifest ? `${manifest.model}|${manifest.base}|${requestedIndex}|${attempt}` : "";
  useEffect(() => {
    if (!manifest || pendingModel || !mapTime) return;
    const controller = new AbortController();
    const at = epoch.current;
    const current = () => !controller.signal.aborted && at === epoch.current;
    const key = `${manifest.model}|${manifest.base}|${requestedIndex}|${attempt}`;
    loadFrame(manifest, requestedIndex)
      .then((data) => {
        if (!current()) return;
        setFrame(data);
        if (requestedIndex + 1 < manifest.frames.length)
          void loadFrame(manifest, requestedIndex + 1, { base: false }).catch(() => {});
      })
      .catch(async (e: unknown) => {
        if (!current()) return;
        // The run may have been replaced and its directory deleted.
        const swap = await loadNewerRun(manifest, manifest.frames[requestedIndex].validTime, controller.signal).catch(
          () => null,
        );
        if (!current()) return;
        if (swap) return commit(swap, `Updated to the ${runLabel(swap.manifest.runTime)} run.`);
        setFrameFailure({ key, message: e instanceof Error ? e.message : "This hour's wind could not be loaded." });
      });
    return () => controller.abort();
  }, [manifest, requestedIndex, pendingModel, mapTime, attempt, commit]);

  /* ---- a newer run, when the app comes back to it ---- */
  const latest = useRef({ manifest, mapTime, pendingModel });
  useEffect(() => {
    latest.current = { manifest, mapTime, pendingModel };
  });
  useEffect(() => {
    let checked = Date.now();
    const sub = AppState.addEventListener("change", (state) => {
      const { manifest: m, mapTime: time, pendingModel: busy } = latest.current;
      if (state !== "active" || !m || !time || busy || Date.now() - checked < REVALIDATE_MS) return;
      checked = Date.now();
      const at = epoch.current;
      loadNewerRun(m, time, new AbortController().signal)
        .then((swap) => {
          if (swap && at === epoch.current) commit(swap, `Updated to the ${runLabel(swap.manifest.runTime)} run.`);
        })
        .catch(() => {});
    });
    return () => sub.remove();
  }, [commit]);

  /* ---- choosing a model ---- */
  const chooseModel = useCallback(
    (id: ModelId, wanted?: string) => {
      if (!manifest || !frame || (id === manifest.model && !wanted)) return;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      epoch.current++;
      setPendingModel(id);
      setModelError("");
      setModelNotice("");
      setFrameFailure(null);
      const target = wanted ?? mapTime ?? frame.validTime;
      loadModel(id, target, controller.signal)
        .then((next) => {
          if (controller.signal.aborted) return;
          setManifest(next.manifest);
          setFrame(next.frame);
          if (Math.abs(Date.parse(next.frame.validTime) - Date.parse(target)) > 3600000)
            setModelNotice(
              `${next.manifest.modelName} on the map from ${dayLabel(next.frame.validTime)} ${timeLabel(next.frame.validTime)}.`,
            );
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          setModelError(
            `Could not switch to ${MODELS.find((m) => m.id === id)?.name}. ${manifest.modelName} is still shown.${e instanceof Error ? ` ${e.message}` : ""}`,
          );
        })
        .finally(() => {
          if (request.current === controller) setPendingModel(null);
        });
    },
    [manifest, frame, mapTime],
  );

  const tried = useRef(new Set<string>());
  const recover = useCallback(
    (failed: Frame) => {
      const shown = manifest;
      const time = mapTime ?? failed.validTime;
      if (!shown || pendingModel || failed.model !== shown.model || failed.run !== shown.run) return;
      if (tried.current.has(shown.base)) return;
      tried.current.add(shown.base);
      const at = epoch.current;
      loadNewerRun(shown, time, new AbortController().signal)
        .then((swap) => {
          if (swap && at === epoch.current) commit(swap, `Updated to the ${runLabel(swap.manifest.runTime)} run.`);
        })
        .catch(() => {});
    },
    [manifest, mapTime, pendingModel, commit],
  );

  const cancel = useCallback(() => {
    request.current?.abort();
    setPendingModel(null);
  }, []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const dismiss = useCallback(() => {
    setModelError("");
    setModelNotice("");
  }, []);

  /* ---- the run that reaches the hour, when the map's does not ---- */
  const beyond = !!manifest && !!column && frameForTime(manifest.frames, column.time) === null;
  const reachable = beyond && column ? (MODELS.find((m) => m.id === column.model) ?? null) : null;

  const activeIndex = paintedIndex >= 0 ? paintedIndex : requestedIndex;
  const loading = !!manifest && (!frame || activeIndex !== requestedIndex);
  const frameError = frameFailure && (frameFailure.key === requestKey || !manifest) ? frameFailure.message : "";
  const status = useMemo(() => {
    if (pendingModel) return { text: `Loading ${MODELS.find((m) => m.id === pendingModel)?.name ?? "the model"}…`, error: false };
    if (modelError) return { text: modelError, error: true };
    if (modelNotice) return { text: modelNotice, error: false };
    if (frameError) return { text: frameError, error: true };
    return null;
  }, [pendingModel, modelError, modelNotice, frameError]);

  return {
    manifest,
    frame,
    loading,
    pendingModel,
    status,
    run: manifest ? runLabel(manifest.runTime) : null,
    staleness: manifest ? freshness(manifest) : "fresh",
    reachable,
    beyond,
    chooseModel,
    cancel,
    retry,
    dismiss,
    recover,
  };
}
