/**
 * Mentions: every message that names the member, newest first. Each row is one
 * link to the message, inside its thread.
 */
import { AtSign } from "lucide-react";
import { useEffect, useState } from "react";
import { useSiteAuth } from "../../../shared/web/auth";
import { usePageTitle } from "../../../shared/web/usePageTitle";
import { Avatar, Button, Empty, Notice, Skeleton } from "../../../ui";
import { RING, tv } from "../../../ui/tv";
import type { MentionItem, Message } from "../../shared/types";
import { useApi } from "../api";
import { MENTION_PATTERN } from "../../shared/validate";
import { MembersOnly } from "../components/MembersOnly";
import { COMMUNITY, PageHead } from "../components/PageHead";
import { ago } from "../components/ThreadRow";
import { useMentions } from "../hooks";
import { paths, routed } from "../router";
import { keepRanges } from "../thread";

export const mentionsStyles = tv({
  slots: {
    base: "flex flex-col gap-4",
    // Rows in one soft card, a hairline between them, as the thread rows are.
    list: "m-0 flex list-none flex-col divide-y divide-line overflow-hidden rounded-surface bg-sunken p-0 on-card",
    // A message that names you.
    row: [
      "group flex items-start gap-3 px-4 py-4 text-ink no-underline transition-colors duration-fast",
      "not-disabled:hover:bg-line max-rail:py-3",
      RING,
      "not-disabled:focus-visible:-outline-offset-2",
    ],
    main: "grid min-w-0 flex-1 gap-1",
    line: "m-0 font-body text-prose text-ink-2",
    strong: "font-semibold text-ink",
    title:
      "font-semibold text-ink decoration-1 underline-offset-3 group-hover:underline",
    body: "m-0 line-clamp-2 font-body text-body text-ink-muted",
    meta: "m-0 flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 font-body text-body text-ink-muted tabular-nums",
    channel: "font-medium text-ink-2",
    loading: "grid gap-2 px-4 py-4",
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
      <PageHead dateline={COMMUNITY} title="Mentions" />
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
          <span className={styles.title()}>{keepRanges(thread.title)}</span>
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

/**
 * Nothing names them yet: say what would, in their own handle, which a new
 * member may not know they have. Asked for only here, where it is the news.
 */
function NoMentions() {
  const api = useApi();
  const [handle, setHandle] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    // Not knowing it, the line says it in general terms instead.
    api.me().then(
      (me) => {
        if (current) setHandle(me.handle);
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [api]);
  return (
    <Empty
      title="No mentions yet"
      icon={<AtSign size={24} strokeWidth={1.75} />}
    >
      <p>
        {handle ? (
          <>
            When someone writes <strong>@{handle}</strong> in a message, it is
            listed here and the bell tells you.
          </>
        ) : (
          "When someone writes @ and your handle in a message, it is listed here and the bell tells you."
        )}
      </p>
    </Empty>
  );
}

function Mentioned() {
  const styles = mentionsStyles();
  const { signedIn } = useSiteAuth();
  const { state, reload, loadMore } = useMentions(signedIn);

  if (state.status === "loading")
    return (
      <div className={styles.list()} aria-busy="true">
        {[0, 1, 2].map((row) => (
          <div key={row} className={styles.loading()}>
            <Skeleton className={styles.long()} />
            <Skeleton />
            <Skeleton className={styles.short()} />
          </div>
        ))}
        <span className={styles.hidden()}>Loading your mentions…</span>
      </div>
    );
  if (state.status === "error")
    return (
      <Notice
        level="warn"
        alert
        title="We could not load your mentions"
        action={
          <Button size="sm" onClick={reload}>
            Try again
          </Button>
        }
      >
        {state.message}
      </Notice>
    );
  if (!state.items.length) return <NoMentions />;
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
        <Notice level="warn" alert title="We could not load more mentions">
          {state.more.message}
        </Notice>
      )}
      {state.nextCursor !== null && (
        <Button
          variant="soft"
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
