/**
 * What the shell reads from the API: the channels for the rail, and the bell's
 * number. Then what a list of threads reads: a first page, and the pages after
 * it by cursor. The Mentions page and the bell page the same way, so the list
 * under them is one hook. Each hook is a thin effect over a plain function, and
 * the plain function is what is tested: there is no DOM under the unit tests.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSiteAuth } from "../../shared/web/auth";
import type { UserRole } from "../../site/shared/types";
import type {
  Category,
  Channel,
  MemberProfile,
  MentionItem,
  Notification,
  Thread,
  ThreadPage,
} from "../shared/types";
import { ApiRequestError, useApi, type CommunityApi } from "./api";

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

/**
 * Unread notifications, for the bell. Nothing is asked of a signed-out reader.
 * Marking rows read answers with the count as it now stands, and `setCount`
 * takes it: the badge does not wait out its minute.
 */
export function useNotificationsCount(): {
  count: number;
  setCount: (count: number) => void;
} {
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
  return { count, setCount };
}

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/** Which list of threads: every channel's, what the member follows, one channel's, or a search. */
export type FeedSource =
  | { kind: "latest" }
  | { kind: "following" }
  | { kind: "search"; q: string }
  | { kind: "channel"; slug: string; tagId: string | null };

/** Two sources with one key are one list: a new key starts again from the top. */
export const feedKey = (source: FeedSource) =>
  source.kind === "channel"
    ? `c:${source.slug}:${source.tagId ?? ""}`
    : source.kind === "search"
      ? `q:${source.q}`
      : source.kind;

export function loadFeed(
  api: Pick<CommunityApi, "feed" | "following" | "search" | "channelThreads">,
  source: FeedSource,
  cursor: string | null,
): Promise<ThreadPage> {
  if (source.kind === "channel")
    return api.channelThreads(source.slug, source.tagId, cursor);
  if (source.kind === "search") return api.search(source.q, cursor);
  if (source.kind === "following") return api.following(cursor);
  return api.feed(cursor);
}

/** A page of anything the API pages by cursor: threads, mentions, the bell's rows. */
export interface Page<T> {
  items: T[];
  /** Null on the last page. */
  nextCursor: string | null;
}

export type PagedState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      items: T[];
      /** Null on the last page. */
      nextCursor: string | null;
      /** The next page: not asked for, on its way, or refused with this message. */
      more:
        { status: "idle" | "loading" } | { status: "error"; message: string };
    };

export type FeedState = PagedState<Thread>;

/**
 * A page added to the list under it. A reply moves a thread to the top while a
 * reader is paging down, so the next page can hold a thread the list already
 * shows: the first telling is kept, and the row does not appear twice. The bell
 * moves a row the same way, when it takes another reply.
 */
export function appendItems<T>(
  state: PagedState<T>,
  page: Page<T>,
  idOf: (item: T) => string,
): PagedState<T> {
  const before = state.status === "ready" ? state.items : [];
  const shown = new Set(before.map(idOf));
  return {
    status: "ready",
    items: [...before, ...page.items.filter((item) => !shown.has(idOf(item)))],
    nextCursor: page.nextCursor,
    more: { status: "idle" },
  };
}

const threadId = (thread: Thread) => thread.id;

export const appendPage = (state: FeedState, page: ThreadPage): FeedState =>
  appendItems(state, page, threadId);

/** What a list says when a page of it is refused with no words of its own. */
export interface PagedWords {
  failed: string;
  moreFailed: string;
}

/**
 * A list, a page at a time. Asked again from the top whenever `key` or the
 * identity changes, and by `reload`; `loadMore` asks for the page after the
 * last, and does nothing while one is on its way or none is left. `change`
 * rewrites the rows in hand, for a page that marks its own rows read. With
 * `enabled` false nothing is asked: a list only a member has.
 */
export function usePaged<T>(
  key: string,
  load: (api: CommunityApi, cursor: string | null) => Promise<Page<T>>,
  idOf: (item: T) => string,
  words: PagedWords,
  enabled = true,
): {
  state: PagedState<T>;
  reload: () => void;
  loadMore: () => void;
  change: (rewrite: (items: T[]) => T[]) => void;
} {
  const api = useApi();
  const [state, setState] = useState<PagedState<T>>({ status: "loading" });
  const [asked, setAsked] = useState(0);
  // Which list the pages belong to. An answer for another one is dropped.
  const list = useRef(0);
  const latest = useRef({ load, idOf, words, state });
  latest.current = { load, idOf, words, state };

  useEffect(() => {
    const mine = ++list.current;
    setState({ status: "loading" });
    if (!enabled) return;
    latest.current.load(api, null).then(
      (page) => {
        if (mine === list.current)
          setState(
            appendItems({ status: "loading" }, page, latest.current.idOf),
          );
      },
      (error: unknown) => {
        if (mine === list.current)
          setState({
            status: "error",
            message: messageOf(error, latest.current.words.failed),
          });
      },
    );
    return () => {
      list.current++;
    };
  }, [api, key, asked, enabled]);

  const reload = useCallback(() => setAsked((n) => n + 1), []);
  const loadMore = useCallback(() => {
    const now = latest.current.state;
    if (now.status !== "ready" || !now.nextCursor) return;
    if (now.more.status === "loading") return;
    const mine = list.current;
    setState({ ...now, more: { status: "loading" } });
    latest.current.load(api, now.nextCursor).then(
      (page) => {
        if (mine === list.current)
          setState((was) => appendItems(was, page, latest.current.idOf));
      },
      (error: unknown) => {
        if (mine === list.current)
          setState((was) =>
            was.status === "ready"
              ? {
                  ...was,
                  more: {
                    status: "error",
                    message: messageOf(error, latest.current.words.moreFailed),
                  },
                }
              : was,
          );
      },
    );
  }, [api]);
  const change = useCallback(
    (rewrite: (items: T[]) => T[]) =>
      setState((was) =>
        was.status === "ready" ? { ...was, items: rewrite(was.items) } : was,
      ),
    [],
  );
  return { state, reload, loadMore, change };
}

const THREAD_WORDS: PagedWords = {
  failed: "The threads could not be loaded.",
  moreFailed: "More threads could not be loaded.",
};

/**
 * A list of threads, a page at a time: `usePaged` over whichever list `source`
 * names. Following is a member's own, so its page asks only once there is one.
 */
export function useThreadFeed(
  source: FeedSource,
  enabled = true,
): {
  state: FeedState;
  reload: () => void;
  loadMore: () => void;
} {
  return usePaged(
    feedKey(source),
    (api, cursor) => loadFeed(api, source, cursor),
    threadId,
    THREAD_WORDS,
    enabled,
  );
}

const MENTION_WORDS: PagedWords = {
  failed: "Your mentions could not be loaded.",
  moreFailed: "More mentions could not be loaded.",
};

/** The messages that name the member, newest first. */
export function useMentions(enabled: boolean) {
  return usePaged<MentionItem>(
    "mentions",
    (api, cursor) => api.mentions(cursor),
    (item) => item.message.id,
    MENTION_WORDS,
    enabled,
  );
}

const NOTIFICATION_WORDS: PagedWords = {
  failed: "Your notifications could not be loaded.",
  moreFailed: "More notifications could not be loaded.",
};

/**
 * The bell's rows, asked for when the bell opens (D19): `opened` counts the
 * openings, and each one starts the list again from the top.
 */
export function useNotifications(enabled: boolean, opened = 0) {
  return usePaged<Notification>(
    `notifications:${opened}`,
    (api, cursor) => api.notifications(cursor),
    (row) => row.id,
    NOTIFICATION_WORDS,
    enabled,
  );
}

/** The rows as they stand once some of them, or with no ids all of them, are read. */
export function readRows(
  rows: Notification[],
  at: string,
  ids?: readonly string[],
): Notification[] {
  return rows.map((row) =>
    row.readAt === null && (!ids || ids.includes(row.id))
      ? { ...row, readAt: at }
      : row,
  );
}

/** What marking rows read is done to: the list in hand, the badge, and what a refusal does. */
export interface MarkedRows {
  change: (rewrite: (rows: Notification[]) => Notification[]) => void;
  onCount: (count: number) => void;
  onRefused: (error: unknown) => void;
}

/**
 * Marks some rows read, or with no ids all of them: in hand first, then on the
 * API, whose answer is the bell's number as it now stands.
 */
export function markRows(
  api: Pick<CommunityApi, "markNotificationsRead">,
  ids: string[] | undefined,
  to: MarkedRows,
  at = new Date().toISOString(),
): Promise<void> {
  to.change((rows) => readRows(rows, at, ids));
  return api
    .markNotificationsRead(ids ? { ids } : { all: true })
    .then((reply) => to.onCount(reply.count), to.onRefused);
}

/**
 * The bell's rows and what is done to them, for the popover and for the page a
 * phone gets. A row is read in hand first and on the API after: the reader is
 * already on their way to the message. The API's answer is the bell's number as
 * it now stands, and `onCount` takes it. A refusal puts the list back as the
 * API has it, and Mark all read says that it failed.
 */
export function useBell(
  enabled: boolean,
  opened: number,
  onCount: (count: number) => void,
) {
  const api = useApi();
  const list = useNotifications(enabled, opened);
  const [failure, setFailure] = useState<string | null>(null);
  const { change, reload } = list;
  const mark = useCallback(
    (ids?: string[]) => {
      setFailure(null);
      void markRows(api, ids, {
        change,
        onCount,
        onRefused: (error) => {
          if (!ids)
            setFailure(messageOf(error, "That did not work. Try again."));
          reload();
        },
      });
    },
    [api, change, reload, onCount],
  );
  const open = useCallback(
    (row: Notification) => {
      if (row.readAt === null) mark([row.id]);
    },
    [mark],
  );
  const markAll = useCallback(() => mark(), [mark]);
  return { ...list, failure, open, markAll };
}

export type MemberState =
  | { status: "loading" }
  | { status: "error"; message: string }
  /** Nobody has that handle. */
  | { status: "missing" }
  | { status: "ready"; member: MemberProfile; threads: FeedState };

/**
 * A member's profile and the threads they started. One read brings both, so the
 * list's first page is the profile's own; the pages after it come by cursor.
 */
export function useMember(handle: string): {
  state: MemberState;
  reload: () => void;
  loadMore: () => void;
} {
  const api = useApi();
  const [state, setState] = useState<MemberState>({ status: "loading" });
  const [asked, setAsked] = useState(0);
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    api.member(handle).then(
      (view) => {
        if (current)
          setState({
            status: "ready",
            member: view.member,
            threads: appendPage({ status: "loading" }, view.threads),
          });
      },
      (error: unknown) => {
        if (!current) return;
        setState(
          error instanceof ApiRequestError && error.status === 404
            ? { status: "missing" }
            : {
                status: "error",
                message: messageOf(error, "This profile could not be loaded."),
              },
        );
      },
    );
    return () => {
      current = false;
    };
  }, [api, handle, asked]);

  const reload = useCallback(() => setAsked((n) => n + 1), []);
  const loadMore = useCallback(() => {
    const now = latest.current;
    if (now.status !== "ready" || now.threads.status !== "ready") return;
    const { member, threads } = now;
    if (!threads.nextCursor || threads.more.status === "loading") return;
    // The answer belongs to the member it was asked about, and to nobody else.
    const within = (rewrite: (was: FeedState) => FeedState) =>
      setState((was) =>
        was.status === "ready" && was.member.id === member.id
          ? { ...was, threads: rewrite(was.threads) }
          : was,
      );
    within((was) =>
      was.status === "ready" ? { ...was, more: { status: "loading" } } : was,
    );
    api.member(handle, threads.nextCursor).then(
      (view) => within((was) => appendPage(was, view.threads)),
      (error: unknown) =>
        within((was) =>
          was.status === "ready"
            ? {
                ...was,
                more: {
                  status: "error",
                  message: messageOf(error, THREAD_WORDS.moreFailed),
                },
              }
            : was,
        ),
    );
  }, [api, handle]);
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
