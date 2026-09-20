/**
 * The persistence seam. The router talks only to this interface; `repo-pg.ts`
 * implements it on Postgres and `repo-memory.ts` on plain maps for tests and
 * for running the API with no database at all. People are not kept here:
 * authors and viewers are rows of the site's `users` table (site/api/repo.ts),
 * which this repo only joins against.
 *
 * Every read takes the viewer's id, or null when nobody is signed in. With a
 * viewer, the same query also answers what is theirs (unread, following,
 * myReactions); without one those fields are left off, not zeroed. A staff
 * viewer is the one reader who still sees what has been removed.
 *
 * Whatever a write tells people about is written with it, in the same
 * transaction: the author's automatic follow and the notification rows. A
 * thread muted with level `none` sends its owner nothing at all.
 */
import type { PhotoRow } from "../../market/api/src/repo.js";
import {
  LIMITS,
  type Channel,
  type FollowLevel,
  type FollowSource,
  type FollowTarget,
  type Message,
  type MessagePage,
  type MentionPage,
  type MessageWindow,
  type Meta,
  type NotificationPage,
  type NotificationSelector,
  type Reaction,
  type Thread,
  type ThreadCursor,
  type ThreadPage,
  type ThreadQuery,
  type ThreadStatus,
} from "../shared/types.js";
import { MENTION_PATTERN } from "../shared/validate.js";

export type { PhotoRow };

/** What the opening post and a reply have in common, ids and positions already assigned. */
interface NewBody {
  authorId: string;
  body: string;
  photos: PhotoRow[];
  /** The users the body's <@user_id> tokens resolved to. */
  mentionIds: string[];
}

export interface NewThread extends NewBody {
  id: string;
  /** The id of the opening post, which is the thread's message 0. */
  messageId: string;
  channelId: string;
  title: string;
  slug: string;
  spotId: string | null;
  tagIds: string[];
}

export interface NewMessage extends NewBody {
  id: string;
  threadId: string;
  replyToId: string | null;
}

export interface NewReport {
  id: string;
  reporterId: string;
  messageId: string;
  reason: string;
  note: string | null;
}

export interface ModLogEntry {
  id: string;
  actorId: string;
  /** What was done: pin, unpin, lock, unlock, remove, suspend, unsuspend. */
  action: string;
  targetType: "thread" | "message" | "user";
  targetId: string;
  reason: string | null;
}

export interface ModLogRow extends ModLogEntry {
  createdAt: string;
}

/** Thrown by createMessage when the thread is missing, locked or removed. */
export class ThreadClosedError extends Error {
  constructor(public threadId: string) {
    super(`Thread ${threadId} takes no replies`);
  }
}

/** Thrown by createMessage when replyToId is not a message of the same thread. */
export class ReplyTargetError extends Error {
  constructor(public replyToId: string) {
    super(`Message ${replyToId} is not in this thread`);
  }
}

/** Thrown by createThread and createMessage when a photo's storage key is already on a message. */
export class PhotoKeyTakenError extends Error {
  constructor(public storageKey: string) {
    super(`Photo ${storageKey} is already attached`);
  }
}

export interface Repo {
  /** The categories and the active channels with their tags, in rail order. */
  getMeta(): Promise<Meta>;
  /** The active channels in rail order, with unread and following for a viewer. */
  listChannels(viewerId: string | null): Promise<Channel[]>;
  /** Any status: an archived channel still resolves, it just leaves the rail. */
  getChannel(slug: string, viewerId: string | null): Promise<Channel | null>;

  /**
   * Most recent activity first, by cursor. Removed threads never list. With
   * `channelId`, pinned threads come first; without it, archived channels
   * stay out of the feed.
   */
  listThreads(query: ThreadQuery, viewerId: string | null): Promise<ThreadPage>;
  /** Null when there is no such thread, or it was removed and the viewer is not staff. */
  getThread(id: string, viewerId: string | null): Promise<Thread | null>;
  /**
   * Inserts the thread and its message 0 together. The author follows it
   * unless their autoFollow is off, the channel's followers get a `thread`
   * row each, and the people the opening post names a `mention` row.
   */
  createThread(input: NewThread): Promise<Thread>;
  setThreadPinned(id: string, pinned: boolean): Promise<Thread | null>;
  /** `lockedReason` is kept only while the status is locked. */
  setThreadStatus(
    id: string,
    status: ThreadStatus,
    lockedReason: string | null,
  ): Promise<Thread | null>;

  /** A window of the stream, oldest first. Null under the same rule as getThread. */
  listMessages(
    threadId: string,
    window: MessageWindow,
    viewerId: string | null,
  ): Promise<MessagePage | null>;
  getMessage(id: string, viewerId: string | null): Promise<Message | null>;
  /**
   * Takes the next seq and inserts the reply in one transaction, so parallel
   * replies number 1, 2, 3 with no gap and no repeat. The author follows the
   * thread as in createThread. Each person named gets a `mention` row of
   * their own; every other follower at level `all` gets the thread's unread
   * `reply` row, made or folded into: count + 1, the actor and the message
   * moved on. Nobody is told twice about one message, or about their own.
   */
  createMessage(input: NewMessage): Promise<Message>;
  /** Changes the words and the mentions, and stamps editedAt. Null, and nothing changed, in a removed thread. */
  editMessage(
    id: string,
    body: string,
    mentionIds: string[],
  ): Promise<Message | null>;
  /**
   * Soft: the row stays and reads as removed. Removing message 0 removes the
   * thread. The returned message is as `removedBy` sees it.
   */
  removeMessage(id: string, removedBy: string): Promise<Message | null>;
  /**
   * Idempotent. The message's counts change in the same transaction. Null in
   * a removed thread, as editMessage. A reaction newly on tells the message's
   * author in a `reaction` row, folded per message, one count per person.
   */
  setReaction(
    messageId: string,
    userId: string,
    emoji: Reaction,
    on: boolean,
  ): Promise<Message | null>;

  /**
   * Only ever moves forward, and never past the thread's last seq. Opening a
   * thread is also what clears its rows in the bell: see NotificationSelector.
   */
  markRead(userId: string, threadId: string, seq: number): Promise<void>;
  /** Resets the channel's unread count for this viewer. */
  markChannelSeen(userId: string, channelId: string): Promise<void>;
  /**
   * An `auto` follow never replaces a row that is already there, so a member
   * who muted a thread stays muted when they reply again.
   */
  setFollow(
    userId: string,
    targetType: FollowTarget,
    targetId: string,
    level: FollowLevel,
    source: FollowSource,
  ): Promise<void>;
  clearFollow(
    userId: string,
    targetType: FollowTarget,
    targetId: string,
  ): Promise<void>;

  /**
   * Every visible message that names this person, newest first, their own
   * aside. A muted thread's are here too: the page is a record, not a bell.
   */
  listMentions(
    userId: string,
    cursor: ThreadCursor | null,
    limit?: number,
  ): Promise<MentionPage>;

  /** The bell's number: unread rows, reactions aside, capped at 99. */
  countNotifications(userId: string): Promise<number>;
  /** Most recently changed first. Rows of a removed thread or message never list or count. */
  listNotifications(
    userId: string,
    cursor: ThreadCursor | null,
    limit?: number,
  ): Promise<NotificationPage>;
  /**
   * By thread it leaves `report` rows alone: a report is work to do, not
   * news that opening the thread has delivered.
   */
  markNotificationsRead(
    userId: string,
    which: NotificationSelector,
  ): Promise<void>;

  /**
   * Saves the report and, with it, a `report` row in the bell of everyone
   * whose role is staff, the reporter included if they are one. Reports never
   * fold: two on one message are two rows.
   */
  addReport(report: NewReport): Promise<void>;
  countReportsBy(reporterId: string, since: Date): Promise<number>;
  addModLog(entry: ModLogEntry): Promise<void>;
  /** Newest first. */
  listModLog(limit: number): Promise<ModLogRow[]>;

  /** Visible messages by this person, opening posts included. */
  countMessagesBy(authorId: string): Promise<number>;
  /** Threads this person started since `since`, removed ones included. */
  countThreadsBy(authorId: string, since: Date): Promise<number>;

  close(): Promise<void>;
}

/** The first line of a body, cut to fit a list row or a quoted reply. */
export function excerpt(body: string, max = 140): string {
  const line = body.trim().split(/\s*\n/, 1)[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/**
 * The line of a body that names `userId`, as the bell quotes it: every
 * <@user_id> token becomes the @name a reader would see. Falls back to the
 * first line when the token is gone, which an edit can do.
 */
export function mentionLine(
  body: string,
  userId: string,
  names: ReadonlyMap<string, string>,
  max = 140,
): string {
  const lines = body.trim().split(/\s*\n/);
  const line = lines.find((l) => l.includes(`<@${userId}>`)) ?? lines[0] ?? "";
  return excerpt(
    line.replace(
      MENTION_PATTERN,
      (_, id: string) => `@${names.get(id) ?? "member"}`,
    ),
    max,
  );
}

/** How many of a row's people the bell gets in full. */
export const NOTIFICATION_ACTORS = 3;

/** A removed message keeps its place in the stream and gives up its content. */
export function redact(message: Message): Message {
  return { ...message, body: "", photos: [], mentions: [], reactions: {} };
}

/** How many rows a page may ask for, whatever the caller sent. */
export function pageLimit(limit: number | undefined): number {
  const n = Math.trunc(limit ?? LIMITS.pageSize);
  return Math.min(Math.max(Number.isFinite(n) ? n : LIMITS.pageSize, 1), 100);
}

/**
 * The inclusive seq range a window asks for. A thread's seqs run 0..lastSeq
 * with no gaps (removal is soft), so a page is arithmetic, not a scan.
 * `around` keeps a full page when the position is near either end.
 */
export function seqRange(
  window: MessageWindow,
  lastSeq: number,
): { lo: number; hi: number } {
  const limit = pageLimit(window.limit);
  if ("after" in window) {
    const lo = Math.max(0, Math.trunc(window.after) + 1);
    return { lo, hi: Math.min(lastSeq, lo + limit - 1) };
  }
  if ("before" in window) {
    const hi = Math.min(lastSeq, Math.trunc(window.before) - 1);
    return { lo: Math.max(0, hi - limit + 1), hi };
  }
  const centred = Math.trunc(window.around) - Math.floor(limit / 2);
  const lo = Math.max(0, Math.min(centred, lastSeq - limit + 1));
  return { lo, hi: Math.min(lastSeq, lo + limit - 1) };
}

/** Words in a search, lowercased. Both repos match every word, in a title or in one message. */
export function searchTerms(q: string | undefined): string[] {
  return (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}
