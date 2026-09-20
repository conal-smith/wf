/**
 * One suite, two repos. Everything in `contract` runs against the memory repo
 * always and against Postgres when DATABASE_URL is set (npm run market:db):
 *
 *   DATABASE_URL=postgres://market:market@127.0.0.1:55432/market npm test
 *
 * The Postgres run works in a schema of its own, made by the real migrations
 * and dropped afterwards, so it starts from a fresh database every time and
 * never touches the rows of a development database.
 */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { memoryRepo } from "./repo-memory";
import { pgRepo } from "./repo-pg";
import {
  PhotoKeyTakenError,
  ReplyTargetError,
  ThreadClosedError,
  excerpt,
  mentionLine,
  seqRange,
  type PhotoRow,
  type Repo,
} from "./repo";
import { SEED_CATEGORIES, SEED_CHANNELS } from "./seed";
import { LIMITS, type Thread } from "../shared/types";
import { decodeCursor } from "../shared/validate";
import {
  COMMUNITY_LEDGER,
  COMMUNITY_MIGRATIONS_DIR,
  migrate,
  type Db,
} from "../../market/api/src/db";
import { ID_PATTERN, newId } from "../../market/api/src/ids";
import { memoryUsersRepo } from "../../site/api/repo-memory";
import { pgUsersRepo } from "../../site/api/repo-pg";
import { userInputSchema } from "../../site/shared/validate";

/** What a suite needs from either backend. The clock moves a second per reading. */
interface Backend {
  repo: Repo;
  /** A member called `name`, id `dev_<name>`, who joined at the clock's next second. */
  addUser(name: string, role?: "member" | "staff"): Promise<string>;
  /** The switch on the profile page, which the repos only ever read. */
  setAutoFollow(id: string, on: boolean): Promise<void>;
  /** Back to a fresh database: the seeded channels and nothing else. */
  reset(): Promise<void>;
}

function makeClock() {
  let t = Date.parse("2026-01-01T00:00:00.000Z");
  return () => new Date((t += 1000));
}

function memoryBackend(): Backend {
  const make = () => {
    const now = makeClock();
    const users = memoryUsersRepo(now);
    return { users, repo: memoryRepo(users, now) };
  };
  let current = make();
  return {
    get repo() {
      return current.repo;
    },
    async addUser(name, role = "member") {
      const id = `dev_${name}`;
      await current.users.insertUser({
        id,
        handle: name,
        displayName: name[0].toUpperCase() + name.slice(1),
        avatarUrl: null,
      });
      current.users.peek(id)!.role = role;
      return id;
    },
    async setAutoFollow(id, on) {
      current.users.peek(id)!.autoFollow = on;
    },
    async reset() {
      current = make();
    },
  };
}

function pgBackend(sql: Db): Backend {
  let now = makeClock();
  let repo = pgRepo(sql, () => now());
  const users = pgUsersRepo(sql);
  return {
    get repo() {
      return repo;
    },
    async addUser(name, role = "member") {
      const id = `dev_${name}`;
      await users.insertUser({
        id,
        handle: name,
        displayName: name[0].toUpperCase() + name.slice(1),
        avatarUrl: null,
      });
      await sql`update users set role = ${role}, created_at = ${now()} where id = ${id}`;
      return id;
    },
    async setAutoFollow(id, on) {
      await sql`update users set auto_follow = ${on} where id = ${id}`;
    },
    async reset() {
      await sql`truncate users, community_channel_seen cascade`;
      await sql`
        update community_channels
        set thread_count = 0, follower_count = 0, last_message_at = null`;
      now = makeClock();
      repo = pgRepo(sql, () => now());
    },
  };
}

const photo = (position: number): PhotoRow => {
  const id = newId();
  return {
    id,
    storageKey: `community/dev_aoife/${id}.jpg`,
    url: `https://cdn.test/community/dev_aoife/${id}.jpg`,
    width: 1600,
    height: 1200,
    position,
  };
};

function contract(name: string, backend: () => Backend) {
  describe(name, () => {
    let repo: Repo;
    let aoife: string, cian: string, niamh: string, staff: string;
    let wings: string, foils: string;

    const channelId = (slug: string) =>
      SEED_CHANNELS.find((c) => c.slug === slug)!.id;
    const tagId = (slug: string, label: string) =>
      SEED_CHANNELS.find((c) => c.slug === slug)!.tags.find(
        (t) => t.label === label,
      )!.id;

    const start = (
      authorId: string,
      title: string,
      extra: Partial<Parameters<Repo["createThread"]>[0]> = {},
    ) =>
      repo.createThread({
        id: newId(),
        messageId: newId(),
        channelId: wings,
        authorId,
        title,
        slug: "a-thread",
        spotId: null,
        tagIds: [],
        body: `${title}, the opening post.`,
        photos: [],
        mentionIds: [],
        ...extra,
      });

    const reply = (
      authorId: string,
      threadId: string,
      body: string,
      extra: Partial<Parameters<Repo["createMessage"]>[0]> = {},
    ) =>
      repo.createMessage({
        id: newId(),
        threadId,
        authorId,
        body,
        replyToId: null,
        photos: [],
        mentionIds: [],
        ...extra,
      });

    const titles = (threads: Thread[]) => threads.map((t) => t.title);
    let setAutoFollow: Backend["setAutoFollow"];

    beforeEach(async () => {
      const b = backend();
      await b.reset();
      repo = b.repo;
      setAutoFollow = (id, on) => b.setAutoFollow(id, on);
      aoife = await b.addUser("aoife");
      cian = await b.addUser("cian");
      niamh = await b.addUser("niamh");
      staff = await b.addUser("sorcha", "staff");
      wings = channelId("wings");
      foils = channelId("foils");
    });

    describe("what a fresh database holds", () => {
      it("is the four categories, the ten channels and their tags, exactly as seeded", async () => {
        const meta = await repo.getMeta();
        expect(meta.categories).toEqual(SEED_CATEGORIES);
        expect(meta.channels).toEqual(SEED_CHANNELS);
        expect(meta.categories).toHaveLength(4);
        expect(meta.channels).toHaveLength(10);
        expect(meta.channels.flatMap((c) => c.tags)).toHaveLength(39);
      });

      it("gives every seeded row an id the API's pattern accepts", async () => {
        const { categories, channels } = await repo.getMeta();
        const ids = [
          ...categories.map((c) => c.id),
          ...channels.map((c) => c.id),
          ...channels.flatMap((c) => c.tags.map((t) => t.id)),
        ];
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(id).toMatch(ID_PATTERN);
      });

      it("lets only staff start threads in announcements", async () => {
        const { channels } = await repo.getMeta();
        expect(
          channels.filter((c) => c.postPolicy === "staff").map((c) => c.slug),
        ).toEqual(["announcements"]);
      });

      it("has no threads at all", async () => {
        expect(await repo.listThreads({}, null)).toEqual({
          items: [],
          nextCursor: null,
        });
        for (const c of (await repo.getMeta()).channels) {
          expect(c.threadCount).toBe(0);
          expect(c.lastMessageAt).toBeNull();
        }
      });
    });

    describe("channels", () => {
      it("resolves a channel by slug and not by anything else", async () => {
        expect((await repo.getChannel("wings", null))?.id).toBe(wings);
        expect(await repo.getChannel("kites", null)).toBeNull();
      });

      it("leaves the viewer's fields off for a signed-out reader", async () => {
        for (const c of await repo.listChannels(null)) {
          expect(c).not.toHaveProperty("unread");
          expect(c).not.toHaveProperty("following");
        }
        const mine = await repo.listChannels(aoife);
        expect(mine.map((c) => c.slug)).toEqual(
          SEED_CHANNELS.map((c) => c.slug),
        );
        for (const c of mine)
          expect(c).toMatchObject({ unread: 0, following: false });
      });

      it("counts threads that moved since the viewer last looked, other people's only", async () => {
        const t = await start(cian, "Which wing for gusty westerlies?");
        await start(aoife, "My own thread");
        const unread = async (viewer: string) =>
          (await repo.getChannel("wings", viewer))!.unread;
        expect(await unread(aoife)).toBe(1);
        expect(await unread("dev_nobody")).toBe(0);

        await repo.markChannelSeen(aoife, wings);
        expect(await unread(aoife)).toBe(0);
        await reply(niamh, t.id, "Whichever depowers more cleanly.");
        expect(await unread(aoife)).toBe(1);
        expect((await repo.getChannel("foils", aoife))!.unread).toBe(0);
      });

      it("keeps the thread count and last activity in step", async () => {
        const t = await start(aoife, "Counted");
        const before = (await repo.getChannel("wings", null))!;
        expect(before.threadCount).toBe(1);
        expect(before.lastMessageAt).toBe(t.lastMessageAt);

        const m = await reply(cian, t.id, "A reply bumps the channel too.");
        expect((await repo.getChannel("wings", null))!.lastMessageAt).toBe(
          m.createdAt,
        );

        await repo.setThreadStatus(t.id, "removed", null);
        expect((await repo.getChannel("wings", null))!.threadCount).toBe(0);
        await repo.setThreadStatus(t.id, "open", null);
        expect((await repo.getChannel("wings", null))!.threadCount).toBe(1);
      });
    });

    describe("starting a thread", () => {
      it("stores the thread and its opening post as message 0", async () => {
        const question = tagId("wings", "Question");
        const sizing = tagId("wings", "Sizing");
        const photos = [photo(0), photo(1)];
        const t = await start(aoife, "5m or 6m for Dublin Bay?", {
          slug: "5m-or-6m-for-dublin-bay",
          spotId: "dollymount",
          tagIds: [sizing, question],
          body: "82 kg on a 95 L board.\nMost of my days are 14 to 22 knots.",
          photos,
        });

        expect(t).toMatchObject({
          channel: { id: wings, slug: "wings", name: "Wings" },
          author: {
            id: aoife,
            handle: "aoife",
            displayName: "Aoife",
            role: "member",
          },
          title: "5m or 6m for Dublin Bay?",
          slug: "5m-or-6m-for-dublin-bay",
          spotId: "dollymount",
          status: "open",
          pinned: false,
          lockedReason: null,
          lastSeq: 0,
          replyCount: 0,
          participantCount: 1,
          lastMessageBy: { id: aoife },
          preview: { author: { id: aoife }, text: "82 kg on a 95 L board." },
          thumbnail: {
            id: photos[0].id,
            url: photos[0].url,
            width: 1600,
            height: 1200,
          },
        });
        // In the channel's tag order, not the order they were picked in.
        expect(t.tags).toEqual([
          { id: question, label: "Question" },
          { id: sizing, label: "Sizing" },
        ]);
        expect(t.participants.map((p) => p.id)).toEqual([aoife]);
        expect(t.createdAt).toBe(t.lastMessageAt);

        const page = (await repo.listMessages(t.id, { after: -1 }, null))!;
        expect(page.items).toHaveLength(1);
        expect(page.items[0]).toMatchObject({
          threadId: t.id,
          seq: 0,
          author: { id: aoife },
          body: "82 kg on a 95 L board.\nMost of my days are 14 to 22 knots.",
          replyTo: null,
          reactions: {},
          status: "visible",
          editedAt: null,
          createdAt: t.createdAt,
        });
        expect(page.items[0].photos.map((p) => p.id)).toEqual(
          photos.map((p) => p.id),
        );
      });

      it("drops a tag that belongs to some other channel", async () => {
        const t = await start(aoife, "Wrong tag", {
          tagIds: [tagId("technique", "Jumps"), tagId("wings", "Review")],
        });
        expect(t.tags.map((g) => g.label)).toEqual(["Review"]);
      });

      it("answers null for a thread that is not there", async () => {
        expect(await repo.getThread(newId(), null)).toBeNull();
        expect(
          await repo.listMessages(newId(), { after: -1 }, null),
        ).toBeNull();
        expect(await repo.getMessage(newId(), null)).toBeNull();
      });
    });

    describe("replying", () => {
      it("numbers replies 1, 2, 3 and keeps the thread's counters", async () => {
        const t = await start(aoife, "Counters");
        const seqs = [];
        for (const who of [cian, niamh, cian, aoife])
          seqs.push((await reply(who, t.id, `From ${who}`)).seq);
        expect(seqs).toEqual([1, 2, 3, 4]);

        const after = (await repo.getThread(t.id, null))!;
        expect(after).toMatchObject({
          lastSeq: 4,
          replyCount: 4,
          participantCount: 3,
          lastMessageBy: { id: aoife },
          preview: { author: { id: aoife }, text: `From ${aoife}` },
        });
        expect(after.participants.map((p) => p.id)).toEqual([
          aoife,
          cian,
          niamh,
        ]);
        expect(after.lastMessageAt > t.lastMessageAt).toBe(true);
      });

      it("gives 20 parallel replies seq 1..20, no gaps and no repeats", async () => {
        const t = await start(aoife, "All at once");
        const made = await Promise.all(
          Array.from({ length: 20 }, (_, i) =>
            reply([aoife, cian, niamh][i % 3], t.id, `Reply ${i}`),
          ),
        );
        const want = Array.from({ length: 20 }, (_, i) => i + 1);
        expect(made.map((m) => m.seq).sort((a, b) => a - b)).toEqual(want);

        const stored = (await repo.listMessages(
          t.id,
          { after: 0, limit: 100 },
          null,
        ))!;
        expect(stored.items.map((m) => m.seq)).toEqual(want);
        expect(await repo.getThread(t.id, null)).toMatchObject({
          lastSeq: 20,
          replyCount: 20,
          participantCount: 3,
        });
        // Aoife followed from the start: the 13 replies that are not hers fold into one row.
        const rows = (await repo.listNotifications(aoife, null)).items;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          kind: "reply",
          count: 13,
          actorCount: 2,
        });
      });

      it("points at an earlier message without nesting under it", async () => {
        const t = await start(aoife, "Reply-to");
        const first = await reply(
          cian,
          t.id,
          "Fix the light days with a bigger foil.\nNot a bigger wing.",
        );
        const second = await reply(niamh, t.id, "Agree on the foil.", {
          replyToId: first.id,
        });
        expect(second.seq).toBe(2);
        expect(second.replyTo).toEqual({
          id: first.id,
          seq: 1,
          author: first.author,
          excerpt: "Fix the light days with a bigger foil.",
          removed: false,
        });
      });

      it("refuses a reply target from another thread, and takes no seq for it", async () => {
        const t = await start(aoife, "Here");
        const other = await start(cian, "Elsewhere");
        const elsewhere = (await repo.listMessages(
          other.id,
          { after: -1 },
          null,
        ))!.items[0];
        await expect(
          reply(niamh, t.id, "Crossed wires", { replyToId: elsewhere.id }),
        ).rejects.toBeInstanceOf(ReplyTargetError);
        await expect(
          reply(niamh, t.id, "Nothing there", { replyToId: newId() }),
        ).rejects.toBeInstanceOf(ReplyTargetError);
        expect((await reply(niamh, t.id, "Third time lucky")).seq).toBe(1);
      });

      it("refuses a locked, removed or missing thread", async () => {
        const t = await start(aoife, "Closing");
        await repo.setThreadStatus(t.id, "locked", "Run its course");
        await expect(reply(cian, t.id, "Too late")).rejects.toBeInstanceOf(
          ThreadClosedError,
        );
        await repo.setThreadStatus(t.id, "removed", null);
        await expect(reply(cian, t.id, "Gone")).rejects.toBeInstanceOf(
          ThreadClosedError,
        );
        await expect(reply(cian, newId(), "Never was")).rejects.toBeInstanceOf(
          ThreadClosedError,
        );
        await repo.setThreadStatus(t.id, "open", null);
        expect((await reply(cian, t.id, "Open again")).seq).toBe(1);
      });

      it("carries photos and the people it mentions, and nobody it cannot find", async () => {
        const t = await start(aoife, "Mentions");
        const photos = [photo(1), photo(0)];
        const m = await reply(
          cian,
          t.id,
          `Not at all, <@${aoife}> and <@${niamh}>.`,
          {
            photos,
            mentionIds: [niamh, aoife, "dev_ghost"],
          },
        );
        expect(m.mentions.map((u) => u.id)).toEqual([aoife, niamh]);
        expect(m.mentions[0]).toEqual({
          id: aoife,
          handle: "aoife",
          displayName: "Aoife",
          avatarUrl: null,
          role: "member",
        });
        expect(m.photos.map((p) => p.id)).toEqual([photos[1].id, photos[0].id]);
      });

      it("refuses a photo that is already on a message, and writes nothing", async () => {
        const used = photo(0);
        const t = await start(aoife, "One photo", { photos: [used] });
        const again = { ...photo(0), storageKey: used.storageKey };

        await expect(
          reply(aoife, t.id, "The same photo", { photos: [again] }),
        ).rejects.toBeInstanceOf(PhotoKeyTakenError);
        await expect(
          start(aoife, "And as a thread", { photos: [again] }),
        ).rejects.toBeInstanceOf(PhotoKeyTakenError);

        expect((await repo.getThread(t.id, null))!.lastSeq).toBe(0);
        expect(titles((await repo.listThreads({}, null)).items)).toEqual([
          "One photo",
        ]);
        // The refusal cost no seq: the next reply is 1.
        expect((await reply(cian, t.id, "Nice")).seq).toBe(1);
      });
    });

    describe("the stream", () => {
      let threadId: string;
      const seqs = async (window: Parameters<Repo["listMessages"]>[1]) => {
        const page = (await repo.listMessages(threadId, window, null))!;
        return {
          seqs: page.items.map((m) => m.seq),
          hasOlder: page.hasOlder,
          hasNewer: page.hasNewer,
        };
      };
      const run = (from: number, to: number) =>
        Array.from({ length: to - from + 1 }, (_, i) => from + i);

      beforeEach(async () => {
        threadId = (await start(aoife, "Sixty-five messages")).id;
        for (let i = 1; i <= 64; i++)
          await reply(i % 2 ? cian : niamh, threadId, `Message ${i}`);
      });

      it("pages forward by seq, a page at a time, to the end", async () => {
        expect(await seqs({ after: -1 })).toEqual({
          seqs: run(0, 29),
          hasOlder: false,
          hasNewer: true,
        });
        expect(await seqs({ after: 29 })).toEqual({
          seqs: run(30, 59),
          hasOlder: true,
          hasNewer: true,
        });
        expect(await seqs({ after: 59 })).toEqual({
          seqs: run(60, 64),
          hasOlder: true,
          hasNewer: false,
        });
        expect(await seqs({ after: 64 })).toEqual({
          seqs: [],
          hasOlder: true,
          hasNewer: false,
        });
      });

      it("pages backward, still oldest first within the page", async () => {
        expect(await seqs({ before: 65 })).toEqual({
          seqs: run(35, 64),
          hasOlder: true,
          hasNewer: false,
        });
        expect(await seqs({ before: 5 })).toEqual({
          seqs: run(0, 4),
          hasOlder: false,
          hasNewer: true,
        });
        expect((await seqs({ before: 0 })).seqs).toEqual([]);
      });

      it("opens around a position with a full page, even near either end", async () => {
        expect(await seqs({ around: 40 })).toEqual({
          seqs: run(25, 54),
          hasOlder: true,
          hasNewer: true,
        });
        expect((await seqs({ around: 2 })).seqs).toEqual(run(0, 29));
        expect((await seqs({ around: 64 })).seqs).toEqual(run(35, 64));
        expect((await seqs({ around: 10, limit: 5 })).seqs).toEqual(run(8, 12));
      });

      it("never hands out more than a hundred, or fewer than one", async () => {
        expect((await seqs({ after: -1, limit: 5000 })).seqs).toEqual(
          run(0, 64),
        );
        expect((await seqs({ after: -1, limit: 0 })).seqs).toEqual([0]);
      });
    });

    describe("listing threads", () => {
      it("puts the most recent activity first, and a reply bumps a thread", async () => {
        const a = await start(aoife, "First");
        await start(cian, "Second");
        await start(niamh, "Third", { channelId: foils });
        expect(titles((await repo.listThreads({}, null)).items)).toEqual([
          "Third",
          "Second",
          "First",
        ]);
        await reply(cian, a.id, "Bump");
        expect(titles((await repo.listThreads({}, null)).items)).toEqual([
          "First",
          "Third",
          "Second",
        ]);
        expect(
          titles((await repo.listThreads({ channelId: wings }, null)).items),
        ).toEqual(["First", "Second"]);
      });

      it("pages by cursor with no repeats and no gaps, even when a thread is bumped between pages", async () => {
        const made: Thread[] = [];
        for (let i = 1; i <= 7; i++)
          made.push(await start(aoife, `Thread ${i}`));

        const one = await repo.listThreads({ limit: 3 }, null);
        expect(titles(one.items)).toEqual(["Thread 7", "Thread 6", "Thread 5"]);
        expect(one.nextCursor).not.toBeNull();

        // Thread 1 jumps to the top; with offsets, Thread 5 would now show twice.
        await reply(cian, made[0].id, "Bump");

        const two = await repo.listThreads(
          { limit: 3, cursor: decodeCursor(one.nextCursor!) },
          null,
        );
        expect(titles(two.items)).toEqual(["Thread 4", "Thread 3", "Thread 2"]);
        // Thread 1 moved above the first page, so the walk ends without it.
        expect(two.nextCursor).toBeNull();
      });

      it("ends on a full last page without promising another", async () => {
        for (let i = 1; i <= 4; i++) await start(aoife, `Thread ${i}`);
        const one = await repo.listThreads({ limit: 2 }, null);
        const two = await repo.listThreads(
          { limit: 2, cursor: decodeCursor(one.nextCursor!) },
          null,
        );
        expect(titles(two.items)).toEqual(["Thread 2", "Thread 1"]);
        expect(two.nextCursor).toBeNull();
      });

      it("pins first inside a channel, across pages, and nowhere else", async () => {
        const made: Thread[] = [];
        for (let i = 1; i <= 5; i++)
          made.push(await start(aoife, `Thread ${i}`));
        expect((await repo.setThreadPinned(made[0].id, true))?.pinned).toBe(
          true,
        );
        await repo.setThreadPinned(made[2].id, true);

        const all: string[] = [];
        let cursor: string | null = null;
        do {
          const page: Awaited<ReturnType<Repo["listThreads"]>> =
            await repo.listThreads(
              {
                channelId: wings,
                limit: 2,
                cursor: cursor ? decodeCursor(cursor) : null,
              },
              null,
            );
          all.push(...titles(page.items));
          cursor = page.nextCursor;
        } while (cursor);
        expect(all).toEqual([
          "Thread 3",
          "Thread 1",
          "Thread 5",
          "Thread 4",
          "Thread 2",
        ]);

        expect(titles((await repo.listThreads({}, null)).items)[0]).toBe(
          "Thread 5",
        );
        expect(await repo.setThreadPinned(newId(), true)).toBeNull();
      });

      it("filters a channel by tag", async () => {
        const review = tagId("wings", "Review");
        await start(aoife, "A review", { tagIds: [review] });
        await start(aoife, "A question", {
          tagIds: [tagId("wings", "Question")],
        });
        await start(aoife, "Both", {
          tagIds: [review, tagId("wings", "Sizing")],
        });
        expect(
          titles(
            (await repo.listThreads({ channelId: wings, tagId: review }, null))
              .items,
          ),
        ).toEqual(["Both", "A review"]);
      });

      it("finds words in a title or in one message, never in removed ones", async () => {
        await start(aoife, "Hard handles or a boom?");
        const t = await start(cian, "Shoulder trouble");
        const hit = await reply(niamh, t.id, "My boom fixed my sore shoulder.");
        await start(niamh, "Unrelated", { channelId: foils });

        const find = async (q: string) =>
          titles((await repo.listThreads({ q }, null)).items);
        expect(await find("boom")).toEqual([
          "Shoulder trouble",
          "Hard handles or a boom?",
        ]);
        expect(await find("  BOOM   shoulder ")).toEqual(["Shoulder trouble"]);
        expect(await find("kitesurfing")).toEqual([]);

        await repo.removeMessage(hit.id, niamh);
        expect(await find("boom")).toEqual(["Hard handles or a boom?"]);
      });
    });

    describe("what belongs to the viewer", () => {
      it("is left off every thread and message for a signed-out reader", async () => {
        const t = await start(aoife, "Signed out");
        await repo.setReaction(
          (await reply(cian, t.id, "Hello")).id,
          aoife,
          "🤙",
          true,
        );
        const signedOut = [
          (await repo.getThread(t.id, null))!,
          ...(await repo.listThreads({}, null)).items,
        ];
        for (const thread of signedOut) {
          expect(thread).not.toHaveProperty("unread");
          expect(thread).not.toHaveProperty("lastReadSeq");
          expect(thread).not.toHaveProperty("following");
        }
        for (const m of (await repo.listMessages(t.id, { after: -1 }, null))!
          .items)
          expect(m).not.toHaveProperty("myReactions");
      });

      it("counts unread from the last read seq, and the author has read their own words", async () => {
        const t = await start(aoife, "Unread");
        expect(t).toMatchObject({
          lastReadSeq: 0,
          unread: 0,
          following: "all",
        });
        await reply(cian, t.id, "One");
        await reply(niamh, t.id, "Two");

        expect(await repo.getThread(t.id, aoife)).toMatchObject({
          lastReadSeq: 0,
          unread: 2,
        });
        expect(await repo.getThread(t.id, niamh)).toMatchObject({
          lastReadSeq: 2,
          unread: 0,
        });
        expect(await repo.getThread(t.id, cian)).toMatchObject({
          lastReadSeq: 1,
          unread: 1,
        });
        // Never opened: nothing read, so every message is new.
        expect(await repo.getThread(t.id, staff)).toMatchObject({
          lastReadSeq: null,
          unread: 3,
        });
        expect((await repo.listThreads({}, aoife)).items[0]).toMatchObject({
          unread: 2,
        });
      });

      it("moves the read position forward only, and never past the end", async () => {
        const t = await start(aoife, "Reading");
        for (let i = 0; i < 5; i++) await reply(cian, t.id, `Reply ${i}`);
        const position = async () =>
          (await repo.getThread(t.id, niamh))!.lastReadSeq;

        await repo.markRead(niamh, t.id, 3);
        expect(await position()).toBe(3);
        await repo.markRead(niamh, t.id, 1);
        expect(await position()).toBe(3);
        await repo.markRead(niamh, t.id, 999);
        expect(await position()).toBe(5);
        expect((await repo.getThread(t.id, niamh))!.unread).toBe(0);
        await repo.markRead(niamh, newId(), 1);
      });

      it("reports the viewer's follow level, and an auto follow never overrides a choice", async () => {
        const t = await start(aoife, "Following");
        const level = async (who: string) =>
          (await repo.getThread(t.id, who))!.following;

        await repo.setFollow(cian, "thread", t.id, "all", "auto");
        expect(await level(cian)).toBe("all");
        expect(await level(niamh)).toBeNull();

        await repo.setFollow(cian, "thread", t.id, "none", "manual");
        await repo.setFollow(cian, "thread", t.id, "all", "auto");
        expect(await level(cian)).toBe("none");

        await repo.setFollow(cian, "thread", t.id, "mentions", "manual");
        expect(await level(cian)).toBe("mentions");
        await repo.clearFollow(cian, "thread", t.id);
        expect(await level(cian)).toBeNull();
      });

      it("counts a channel's followers, and a muted row is not one", async () => {
        const followers = async () =>
          (await repo.getChannel("wings", null))!.followerCount;
        await repo.setFollow(aoife, "channel", wings, "all", "manual");
        await repo.setFollow(cian, "channel", wings, "all", "manual");
        await repo.setFollow(cian, "channel", wings, "all", "manual");
        expect(await followers()).toBe(2);
        expect((await repo.getChannel("wings", aoife))!.following).toBe(true);
        expect((await repo.getChannel("wings", niamh))!.following).toBe(false);
        expect((await repo.getChannel("foils", aoife))!.following).toBe(false);

        await repo.setFollow(cian, "channel", wings, "none", "manual");
        expect(await followers()).toBe(1);
        expect((await repo.getChannel("wings", cian))!.following).toBe(false);
        await repo.clearFollow(aoife, "channel", wings);
        expect(await followers()).toBe(0);
      });
    });

    describe("following and the bell", () => {
      const bell = async (who: string) =>
        (await repo.listNotifications(who, null)).items;
      const level = async (threadId: string, who: string) =>
        (await repo.getThread(threadId, who))!.following;

      it("follows a thread for whoever starts it or replies, and never over a choice", async () => {
        const t = await start(aoife, "Auto follow");
        expect(await level(t.id, aoife)).toBe("all");
        expect(await level(t.id, cian)).toBeNull();
        await reply(cian, t.id, "Me too");
        expect(await level(t.id, cian)).toBe("all");

        await repo.setFollow(cian, "thread", t.id, "none", "manual");
        await reply(cian, t.id, "Still muted");
        expect(await level(t.id, cian)).toBe("none");
      });

      it("folds a thread's replies into one unread row: 4 replies by 2 people, count 4, two actors", async () => {
        const t = await start(aoife, "Grouped");
        await reply(cian, t.id, "One");
        await reply(niamh, t.id, "Two");
        await reply(cian, t.id, "Three");
        const last = await reply(niamh, t.id, "Four");

        const rows = await bell(aoife);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          kind: "reply",
          count: 4,
          actorCount: 2,
          messageId: last.id,
          seq: 4,
          readAt: null,
          emoji: null,
          excerpt: null,
          thread: {
            id: t.id,
            title: "Grouped",
            channel: { slug: "wings", name: "Wings" },
          },
        });
        expect(rows[0].id).toMatch(ID_PATTERN);
        // Most recent first.
        expect(rows[0].actors.map((a) => a.id)).toEqual([niamh, cian]);
        expect(rows[0].actors[0]).toEqual({
          id: niamh,
          handle: "niamh",
          displayName: "Niamh",
          avatarUrl: null,
          role: "member",
        });
        expect(Date.parse(rows[0].updatedAt)).toBeGreaterThan(
          Date.parse(rows[0].createdAt),
        );
        expect(await repo.countNotifications(aoife)).toBe(1);

        // Nobody hears about their own reply: cian's row holds niamh's two and aoife's none.
        const cians = await bell(cian);
        expect(cians).toHaveLength(1);
        expect(cians[0]).toMatchObject({ kind: "reply", count: 2 });
        expect(cians[0].actors.map((a) => a.id)).toEqual([niamh]);
        // Staff never wrote here and follow nothing.
        expect(await bell(staff)).toEqual([]);
      });

      it("starts a new row once the last one was read", async () => {
        const t = await start(aoife, "Read, then more");
        await reply(cian, t.id, "One");
        await repo.markRead(aoife, t.id, 1);
        expect(await repo.countNotifications(aoife)).toBe(0);
        expect((await bell(aoife))[0].readAt).not.toBeNull();

        await reply(niamh, t.id, "Two");
        const rows = await bell(aoife);
        expect(rows.map((r) => [r.count, r.readAt === null])).toEqual([
          [1, true],
          [1, false],
        ]);
        expect(rows[0].actors.map((a) => a.id)).toEqual([niamh]);
        expect(await repo.countNotifications(aoife)).toBe(1);
      });

      it("gives a mention a row of its own, never folded, and not a reply row as well", async () => {
        const t = await start(aoife, "Mentions");
        const body = `First line.\nOver to <@${aoife}> and <@${niamh}> for this one.`;
        const first = await reply(cian, t.id, body, {
          mentionIds: [aoife, niamh, cian],
        });
        const second = await reply(cian, t.id, `And <@${aoife}> again.`, {
          mentionIds: [aoife],
        });

        const rows = await bell(aoife);
        expect(rows.map((r) => [r.kind, r.messageId, r.count])).toEqual([
          ["mention", second.id, 1],
          ["mention", first.id, 1],
        ]);
        expect(rows[0].excerpt).toBe("And @Aoife again.");
        expect(rows[1].excerpt).toBe("Over to @Aoife and @Niamh for this one.");
        expect(rows[1].actors.map((a) => a.id)).toEqual([cian]);
        expect(await repo.countNotifications(aoife)).toBe(2);

        // Niamh follows nothing here and still hears; cian named himself and does not.
        expect((await bell(niamh)).map((r) => r.kind)).toEqual(["mention"]);
        expect(await bell(cian)).toEqual([]);
      });

      it("sends nothing to level none, and only mentions to level mentions", async () => {
        const t = await start(aoife, "Levels");
        await repo.setFollow(aoife, "thread", t.id, "none", "manual");
        await repo.setFollow(niamh, "thread", t.id, "mentions", "manual");
        const named = await reply(cian, t.id, `<@${aoife}> <@${niamh}> look`, {
          mentionIds: [aoife, niamh],
        });
        await reply(cian, t.id, "And a plain reply");
        await repo.setReaction(named.id, cian, "👍", true);

        expect(await bell(aoife)).toEqual([]);
        expect(await repo.countNotifications(aoife)).toBe(0);
        expect((await bell(niamh)).map((r) => r.kind)).toEqual(["mention"]);

        // A muted author hears nothing of reactions to their message either.
        const mine = await reply(aoife, t.id, "Muted, and still talking");
        await repo.setReaction(mine.id, cian, "🤙", true);
        expect(await bell(aoife)).toEqual([]);
      });

      it("writes no follow for an author whose autoFollow is off", async () => {
        await setAutoFollow(cian, false);
        const t = await start(cian, "Quiet start");
        expect(await level(t.id, cian)).toBeNull();
        const other = await start(aoife, "Quiet reply");
        await reply(cian, other.id, "Just passing");
        expect(await level(other.id, cian)).toBeNull();

        await reply(niamh, t.id, "Anyone there?");
        await reply(niamh, other.id, "Anyone here?");
        expect(await bell(cian)).toEqual([]);
        expect((await bell(aoife)).map((r) => r.count)).toEqual([2]);

        await setAutoFollow(cian, true);
        await reply(cian, other.id, "Back again");
        expect(await level(other.id, cian)).toBe("all");
      });

      it("tells a channel's followers about a new thread, and not about its replies", async () => {
        await repo.setFollow(cian, "channel", wings, "all", "manual");
        await repo.setFollow(aoife, "channel", wings, "all", "manual");
        const t = await start(aoife, "New in wings");
        await start(aoife, "New in foils", { channelId: foils });
        await reply(niamh, t.id, "A reply");

        const rows = await bell(cian);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          kind: "thread",
          count: 1,
          seq: 0,
          thread: { id: t.id, title: "New in wings" },
        });
        expect(rows[0].actors.map((a) => a.id)).toEqual([aoife]);
        // The author follows the channel too, and is not told of their own thread.
        expect((await bell(aoife)).map((r) => r.kind)).toEqual(["reply"]);

        // Someone the opening post names hears once, as a mention.
        await repo.setFollow(niamh, "channel", wings, "all", "manual");
        await start(aoife, "Named", {
          body: `Calling <@${niamh}>.`,
          mentionIds: [niamh],
        });
        expect((await bell(niamh)).map((r) => r.kind)).toEqual(["mention"]);
      });

      it("folds reactions per message, one count per person, and keeps them out of the count", async () => {
        const t = await start(aoife, "Reactions");
        const m = await reply(aoife, t.id, "Rate this");
        await repo.setReaction(m.id, cian, "👍", true);
        await repo.setReaction(m.id, cian, "👍", true);
        await repo.setReaction(m.id, cian, "🔥", true);
        await repo.setReaction(m.id, niamh, "🤙", true);
        await repo.setReaction(m.id, aoife, "✅", true);
        await repo.setReaction(m.id, cian, "👍", false);

        let rows = await bell(aoife);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          kind: "reaction",
          count: 2,
          actorCount: 2,
          emoji: "🤙",
          messageId: m.id,
          seq: 1,
          readAt: null,
        });
        expect(rows[0].actors.map((a) => a.id)).toEqual([niamh, cian]);
        expect(await repo.countNotifications(aoife)).toBe(0);

        // Another message is another row.
        await repo.setReaction(
          (await repo.listMessages(t.id, { after: -1 }, null))!.items[0].id,
          cian,
          "❤️",
          true,
        );
        rows = await bell(aoife);
        expect(rows.map((r) => [r.kind, r.seq, r.emoji])).toEqual([
          ["reaction", 0, "❤️"],
          ["reaction", 1, "🤙"],
        ]);
      });

      it("clears a thread's rows when it is opened, and the rest by id or all at once", async () => {
        const a = await start(aoife, "Thread A");
        const b = await start(aoife, "Thread B");
        const c = await start(aoife, "Thread C");
        await reply(cian, a.id, `Hello <@${aoife}>`, { mentionIds: [aoife] });
        await reply(cian, a.id, "Hello again");
        await reply(cian, b.id, "Hello B");
        await reply(cian, c.id, "Hello C");
        await reply(niamh, c.id, "Hello C too");
        expect(await repo.countNotifications(aoife)).toBe(4);

        await repo.markRead(aoife, a.id, 1);
        let rows = await bell(aoife);
        expect(
          rows.filter((r) => r.readAt === null).map((r) => r.thread!.id),
        ).toEqual([c.id, b.id]);
        expect(await repo.countNotifications(aoife)).toBe(2);
        // Someone else's open rows in the same thread are theirs to clear.
        await reply(aoife, a.id, "Thanks");
        expect(await repo.countNotifications(cian)).toBe(2);

        const [rowC] = rows.filter((r) => r.thread!.id === c.id);
        await repo.markNotificationsRead(cian, { ids: [rowC.id] });
        expect(await repo.countNotifications(aoife)).toBe(2);
        await repo.markNotificationsRead(aoife, { ids: [rowC.id] });
        expect(await repo.countNotifications(aoife)).toBe(1);
        await repo.markNotificationsRead(aoife, { threadId: b.id });
        expect(await repo.countNotifications(aoife)).toBe(0);

        await reply(cian, b.id, "More B");
        await reply(cian, c.id, "More C");
        expect(await repo.countNotifications(aoife)).toBe(2);
        await repo.markNotificationsRead(aoife, { all: true });
        expect(await repo.countNotifications(aoife)).toBe(0);
        rows = await bell(aoife);
        expect(rows.every((r) => r.readAt !== null)).toBe(true);
        expect(await repo.countNotifications(cian)).toBe(2);
      });

      it("pages the bell by cursor, most recently changed first", async () => {
        const made: string[] = [];
        for (let i = 0; i < 7; i++) {
          const t = await start(aoife, `Thread ${i}`);
          await reply(cian, t.id, "Hello");
          made.push(t.id);
        }
        // A fold moves its row back to the top.
        await reply(niamh, made[2], "Hello again");
        const expected = [made[2], ...made.filter((_, i) => i !== 2).reverse()];

        const seen: string[] = [];
        let cursor: string | null = null;
        let pages = 0;
        do {
          const page = await repo.listNotifications(
            aoife,
            cursor ? decodeCursor(cursor) : null,
            3,
          );
          seen.push(...page.items.map((r) => r.thread!.id));
          cursor = page.nextCursor;
          pages++;
        } while (cursor);
        expect(pages).toBe(3);
        expect(seen).toEqual(expected);
      });

      it("drops the rows of a removed thread and the mention of a removed message", async () => {
        const t = await start(aoife, "Going");
        const named = await reply(cian, t.id, `<@${niamh}> see this`, {
          mentionIds: [niamh],
        });
        expect(await repo.countNotifications(niamh)).toBe(1);
        await repo.removeMessage(named.id, cian);
        expect(await bell(niamh)).toEqual([]);
        expect(await repo.countNotifications(niamh)).toBe(0);
        expect((await repo.listMentions(niamh, null)).items).toEqual([]);

        expect(await repo.countNotifications(aoife)).toBe(1);
        await repo.setThreadStatus(t.id, "removed", null);
        expect(await bell(aoife)).toEqual([]);
        expect(await repo.countNotifications(aoife)).toBe(0);
      });

      it("lists what the viewer follows, each with why, most recent activity first", async () => {
        const started = await start(aoife, "Aoife started");
        const replied = await start(cian, "Aoife replied");
        const pressed = await start(cian, "Aoife pressed Follow");
        const muted = await start(cian, "Aoife muted");
        const before = await start(niamh, "In foils, before the follow", {
          channelId: foils,
        });
        await reply(aoife, replied.id, "Me too");
        await repo.setFollow(aoife, "thread", pressed.id, "mentions", "manual");
        await reply(aoife, muted.id, "Enough of this");
        await repo.setFollow(aoife, "thread", muted.id, "none", "manual");
        await repo.setFollow(aoife, "channel", foils, "all", "manual");
        const after = await start(niamh, "In foils, after the follow", {
          channelId: foils,
        });
        await start(niamh, "Nothing to do with Aoife");
        await reply(cian, started.id, "Bump");

        const page = await repo.listThreads({ following: true }, aoife);
        expect(page.items.map((t) => [t.title, t.why])).toEqual([
          ["Aoife started", "started"],
          ["In foils, after the follow", "channel"],
          ["Aoife replied", "replied"],
          ["Aoife pressed Follow", "followed"],
        ]);
        expect(page.items.map((t) => t.id)).not.toContain(before.id);
        expect(page.items.map((t) => t.id)).toContain(after.id);
        expect(page.nextCursor).toBeNull();

        // The same cursor as every thread list.
        const first = await repo.listThreads(
          { following: true, limit: 3 },
          aoife,
        );
        const second = await repo.listThreads(
          {
            following: true,
            limit: 3,
            cursor: decodeCursor(first.nextCursor!),
          },
          aoife,
        );
        expect(titles([...first.items, ...second.items])).toEqual(
          titles(page.items),
        );
        // Nobody's feed without a viewer, and no `why` anywhere else.
        expect(
          (await repo.listThreads({ following: true }, null)).items,
        ).toEqual([]);
        expect((await repo.listThreads({}, aoife)).items[0]).not.toHaveProperty(
          "why",
        );
        // Unfollowing a channel takes its threads back out.
        await repo.clearFollow(aoife, "channel", foils);
        expect(
          titles((await repo.listThreads({ following: true }, aoife)).items),
        ).not.toContain("In foils, after the follow");
      });

      it("lists every message that mentions someone, newest first, by cursor", async () => {
        const t = await start(aoife, "Mentions page");
        const other = await start(cian, "Elsewhere", { channelId: foils });
        const ids: string[] = [];
        for (let i = 0; i < 4; i++)
          ids.push(
            (
              await reply(
                cian,
                i % 2 ? other.id : t.id,
                `Hey <@${aoife}> ${i}`,
                {
                  mentionIds: [aoife],
                },
              )
            ).id,
          );
        await reply(aoife, t.id, `Note to self <@${aoife}>`, {
          mentionIds: [aoife],
        });
        await reply(cian, t.id, "Nobody named");
        // Muting a thread silences the bell, not the record.
        await repo.setFollow(aoife, "thread", other.id, "none", "manual");

        const first = await repo.listMentions(aoife, null, 3);
        expect(first.items.map((x) => x.message.id)).toEqual(
          [...ids].reverse().slice(0, 3),
        );
        expect(first.items[0]).toMatchObject({
          message: { body: `Hey <@${aoife}> 3`, author: { id: cian } },
          thread: {
            id: other.id,
            title: "Elsewhere",
            channel: { slug: "foils" },
          },
        });
        expect(first.items[0].message.mentions.map((u) => u.id)).toEqual([
          aoife,
        ]);
        const second = await repo.listMentions(
          aoife,
          decodeCursor(first.nextCursor!),
          3,
        );
        expect(second.items.map((x) => x.message.id)).toEqual([ids[0]]);
        expect(second.nextCursor).toBeNull();
        expect((await repo.listMentions(niamh, null)).items).toEqual([]);
      });
    });

    describe("reactions", () => {
      it("keeps the counts on the message in step, once per person and emoji", async () => {
        const t = await start(aoife, "Reactions");
        const m = await reply(
          cian,
          t.id,
          "5m. Fix the light days with a bigger foil.",
        );

        await repo.setReaction(m.id, aoife, "👍", true);
        await repo.setReaction(m.id, aoife, "👍", true);
        await repo.setReaction(m.id, niamh, "👍", true);
        const mine = await repo.setReaction(m.id, niamh, "🤙", true);
        expect(mine).toMatchObject({
          reactions: { "👍": 2, "🤙": 1 },
          myReactions: ["👍", "🤙"],
        });
        expect((await repo.getMessage(m.id, aoife))!.myReactions).toEqual([
          "👍",
        ]);
        expect((await repo.getMessage(m.id, cian))!.myReactions).toEqual([]);

        await repo.setReaction(m.id, niamh, "👍", false);
        await repo.setReaction(m.id, niamh, "👍", false);
        const after = await repo.setReaction(m.id, niamh, "🤙", false);
        expect(after).toMatchObject({
          reactions: { "👍": 1 },
          myReactions: [],
        });
        expect(after!.reactions).not.toHaveProperty("🤙");
      });

      it("holds under parallel reactions to one message", async () => {
        const t = await start(aoife, "Busy message");
        const m = (await repo.listMessages(t.id, { after: -1 }, null))!
          .items[0];
        await Promise.all(
          [aoife, cian, niamh, staff].flatMap((who) =>
            (["🔥", "🌊"] as const).map((emoji) =>
              repo.setReaction(m.id, who, emoji, true),
            ),
          ),
        );
        expect((await repo.getMessage(m.id, null))!.reactions).toEqual({
          "🔥": 4,
          "🌊": 4,
        });
        // One row for the author, one count per person, her own reactions aside.
        const rows = (await repo.listNotifications(aoife, null)).items;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          kind: "reaction",
          count: 3,
          actorCount: 3,
        });
      });

      it("answers null for a message that is gone", async () => {
        expect(await repo.setReaction(newId(), aoife, "👍", true)).toBeNull();
      });
    });

    describe("editing and removing", () => {
      it("changes the words and the mentions, and says it was edited", async () => {
        const t = await start(aoife, "Editing");
        const m = await reply(cian, t.id, `Ask <@${aoife}>.`, {
          mentionIds: [aoife],
        });
        const edited = (await repo.editMessage(
          m.id,
          `Ask <@${niamh}> instead.`,
          [niamh],
        ))!;
        expect(edited.body).toBe(`Ask <@${niamh}> instead.`);
        expect(edited.mentions.map((u) => u.id)).toEqual([niamh]);
        expect(edited.editedAt).not.toBeNull();
        expect(edited.createdAt).toBe(m.createdAt);
        expect(await repo.editMessage(newId(), "Nothing", [])).toBeNull();
      });

      it("keeps a removed message in the stream, empty to everyone but staff", async () => {
        const t = await start(aoife, "Removing");
        const gone = await reply(
          cian,
          t.id,
          "Something that breaks the house rules.",
          {
            photos: [photo(0)],
            mentionIds: [aoife],
          },
        );
        await repo.setReaction(gone.id, niamh, "👀", true);
        const quoting = await reply(niamh, t.id, "Steady on.", {
          replyToId: gone.id,
        });

        const removed = (await repo.removeMessage(gone.id, staff))!;
        expect(removed).toMatchObject({
          status: "removed",
          body: "Something that breaks the house rules.",
        });

        for (const viewer of [null, aoife, cian]) {
          const seen = (await repo.getMessage(gone.id, viewer))!;
          expect(seen).toMatchObject({
            seq: 1,
            status: "removed",
            body: "",
            photos: [],
            mentions: [],
            reactions: {},
          });
        }
        expect((await repo.getMessage(gone.id, staff))!.photos).toHaveLength(1);
        expect(
          (await repo.getMessage(quoting.id, null))!.replyTo,
        ).toMatchObject({
          id: gone.id,
          excerpt: "",
          removed: true,
        });

        expect(await repo.getThread(t.id, null)).toMatchObject({
          lastSeq: 2,
          replyCount: 1,
          participantCount: 2,
          preview: { text: "Steady on." },
        });
        expect(
          await repo.editMessage(gone.id, "Second thoughts", []),
        ).toBeNull();
        expect(await repo.setReaction(gone.id, aoife, "👍", true)).toBeNull();
        expect(await repo.removeMessage(newId(), staff)).toBeNull();
      });

      it("removes the thread with its opening post: gone for members, still there for staff", async () => {
        const t = await start(aoife, "Short-lived");
        const opening = (await repo.listMessages(t.id, { after: -1 }, null))!
          .items[0];
        await reply(cian, t.id, "A reply that goes with it.");
        await repo.removeMessage(opening.id, aoife);

        for (const viewer of [null, aoife, cian]) {
          expect(await repo.getThread(t.id, viewer)).toBeNull();
          expect(
            await repo.listMessages(t.id, { after: -1 }, viewer),
          ).toBeNull();
          expect(await repo.getMessage(opening.id, viewer)).toBeNull();
        }
        expect(await repo.getThread(t.id, staff)).toMatchObject({
          status: "removed",
        });
        expect(
          (await repo.listMessages(t.id, { after: -1 }, staff))!.items,
        ).toHaveLength(2);
        expect((await repo.listThreads({}, staff)).items).toEqual([]);
        expect((await repo.getChannel("wings", null))!.threadCount).toBe(0);
      });

      it("changes nothing inside a removed thread, whose replies are still visible rows", async () => {
        const t = await start(aoife, "Taken down");
        const m = await reply(cian, t.id, "Said before it went.");
        await repo.setThreadStatus(t.id, "removed", null);

        expect(
          await repo.editMessage(m.id, "Said after it went.", []),
        ).toBeNull();
        expect(await repo.setReaction(m.id, niamh, "👍", true)).toBeNull();
        expect(await repo.getMessage(m.id, staff)).toMatchObject({
          body: "Said before it went.",
          editedAt: null,
          reactions: {},
        });

        await repo.setThreadStatus(t.id, "open", null);
        expect(
          await repo.editMessage(m.id, "Said once it was back.", []),
        ).toMatchObject({ body: "Said once it was back." });
      });

      it("locks with a reason and drops the reason when it reopens", async () => {
        const t = await start(aoife, "Locking");
        expect(
          await repo.setThreadStatus(t.id, "locked", "Run its course"),
        ).toMatchObject({
          status: "locked",
          lockedReason: "Run its course",
        });
        expect(
          await repo.setThreadStatus(t.id, "open", "ignored"),
        ).toMatchObject({
          status: "open",
          lockedReason: null,
        });
        expect(await repo.setThreadStatus(newId(), "locked", null)).toBeNull();
      });
    });

    describe("the safety floor's bookkeeping", () => {
      it("stores reports and counts them per reporter since a moment", async () => {
        const t = await start(aoife, "Reported");
        const m = await reply(cian, t.id, "Buy my wing, link in bio.");
        const before = new Date("2026-01-01T00:00:00.000Z");
        for (const reporterId of [aoife, aoife, niamh])
          await repo.addReport({
            id: newId(),
            reporterId,
            messageId: m.id,
            reason: "advertising",
            note: null,
          });
        expect(await repo.countReportsBy(aoife, before)).toBe(2);
        expect(await repo.countReportsBy(niamh, before)).toBe(1);
        expect(
          await repo.countReportsBy(aoife, new Date("2027-01-01T00:00:00Z")),
        ).toBe(0);
      });

      it("keeps the moderation log, newest first", async () => {
        const t = await start(aoife, "Logged");
        for (const action of ["pin", "lock", "unlock"])
          await repo.addModLog({
            id: newId(),
            actorId: staff,
            action,
            targetType: "thread",
            targetId: t.id,
            reason: action === "lock" ? "Run its course" : null,
          });
        const log = await repo.listModLog(2);
        expect(log.map((r) => r.action)).toEqual(["unlock", "lock"]);
        expect(log[1]).toMatchObject({
          actorId: staff,
          targetType: "thread",
          targetId: t.id,
          reason: "Run its course",
        });
      });

      it("counts a person's visible messages and the threads they started", async () => {
        const t = await start(aoife, "One");
        await start(aoife, "Two");
        const m = await reply(aoife, t.id, "And a reply.");
        await reply(cian, t.id, "Not hers.");
        expect(await repo.countMessagesBy(aoife)).toBe(3);
        await repo.removeMessage(m.id, aoife);
        expect(await repo.countMessagesBy(aoife)).toBe(2);

        expect(
          await repo.countThreadsBy(aoife, new Date("2026-01-01T00:00:00Z")),
        ).toBe(2);
        expect(
          await repo.countThreadsBy(aoife, new Date("2027-01-01T00:00:00Z")),
        ).toBe(0);
        expect(
          await repo.countThreadsBy(cian, new Date("2026-01-01T00:00:00Z")),
        ).toBe(0);
      });
    });
  });
}

describe("helpers both repos share", () => {
  it("cuts an excerpt to the first line and a length", () => {
    expect(excerpt("  One line.\nAnother.")).toBe("One line.");
    expect(excerpt("x".repeat(200))).toHaveLength(140);
    expect(excerpt("x".repeat(200)).endsWith("…")).toBe(true);
    expect(excerpt("")).toBe("");
  });

  it("quotes the line that names someone, with each token as its @name", () => {
    const names = new Map([
      ["dev_aoife", "Aoife K"],
      ["dev_cian", "Cian M"],
    ]);
    const body =
      "Not cowardly at all.\n\nAsk <@dev_aoife> or <@dev_cian>, or <@dev_gone>.\nLast line.";
    expect(mentionLine(body, "dev_aoife", names)).toBe(
      "Ask @Aoife K or @Cian M, or @member.",
    );
    // The token went in an edit: the first line stands in.
    expect(mentionLine(body, "dev_niamh", names)).toBe("Not cowardly at all.");
    expect(
      mentionLine(`<@dev_aoife> ${"x".repeat(200)}`, "dev_aoife", names),
    ).toHaveLength(140);
    expect(mentionLine("", "dev_aoife", names)).toBe("");
  });

  it("turns a window into a seq range, a page at most", () => {
    expect(seqRange({ after: -1 }, 100)).toEqual({
      lo: 0,
      hi: LIMITS.pageSize - 1,
    });
    expect(seqRange({ before: 101 }, 100)).toEqual({ lo: 71, hi: 100 });
    expect(seqRange({ around: 50 }, 100)).toEqual({ lo: 35, hi: 64 });
    expect(seqRange({ around: 0 }, 3)).toEqual({ lo: 0, hi: 3 });
  });
});

describe("migrate", () => {
  it("refuses a ledger name that is not a plain identifier, before touching the database", async () => {
    const untouched = (() => {
      throw new Error("the database was used");
    }) as unknown as Db;
    await expect(
      migrate(
        untouched,
        COMMUNITY_MIGRATIONS_DIR,
        "community_migrations; drop table users",
      ),
    ).rejects.toThrow("Not a ledger table name");
  });
});

const memory = memoryBackend();
contract("memory repo", () => memory);

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("Postgres", () => {
  const schema = `community_test_${newId()}`;
  let sql: Db;
  let backend: Backend;
  /** Row counts straight after the migrations, before any test has written. */
  let fresh: Record<string, number>;

  beforeAll(async () => {
    sql = postgres(url!, {
      max: 10,
      onnotice: () => {},
      connection: { search_path: schema },
    });
    await sql`create schema ${sql(schema)}`;
    await migrate(sql);
    await migrate(sql, COMMUNITY_MIGRATIONS_DIR, COMMUNITY_LEDGER);
    fresh = {};
    for (const table of [
      "community_categories",
      "community_channels",
      "community_tags",
      "community_threads",
      "community_messages",
      "users",
    ]) {
      const [row] = await sql<
        { n: string }[]
      >`select count(*) as n from ${sql(table)}`;
      fresh[table] = Number(row.n);
    }
    backend = pgBackend(sql);
  }, 60_000);

  afterAll(async () => {
    await sql`drop schema ${sql(schema)} cascade`;
    await sql.end({ timeout: 5 });
  });

  contract("Postgres repo", () => backend);

  describe("the schema", () => {
    const tables = async () =>
      (
        await sql<{ table_name: string }[]>`
          select table_name from information_schema.tables
          where table_schema = ${schema} order by table_name`
      ).map((r) => r.table_name);

    it("keeps a ledger per section, side by side", async () => {
      expect(await tables()).toEqual(
        expect.arrayContaining(["market_migrations", "community_migrations"]),
      );
      const names = async (ledger: string) =>
        (
          await sql<
            { name: string }[]
          >`select name from ${sql(ledger)} order by name`
        ).map((r) => r.name);
      expect(await names("community_migrations")).toEqual([
        "0001_init.sql",
        "0002_notify.sql",
      ]);
      expect(await names("market_migrations")).toContain("0003_users.sql");
      expect(await names("market_migrations")).toContain(
        "0004_auto_follow.sql",
      );
    });

    it("runs nothing the second time, on either ledger", async () => {
      expect(await migrate(sql)).toEqual([]);
      expect(
        await migrate(sql, COMMUNITY_MIGRATIONS_DIR, COMMUNITY_LEDGER),
      ).toEqual([]);
    });

    it("survives two instances booting together", async () => {
      const other = `${schema}_boot`;
      const boot = postgres(url!, {
        max: 4,
        onnotice: () => {},
        connection: { search_path: other },
      });
      try {
        await boot`create schema ${boot(other)}`;
        await migrate(boot);
        const ran = await Promise.all([
          migrate(boot, COMMUNITY_MIGRATIONS_DIR, COMMUNITY_LEDGER),
          migrate(boot, COMMUNITY_MIGRATIONS_DIR, COMMUNITY_LEDGER),
        ]);
        expect(ran.flat()).toEqual(["0001_init.sql", "0002_notify.sql"]);
      } finally {
        await boot`drop schema if exists ${boot(other)} cascade`;
        await boot.end({ timeout: 5 });
      }
    });

    it("creates every community table, and only the seed rows", async () => {
      expect(
        (await tables()).filter((t) => t.startsWith("community_")),
      ).toEqual([
        "community_categories",
        "community_channel_seen",
        "community_channels",
        "community_follows",
        "community_mentions",
        "community_message_photos",
        "community_messages",
        "community_migrations",
        "community_mod_log",
        "community_notifications",
        "community_reactions",
        "community_reads",
        "community_reports",
        "community_tags",
        "community_thread_tags",
        "community_threads",
      ]);
      expect(fresh).toEqual({
        community_categories: 4,
        community_channels: 10,
        community_tags: 39,
        community_threads: 0,
        community_messages: 0,
        users: 0,
      });
    });

    it("has the indexes the lists, the stream, search and the bell page on", async () => {
      const rows = await sql<{ indexname: string; indexdef: string }[]>`
        select indexname, indexdef from pg_indexes where schemaname = ${schema}`;
      const def = (name: string) =>
        rows.find((r) => r.indexname === name)?.indexdef ?? `no index ${name}`;
      expect(def("community_threads_channel")).toContain(
        "(channel_id, pinned DESC, last_message_at DESC, id)",
      );
      expect(def("community_threads_feed")).toContain(
        "(last_message_at DESC, id)",
      );
      expect(def("community_threads_feed")).toContain(
        "WHERE (status <> 'removed'::text)",
      );
      expect(def("community_messages_thread_seq")).toContain("UNIQUE");
      expect(def("community_messages_thread_seq")).toContain(
        "(thread_id, seq)",
      );
      expect(def("community_threads_search")).toMatch(
        /USING gin \(to_tsvector\(.*title/,
      );
      expect(def("community_messages_search")).toMatch(
        /USING gin \(to_tsvector\(.*body/,
      );
      expect(def("community_notifications_user")).toContain(
        "(user_id, read_at, created_at DESC)",
      );
      // 0002 narrowed it: only replies fold per thread, and reactions per message.
      expect(def("community_notifications_unread")).toContain("UNIQUE");
      expect(def("community_notifications_unread")).toContain(
        "(user_id, thread_id)",
      );
      expect(def("community_notifications_unread")).toMatch(
        /WHERE \(\(read_at IS NULL\) AND \(kind = 'reply'::text\)\)/,
      );
      expect(def("community_notifications_unread_reaction")).toContain(
        "UNIQUE",
      );
      expect(def("community_notifications_unread_reaction")).toContain(
        "(user_id, message_id)",
      );
      expect(def("community_notifications_unread_reaction")).toMatch(
        /WHERE \(\(read_at IS NULL\) AND \(kind = 'reaction'::text\)\)/,
      );
      expect(def("community_notifications_list")).toContain(
        "(user_id, updated_at DESC, id)",
      );
    });

    it("writes the notification rows in the message's transaction: a failure leaves neither", async () => {
      await backend.reset();
      const aoife = await backend.addUser("aoife");
      const cian = await backend.addUser("cian");
      const wings = SEED_CHANNELS.find((c) => c.slug === "wings")!;
      const thread = await backend.repo.createThread({
        id: newId(),
        messageId: newId(),
        channelId: wings.id,
        authorId: aoife,
        title: "All or nothing",
        slug: "all-or-nothing",
        spotId: null,
        tagIds: [],
        body: "Opening post.",
        photos: [],
        mentionIds: [],
      });
      await backend.repo.setFollow(cian, "channel", wings.id, "all", "manual");
      const replyId = newId();
      const threadId = newId();
      const counts = async () => {
        const [row] = await sql<
          { messages: string; threads: string; rows: string; follows: string }[]
        >`
          select (select count(*) from community_messages) as messages,
                 (select count(*) from community_threads) as threads,
                 (select count(*) from community_notifications) as rows,
                 (select count(*) from community_follows) as follows`;
        return row;
      };
      const before = await counts();

      // Every new notification row is refused; the ones already there stand.
      await sql`
        alter table community_notifications
        add constraint refuse_all check (false) not valid`;
      try {
        await expect(
          backend.repo.createMessage({
            id: replyId,
            threadId: thread.id,
            authorId: cian,
            body: "A reply that cannot tell anyone.",
            replyToId: null,
            photos: [],
            mentionIds: [],
          }),
        ).rejects.toMatchObject({ code: "23514" });
        await expect(
          backend.repo.createThread({
            id: threadId,
            messageId: newId(),
            channelId: wings.id,
            authorId: aoife,
            title: "A thread that cannot tell anyone",
            slug: "a-thread",
            spotId: null,
            tagIds: [],
            body: "Opening post.",
            photos: [],
            mentionIds: [],
          }),
        ).rejects.toMatchObject({ code: "23514" });
      } finally {
        await sql`alter table community_notifications drop constraint refuse_all`;
      }

      expect(await counts()).toEqual(before);
      expect(await backend.repo.getMessage(replyId, cian)).toBeNull();
      expect(await backend.repo.getThread(threadId, aoife)).toBeNull();
      // No seq was spent, and cian's automatic follow went with the reply.
      expect(await backend.repo.getThread(thread.id, cian)).toMatchObject({
        lastSeq: 0,
        replyCount: 0,
        following: null,
      });
      expect(await backend.repo.countNotifications(aoife)).toBe(0);

      // The same reply lands once nothing refuses it, and tells aoife.
      const landed = await backend.repo.createMessage({
        id: replyId,
        threadId: thread.id,
        authorId: cian,
        body: "A reply that can.",
        replyToId: null,
        photos: [],
        mentionIds: [],
      });
      expect(landed.seq).toBe(1);
      expect(await backend.repo.countNotifications(aoife)).toBe(1);
    });

    // The users row is the site's, but its only Postgres run is this one.
    it("keeps autoFollow through a PUT /api/me that leaves it out", async () => {
      await backend.reset();
      const aoife = await backend.addUser("aoife");
      const users = pgUsersRepo(sql);
      expect((await users.getUser(aoife))!.autoFollow).toBe(true);
      const put = (input: object) =>
        users.updateUser(
          aoife,
          userInputSchema.parse({ displayName: "Aoife", ...input }),
        );
      expect((await put({ autoFollow: false }))!.autoFollow).toBe(false);
      // The marketplace's profile form never sends it.
      expect((await put({ county: "Sligo" }))!.autoFollow).toBe(false);
      expect((await put({ autoFollow: true }))!.autoFollow).toBe(true);
    });

    // No repo method archives a channel: it is a row edited by hand, so only
    // this run can reach it.
    it("takes an archived channel out of the rail and the feed, and still resolves it", async () => {
      await backend.reset();
      const aoife = await backend.addUser("aoife");
      const id = (slug: string) =>
        SEED_CHANNELS.find((c) => c.slug === slug)!.id;
      const start = (channelId: string, title: string) =>
        backend.repo.createThread({
          id: newId(),
          messageId: newId(),
          channelId,
          authorId: aoife,
          title,
          slug: "a-thread",
          spotId: null,
          tagIds: [],
          body: "Opening post.",
          photos: [],
          mentionIds: [],
        });
      await start(id("wings"), "Still in the feed");
      await start(id("foils"), "Out of the feed");
      const titles = async (query: Parameters<Repo["listThreads"]>[0]) =>
        (await backend.repo.listThreads(query, null)).items.map((t) => t.title);

      await sql`update community_channels set status = 'archived' where id = ${id("foils")}`;
      try {
        const slugs = (await backend.repo.getMeta()).channels.map(
          (c) => c.slug,
        );
        expect(slugs).toHaveLength(9);
        expect(slugs).not.toContain("foils");
        expect(
          (await backend.repo.listChannels(aoife)).map((c) => c.slug),
        ).toEqual(slugs);
        expect(await backend.repo.getChannel("foils", null)).toMatchObject({
          status: "archived",
          threadCount: 1,
        });
        expect(await titles({})).toEqual(["Still in the feed"]);
        expect(await titles({ q: "feed" })).toEqual(["Still in the feed"]);
        expect(await titles({ channelId: id("foils") })).toEqual([
          "Out of the feed",
        ]);
      } finally {
        await sql`update community_channels set status = 'active' where id = ${id("foils")}`;
      }
    });

    it("holds its vocabularies and uniqueness in the database itself", async () => {
      await backend.reset();
      const aoife = await backend.addUser("aoife");
      const wings = SEED_CHANNELS.find((c) => c.slug === "wings")!;
      const thread = await backend.repo.createThread({
        id: newId(),
        messageId: newId(),
        channelId: wings.id,
        authorId: aoife,
        title: "Constraints",
        slug: "constraints",
        spotId: null,
        tagIds: [],
        body: "Opening post.",
        photos: [],
        mentionIds: [],
      });
      const refused = (query: Promise<unknown>) =>
        expect(query).rejects.toMatchObject({
          code: expect.stringMatching(/^23/),
        });

      await refused(
        sql`update community_threads set status = 'archived' where id = ${thread.id}`,
      );
      await refused(
        sql`update community_channels set post_policy = 'nobody' where id = ${wings.id}`,
      );
      await refused(
        sql`update community_channels set status = 'gone' where id = ${wings.id}`,
      );
      await refused(
        sql`update community_messages set status = 'hidden' where thread_id = ${thread.id}`,
      );
      await refused(sql`
        insert into community_channels (id, slug, category_id, name, position)
        values (${newId()}, 'wings', ${wings.categoryId}, 'Wings again', 9)`);
      await refused(sql`
        insert into community_messages (id, thread_id, seq, author_id, body)
        values (${newId()}, ${thread.id}, 0, ${aoife}, 'A second message 0')`);
      await refused(sql`
        insert into community_threads (id, channel_id, author_id, title, slug)
        values (${newId()}, ${wings.id}, 'dev_nobody', 'No such author', 'x')`);

      const notify = () => sql`
        insert into community_notifications (id, user_id, kind, thread_id)
        values (${newId()}, ${aoife}, 'reply', ${thread.id})`;
      await notify();
      await refused(notify());
      await sql`update community_notifications set read_at = now()`;
      await notify();
    });
  });
});
