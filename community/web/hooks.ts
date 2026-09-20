/**
 * What the shell reads from the API: the channels for the rail, and the bell's
 * number. Then what a list of threads reads: a first page, and the pages after
 * it by cursor. Each hook is a thin effect over a plain function, and the plain
 * function is what is tested: there is no DOM under the unit tests.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSiteAuth } from "../../shared/web/auth";
import type { UserRole } from "../../site/shared/types";
import type { Category, Channel, Thread, ThreadPage } from "../shared/types";
import { useApi, type CommunityApi } from "./api";

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
  | {
      status: "ready";
      groups: RailGroup[];
      /** Null when the API did not send one. */
      memberCount: number | null;
    };

/** The channel a URL names, once the channels are in. Null for one that is not there. */
export function findChannel(
  state: ChannelsState,
  slug: string,
): Channel | null {
  if (state.status !== "ready") return null;
  for (const group of state.groups)
    for (const channel of group.channels)
      if (channel.slug === slug) return channel;
  return null;
}

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
            memberCount: meta.memberCount ?? null,
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

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/** Which list of threads: every channel's, one channel's, or a search. */
export type FeedSource =
  | { kind: "latest" }
  | { kind: "search"; q: string }
  | { kind: "channel"; slug: string; tagId: string | null };

/** Two sources with one key are one list: a new key starts again from the top. */
export const feedKey = (source: FeedSource) =>
  source.kind === "channel"
    ? `c:${source.slug}:${source.tagId ?? ""}`
    : source.kind === "search"
      ? `q:${source.q}`
      : "latest";

export function loadFeed(
  api: Pick<CommunityApi, "feed" | "search" | "channelThreads">,
  source: FeedSource,
  cursor: string | null,
): Promise<ThreadPage> {
  if (source.kind === "channel")
    return api.channelThreads(source.slug, source.tagId, cursor);
  if (source.kind === "search") return api.search(source.q, cursor);
  return api.feed(cursor);
}

export type FeedState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      items: Thread[];
      /** Null on the last page. */
      nextCursor: string | null;
      /** The next page: not asked for, on its way, or refused with this message. */
      more:
        { status: "idle" | "loading" } | { status: "error"; message: string };
    };

/**
 * A page added to the list under it. A reply moves a thread to the top while a
 * reader is paging down, so the next page can hold a thread the list already
 * shows: the first telling is kept, and the row does not appear twice.
 */
export function appendPage(state: FeedState, page: ThreadPage): FeedState {
  const before = state.status === "ready" ? state.items : [];
  const shown = new Set(before.map((thread) => thread.id));
  return {
    status: "ready",
    items: [...before, ...page.items.filter((thread) => !shown.has(thread.id))],
    nextCursor: page.nextCursor,
    more: { status: "idle" },
  };
}

/**
 * A list of threads, a page at a time. Asked again from the top whenever the
 * source or the identity changes, and by `reload`; `loadMore` asks for the page
 * after the last, and does nothing while one is on its way or none is left.
 */
export function useThreadFeed(source: FeedSource): {
  state: FeedState;
  reload: () => void;
  loadMore: () => void;
} {
  const api = useApi();
  const key = feedKey(source);
  const [state, setState] = useState<FeedState>({ status: "loading" });
  const [asked, setAsked] = useState(0);
  // Which list the pages belong to. An answer for another one is dropped.
  const list = useRef(0);
  const latest = useRef({ source, state });
  latest.current = { source, state };

  useEffect(() => {
    const mine = ++list.current;
    setState({ status: "loading" });
    loadFeed(api, latest.current.source, null).then(
      (page) => {
        if (mine === list.current)
          setState(appendPage({ status: "loading" }, page));
      },
      (error: unknown) => {
        if (mine === list.current)
          setState({
            status: "error",
            message: messageOf(error, "The threads could not be loaded."),
          });
      },
    );
    return () => {
      list.current++;
    };
  }, [api, key, asked]);

  const reload = useCallback(() => setAsked((n) => n + 1), []);
  const loadMore = useCallback(() => {
    const { source: from, state: now } = latest.current;
    if (now.status !== "ready" || !now.nextCursor) return;
    if (now.more.status === "loading") return;
    const mine = list.current;
    setState({ ...now, more: { status: "loading" } });
    loadFeed(api, from, now.nextCursor).then(
      (page) => {
        if (mine === list.current) setState((was) => appendPage(was, page));
      },
      (error: unknown) => {
        if (mine === list.current)
          setState((was) =>
            was.status === "ready"
              ? {
                  ...was,
                  more: {
                    status: "error",
                    message: messageOf(
                      error,
                      "More threads could not be loaded.",
                    ),
                  },
                }
              : was,
          );
      },
    );
  }, [api]);
  return { state, reload, loadMore };
}

/**
 * The member's role, for the one place the page needs it: a channel only the
 * site's team starts threads in. Asked only when `wanted`, so reading the
 * community makes nobody a row in users. Null until it is known, and for a
 * reader who is signed out.
 */
export function useViewerRole(wanted: boolean): UserRole | null {
  const api = useApi();
  const { signedIn } = useSiteAuth();
  const [role, setRole] = useState<UserRole | null>(null);
  useEffect(() => {
    setRole(null);
    if (!wanted || !signedIn) return;
    let current = true;
    api.me().then(
      (user) => {
        if (current) setRole(user.role);
      },
      // Not knowing is not being staff: the API refuses the post either way.
      () => {},
    );
    return () => {
      current = false;
    };
  }, [api, wanted, signedIn]);
  return role;
}
