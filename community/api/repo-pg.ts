import type { PendingQuery, Row, TransactionSql } from "postgres";
import type { Db } from "../../market/api/src/db.js";
import {
  PhotoKeyTakenError,
  ReplyTargetError,
  ThreadClosedError,
  excerpt,
  pageLimit,
  redact,
  searchTerms,
  seqRange,
  type ModLogRow,
  type PhotoRow,
  type Repo,
} from "./repo.js";
import {
  REACTIONS,
  type Category,
  type Channel,
  type Member,
  type Message,
  type MessagePhoto,
  type Tag,
  type Thread,
} from "../shared/types.js";
import { encodeCursor } from "../shared/validate.js";

interface ChannelRow {
  id: string;
  slug: string;
  category_id: string;
  name: string;
  description: string;
  post_policy: string;
  status: string;
  position: number;
  thread_count: number;
  follower_count: number;
  last_message_at: Date | null;
  unread: string | number | null;
  following: boolean | null;
}

interface TagRow {
  id: string;
  channel_id: string;
  label: string;
  position: number;
}

/** The columns of `users` a member is shown by, under a prefix per join. */
type MemberCols<P extends string> = {
  [K in "handle" | "display_name" | "avatar_url" | "role" as `${P}_${K}`]:
    string | null;
};

interface ThreadRow extends MemberCols<"a">, MemberCols<"l"> {
  id: string;
  channel_id: string;
  channel_slug: string;
  channel_name: string;
  author_id: string;
  title: string;
  slug: string;
  spot_id: string | null;
  status: string;
  pinned: boolean;
  locked_reason: string | null;
  last_seq: number;
  reply_count: number;
  participant_count: number;
  last_message_at: Date;
  last_message_by: string | null;
  created_at: Date;
  last_read_seq: number | null;
  follow_level: string | null;
}

interface MessageRow extends MemberCols<"a">, MemberCols<"r"> {
  id: string;
  thread_id: string;
  seq: number;
  author_id: string;
  body: string;
  reply_to_id: string | null;
  reactions: Record<string, number>;
  status: string;
  edited_at: Date | null;
  created_at: Date;
  r_seq: number | null;
  r_body: string | null;
  r_status: string | null;
  r_author_id: string | null;
  my_reactions: string[] | null;
  as_staff: boolean;
}

interface PhotoDbRow {
  id: string;
  owner_id: string;
  url: string;
  width: number | null;
  height: number | null;
}

interface MemberRow extends MemberCols<"u"> {
  owner_id: string;
  user_id: string;
}

const iso = (d: Date) => d.toISOString();
const num = (v: string | number | null | undefined) =>
  v == null ? 0 : Number(v);

function toMember<P extends string>(
  id: string,
  row: MemberCols<P>,
  prefix: P,
): Member {
  const col = (name: string) =>
    (row as Record<string, string | null>)[`${prefix}_${name}`];
  return {
    id,
    handle: col("handle") as string,
    displayName: col("display_name") as string,
    avatarUrl: col("avatar_url"),
    role: col("role") as Member["role"],
  };
}

const toPhoto = (p: PhotoDbRow): MessagePhoto => ({
  id: p.id,
  url: p.url,
  width: p.width,
  height: p.height,
});

/** Rows keyed by whatever they hang off, keeping the order they came in. */
function groupBy<T extends { owner_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.owner_id) ?? [];
    list.push(row);
    map.set(row.owner_id, list);
  }
  return map;
}

/** Postgres reports a broken unique constraint as 23505 and names the constraint. */
function isKeyClash(err: unknown): boolean {
  const e = err as { code?: string; constraint_name?: string };
  return (
    e?.code === "23505" &&
    e.constraint_name === "community_message_photos_storage_key_key"
  );
}

export function pgRepo(sql: Db, now: () => Date = () => new Date()): Repo {
  const isStaff = (viewerId: string | null) =>
    viewerId
      ? sql`exists (select 1 from users su where su.id = ${viewerId} and su.role = 'staff')`
      : sql`false`;

  // ---- channels ------------------------------------------------------------

  async function tagsByChannel(): Promise<Map<string, Tag[]>> {
    const rows = await sql<TagRow[]>`
      select * from community_tags order by channel_id, position`;
    const map = new Map<string, Tag[]>();
    for (const r of rows) {
      const list = map.get(r.channel_id) ?? [];
      list.push({
        id: r.id,
        channelId: r.channel_id,
        label: r.label,
        position: r.position,
      });
      map.set(r.channel_id, list);
    }
    return map;
  }

  /**
   * Unread is the threads that moved since the viewer last looked, other
   * people's only. Never looked: since they joined, or nothing if they never
   * have. The inner limit is the cap, so a busy channel costs 99 rows.
   */
  const channelViewer = (viewerId: string | null) =>
    viewerId
      ? sql`
        (select count(*) from (
           select 1 from community_threads t
           where t.channel_id = c.id and t.status <> 'removed'
             and t.last_message_by is distinct from ${viewerId}
             and t.last_message_at > coalesce(
               (select s.seen_at from community_channel_seen s
                where s.user_id = ${viewerId} and s.channel_id = c.id),
               (select vu.created_at from users vu where vu.id = ${viewerId}))
           limit 99) x) as unread,
        exists (select 1 from community_follows f
                where f.user_id = ${viewerId} and f.target_type = 'channel'
                  and f.target_id = c.id and f.level <> 'none') as following`
      : sql`null::integer as unread, null::boolean as following`;

  async function channelsWhere(
    where: PendingQuery<Row[]>,
    viewerId: string | null,
  ): Promise<Channel[]> {
    const [rows, tags] = await Promise.all([
      sql<ChannelRow[]>`
        select c.*, ${channelViewer(viewerId)}
        from community_channels c
        join community_categories g on g.id = c.category_id
        where ${where}
        order by g.position, c.position`,
      tagsByChannel(),
    ]);
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      categoryId: r.category_id,
      name: r.name,
      description: r.description,
      postPolicy: r.post_policy as Channel["postPolicy"],
      status: r.status as Channel["status"],
      position: r.position,
      threadCount: r.thread_count,
      followerCount: r.follower_count,
      lastMessageAt: r.last_message_at ? iso(r.last_message_at) : null,
      tags: tags.get(r.id) ?? [],
      ...(viewerId
        ? { unread: num(r.unread), following: Boolean(r.following) }
        : {}),
    }));
  }

  // ---- threads -------------------------------------------------------------

  const threadSelect = (viewerId: string | null) => sql`
    select t.*, c.slug as channel_slug, c.name as channel_name,
           a.handle as a_handle, a.display_name as a_display_name,
           a.avatar_url as a_avatar_url, a.role as a_role,
           l.handle as l_handle, l.display_name as l_display_name,
           l.avatar_url as l_avatar_url, l.role as l_role,
           ${
             viewerId
               ? sql`rd.last_read_seq, fo.level as follow_level`
               : sql`null::integer as last_read_seq, null::text as follow_level`
           }
    from community_threads t
    join community_channels c on c.id = t.channel_id
    join users a on a.id = t.author_id
    left join users l on l.id = t.last_message_by
    ${
      viewerId
        ? sql`
    left join community_reads rd on rd.thread_id = t.id and rd.user_id = ${viewerId}
    left join community_follows fo on fo.target_type = 'thread'
      and fo.target_id = t.id and fo.user_id = ${viewerId}`
        : sql``
    }`;

  /** Tags, the preview line, recent people and the thumbnail, one query each for the whole page. */
  async function hydrateThreads(
    rows: ThreadRow[],
    viewerId: string | null,
  ): Promise<Thread[]> {
    if (!rows.length) return [];
    const ids = sql(rows.map((r) => r.id));
    const [tagRows, previewRows, peopleRows, thumbRows] = await Promise.all([
      sql<{ owner_id: string; id: string; label: string }[]>`
        select tt.thread_id as owner_id, g.id, g.label
        from community_thread_tags tt join community_tags g on g.id = tt.tag_id
        where tt.thread_id in ${ids} order by g.position`,
      sql<(MemberRow & { body: string })[]>`
        select distinct on (m.thread_id) m.thread_id as owner_id, m.body, u.id as user_id,
               u.handle as u_handle, u.display_name as u_display_name,
               u.avatar_url as u_avatar_url, u.role as u_role
        from community_messages m join users u on u.id = m.author_id
        where m.thread_id in ${ids} and m.status = 'visible'
        order by m.thread_id, m.seq desc`,
      sql<MemberRow[]>`
        select p.thread_id as owner_id, u.id as user_id,
               u.handle as u_handle, u.display_name as u_display_name,
               u.avatar_url as u_avatar_url, u.role as u_role
        from (
          select m.thread_id, m.author_id, max(m.seq) as latest,
                 row_number() over (partition by m.thread_id order by max(m.seq) desc) as place
          from community_messages m
          where m.thread_id in ${ids} and m.status = 'visible'
          group by m.thread_id, m.author_id
        ) p join users u on u.id = p.author_id
        where p.place <= 3
        order by p.thread_id, p.latest desc`,
      sql<PhotoDbRow[]>`
        select distinct on (m.thread_id) m.thread_id as owner_id, ph.id, ph.url, ph.width, ph.height
        from community_message_photos ph
        join community_messages m on m.id = ph.message_id
        where m.thread_id in ${ids} and m.seq = 0 and m.status = 'visible'
        order by m.thread_id, ph.position, ph.created_at`,
    ]);
    const tags = groupBy(tagRows);
    const previews = groupBy(previewRows);
    const people = groupBy(peopleRows);
    const thumbs = groupBy(thumbRows);

    return rows.map((r) => {
      const preview = previews.get(r.id)?.[0];
      const thumb = thumbs.get(r.id)?.[0];
      const thread: Thread = {
        id: r.id,
        channel: {
          id: r.channel_id,
          slug: r.channel_slug,
          name: r.channel_name,
        },
        author: toMember(r.author_id, r, "a"),
        title: r.title,
        slug: r.slug,
        spotId: r.spot_id,
        status: r.status as Thread["status"],
        pinned: r.pinned,
        lockedReason: r.locked_reason,
        tags: (tags.get(r.id) ?? []).map((g) => ({ id: g.id, label: g.label })),
        lastSeq: r.last_seq,
        replyCount: r.reply_count,
        participantCount: r.participant_count,
        lastMessageAt: iso(r.last_message_at),
        lastMessageBy: r.last_message_by
          ? toMember(r.last_message_by, r, "l")
          : null,
        createdAt: iso(r.created_at),
        preview: preview
          ? {
              author: toMember(preview.user_id, preview, "u"),
              text: excerpt(preview.body),
            }
          : null,
        participants: (people.get(r.id) ?? []).map((p) =>
          toMember(p.user_id, p, "u"),
        ),
        thumbnail: thumb ? toPhoto(thumb) : null,
      };
      if (!viewerId) return thread;
      return {
        ...thread,
        lastReadSeq: r.last_read_seq,
        unread: r.last_seq - (r.last_read_seq ?? -1),
        following: r.follow_level as Thread["following"],
      };
    });
  }

  async function oneThread(
    id: string,
    viewerId: string | null,
  ): Promise<Thread | null> {
    const rows = await sql<ThreadRow[]>`
      ${threadSelect(viewerId)}
      where t.id = ${id} and (t.status <> 'removed' or ${isStaff(viewerId)})`;
    return (await hydrateThreads(rows, viewerId))[0] ?? null;
  }

  /** Moderation answers with the thread whatever its status, as staff would read it. */
  async function oneThreadAsStaff(id: string): Promise<Thread | null> {
    const rows = await sql<
      ThreadRow[]
    >`${threadSelect(null)} where t.id = ${id}`;
    return (await hydrateThreads(rows, null))[0] ?? null;
  }

  // ---- messages ------------------------------------------------------------

  const messageSelect = (viewerId: string | null) => sql`
    select m.*,
           a.handle as a_handle, a.display_name as a_display_name,
           a.avatar_url as a_avatar_url, a.role as a_role,
           rm.seq as r_seq, rm.body as r_body, rm.status as r_status,
           rm.author_id as r_author_id,
           ra.handle as r_handle, ra.display_name as r_display_name,
           ra.avatar_url as r_avatar_url, ra.role as r_role,
           ${
             viewerId
               ? sql`(select coalesce(array_agg(x.emoji), '{}') from community_reactions x
                      where x.message_id = m.id and x.user_id = ${viewerId})`
               : sql`null::text[]`
           } as my_reactions,
           ${isStaff(viewerId)} as as_staff
    from community_messages m
    join community_threads t on t.id = m.thread_id
    join users a on a.id = m.author_id
    left join community_messages rm on rm.id = m.reply_to_id
    left join users ra on ra.id = rm.author_id`;

  async function hydrateMessages(
    rows: MessageRow[],
    viewerId: string | null,
  ): Promise<Message[]> {
    if (!rows.length) return [];
    const ids = sql(rows.map((r) => r.id));
    const [photoRows, mentionRows] = await Promise.all([
      sql<PhotoDbRow[]>`
        select ph.message_id as owner_id, ph.id, ph.url, ph.width, ph.height
        from community_message_photos ph
        where ph.message_id in ${ids} order by ph.position, ph.created_at`,
      sql<MemberRow[]>`
        select mn.message_id as owner_id, u.id as user_id,
               u.handle as u_handle, u.display_name as u_display_name,
               u.avatar_url as u_avatar_url, u.role as u_role
        from community_mentions mn join users u on u.id = mn.user_id
        where mn.message_id in ${ids} order by u.id collate "C"`,
    ]);
    const photos = groupBy(photoRows);
    const mentions = groupBy(mentionRows);

    return rows.map((r) => {
      const reactions: Message["reactions"] = {};
      for (const emoji of REACTIONS)
        if (r.reactions[emoji] > 0) reactions[emoji] = r.reactions[emoji];
      const message: Message = {
        id: r.id,
        threadId: r.thread_id,
        seq: r.seq,
        author: toMember(r.author_id, r, "a"),
        body: r.body,
        replyTo:
          r.reply_to_id && r.r_author_id
            ? {
                id: r.reply_to_id,
                seq: r.r_seq ?? 0,
                author: toMember(r.r_author_id, r, "r"),
                excerpt:
                  r.r_status === "removed" ? "" : excerpt(r.r_body ?? ""),
                removed: r.r_status === "removed",
              }
            : null,
        reactions,
        status: r.status as Message["status"],
        editedAt: r.edited_at ? iso(r.edited_at) : null,
        createdAt: iso(r.created_at),
        photos: (photos.get(r.id) ?? []).map(toPhoto),
        mentions: (mentions.get(r.id) ?? []).map((m) =>
          toMember(m.user_id, m, "u"),
        ),
        ...(viewerId
          ? {
              myReactions: REACTIONS.filter((emoji) =>
                r.my_reactions?.includes(emoji),
              ),
            }
          : {}),
      };
      return r.status === "removed" && !r.as_staff ? redact(message) : message;
    });
  }

  async function oneMessage(
    id: string,
    viewerId: string | null,
  ): Promise<Message | null> {
    const rows = await sql<MessageRow[]>`
      ${messageSelect(viewerId)}
      where m.id = ${id} and (t.status <> 'removed' or ${isStaff(viewerId)})`;
    return (await hydrateMessages(rows, viewerId))[0] ?? null;
  }

  /** The row, its photos and the people it mentions. Mentions of nobody are dropped. */
  async function insertMessage(
    tx: TransactionSql,
    m: {
      id: string;
      threadId: string;
      seq: number;
      authorId: string;
      body: string;
      replyToId: string | null;
      photos: PhotoRow[];
      mentionIds: string[];
    },
    at: Date,
  ) {
    await tx`
      insert into community_messages (id, thread_id, seq, author_id, body, reply_to_id, created_at)
      values (${m.id}, ${m.threadId}, ${m.seq}, ${m.authorId}, ${m.body}, ${m.replyToId}, ${at})`;
    for (const p of m.photos) {
      try {
        await tx`
          insert into community_message_photos (id, message_id, storage_key, url, width, height, position)
          values (${p.id}, ${m.id}, ${p.storageKey}, ${p.url}, ${p.width}, ${p.height}, ${p.position})`;
      } catch (err) {
        // The transaction is lost either way; this gives the caller the reason.
        if (isKeyClash(err)) throw new PhotoKeyTakenError(p.storageKey);
        throw err;
      }
    }
    await replaceMentions(tx, m.id, m.mentionIds);
    await tx`
      insert into community_reads (user_id, thread_id, last_read_seq, updated_at)
      values (${m.authorId}, ${m.threadId}, ${m.seq}, ${at})
      on conflict (user_id, thread_id) do update set
        last_read_seq = greatest(community_reads.last_read_seq, excluded.last_read_seq),
        updated_at = excluded.updated_at`;
  }

  async function replaceMentions(
    tx: TransactionSql,
    messageId: string,
    userIds: string[],
  ) {
    await tx`delete from community_mentions where message_id = ${messageId}`;
    if (!userIds.length) return;
    await tx`
      insert into community_mentions (message_id, user_id)
      select ${messageId}, u.id from users u where u.id in ${tx(userIds)}
      on conflict do nothing`;
  }

  /**
   * The counters a thread carries, recounted from its messages. Call it with
   * the thread row already locked by an earlier statement of the transaction:
   * this statement's snapshot then holds everything committed before it.
   */
  const recount = (tx: TransactionSql, threadId: string) => tx`
    update community_threads t set
      reply_count = (select count(*) from community_messages m
                     where m.thread_id = t.id and m.status = 'visible' and m.seq > 0),
      participant_count = (select count(distinct m.author_id) from community_messages m
                           where m.thread_id = t.id and m.status = 'visible')
    where t.id = ${threadId}`;

  /** Moves a thread in or out of `removed`, keeping its channel's count in step. */
  async function applyStatus(
    tx: TransactionSql,
    id: string,
    status: string,
    lockedReason: string | null,
  ): Promise<boolean> {
    const [before] = await tx<{ status: string; channel_id: string }[]>`
      select status, channel_id from community_threads where id = ${id} for update`;
    if (!before) return false;
    await tx`
      update community_threads
      set status = ${status}, locked_reason = ${status === "locked" ? lockedReason : null}
      where id = ${id}`;
    const delta =
      Number(before.status === "removed") - Number(status === "removed");
    if (delta)
      await tx`
        update community_channels set thread_count = thread_count + ${delta}
        where id = ${before.channel_id}`;
    return true;
  }

  /** Lock the channel, then count in a statement of its own, so the count sees every commit. */
  async function recountFollowers(tx: TransactionSql, channelId: string) {
    await tx`select 1 from community_channels where id = ${channelId} for update`;
    await tx`
      update community_channels c set follower_count = (
        select count(*) from community_follows f
        where f.target_type = 'channel' and f.target_id = c.id and f.level <> 'none')
      where c.id = ${channelId}`;
  }

  return {
    async getMeta() {
      const [categories, channels] = await Promise.all([
        sql<Category[]>`
          select id, name, position from community_categories order by position`,
        channelsWhere(sql`c.status = 'active'`, null),
      ]);
      return { categories: categories.map((c) => ({ ...c })), channels };
    },

    async listChannels(viewerId) {
      return channelsWhere(sql`c.status = 'active'`, viewerId);
    },

    async getChannel(slug, viewerId) {
      return (await channelsWhere(sql`c.slug = ${slug}`, viewerId))[0] ?? null;
    },

    async listThreads(query, viewerId) {
      const limit = pageLimit(query.limit);
      const q = searchTerms(query.q).join(" ");
      const pinnedFirst = Boolean(query.channelId) && !q;
      const conditions = [sql`t.status <> 'removed'`];
      conditions.push(
        query.channelId
          ? sql`t.channel_id = ${query.channelId}`
          : sql`c.status = 'active'`,
      );
      if (query.tagId)
        conditions.push(sql`exists (
          select 1 from community_thread_tags tt
          where tt.thread_id = t.id and tt.tag_id = ${query.tagId})`);
      if (q)
        conditions.push(sql`(
          to_tsvector('english', t.title) @@ websearch_to_tsquery('english', ${q})
          or exists (
            select 1 from community_messages sm
            where sm.thread_id = t.id and sm.status = 'visible'
              and to_tsvector('english', sm.body) @@ websearch_to_tsquery('english', ${q})))`);
      if (query.cursor) {
        const at = new Date(query.cursor.lastMessageAt);
        const later = sql`(t.last_message_at < ${at}
          or (t.last_message_at = ${at} and t.id > ${query.cursor.id}))`;
        conditions.push(
          !pinnedFirst
            ? later
            : query.cursor.pinned
              ? sql`(not t.pinned or ${later})`
              : sql`(not t.pinned and ${later})`,
        );
      }
      const where = conditions.reduce((a, b) => sql`${a} and ${b}`);
      const rows = await sql<ThreadRow[]>`
        ${threadSelect(viewerId)}
        where ${where}
        order by ${pinnedFirst ? sql`t.pinned desc,` : sql``} t.last_message_at desc, t.id
        limit ${limit + 1}`;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: await hydrateThreads(page, viewerId),
        nextCursor:
          rows.length > limit
            ? encodeCursor({
                ...(pinnedFirst ? { pinned: last.pinned } : {}),
                lastMessageAt: iso(last.last_message_at),
                id: last.id,
              })
            : null,
      };
    },

    getThread: oneThread,

    async createThread(input) {
      const at = now();
      await sql.begin(async (tx) => {
        await tx`
          insert into community_threads
            (id, channel_id, author_id, title, slug, spot_id, last_message_at, last_message_by, created_at)
          values (${input.id}, ${input.channelId}, ${input.authorId}, ${input.title},
                  ${input.slug}, ${input.spotId}, ${at}, ${input.authorId}, ${at})`;
        // A tag of some other channel is dropped, not stored.
        if (input.tagIds.length)
          await tx`
            insert into community_thread_tags (thread_id, tag_id)
            select ${input.id}, g.id from community_tags g
            where g.channel_id = ${input.channelId} and g.id in ${tx(input.tagIds)}`;
        await insertMessage(
          tx,
          {
            id: input.messageId,
            threadId: input.id,
            seq: 0,
            authorId: input.authorId,
            body: input.body,
            replyToId: null,
            photos: input.photos,
            mentionIds: input.mentionIds,
          },
          at,
        );
        await tx`
          update community_channels
          set thread_count = thread_count + 1,
              last_message_at = greatest(last_message_at, ${at})
          where id = ${input.channelId}`;
      });
      return (await oneThread(input.id, input.authorId))!;
    },

    async setThreadPinned(id, pinned) {
      await sql`update community_threads set pinned = ${pinned} where id = ${id}`;
      return oneThreadAsStaff(id);
    },

    async setThreadStatus(id, status, lockedReason) {
      const found = await sql.begin((tx) =>
        applyStatus(tx, id, status, lockedReason),
      );
      return found ? oneThreadAsStaff(id) : null;
    },

    async listMessages(threadId, window, viewerId) {
      const [t] = await sql<{ last_seq: number }[]>`
        select t.last_seq from community_threads t
        where t.id = ${threadId} and (t.status <> 'removed' or ${isStaff(viewerId)})`;
      if (!t) return null;
      const { lo, hi } = seqRange(window, t.last_seq);
      const rows = await sql<MessageRow[]>`
        ${messageSelect(viewerId)}
        where m.thread_id = ${threadId} and m.seq between ${lo} and ${hi}
        order by m.seq`;
      return {
        items: await hydrateMessages(rows, viewerId),
        hasOlder: lo > 0,
        hasNewer: hi < t.last_seq,
      };
    },

    getMessage: oneMessage,

    async createMessage(input) {
      const at = now();
      await sql.begin(async (tx) => {
        // The seq is taken and the row locked in one statement; every other
        // reply to this thread waits here until this transaction ends.
        const [t] = await tx<{ last_seq: number; channel_id: string }[]>`
          update community_threads
          set last_seq = last_seq + 1,
              last_message_at = greatest(last_message_at, ${at}),
              last_message_by = ${input.authorId}
          where id = ${input.threadId} and status = 'open'
          returning last_seq, channel_id`;
        if (!t) throw new ThreadClosedError(input.threadId);
        if (input.replyToId) {
          const target = await tx`
            select 1 from community_messages
            where id = ${input.replyToId} and thread_id = ${input.threadId}`;
          if (!target.length) throw new ReplyTargetError(input.replyToId);
        }
        await insertMessage(tx, { ...input, seq: t.last_seq }, at);
        await recount(tx, input.threadId);
        await tx`
          update community_channels
          set last_message_at = greatest(last_message_at, ${at})
          where id = ${t.channel_id}`;
      });
      return (await oneMessage(input.id, input.authorId))!;
    },

    async editMessage(id, body, mentionIds) {
      const authorId = await sql.begin(async (tx) => {
        // A removed thread is gone to its members: nothing in it changes.
        const [m] = await tx<{ author_id: string }[]>`
          update community_messages m set body = ${body}, edited_at = ${now()}
          from community_threads t
          where m.id = ${id} and m.status = 'visible'
            and t.id = m.thread_id and t.status <> 'removed'
          returning m.author_id`;
        if (!m) return null;
        await replaceMentions(tx, id, mentionIds);
        return m.author_id;
      });
      return authorId ? oneMessage(id, authorId) : null;
    },

    async removeMessage(id, removedBy) {
      const found = await sql.begin(async (tx) => {
        // The thread first, then the message: the order createMessage locks in.
        const [m] = await tx<{ thread_id: string; seq: number }[]>`
          select thread_id, seq from community_messages where id = ${id}`;
        if (!m) return false;
        await tx`select 1 from community_threads where id = ${m.thread_id} for update`;
        const changed = await tx`
          update community_messages set status = 'removed', removed_by = ${removedBy}
          where id = ${id} and status = 'visible'
          returning id`;
        if (!changed.length) return true;
        await recount(tx, m.thread_id);
        if (m.seq === 0) await applyStatus(tx, m.thread_id, "removed", null);
        return true;
      });
      if (!found) return null;
      // Read back past the removed-thread rule: whoever removed it gets it back.
      const rows = await sql<MessageRow[]>`
        ${messageSelect(removedBy)} where m.id = ${id}`;
      return (await hydrateMessages(rows, removedBy))[0] ?? null;
    },

    async setReaction(messageId, userId, emoji, on) {
      const found = await sql.begin(async (tx) => {
        const locked = await tx`
          select 1 from community_messages m
          join community_threads t on t.id = m.thread_id
          where m.id = ${messageId} and m.status = 'visible' and t.status <> 'removed'
          for no key update of m`;
        if (!locked.length) return false;
        if (on)
          await tx`
            insert into community_reactions (message_id, user_id, emoji)
            values (${messageId}, ${userId}, ${emoji}) on conflict do nothing`;
        else
          await tx`
            delete from community_reactions
            where message_id = ${messageId} and user_id = ${userId} and emoji = ${emoji}`;
        await tx`
          update community_messages set reactions = coalesce(
            (select jsonb_object_agg(n.emoji, n.total) from (
               select emoji, count(*) as total from community_reactions
               where message_id = ${messageId} group by emoji) n),
            '{}')
          where id = ${messageId}`;
        return true;
      });
      return found ? oneMessage(messageId, userId) : null;
    },

    async markRead(userId, threadId, seq) {
      await sql`
        insert into community_reads (user_id, thread_id, last_read_seq, updated_at)
        select ${userId}, t.id, least(greatest(${Math.trunc(seq)}::integer, 0), t.last_seq), ${now()}
        from community_threads t where t.id = ${threadId}
        on conflict (user_id, thread_id) do update set
          last_read_seq = greatest(community_reads.last_read_seq, excluded.last_read_seq),
          updated_at = excluded.updated_at`;
    },

    async markChannelSeen(userId, channelId) {
      await sql`
        insert into community_channel_seen (user_id, channel_id, seen_at)
        select ${userId}, c.id, ${now()} from community_channels c where c.id = ${channelId}
        on conflict (user_id, channel_id) do update set seen_at = excluded.seen_at`;
    },

    async setFollow(userId, targetType, targetId, level, source) {
      await sql.begin(async (tx) => {
        if (source === "auto")
          await tx`
            insert into community_follows (user_id, target_type, target_id, level, source)
            values (${userId}, ${targetType}, ${targetId}, ${level}, 'auto')
            on conflict do nothing`;
        else
          await tx`
            insert into community_follows (user_id, target_type, target_id, level, source)
            values (${userId}, ${targetType}, ${targetId}, ${level}, 'manual')
            on conflict (user_id, target_type, target_id) do update set
              level = excluded.level, source = excluded.source`;
        if (targetType === "channel") await recountFollowers(tx, targetId);
      });
    },

    async clearFollow(userId, targetType, targetId) {
      await sql.begin(async (tx) => {
        await tx`
          delete from community_follows
          where user_id = ${userId} and target_type = ${targetType} and target_id = ${targetId}`;
        if (targetType === "channel") await recountFollowers(tx, targetId);
      });
    },

    async addReport(report) {
      await sql`
        insert into community_reports (id, reporter_id, message_id, reason, note, created_at)
        values (${report.id}, ${report.reporterId}, ${report.messageId},
                ${report.reason}, ${report.note}, ${now()})`;
    },

    async countReportsBy(reporterId, since) {
      const [row] = await sql<{ n: string }[]>`
        select count(*) as n from community_reports
        where reporter_id = ${reporterId} and created_at >= ${since}`;
      return num(row.n);
    },

    async addModLog(entry) {
      await sql`
        insert into community_mod_log (id, actor_id, action, target_type, target_id, reason, created_at)
        values (${entry.id}, ${entry.actorId}, ${entry.action}, ${entry.targetType},
                ${entry.targetId}, ${entry.reason}, ${now()})`;
    },

    async listModLog(limit) {
      const rows = await sql<
        {
          id: string;
          actor_id: string;
          action: string;
          target_type: string;
          target_id: string;
          reason: string | null;
          created_at: Date;
        }[]
      >`
        select * from community_mod_log
        order by created_at desc, id limit ${pageLimit(limit)}`;
      return rows.map((r): ModLogRow => ({
        id: r.id,
        actorId: r.actor_id,
        action: r.action,
        targetType: r.target_type as ModLogRow["targetType"],
        targetId: r.target_id,
        reason: r.reason,
        createdAt: iso(r.created_at),
      }));
    },

    async countMessagesBy(authorId) {
      const [row] = await sql<{ n: string }[]>`
        select count(*) as n from community_messages
        where author_id = ${authorId} and status = 'visible'`;
      return num(row.n);
    },

    async countThreadsBy(authorId, since) {
      const [row] = await sql<{ n: string }[]>`
        select count(*) as n from community_threads
        where author_id = ${authorId} and created_at >= ${since}`;
      return num(row.n);
    },

    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
