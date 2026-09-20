/**
 * One message. The opening post is the one card of the page; a reply stands
 * on the ground under it. Both carry the same things: who and when, the body,
 * photos, reactions, and the actions that show on hover, on focus and on a
 * long press.
 */
import { Flag, Pencil, Reply, Trash2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Avatar, Button, Chip, TextArea } from "../../../ui";
import { paneStyles } from "../../../ui/Pane";
import { RING, tv } from "../../../ui/tv";
import type {
  Member,
  Message as MessageData,
  Reaction,
  ReplyRef,
} from "../../shared/types";
import {
  canDelete,
  canEdit,
  decodeMentions,
  messageTime,
  type Viewer,
} from "../thread";
import { Body } from "./Body";
import { ReactionPicker, Reactions } from "./Reactions";

export const messageStyles = tv({
  slots: {
    base: "group relative flex scroll-mt-24 flex-col gap-1 rounded-control px-3 py-3 font-sans transition-colors duration-base motion-reduce:transition-none",
    // The quoted line above a reply, indented to stand over the words, not the face.
    replyTo: [
      "flex min-w-0 items-center gap-1 self-start rounded-control pl-13 text-body text-ink-muted no-underline max-rail:pl-10.5",
      "max-w-full not-disabled:hover:text-ink",
      RING,
    ],
    replyToName: "shrink-0 font-semibold",
    replyToLine: "min-w-0 truncate",
    row: "flex min-w-0 items-start gap-3",
    avatar: "max-rail:size-control-sm max-rail:text-caption",
    column: "flex min-w-0 flex-1 flex-col gap-1",
    head: "flex flex-wrap items-center gap-x-2 gap-y-1",
    name: "text-prose font-semibold text-ink",
    time: "text-body text-ink-muted",
    timeLong: "max-rail:hidden",
    timeShort: "rail:hidden",
    removed: "m-0 text-prose text-ink-muted italic",
    photos: "grid max-w-dialog grid-cols-2 gap-2",
    photo: ["block aspect-4/3 overflow-hidden rounded-control bg-sunken", RING],
    photoImage: "size-full object-cover",
    reactions: "mt-1",
    tools: [
      "absolute -top-3 right-3 z-popover flex rounded-full border border-line bg-card p-0.5 shadow-marker",
      "pointer-events-none opacity-0 transition-opacity duration-fast motion-reduce:transition-none",
      "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
      "group-hover:pointer-events-auto group-hover:opacity-100",
    ],
    edit: "grid gap-2",
    editActions: "flex items-center gap-2",
    error: "m-0 text-body text-warn",
  },
  variants: {
    // The one card: the opening post. Its actions sit inside its corner.
    opening: {
      true: {
        base: "gap-4 rounded-surface px-5 py-5 max-rail:rounded-control max-rail:px-3 max-rail:py-3",
        row: "items-center",
        // Beside the face: the name over the time, where there is the room.
        head: "rail:flex-col rail:items-start rail:gap-0",
        tools: "top-3",
      },
    },
    // Held open by a long press or an open picker, where there is no hover.
    toolsOpen: { true: { tools: "pointer-events-auto opacity-100" } },
    // Just jumped to: raised for a moment, then let go.
    marked: { true: { base: "bg-card shadow-control" } },
  },
});

/** A long press is this long, and a finger that moves is scrolling instead. */
const LONG_PRESS_MS = 500;

export interface MessageProps {
  message: MessageData;
  /** Seq 0, drawn as the card. */
  opening?: boolean;
  /** The thread's author, so their replies can say so. */
  startedBy: string;
  viewer: Viewer;
  now: Date;
  marked?: boolean;
  /** Absent on a locked thread and for nobody else: signed out, the page asks for a sign-in. */
  onReply?: (message: MessageData) => void;
  onReact: (message: MessageData, emoji: Reaction, on: boolean) => void;
  onReport: (message: MessageData) => void;
  /** The composer's text for the new body. Rejects with what the reader is told. */
  onEdit: (message: MessageData, text: string) => Promise<void>;
  onDelete: (message: MessageData) => void;
  onJump: (target: ReplyRef) => void;
}

function Time({ iso, now }: { iso: string; now: Date }) {
  const styles = messageStyles();
  const { long, short } = messageTime(iso, now);
  return (
    <time
      className={styles.time()}
      dateTime={iso}
      title={new Date(iso).toLocaleString()}
    >
      <span className={styles.timeLong()}>{long}</span>
      <span className={styles.timeShort()}>{short}</span>
    </time>
  );
}

function ReplyTo({
  target,
  onJump,
}: {
  target: ReplyRef;
  onJump: (target: ReplyRef) => void;
}) {
  const styles = messageStyles();
  return (
    <a
      className={styles.replyTo()}
      href={`#m-${target.seq}`}
      onClick={(event) => {
        event.preventDefault();
        onJump(target);
      }}
    >
      <Reply size={13} aria-hidden="true" />
      <span className={styles.replyToName()}>{target.author.displayName}</span>
      <span className={styles.replyToLine()}>
        {target.removed ? "Removed message" : target.excerpt}
      </span>
    </a>
  );
}

function EditForm({
  message,
  onSave,
  onCancel,
}: {
  message: MessageData;
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const styles = messageStyles();
  const [text, setText] = useState(() =>
    decodeMentions(message.body, message.mentions),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    setBusy(true);
    setError(null);
    onSave(text).then(onCancel, (reason: unknown) => {
      setBusy(false);
      setError(
        reason instanceof Error
          ? reason.message
          : "The edit could not be saved.",
      );
    });
  };
  return (
    <div className={styles.edit()}>
      <TextArea
        aria-label="Edit your message"
        value={text}
        disabled={busy}
        autoFocus
        onChange={(event) => setText(event.target.value)}
      />
      {error && (
        <p className={styles.error()} role="alert">
          {error}
        </p>
      )}
      <div className={styles.editActions()}>
        {/* Reply is the view's one filled action: saving is a pill. */}
        <Button
          variant="pill"
          size="sm"
          disabled={busy || !text.trim()}
          onClick={save}
        >
          Save
        </Button>
        <Button size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Photos({ message }: { message: MessageData }) {
  const styles = messageStyles();
  if (!message.photos.length) return null;
  return (
    <div className={styles.photos()}>
      {message.photos.map((photo, i) => (
        <a
          key={photo.id}
          className={styles.photo()}
          href={photo.url}
          target="_blank"
          rel="noopener"
          aria-label={`Photo ${i + 1} of ${message.photos.length}, full size`}
        >
          <img
            className={styles.photoImage()}
            src={photo.url}
            alt=""
            loading="lazy"
            width={photo.width ?? undefined}
            height={photo.height ?? undefined}
          />
        </a>
      ))}
    </div>
  );
}

/** Who a removed message was by is still said; what it said is not. */
function content(message: MessageData, staff: boolean): ReactNode {
  const styles = messageStyles();
  if (message.status === "removed")
    return (
      <>
        <p className={styles.removed()}>This message was removed.</p>
        {/* The API keeps the words for staff, and for nobody else. */}
        {staff && message.body && (
          <Body body={message.body} mentions={message.mentions} />
        )}
      </>
    );
  return (
    <>
      <Body body={message.body} mentions={message.mentions} />
      <Photos message={message} />
    </>
  );
}

export function Message({
  message,
  opening = false,
  startedBy,
  viewer,
  now,
  marked = false,
  onReply,
  onReact,
  onReport,
  onEdit,
  onDelete,
  onJump,
}: MessageProps) {
  const [editing, setEditing] = useState(false);
  const [held, setHeld] = useState(false);
  const [picking, setPicking] = useState(false);
  const root = useRef<HTMLElement>(null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);

  const styles = messageStyles({
    opening,
    marked,
    toolsOpen: held || picking,
  });
  const visible = message.status === "visible";
  const mine = viewer.id !== null && message.author.id === viewer.id;
  const author: Member = message.author;

  // A long press holds the actions open; a press anywhere else lets them go.
  useEffect(() => {
    if (!held) return;
    const release = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setHeld(false);
    };
    document.addEventListener("pointerdown", release, true);
    return () => document.removeEventListener("pointerdown", release, true);
  }, [held]);
  useEffect(
    () => () => {
      if (press.current) clearTimeout(press.current);
    },
    [],
  );
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current);
    press.current = null;
  };
  const startPress = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    cancelPress();
    press.current = setTimeout(() => setHeld(true), LONG_PRESS_MS);
  };

  const react = (emoji: Reaction, on: boolean) => onReact(message, emoji, on);

  return (
    <article
      ref={root}
      id={`m-${message.seq}`}
      className={
        opening ? paneStyles({ className: styles.base() }) : styles.base()
      }
      aria-label={`${author.displayName}, ${messageTime(message.createdAt, now).long}`}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerMove={cancelPress}
      onPointerCancel={cancelPress}
      onPointerLeave={cancelPress}
    >
      {visible && !editing && (
        <div
          className={styles.tools()}
          role="toolbar"
          aria-label="Message actions"
        >
          {/* The card has its picker beside its chips. */}
          {!opening && (
            <ReactionPicker
              mine={message.myReactions ?? []}
              onReact={react}
              onOpenChange={setPicking}
              // The last message sits over the docked reply slot.
              side="top"
            />
          )}
          {onReply && !opening && (
            <Button
              size="sm"
              icon
              aria-label="Reply to this message"
              onClick={() => onReply(message)}
            >
              <Reply size={15} aria-hidden="true" />
            </Button>
          )}
          {!mine && (
            <Button
              size="sm"
              icon
              aria-label="Report"
              onClick={() => onReport(message)}
            >
              <Flag size={15} aria-hidden="true" />
            </Button>
          )}
          {canEdit(message, viewer, now) && (
            <Button
              size="sm"
              icon
              aria-label="Edit"
              onClick={() => setEditing(true)}
            >
              <Pencil size={15} aria-hidden="true" />
            </Button>
          )}
          {canDelete(message, viewer) && (
            <Button
              size="sm"
              icon
              aria-label="Delete"
              onClick={() => onDelete(message)}
            >
              <Trash2 size={15} aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
      {message.replyTo && <ReplyTo target={message.replyTo} onJump={onJump} />}
      <div className={styles.row()}>
        <Avatar
          name={author.displayName}
          src={author.avatarUrl}
          className={styles.avatar()}
        />
        {opening ? (
          <Byline message={message} now={now} opening />
        ) : (
          <div className={styles.column()}>
            <Byline
              message={message}
              now={now}
              started={author.id === startedBy}
            />
            {editing ? (
              <EditForm
                message={message}
                onSave={(text) => onEdit(message, text)}
                onCancel={() => setEditing(false)}
              />
            ) : (
              content(message, viewer.staff)
            )}
            {visible && (
              <Reactions
                className={styles.reactions()}
                message={message}
                onReact={react}
              />
            )}
          </div>
        )}
      </div>
      {opening &&
        (editing ? (
          <EditForm
            message={message}
            onSave={(text) => onEdit(message, text)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          content(message, viewer.staff)
        ))}
      {opening && visible && (
        <Reactions message={message} onReact={react} picker />
      )}
    </article>
  );
}

function Byline({
  message,
  now,
  started = false,
  opening = false,
}: {
  message: MessageData;
  now: Date;
  started?: boolean;
  opening?: boolean;
}) {
  const styles = messageStyles({ opening });
  return (
    <div className={styles.head()}>
      <span className={styles.name()}>{message.author.displayName}</span>
      {message.author.role === "staff" && <Chip>Team</Chip>}
      {started && <Chip>Started the thread</Chip>}
      <Time iso={message.createdAt} now={now} />
      {message.editedAt && message.status === "visible" && (
        <span
          className={styles.time()}
          title={new Date(message.editedAt).toLocaleString()}
        >
          (edited)
        </span>
      )}
    </div>
  );
}
