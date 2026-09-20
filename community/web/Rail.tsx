/**
 * The channel rail: search, the three feeds, then every channel under its
 * category. No pane: the rail stands on the ground, and the channel you are in
 * is the one lifted thing in it, the way the site menu marks a section.
 */
import {
  AtSign,
  Bell,
  ChevronDown,
  Hash,
  Home,
  Lock,
  Megaphone,
  type LucideIcon,
} from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button, Count, Notice, SearchField, Skeleton } from "../../ui";
import { HOVER, RING, tv } from "../../ui/tv";
import type { Channel } from "../shared/types";
import type { ChannelsState, RailGroup } from "./hooks";
import { navigate, paths, routed, type Route } from "./router";

export const railStyles = tv({
  slots: {
    base: "flex min-w-0 flex-col gap-5 font-sans",
    group: "flex flex-col gap-0.5",
    list: "m-0 flex list-none flex-col gap-0.5 p-0",
    heading: "m-0",
    head: [
      "group flex min-h-control-sm w-full cursor-pointer items-center justify-start gap-1 rounded-control px-3",
      "text-eyebrow text-ink-muted uppercase pointer-coarse:min-h-touch",
      RING,
      HOVER,
    ],
    chevron:
      "-rotate-90 text-line-strong transition-transform duration-fast group-aria-expanded:rotate-0 motion-reduce:transition-none",
    row: [
      "flex min-h-9 items-center gap-2 rounded-control pr-2 pl-3",
      "text-prose whitespace-nowrap text-ink-muted no-underline transition-colors duration-fast",
      // A row is a tap target on a phone, where the rail is the whole page.
      "max-rail:min-h-touch pointer-coarse:min-h-touch",
      RING,
      HOVER,
    ],
    icon: "text-line-strong",
    name: "min-w-0 flex-1 truncate",
    lock: "inline-flex text-ink-muted",
    hidden: "sr-only",
    loading: "flex flex-col gap-3 px-3 py-2",
    retry: "mt-1",
  },
  variants: {
    // Unread is weight and a count, never colour alone.
    unread: { true: { row: "font-semibold text-ink" } },
    // Raised and filled as well as heavier, and said with `aria-current`.
    current: {
      true: {
        row: "bg-card font-semibold text-ink shadow-control not-disabled:hover:bg-card",
        icon: "text-ink-2",
      },
    },
  },
});

/**
 * Which row of the rail a route lights, as that row's key. A thread lights
 * none: the shell does not know a thread's channel until its page has loaded.
 */
export function railCurrent(route: Route): string | null {
  switch (route.page) {
    case "home":
    case "following":
    case "mentions":
      return route.page;
    case "channel":
      return channelKey(route.slug);
    default:
      return null;
  }
}

const channelKey = (slug: string) => `c:${slug}`;

/** Past four a count is filled; up to four it is quiet. Both are a number. */
const LOUD_FROM = 5;

function Row({
  to,
  icon: Icon,
  current,
  unread = 0,
  locked = false,
  children,
}: {
  to: string;
  icon: LucideIcon;
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
        <Icon className={styles.icon()} size={16} aria-hidden="true" />
        <span className={styles.name()}>{children}</span>
        {locked && (
          <span className={styles.lock()}>
            <Lock size={12} aria-hidden="true" />
            <span className={styles.hidden()}>staff posts only</span>
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
      icon={staffOnly ? Megaphone : Hash}
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
}

export function Rail({ state, reload, current, className }: RailProps) {
  const styles = railStyles();
  // Search is the home feed narrowed: the words ride in the URL as `q`.
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    if (q) navigate(paths.home(new URLSearchParams({ q })));
  };
  return (
    <nav className={styles.base({ className })} aria-label="Channels">
      <form role="search" onSubmit={search}>
        <SearchField
          name="q"
          size="md"
          placeholder="Search the community"
          aria-label="Search the community"
        />
      </form>
      <ul className={styles.list()}>
        <Row to={paths.home()} icon={Home} current={current === "home"}>
          Latest
        </Row>
        <Row
          to={paths.following()}
          icon={Bell}
          current={current === "following"}
        >
          Following
        </Row>
        <Row
          to={paths.mentions()}
          icon={AtSign}
          current={current === "mentions"}
        >
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
