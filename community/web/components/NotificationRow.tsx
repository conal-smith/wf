/**
 * A row of the bell, and the list of them. The popover under the bell and the
 * page a phone gets instead draw the same rows: who, what they did, in which
 * thread, and when. The whole row is one link to the message, and opening it
 * is what marks it read.
 *
 * Replies arrive folded per thread and reactions per message (the API does
 * the folding); a mention stands alone and quotes the line that names the
 * reader. A reaction is quiet: it is listed and never marked unread.
 */
import { AtSign, Flag, Hash, MessageCircle, Settings } from "lucide-react";
import { Avatar, Button, Notice, Skeleton } from "../../../ui";
import { MONO_LABEL, RING, tv } from "../../../ui/tv";
import type { Notification } from "../../shared/types";
import type { PagedState } from "../hooks";
import { paths, routed } from "../router";
import { keepRanges } from "../thread";
import { ago } from "./ThreadRow";

export const notificationRowStyles = tv({
  slots: {
    // A note on the hairline under the last: who, what, where, and when.
    row: [
      "group flex items-start gap-3 border-b border-line px-1 py-3 text-ink no-underline transition-colors duration-fast",
      RING,
      "not-disabled:focus-visible:-outline-offset-2",
    ],
    // Two faces, the first named on top: overlapped by a quarter at most, so
    // the second's initials are still read, and each cut out of the other by a
    // ring of whatever paper the row is on.
    faces: "flex shrink-0 -space-x-1",
    face: "relative ring-2 first:z-1",
    text: "grid min-w-0 flex-1 gap-1 font-body text-prose text-ink-2",
    line: "m-0",
    strong:
      "font-display font-semibold text-ink group-hover:text-chart-magenta",
    quote: "m-0 truncate text-body text-ink-muted italic",
    meta: [
      "m-0 flex items-center gap-1 text-ink-muted tabular-nums",
      MONO_LABEL,
    ],
    dot: "mt-2 size-2 shrink-0 rounded-full bg-accent",
    list: "m-0 grid list-none p-0",
    loading: "flex items-center gap-3 border-b border-line px-1 py-3",
    lines: "grid flex-1 gap-2",
    short: "w-1/3",
    nothing: "m-0 px-1 py-3 font-body text-prose text-ink-muted italic",
    tools: "flex items-center gap-1",
    hidden: "sr-only",
  },
  variants: {
    // Unread is a dot, a tint and a word a screen reader hears: never colour alone.
    unread: { true: { row: "bg-sunken" } },
    // The paper under the faces' rings: the row's tint when unread, otherwise
    // the popover's card or the page's ground.
    paper: {
      card: { face: "ring-card" },
      ground: { face: "ring-ground" },
      sunken: { face: "ring-sunken" },
    },
  },
});

/** What a list of rows is laid on: the bell's popover, or the page. */
export type RowPaper = "card" | "ground";

/** A piece of a row's sentence. The names and the title are the strong ones. */
export interface LinePart {
  text: string;
  strong?: boolean;
}

/** How many of the people behind a row are named before the rest are counted. */
const NAMED = 2;

/** "Tomás B", "Tomás B and Niamh R", "Tomás B, Niamh R and 2 others". */
export function whoParts(
  row: Pick<Notification, "actors" | "actorCount">,
): LinePart[] {
  const names = row.actors.slice(0, NAMED).map((m) => m.displayName);
  if (!names.length) return [{ text: "Someone" }];
  const others = Math.max(row.actorCount, names.length) - names.length;
  const strong = names.map((text): LinePart => ({ text, strong: true }));
  const rest = others === 1 ? "1 other" : `${others} others`;
  if (others > 0)
    return [
      ...strong.flatMap((part, i) => (i ? [{ text: ", " }, part] : [part])),
      { text: ` and ${rest}` },
    ];
  return strong.flatMap((part, i) => (i ? [{ text: " and " }, part] : [part]));
}

const DID: Record<Notification["kind"], (row: Notification) => string> = {
  reply: () => "replied in",
  mention: () => "mentioned you in",
  thread: () => "started",
  reaction: (row) =>
    row.emoji
      ? `reacted ${row.emoji} to your message in`
      : "reacted to your message in",
  report: () => "reported a message in",
};

/** The row's sentence: who, what they did, and the thread it happened in. */
export function lineParts(row: Notification): LinePart[] {
  return [
    ...whoParts(row),
    { text: ` ${DID[row.kind](row)} ` },
    row.thread
      ? { text: keepRanges(row.thread.title), strong: true }
      : { text: "a thread that is gone" },
  ];
}

/** A reaction is listed and never unread: it raised no count either. */
export const isUnread = (row: Pick<Notification, "kind" | "readAt">) =>
  row.readAt === null && row.kind !== "reaction";

/** What kind of row it is, in the line under the sentence. Nothing for a reaction. */
export function kindLabel(row: Notification): string | null {
  switch (row.kind) {
    case "reply": {
      const fresh = isUnread(row) ? "new " : "";
      return row.count === 1
        ? `1 ${fresh}reply`
        : `${row.count} ${fresh}replies`;
    }
    case "mention":
      return "Mention";
    case "thread":
      return row.thread?.channel.name ?? null;
    case "report":
      return "Report";
    default:
      return null;
  }
}

const KIND_ICON = {
  reply: MessageCircle,
  mention: AtSign,
  thread: Hash,
  report: Flag,
  reaction: null,
} as const;

/** Where a row goes: the message it is about, inside its thread. */
export const rowTarget = (row: Notification) =>
  row.thread
    ? paths.message(row.thread.id, row.thread.slug, row.seq)
    : paths.notifications();

export interface NotificationRowProps {
  row: Notification;
  /** Opening a row is what marks it read. */
  onOpen: (row: Notification) => void;
  /** What the row is laid on, for the rings round its faces. */
  paper?: RowPaper;
  now?: Date;
}

export function NotificationRow({
  row,
  onOpen,
  paper = "ground",
  now,
}: NotificationRowProps) {
  const unread = isUnread(row);
  const styles = notificationRowStyles({
    unread,
    paper: unread ? "sunken" : paper,
  });
  const label = kindLabel(row);
  const Icon = KIND_ICON[row.kind];
  return (
    <a
      {...routed(rowTarget(row), { onClick: () => onOpen(row) })}
      className={styles.row()}
    >
      <span className={styles.faces()}>
        {row.actors.slice(0, NAMED).map((member) => (
          <Avatar
            key={member.id}
            name={member.displayName}
            src={member.avatarUrl}
            size="sm"
            className={styles.face()}
          />
        ))}
      </span>
      <span className={styles.text()}>
        <span className={styles.line()}>
          {lineParts(row).map((part, i) =>
            part.strong ? (
              <span key={i} className={styles.strong()}>
                {part.text}
              </span>
            ) : (
              part.text
            ),
          )}
        </span>
        {row.excerpt && <span className={styles.quote()}>{row.excerpt}</span>}
        <span className={styles.meta()}>
          {Icon && <Icon size={12} strokeWidth={1.5} aria-hidden="true" />}
          {label && `${label} · `}
          <time dateTime={row.updatedAt}>{ago(row.updatedAt, now)}</time>
        </span>
      </span>
      {unread && (
        <span className={styles.dot()}>
          <span className={styles.hidden()}>Unread</span>
        </span>
      )}
    </a>
  );
}

export interface NotificationRowsProps {
  state: PagedState<Notification>;
  /** The popover shows the first few; the page shows every row it has. */
  limit?: number;
  onOpen: (row: Notification) => void;
  onRetry: () => void;
  /** The bell's popover is card; the page is ground. */
  paper?: RowPaper;
  now?: Date;
}

/** The rows, or what stands in for them: loading, failed, or nothing new. */
export function NotificationRows({
  state,
  limit,
  onOpen,
  onRetry,
  paper,
  now,
}: NotificationRowsProps) {
  const styles = notificationRowStyles();
  if (state.status === "loading")
    return (
      <div aria-busy="true">
        <span className={styles.hidden()}>Loading your notifications…</span>
        {[0, 1, 2].map((n) => (
          <div key={n} className={styles.loading()}>
            <Skeleton shape="circle" />
            <span className={styles.lines()}>
              <Skeleton />
              <Skeleton className={styles.short()} />
            </span>
          </div>
        ))}
      </div>
    );
  if (state.status === "error")
    return (
      <Notice kind="warn">
        <p>{state.message}</p>
        <Button variant="pill" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </Notice>
    );
  if (!state.items.length)
    return (
      <p className={styles.nothing()}>
        Nothing new. Replies to what you follow, and mentions of you, show up
        here.
      </p>
    );
  return (
    <ul className={styles.list()}>
      {state.items.slice(0, limit).map((row) => (
        <li key={row.id}>
          <NotificationRow row={row} onOpen={onOpen} paper={paper} now={now} />
        </li>
      ))}
    </ul>
  );
}

export interface NotificationToolsProps {
  /** Nothing to mark: every row in hand is read, and the bell counts none. */
  allRead: boolean;
  onMarkAll: () => void;
}

/** Mark all read, and the way to the one setting following has. */
export function NotificationTools({
  allRead,
  onMarkAll,
}: NotificationToolsProps) {
  const styles = notificationRowStyles();
  return (
    <div className={styles.tools()}>
      <Button variant="link" disabled={allRead} onClick={onMarkAll}>
        Mark all read
      </Button>
      <Button
        {...routed(paths.settings())}
        size="sm"
        icon
        aria-label="Notification settings"
      >
        <Settings size={15} strokeWidth={1.5} aria-hidden="true" />
      </Button>
    </div>
  );
}
