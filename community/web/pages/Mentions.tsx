/**
 * Mentions: every message that names the member, newest first. Each row is one
 * link to the message, inside its thread.
 */
import { AtSign, CloudOff, Hash } from "lucide-react";
import { useSiteAuth } from "../../../shared/web/auth";
import { usePageTitle } from "../../../shared/web/usePageTitle";
import { Avatar, Button, Empty, Notice, Pane, Skeleton } from "../../../ui";
import { RING, tv } from "../../../ui/tv";
import type { MentionItem, Message } from "../../shared/types";
import { MENTION_PATTERN } from "../../shared/validate";
import { MembersOnly } from "../components/MembersOnly";
import { ago } from "../components/ThreadRow";
import { useMentions } from "../hooks";
import { paths, routed } from "../router";

export const mentionsStyles = tv({
  slots: {
    head: "grid min-w-0 gap-2",
    title: "m-0 text-title text-ink",
    lede: "m-0 text-prose text-ink-2",
    base: "flex flex-col gap-3",
    pane: "overflow-hidden p-0",
    list: "m-0 flex list-none flex-col p-0",
    item: "border-t border-line first:border-t-0",
    row: [
      "flex items-start gap-5 p-5 text-ink no-underline transition-colors duration-fast",
      "not-disabled:hover:bg-ground max-rail:gap-3 max-rail:p-3",
      // Inside the pane's clipped corners, so the ring is drawn inwards.
      RING,
      "not-disabled:focus-visible:-outline-offset-3",
    ],
    avatar: "max-rail:size-control-sm max-rail:text-caption",
    main: "grid min-w-0 flex-1 gap-1",
    line: "m-0 text-prose text-ink-2",
    strong: "font-semibold text-ink",
    body: "m-0 line-clamp-2 text-prose text-ink-muted",
    meta: "m-0 flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-body text-ink-muted",
    channel:
      "inline-flex items-center gap-0.5 text-body font-semibold text-ink-2",
    loading: "flex items-center gap-5 p-5 max-rail:gap-3 max-rail:p-3",
    lines: "grid flex-1 gap-2",
    short: "w-1/3",
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
  const styles = mentionsStyles();
  usePageTitle("Mentions", "Community");
  return (
    <>
      <div className={styles.head()}>
        <h1 className={styles.title()}>Mentions</h1>
        <p className={styles.lede()}>
          Messages that mention you, newest first.
        </p>
      </div>
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
        className={styles.avatar()}
      />
      <span className={styles.main()}>
        <span className={styles.line()}>
          <span className={styles.strong()}>{message.author.displayName}</span>
          {" mentioned you in "}
          <span className={styles.strong()}>{thread.title}</span>
        </span>
        <span className={styles.body()}>{mentionText(message)}</span>
        <span className={styles.meta()}>
          <span className={styles.channel()}>
            <Hash size={12} aria-hidden="true" />
            {thread.channel.name}
          </span>
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
      <Pane className={styles.pane()} aria-busy="true">
        <span className={styles.hidden()}>Loading your mentions…</span>
        {[0, 1, 2].map((row) => (
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
        title="We could not load your mentions"
        icon={<CloudOff size={24} aria-hidden="true" />}
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
        icon={<AtSign size={24} aria-hidden="true" />}
      >
        <p>
          When someone writes @ and your handle in a message, it is listed here
          and the bell tells you.
        </p>
      </Empty>
    );
  return (
    <div className={styles.base()}>
      <Pane className={styles.pane()}>
        <ul className={styles.list()}>
          {state.items.map((item) => (
            <li key={item.message.id} className={styles.item()}>
              <MentionRow item={item} />
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
