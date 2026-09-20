/**
 * An in-memory Repo with the same semantics as the Postgres one. It backs the
 * unit tests and `MARKET_DB=memory`, which lets the whole forum run on a
 * laptop with no database. Nothing survives a restart. It starts with the
 * channels the migration inserts and nothing else. People live in the site's
 * memory users repo, handed in so both see the same rows.
 */
import {
  NOTIFICATION_ACTORS,
  PhotoKeyTakenError,
  ReplyTargetError,
  ThreadClosedError,
  excerpt,
  mentionLine,
  pageLimit,
  redact,
  searchTerms,
  seqRange,
  type ModLogRow,
  type NewReport,
  type PhotoRow,
  type Repo,
} from "./repo.js";
import { SEED_CATEGORIES, SEED_CHANNELS } from "./seed.js";
import {
  REACTIONS,
  type Channel,
  type FollowLevel,
  type FollowReason,
  type FollowSource,
  type FollowTarget,
  type Member,
  type Message,
  type Notification,
  type NotificationKind,
  type NotificationSelector,
  type Reaction,
  type Thread,
  type ThreadCursor,
  type ThreadRef,
  type ThreadStatus,
} from "../shared/types.js";
import { encodeCursor } from "../shared/validate.js";
import { newId } from "../../market/api/src/ids.js";
import type { MemoryUsersRepo } from "../../site/api/repo-memory.js";

interface StoredThread {
  id: string;
  channelId: string;
  authorId: string;
  title: string;
  slug: string;
  spotId: string | null;
  status: ThreadStatus;
  pinned: boolean;
  lockedReason: string | null;
  lastSeq: number;
  replyCount: number;
  participantCount: number;
  lastMessageAt: string;
  lastMessageBy: string | null;
  createdAt: string;
  tagIds: string[];
}

interface StoredMessage {
  id: string;
  threadId: string;
  seq: number;
  authorId: string;
  body: string;
  replyToId: string | null;
  status: "visible" | "removed";
  removedBy: string | null;
  editedAt: string | null;
  createdAt: string;
  photos: PhotoRow[];
  mentionIds: string[];
  /** emoji -> the ids of who reacted with it. */
  reactions: Map<Reaction, Set<string>>;
}

interface StoredNotification {
  id: string;
  userId: string;
  kind: NotificationKind;
  threadId: string;
  messageId: string;
  /** Everyone folded into the row, most recent first. */
  actorIds: string[];
  count: number;
  emoji: Reaction | null;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const key = (...parts: string[]) => parts.join("\n");

/** Newest first, then by id: the order the Mentions page and the bell share with their cursors. */
const newestFirst = (
  a: { at: string; id: string },
  b: { at: string; id: string },
) =>
  a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function memoryRepo(
  users: MemoryUsersRepo,
  now: () => Date = () => new Date(),
): Repo {
  const channels = new Map<string, Channel>(
    SEED_CHANNELS.map((c) => [c.id, { ...c, tags: [...c.tags] }]),
  );
  const threads = new Map<string, StoredThread>();
  const messages = new Map<string, StoredMessage>();
  const reads = new Map<string, number>(); // userId, threadId -> last read seq
  const channelSeen = new Map<string, string>(); // userId, channelId -> seen at
  const follows = new Map<
    string, // userId, targetType, targetId
    { level: FollowLevel; source: FollowSource; createdAt: string }
  >();
  const notifications: StoredNotification[] = [];
  const reports: (NewReport & { createdAt: string })[] = [];
  const modLog: ModLogRow[] = [];

  const member = (id: string): Member => {
    const u = users.peek(id);
    if (!u) throw new Error(`No user ${id}`);
    return {
      id,
      handle: u.handle,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      role: u.role,
    };
  };

  const isStaff = (viewerId: string | null) =>
    Boolean(viewerId && users.peek(viewerId)?.role === "staff");

  /** A thread's messages, oldest first. */
  const stream = (threadId: string) =>
    [...messages.values()]
      .filter((m) => m.threadId === threadId)
      .sort((a, b) => a.seq - b.seq);

  const visible = (threadId: string) =>
    stream(threadId).filter((m) => m.status === "visible");

  const photo = (p: PhotoRow) => ({
    id: p.id,
    url: p.url,
    width: p.width,
    height: p.height,
  });

  /** Rail order: by category, then by the channel's place in it. */
  const railOrder = (a: Channel, b: Channel) => {
    const category = (c: Channel) =>
      SEED_CATEGORIES.find((x) => x.id === c.categoryId)?.position ?? 0;
    return category(a) - category(b) || a.position - b.position;
  };

  const viewChannel = (c: Channel, viewerId: string | null): Channel => {
    const channel = { ...c, tags: [...c.tags] };
    if (!viewerId) return channel;
    // Never looked: count from when they joined, or nothing if they never have.
    const since =
      channelSeen.get(key(viewerId, c.id)) ??
      users.peek(viewerId)?.createdAt ??
      null;
    const unread = since
      ? [...threads.values()].filter(
          (t) =>
            t.channelId === c.id &&
            t.status !== "removed" &&
            t.lastMessageBy !== viewerId &&
            t.lastMessageAt > since,
        ).length
      : 0;
    const follow = follows.get(key(viewerId, "channel", c.id));
    return {
      ...channel,
      unread: Math.min(unread, 99),
      following: Boolean(follow && follow.level !== "none"),
    };
  };

  /** Why a thread is in the viewer's Following feed, or null when it is not. */
  const whyFollowed = (
    t: StoredThread,
    viewerId: string,
  ): FollowReason | null => {
    const own = follows.get(key(viewerId, "thread", t.id));
    if (own)
      return own.level === "none"
        ? null
        : t.authorId === viewerId
          ? "started"
          : visible(t.id).some((m) => m.authorId === viewerId)
            ? "replied"
            : "followed";
    // A channel tells its followers about what started after they followed it.
    const channel = follows.get(key(viewerId, "channel", t.channelId));
    return channel &&
      channel.level !== "none" &&
      t.createdAt >= channel.createdAt
      ? "channel"
      : null;
  };

  const viewThread = (
    t: StoredThread,
    viewerId: string | null,
    why?: FollowReason | null,
  ): Thread => {
    const channel = channels.get(t.channelId)!;
    const seen = visible(t.id);
    const newest = seen[seen.length - 1];
    const recent: string[] = [];
    for (const m of [...seen].reverse())
      if (!recent.includes(m.authorId)) recent.push(m.authorId);
    const opening = seen.find((m) => m.seq === 0);
    const thread: Thread = {
      id: t.id,
      channel: { id: channel.id, slug: channel.slug, name: channel.name },
      author: member(t.authorId),
      title: t.title,
      slug: t.slug,
      spotId: t.spotId,
      status: t.status,
      pinned: t.pinned,
      lockedReason: t.lockedReason,
      tags: channel.tags
        .filter((tag) => t.tagIds.includes(tag.id))
        .map((tag) => ({ id: tag.id, label: tag.label })),
      lastSeq: t.lastSeq,
      replyCount: t.replyCount,
      participantCount: t.participantCount,
      lastMessageAt: t.lastMessageAt,
      lastMessageBy: t.lastMessageBy ? member(t.lastMessageBy) : null,
      createdAt: t.createdAt,
      preview: newest
        ? { author: member(newest.authorId), text: excerpt(newest.body) }
        : null,
      participants: recent.slice(0, 3).map(member),
      thumbnail: opening?.photos.length
        ? photo([...opening.photos].sort((a, b) => a.position - b.position)[0])
        : null,
    };
    if (!viewerId) return thread;
    const lastReadSeq = reads.get(key(viewerId, t.id)) ?? null;
    return {
      ...thread,
      lastReadSeq,
      unread: t.lastSeq - (lastReadSeq ?? -1),
      following: follows.get(key(viewerId, "thread", t.id))?.level ?? null,
      ...(why ? { why } : {}),
    };
  };

  const viewMessage = (m: StoredMessage, viewerId: string | null): Message => {
    const target = m.replyToId ? messages.get(m.replyToId) : undefined;
    const reactions: Message["reactions"] = {};
    for (const emoji of REACTIONS) {
      const n = m.reactions.get(emoji)?.size ?? 0;
      if (n) reactions[emoji] = n;
    }
    const message: Message = {
      id: m.id,
      threadId: m.threadId,
      seq: m.seq,
      author: member(m.authorId),
      body: m.body,
      replyTo: target
        ? {
            id: target.id,
            seq: target.seq,
            author: member(target.authorId),
            excerpt: target.status === "removed" ? "" : excerpt(target.body),
            removed: target.status === "removed",
          }
        : null,
      reactions,
      status: m.status,
      editedAt: m.editedAt,
      createdAt: m.createdAt,
      photos: [...m.photos].sort((a, b) => a.position - b.position).map(photo),
      mentions: m.mentionIds.map(member),
      ...(viewerId
        ? {
            myReactions: REACTIONS.filter((emoji) =>
              m.reactions.get(emoji)?.has(viewerId),
            ),
          }
        : {}),
    };
    return m.status === "removed" && !isStaff(viewerId)
      ? redact(message)
      : message;
  };

  /** Null when the viewer may not see the thread at all. */
  const readable = (id: string, viewerId: string | null) => {
    const t = threads.get(id);
    if (!t || (t.status === "removed" && !isStaff(viewerId))) return null;
    return t;
  };

  /** A removed thread is gone to its members: nothing in it changes. */
  const inRemovedThread = (m: StoredMessage) =>
    threads.get(m.threadId)?.status === "removed";

  /** The counters a thread carries, recounted from its messages. */
  const recount = (t: StoredThread) => {
    const seen = visible(t.id);
    t.replyCount = seen.filter((m) => m.seq > 0).length;
    t.participantCount = new Set(seen.map((m) => m.authorId)).size;
  };

  const recountChannel = (channelId: string) => {
    const c = channels.get(channelId)!;
    c.threadCount = [...threads.values()].filter(
      (t) => t.channelId === channelId && t.status !== "removed",
    ).length;
    c.followerCount = [...follows.entries()].filter(
      ([k, f]) =>
        k.endsWith(key("", "channel", channelId)) && f.level !== "none",
    ).length;
  };

  /** Mentions of nobody are dropped, and the rest kept in id order, as the table returns them. */
  const mentioned = (ids: string[]) =>
    [...new Set(ids)].filter((id) => users.peek(id)).sort();

  /** The table's unique storage_key: a photo goes on one message, removed or not. */
  const refuseTakenKeys = (photos: PhotoRow[]) => {
    const taken = new Set(
      [...messages.values()].flatMap((m) => m.photos.map((p) => p.storageKey)),
    );
    for (const p of photos) {
      if (taken.has(p.storageKey)) throw new PhotoKeyTakenError(p.storageKey);
      taken.add(p.storageKey);
    }
  };

  const threadRef = (t: StoredThread): ThreadRef => {
    const channel = channels.get(t.channelId)!;
    return {
      id: t.id,
      slug: t.slug,
      title: t.title,
      channel: { id: channel.id, slug: channel.slug, name: channel.name },
    };
  };

  // ---- follows and the bell ------------------------------------------------

  const follow = (
    userId: string,
    targetType: FollowTarget,
    targetId: string,
    level: FollowLevel,
    source: FollowSource,
    at: string,
  ) => {
    const k = key(userId, targetType, targetId);
    const existing = follows.get(k);
    if (source === "auto" && existing) return;
    follows.set(k, { level, source, createdAt: existing?.createdAt ?? at });
  };

  /** Starting or replying follows the thread, unless the author switched that off. */
  const autoFollow = (authorId: string, threadId: string, at: string) => {
    if (users.peek(authorId)?.autoFollow)
      follow(authorId, "thread", threadId, "all", "auto", at);
  };

  const muted = (userId: string, threadId: string) =>
    follows.get(key(userId, "thread", threadId))?.level === "none";

  const followersOf = (
    targetType: FollowTarget,
    targetId: string,
    wanted: (level: FollowLevel) => boolean,
  ) =>
    [...follows.entries()]
      .filter(
        ([k, f]) =>
          k.endsWith(key("", targetType, targetId)) && wanted(f.level),
      )
      .map(([k]) => k.split("\n")[0]);

  /** Replies fold into the thread's unread row and reactions into the message's; the rest stand alone. */
  const notify = (
    n: Pick<
      StoredNotification,
      "userId" | "kind" | "threadId" | "messageId"
    > & { actorId: string; emoji?: Reaction },
    at: string,
  ) => {
    const open = notifications.find(
      (x) =>
        x.userId === n.userId &&
        x.kind === n.kind &&
        x.readAt === null &&
        (n.kind === "reply"
          ? x.threadId === n.threadId
          : n.kind === "reaction" && x.messageId === n.messageId),
    );
    if (!open) {
      notifications.push({
        id: newId(),
        userId: n.userId,
        kind: n.kind,
        threadId: n.threadId,
        messageId: n.messageId,
        actorIds: [n.actorId],
        count: 1,
        emoji: n.emoji ?? null,
        readAt: null,
        createdAt: at,
        updatedAt: at,
      });
      return;
    }
    // A reaction row counts people, so the same person reacting again adds nothing.
    if (n.kind === "reply" || !open.actorIds.includes(n.actorId))
      open.count += 1;
    open.actorIds = [
      n.actorId,
      ...open.actorIds.filter((id) => id !== n.actorId),
    ];
    open.messageId = n.messageId;
    open.emoji = n.emoji ?? null;
    open.updatedAt = at;
  };

  /**
   * Who a new message tells. The people it names get a row of their own;
   * `rest` is who else hears of it (the thread's followers for a reply, the
   * channel's for a new thread) and under which kind.
   */
  const fanOut = (
    m: StoredMessage,
    rest: { kind: "reply" | "thread"; userIds: string[] },
    at: string,
  ) => {
    const told = new Set([m.authorId]);
    const tell = (userId: string, kind: NotificationKind) => {
      if (told.has(userId) || muted(userId, m.threadId)) return;
      told.add(userId);
      notify(
        {
          userId,
          kind,
          threadId: m.threadId,
          messageId: m.id,
          actorId: m.authorId,
        },
        at,
      );
    };
    for (const userId of m.mentionIds) tell(userId, "mention");
    for (const userId of rest.userIds) tell(userId, rest.kind);
  };

  /** What the bell shows and counts: nothing of a removed thread, no mention or reaction of a removed message. */
  const shown = (n: StoredNotification) =>
    threads.get(n.threadId)?.status !== "removed" &&
    ((n.kind !== "mention" && n.kind !== "reaction") ||
      messages.get(n.messageId)?.status === "visible");

  const viewNotification = (n: StoredNotification): Notification => {
    const t = threads.get(n.threadId);
    const m = messages.get(n.messageId);
    return {
      id: n.id,
      kind: n.kind,
      thread: t ? threadRef(t) : null,
      messageId: n.messageId,
      seq: m?.seq ?? null,
      actors: n.actorIds.slice(0, NOTIFICATION_ACTORS).map(member),
      actorCount: n.actorIds.length,
      count: n.count,
      emoji: n.emoji,
      excerpt:
        n.kind === "mention" && m
          ? mentionLine(
              m.body,
              n.userId,
              new Map(m.mentionIds.map((id) => [id, member(id).displayName])),
            )
          : null,
      readAt: n.readAt,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    };
  };

  const markNotificationsRead = (
    userId: string,
    which: NotificationSelector,
  ) => {
    const at = now().toISOString();
    for (const n of notifications) {
      if (n.userId !== userId || n.readAt !== null) continue;
      if (
        "all" in which ||
        ("ids" in which
          ? which.ids.includes(n.id)
          : n.threadId === which.threadId && n.kind !== "report")
      )
        n.readAt = at;
    }
  };

  /** One page of rows already in newestFirst order, and the cursor for the next. */
  const pageOf = <T extends { at: string; id: string }>(
    rows: T[],
    cursor: ThreadCursor | null,
    limit: number | undefined,
  ) => {
    const size = pageLimit(limit);
    const rest = rows.filter(
      (r) =>
        !cursor ||
        newestFirst({ at: cursor.lastMessageAt, id: cursor.id }, r) < 0,
    );
    const page = rest.slice(0, size);
    const last = page[page.length - 1];
    return {
      page,
      nextCursor:
        rest.length > size
          ? encodeCursor({ lastMessageAt: last.at, id: last.id })
          : null,
    };
  };

  const readUpTo = (userId: string, threadId: string, seq: number) => {
    const k = key(userId, threadId);
    reads.set(k, Math.max(reads.get(k) ?? -1, seq));
  };

  const matches = (t: StoredThread, terms: string[]) => {
    const has = (text: string) =>
      terms.every((term) => text.toLowerCase().includes(term));
    return has(t.title) || visible(t.id).some((m) => has(m.body));
  };

  return {
    async getMeta() {
      return {
        categories: SEED_CATEGORIES.map((c) => ({ ...c })),
        channels: [...channels.values()]
          .filter((c) => c.status === "active")
          .sort(railOrder)
          .map((c) => viewChannel(c, null)),
      };
    },

    async listChannels(viewerId) {
      return [...channels.values()]
        .filter((c) => c.status === "active")
        .sort(railOrder)
        .map((c) => viewChannel(c, viewerId));
    },

    async getChannel(slug, viewerId) {
      const c = [...channels.values()].find((x) => x.slug === slug);
      return c ? viewChannel(c, viewerId) : null;
    },

    async listThreads(query, viewerId) {
      const limit = pageLimit(query.limit);
      const terms = searchTerms(query.q);
      const pinnedFirst = Boolean(query.channelId) && !terms.length;
      const rank = (t: { pinned: boolean }) =>
        pinnedFirst && t.pinned ? 0 : 1;
      const order = (
        a: { pinned: boolean; lastMessageAt: string; id: string },
        b: { pinned: boolean; lastMessageAt: string; id: string },
      ) =>
        rank(a) - rank(b) ||
        (a.lastMessageAt < b.lastMessageAt
          ? 1
          : a.lastMessageAt > b.lastMessageAt
            ? -1
            : a.id < b.id
              ? -1
              : a.id > b.id
                ? 1
                : 0);
      const cursor = query.cursor ? { pinned: false, ...query.cursor } : null;
      const rows = [...threads.values()]
        .filter((t) => t.status !== "removed")
        .filter((t) =>
          query.channelId
            ? t.channelId === query.channelId
            : channels.get(t.channelId)!.status === "active",
        )
        .filter(
          (t) =>
            !query.following || Boolean(viewerId && whyFollowed(t, viewerId)),
        )
        .filter((t) => !query.tagId || t.tagIds.includes(query.tagId))
        .filter((t) => !terms.length || matches(t, terms))
        .sort(order)
        .filter((t) => !cursor || order(cursor, t) < 0);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((t) =>
          viewThread(
            t,
            viewerId,
            query.following && viewerId ? whyFollowed(t, viewerId) : null,
          ),
        ),
        nextCursor:
          rows.length > limit
            ? encodeCursor({
                ...(pinnedFirst ? { pinned: last.pinned } : {}),
                lastMessageAt: last.lastMessageAt,
                id: last.id,
              })
            : null,
      };
    },

    async getThread(id, viewerId) {
      const t = readable(id, viewerId);
      return t ? viewThread(t, viewerId) : null;
    },

    async createThread(input) {
      const at = now().toISOString();
      const channel = channels.get(input.channelId);
      if (!channel) throw new Error(`No channel ${input.channelId}`);
      refuseTakenKeys(input.photos);
      const thread: StoredThread = {
        id: input.id,
        channelId: input.channelId,
        authorId: input.authorId,
        title: input.title,
        slug: input.slug,
        spotId: input.spotId,
        status: "open",
        pinned: false,
        lockedReason: null,
        lastSeq: 0,
        replyCount: 0,
        participantCount: 1,
        lastMessageAt: at,
        lastMessageBy: input.authorId,
        createdAt: at,
        // A tag of some other channel is dropped, not stored.
        tagIds: input.tagIds.filter((id) =>
          channel.tags.some((tag) => tag.id === id),
        ),
      };
      threads.set(thread.id, thread);
      messages.set(input.messageId, {
        id: input.messageId,
        threadId: thread.id,
        seq: 0,
        authorId: input.authorId,
        body: input.body,
        replyToId: null,
        status: "visible",
        removedBy: null,
        editedAt: null,
        createdAt: at,
        photos: input.photos,
        mentionIds: mentioned(input.mentionIds),
        reactions: new Map(),
      });
      channel.lastMessageAt = at;
      recountChannel(channel.id);
      readUpTo(input.authorId, thread.id, 0);
      autoFollow(input.authorId, thread.id, at);
      fanOut(
        messages.get(input.messageId)!,
        {
          kind: "thread",
          userIds: followersOf("channel", channel.id, (l) => l !== "none"),
        },
        at,
      );
      return viewThread(thread, input.authorId);
    },

    async setThreadPinned(id, pinned) {
      const t = threads.get(id);
      if (!t) return null;
      t.pinned = pinned;
      return viewThread(t, null);
    },

    async setThreadStatus(id, status, lockedReason) {
      const t = threads.get(id);
      if (!t) return null;
      t.status = status;
      t.lockedReason = status === "locked" ? lockedReason : null;
      recountChannel(t.channelId);
      return viewThread(t, null);
    },

    async listMessages(threadId, window, viewerId) {
      const t = readable(threadId, viewerId);
      if (!t) return null;
      const { lo, hi } = seqRange(window, t.lastSeq);
      return {
        items: stream(threadId)
          .filter((m) => m.seq >= lo && m.seq <= hi)
          .map((m) => viewMessage(m, viewerId)),
        hasOlder: lo > 0,
        hasNewer: hi < t.lastSeq,
      };
    },

    async getMessage(id, viewerId) {
      const m = messages.get(id);
      if (!m || !readable(m.threadId, viewerId)) return null;
      return viewMessage(m, viewerId);
    },

    async createMessage(input) {
      const t = threads.get(input.threadId);
      if (!t || t.status !== "open")
        throw new ThreadClosedError(input.threadId);
      if (input.replyToId) {
        const target = messages.get(input.replyToId);
        if (!target || target.threadId !== t.id)
          throw new ReplyTargetError(input.replyToId);
      }
      refuseTakenKeys(input.photos);
      const at = now().toISOString();
      t.lastSeq += 1;
      const message: StoredMessage = {
        id: input.id,
        threadId: t.id,
        seq: t.lastSeq,
        authorId: input.authorId,
        body: input.body,
        replyToId: input.replyToId,
        status: "visible",
        removedBy: null,
        editedAt: null,
        createdAt: at,
        photos: input.photos,
        mentionIds: mentioned(input.mentionIds),
        reactions: new Map(),
      };
      messages.set(message.id, message);
      t.lastMessageAt = at;
      t.lastMessageBy = input.authorId;
      recount(t);
      channels.get(t.channelId)!.lastMessageAt = at;
      readUpTo(input.authorId, t.id, message.seq);
      autoFollow(input.authorId, t.id, at);
      fanOut(
        message,
        {
          kind: "reply",
          userIds: followersOf("thread", t.id, (l) => l === "all"),
        },
        at,
      );
      return viewMessage(message, input.authorId);
    },

    async editMessage(id, body, mentionIds) {
      const m = messages.get(id);
      if (!m || m.status === "removed" || inRemovedThread(m)) return null;
      m.body = body;
      m.mentionIds = mentioned(mentionIds);
      m.editedAt = now().toISOString();
      return viewMessage(m, m.authorId);
    },

    async removeMessage(id, removedBy) {
      const m = messages.get(id);
      if (!m) return null;
      const t = threads.get(m.threadId)!;
      if (m.status !== "removed") {
        m.status = "removed";
        m.removedBy = removedBy;
        recount(t);
        if (m.seq === 0) {
          t.status = "removed";
          t.lockedReason = null;
          recountChannel(t.channelId);
        }
      }
      return viewMessage(m, removedBy);
    },

    async setReaction(messageId, userId, emoji, on) {
      const m = messages.get(messageId);
      if (!m || m.status === "removed" || inRemovedThread(m)) return null;
      const who = m.reactions.get(emoji) ?? new Set<string>();
      const fresh = on && !who.has(userId);
      if (on) who.add(userId);
      else who.delete(userId);
      m.reactions.set(emoji, who);
      if (fresh && m.authorId !== userId && !muted(m.authorId, m.threadId))
        notify(
          {
            userId: m.authorId,
            kind: "reaction",
            threadId: m.threadId,
            messageId: m.id,
            actorId: userId,
            emoji,
          },
          now().toISOString(),
        );
      return viewMessage(m, userId);
    },

    async markRead(userId, threadId, seq) {
      const t = threads.get(threadId);
      if (!t) return;
      readUpTo(
        userId,
        threadId,
        Math.min(Math.max(Math.trunc(seq), 0), t.lastSeq),
      );
      markNotificationsRead(userId, { threadId });
    },

    async markChannelSeen(userId, channelId) {
      if (channels.has(channelId))
        channelSeen.set(key(userId, channelId), now().toISOString());
    },

    async setFollow(userId, targetType, targetId, level, source) {
      follow(userId, targetType, targetId, level, source, now().toISOString());
      if (targetType === "channel" && channels.has(targetId))
        recountChannel(targetId);
    },

    async clearFollow(userId, targetType, targetId) {
      follows.delete(key(userId, targetType, targetId));
      if (targetType === "channel" && channels.has(targetId))
        recountChannel(targetId);
    },

    async listMentions(userId, cursor, limit) {
      const rows = [...messages.values()]
        .filter(
          (m) =>
            m.mentionIds.includes(userId) &&
            m.authorId !== userId &&
            m.status === "visible" &&
            !inRemovedThread(m),
        )
        .map((m) => ({ at: m.createdAt, id: m.id, m }))
        .sort(newestFirst);
      const { page, nextCursor } = pageOf(rows, cursor, limit);
      return {
        items: page.map(({ m }) => ({
          message: viewMessage(m, userId),
          thread: threadRef(threads.get(m.threadId)!),
        })),
        nextCursor,
      };
    },

    async countNotifications(userId) {
      const unread = notifications.filter(
        (n) =>
          n.userId === userId &&
          n.readAt === null &&
          n.kind !== "reaction" &&
          shown(n),
      ).length;
      return Math.min(unread, 99);
    },

    async listNotifications(userId, cursor, limit) {
      const rows = notifications
        .filter((n) => n.userId === userId && shown(n))
        .map((n) => ({ at: n.updatedAt, id: n.id, n }))
        .sort(newestFirst);
      const { page, nextCursor } = pageOf(rows, cursor, limit);
      return { items: page.map(({ n }) => viewNotification(n)), nextCursor };
    },

    async markNotificationsRead(userId, which) {
      markNotificationsRead(userId, which);
    },

    async addReport(report) {
      const m = messages.get(report.messageId);
      if (!m) throw new Error(`No message ${report.messageId}`);
      const at = now().toISOString();
      reports.push({ ...report, createdAt: at });
      for (const { id } of users.staff())
        notify(
          {
            userId: id,
            kind: "report",
            threadId: m.threadId,
            messageId: m.id,
            actorId: report.reporterId,
          },
          at,
        );
    },

    async countReportsBy(reporterId, since) {
      const from = since.toISOString();
      return reports.filter(
        (r) => r.reporterId === reporterId && r.createdAt >= from,
      ).length;
    },

    async addModLog(entry) {
      modLog.push({ ...entry, createdAt: now().toISOString() });
    },

    async listModLog(limit) {
      return [...modLog].reverse().slice(0, pageLimit(limit));
    },

    async countMessagesBy(authorId) {
      return [...messages.values()].filter(
        (m) => m.authorId === authorId && m.status === "visible",
      ).length;
    },

    async countThreadsBy(authorId, since) {
      const from = since.toISOString();
      return [...threads.values()].filter(
        (t) => t.authorId === authorId && t.createdAt >= from,
      ).length;
    },

    async close() {},
  };
}
