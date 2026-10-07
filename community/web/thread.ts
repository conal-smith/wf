/**
 * What the thread page works out before it draws anything: the run of
 * messages it holds and how a page or a live event changes it, the rows of
 * the stream, how a time reads, and the composer's mentions. All of it is
 * plain functions over plain data, and that is what is tested: there is no
 * DOM under the unit tests.
 */
import {
  LIMITS,
  type Member,
  type Message,
  type MessagePage,
  type Thread,
  type ThreadView,
} from "../shared/types";
import { MENTION_PATTERN } from "../shared/validate";
import { parseInline, plainText } from "./body";

// ---- the stream -------------------------------------------------------------

/**
 * The messages on the page. Seqs have no holes (a removed message keeps its
 * place), so `replies` is always one unbroken run and a page joins it at
 * either end.
 */
export interface Stream {
  /** Seq 0: the one card. */
  opening: Message;
  /** Oldest first. */
  replies: Message[];
  hasOlder: boolean;
  hasNewer: boolean;
  /**
   * Live arrivals that cannot join the run yet, because pages between it and
   * them are not loaded. They join when the run reaches the end.
   */
  beyond: Message[];
}

const bySeq = (a: Message, b: Message) => a.seq - b.seq;

/** The run again with these put in place by id, in seq order. */
function merged(run: readonly Message[], incoming: readonly Message[]) {
  const byId = new Map(run.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(bySeq);
}

/** Only the opening post is older than seq 1, and it is always on the page. */
const olderThan = (replies: readonly Message[], flag: boolean) =>
  flag && replies.length > 0 && replies[0].seq > 1;

/** The run has reached the end: whatever waited beyond it joins. */
function settled(stream: Stream): Stream {
  if (stream.hasNewer) {
    const last = stream.replies.at(-1)?.seq ?? 0;
    return { ...stream, beyond: stream.beyond.filter((m) => m.seq > last) };
  }
  // One that waited from before the run (a change heard in pages a jump to
  // the end passed over) would leave a hole: it is left for its page to bring.
  const first = stream.replies[0]?.seq ?? 0;
  return {
    ...stream,
    replies: merged(
      stream.replies,
      stream.beyond.filter((m) => m.seq > first),
    ),
    beyond: [],
  };
}

export function startStream(view: ThreadView): Stream {
  const replies = view.messages.items.filter((m) => m.seq > 0);
  return {
    opening: view.opening,
    replies,
    hasOlder: olderThan(replies, view.messages.hasOlder),
    hasNewer: view.messages.hasNewer,
    beyond: [],
  };
}

/**
 * A page from the API: joined to the older end, to the newer end, or put in
 * place of the run (a jump to a message that was not loaded).
 */
export function withPage(
  stream: Stream,
  page: MessagePage,
  side: "older" | "newer" | "replace",
): Stream {
  const opening = page.items.find((m) => m.seq === 0) ?? stream.opening;
  const items = page.items.filter((m) => m.seq > 0);
  const replies =
    side === "replace" ? [...items].sort(bySeq) : merged(stream.replies, items);
  return settled({
    ...stream,
    opening,
    replies,
    hasOlder:
      side === "newer" ? stream.hasOlder : olderThan(replies, page.hasOlder),
    hasNewer: side === "older" ? stream.hasNewer : page.hasNewer,
  });
}

/**
 * Messages from anywhere else: the live follower, or the viewer's own write.
 * One already here is replaced; a new one joins the end of a run that reaches
 * the end, fills a hole inside it, or waits beyond it. One older than the run
 * is not on the page and is left for its page to bring.
 */
export function withMessages(
  stream: Stream,
  messages: readonly Message[],
): Stream {
  let { opening } = stream;
  let replies = stream.replies;
  let beyond = stream.beyond;
  for (const m of messages) {
    if (m.seq === 0 || m.id === opening.id) {
      opening = m;
      continue;
    }
    const first = replies[0]?.seq ?? 0;
    const last = replies.at(-1)?.seq ?? 0;
    if (replies.some((r) => r.id === m.id)) replies = merged(replies, [m]);
    else if (m.seq > last) {
      if (stream.hasNewer) beyond = merged(beyond, [m]);
      else replies = merged(replies, [m]);
    } else if (m.seq > first) replies = merged(replies, [m]);
  }
  // A quoted line above a reply says what its target now is.
  const removed = new Set(
    messages.filter((m) => m.status === "removed").map((m) => m.id),
  );
  if (removed.size)
    replies = replies.map((r) =>
      r.replyTo && removed.has(r.replyTo.id) && !r.replyTo.removed
        ? { ...r, replyTo: { ...r.replyTo, excerpt: "", removed: true } }
        : r,
    );
  return { ...stream, opening, replies, beyond };
}

/** The highest seq this page knows of, loaded or not. */
export function newestSeq(stream: Stream, thread: Pick<Thread, "lastSeq">) {
  return Math.max(
    thread.lastSeq,
    stream.replies.at(-1)?.seq ?? 0,
    stream.beyond.at(-1)?.seq ?? 0,
  );
}

/**
 * S10. What the "N new" pill counts: seqs past the newest the reader has had
 * in view. At the end of a run that reaches the end there is nothing to count.
 */
export function arrivedSince(
  newest: number,
  seen: number,
  caughtUp: boolean,
): number {
  return caughtUp ? 0 : Math.max(0, newest - seen);
}

/**
 * S3. Whether PUT /read is owed: a member, with the newest message in view,
 * and further on than the last seq that was sent.
 */
export function owesRead(
  signedIn: boolean,
  caughtUp: boolean,
  newest: number,
  sent: number,
): boolean {
  return signedIn && caughtUp && newest > sent;
}

/** The message with this seq, if it is on the page. */
export function findBySeq(stream: Stream, seq: number): Message | null {
  if (seq === 0) return stream.opening;
  return stream.replies.find((m) => m.seq === seq) ?? null;
}

// ---- rows ---------------------------------------------------------------------

export type StreamRow =
  | { t: "day"; key: string; label: string }
  | { t: "new"; key: string; count: number }
  | { t: "message"; key: string; message: Message };

/** Where the viewer had read to when they came in. It does not move while they read. */
export interface Entry {
  /** Null for a first visit and for a signed-out reader: no line is drawn. */
  lastReadSeq: number | null;
  unread: number;
}

export function entryOf(thread: Thread): Entry {
  return {
    lastReadSeq: thread.lastReadSeq ?? null,
    unread: thread.unread ?? 0,
  };
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/**
 * The replies under their day dividers, with the "new since you were last
 * here" line above the first message the viewer had not read. A day is drawn
 * where it changes, and at the top of a run that starts mid-thread.
 */
export function streamRows(
  stream: Pick<Stream, "opening" | "replies">,
  entry: Entry,
  now: Date,
): StreamRow[] {
  const rows: StreamRow[] = [];
  let day: string | null =
    stream.replies[0]?.seq === 1
      ? dayKey(new Date(stream.opening.createdAt))
      : null;
  for (const message of stream.replies) {
    const key = dayKey(new Date(message.createdAt));
    if (key !== day) {
      day = key;
      rows.push({
        t: "day",
        key: `day:${key}`,
        label: dayLabel(message.createdAt, now),
      });
    }
    if (
      entry.lastReadSeq !== null &&
      entry.unread > 0 &&
      message.seq === entry.lastReadSeq + 1
    )
      rows.push({ t: "new", key: "new", count: entry.unread });
    rows.push({ t: "message", key: message.id, message });
  }
  return rows;
}

// ---- titles -------------------------------------------------------------------

/** U+2060, which joins the characters either side of it into one word. */
const JOIN = "\u2060";

/**
 * A title with its number ranges held together: "15–20 knots" must not break
 * after the dash, and a browser will break after any dash it is given. Each
 * dash between two figures is joined to both, and a space beside it made one
 * that does not break. What is shown, never what is stored or searched.
 */
export function keepRanges(title: string): string {
  return title.replace(
    /(\d)( ?)([–—-])( ?)(?=\d)/g,
    (_, before: string, gap: string, dash: string, after: string) =>
      `${before}${gap ? "\u00a0" : JOIN}${dash}${after ? "\u00a0" : JOIN}`,
  );
}

// ---- time ---------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Whole days between two local dates: 0 today, 1 yesterday. */
const daysBefore = (then: Date, now: Date) =>
  Math.round((startOfDay(now) - startOfDay(then)) / DAY);

const clock = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** A day divider: Today, Yesterday, a weekday within the week, then the date. */
export function dayLabel(iso: string, now: Date): string {
  const then = new Date(iso);
  const days = daysBefore(then, now);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return WEEKDAYS[then.getDay()];
  const date = `${then.getDate()} ${MONTHS[then.getMonth()]}`;
  return then.getFullYear() === now.getFullYear()
    ? date
    : `${date} ${then.getFullYear()}`;
}

/**
 * When a message was written, long and short: "4 min ago", "09:12",
 * "Thursday at 19:42" and "Thu 19:42", "12 September at 19:42".
 */
export function messageTime(
  iso: string,
  now: Date,
): { long: string; short: string } {
  const then = new Date(iso);
  const ageMs = now.getTime() - then.getTime();
  // Within the hour a message is dated as its row in the list was, at both
  // widths: "4 min ago", never "4 minutes ago" here and "4 min" there.
  if (ageMs < MINUTE) return { long: "just now", short: "just now" };
  if (ageMs < HOUR) {
    const minutes = `${Math.floor(ageMs / MINUTE)} min ago`;
    return { long: minutes, short: minutes };
  }
  const days = daysBefore(then, now);
  const at = clock(then);
  if (days <= 0) return { long: at, short: at };
  if (days < 7) {
    const weekday = WEEKDAYS[then.getDay()];
    return {
      long: `${days === 1 ? "Yesterday" : weekday} at ${at}`,
      short: `${weekday.slice(0, 3)} ${at}`,
    };
  }
  const year =
    then.getFullYear() === now.getFullYear() ? "" : ` ${then.getFullYear()}`;
  const month = MONTHS[then.getMonth()];
  return {
    long: `${then.getDate()} ${month}${year} at ${at}`,
    short: `${then.getDate()} ${month.slice(0, 3)}${year}`,
  };
}

/**
 * How long ago, in the largest unit that fits: "2 days ago". Minutes and hours
 * are counted as the lists count them ("4 min ago", "3 h ago").
 */
export function ago(iso: string, now: Date): string {
  const ageMs = Math.max(0, now.getTime() - Date.parse(iso));
  if (ageMs < MINUTE) return "just now";
  if (ageMs < HOUR) return `${Math.floor(ageMs / MINUTE)} min ago`;
  if (ageMs < DAY) return `${Math.floor(ageMs / HOUR)} h ago`;
  const days = Math.floor(ageMs / DAY);
  if (days < 7) return `${plural(days, "day")} ago`;
  if (days < 30) return `${plural(Math.floor(days / 7), "week")} ago`;
  if (days < 365) return `${plural(Math.floor(days / 30), "month")} ago`;
  return `${plural(Math.floor(days / 365), "year")} ago`;
}

/** The head's line: "24 replies · 9 riders", and "started 2 days ago" beside it. */
export function headMeta(
  thread: Pick<Thread, "replyCount" | "participantCount" | "createdAt">,
  now: Date,
): { counts: string; started: string } {
  const replies =
    thread.replyCount > 0
      ? plural(thread.replyCount, "reply", "replies")
      : "No replies yet";
  return {
    counts: `${replies} · ${plural(thread.participantCount, "rider")}`,
    started: `started ${ago(thread.createdAt, now)}`,
  };
}

// ---- what a viewer may do -------------------------------------------------------

/** Who is looking. `id` is the session's user id, which is the member's id. */
export interface Viewer {
  id: string | null;
  staff: boolean;
}

/** Their own, still standing, and inside the window the API will accept. */
export function canEdit(message: Message, viewer: Viewer, now: Date): boolean {
  return (
    message.status === "visible" &&
    viewer.id !== null &&
    message.author.id === viewer.id &&
    now.getTime() - Date.parse(message.createdAt) <=
      LIMITS.editWindowMin * MINUTE
  );
}

/** Their own at any age; anyone's, for staff. */
export function canDelete(message: Message, viewer: Viewer): boolean {
  return (
    message.status === "visible" &&
    viewer.id !== null &&
    (message.author.id === viewer.id || viewer.staff)
  );
}

// ---- mentions in the composer -----------------------------------------------------

/**
 * Who the composer offers after an @: the people of this thread. Its author,
 * then whoever wrote last, then everyone else on the page, each once and
 * never the viewer.
 */
export function peopleOf(
  thread: Pick<Thread, "author" | "participants">,
  stream: Pick<Stream, "opening" | "replies">,
  viewerId: string | null,
): Member[] {
  const seen = new Map<string, Member>();
  const add = (member: Member) => {
    if (member.id !== viewerId && !seen.has(member.id))
      seen.set(member.id, member);
  };
  add(thread.author);
  thread.participants.forEach(add);
  for (const m of [...stream.replies].reverse()) add(m.author);
  for (const m of [stream.opening, ...stream.replies]) m.mentions.forEach(add);
  return [...seen.values()];
}

/** The @word the caret stands at the end of, if it stands at one. */
export function mentionQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const match = /(?:^|[\s(])@([A-Za-z0-9-]{0,30})$/.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[1].length - 1, query: match[1].toLowerCase() };
}

const MOST_MATCHES = 6;

/** People whose handle, or any word of whose name, begins with what was typed. */
export function mentionMatches(
  query: string,
  people: readonly Member[],
): Member[] {
  return people
    .filter(
      (p) =>
        p.handle.startsWith(query) ||
        p.displayName
          .toLowerCase()
          .split(/\s+/)
          .some((word) => word.startsWith(query)),
    )
    .slice(0, MOST_MATCHES);
}

/** The text with the @word at `start` finished as this handle, and where the caret goes. */
export function applyMention(
  text: string,
  caret: number,
  start: number,
  handle: string,
): { text: string; caret: number } {
  const inserted = `@${handle} `;
  return {
    text: text.slice(0, start) + inserted + text.slice(caret).replace(/^ /, ""),
    caret: start + inserted.length,
  };
}

const HANDLE = /(^|[^A-Za-z0-9_@])@([a-z0-9-]{3,30})/g;

/**
 * What is sent: each @handle that names someone the composer knows becomes
 * <@user_id> (D18), so a renamed member stays mentioned. An @word that names
 * nobody is left as the text it is.
 */
export function encodeMentions(
  text: string,
  people: readonly Member[],
): string {
  return text.replace(HANDLE, (whole, before: string, word: string) => {
    // "@aoife-k-" is "@aoife-k" and a hyphen.
    for (let end = word.length; end >= 3; end--) {
      const member = people.find((p) => p.handle === word.slice(0, end));
      if (member) return `${before}<@${member.id}>${word.slice(end)}`;
    }
    return whole;
  });
}

/** A stored body as the composer shows it, for an edit: each token as its @handle. */
export function decodeMentions(
  body: string,
  mentions: readonly Member[],
): string {
  return body.replace(new RegExp(MENTION_PATTERN.source, "g"), (whole, id) => {
    const member = mentions.find((m) => m.id === id);
    return member ? `@${member.handle}` : whole;
  });
}

/** A message's first line as words, for the "Replying to" strip. */
export function firstLine(message: Pick<Message, "body" | "mentions">): string {
  const line = message.body.split("\n").find((l) => l.trim()) ?? "";
  return plainText(parseInline(line.trim()), (id) => {
    const member = message.mentions.find((m) => m.id === id);
    return `@${member ? member.displayName : "member"}`;
  });
}

// ---- keys ---------------------------------------------------------------------

/**
 * Enter sends and Shift+Enter breaks, on a desktop only: a phone's Enter is
 * the only way it has to break a line. Never while an input method is still
 * composing the character.
 */
export function sendsOnEnter(
  event: { key: string; shiftKey: boolean; isComposing?: boolean },
  desktop: boolean,
): boolean {
  return (
    desktop && event.key === "Enter" && !event.shiftKey && !event.isComposing
  );
}
