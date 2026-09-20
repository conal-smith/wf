/**
 * What the shell reads from the API: the channels for the rail, and the bell's
 * number. Each hook is a thin effect over a plain function, and the plain
 * function is what is tested: there is no DOM under the unit tests.
 */
import { useCallback, useEffect, useState } from "react";
import { useSiteAuth } from "../../shared/web/auth";
import type { Category, Channel } from "../shared/types";
import { useApi } from "./api";

/** A category and its channels, as the rail draws them. */
export interface RailGroup {
  category: Category;
  channels: Channel[];
}

/**
 * Channels under their categories, both in the site's order. A category with
 * no channel to show is left out rather than drawn as an empty head, and a
 * channel whose category the API did not send is left out with it.
 */
export function railGroups(
  categories: readonly Category[],
  channels: readonly Channel[],
): RailGroup[] {
  const byPosition = (a: { position: number }, b: { position: number }) =>
    a.position - b.position;
  return [...categories]
    .sort(byPosition)
    .map((category) => ({
      category,
      channels: channels
        .filter((c) => c.categoryId === category.id)
        .sort(byPosition),
    }))
    .filter((group) => group.channels.length > 0);
}

export type ChannelsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; groups: RailGroup[] };

/**
 * The rail's channels. The categories come from /meta, which is the same for
 * everyone; the channels from /channels, which carries the viewer's unread
 * counts. Asked again whenever the identity changes, and by `reload`.
 */
export function useChannels(): { state: ChannelsState; reload: () => void } {
  const api = useApi();
  const [state, setState] = useState<ChannelsState>({ status: "loading" });
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    Promise.all([api.meta(), api.listChannels()]).then(
      ([meta, { channels }]) => {
        if (current)
          setState({
            status: "ready",
            groups: railGroups(meta.categories, channels),
          });
      },
      (error: unknown) => {
        if (current)
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "The channels could not be loaded.",
          });
      },
    );
    return () => {
      current = false;
    };
  }, [api, asked]);
  const reload = useCallback(() => setAsked((n) => n + 1), []);
  return { state, reload };
}

/** The bell polls (D19): on load, when the window takes focus, and each minute. */
export const COUNT_EVERY_MS = 60_000;

/** The little of `window` and `document` the poll needs, so a test can stand in. */
export interface CountClock {
  addEventListener(type: "focus", listener: () => void): void;
  removeEventListener(type: "focus", listener: () => void): void;
  setInterval(handler: () => void, ms: number): number;
  clearInterval(id: number): void;
  /** A tab nobody is looking at skips its minute; focus asks when they return. */
  hidden(): boolean;
}

const browserClock = (): CountClock => ({
  addEventListener: (type, listener) => window.addEventListener(type, listener),
  removeEventListener: (type, listener) =>
    window.removeEventListener(type, listener),
  setInterval: (handler, ms) => window.setInterval(handler, ms),
  clearInterval: (id) => window.clearInterval(id),
  hidden: () => document.visibilityState === "hidden",
});

/**
 * Asks now, on focus and every minute, and hands each answer to `onCount`. A
 * failed ask changes nothing: the bell keeps the number it had. An answer that
 * arrives after a later one, or after the stop, is dropped. Returns the stop.
 */
export function watchCount(
  load: () => Promise<number>,
  onCount: (count: number) => void,
  clock: CountClock = browserClock(),
): () => void {
  let stopped = false;
  let latest = 0;
  const ask = () => {
    const mine = ++latest;
    load().then(
      (count) => {
        if (!stopped && mine === latest) onCount(count);
      },
      () => {},
    );
  };
  const tick = () => {
    if (!clock.hidden()) ask();
  };
  ask();
  clock.addEventListener("focus", ask);
  const timer = clock.setInterval(tick, COUNT_EVERY_MS);
  return () => {
    stopped = true;
    clock.removeEventListener("focus", ask);
    clock.clearInterval(timer);
  };
}

/** Unread notifications, for the bell. Nothing is asked of a signed-out reader. */
export function useNotificationsCount(): number {
  const api = useApi();
  const { signedIn } = useSiteAuth();
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    if (!signedIn) return;
    return watchCount(
      () => api.notificationsCount().then((reply) => reply.count),
      setCount,
    );
  }, [api, signedIn]);
  return count;
}
