/**
 * The bell: the header's count of what is unread, and the inbox under it.
 *
 * It is a link to /community/notifications, and below the rail breakpoint that
 * is all it is: a phone gets the page. Where the rail is beside the page a
 * plain press opens a popover hung from the bell instead, with the same rows.
 * Escape closes it and hands the focus back to the bell; a press anywhere
 * outside closes it and leaves the focus where the press put it.
 */
import { Bell as BellIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Count, Notice } from "../../../ui";
import { NO_RING, RING, tv } from "../../../ui/tv";
import { useBell } from "../hooks";
import { matchRoute, paths, routed } from "../router";
import {
  NotificationRows,
  NotificationTools,
  isUnread,
} from "./NotificationRow";

export const bellStyles = tv({
  slots: {
    base: "relative",
    bell: "relative",
    count: "absolute -top-1 -right-1",
    // Hung from the bell, and never drawn where the page stands in for it.
    panel: [
      "absolute top-full right-0 z-popover mt-3 grid w-100 gap-1 rounded-surface border border-line bg-card p-2 font-body text-ink shadow-surface max-rail:hidden",
      NO_RING,
    ],
    head: "flex items-center justify-between gap-2 py-1 pr-1 pl-3",
    title: "m-0 text-lead text-ink",
    foot: [
      "block rounded-control p-3 text-center text-body text-ink-muted no-underline transition-colors duration-fast not-disabled:hover:text-ink",
      RING,
    ],
  },
});

/** The theme's rail breakpoint (ui/theme.css), as a media query a script can ask. */
export const BESIDE_THE_RAIL = "(min-width: 56.25rem)";

/** The popover shows the newest few; See all notifications has the rest. */
export const POPOVER_ROWS = 6;

/** As much of a click as telling a plain press from "open it somewhere else" needs. */
export interface Press {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * Whether a press on the bell opens the popover. Otherwise the bell is the link
 * it looks like: on a phone, on the notifications page itself, and for a press
 * that asks for a new tab.
 */
export function opensPopover(
  press: Press,
  wide: boolean,
  onPage: boolean,
): boolean {
  if (!wide || onPage) return false;
  return (
    press.button === 0 &&
    !press.metaKey &&
    !press.ctrlKey &&
    !press.shiftKey &&
    !press.altKey
  );
}

/** As much of an element as telling inside from outside needs. */
export interface Holds {
  contains(node: never): boolean;
}

/** As much of an event as closing a popover reads. */
export interface PopoverEvent {
  readonly key?: string;
  readonly target: unknown;
}

/** As much of `document` as a popover listens to. */
export interface PopoverEvents {
  addEventListener(
    type: "keydown" | "pointerdown",
    listener: (event: PopoverEvent) => void,
  ): void;
  removeEventListener(
    type: "keydown" | "pointerdown",
    listener: (event: PopoverEvent) => void,
  ): void;
}

const browserEvents = (): PopoverEvents => ({
  addEventListener: (type, listener) =>
    document.addEventListener(type, listener),
  removeEventListener: (type, listener) =>
    document.removeEventListener(type, listener),
});

export type ClosedBy = "escape" | "outside";

/**
 * While a popover is open: Escape closes it, and so does a press that lands
 * outside every one of `parts` (the panel, and the bell, whose own press is the
 * toggle). Returns the stop.
 */
export function watchPopover(
  parts: () => readonly (Holds | null)[],
  close: (by: ClosedBy) => void,
  events: PopoverEvents = browserEvents(),
): () => void {
  const onKey = (event: PopoverEvent) => {
    if (event.key === "Escape") close("escape");
  };
  const onPress = (event: PopoverEvent) => {
    const inside = parts().some((part) =>
      part?.contains(event.target as never),
    );
    if (!inside) close("outside");
  };
  events.addEventListener("keydown", onKey);
  events.addEventListener("pointerdown", onPress);
  return () => {
    events.removeEventListener("keydown", onKey);
    events.removeEventListener("pointerdown", onPress);
  };
}

/** As much of an element as giving focus back to it needs. */
export interface FocusTarget {
  readonly isConnected: boolean;
  focus(): void;
}

/**
 * Escape is the keyboard's way out, so the focus goes back to the bell it came
 * from. A press outside has already put the focus where the reader wants it.
 */
export function focusAfterClose(by: ClosedBy, bell: FocusTarget | null): void {
  if (by === "escape" && bell?.isConnected) bell.focus();
}

export interface BellProps {
  /** Unread notifications, from `useNotificationsCount`. */
  unread: number;
  /** The count as the API last answered it, once rows have been marked read. */
  onUnread: (count: number) => void;
  /** Where the reader is: on the notifications page the bell opens nothing. */
  pathname: string;
}

export function Bell({ unread, onUnread, pathname }: BellProps) {
  const styles = bellStyles();
  const onPage = matchRoute(pathname).page === "notifications";
  const [open, setOpen] = useState(false);
  // Each opening asks for the list again (D19): the count of them is its key.
  const [opened, setOpened] = useState(0);
  const bell = useRef<HTMLAnchorElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const rows = useBell(open, opened, onUnread);

  // Known once there is a window to ask. Narrowed to a phone's width, the page
  // is the inbox and the popover goes.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(BESIDE_THE_RAIL);
    const onWidth = () => {
      setWide(query.matches);
      if (!query.matches) setOpen(false);
    };
    onWidth();
    query.addEventListener("change", onWidth);
    return () => query.removeEventListener("change", onWidth);
  }, []);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    return watchPopover(
      () => [bell.current, panel.current],
      (by) => {
        setOpen(false);
        focusAfterClose(by, bell.current);
      },
    );
  }, [open]);
  // A row, the settings and See all are links: arriving anywhere closes it.
  useEffect(() => setOpen(false), [pathname]);

  const allRead =
    unread === 0 &&
    !(rows.state.status === "ready" && rows.state.items.some(isUnread));

  return (
    <div className={styles.base()}>
      <Button
        {...routed(paths.notifications(), {
          onClick: (event) => {
            if (!opensPopover(event, wide, onPage)) return;
            event.preventDefault();
            if (!open) setOpened((n) => n + 1);
            setOpen(!open);
          },
        })}
        ref={bell}
        variant="pill"
        size="sm"
        icon
        className={styles.bell()}
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
        }
        // Only where a press opens something: elsewhere it is a link and no more.
        aria-haspopup={wide && !onPage ? "dialog" : undefined}
        aria-expanded={wide && !onPage ? open : undefined}
        aria-current={onPage ? "page" : undefined}
      >
        <BellIcon size={15} aria-hidden="true" />
        <Count value={unread} className={styles.count()} />
      </Button>
      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label="Notifications"
          tabIndex={-1}
          className={styles.panel()}
          // A link inside it was followed, even to the page already open.
          onClick={(event) => {
            if ((event.target as Element).closest("a")) setOpen(false);
          }}
        >
          <div className={styles.head()}>
            <h2 className={styles.title()}>Notifications</h2>
            <NotificationTools allRead={allRead} onMarkAll={rows.markAll} />
          </div>
          {rows.failure && <Notice kind="warn">{rows.failure}</Notice>}
          <NotificationRows
            state={rows.state}
            limit={POPOVER_ROWS}
            onOpen={rows.open}
            onRetry={rows.reload}
          />
          <a {...routed(paths.notifications())} className={styles.foot()}>
            See all notifications
          </a>
        </div>
      )}
    </div>
  );
}
