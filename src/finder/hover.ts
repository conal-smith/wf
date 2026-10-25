/**
 * The time under the pointer on the spot finder, shared by every card: a
 * dotted line at that time on each card's day of hours and on its day in
 * the next days, as a dashboard's charts share a crosshair, and the time
 * written beside the pointer on the one it is over.
 *
 * The pointer moves many times a frame, and a card is a lot of drawing: so
 * the time is not React state. It is kept here, published at most once a
 * frame, and each line moves itself, straight in the page, without drawing
 * its card again (`useHoverLine`). A mouse's or a pen's only: a finger has
 * no hover, and a tap on an hour picks it.
 */
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

/** The time under the pointer, and which drawing it is over. */
export interface Hover {
  time: number;
  /** The drawing's own key: its label shows there and nowhere else. */
  over: string;
}

export interface HoverStore {
  get: () => Hover | null;
  /** Set, or clear with null; seen by the lines at the next frame. */
  set: (hover: Hover | null) => void;
  subscribe: (listener: () => void) => () => void;
}

/** A store of its own, for one page of cards. */
export function hoverStore(
  frame: (run: () => void) => unknown = (run) => requestAnimationFrame(run),
): HoverStore {
  let shown: Hover | null = null;
  let next: Hover | null = null;
  let waiting = false;
  const listeners = new Set<() => void>();
  return {
    get: () => shown,
    set(hover) {
      next = hover;
      if (waiting) return;
      waiting = true;
      frame(() => {
        waiting = false;
        if (next?.time === shown?.time && next?.over === shown?.over) return;
        shown = next;
        listeners.forEach((listener) => listener());
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const HoverContext = createContext<HoverStore | null>(null);

/** The page's store, or null outside the finder (no lines). */
export const useHover = () => useContext(HoverContext);

/** Whether a pointer event is one a hover follows: a mouse's or a pen's. */
export const hovers = (event: { pointerType: string }) =>
  event.pointerType === "mouse" || event.pointerType === "pen";

/**
 * Keep a line at the time hovered: `place` moves it there (or hides it)
 * straight in the page, each time the time changes and after each drawing
 * of its own, without drawing the card again.
 */
export function useHoverLine(place: (hover: Hover | null) => void) {
  const store = useHover();
  const latest = useRef(place);
  latest.current = place;
  useLayoutEffect(() => {
    latest.current(store?.get() ?? null);
  });
  useEffect(() => {
    if (!store) return;
    return store.subscribe(() => latest.current(store.get()));
  }, [store]);
}
