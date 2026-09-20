/**
 * A channel: its name and two counts, the one filter it has (its tags), and its
 * threads in the one order there is: pinned first, then most recent activity,
 * so a reply bumps a thread.
 */
import { Bell, BellRing, Compass, Hash, Megaphone, Tag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSiteAuth } from "../../../shared/web/auth";
import { usePageTitle } from "../../../shared/web/usePageTitle";
import type { UserRole } from "../../../site/shared/types";
import { Button, Empty, Notice, Skeleton } from "../../../ui";
import { tv } from "../../../ui/tv";
import type { Channel as ChannelData } from "../../shared/types";
import { useApi } from "../api";
import { NewThread, NewThreadPill } from "../components/NewThreadDialog";
import { currentTag, TagPills } from "../components/TagPills";
import { ThreadList } from "../components/ThreadList";
import {
  findChannel,
  useThreadFeed,
  type ChannelsState,
  type FeedSource,
} from "../hooks";
import { NEW_THREAD, TAG, paths, routed } from "../router";

export const channelStyles = tv({
  slots: {
    head: "flex items-start justify-between gap-5",
    text: "grid min-w-0 gap-2",
    title: "m-0 flex items-center gap-2 text-title text-ink",
    hash: "shrink-0 text-line-strong",
    lede: "m-0 text-prose text-ink-2",
    // On a phone the head is the name and the bell: mockup 6b.
    aside: "max-rail:hidden",
    meta: "m-0 text-body text-ink-muted tabular-nums",
    actions: "flex shrink-0 items-center gap-2",
    followLabel: "max-rail:sr-only",
    controls: "flex flex-wrap items-center justify-between gap-3",
    order: "text-body text-ink-muted max-rail:hidden",
    loading: "grid gap-3",
    short: "w-1/3",
    hidden: "sr-only",
  },
});

const grouped = new Intl.NumberFormat("en-IE");

/** "412 threads · 640 following": the two counters a channel keeps anyway. */
export function countsLine(
  channel: Pick<ChannelData, "threadCount" | "followerCount">,
): string {
  const threads = channel.threadCount === 1 ? "thread" : "threads";
  return `${grouped.format(channel.threadCount)} ${threads} · ${grouped.format(channel.followerCount)} following`;
}

/**
 * Whether this reader is offered New thread here. An archived channel takes
 * none; a channel the site's team posts in offers it to them alone. A reader
 * who is signed out is offered it like a member: signing in comes first.
 */
export function canStartThread(
  channel: Pick<ChannelData, "postPolicy" | "status">,
  role: UserRole | null,
): boolean {
  if (channel.status !== "active") return false;
  return channel.postPolicy === "everyone" || role === "staff";
}

export interface ChannelProps {
  slug: string;
  channels: ChannelsState;
  /** The member's role where it matters, from the shell's `useViewerRole`. */
  role: UserRole | null;
  pathname: string;
  search: URLSearchParams;
}

export function Channel({
  slug,
  channels,
  role,
  pathname,
  search,
}: ChannelProps) {
  const styles = channelStyles();
  const listed = findChannel(channels, slug);
  usePageTitle(listed?.name ?? "Channel", "Community");

  if (channels.status === "loading")
    return (
      <div className={styles.loading()} aria-busy="true">
        <span className={styles.hidden()}>Loading the channel…</span>
        <Skeleton className={styles.short()} />
        <Skeleton />
      </div>
    );
  // The rail beside this says what went wrong, and holds the way to try again.
  if (channels.status === "error")
    return (
      <Notice kind="warn">
        <p>This channel could not be loaded.</p>
      </Notice>
    );
  if (!listed)
    return (
      <Empty
        title="That channel does not exist"
        icon={<Compass size={24} aria-hidden="true" />}
      >
        <p>The link may be old, or the channel may have been archived.</p>
        <Button {...routed(paths.home())} variant="pill">
          Back to the community
        </Button>
      </Empty>
    );
  return (
    <Listed
      key={listed.id}
      listed={listed}
      channels={channels}
      role={role}
      pathname={pathname}
      search={search}
    />
  );
}

function Listed({
  listed,
  channels,
  role,
  pathname,
  search,
}: Omit<ChannelProps, "slug"> & { listed: ChannelData }) {
  const api = useApi();
  const auth = useSiteAuth();
  const styles = channelStyles();

  // Following answers with the channel as it now stands: that is kept over
  // the rail's copy, which would have to load everything again to catch up.
  const [followed, setFollowed] = useState<ChannelData | null>(null);
  const [following, setFollowing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => setFollowed(null), [listed]);
  const channel = followed ?? listed;

  const tag = currentTag(channel.tags, search.get(TAG));
  const tagId = tag?.id ?? null;
  const source = useMemo<FeedSource>(
    () => ({ kind: "channel", slug: channel.slug, tagId }),
    [channel.slug, tagId],
  );
  const feed = useThreadFeed(source);

  const canStart = auth.provider !== "none" && canStartThread(channel, role);
  const Mark = channel.postPolicy === "staff" ? Megaphone : Hash;

  const follow = async () => {
    // Signed out, following is what signing in is for.
    if (!auth.signedIn) return auth.signIn();
    setFollowing(true);
    setFailure(null);
    try {
      setFollowed(await api.followChannel(channel.slug, !channel.following));
    } catch (e) {
      setFailure(
        e instanceof Error ? e.message : "That did not work. Try again.",
      );
    } finally {
      setFollowing(false);
    }
  };

  return (
    <>
      <div className={styles.head()}>
        <div className={styles.text()}>
          <h1 className={styles.title()}>
            <Mark className={styles.hash()} size={24} aria-hidden="true" />
            {channel.name}
          </h1>
          {channel.description && (
            <p className={styles.lede({ className: styles.aside() })}>
              {channel.description}
            </p>
          )}
          <p className={styles.meta({ className: styles.aside() })}>
            {countsLine(channel)}
          </p>
        </div>
        {auth.provider !== "none" && (
          <div className={styles.actions()}>
            <Button
              variant="pill"
              size="sm"
              pressed={Boolean(channel.following)}
              disabled={following || !auth.loaded}
              onClick={follow}
            >
              {channel.following ? (
                <BellRing size={15} aria-hidden="true" />
              ) : (
                <Bell size={15} aria-hidden="true" />
              )}
              {/* Pressed says which; the words stay the same, as a toggle's do. */}
              <span className={styles.followLabel()}>Follow channel</span>
            </Button>
          </div>
        )}
      </div>
      {failure && <Notice kind="warn">{failure}</Notice>}
      <div className={styles.controls()}>
        <TagPills slug={channel.slug} tags={channel.tags} current={tagId} />
        <span className={styles.order()}>Most recent activity first</span>
      </div>
      <ThreadList
        state={feed.state}
        subject={`the threads in ${channel.name}`}
        showChannel={false}
        pinnedLines
        onRetry={feed.reload}
        onMore={feed.loadMore}
        empty={
          tag ? (
            <Empty
              title={`No threads tagged ${tag.label}`}
              icon={<Tag size={24} aria-hidden="true" />}
            >
              <Button {...routed(paths.channel(channel.slug))} variant="pill">
                Show every thread
              </Button>
            </Empty>
          ) : (
            <Empty
              title="No threads yet"
              icon={<Mark size={24} aria-hidden="true" />}
            >
              {canStart ? (
                <>
                  <p>Nobody has started one here. It could be you.</p>
                  {/* Quiet: the view's filled New thread is the header's, or
                      the floating one on a phone. */}
                  <Button
                    {...routed(paths.newThread(channel.slug))}
                    variant="pill"
                  >
                    Start the first one
                  </Button>
                </>
              ) : (
                <p>When the site’s team posts here, it will show up first.</p>
              )}
            </Empty>
          )
        }
      />
      {/* While the dialog is up its Post thread is the filled one. */}
      {canStart && !search.has(NEW_THREAD) && (
        <NewThreadPill to={paths.newThread(channel.slug)} />
      )}
      {canStart && (
        <NewThread
          pathname={pathname}
          search={search}
          channel={channel}
          channels={
            channels.status === "ready"
              ? channels.groups.flatMap((group) => group.channels)
              : []
          }
        />
      )}
    </>
  );
}
