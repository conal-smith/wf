/**
 * "Not now": the rider is in the middle of something. While any hold is on,
 * the update banner stays out of the way and a roll back waits; an update is
 * never put in place in the foreground without the rider's tap anyway.
 *
 * A gesture that matters calls it for as long as it lasts:
 *
 *   useUpdateHold(isDragging);          // the dock's sheet being dragged
 *   const release = holdUpdates();      // or by hand, e.g. on scrub start
 *   release();                          //   ... and on scrub end
 *
 * Plain module state, no React Native, so it is tested in Node (hold.test.ts).
 */
import { useEffect, useSyncExternalStore } from "react";

type Listener = () => void;

export function createHold() {
  let count = 0;
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    /** Hold updates until the returned function is called (once; later calls do nothing). */
    hold(): () => void {
      count += 1;
      if (count === 1) emit();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        count -= 1;
        if (count === 0) emit();
      };
    },
    isHeld: () => count > 0,
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const shared = createHold();

export const holdUpdates = shared.hold;
export const isUpdateHeld = shared.isHeld;
export const subscribeToHold = shared.subscribe;

/** Hold updates while `active` is true. */
export function useUpdateHold(active: boolean) {
  useEffect(() => (active ? holdUpdates() : undefined), [active]);
}

/** Whether anything is holding updates, as React state. */
export function useUpdatesHeld(): boolean {
  return useSyncExternalStore(subscribeToHold, isUpdateHeld, isUpdateHeld);
}
