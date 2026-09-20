/**
 * A thread, as a row of a list: who started it, what it is called, the last
 * thing said in it, and how much of it is new to the reader. The whole row is
 * one link to the thread.
 *
 * One markup for both widths. Beside the rail a row ends in a thumbnail and a
 * column of numbers; below the rail breakpoint those stand down and the same
 * numbers are written into the line under the title.
 */
import { Hash, MessageCircle, Pin } from "lucide-react";
import { Avatar, Chip } from "../../../ui";
import { RING, tv } from "../../../ui/tv";
import type { Member, Thread } from "../../shared/types";
import { MENTION_PATTERN } from "../../shared/validate";
import { paths, routed } from "../router";

export const threadRowStyles = tv({
  slots: {
    row: [
      "flex items-center gap-5 p-5 text-ink no-underline transition-colors duration-fast",
      "not-disabled:hover:bg-ground max-rail:items-start max-rail:gap-3 max-rail:p-3",
      // Inside the pane's clipped corners, so the ring is drawn inwards.
      RING,
      "not-disabled:focus-visible:-outline-offset-3",
    ],
    avatar: "self-start max-rail:size-control-sm max-rail:text-caption",
    main: "grid min-w-0 flex-1 gap-1",
    title:
      "m-0 flex items-baseline gap-2 text-lead font-normal text-ink-2 max-rail:text-prose",
    dot: "size-2 shrink-0 -translate-y-px rounded-full bg-accent",
    titleText: "min-w-0",
    preview: "m-0 truncate text-prose text-ink-muted",
    meta: "flex flex-wrap items-center gap-x-2 gap-y-1 pt-1",
    channel:
      "inline-flex items-center gap-0.5 text-body font-semibold text-ink-2",
    by: "text-body text-ink-muted",
    // The numbers, written into the line: only where the column is not drawn.
    inline: "rail:hidden",
    thumb:
      "h-14.25 w-19 shrink-0 rounded-control bg-sunken object-cover max-rail:hidden",
    stats: "grid w-28 shrink-0 justify-items-end gap-2 max-rail:hidden",
    counts: "flex items-center gap-1",
    fresh:
      "inline-flex h-5 items-center rounded-full bg-inverse px-2 text-caption leading-none font-semibold whitespace-nowrap text-ink-inverse tabular-nums",
    replies:
      "inline-flex items-center gap-1 text-body font-semibold text-ink-2 tabular-nums",
    faces: "flex -space-x-2",
    face: "ring-2 ring-card",
    when: "text-body whitespace-nowrap text-ink-muted",
    hidden: "sr-only",
    pinned: [
      "flex min-h-touch items-center gap-3 bg-ground px-5 py-3 text-prose text-ink no-underline transition-colors duration-fast",
      "not-disabled:hover:bg-sunken max-rail:px-3",
      RING,
      "not-disabled:focus-visible:-outline-offset-3",
    ],
    pin: "shrink-0 text-ink-muted",
    pinnedTitle: "min-w-0 flex-1 truncate font-semibold",
  },
  variants: {
    // Unread is weight, a dot and a count, never colour alone.
    unread: { true: { title: "font-semibold text-ink" } },
  },
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const dayAndMonth = new Intl.DateTimeFormat("en-IE", {
  day: "numeric",
  month: "short",
});
const dayMonthYear = new Intl.DateTimeFormat("en-IE", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** How long ago, as a reader would say it. Past a week it is the date. */
export function ago(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const elapsed = now.getTime() - then.getTime();
  if (elapsed < MINUTE) return "Just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  const days = Math.floor(elapsed / DAY);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return (
    then.getFullYear() === now.getFullYear() ? dayAndMonth : dayMonthYear
  ).format(then);
}

/** Past this the number stops being read, so it stops being counted. */
const MOST_NEW = 99;

export const newCount = (unread: number) =>
  unread > MOST_NEW ? `${MOST_NEW}+ new` : `${unread} new`;

export const replyWords = (count: number) =>
  count === 1 ? "1 reply" : `${count} replies`;

/**
 * The line under the title. A body keeps a mention as <@user_id>; the row
 * knows the few people around the thread, and names the ones it can. A reply
 * is led by who said it; the opening post is the author's, who is named below.
 */
export function previewLine(thread: Thread): string | null {
  if (!thread.preview) return null;
  const known: Member[] = [
    thread.author,
    thread.preview.author,
    ...thread.participants,
  ];
  const text = thread.preview.text.replace(MENTION_PATTERN, (_, id: string) => {
    const member = known.find((m) => m.id === id);
    return member ? `@${member.handle}` : "@member";
  });
  return thread.replyCount > 0
    ? `${thread.preview.author.displayName}: ${text}`
    : text;
}

export interface ThreadRowProps {
  thread: Thread;
  /** Name the channel on the row: everywhere but inside the channel itself. */
  showChannel: boolean;
  /** Draw a pinned thread as the one quiet line it is at the head of a channel. */
  pinnedLine?: boolean;
  now?: Date;
}

export function ThreadRow({
  thread,
  showChannel,
  pinnedLine = false,
  now,
}: ThreadRowProps) {
  const unread = thread.unread ?? 0;
  const styles = threadRowStyles({ unread: unread > 0 });
  const to = routed(paths.thread(thread.id, thread.slug));

  if (pinnedLine && thread.pinned)
    return (
      <a {...to} className={styles.pinned()}>
        <Pin className={styles.pin()} size={16} aria-hidden="true" />
        <span className={styles.pinnedTitle()}>{thread.title}</span>
        {unread > 0 && (
          <span className={styles.fresh()}>{newCount(unread)}</span>
        )}
        <Chip>Pinned</Chip>
      </a>
    );

  const preview = previewLine(thread);
  const when = (
    <time dateTime={thread.lastMessageAt}>
      {ago(thread.lastMessageAt, now)}
    </time>
  );
  return (
    <a {...to} className={styles.row()}>
      <Avatar
        name={thread.author.displayName}
        src={thread.author.avatarUrl}
        className={styles.avatar()}
      />
      <div className={styles.main()}>
        <h2 className={styles.title()}>
          {unread > 0 && <span className={styles.dot()} aria-hidden="true" />}
          <span className={styles.titleText()}>{thread.title}</span>
        </h2>
        {preview && <p className={styles.preview()}>{preview}</p>}
        <div className={styles.meta()}>
          {showChannel && (
            <span className={styles.channel()}>
              <Hash size={12} aria-hidden="true" />
              {thread.channel.name}
            </span>
          )}
          {thread.tags.map((tag) => (
            <Chip key={tag.id}>{tag.label}</Chip>
          ))}
          <span className={styles.by()}>
            {thread.author.displayName}
            <span className={styles.inline()}>
              {thread.replyCount > 0 && ` · ${replyWords(thread.replyCount)}`}
              {" · "}
              {when}
            </span>
          </span>
          {unread > 0 && (
            <span className={styles.fresh({ className: styles.inline() })}>
              {newCount(unread)}
            </span>
          )}
        </div>
      </div>
      {thread.thumbnail && (
        <img
          className={styles.thumb()}
          src={thread.thumbnail.url}
          alt=""
          loading="lazy"
        />
      )}
      <div className={styles.stats()}>
        <span className={styles.counts()}>
          {unread > 0 && (
            <span className={styles.fresh()}>{newCount(unread)}</span>
          )}
          {thread.replyCount > 0 && (
            <span className={styles.replies()}>
              <MessageCircle size={14} aria-hidden="true" />
              {thread.replyCount}
              <span className={styles.hidden()}>
                {thread.replyCount === 1 ? " reply" : " replies"}
              </span>
            </span>
          )}
        </span>
        {thread.participants.length > 0 && (
          <span className={styles.faces()}>
            {thread.participants.slice(0, 3).map((member) => (
              <Avatar
                key={member.id}
                name={member.displayName}
                src={member.avatarUrl}
                size="sm"
                className={styles.face()}
              />
            ))}
          </span>
        )}
        <span className={styles.when()}>{when}</span>
      </div>
    </a>
  );
}
