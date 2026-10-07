/**
 * The channel rail: search, the three feeds, then every channel under its
 * category. The broadsheet's index: no pane, names in the display face on
 * hairlines, each category under its mono label, and the channel you are in
 * set as the site menu sets its section: italic, heavier, on the second sheet.
 */
import { ChevronDown, Lock } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button, Count, Notice, SearchField, Skeleton } from "../../ui";
import { MONO_LABEL, RING, tv } from "../../ui/tv";
import type { Channel } from "../shared/types";
import type { ChannelsState, RailGroup } from "./hooks";
import { navigate, paths, routed, type Route } from "./router";

export const railStyles = tv({
  slots: {
    base: "flex min-w-0 flex-col gap-5 font-body",
    group: "flex flex-col",
    list: "m-0 flex list-none flex-col p-0",
    heading: "m-0",
    // A category: its mono label over a rule in ink, as a column head is.
    head: [
      "group flex min-h-control-sm w-full cursor-pointer items-center justify-start gap-1 border-0 border-b border-ink px-2",
      "text-ink-muted pointer-coarse:min-h-touch not-disabled:hover:bg-transparent not-disabled:hover:text-ink",
      MONO_LABEL,
      RING,
    ],
    chevron:
      "-rotate-90 transition-transform duration-fast group-aria-expanded:rotate-0 motion-reduce:transition-none",
    row: [
      "flex min-h-9 items-center gap-2 border-b border-line px-2",
      "font-display text-prose whitespace-nowrap text-ink-2 no-underline transition-colors duration-fast",
      "not-disabled:hover:text-chart-magenta",
      // A row is a tap target on a phone, where the rail unfolds over the page.
      "max-rail:min-h-touch pointer-coarse:min-h-touch",
      RING,
    ],
    name: "min-w-0 flex-1 truncate",
    lock: "inline-flex text-ink-muted",
    hidden: "sr-only",
    loading: "flex flex-col gap-3 px-2 py-2",
    retry: "mt-1",
  },
  variants: {
    // Unread is weight and a count, never colour alone.
    unread: { true: { row: "font-semibold text-ink" } },
    // The menu's current row: italic, heavier, on the paper's second sheet,
    // with a little lift, and said with `aria-current`.
    current: {
      true: {
        row: "bg-sunken font-semibold text-ink italic shadow-control",
      },
    },
  },
});

/**
 * Which row of the rail a route lights, as that row's key. A thread lights
 * its channel, which the shell only knows once the thread's page has loaded
 * and said so; until then it lights none.
 */
export function railCurrent(
  route: Route,
  threadChannel: string | null = null,
): string | null {
  switch (route.page) {
    case "home":
    case "following":
    case "mentions":
      return route.page;
    case "channel":
      return channelKey(route.slug);
    case "thread":
      return threadChannel ? channelKey(threadChannel) : null;
    default:
      return null;
  }
}

const channelKey = (slug: string) => `c:${slug}`;

/**
 * What the lock on a channel means. Only the start of a thread is the team's:
 * anyone can reply in one, so "staff only" would say too much.
 */
export const TEAM_STARTS = "Only the team starts threads here";

/** Past four a count is filled; up to four it is quiet. Both are a number. */
const LOUD_FROM = 5;

function Row({
  to,
  current,
  unread = 0,
  locked = false,
  children,
}: {
  to: string;
  current: boolean;
  unread?: number;
  locked?: boolean;
  children: ReactNode;
}) {
  // The channel that is open is being read: it shows no count of its own.
  const count = current ? 0 : unread;
  const styles = railStyles({ current, unread: count > 0 });
  return (
    <li>
      <a
        {...routed(to)}
        className={styles.row()}
        aria-current={current ? "page" : undefined}
      >
        <span className={styles.name()}>{children}</span>
        {/* Said to the eye on hover, and on the channel's own page in words. */}
        {locked && (
          <span className={styles.lock()} title={TEAM_STARTS}>
            <Lock size={12} strokeWidth={1.5} aria-hidden="true" />
            <span className={styles.hidden()}>{TEAM_STARTS}</span>
          </span>
        )}
        <Count
          value={count}
          label="unread"
          tone={count >= LOUD_FROM ? "strong" : "quiet"}
        />
      </a>
    </li>
  );
}

function ChannelRow({
  channel,
  current,
}: {
  channel: Channel;
  current: string | null;
}) {
  const staffOnly = channel.postPolicy === "staff";
  return (
    <Row
      to={paths.channel(channel.slug)}
      current={current === channelKey(channel.slug)}
      unread={channel.unread}
      locked={staffOnly}
    >
      {channel.name}
    </Row>
  );
}

/** A category: a head that folds its channels away, open to begin with. */
function Group({
  group,
  current,
}: {
  group: RailGroup;
  current: string | null;
}) {
  const [open, setOpen] = useState(true);
  const listId = useId();
  const styles = railStyles();
  return (
    <section className={styles.group()}>
      <h2 className={styles.heading()}>
        <button
          type="button"
          className={styles.head()}
          aria-expanded={open}
          // The controlled element only exists while the list does.
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown
            className={styles.chevron()}
            size={11}
            strokeWidth={1.5}
            aria-hidden="true"
          />
          {group.category.name}
        </button>
      </h2>
      {open && (
        <ul id={listId} className={styles.list()}>
          {group.channels.map((channel) => (
            <ChannelRow key={channel.id} channel={channel} current={current} />
          ))}
        </ul>
      )}
    </section>
  );
}

export interface RailProps {
  state: ChannelsState;
  reload: () => void;
  /** The lit row's key, from `railCurrent`. */
  current: string | null;
  className?: string;
  /** For the control that unfolds it on a phone (`aria-controls`). */
  id?: string;
}

export function Rail({ state, reload, current, className, id }: RailProps) {
  const styles = railStyles();
  // Search is the home feed narrowed: the words ride in the URL as `q`.
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    if (q) navigate(paths.home(new URLSearchParams({ q })));
  };
  return (
    <nav id={id} className={styles.base({ className })} aria-label="Channels">
      <form role="search" onSubmit={search}>
        <SearchField
          name="q"
          size="md"
          placeholder="Search the community"
          aria-label="Search the community"
        />
      </form>
      <ul className={styles.list()}>
        <Row to={paths.home()} current={current === "home"}>
          Latest
        </Row>
        <Row to={paths.following()} current={current === "following"}>
          Following
        </Row>
        <Row to={paths.mentions()} current={current === "mentions"}>
          Mentions
        </Row>
      </ul>
      {state.status === "loading" && (
        <div className={styles.loading()} aria-busy="true">
          <span className={styles.hidden()}>Loading the channels…</span>
          <Skeleton />
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {state.status === "error" && (
        <Notice kind="warn">
          <p>{state.message}</p>
          <Button variant="link" className={styles.retry()} onClick={reload}>
            Try again
          </Button>
        </Notice>
      )}
      {state.status === "ready" &&
        state.groups.map((group) => (
          <Group key={group.category.id} group={group} current={current} />
        ))}
    </nav>
  );
}
