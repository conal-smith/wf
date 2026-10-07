/**
 * What the thread page reads and writes. One hook holds the head, the run of
 * messages and where the viewer came in, keeps them live, and hands the page
 * the things a member can do. The arithmetic is `thread.ts`'s, and tested
 * there; this is the effects around it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSiteAuth } from "../../shared/web/auth";
import { followThread, type EventSourceLike } from "../shared/followThread";
import type {
  FollowLevel,
  Member,
  Message,
  Reaction,
  Thread,
} from "../shared/types";
import {
  ApiRequestError,
  useApi,
  type ReportReason,
  type ThreadAction,
} from "./api";
import {
  encodeMentions,
  entryOf,
  findBySeq,
  newestSeq,
  startStream,
  withMessages,
  withPage,
  type Entry,
  type Stream,
  type Viewer,
} from "./thread";

export type ThreadState =
  | { status: "loading" }
  /** A 404: never there, removed, or not this viewer's to see. */
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; thread: Thread; stream: Stream; entry: Entry };

type Ready = Extract<ThreadState, { status: "ready" }>;

/** The head again after messages arrived: the counts a reader sees move with the stream. */
export function headAfter(thread: Thread, messages: readonly Message[]) {
  const fresh = messages.filter((m) => m.seq > thread.lastSeq);
  if (!fresh.length) return thread;
  const newest = fresh.reduce((a, b) => (b.seq > a.seq ? b : a));
  return {
    ...thread,
    lastSeq: newest.seq,
    replyCount: thread.replyCount + fresh.length,
    lastMessageAt: newest.createdAt,
    lastMessageBy: newest.author,
  };
}

/** The browser's event stream, as the little of one the follower asks for. */
function openEvents(url: string): EventSourceLike {
  const source = new EventSource(url);
  const like: EventSourceLike = {
    get readyState() {
      return source.readyState;
    },
    onopen: null,
    onmessage: null,
    onerror: null,
    close: () => source.close(),
  };
  source.onopen = () => like.onopen?.();
  source.onmessage = (event: MessageEvent<string>) =>
    like.onmessage?.({ data: event.data });
  source.onerror = () => like.onerror?.();
  return like;
}

/** Who is looking: the session's id, and whether the site's team made them staff. */
export function useViewer(): Viewer {
  const api = useApi();
  const { signedIn, userId } = useSiteAuth();
  const [staff, setStaff] = useState(false);
  useEffect(() => {
    setStaff(false);
    if (!signedIn) return;
    let current = true;
    // A failed ask leaves them a member: the API decides what staff may do anyway.
    api.me().then(
      (me) => {
        if (current) setStaff(me.role === "staff");
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [api, signedIn]);
  return { id: signedIn ? userId : null, staff };
}

/** The time, again each minute, so "4 minutes ago" does not stand still. */
export function useNow(everyMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

export function useThread(id: string) {
  const api = useApi();
  const [state, setState] = useState<ThreadState>({ status: "loading" });
  const [paging, setPaging] = useState(false);
  /** Something a reader asked for did not happen, in words. One at a time. */
  const [failure, setFailure] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);
  /** Counts the loads that landed, so the follower starts once per load. */
  const [loaded, setLoaded] = useState(0);
  /**
   * The state as it stands now, ahead of the next render: a jump fetches a
   * page and then looks for its message, in one breath.
   */
  const latest = useRef(state);
  const busy = useRef(false);

  const set = useCallback((next: ThreadState) => {
    latest.current = next;
    setState(next);
  }, []);
  const change = useCallback(
    (next: (ready: Ready) => Ready) => {
      if (latest.current.status === "ready") set(next(latest.current));
    },
    [set],
  );

  useEffect(() => {
    let current = true;
    set({ status: "loading" });
    api.getThread(id).then(
      (view) => {
        if (!current) return;
        set({
          status: "ready",
          thread: view.thread,
          stream: startStream(view),
          entry: entryOf(view.thread),
        });
        setLoaded((n) => n + 1);
      },
      (error: unknown) => {
        if (!current) return;
        set(
          error instanceof ApiRequestError && error.status === 404
            ? { status: "missing" }
            : {
                status: "error",
                message:
                  error instanceof Error
                    ? error.message
                    : "The thread could not be loaded.",
              },
        );
      },
    );
    return () => {
      current = false;
    };
  }, [api, id, asked, set]);

  // Live (D20): the stream says a message changed, and the follower fetches it.
  useEffect(() => {
    const now = latest.current;
    if (!loaded || now.status !== "ready") return;
    if (typeof EventSource === "undefined") return;
    return followThread({
      open: () => openEvents(api.eventsUrl(id)),
      fetchAfter: (seq) => api.listMessages(id, { after: seq }),
      // Past any pages not loaded yet: those are the reader's to ask for.
      lastSeq: newestSeq(now.stream, now.thread),
      onMessages: (messages) =>
        change((ready) => ({
          ...ready,
          thread: headAfter(ready.thread, messages),
          stream: withMessages(ready.stream, messages),
        })),
    });
  }, [api, id, loaded, change]);

  /** One page at a time, whichever end asked. */
  const page = useCallback(
    async (
      window: Parameters<typeof api.listMessages>[1],
      side: "older" | "newer" | "replace",
      /** Called with the page in hand and the screen not yet changed by it. */
      before?: () => void,
    ) => {
      if (busy.current) return;
      busy.current = true;
      setPaging(true);
      try {
        const items = await api.listMessages(id, window);
        before?.();
        change((ready) => ({
          ...ready,
          stream: withPage(ready.stream, items, side),
        }));
      } catch (error) {
        // The button that asked is still there to ask again.
        setFailure(
          error instanceof Error
            ? error.message
            : "Those messages could not be loaded.",
        );
      } finally {
        busy.current = false;
        setPaging(false);
      }
    },
    [api, id, change],
  );

  const loadOlder = useCallback(
    async (before?: () => void) => {
      const now = latest.current;
      if (now.status !== "ready" || !now.stream.hasOlder) return;
      await page({ before: now.stream.replies[0].seq }, "older", before);
    },
    [page],
  );

  const loadNewer = useCallback(async () => {
    const now = latest.current;
    if (now.status !== "ready" || !now.stream.hasNewer) return;
    await page({ after: now.stream.replies.at(-1)?.seq ?? 0 }, "newer");
  }, [page]);

  /** Puts the message on the page if it is not there. False when it cannot be. */
  const reach = useCallback(
    async (seq: number): Promise<boolean> => {
      const now = latest.current;
      if (now.status !== "ready") return false;
      if (findBySeq(now.stream, seq)) return true;
      await page({ around: seq }, "replace");
      const after = latest.current;
      return after.status === "ready" && findBySeq(after.stream, seq) !== null;
    },
    [page],
  );

  /** The last page, in place of whatever run is on the page. */
  const reachEnd = useCallback(async () => {
    const now = latest.current;
    if (now.status !== "ready" || !now.stream.hasNewer) return;
    await page({ before: newestSeq(now.stream, now.thread) + 1 }, "replace");
  }, [page]);

  const put = useCallback(
    (message: Message) =>
      change((ready) => ({
        ...ready,
        thread: headAfter(ready.thread, [message]),
        stream: withMessages(ready.stream, [message]),
      })),
    [change],
  );

  const send = useCallback(
    async (
      draft: { text: string; photoKeys: string[]; replyToId: string | null },
      people: readonly Member[],
    ) => {
      const message = await api.postMessage(id, {
        body: encodeMentions(draft.text.trim(), people),
        replyToId: draft.replyToId,
        photoKeys: draft.photoKeys,
      });
      const now = latest.current;
      // Written from the middle of a long thread: the reply is on the last page.
      if (now.status === "ready" && now.stream.hasNewer) {
        change((ready) => ({
          ...ready,
          thread: headAfter(ready.thread, [message]),
        }));
        await reachEnd();
      } else put(message);
      return message;
    },
    [api, id, change, put, reachEnd],
  );

  const edit = useCallback(
    async (message: Message, text: string, people: readonly Member[]) =>
      put(
        await api.editMessage(
          message.id,
          // Whoever the body already names stays named, on the page or not.
          encodeMentions(text.trim(), [...message.mentions, ...people]),
        ),
      ),
    [api, put],
  );

  const remove = useCallback(
    async (message: Message) => put(await api.deleteMessage(message.id)),
    [api, put],
  );

  const react = useCallback(
    async (message: Message, emoji: Reaction, on: boolean) =>
      put(await api.setReaction(message.id, emoji, on)),
    [api, put],
  );

  const follow = useCallback(
    async (level: FollowLevel) => {
      const thread = await api.setThreadFollow(id, level);
      change((ready) => ({ ...ready, thread }));
    },
    [api, id, change],
  );

  /** Where the viewer came in does not move: only the head is counted again. */
  const markRead = useCallback(
    async (seq: number) => {
      const thread = await api.markRead(id, seq);
      change((ready) => ({
        ...ready,
        thread: {
          ...thread,
          lastSeq: Math.max(thread.lastSeq, ready.thread.lastSeq),
        },
      }));
    },
    [api, id, change],
  );

  const report = useCallback(
    (message: Message, reason: ReportReason, note: string) =>
      api.report(message.id, reason, note).then(() => {}),
    [api],
  );

  const reload = useCallback(() => setAsked((n) => n + 1), []);

  /**
   * Staff, in place. What changed is read again rather than guessed — but only
   * the head, which is all a pin or a lock changes: reloading the whole thread
   * would put it back to loading and unmount the reply being written.
   */
  const moderate = useCallback(
    async (action: ThreadAction, reason?: string) => {
      await api.moderateThread(id, action, reason);
      if (action === "remove") return;
      const view = await api.getThread(id);
      change((ready) => ({ ...ready, thread: view.thread }));
    },
    [api, id, change],
  );

  return {
    state,
    paging,
    failure,
    setFailure,
    reload,
    loadOlder,
    loadNewer,
    reach,
    reachEnd,
    send,
    edit,
    remove,
    react,
    follow,
    markRead,
    report,
    moderate,
    upload: useCallback((file: File) => api.uploadPhotoPreviewed(file), [api]),
  };
}
