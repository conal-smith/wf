/**
 * The wind the chart draws: one model's run (HARMONIE until the rider picks
 * another), and its frame for the hour chosen, as the site's map loads them
 * (src/App.tsx): the frame follows the hour a little behind a fast scrub, a
 * frame that cannot be read looks for a newer run, and a model switch is one
 * transaction that leaves the old model drawn until the new one is whole.
 *
 * Past either end of the rider's run the chart hands over, as the site's map
 * does: it draws the model the strip's column at that hour comes from (ECMWF
 * past HARMONIE, or GFS), says so, and goes back to the rider's model as soon
 * as the hour is inside its run again. The rider's choice is never changed by
 * it. Only where no run the chart can draw reaches the hour does the frame
 * stay the nearest one, and `reachable` name the model to offer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { loadManifest, MANIFEST_REVALIDATE_MS } from "../../../../force5/src/manifests";
import { loadModel, MAP_MODEL_IDS, MODELS, type ModelId } from "../../../../force5/src/models";
import { REVALIDATE_MS, runLabel } from "../../../../force5/src/revalidate";
import { loadFrame } from "../../../../force5/src/tiledField";
import { frameForTime, handoverModel, handoverStart, mapReach } from "../../../../force5/src/timeline";
import {
  freshness,
  nearestFrame,
  type Frame,
  type Manifest,
} from "../../../../force5/src/weather";
import { nearestColumn } from "../../../../src/strip";
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
  /**
   * The hour is past the rider's run and nothing is handed over: the model
   * whose run reaches it, if any, for the chart to offer.
   */
  reachable: (typeof MODELS)[number] | null;
  /** The hour is past either end of the rider's run. */
  beyond: boolean;
  /**
   * The run drawn in the rider's place past the end of theirs, once it is
   * drawn or on its way: its name, and from when (or, before the rider's run,
   * until when) its wind is the chart's.
   */
  handover: Handover | null;
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

/** The run the chart hands its wind to, as the label names it. */
export interface Handover {
  /** "ECMWF". */
  name: string;
  side: "before" | "after";
  /** The first column its wind is drawn at (after), or the rider's first (before). */
  at: number | null;
  staleness: "fresh" | "stale" | "expired";
}

export function useMapModel(): MapModel {
  const { strip, selected, columnModels, now } = useForecast();
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
  const mapAt = mapTime ? Date.parse(mapTime) : NaN;
  const mapIndex = strip.length && mapTime ? nearestColumn(strip, mapAt) : -1;
  const mapColumn = strip[mapIndex];

  /* ---- past the rider's run, the run that covers the hour ---- */
  // A run whose manifest could not be read is passed over for five minutes,
  // the manifest cache's own span, so the next run that covers the hour (GFS,
  // past ECMWF) is drawn rather than nothing; after that it is asked again.
  const [handoverFailed, setHandoverFailed] = useState<ReadonlyMap<string, number>>(() => new Map());
  /**
   * The model the chart hands over to where the rider's run does not reach
   * the hour: the one the strip's column there comes from (the site's
   * `handoverModel`, as its map uses it). The rider's choice stays `manifest`.
   */
  const handoverId = useMemo(
    () =>
      manifest
        ? handoverModel(
            columnModels.filter(
              (model) => !(now - (handoverFailed.get(model.id) ?? -Infinity) < MANIFEST_REVALIDATE_MS),
            ),
            MAP_MODEL_IDS,
            { id: manifest.model, frames: manifest.frames },
            mapAt,
            mapColumn,
            now,
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnModels, manifest, mapAt, mapColumn?.model, now, handoverFailed],
  );
  // Kept once loaded, so a scrub back and forth across the seam swaps between
  // two runs already in hand rather than reading a manifest at every crossing.
  const [handoverRun, setHandoverRun] = useState<Manifest | null>(null);
  useEffect(() => {
    if (!handoverId) return;
    const controller = new AbortController();
    // Through the manifest cache: the run in hand comes straight back.
    loadManifest(handoverId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setHandoverRun(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setHandoverFailed((failed) => new Map(failed).set(handoverId, Date.now()));
      });
    return () => controller.abort();
  }, [handoverId]);
  const handing =
    handoverId && handoverRun?.model === handoverId && frameForTime(handoverRun.frames, mapAt) !== null
      ? handoverRun
      : null;
  /** The hand-over's run is still on its way: the chart waits for it. */
  const handoverDue = !!handoverId && handoverRun?.model !== handoverId;
  /** The run the chart draws from: the rider's own, or the one handed over to. */
  const mapRun = handing ?? manifest;

  // A frame belongs to one run: an hour of HARMONIE's is not ECMWF's, even
  // where their lead hours match.
  const paintedIndex =
    mapRun && frame && frame.model === mapRun.model && frame.run === mapRun.run
      ? mapRun.frames.findIndex((f) => f.hour === frame.hour)
      : -1;
  const requestedIndex =
    mapRun && mapTime
      ? (frameForTime(mapRun.frames, mapAt) ?? (paintedIndex >= 0 ? paintedIndex : nearestFrame(mapRun.frames, mapAt)))
      : 0;

  const commit = useCallback((next: { manifest: Manifest; frame: Frame }, notice?: string) => {
    epoch.current++;
    setManifest(next.manifest);
    setFrame(next.frame);
    setFrameFailure(null);
    setModelError("");
    if (notice) setModelNotice(notice);
  }, []);
  /** A newer run of the hand-over's model, found after one of its tiles failed. */
  const commitHandover = useCallback((next: { manifest: Manifest; frame: Frame }) => {
    setHandoverRun(next.manifest);
    setFrame(next.frame);
    setFrameFailure(null);
  }, []);

  const requestKey = mapRun ? `${mapRun.model}|${mapRun.base}|${requestedIndex}|${attempt}` : "";
  useEffect(() => {
    if (!mapRun || pendingModel || !mapTime) return;
    const controller = new AbortController();
    const at = epoch.current;
    const current = () => !controller.signal.aborted && at === epoch.current;
    const key = `${mapRun.model}|${mapRun.base}|${requestedIndex}|${attempt}`;
    const own = mapRun === manifest;
    loadFrame(mapRun, requestedIndex)
      .then((data) => {
        if (!current()) return;
        setFrame(data);
        if (requestedIndex + 1 < mapRun.frames.length)
          void loadFrame(mapRun, requestedIndex + 1, { base: false }).catch(() => {});
      })
      .catch(async (e: unknown) => {
        if (!current()) return;
        // The run may have been replaced and its directory deleted.
        const swap = await loadNewerRun(mapRun, mapRun.frames[requestedIndex].validTime, controller.signal).catch(
          () => null,
        );
        if (!current()) return;
        if (swap)
          return own ? commit(swap, `Updated to the ${runLabel(swap.manifest.runTime)} run.`) : commitHandover(swap);
        setFrameFailure({ key, message: e instanceof Error ? e.message : "This hour's wind could not be loaded." });
      });
    return () => controller.abort();
    // The rider's run as well as the drawn one: a newer run of theirs swapped
    // in while the hand-over is drawn replaces the frame, which is asked again.
  }, [mapRun, manifest, requestedIndex, pendingModel, mapTime, attempt, commit, commitHandover]);

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
          // A run that does not reach the time hands it over (`handoverModel`),
          // and the label where the chart names its model says so.
          setManifest(next.manifest);
          setFrame(next.frame);
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
      // The rider's run, or the one handed over to past it.
      const shown = [manifest, handing].find((m) => m && failed.model === m.model && failed.run === m.run);
      const time = mapTime ?? failed.validTime;
      if (!shown || pendingModel) return;
      if (tried.current.has(shown.base)) return;
      tried.current.add(shown.base);
      const at = epoch.current;
      loadNewerRun(shown, time, new AbortController().signal)
        .then((swap) => {
          if (!swap || at !== epoch.current) return;
          if (shown === manifest) commit(swap, `Updated to the ${runLabel(swap.manifest.runTime)} run.`);
          else commitHandover(swap);
        })
        .catch(() => {});
    },
    [manifest, handing, mapTime, pendingModel, commit, commitHandover],
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

  /* ---- the hour past the rider's run: the hand-over, or the run to offer ---- */
  const reach = manifest && mapTime ? mapReach(manifest.frames, mapAt) : null;
  const past = reach && !reach.drawn ? reach : null;
  const beyond = !!past;
  const handoverName =
    past && (handing || handoverDue)
      ? (handing?.modelName ?? MODELS.find((m) => m.id === handoverId)?.name ?? null)
      : null;
  const handoverAt = useMemo(
    () => (handoverName && past ? handoverStart(strip, mapIndex, past) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handoverName, past?.side, past?.edge, mapIndex, strip],
  );
  const handover = useMemo<Handover | null>(
    () =>
      handoverName && past
        ? {
            name: handoverName,
            side: past.side,
            at: handoverAt,
            staleness: handing ? freshness(handing) : "fresh",
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handoverName, past?.side, handoverAt, handing],
  );
  // Only where nothing can be handed over: the chip lets the rider ask for
  // the run the strip's column comes from, if it could not be read by itself.
  const reachable =
    beyond && !handing && !handoverDue && column ? (MODELS.find((m) => m.id === column.model) ?? null) : null;

  const activeIndex = paintedIndex >= 0 ? paintedIndex : requestedIndex;
  const loading = !!mapRun && (!frame || handoverDue || activeIndex !== requestedIndex);
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
    handover,
    chooseModel,
    cancel,
    retry,
    dismiss,
    recover,
  };
}
