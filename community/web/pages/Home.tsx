/**
 * Home: one feed across every channel, so a small community reads as one busy
 * room. Each row names its channel. The rail's search lands here too, as the
 * same list narrowed by `?q=`.
 */
import { MessagesSquare, SearchX } from "lucide-react";
import { useMemo } from "react";
import { useSiteAuth } from "../../../shared/web/auth";
import { usePageTitle } from "../../../shared/web/usePageTitle";
import { Button, Empty } from "../../../ui";
import { tv } from "../../../ui/tv";
import { NewThread, NewThreadPill } from "../components/NewThreadDialog";
import { ThreadList } from "../components/ThreadList";
import { useThreadFeed, type ChannelsState, type FeedSource } from "../hooks";
import { NEW_THREAD, QUERY, paths, routed } from "../router";

export const homeStyles = tv({
  slots: {
    head: "grid min-w-0 gap-2",
    title: "m-0 text-title text-ink",
    lede: "m-0 text-prose text-ink-2",
    meta: "m-0 text-body text-ink-muted tabular-nums",
  },
});

/** A count of members never advertises an empty room: it waits for this many. */
export const MEMBERS_SHOWN_FROM = 50;

const grouped = new Intl.NumberFormat("en-IE");

/** "1,284 members", or nothing while there are too few to say so. */
export function membersLine(count: number | null): string | null {
  if (count === null || count < MEMBERS_SHOWN_FROM) return null;
  return `${grouped.format(count)} members`;
}

export interface HomeProps {
  channels: ChannelsState;
  /** The shell's `useChannels().reload`: a new thread changes a channel's counts. */
  onPosted: () => void;
  pathname: string;
  search: URLSearchParams;
}

export function Home({ channels, onPosted, pathname, search }: HomeProps) {
  const auth = useSiteAuth();
  const styles = homeStyles();
  const q = (search.get(QUERY) ?? "").trim();
  const source = useMemo<FeedSource>(
    () => (q ? { kind: "search", q } : { kind: "latest" }),
    [q],
  );
  const feed = useThreadFeed(source);
  usePageTitle(q ? `Search: ${q}` : "Latest", "Community");

  const members = membersLine(
    channels.status === "ready" ? channels.memberCount : null,
  );
  const every =
    channels.status === "ready"
      ? channels.groups.flatMap((group) => group.channels)
      : [];
  // Nobody can be signed in on a build with no provider: nothing to offer.
  const canStart = auth.provider !== "none";

  return (
    <>
      <div className={styles.head()}>
        <h1 className={styles.title()}>{q ? "Search" : "Community"}</h1>
        <p className={styles.lede()}>
          {q
            ? `Threads that mention “${q}”.`
            : "Gear, spots, technique and sessions, from wingfoilers around Ireland."}
        </p>
        {!q && members && <p className={styles.meta()}>{members}</p>}
      </div>
      <ThreadList
        state={feed.state}
        subject={q ? "the search results" : "the latest threads"}
        showChannel
        onRetry={feed.reload}
        onMore={feed.loadMore}
        empty={
          q ? (
            <Empty
              title={`Nothing found for “${q}”`}
              icon={<SearchX size={24} aria-hidden="true" />}
            >
              <p>Try fewer words, or another way of saying it.</p>
              <Button {...routed(paths.home())} variant="pill">
                Back to the latest threads
              </Button>
            </Empty>
          ) : (
            <Empty
              title="No threads yet"
              icon={<MessagesSquare size={24} aria-hidden="true" />}
            >
              <p>Nobody has started one. It could be you.</p>
              {canStart && (
                // Quiet: the view's filled New thread is the header's, or the
                // floating one on a phone.
                <Button {...routed(paths.newThread())} variant="pill">
                  Start the first one
                </Button>
              )}
            </Empty>
          )
        }
      />
      {/* While the dialog is up its Post thread is the filled one. */}
      {canStart && !search.has(NEW_THREAD) && (
        <NewThreadPill to={paths.newThread()} />
      )}
      <NewThread
        pathname={pathname}
        search={search}
        channel={null}
        channels={every}
        onPosted={onPosted}
      />
    </>
  );
}
