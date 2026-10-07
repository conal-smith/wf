/**
 * A thread: a page, not a panel (D22). The head, the opening post as the one
 * card, the replies on the ground under it, and the reply slot docked at the
 * bottom. Reply is this view's filled action, so the header's New thread goes
 * quiet here (`accentNewThread`).
 */
import {
  ArrowDown,
  ArrowLeft,
  Check,
  Compass,
  Link as LinkIcon,
  Lock,
  MoreHorizontal,
  Pin,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSiteAuth } from "../../../shared/web/auth";
import { usePageTitle } from "../../../shared/web/usePageTitle";
import {
  Button,
  ConfirmDialog,
  Empty,
  Headline,
  Notice,
  Skeleton,
} from "../../../ui";
import { MONO_LABEL, tv } from "../../../ui/tv";
import type {
  Message as MessageData,
  Reaction,
  ReplyRef,
  Thread,
} from "../../shared/types";
import { Composer, LockedNotice, SignInToReply } from "../components/Composer";
import { FollowMenu } from "../components/FollowMenu";
import { Message } from "../components/Message";
import { MessageStream } from "../components/MessageStream";
import { Popover, PopoverItem } from "../components/Popover";
import { SpotCard } from "../components/SpotCard";
import { LockDialog, ReportDialog } from "../components/ThreadDialogs";
import { messageSeq, navigate, paths, routed, useLocation } from "../router";
import {
  arrivedSince,
  headMeta,
  keepRanges,
  newestSeq,
  owesRead,
  peopleOf,
  streamRows,
  type Viewer,
} from "../thread";
import { useNow, useThread, useViewer } from "../useThread";

export const threadStyles = tv({
  slots: {
    base: "relative flex flex-col gap-5 max-rail:gap-4",
    head: "grid min-w-0 gap-2",
    // The way back on the left, what a member does to the thread on the right.
    top: "flex min-h-control-sm items-center justify-between gap-3",
    back: "self-center",
    title: "max-w-measure",
    // Under the headline, over the double rule: what the thread comes to.
    metaRow: [
      "m-0 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-0 border-b-3 border-double border-ink pb-2",
      "text-ink-muted tabular-nums",
      MONO_LABEL,
    ],
    flag: "inline-flex items-center gap-1 font-semibold text-ink",
    started: "max-rail:hidden",
    actions: "flex items-center gap-1",
    status: "sr-only",
    loading: "grid gap-3",
    // The reply slot stays in reach while the stream scrolls behind it.
    dock: "sticky bottom-0 z-panel flex flex-col items-stretch gap-2",
    arrivals: "flex justify-center",
    pill: "shadow-marker",
    dismiss: "mt-1",
  },
});

const said = (reason: unknown, fallback: string) =>
  reason instanceof Error ? reason.message : fallback;

const toEnd = () =>
  window.scrollTo({ top: document.documentElement.scrollHeight });

/** How long a message that was jumped to stays raised. */
const MARK_MS = 2000;

export interface ThreadPageProps {
  id: string;
  /** Tells the shell which channel this thread is in, so the rail can light it. */
  onChannel?: (slug: string | null) => void;
}

export function ThreadPage({ id, onChannel }: ThreadPageProps) {
  const data = useThread(id);
  const { state } = data;
  const auth = useSiteAuth();
  const viewer = useViewer();
  const now = useNow();
  const styles = threadStyles();

  usePageTitle(
    state.status === "ready" ? state.thread.title : "Thread",
    "Community",
  );

  const slug = state.status === "ready" ? state.thread.channel.slug : null;
  useEffect(() => {
    onChannel?.(slug);
    return () => onChannel?.(null);
  }, [onChannel, slug]);

  if (state.status === "loading")
    return (
      <div className={styles.loading()} aria-busy="true">
        <span className={styles.status()}>Loading the thread…</span>
        <Skeleton />
        <Skeleton shape="block" />
        <Skeleton />
        <Skeleton />
      </div>
    );
  if (state.status === "missing")
    return (
      <Empty
        title="That thread does not exist"
        icon={<Compass size={24} strokeWidth={1.5} aria-hidden="true" />}
      >
        <p>The link may be old, or the thread may have been removed.</p>
        <Button {...routed(paths.home())} variant="primary">
          Back to the community
        </Button>
      </Empty>
    );
  if (state.status === "error")
    return (
      <Notice kind="warn">
        <p>{state.message}</p>
        <Button
          variant="link"
          className={styles.dismiss()}
          onClick={data.reload}
        >
          Try again
        </Button>
      </Notice>
    );

  return (
    <Conversation
      data={data}
      state={state}
      viewer={viewer}
      signedIn={auth.signedIn}
      signIn={auth.signIn}
      now={now}
    />
  );
}

type Data = ReturnType<typeof useThread>;
type Ready = Extract<Data["state"], { status: "ready" }>;

function Conversation({
  data,
  state,
  viewer,
  signedIn,
  signIn,
  now,
}: {
  data: Data;
  state: Ready;
  viewer: Viewer;
  signedIn: boolean;
  signIn: () => void;
  now: Date;
}) {
  const { thread, stream, entry } = state;
  const { setFailure } = data;
  const styles = threadStyles();

  const [replyingTo, setReplyingTo] = useState<MessageData | null>(null);
  const [reporting, setReporting] = useState<MessageData | null>(null);
  const [deleting, setDeleting] = useState<MessageData | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [locking, setLocking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [working, setWorking] = useState(false);
  const [marked, setMarked] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [atEnd, setAtEnd] = useState(false);

  const newest = newestSeq(stream, thread);
  const caughtUp = atEnd && !stream.hasNewer;
  /** The newest seq the reader has had in view. What came in since is the pill's. */
  const [seen, setSeen] = useState(newest);
  useEffect(() => {
    if (caughtUp) setSeen((now) => Math.max(now, newest));
  }, [caughtUp, newest]);
  const arrived = arrivedSince(newest, seen, caughtUp);

  const rows = useMemo(
    () => streamRows(stream, entry, now),
    [stream, entry, now],
  );
  const people = useMemo(
    () => peopleOf(thread, stream, viewer.id),
    [thread, stream, viewer.id],
  );

  // S3. Coming in: to the line they had read to, set at the top of the
  // screen under the masthead (the line's own scroll margin), so what is new
  // reads down from there. With nothing new the page opens at its head, as
  // any page does: centring the last message read would push the title up
  // under the masthead and tell the reader nothing.
  useLayoutEffect(() => {
    if (entry.lastReadSeq === null || entry.lastReadSeq === 0) return;
    if (entry.unread <= 0) return;
    const line =
      document.getElementById("new-since") ??
      document.getElementById(`m-${entry.lastReadSeq + 1}`);
    line?.scrollIntoView({ block: "start" });
    // Once, for the load this page was made for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A page joined at the top: what the reader was looking at stays where it was.
  const fromBottom = useRef<number | null>(null);
  const firstSeq = stream.replies[0]?.seq;
  useLayoutEffect(() => {
    if (fromBottom.current === null) return;
    window.scrollTo({
      top: document.documentElement.scrollHeight - fromBottom.current,
    });
    fromBottom.current = null;
  }, [firstSeq]);
  const olderPage = data.loadOlder;
  const loadOlder = useCallback(
    () =>
      void olderPage(() => {
        // Measured as the page lands, not when it was asked for: they may have scrolled.
        fromBottom.current =
          document.documentElement.scrollHeight - window.scrollY;
      }),
    [olderPage],
  );

  // S10. A reply that arrives while the reader is at the end keeps them there.
  const wasCaughtUp = useRef(false);
  const lastSeq = stream.replies.at(-1)?.seq;
  useLayoutEffect(() => {
    if (wasCaughtUp.current) toEnd();
  }, [lastSeq]);
  useEffect(() => {
    wasCaughtUp.current = caughtUp;
  }, [caughtUp]);

  // S3. The newest message has been in view: that is how far they have read.
  const markedRead = useRef(entry.lastReadSeq ?? -1);
  const { markRead } = data;
  useEffect(() => {
    if (!owesRead(signedIn, caughtUp, newest, markedRead.current)) return;
    markedRead.current = newest;
    // A miss is made up by the next message that comes into view.
    markRead(newest).catch(() => {});
  }, [signedIn, caughtUp, newest, markRead]);

  // S4. Jumped to: scrolled into the middle, and raised for a moment.
  useLayoutEffect(() => {
    if (target === null) return;
    const element = document.getElementById(`m-${target}`);
    if (!element) return;
    element.scrollIntoView({ block: "center" });
    setMarked(target);
    setTarget(null);
  }, [target, stream]);
  useEffect(() => {
    if (marked === null) return;
    const timer = setTimeout(() => setMarked(null), MARK_MS);
    return () => clearTimeout(timer);
  }, [marked]);

  const jumpTo = (seq: number) => {
    fromBottom.current = null;
    void data.reach(seq).then((there) => {
      if (there) setTarget(seq);
    });
  };
  const jump = (ref: ReplyRef) => jumpTo(ref.seq);

  // A link to one message (the bell's rows, a mention) names it in the hash,
  // `paths.message`: arriving by one is a jump to it, here already or not.
  const { hash } = useLocation();
  useEffect(() => {
    const seq = messageSeq(hash);
    if (seq !== null) jumpTo(seq);
    // `jumpTo` is this render's; the hash is what asks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  /** Runs something a member asked for, and says so in place when it fails. */
  const attempt = (work: Promise<unknown>, fallback: string) => {
    setFailure(null);
    return work.then(
      () => true,
      (reason: unknown) => {
        setFailure(said(reason, fallback));
        return false;
      },
    );
  };

  const react = (message: MessageData, emoji: Reaction, on: boolean) => {
    if (!signedIn) return signIn();
    void attempt(
      data.react(message, emoji, on),
      "Your reaction could not be saved.",
    );
  };
  const reply = (message: MessageData) => {
    if (!signedIn) return signIn();
    setReplyingTo(message);
  };
  const report = (message: MessageData) => {
    if (!signedIn) return signIn();
    setReporting(message);
  };

  const send = async (draft: { text: string; photoKeys: string[] }) => {
    await data.send({ ...draft, replyToId: replyingTo?.id ?? null }, people);
    setReplyingTo(null);
    requestAnimationFrame(toEnd);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const message = deleting;
    setDeleteBusy(true);
    void attempt(data.remove(message), "The message could not be deleted.")
      .then((done) => {
        // The opening post is the thread: without it there is no page to stay on.
        if (done && message.seq === 0)
          navigate(paths.channel(thread.channel.slug));
      })
      .finally(() => {
        setDeleteBusy(false);
        setDeleting(null);
      });
  };

  const moderate = (
    action: Parameters<Data["moderate"]>[0],
    fallback: string,
  ) => {
    setWorking(true);
    return attempt(data.moderate(action), fallback).finally(() =>
      setWorking(false),
    );
  };

  const locked = thread.status === "locked";
  const shared = {
    startedBy: thread.author.id,
    viewer,
    now,
    onReact: react,
    onReport: report,
    onDelete: setDeleting,
    onJump: jump,
    onEdit: (message: MessageData, text: string) =>
      data.edit(message, text, people),
  };

  return (
    <article className={styles.base()}>
      <ThreadHead
        thread={thread}
        now={now}
        viewer={viewer}
        signedIn={signedIn}
        working={working}
        onFollow={(level) =>
          void attempt(data.follow(level), "That could not be saved.")
        }
        onReport={() => report(stream.opening)}
        onPin={() =>
          void moderate(
            thread.pinned ? "unpin" : "pin",
            "The thread could not be pinned.",
          )
        }
        onLock={() =>
          locked
            ? void moderate("unlock", "The thread could not be unlocked.")
            : setLocking(true)
        }
        onRemove={() => setRemoving(true)}
      />

      <Message
        {...shared}
        message={stream.opening}
        opening
        marked={marked === 0}
        attached={<SpotCard spotId={thread.spotId} now={now} />}
      />

      <MessageStream
        rows={rows}
        hasOlder={stream.hasOlder}
        hasNewer={stream.hasNewer}
        loading={data.paging}
        onOlder={loadOlder}
        onNewer={() => void data.loadNewer()}
        onEnd={setAtEnd}
      >
        {(message) => (
          <Message
            key={message.id}
            {...shared}
            message={message}
            marked={marked === message.seq}
            onReply={locked ? undefined : reply}
          />
        )}
      </MessageStream>

      <div className={styles.dock()}>
        <div className={styles.arrivals()} aria-live="polite">
          {arrived > 0 && (
            <Button
              variant="pill"
              size="sm"
              className={styles.pill()}
              onClick={() => void data.reachEnd().then(toEnd)}
            >
              <ArrowDown size={14} strokeWidth={1.5} aria-hidden="true" />
              <span>{arrived} new</span>
            </Button>
          )}
        </div>
        {data.failure && (
          <Notice kind="warn">
            <p>{data.failure}</p>
            <Button
              variant="link"
              className={styles.dismiss()}
              onClick={() => setFailure(null)}
            >
              Dismiss
            </Button>
          </Notice>
        )}
        {locked ? (
          <LockedNotice reason={thread.lockedReason} />
        ) : signedIn ? (
          <Composer
            people={people}
            replyingTo={replyingTo}
            onCancelReply={() => setReplyingTo(null)}
            onSend={send}
            upload={data.upload}
          />
        ) : (
          <SignInToReply />
        )}
      </div>

      <ReportDialog
        open={reporting !== null}
        author={reporting?.author.displayName ?? ""}
        onReport={(reason, note) =>
          reporting ? data.report(reporting, reason, note) : Promise.resolve()
        }
        onClose={() => setReporting(null)}
      />
      <LockDialog
        open={locking}
        onLock={(reason) => data.moderate("lock", reason)}
        onClose={() => setLocking(false)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={
          deleting?.seq === 0 ? "Delete this thread?" : "Delete this message?"
        }
        confirmLabel="Delete"
        busy={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      >
        <p>
          {deleting?.seq === 0
            ? "Deleting the opening post removes the whole thread, replies and all. This cannot be undone."
            : "It will show as removed to everyone. This cannot be undone."}
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={removing}
        title="Remove this thread?"
        confirmLabel="Remove"
        busy={working}
        onConfirm={() =>
          void moderate("remove", "The thread could not be removed.").then(
            (done) => {
              setRemoving(false);
              if (done) navigate(paths.channel(thread.channel.slug));
            },
          )
        }
        onCancel={() => setRemoving(false)}
      >
        <p>
          Members will no longer be able to open it. The team’s log keeps the
          record.
        </p>
      </ConfirmDialog>
    </article>
  );
}

/** S1. The title, what the thread is tagged, how busy it is, and what a member does to it. */
export function ThreadHead({
  thread,
  now,
  viewer,
  signedIn,
  working,
  onFollow,
  onReport,
  onPin,
  onLock,
  onRemove,
}: {
  thread: Thread;
  now: Date;
  viewer: Viewer;
  signedIn: boolean;
  working: boolean;
  onFollow: (level: Parameters<Data["follow"]>[0]) => void;
  onReport: () => void;
  onPin: () => void;
  onLock: () => void;
  onRemove: () => void;
}) {
  const styles = threadStyles();
  const meta = headMeta(thread, now);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), MARK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    const link = location.origin + paths.thread(thread.id, thread.slug);
    navigator.clipboard.writeText(link).then(
      () => setCopied(true),
      () => {},
    );
  };

  const mine = viewer.id !== null && thread.author.id === viewer.id;
  const canReport = signedIn && !mine;
  const locked = thread.status === "locked";

  const parts = [
    thread.pinned && (
      <span key="pinned" className={styles.flag()}>
        <Pin size={11} strokeWidth={1.5} aria-hidden="true" />
        Pinned
      </span>
    ),
    locked && (
      <span key="locked" className={styles.flag()}>
        <Lock size={11} strokeWidth={1.5} aria-hidden="true" />
        Locked
      </span>
    ),
    ...thread.tags.map((tag) => <span key={tag.id}>{tag.label}</span>),
    <span key="counts">{meta.counts}</span>,
  ].filter(Boolean);

  return (
    <header className={styles.head()}>
      <div className={styles.top()}>
        <Button
          {...routed(paths.channel(thread.channel.slug))}
          variant="link"
          className={styles.back()}
        >
          <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" />
          <span>{thread.channel.name}</span>
        </Button>
        <div className={styles.actions()}>
          {signedIn && (
            <FollowMenu
              level={thread.following}
              busy={working}
              onChoose={onFollow}
            />
          )}
          <Button
            variant="pill"
            size="sm"
            icon
            aria-label={copied ? "Link copied" : "Copy link"}
            onClick={copy}
          >
            {copied ? (
              <Check size={15} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <LinkIcon size={15} strokeWidth={1.5} aria-hidden="true" />
            )}
          </Button>
          <span className={styles.status()} role="status">
            {copied ? "Link copied" : ""}
          </span>
          {(canReport || viewer.staff) && (
            <Popover
              variant="pill"
              size="sm"
              icon
              aria-label="More"
              panelLabel="Thread actions"
              disabled={working}
              label={
                <MoreHorizontal
                  size={15}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              }
            >
              {(close) => {
                const item = (label: string, act: () => void) => (
                  <PopoverItem
                    key={label}
                    onClick={() => {
                      close();
                      act();
                    }}
                  >
                    {label}
                  </PopoverItem>
                );
                return [
                  canReport && item("Report…", onReport),
                  // Staff act in place (D21). The API is what holds them to it.
                  viewer.staff && item(thread.pinned ? "Unpin" : "Pin", onPin),
                  viewer.staff && item(locked ? "Unlock" : "Lock…", onLock),
                  viewer.staff && item("Remove thread…", onRemove),
                ];
              }}
            </Popover>
          )}
        </div>
      </div>
      <Headline className={styles.title()}>{keepRanges(thread.title)}</Headline>
      <p className={styles.metaRow()}>
        {parts.flatMap((part, i) =>
          i
            ? [
                <span key={`dot-${i}`} aria-hidden="true">
                  ·
                </span>,
                part,
              ]
            : [part],
        )}
        {/* When it began is the least of it: a phone leaves it to the post. */}
        <span className={styles.started()}>
          <span aria-hidden="true">· </span>
          {meta.started}
        </span>
      </p>
    </header>
  );
}
