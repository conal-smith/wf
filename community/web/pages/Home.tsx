/**
 * Home: one feed across every channel, so a small community reads as one busy
 * room. Each row names its channel. The rail's search lands here too, as the
 * same list narrowed by `?q=`.
 */
import { SearchX } from "lucide-react";
import { useMemo } from "react";
import { useSiteAuth } from "../../../shared/web/auth";
import { usePageTitle } from "../../../shared/web/usePageTitle";
import { Button, Empty, PenLoop, Puffin } from "../../../ui";
import { tv } from "../../../ui/tv";
import { NewThread, NewThreadPill } from "../components/NewThreadDialog";
import { PageHead, dateline } from "../components/PageHead";
import { ThreadList } from "../components/ThreadList";
import { freshOf } from "../components/ThreadRow";
import {
  useThreadFeed,
  type ChannelsState,
  type FeedSource,
  type FeedState,
} from "../hooks";
import { NEW_THREAD, QUERY, paths, routed } from "../router";

export const homeStyles = tv({
  slots: {
    // The pen's loop round what is new: the one mark on the page.
    fresh: "font-semibold text-ink",
    query: "font-normal italic",
  },
});

/** A count of members never advertises an empty room: it waits for this many. */
export const MEMBERS_SHOWN_FROM = 50;

const grouped = new Intl.NumberFormat("en-IE");

/**
 * What is new on the threads in hand, in the rows' own units: threads never
 * opened, and replies since the last read on the rest. "3 new" summed across
 * both would count an opening post as a reply. Null when nothing is.
 */
export function newOnPage(state: FeedState): string | null {
  if (state.status !== "ready") return null;
  let threads = 0;
  let replies = 0;
  for (const thread of state.items) {
    const fresh = freshOf(thread);
    if (fresh?.kind === "thread") threads += 1;
    else if (fresh) replies += fresh.count;
  }
  const said = [
    threads && `${threads} new ${threads === 1 ? "thread" : "threads"}`,
    replies && `${replies} new ${replies === 1 ? "reply" : "replies"}`,
  ].filter(Boolean);
  return said.length ? said.join(" · ") : null;
}

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

  const fresh = newOnPage(feed.state);
  return (
    <>
      <PageHead
        dateline={q ? "Search" : dateline(new Date())}
        figures={
          <>
            {!q && members}
            {!q && members && fresh && " · "}
            {fresh && (
              <PenLoop seed={7}>
                <span className={styles.fresh()}>{fresh}</span>
              </PenLoop>
            )}
          </>
        }
        title={q ? <span className={styles.query()}>“{q}”</span> : "Latest"}
        // Signed out: what joining is for, said once and quietly, under the rule.
        lede={
          !q &&
          auth.loaded &&
          !auth.signedIn &&
          "Reading is open to everyone. Sign in to post, follow threads and hear when someone replies."
        }
      />
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
              icon={<SearchX size={24} strokeWidth={1.5} aria-hidden="true" />}
            >
              <p>Try fewer words, or other ones.</p>
              <Button {...routed(paths.home())} variant="pill">
                The latest threads
              </Button>
            </Empty>
          ) : (
            <Empty title="No threads yet" icon={<Puffin size={40} />}>
              <p>Nobody has written in. It could be you.</p>
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
