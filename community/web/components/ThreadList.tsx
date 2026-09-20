/**
 * A list of threads in one pane, rows divided by hairlines, and everything a
 * list can be instead: loading, failed, or empty. The pages after the first
 * arrive as the reader nears the end of the list; the button that asks for them
 * stays, for a browser that cannot watch for that and for a keyboard.
 */
import { CloudOff } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button, Empty, Notice, Pane, Skeleton } from "../../../ui";
import { tv } from "../../../ui/tv";
import type { FeedState } from "../hooks";
import { ThreadRow } from "./ThreadRow";

export const threadListStyles = tv({
  slots: {
    base: "flex flex-col gap-3",
    pane: "overflow-hidden p-0",
    list: "m-0 flex list-none flex-col p-0",
    item: "border-t border-line first:border-t-0",
    loading: "flex items-center gap-5 p-5 max-rail:gap-3 max-rail:p-3",
    lines: "grid flex-1 gap-2",
    short: "w-1/3",
    more: "self-center",
    hidden: "sr-only",
  },
});

/** How far short of the end the next page is asked for. */
const AHEAD = "600px";

/**
 * Calls `onNear` when the element comes within reach of the viewport. Returns
 * the stop, or null where the browser cannot watch: the button is then the way.
 */
export function watchNear(
  element: Element,
  onNear: () => void,
  Observer:
    typeof IntersectionObserver | undefined = globalThis.IntersectionObserver,
): (() => void) | null {
  if (!Observer) return null;
  const observer = new Observer(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onNear();
    },
    { rootMargin: `0px 0px ${AHEAD} 0px` },
  );
  observer.observe(element);
  return () => observer.disconnect();
}

export interface ThreadListProps {
  state: FeedState;
  /** What the list holds, for the reader who is told it failed: "the latest threads". */
  subject: string;
  /** Name each row's channel: everywhere but inside the channel itself. */
  showChannel: boolean;
  /** Draw pinned threads as the quiet lines at the head of a channel. */
  pinnedLines?: boolean;
  onRetry: () => void;
  onMore: () => void;
  /** What stands where the list would, when it has nothing in it. */
  empty: ReactNode;
  now?: Date;
}

export function ThreadList({
  state,
  subject,
  showChannel,
  pinnedLines = false,
  onRetry,
  onMore,
  empty,
  now,
}: ThreadListProps) {
  const styles = threadListStyles();
  const more = useRef<HTMLButtonElement>(null);
  const waiting =
    state.status === "ready" &&
    state.nextCursor !== null &&
    state.more.status === "idle";
  const count = state.status === "ready" ? state.items.length : 0;
  // Watched afresh after each page: a button still in reach asks again.
  useEffect(() => {
    if (!waiting || !more.current) return;
    return watchNear(more.current, onMore) ?? undefined;
  }, [waiting, count, onMore]);

  if (state.status === "loading")
    return (
      <Pane className={styles.pane()} aria-busy="true">
        <span className={styles.hidden()}>Loading {subject}…</span>
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className={styles.loading()}>
            <Skeleton shape="circle" />
            <span className={styles.lines()}>
              <Skeleton />
              <Skeleton className={styles.short()} />
            </span>
          </div>
        ))}
      </Pane>
    );

  if (state.status === "error")
    return (
      <Empty
        kind="warn"
        title={`We could not load ${subject}`}
        icon={<CloudOff size={24} aria-hidden="true" />}
      >
        <p role="alert">{state.message}</p>
        <Button variant="pill" onClick={onRetry}>
          Try again
        </Button>
      </Empty>
    );

  if (!state.items.length) return <>{empty}</>;

  return (
    <div className={styles.base()}>
      <Pane className={styles.pane()}>
        <ul className={styles.list()}>
          {state.items.map((thread) => (
            <li key={thread.id} className={styles.item()}>
              <ThreadRow
                thread={thread}
                showChannel={showChannel}
                pinnedLine={pinnedLines}
                now={now}
              />
            </li>
          ))}
        </ul>
      </Pane>
      {state.more.status === "error" && (
        <Notice kind="warn">
          <p>{state.more.message}</p>
        </Notice>
      )}
      {state.nextCursor !== null && (
        <Button
          ref={more}
          variant="pill"
          className={styles.more()}
          disabled={state.more.status === "loading"}
          onClick={onMore}
        >
          {state.more.status === "loading"
            ? "Loading…"
            : state.more.status === "error"
              ? "Try again"
              : "Load more"}
        </Button>
      )}
    </div>
  );
}
