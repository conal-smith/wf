/**
 * Following: the channels a member chose to follow, as pills, then the threads
 * they follow and the new threads in those channels, most recent activity
 * first. Each row says why it is there. A thread is followed by starting it or
 * replying to it (D19), so this page is mostly a member's own conversations.
 */
import { Hash } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useSiteAuth } from "../../../shared/web/auth";
import { usePageTitle } from "../../../shared/web/usePageTitle";
import { Button, Empty, Notice, Puffin } from "../../../ui";
import { MONO_LABEL, tv } from "../../../ui/tv";
import type { Channel } from "../../shared/types";
import { useApi } from "../api";
import { MembersOnly } from "../components/MembersOnly";
import { PageHead, dateline } from "../components/PageHead";
import { ThreadList } from "../components/ThreadList";
import { useThreadFeed, type ChannelsState, type FeedSource } from "../hooks";
import { paths, routed } from "../router";

export const followingStyles = tv({
  slots: {
    channels: "flex flex-wrap items-center gap-2",
    label: ["text-ink-muted", MONO_LABEL],
    none: "m-0 font-body text-body text-ink-muted italic",
  },
});

/** The channels a member follows, in the rail's order. */
export function followedChannels(state: ChannelsState): Channel[] {
  if (state.status !== "ready") return [];
  return state.groups.flatMap((group) =>
    group.channels.filter((channel) => channel.following),
  );
}

const FOLLOWING: FeedSource = { kind: "following" };

export interface FollowingProps {
  channels: ChannelsState;
  /** The shell's `useChannels().reload`: unfollowing changes the rail's copy. */
  onFollowed: () => void;
}

export function Following(props: FollowingProps) {
  usePageTitle("Following", "Community");
  return (
    <>
      <PageHead dateline={dateline(new Date())} title="Following" />
      <MembersOnly what="what you follow">
        <Followed {...props} />
      </MembersOnly>
    </>
  );
}

function Followed({ channels, onFollowed }: FollowingProps) {
  const api = useApi();
  const { signedIn } = useSiteAuth();
  const styles = followingStyles();
  const feed = useThreadFeed(FOLLOWING, signedIn);

  // The rail loads again after a change, and is nothing while it does: the
  // pills keep the last list they had.
  const listed = useMemo(() => followedChannels(channels), [channels]);
  const last = useRef(listed);
  if (channels.status === "ready") last.current = listed;

  // Managing: the pills turn into toggles over the list as it stood, so one
  // pressed off by mistake is still there to press back on.
  const [managed, setManaged] = useState<Channel[] | null>(null);
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const toggle = async (channel: Channel) => {
    setBusy(channel.slug);
    setFailure(null);
    try {
      const now = await api.followChannel(channel.slug, off.has(channel.slug));
      setOff((was) => {
        const next = new Set(was);
        if (now.following) next.delete(channel.slug);
        else next.add(channel.slug);
        return next;
      });
    } catch (e) {
      setFailure(
        e instanceof Error ? e.message : "That did not work. Try again.",
      );
    } finally {
      setBusy(null);
    }
  };
  const done = () => {
    setManaged(null);
    if (!off.size) return;
    setOff(new Set());
    // A channel let go takes its threads out of the list, and its bell off the rail.
    onFollowed();
    feed.reload();
  };

  return (
    <>
      <div className={styles.channels()}>
        <span className={styles.label()} id="followed-channels">
          Channels
        </span>
        {managed
          ? managed.map((channel) => (
              <Button
                key={channel.id}
                variant="pill"
                size="sm"
                pressed={!off.has(channel.slug)}
                disabled={busy === channel.slug}
                onClick={() => toggle(channel)}
                aria-describedby="followed-channels"
              >
                <Hash size={13} strokeWidth={1.5} aria-hidden="true" />
                {channel.name}
              </Button>
            ))
          : last.current.map((channel) => (
              <Button
                key={channel.id}
                {...routed(paths.channel(channel.slug))}
                variant="pill"
                size="sm"
              >
                <Hash size={13} strokeWidth={1.5} aria-hidden="true" />
                {channel.name}
              </Button>
            ))}
        {!managed && !last.current.length && channels.status === "ready" && (
          <p className={styles.none()}>
            None yet: Follow channel, on any channel.
          </p>
        )}
        {managed ? (
          <Button variant="link" onClick={done}>
            Done
          </Button>
        ) : (
          last.current.length > 0 && (
            <Button variant="link" onClick={() => setManaged(last.current)}>
              Manage
            </Button>
          )
        )}
      </div>
      {managed && (
        <Notice>
          A pressed channel is one you follow. Press it to stop hearing about
          its new threads.
        </Notice>
      )}
      {failure && <Notice kind="warn">{failure}</Notice>}
      <ThreadList
        state={feed.state}
        subject="what you follow"
        showChannel
        onRetry={feed.reload}
        onMore={feed.loadMore}
        empty={
          <Empty title="Nothing followed yet" icon={<Puffin size={40} />}>
            <p>
              Start a thread or reply to one, and it is kept here. The bell
              tells you when it moves.
            </p>
            <Button {...routed(paths.home())} variant="pill">
              Browse the latest threads
            </Button>
          </Empty>
        }
      />
    </>
  );
}
