/**
 * The reply slot, docked under the stream. Signed in it is the composer, and
 * its Reply is the view's one filled action; signed out it is the offer to
 * sign in; on a locked thread it is the reason.
 */
import { AtSign, Image as ImageIcon, Lock, LogIn, Send, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useSiteAuth } from "../../../shared/web/auth";
import { Avatar, Button } from "../../../ui";
import { HOVER, NO_RING, RING_WITHIN, tv } from "../../../ui/tv";
import { LIMITS, type Member, type Message } from "../../shared/types";
import {
  applyMention,
  firstLine,
  mentionMatches,
  mentionQuery,
  sendsOnEnter,
} from "../thread";

export const composerStyles = tv({
  slots: {
    base: [
      "relative grid gap-2 rounded-surface border border-line-strong bg-card py-3 pr-3 pl-5 font-sans shadow-marker",
      "max-rail:rounded-control max-rail:pl-3",
      RING_WITHIN,
    ],
    replying: "flex min-w-0 items-center gap-2 text-body text-ink-muted",
    replyingName: "shrink-0 font-semibold text-ink-2",
    replyingLine: "min-w-0 flex-1 truncate",
    input: [
      "field-sizing-content max-h-60 min-h-control-lg w-full resize-none border-0 bg-transparent p-0 pt-2",
      "font-sans text-prose text-ink placeholder:text-ink-muted placeholder:opacity-100",
      // Under 16px a focused field makes a phone zoom the page. The step up
      // is a heading's, so its weight is taken back off.
      "pointer-coarse:text-lead pointer-coarse:font-normal",
      NO_RING,
    ],
    photos: "flex flex-wrap gap-2",
    photo: "relative size-18 overflow-hidden rounded-control bg-sunken",
    photoImage: "size-full object-cover",
    photoBusy: "animate-pulse motion-reduce:animate-none",
    photoRemove: "absolute top-0 right-0 bg-card shadow-control",
    error: "m-0 text-body text-warn",
    bar: "flex items-center gap-0.5",
    send: "ml-auto px-5 text-body",
    hiddenInput: "hidden",
    // The people an @ offers, over the field.
    matches:
      "absolute bottom-full left-3 z-popover mb-1 flex min-w-56 flex-col gap-0.5 rounded-control border border-line bg-card p-1 shadow-marker",
    match: [
      "flex min-h-control-md w-full cursor-pointer items-center gap-2 rounded-control px-2 text-left text-body text-ink-2",
      "pointer-coarse:min-h-touch",
      HOVER,
    ],
    matchName: "font-semibold text-ink",
    matchHandle: "text-ink-muted",
    // Signed out, or locked: the same slot, one thing in it.
    gate: "flex items-center justify-between gap-3 rounded-surface border border-line bg-card py-3 pr-3 pl-5 font-sans shadow-marker max-rail:rounded-control max-rail:pl-3",
    gateText: "grid min-w-0 gap-0.5",
    gateTitle: "text-prose font-semibold text-ink",
    gateMeta: "text-body text-ink-muted",
    locked: "flex items-center gap-3 text-ink-muted",
  },
  variants: {
    // The row the arrow keys are on: filled and heavier, and said with aria-selected.
    active: { true: { match: "bg-sunken font-semibold" } },
  },
});

/** Whether this is a desktop: a pointer that hovers and is fine. A phone's Enter breaks a line. */
function useDesktop(): boolean {
  const query = "(hover: hover) and (pointer: fine)";
  const [desktop, setDesktop] = useState(
    () => typeof matchMedia === "function" && matchMedia(query).matches,
  );
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => setDesktop(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return desktop;
}

interface Attached {
  id: number;
  previewUrl: string | null;
  /** Set once the bytes are up. */
  key: string | null;
}

export interface ComposerProps {
  /** Who an @ offers: the thread's people first. */
  people: readonly Member[];
  replyingTo: Message | null;
  onCancelReply: () => void;
  /** Rejects with what the reader is told; what they wrote is kept. */
  onSend: (draft: { text: string; photoKeys: string[] }) => Promise<void>;
  upload: (file: File) => Promise<{ key: string; previewUrl: string }>;
}

export function Composer({
  people,
  replyingTo,
  onCancelReply,
  onSend,
  upload,
}: ComposerProps) {
  const styles = composerStyles();
  const desktop = useDesktop();
  const field = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const listId = useId();
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [photos, setPhotos] = useState<Attached[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [row, setRow] = useState(0);
  /** Escape puts the list away until the @word changes. */
  const [dismissed, setDismissed] = useState<string | null>(null);

  const asked = mentionQuery(text, caret);
  const matches =
    asked && dismissed !== asked.query
      ? mentionMatches(asked.query, people)
      : [];
  const active = matches[Math.min(row, matches.length - 1)];

  useEffect(() => {
    if (replyingTo) field.current?.focus();
  }, [replyingTo]);

  // The previews are this page's to let go of.
  const held = useRef<Attached[]>([]);
  held.current = photos;
  useEffect(
    () => () => {
      for (const photo of held.current)
        if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    },
    [],
  );

  const uploading = photos.some((photo) => !photo.key);
  const ready = text.trim().length > 0 && !uploading && !busy;

  const pick = (member: Member) => {
    if (!asked) return;
    const next = applyMention(text, caret, asked.start, member.handle);
    setText(next.text);
    setCaret(next.caret);
    setRow(0);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const send = () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    onSend({ text, photoKeys: photos.flatMap((p) => (p.key ? [p.key] : [])) })
      .then(
        () => {
          for (const photo of photos)
            if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
          setText("");
          setCaret(0);
          setPhotos([]);
        },
        (reason: unknown) =>
          setError(
            reason instanceof Error
              ? reason.message
              : "Your reply could not be sent.",
          ),
      )
      .finally(() => setBusy(false));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setRow((row + step + matches.length) % matches.length);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && active) {
        event.preventDefault();
        pick(active);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(asked?.query ?? null);
        return;
      }
    }
    const { key, shiftKey, nativeEvent } = event;
    const isComposing = nativeEvent.isComposing;
    if (sendsOnEnter({ key, shiftKey, isComposing }, desktop)) {
      event.preventDefault();
      send();
    }
  };

  const attach = (event: ChangeEvent<HTMLInputElement>) => {
    const room = LIMITS.photosPerMessage - photos.length;
    const chosen = [...(event.target.files ?? [])];
    event.target.value = "";
    if (chosen.length > room)
      setError(`Attach ${LIMITS.photosPerMessage} photos or fewer.`);
    else setError(null);
    for (const file of chosen.slice(0, Math.max(0, room))) {
      const id = nextId.current++;
      setPhotos((now) => [...now, { id, previewUrl: null, key: null }]);
      upload(file).then(
        (done) =>
          setPhotos((now) =>
            now.some((p) => p.id === id)
              ? now.map((p) => (p.id === id ? { ...p, ...done } : p))
              : // Taken off while it was on its way up.
                (URL.revokeObjectURL(done.previewUrl), now),
          ),
        (reason: unknown) => {
          setPhotos((now) => now.filter((p) => p.id !== id));
          setError(
            reason instanceof Error
              ? reason.message
              : "The photo upload failed. Try again.",
          );
        },
      );
    }
  };

  const detach = (photo: Attached) => {
    if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    setPhotos((now) => now.filter((p) => p.id !== photo.id));
  };

  const startMention = () => {
    const el = field.current;
    const at = el?.selectionStart ?? text.length;
    const before = text.slice(0, at);
    const inserted = before && !/\s$/.test(before) ? " @" : "@";
    setText(before + inserted + text.slice(at));
    setCaret(at + inserted.length);
    setDismissed(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + inserted.length, at + inserted.length);
    });
  };

  return (
    <form
      className={styles.base()}
      aria-label="Reply"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      {matches.length > 0 && (
        <ul
          id={listId}
          className={styles.matches()}
          role="listbox"
          aria-label="Mention someone"
        >
          {matches.map((member) => (
            <li
              key={member.id}
              id={`${listId}-${member.id}`}
              role="option"
              aria-selected={member === active}
              className={composerStyles({ active: member === active }).match()}
              // Before the field loses the focus, so the caret is still where it was.
              onPointerDown={(event) => {
                event.preventDefault();
                pick(member);
              }}
            >
              <Avatar
                name={member.displayName}
                src={member.avatarUrl}
                size="sm"
              />
              <span className={styles.matchName()}>{member.displayName}</span>
              <span className={styles.matchHandle()}>@{member.handle}</span>
            </li>
          ))}
        </ul>
      )}
      {replyingTo && (
        <div className={styles.replying()}>
          <span>Replying to</span>
          <span className={styles.replyingName()}>
            {replyingTo.author.displayName}
          </span>
          <span className={styles.replyingLine()}>{firstLine(replyingTo)}</span>
          <Button
            size="sm"
            icon
            aria-label="Cancel replying to this message"
            onClick={onCancelReply}
          >
            <X size={15} aria-hidden="true" />
          </Button>
        </div>
      )}
      <textarea
        ref={field}
        className={styles.input()}
        rows={1}
        maxLength={LIMITS.bodyMax}
        placeholder={
          replyingTo
            ? `Reply to ${replyingTo.author.displayName}…`
            : "Reply to the thread…"
        }
        aria-label="Your reply"
        aria-autocomplete="list"
        aria-controls={matches.length ? listId : undefined}
        aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
        value={text}
        // Not disabled, which would drop the focus a sent reply keeps.
        readOnly={busy}
        onChange={(event) => {
          setText(event.target.value);
          setCaret(event.target.selectionStart);
          setRow(0);
          setDismissed(null);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
      />
      {photos.length > 0 && (
        <ul className={styles.photos()} aria-label="Photos to send">
          {photos.map((photo, i) => (
            <li
              key={photo.id}
              className={styles.photo({
                className: photo.key ? undefined : styles.photoBusy(),
              })}
              aria-busy={!photo.key || undefined}
            >
              {photo.previewUrl && (
                <img
                  className={styles.photoImage()}
                  src={photo.previewUrl}
                  alt=""
                />
              )}
              <Button
                size="sm"
                icon
                className={styles.photoRemove()}
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => detach(photo)}
              >
                <X size={13} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className={styles.error()} role="alert">
          {error}
        </p>
      )}
      <div className={styles.bar()}>
        <input
          ref={files}
          className={styles.hiddenInput()}
          type="file"
          accept="image/*"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          onChange={attach}
        />
        <Button
          size="sm"
          icon
          aria-label="Add photos"
          disabled={busy || photos.length >= LIMITS.photosPerMessage}
          onClick={() => files.current?.click()}
        >
          <ImageIcon size={16} aria-hidden="true" />
        </Button>
        <Button
          size="sm"
          icon
          aria-label="Mention someone"
          disabled={busy}
          onClick={startMention}
        >
          <AtSign size={16} aria-hidden="true" />
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          className={styles.send()}
          disabled={!ready}
        >
          <span>{busy ? "Sending…" : "Reply"}</span>
          <Send size={14} aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}

/** Signed out: reading is public, and the reply slot is offered, not hidden. */
export function SignInToReply() {
  const auth = useSiteAuth();
  const styles = composerStyles();
  return (
    <div className={styles.gate()}>
      <span className={styles.gateText()}>
        <span className={styles.gateTitle()}>Join the conversation</span>
        <span className={styles.gateMeta()}>Reading is open to everyone.</span>
      </span>
      {/* Sign-in comes back to this address, so to this thread. */}
      <Button
        variant="primary"
        onClick={auth.signIn}
        disabled={auth.provider === "none" || !auth.loaded}
        title={
          auth.provider === "none"
            ? "Sign-in is not configured on this build"
            : undefined
        }
      >
        <LogIn size={15} aria-hidden="true" />
        <span>Sign in to reply</span>
      </Button>
    </div>
  );
}

/** A locked thread takes no replies, and says why where the composer was. */
export function LockedNotice({ reason }: { reason: string | null }) {
  const styles = composerStyles();
  return (
    <div className={styles.gate()} role="status">
      <span className={styles.locked()}>
        <Lock size={18} aria-hidden="true" />
        <span className={styles.gateText()}>
          <span className={styles.gateTitle()}>This thread is locked</span>
          <span className={styles.gateMeta()}>
            {reason ?? "It takes no new replies."}
          </span>
        </span>
      </span>
    </div>
  );
}
