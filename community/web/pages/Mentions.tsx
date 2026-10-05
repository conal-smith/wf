/**
 * Mentions: every message that names the member, newest first. Each row is one
 * link to the message, inside its thread.
 */
import { AtSign, CloudOff } from "lucide-react";
import { useSiteAuth } from "../../../shared/web/auth";
import { usePageTitle } from "../../../shared/web/usePageTitle";
import { Avatar, Button, Empty, Notice, Skeleton } from "../../../ui";
import { MONO_LABEL, RING, tv } from "../../../ui/tv";
import type { MentionItem, Message } from "../../shared/types";
import { MENTION_PATTERN } from "../../shared/validate";
import { MembersOnly } from "../components/MembersOnly";
import { PageHead, dateline } from "../components/PageHead";
import { ago } from "../components/ThreadRow";
import { useMentions } from "../hooks";
import { paths, routed } from "../router";

export const mentionsStyles = tv({
  slots: {
    base: "flex flex-col gap-4",
    list: "m-0 flex list-none flex-col p-0",
    // A letter that names you: on a hairline, as the thread rows are.
    row: [
      "group flex items-start gap-3 border-b border-line py-4 text-ink no-underline transition-colors duration-fast",
      "max-rail:py-3",
      RING,
      "not-disabled:focus-visible:-outline-offset-2",
    ],
    main: "grid min-w-0 flex-1 gap-1",
    line: "m-0 font-body text-prose text-ink-2",
    strong: "font-display font-semibold text-ink",
    title:
      "font-display font-semibold text-ink transition-colors duration-fast group-hover:text-chart-magenta",
    body: "m-0 line-clamp-2 font-body text-prose text-ink-muted italic",
    meta: [
      "m-0 flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-ink-muted tabular-nums",
      MONO_LABEL,
    ],
    channel: "font-semibold text-ink-2",
    loading: "grid gap-2 border-b border-line py-4",
    short: "w-1/4",
    long: "h-4 w-3/4",
    more: "self-center",
    hidden: "sr-only",
  },
});

/**
 * A message's words as a row shows them: each <@user_id> as the @name of the
 * member the API sent with it, and the line breaks taken out.
 */
export function mentionText(message: Pick<Message, "body" | "mentions">) {
  return message.body
    .replace(MENTION_PATTERN, (_, id: string) => {
      const member = message.mentions.find((m) => m.id === id);
      return member ? `@${member.displayName}` : "@member";
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function Mentions() {
  usePageTitle("Mentions", "Community");
  return (
    <>
      <PageHead dateline={dateline(new Date())} title="Mentions" />
      <MembersOnly what="your mentions">
        <Mentioned />
      </MembersOnly>
    </>
  );
}

export function MentionRow({ item, now }: { item: MentionItem; now?: Date }) {
  const styles = mentionsStyles();
  const { message, thread } = item;
  return (
    <a
      {...routed(paths.message(thread.id, thread.slug, message.seq))}
      className={styles.row()}
    >
      <Avatar
        name={message.author.displayName}
        src={message.author.avatarUrl}
        size="sm"
      />
      <span className={styles.main()}>
        <span className={styles.line()}>
          <span className={styles.strong()}>{message.author.displayName}</span>
          {" mentioned you in "}
          <span className={styles.title()}>{thread.title}</span>
        </span>
        <span className={styles.body()}>{mentionText(message)}</span>
        <span className={styles.meta()}>
          <span className={styles.channel()}>{thread.channel.name}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={message.createdAt}>
            {ago(message.createdAt, now)}
          </time>
        </span>
      </span>
    </a>
  );
}

function Mentioned() {
  const styles = mentionsStyles();
  const { signedIn } = useSiteAuth();
  const { state, reload, loadMore } = useMentions(signedIn);

  if (state.status === "loading")
    return (
      <div aria-busy="true">
        <span className={styles.hidden()}>Loading your mentions…</span>
        {[0, 1, 2].map((row) => (
          <div key={row} className={styles.loading()}>
            <Skeleton className={styles.long()} />
            <Skeleton />
            <Skeleton className={styles.short()} />
          </div>
        ))}
      </div>
    );
  if (state.status === "error")
    return (
      <Empty
        kind="warn"
        title="We could not load your mentions"
        icon={<CloudOff size={24} strokeWidth={1.5} aria-hidden="true" />}
      >
        <p role="alert">{state.message}</p>
        <Button variant="pill" onClick={reload}>
          Try again
        </Button>
      </Empty>
    );
  if (!state.items.length)
    return (
      <Empty
        title="No mentions yet"
        icon={<AtSign size={24} strokeWidth={1.5} aria-hidden="true" />}
      >
        <p>
          When someone writes @ and your handle in a message, it is listed here
          and the bell tells you.
        </p>
      </Empty>
    );
  return (
    <div className={styles.base()}>
      <ul className={styles.list()}>
        {state.items.map((item) => (
          <li key={item.message.id}>
            <MentionRow item={item} />
          </li>
        ))}
      </ul>
      {state.more.status === "error" && (
        <Notice kind="warn">
          <p>{state.more.message}</p>
        </Notice>
      )}
      {state.nextCursor !== null && (
        <Button
          variant="pill"
          className={styles.more()}
          disabled={state.more.status === "loading"}
          onClick={loadMore}
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
