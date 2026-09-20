/**
 * Types and vocabularies shared by the community API and the web client.
 *
 * Everything here is plain data. Nothing imports React, Node or a database,
 * so both sides can depend on it without pulling in the other's runtime.
 */
import type { UserRole } from "../../site/shared/types.js";

export const LIMITS = {
  titleMax: 120,
  bodyMax: 5000,
  photosPerMessage: 4,
  tagsPerThread: 3,
  mentionsPerMessage: 5,
  /** How long an author may edit their own message. Deleting has no window. */
  editWindowMin: 30,
  pageSize: 30,
  /** A member is new for this long, and until this many of their messages stand. */
  newMemberHours: 24,
  newMemberMessages: 3,
} as const;

/** The fixed twelve. A reaction outside this list is refused. */
export const REACTIONS = [
  "👍",
  "🤙",
  "❤️",
  "😂",
  "😮",
  "🙏",
  "🔥",
  "👀",
  "💨",
  "🌊",
  "✅",
  "🙌",
] as const;
export type Reaction = (typeof REACTIONS)[number];

export const POST_POLICIES = ["everyone", "staff"] as const;
export type PostPolicy = (typeof POST_POLICIES)[number];

export const CHANNEL_STATUSES = ["active", "archived"] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export const THREAD_STATUSES = ["open", "locked", "removed"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export const MESSAGE_STATUSES = ["visible", "removed"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const FOLLOW_TARGETS = ["thread", "channel"] as const;
export type FollowTarget = (typeof FOLLOW_TARGETS)[number];

/** `none` is a row too: it is how a member mutes a thread they replied in. */
export const FOLLOW_LEVELS = ["all", "mentions", "none"] as const;
export type FollowLevel = (typeof FOLLOW_LEVELS)[number];

export const FOLLOW_SOURCES = ["auto", "manual"] as const;
export type FollowSource = (typeof FOLLOW_SOURCES)[number];

/**
 * Why a thread is in the Following feed. `followed` is the Follow button on a
 * thread the viewer never wrote in; `channel` is a new thread in a channel
 * they follow.
 */
export const FOLLOW_REASONS = [
  "started",
  "replied",
  "followed",
  "channel",
] as const;
export type FollowReason = (typeof FOLLOW_REASONS)[number];

export const NOTIFICATION_KINDS = [
  "reply",
  "mention",
  "thread",
  "reaction",
  "report",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** A person as the community shows them. Contact details never enter this shape. */
export interface Member {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
}

export interface Category {
  id: string;
  name: string;
  position: number;
}

export interface Tag {
  id: string;
  channelId: string;
  label: string;
  position: number;
}

export interface Channel {
  id: string;
  slug: string;
  categoryId: string;
  name: string;
  description: string;
  postPolicy: PostPolicy;
  status: ChannelStatus;
  position: number;
  /** Threads that have not been removed. */
  threadCount: number;
  followerCount: number;
  lastMessageAt: string | null;
  tags: Tag[];
  // The rest is only present when the request carried a signed-in viewer.
  /** Threads with activity since the viewer last looked at the channel, capped at 99. */
  unread?: number;
  following?: boolean;
}

/** What GET /meta is built from: the categories and every active channel with its tags. */
export interface Meta {
  categories: Category[];
  channels: Channel[];
}

/** GET /meta: everything a client needs before it draws anything. */
export interface MetaPayload extends Meta {
  reactions: readonly Reaction[];
  limits: typeof LIMITS;
  auth: "clerk" | "dev";
}

export interface MessagePhoto {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
}

/** A thread as a list row and as the head of its own page: one shape for both. */
export interface Thread {
  id: string;
  channel: { id: string; slug: string; name: string };
  author: Member;
  title: string;
  /** Decoration for the URL. The id is what resolves. */
  slug: string;
  spotId: string | null;
  status: ThreadStatus;
  pinned: boolean;
  lockedReason: string | null;
  tags: { id: string; label: string }[];
  /** The highest message seq. The opening post is seq 0. */
  lastSeq: number;
  replyCount: number;
  participantCount: number;
  lastMessageAt: string;
  lastMessageBy: Member | null;
  createdAt: string;
  /** The newest visible message, cut to one line. Null once everything is removed. */
  preview: { author: Member; text: string } | null;
  /** Up to three people, most recent first. */
  participants: Member[];
  /** The opening post's first photo. */
  thumbnail: MessagePhoto | null;
  // The rest is only present when the request carried a signed-in viewer.
  /** Null until the viewer has opened the thread. */
  lastReadSeq?: number | null;
  /** Messages after lastReadSeq; every message when the thread was never opened. */
  unread?: number;
  /** Null when the viewer has no follow row for the thread. */
  following?: FollowLevel | null;
  /** Only on the Following feed. */
  why?: FollowReason;
}

/** The message a reply points at, as the quoted line above it. */
export interface ReplyRef {
  id: string;
  seq: number;
  author: Member;
  /** The target's first line. Empty when the target has been removed. */
  excerpt: string;
  removed: boolean;
}

export interface Message {
  id: string;
  threadId: string;
  /** Position in the thread and the cursor. 0 is the opening post. */
  seq: number;
  author: Member;
  /** Text with a small markdown subset, never HTML. Empty when removed, except to staff. */
  body: string;
  replyTo: ReplyRef | null;
  /** Counts by emoji, only for emoji with at least one reaction. */
  reactions: Partial<Record<Reaction, number>>;
  status: MessageStatus;
  editedAt: string | null;
  createdAt: string;
  photos: MessagePhoto[];
  /** The people behind the body's <@user_id> tokens, so a renamed member still renders. */
  mentions: Member[];
  /** Only present when the request carried a signed-in viewer. */
  myReactions?: Reaction[];
}

/**
 * Thread lists page by (last activity, id), never by offset: a reply moves a
 * thread. The Mentions page and the bell page the same way and reuse the
 * shape, with `lastMessageAt` holding the row's own time.
 */
export interface ThreadCursor {
  /** Set on channel lists, where pinned threads come first. */
  pinned?: boolean;
  lastMessageAt: string;
  id: string;
}

export interface ThreadQuery {
  /** Narrows to one channel and puts its pinned threads first. */
  channelId?: string;
  tagId?: string;
  /** Words to find in titles and message bodies. */
  q?: string;
  /** Only what the viewer follows, each with its `why`. Nothing without a viewer. */
  following?: boolean;
  cursor?: ThreadCursor | null;
  limit?: number;
}

export interface ThreadPage {
  items: Thread[];
  /** Null on the last page. Opaque to the client: see encodeCursor. */
  nextCursor: string | null;
}

/** Messages page by seq, in either direction or around a position. */
export type MessageWindow =
  | { after: number; limit?: number }
  | { before: number; limit?: number }
  | { around: number; limit?: number };

export interface MessagePage {
  /** Oldest first. */
  items: Message[];
  hasOlder: boolean;
  hasNewer: boolean;
}

/** GET /threads/:id: the head of the page, its opening post and where to start reading. */
export interface ThreadView {
  thread: Thread;
  opening: Message;
  /** Around the viewer's last read; from the top for anyone who has not opened it. */
  messages: MessagePage;
}

/** Enough of a thread to name it and link to it. */
export interface ThreadRef {
  id: string;
  slug: string;
  title: string;
  channel: { id: string; slug: string; name: string };
}

/** A row of the Mentions page: the message, and the thread it sits in. */
export interface MentionItem {
  message: Message;
  thread: ThreadRef;
}

export interface MentionPage {
  /** Newest first. */
  items: MentionItem[];
  nextCursor: string | null;
}

/** A row of the bell. Replies fold per thread and reactions per message; the rest stand alone. */
export interface Notification {
  id: string;
  kind: NotificationKind;
  thread: ThreadRef | null;
  /** The message to land on: the newest one folded into the row. */
  messageId: string | null;
  seq: number | null;
  /** Up to three of the people behind the row, most recent first. */
  actors: Member[];
  /** Everyone behind the row, the ones not in `actors` included. */
  actorCount: number;
  /** How many events the row holds: 4 for "4 new replies". */
  count: number;
  /** The latest reaction, on a reaction row. */
  emoji: Reaction | null;
  /** The line that names the viewer, on a mention row, with each token as its @name. */
  excerpt: string | null;
  readAt: string | null;
  createdAt: string;
  /** When the row last took an event. The list sorts on it. */
  updatedAt: string;
}

export interface NotificationPage {
  /** Most recently changed first. */
  items: Notification[];
  nextCursor: string | null;
}

/** PUT /notifications/read takes exactly one of these. */
export type NotificationSelector =
  { ids: string[] } | { threadId: string } | { all: true };

export interface ThreadInput {
  title: string;
  body: string;
  tagIds: string[];
  photoKeys: string[];
  spotId?: string | null;
}

export interface MessageInput {
  body: string;
  replyToId?: string | null;
  photoKeys: string[];
}
