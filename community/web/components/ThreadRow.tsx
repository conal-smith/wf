/**
 * A thread, as a row of a list: a letter on the letters page. A dateline in
 * the mono label (its channel, its tags, when it last moved), the title in the
 * display face, the last thing said in it, and who started it. The whole row
 * is one link to the thread.
 *
 * One markup for both widths. Beside the rail a row ends in a thumbnail and
 * a column of figures; below the rail breakpoint those stand down and the same
 * figures are written into the byline.
 */
import { Pin } from "lucide-react";
import type { ReactNode } from "react";
import { Figure } from "../../../ui";
import { MONO_LABEL, RING, tv } from "../../../ui/tv";
import type { FollowReason, Member, Thread } from "../../shared/types";
import { MENTION_PATTERN } from "../../shared/validate";
import { paths, routed } from "../router";

export const threadRowStyles = tv({
  slots: {
    // Rows divided by hairlines, on the page's own paper: no box round them.
    row: [
      "group flex items-start gap-5 border-b border-line py-4 text-ink no-underline transition-colors duration-fast",
      "max-rail:gap-3 max-rail:py-3",
      RING,
      "not-disabled:focus-visible:-outline-offset-2",
    ],
    main: "grid min-w-0 flex-1 gap-1",
    // The letter's dateline: where it was sent from, and when it last moved.
    dateline: [
      "m-0 flex min-w-0 items-baseline gap-2 text-ink-muted tabular-nums",
      MONO_LABEL,
    ],
    where: "flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2",
    channel: "font-semibold text-ink-2",
    why: "text-ink-2",
    when: "shrink-0 whitespace-nowrap",
    title: [
      "m-0 flex items-baseline gap-2 font-display text-lead font-normal text-balance text-ink-2",
      "transition-colors duration-fast group-hover:text-chart-magenta max-rail:text-prose",
    ],
    dot: "size-2 shrink-0 -translate-y-0.5 rounded-full bg-accent",
    titleText: "min-w-0",
    preview: "m-0 truncate font-body text-prose text-ink-muted",
    byline:
      "m-0 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-caption text-ink-muted tabular-nums",
    by: "font-display text-body font-semibold text-ink-2",
    // The figures, written into the byline: only where the column is not drawn.
    inline: "rail:hidden",
    thumb:
      "h-14.25 w-19 shrink-0 border border-line bg-sunken object-cover max-rail:hidden",
    // The column of figures: replies, and how many of them are new.
    stats:
      "grid w-20 shrink-0 justify-items-end gap-1 pt-4 text-right max-rail:hidden",
    statsLabel: ["text-ink-muted", MONO_LABEL],
    fresh: [
      "inline-flex h-5 items-center rounded-full bg-inverse px-2 leading-none whitespace-nowrap text-ink-inverse tabular-nums",
      MONO_LABEL,
    ],
    hidden: "sr-only",
    pinned: [
      "group flex min-h-touch items-center gap-3 border-b border-line py-2 text-prose text-ink no-underline transition-colors duration-fast",
      RING,
      "not-disabled:focus-visible:-outline-offset-2",
    ],
    pin: "shrink-0 text-ink-muted",
    pinnedTitle:
      "min-w-0 flex-1 truncate font-display font-semibold italic transition-colors duration-fast group-hover:text-chart-magenta",
    pinnedLabel: ["shrink-0 text-ink-muted", MONO_LABEL],
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

/** Why a thread is in the Following feed, as the row says it. */
export const WHY: Record<FollowReason, string> = {
  started: "You started this",
  replied: "You replied",
  followed: "You follow this thread",
  channel: "You follow this channel",
};

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

/** Parts of a line, with the chart's middle dot between them. */
function dot(parts: ReactNode[]): ReactNode[] {
  return parts.flatMap((part, i) =>
    i
      ? [
          <span key={`dot-${i}`} aria-hidden="true">
            ·
          </span>,
          part,
        ]
      : [part],
  );
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
        <Pin
          className={styles.pin()}
          size={15}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <span className={styles.pinnedTitle()}>{thread.title}</span>
        {unread > 0 && (
          <span className={styles.fresh()}>{newCount(unread)}</span>
        )}
        <span className={styles.pinnedLabel()}>Pinned</span>
      </a>
    );

  const preview = previewLine(thread);
  const replies = thread.replyCount;
  return (
    <a {...to} className={styles.row()}>
      <div className={styles.main()}>
        <p className={styles.dateline()}>
          <span className={styles.where()}>
            {dot(
              [
                showChannel && (
                  <span key="channel" className={styles.channel()}>
                    {thread.channel.name}
                  </span>
                ),
                ...thread.tags.map((tag) => (
                  <span key={tag.id}>{tag.label}</span>
                )),
                thread.why && (
                  <span key="why" className={styles.why()}>
                    {WHY[thread.why]}
                  </span>
                ),
              ].filter(Boolean),
            )}
          </span>
          <time className={styles.when()} dateTime={thread.lastMessageAt}>
            {ago(thread.lastMessageAt, now)}
          </time>
        </p>
        <h2 className={styles.title()}>
          {unread > 0 && <span className={styles.dot()} aria-hidden="true" />}
          <span className={styles.titleText()}>{thread.title}</span>
        </h2>
        {preview && <p className={styles.preview()}>{preview}</p>}
        <p className={styles.byline()}>
          <span className={styles.by()}>{thread.author.displayName}</span>
          {replies > 0 && (
            <span className={styles.inline()}>· {replyWords(replies)}</span>
          )}
          {unread > 0 && (
            <span className={styles.fresh({ className: styles.inline() })}>
              {newCount(unread)}
            </span>
          )}
        </p>
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
        {replies > 0 && (
          <>
            <Figure value={replies} label={replyWords(replies)} />
            <span className={styles.statsLabel()} aria-hidden="true">
              {replies === 1 ? "reply" : "replies"}
            </span>
          </>
        )}
        {unread > 0 && (
          <span className={styles.fresh()}>{newCount(unread)}</span>
        )}
      </div>
    </a>
  );
}
