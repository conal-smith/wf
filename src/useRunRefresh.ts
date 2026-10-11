import { useEffect, useRef } from "react";
import { expireManifest, loadManifest } from "../force5/src/manifests";
import { MAP_MODEL_IDS, loadModel, type ModelId } from "../force5/src/models";
import {
  REVALIDATE_RETRY_MS,
  revalidateDecision,
} from "../force5/src/revalidate";
import type { Frame, Manifest } from "../force5/src/weather";

export interface RunSwap {
  manifest: Manifest;
  frame: Frame;
  index: number;
}

interface Options {
  /** The run on screen. Null until the first one has loaded. */
  manifest: Manifest | null;
  /** The valid time to keep: the new run opens at the frame nearest it. */
  validTime: string | null;
  /** A model switch is in flight; two transactions must never overlap. */
  switching: boolean;
  playing: boolean;
  /**
   * A newer run, already loaded whole: manifest, frame and index together, for
   * the caller to commit in one React batch exactly as a model switch does.
   */
  onRun: (swap: RunSwap) => void;
}

const isMapModel = (id: string): id is ModelId =>
  (MAP_MODEL_IDS as readonly string[]).includes(id);

/**
 * Whether `fresh`, a pointer just read, moves the map on from the run on
 * screen: a later run, or the same run republished in another run directory
 * (its spot series recomputed: the old directory is deleted after its grace
 * period like any other). An earlier run never does: a CDN edge still holding
 * an old pointer, or a rolled-back one, must not read as "Updated to…" and
 * then flip back on the next check.
 */
export function movesForward(
  current: Pick<Manifest, "runTime" | "base">,
  fresh: Pick<Manifest, "runTime" | "base">,
): boolean {
  const then = Date.parse(current.runTime);
  const now = Date.parse(fresh.runTime);
  return now > then || (now === then && fresh.base !== current.base);
}

/**
 * The newest run of the model on screen, loaded whole at the frame nearest
 * `time`, or null when the pointer still names the run directory on screen or
 * an earlier run (`movesForward`). Refetches the manifest past the five-minute
 * manifest cache, and past the HTTP cache with it.
 */
export async function loadNewerRun(
  current: Manifest,
  time: string,
  signal: AbortSignal,
): Promise<RunSwap | null> {
  const id = current.model;
  // Only a model the map can reopen; anything else has no frames to swap.
  if (!isMapModel(id)) return null;
  expireManifest(id);
  const fresh = await loadManifest(id, signal);
  if (signal.aborted || !movesForward(current, fresh)) return null;
  return loadModel(id, time, signal);
}

/**
 * Looking for a newer run after a tile of the run on screen failed (App.tsx,
 * `recoverRun`). Once the pointer has been read again and compared, that run
 * directory is done with: whatever the answer, another failing tile of it
 * does not read the pointer again (the five-minute refresh still does). A look
 * that failed before it could compare — a timeout, the network gone — leaves
 * it open, so a later failure, after the run really has been deleted, still
 * recovers. One look at a time, so a burst of failing tiles reads the pointer
 * once.
 */
export class RunRecovery {
  private handled: string | null = null;
  private busy = false;

  attempt(
    base: string,
    look: () => Promise<RunSwap | null>,
    commit: (swap: RunSwap) => void,
  ): Promise<void> | null {
    if (this.busy || this.handled === base) return null;
    this.busy = true;
    return look()
      .then(
        (swap) => {
          this.handled = base;
          if (swap) commit(swap);
        },
        () => {},
      )
      .finally(() => {
        this.busy = false;
      });
  }
}

/** Whether the reader is holding the time controls right now. */
function scrubbing(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  return (
    active instanceof HTMLInputElement &&
    active.type === "range" &&
    !active.disabled
  );
}

/**
 * Keeps an open tab on the newest run. A forecast run is replaced every few
 * hours, and until now a page only saw a new one on reload — a tab left open all
 * morning quietly showed a stale forecast.
 *
 * Every five minutes while the tab is visible, and on a visibility or focus
 * change once that long has passed, the active map model's manifest is refetched
 * past the cache. If its run is the one already displayed, nothing happens at
 * all. If it is newer, the frame nearest the selected valid time is loaded
 * through the same `loadModel` transaction a model switch uses, so the caller
 * gets a complete new run to swap in atomically and the reader keeps their time.
 *
 * Nothing here ever interrupts a gesture: while the forecast is playing, while a
 * model switch is in flight, while a pointer is down or while the scrubber has
 * focus, the check is put off for a minute and tried again. And nothing here is
 * ever shown as an error — a background refresh that fails logs and leaves the
 * forecast that is already on screen exactly as it is.
 */
export default function useRunRefresh({
  manifest,
  validTime,
  switching,
  playing,
  onRun,
}: Options): void {
  // The timers are installed once; the current props are read through a ref so
  // that a scrub or a new frame does not tear the schedule down and restart it.
  const latest = useRef({ manifest, validTime, switching, playing, onRun });
  latest.current = { manifest, validTime, switching, playing, onRun };
  const lastCheck = useRef(Date.now());
  const running = useRef(false);
  const pointerDown = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const down = () => (pointerDown.current = true);
    const up = () => (pointerDown.current = false);

    const refresh = async (
      current: Manifest,
      time: string,
      signal: AbortSignal,
    ) => {
      try {
        const swap = await loadNewerRun(current, time, signal);
        if (!swap || signal.aborted) return;
        // The model may have been switched by hand while this was in flight; the
        // run we loaded is then not the run on screen, so it is dropped. So it
        // is while a switch is still on its way: two transactions never overlap,
        // and an "Updated to the … run" notice must not land over another model.
        if (
          latest.current.manifest?.model !== current.model ||
          latest.current.switching
        )
          return;
        latest.current.onRun(swap);
      } catch (error) {
        // A background refresh is never the reader's problem: the forecast they
        // already have stays on screen and nothing is said about it.
        console.warn("Background forecast refresh failed.", error);
      }
    };

    const check = () => {
      const {
        manifest: current,
        validTime: time,
        switching: busy,
      } = latest.current;
      const held =
        busy || latest.current.playing || pointerDown.current || scrubbing();
      const decision = revalidateDecision(
        lastCheck.current,
        Date.now(),
        document.visibilityState === "visible",
        held || running.current,
      );
      // A deferred check is retried on the next heartbeat, a minute later.
      if (decision !== "go" || !current || !time) return;
      lastCheck.current = Date.now();
      running.current = true;
      void refresh(current, time, controller.signal).finally(() => {
        running.current = false;
      });
    };

    // A pointer released outside the page can leave `pointerup` undelivered, and
    // a flag stuck down would silently switch this off for the session. Leaving
    // or re-entering the tab is proof that nothing is still being held.
    const rearm = () => {
      pointerDown.current = false;
      check();
    };
    const timer = window.setInterval(check, REVALIDATE_RETRY_MS);
    document.addEventListener("visibilitychange", rearm);
    window.addEventListener("focus", rearm);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", rearm);
      window.removeEventListener("focus", rearm);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
    // Installed once for the life of the page: the cadence is a clock, not a
    // dependency, and the current props are read through `latest`.
  }, []);
}
