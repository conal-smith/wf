/**
 * The replies, on the ground under the opening post: flat, oldest first,
 * under day dividers, with the line that says where the viewer had read to
 * (D14). A page of older messages joins at the top and a page of newer ones
 * at the bottom, each asked for when its end of the run comes into view.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "../../../ui";
import { tv } from "../../../ui/tv";
import type { Message as MessageData } from "../../shared/types";
import type { StreamRow } from "../thread";

export const streamStyles = tv({
  slots: {
    base: "flex flex-col",
    // A day: its name in a grey label, centred, with space round it.
    divider:
      "flex items-center justify-center pt-6 pb-2 font-body text-label text-ink-muted",
    // Filled as well as worded, as an unread count is everywhere else.
    fresh:
      "rounded-full bg-inverse px-2.5 py-1 font-body text-label font-medium text-ink-inverse",
    // Coming back to new replies scrolls this line near the top, as a message
    // jumped to is.
    since: "scroll-mt-24",
    more: "flex justify-center py-1",
    // Where a page is asked for, and where the newest message counts as seen.
    sentinel: "h-px",
  },
});

/** Calls back whenever the element comes into view or leaves it. */
export function useInView(
  onChange: (inView: boolean) => void,
): (element: HTMLElement | null) => void {
  const latest = useRef(onChange);
  latest.current = onChange;
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  return useRef((element: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!element || typeof IntersectionObserver === "undefined") return;
    observer.current = new IntersectionObserver((entries) => {
      for (const entry of entries) latest.current(entry.isIntersecting);
    });
    observer.current.observe(element);
  }).current;
}

export interface MessageStreamProps {
  rows: readonly StreamRow[];
  hasOlder: boolean;
  hasNewer: boolean;
  /** A page is on its way: neither end asks for another. */
  loading: boolean;
  onOlder: () => void;
  onNewer: () => void;
  /** The end of the run is in view, or has left it. */
  onEnd: (inView: boolean) => void;
  children: (message: MessageData) => ReactNode;
}

export function MessageStream({
  rows,
  hasOlder,
  hasNewer,
  loading,
  onOlder,
  onNewer,
  onEnd,
  children,
}: MessageStreamProps) {
  const styles = streamStyles();
  const top = useInView((inView) => {
    if (inView && hasOlder && !loading) onOlder();
  });
  const end = useInView((inView) => {
    onEnd(inView);
    if (inView && hasNewer && !loading) onNewer();
  });
  return (
    <div className={styles.base()} aria-busy={loading || undefined}>
      {hasOlder && (
        <div className={styles.more()}>
          <span ref={top} className={styles.sentinel()} aria-hidden="true" />
          <Button variant="soft" size="sm" disabled={loading} onClick={onOlder}>
            {loading ? "Loading…" : "Show earlier replies"}
          </Button>
        </div>
      )}
      {rows.map((row) => {
        switch (row.t) {
          case "day":
            return (
              <div key={row.key} className={styles.divider()}>
                <span>{row.label}</span>
              </div>
            );
          case "new":
            return (
              <div
                key={row.key}
                id="new-since"
                className={styles.divider({ className: styles.since() })}
              >
                <span className={styles.fresh()}>
                  {row.count} new since you were last here
                </span>
              </div>
            );
          case "message":
            return children(row.message);
        }
      })}
      {hasNewer && (
        <div className={styles.more()}>
          <Button variant="soft" size="sm" disabled={loading} onClick={onNewer}>
            {loading ? "Loading…" : "Show later replies"}
          </Button>
        </div>
      )}
      <span ref={end} className={styles.sentinel()} aria-hidden="true" />
    </div>
  );
}
