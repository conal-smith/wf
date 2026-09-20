/**
 * The community's routes over app.request(), on the memory repo, with dev
 * tokens: `Bearer dev:aoife` is the member dev_aoife. What only staff or a
 * sibling item's route can do (pin, lock) is done on the repo directly, which
 * is where those routes will land too.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { memoryRepo } from "./repo-memory";
import { SEED_CHANNELS } from "./seed";
import {
  LIMITS,
  REACTIONS,
  type MentionPage,
  type Message,
  type MessagePage,
  type NotificationPage,
  type Thread,
  type ThreadPage,
  type ThreadView,
} from "../shared/types";
import { createApp } from "../../market/api/src/app";
import { devVerifier } from "../../market/api/src/auth";
import { ID_PATTERN } from "../../market/api/src/ids";
import { memoryRepo as memoryMarketRepo } from "../../market/api/src/repo-memory";
import { localStorage, type Storage } from "../../market/api/src/storage";
import { devIdentity } from "../../site/api/identity";
import { memoryUsersRepo } from "../../site/api/repo-memory";

/** Issues keys the way the real drivers do: under the prefix it was asked for. */
function fakeStorage(): Storage {
  let n = 0;
  return {
    keyFor: (userId, _contentType, prefix = "market") =>
      `${prefix}/${userId}/${String(++n).padStart(16, "a")}.jpg`,
    publicUrl: (key) => `https://cdn.test/${key}`,
    async presign(key, contentType) {
      return {
        key,
        uploadUrl: `https://bucket.test/${key}?signed`,
        method: "PUT",
        headers: { "Content-Type": contentType },
        publicUrl: `https://cdn.test/${key}`,
      };
    },
    async delete() {},
  };
}

function harness(storage: Storage = fakeStorage()) {
  // The repos' clock moves a second per reading, so activity sorts the way it happened.
  let at = Date.parse("2026-01-01T00:00:00.000Z");
  const tick = () => new Date((at += 1000));
  const users = memoryUsersRepo(tick);
  const repo = memoryRepo(users, tick);
  const app = createApp({
    repo: memoryMarketRepo(users),
    community: repo,
    people: { users, identity: devIdentity() },
    storage,
    verify: devVerifier(),
    storagePrefix: "market",
    corsOrigins: "*",
    authMode: "dev",
    now: () => new Date(at),
  });
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    user?: string,
  ) => {
    const res = await app.request(`/api/community${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(user ? { Authorization: `Bearer dev:${user}` } : {}),
      },
      body:
        body === undefined
          ? undefined
          : typeof body === "string"
            ? body
            : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  /** A staff member. Nothing in the API makes one, so the row is written here. */
  const makeStaff = async (name: string) => {
    await users.insertUser({
      id: `dev_${name}`,
      handle: name,
      displayName: name,
      avatarUrl: null,
    });
    users.peek(`dev_${name}`)!.role = "staff";
  };
  const startThread = async (
    user = "aoife",
    over: Record<string, unknown> = {},
    slug = "general",
  ) => {
    const r = await call(
      "POST",
      `/channels/${slug}/threads`,
      {
        title: "First time at Dollymount",
        body: "Is the car park open at low tide?",
        ...over,
      },
      user,
    );
    expect(r.status).toBe(201);
    return r.body as Thread;
  };
  const reply = async (
    threadId: string,
    body: string,
    user = "aoife",
    over: Record<string, unknown> = {},
  ) => {
    const r = await call(
      "POST",
      `/threads/${threadId}/messages`,
      { body, ...over },
      user,
    );
    expect(r.status).toBe(201);
    return r.body as Message;
  };
  /**
   * Past the new-member rule: three messages standing and an account over a
   * day old. They go in a thread of the first name's, in off-topic.
   */
  const settle = async (...names: string[]) => {
    const thread = await startThread(names[0], {}, "off-topic");
    for (const name of names)
      for (let i = 0; i < LIMITS.newMemberMessages; i++)
        await reply(thread.id, `Hello ${i}`, name);
    at += (LIMITS.newMemberHours + 1) * 60 * 60 * 1000;
  };
  return {
    app,
    repo,
    users,
    call,
    makeStaff,
    startThread,
    reply,
    settle,
    /** Moves every clock forward, the edit window's included. */
    wait: (ms: number) => void (at += ms),
  };
}

const UNKNOWN_ID = "0123456789abcdef";
const VIEWER_THREAD_FIELDS = ["lastReadSeq", "unread", "following"];
const react = (id: string, emoji: string) =>
  `/messages/${id}/reactions/${encodeURIComponent(emoji)}`;

describe("community API: reading", () => {
  it("serves meta with the channels, the reactions and the limits", async () => {
    const { call } = harness();
    const r = await call("GET", "/meta");
    expect(r.status).toBe(200);
    expect(r.body.categories.length).toBeGreaterThan(0);
    expect(r.body.channels.map((c: { slug: string }) => c.slug)).toEqual(
      SEED_CHANNELS.map((c) => c.slug),
    );
    expect(r.body.reactions).toEqual([...REACTIONS]);
    expect(r.body.limits).toEqual(LIMITS);
    expect(r.body.auth).toBe("dev");
  });

  it("lists channels with unread only for a signed-in viewer", async () => {
    const { call, startThread } = harness();
    // Unread counts from when a member joined, so brian is here first.
    await startThread("brian", { title: "Brian was here" });
    await startThread("aoife");

    const anon = await call("GET", "/channels");
    expect(anon.status).toBe(200);
    const general = anon.body.channels.find(
      (c: { slug: string }) => c.slug === "general",
    );
    expect(general.threadCount).toBe(2);
    expect(general).not.toHaveProperty("unread");
    expect(general).not.toHaveProperty("following");

    const signedIn = await call("GET", "/channels", undefined, "brian");
    const mine = signedIn.body.channels.find(
      (c: { slug: string }) => c.slug === "general",
    );
    expect(mine.unread).toBe(1);
    expect(mine.following).toBe(false);
  });

  it("pages the feed by cursor, most recent activity first", async () => {
    const { call, startThread } = harness();
    const made: string[] = [];
    for (let i = 0; i < LIMITS.pageSize + 5; i++)
      made.push((await startThread("aoife", { title: `Thread ${i}` })).id);

    const first = await call("GET", "/feed?tab=latest");
    expect(first.status).toBe(200);
    const one = first.body as ThreadPage;
    expect(one.items).toHaveLength(LIMITS.pageSize);
    expect(one.items[0].id).toBe(made[made.length - 1]);
    expect(one.nextCursor).toEqual(expect.any(String));

    const second = await call("GET", `/feed?cursor=${one.nextCursor}`);
    const two = second.body as ThreadPage;
    expect(two.items).toHaveLength(5);
    expect(two.nextCursor).toBeNull();
    expect([...one.items, ...two.items].map((t) => t.id)).toEqual(
      [...made].reverse(),
    );
  });

  it("refuses a tab it does not have and a cursor it did not make", async () => {
    const { call } = harness();
    let r = await call("GET", "/feed?tab=popular");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid");
    r = await call("GET", "/feed?cursor=not-a-cursor");
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({
      error: "invalid",
      message: expect.any(String),
      details: { cursor: "not-a-cursor" },
    });
  });

  it("lists a channel's threads pinned first, then by last activity, and by tag", async () => {
    const { call, repo, startThread, reply } = harness();
    const wings = SEED_CHANNELS.find((c) => c.slug === "wings")!;
    const [question, review] = wings.tags;
    const a = await startThread(
      "aoife",
      { title: "Oldest", tagIds: [question.id] },
      "wings",
    );
    const b = await startThread(
      "aoife",
      { title: "Middle", tagIds: [review.id] },
      "wings",
    );
    const c = await startThread("aoife", { title: "Newest" }, "wings");
    await startThread("aoife", { title: "Elsewhere" });

    let r = await call("GET", "/channels/wings/threads");
    expect(r.body.items.map((t: Thread) => t.id)).toEqual([c.id, b.id, a.id]);

    await reply(b.id, "Bumping this one.");
    await repo.setThreadPinned(a.id, true);
    r = await call("GET", "/channels/wings/threads");
    expect(r.body.items.map((t: Thread) => t.id)).toEqual([a.id, b.id, c.id]);
    expect(r.body.items[0].pinned).toBe(true);

    r = await call("GET", `/channels/wings/threads?tag=${review.id}`);
    expect(r.body.items.map((t: Thread) => t.id)).toEqual([b.id]);

    r = await call("GET", "/channels/wings/threads?tag=review");
    expect(r.status).toBe(400);
    r = await call("GET", "/channels/no-such-channel/threads");
    expect(r.status).toBe(404);
    r = await call("GET", "/channels/Not%20A%20Slug/threads");
    expect(r.status).toBe(404);
  });

  it("pages a channel's threads by cursor with the pinned ones on the first page", async () => {
    const { call, repo, startThread } = harness();
    const made: string[] = [];
    for (let i = 0; i < LIMITS.pageSize + 2; i++)
      made.push((await startThread("aoife", { title: `Thread ${i}` })).id);
    await repo.setThreadPinned(made[0], true);

    const one = (await call("GET", "/channels/general/threads"))
      .body as ThreadPage;
    expect(one.items[0].id).toBe(made[0]);
    const two = (
      await call("GET", `/channels/general/threads?cursor=${one.nextCursor}`)
    ).body as ThreadPage;
    const seen = [...one.items, ...two.items].map((t) => t.id);
    expect(seen).toHaveLength(made.length);
    expect(new Set(seen)).toEqual(new Set(made));
    expect(two.nextCursor).toBeNull();
  });

  it("opens a thread with its opening post and a page of messages", async () => {
    const { call, startThread, reply } = harness();
    const thread = await startThread("aoife");
    await reply(
      thread.id,
      "It is, until about two hours before high.",
      "brian",
    );

    const r = await call("GET", `/threads/${thread.id}`);
    expect(r.status).toBe(200);
    const view = r.body as ThreadView;
    expect(view.thread.id).toBe(thread.id);
    expect(view.thread.replyCount).toBe(1);
    expect(view.opening.seq).toBe(0);
    expect(view.opening.body).toBe("Is the car park open at low tide?");
    expect(view.messages.items.map((m) => m.seq)).toEqual([0, 1]);
    expect(view.messages.hasOlder).toBe(false);
    expect(view.messages.hasNewer).toBe(false);
  });

  it("opens a thread around where the viewer stopped reading", async () => {
    const { call, repo, startThread, reply } = harness();
    const thread = await startThread("aoife");
    for (let i = 1; i <= 64; i++) await reply(thread.id, `Reply ${i}`);

    // Never opened: from the top.
    let view = (await call("GET", `/threads/${thread.id}`, undefined, "brian"))
      .body as ThreadView;
    expect(view.thread.lastReadSeq).toBeNull();
    expect(view.messages.items[0].seq).toBe(0);
    expect(view.messages.items).toHaveLength(LIMITS.pageSize);

    await repo.markRead("dev_brian", thread.id, 40);
    view = (await call("GET", `/threads/${thread.id}`, undefined, "brian"))
      .body as ThreadView;
    expect(view.thread.lastReadSeq).toBe(40);
    expect(view.thread.unread).toBe(24);
    expect(view.opening.seq).toBe(0);
    const seqs = view.messages.items.map((m) => m.seq);
    expect(seqs).toHaveLength(LIMITS.pageSize);
    expect(seqs).toContain(40);
    expect(seqs[0]).toBeGreaterThan(0);
    expect(view.messages.hasOlder).toBe(true);
    expect(view.messages.hasNewer).toBe(true);
  });

  it("pages 65 messages by seq: after, before and around", async () => {
    const { call, startThread, reply } = harness();
    const thread = await startThread("aoife");
    for (let i = 1; i <= 64; i++) await reply(thread.id, `Reply ${i}`);
    const path = `/threads/${thread.id}/messages`;

    // Forwards from the opening post until there is nothing newer.
    const forward: number[] = [];
    let page = (await call("GET", path)).body as MessagePage;
    expect(page.hasOlder).toBe(false);
    for (;;) {
      forward.push(...page.items.map((m) => m.seq));
      if (!page.hasNewer) break;
      page = (await call("GET", `${path}?after=${forward[forward.length - 1]}`))
        .body as MessagePage;
    }
    expect(forward).toEqual(Array.from({ length: 65 }, (_, i) => i));
    expect(page.items).toHaveLength(5);

    // Backwards from the end.
    const backward: number[] = [];
    page = (await call("GET", `${path}?before=65`)).body as MessagePage;
    expect(page.hasNewer).toBe(false);
    for (;;) {
      backward.unshift(...page.items.map((m) => m.seq));
      if (!page.hasOlder) break;
      page = (await call("GET", `${path}?before=${backward[0]}`))
        .body as MessagePage;
    }
    expect(backward).toEqual(forward);

    page = (await call("GET", `${path}?around=32`)).body as MessagePage;
    expect(page.items).toHaveLength(LIMITS.pageSize);
    expect(page.items.map((m) => m.seq)).toContain(32);
    expect(page.hasOlder).toBe(true);
    expect(page.hasNewer).toBe(true);

    page = (await call("GET", `${path}?after=64`)).body as MessagePage;
    expect(page.items).toEqual([]);
    expect(page.hasNewer).toBe(false);
  });

  it("refuses a window that is not one seq", async () => {
    const { call, startThread } = harness();
    const thread = await startThread("aoife");
    const path = `/threads/${thread.id}/messages`;
    let r = await call("GET", `${path}?after=1&before=9`);
    expect(r.status).toBe(400);
    r = await call("GET", `${path}?after=soon`);
    expect(r.status).toBe(400);
    expect(r.body.details).toEqual({ after: "soon" });
    r = await call("GET", `${path}?around=-1`);
    expect(r.status).toBe(400);
  });

  it("searches titles and message bodies, by cursor", async () => {
    const { call, startThread, reply } = harness();
    const titled = await startThread("aoife", {
      title: "Armstrong mast length",
    });
    const replied = await startThread("aoife", { title: "Which foil first" });
    await reply(replied.id, "I went with the shorter mast to begin with.");
    await startThread("aoife", { title: "Wetsuit thickness for March" });

    let r = await call("GET", "/search?q=mast");
    expect(r.status).toBe(200);
    expect(new Set(r.body.items.map((t: Thread) => t.id))).toEqual(
      new Set([titled.id, replied.id]),
    );
    expect(r.body.nextCursor).toBeNull();

    r = await call("GET", "/search?q=kayak");
    expect(r.body.items).toEqual([]);

    r = await call("GET", "/search?q=%20");
    expect(r.status).toBe(400);
    r = await call("GET", `/search?q=${"a".repeat(101)}`);
    expect(r.status).toBe(400);
    r = await call("GET", "/search?q=mast&cursor=nonsense");
    expect(r.status).toBe(400);
  });

  it("pages search results by cursor", async () => {
    const { call, startThread } = harness();
    for (let i = 0; i < LIMITS.pageSize + 3; i++)
      await startThread("aoife", { title: `Downwind run ${i}` });
    const one = (await call("GET", "/search?q=downwind")).body as ThreadPage;
    expect(one.items).toHaveLength(LIMITS.pageSize);
    const two = (
      await call("GET", `/search?q=downwind&cursor=${one.nextCursor}`)
    ).body as ThreadPage;
    expect(two.items).toHaveLength(3);
    expect(two.nextCursor).toBeNull();
  });

  it("gives a signed-out reader no viewer fields anywhere", async () => {
    const { call, startThread, reply } = harness();
    const thread = await startThread("aoife");
    const message = await reply(thread.id, "Yes, all day.", "brian");
    await call("PUT", react(message.id, "👍"), { on: true }, "aoife");

    const threads: Thread[] = [
      ...(await call("GET", "/feed")).body.items,
      ...(await call("GET", "/channels/general/threads")).body.items,
      ...(await call("GET", "/search?q=dollymount")).body.items,
    ];
    const view = (await call("GET", `/threads/${thread.id}`))
      .body as ThreadView;
    threads.push(view.thread);
    expect(threads).toHaveLength(4);
    for (const t of threads)
      for (const field of VIEWER_THREAD_FIELDS)
        expect(t).not.toHaveProperty(field);

    const page = (await call("GET", `/threads/${thread.id}/messages`))
      .body as MessagePage;
    const messages = [view.opening, ...view.messages.items, ...page.items];
    expect(messages.length).toBeGreaterThan(2);
    for (const m of messages) expect(m).not.toHaveProperty("myReactions");
    expect(page.items[1].reactions).toEqual({ "👍": 1 });

    for (const channel of [
      ...(await call("GET", "/channels")).body.channels,
      ...(await call("GET", "/meta")).body.channels,
    ]) {
      expect(channel).not.toHaveProperty("unread");
      expect(channel).not.toHaveProperty("following");
    }

    // The same reads with a session do carry them.
    const mine = (
      await call("GET", `/threads/${thread.id}`, undefined, "aoife")
    ).body as ThreadView;
    for (const field of VIEWER_THREAD_FIELDS)
      expect(mine.thread).toHaveProperty(field);
    expect(mine.messages.items[1].myReactions).toEqual(["👍"]);
  });
});

describe("community API: ids and errors", () => {
  it("answers 404 for an id of the wrong shape before any query", async () => {
    const { call, repo } = harness();
    const getThread = vi.spyOn(repo, "getThread");
    const getMessage = vi.spyOn(repo, "getMessage");
    const routes: [string, string, unknown?][] = [
      ["GET", "/threads/:id"],
      ["GET", "/threads/:id/messages"],
      ["POST", "/threads/:id/messages", { body: "Hello" }],
      ["PUT", "/messages/:id", { body: "Hello" }],
      ["DELETE", "/messages/:id"],
      [
        "PUT",
        `/messages/:id/reactions/${encodeURIComponent("👍")}`,
        { on: true },
      ],
      ["PUT", "/threads/:id/follow", { level: "all" }],
      ["PUT", "/threads/:id/read", { seq: 0 }],
    ];
    for (const bad of [
      "nope",
      "0123456789ABCDEF",
      "0123456789abcdefg",
      "1%27%20or%201=1",
    ]) {
      expect(ID_PATTERN.test(decodeURIComponent(bad))).toBe(false);
      for (const [method, path, body] of routes) {
        const r = await call(method, path.replace(":id", bad), body, "aoife");
        expect([method, path, r.status]).toEqual([method, path, 404]);
        expect(r.body).toMatchObject({
          error: "not_found",
          message: expect.any(String),
        });
      }
    }
    expect(getThread).not.toHaveBeenCalled();
    expect(getMessage).not.toHaveBeenCalled();

    // A well-formed id that names nothing is the same 404, after a lookup.
    for (const [method, path, body] of routes) {
      const r = await call(
        method,
        path.replace(":id", UNKNOWN_ID),
        body,
        "aoife",
      );
      expect([method, path, r.status]).toEqual([method, path, 404]);
    }
    expect(getThread).toHaveBeenCalled();
    expect(getMessage).toHaveBeenCalled();
  });

  it("answers 401 to every write without a session", async () => {
    const { call, startThread, users } = harness();
    const thread = await startThread("aoife");
    const writes: [string, string, unknown?][] = [
      [
        "POST",
        "/channels/general/threads",
        { title: "Hello there", body: "Hi" },
      ],
      ["POST", `/threads/${thread.id}/messages`, { body: "Hi" }],
      ["PUT", `/messages/${thread.id}`, { body: "Hi" }],
      ["DELETE", `/messages/${thread.id}`],
      ["PUT", react(thread.id, "👍"), { on: true }],
      ["POST", "/uploads", { contentType: "image/jpeg", byteLength: 2048 }],
    ];
    for (const [method, path, body] of writes) {
      const anon = await call(method, path, body);
      expect([path, anon.status]).toEqual([path, 401]);
      expect(anon.body.error).toBe("unauthenticated");
      const forged = await call(method, path, body, "not a token");
      expect([path, forged.status]).toEqual([path, 401]);
    }
    expect(await users.getUser("dev_not")).toBeNull();
  });

  it("refuses a body over 64 KB, and one that is not JSON, in the API's error shape", async () => {
    const { call, startThread } = harness();
    const thread = await startThread("aoife");
    let r = await call(
      "POST",
      `/threads/${thread.id}/messages`,
      { body: "a", padding: "x".repeat(64 * 1024) },
      "aoife",
    );
    expect(r.status).toBe(413);
    expect(r.body).toEqual({
      error: "too_large",
      message: expect.any(String),
    });

    r = await call(
      "POST",
      `/threads/${thread.id}/messages`,
      "{not json",
      "aoife",
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid");

    r = await call(
      "POST",
      `/threads/${thread.id}/messages`,
      { body: "  " },
      "aoife",
    );
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({
      error: "invalid",
      message: expect.any(String),
      details: { body: expect.any(String) },
    });

    r = await call("GET", "/no-such-route");
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("not_found");
  });

  it("lets a suspended member read and refuses their writes", async () => {
    const { call, startThread, users } = harness();
    const thread = await startThread("aoife");
    await users.setSuspendedUntil(
      "dev_aoife",
      new Date("2030-01-01T00:00:00Z"),
    );
    let r = await call(
      "POST",
      `/threads/${thread.id}/messages`,
      { body: "Hi" },
      "aoife",
    );
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("suspended");
    r = await call("GET", `/threads/${thread.id}`, undefined, "aoife");
    expect(r.status).toBe(200);
  });
});

describe("community API: threads", () => {
  it("starts a thread as message 0 and makes the member's row on the way", async () => {
    const { call, users } = harness();
    expect(await users.getUser("dev_aoife")).toBeNull();
    const wings = SEED_CHANNELS.find((c) => c.slug === "wings")!;

    const r = await call(
      "POST",
      "/channels/wings/threads",
      {
        title: "  Is a 4m enough for 75kg?  ",
        body: "Mostly riding Dollymount in 18 to 25 knots.",
        tagIds: [wings.tags[2].id],
        spotId: "dollymount",
      },
      "aoife",
    );
    expect(r.status).toBe(201);
    const thread = r.body as Thread;
    expect(thread.id).toMatch(ID_PATTERN);
    expect(thread).toMatchObject({
      title: "Is a 4m enough for 75kg?",
      slug: "is-a-4m-enough-for-75kg",
      spotId: "dollymount",
      status: "open",
      lastSeq: 0,
      replyCount: 0,
      channel: { slug: "wings" },
      author: { id: "dev_aoife", handle: "aoife", role: "member" },
      tags: [{ id: wings.tags[2].id, label: "Sizing" }],
    });
    expect(await users.getUser("dev_aoife")).toMatchObject({ handle: "aoife" });

    const view = (await call("GET", `/threads/${thread.id}`))
      .body as ThreadView;
    expect(view.opening).toMatchObject({
      seq: 0,
      body: "Mostly riding Dollymount in 18 to 25 knots.",
      author: { id: "dev_aoife" },
    });
  });

  it("makes no row for a first write it refuses", async () => {
    const { call, startThread, users } = harness();
    const thread = await startThread("aoife");
    const refused: [string, unknown][] = [
      ["/channels/general/threads", { title: "Hi", body: "Too short a title" }],
      [
        "/channels/general/threads",
        {
          title: "Someone else's photo",
          body: "Hello",
          photoKeys: ["community/dev_aoife/aaaaaaaaaaaaaaa1.jpg"],
        },
      ],
      [`/threads/${thread.id}/messages`, { body: "  " }],
      [`/threads/${thread.id}/messages`, "{not json"],
      // A new member names nobody yet, themselves included.
      [`/threads/${thread.id}/messages`, { body: "That is me, <@dev_brian>." }],
    ];
    for (const [path, body] of refused) {
      const r = await call("POST", path, body, "brian");
      expect([path, r.status]).toEqual([path, 400]);
    }
    expect(await users.getUser("dev_brian")).toBeNull();

    const r = await call(
      "POST",
      `/threads/${thread.id}/messages`,
      { body: "That is me." },
      "brian",
    );
    expect(r.status).toBe(201);
    expect(await users.getUser("dev_brian")).not.toBeNull();
  });

  it("keeps a staff-only channel for staff", async () => {
    const { call, makeStaff, users } = harness();
    const post = {
      title: "New forecast model",
      body: "It is live from today.",
    };
    let r = await call(
      "POST",
      "/channels/announcements/threads",
      post,
      "aoife",
    );
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("forbidden");
    // Refused before the member's row was needed.
    expect(await users.getUser("dev_aoife")).toBeNull();

    await makeStaff("site");
    r = await call("POST", "/channels/announcements/threads", post, "site");
    expect(r.status).toBe(201);
    expect(r.body.author.role).toBe("staff");

    // Anyone can still read it and reply.
    r = await call(
      "POST",
      `/threads/${r.body.id}/messages`,
      { body: "Great." },
      "aoife",
    );
    expect(r.status).toBe(201);
  });

  it("answers 409 archived in a channel that has left the rail", async () => {
    const { call, repo, users } = harness();
    // No route or repo method archives a channel: that is a migration. The row is read as one here.
    const getChannel = repo.getChannel.bind(repo);
    vi.spyOn(repo, "getChannel").mockImplementation(async (slug, viewerId) => {
      const channel = await getChannel(slug, viewerId);
      return channel && { ...channel, status: "archived" };
    });
    const r = await call(
      "POST",
      "/channels/general/threads",
      { title: "Anyone still here", body: "Hello" },
      "aoife",
    );
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({
      error: "archived",
      message: expect.any(String),
    });
    expect(await users.getUser("dev_aoife")).toBeNull();
    // Its threads are still there to read.
    expect((await call("GET", "/channels/general/threads")).status).toBe(200);
  });

  it("validates a new thread", async () => {
    const { call } = harness();
    const boards = SEED_CHANNELS.find((c) => c.slug === "general")!;
    const wings = SEED_CHANNELS.find((c) => c.slug === "wings")!;
    expect(boards.tags).toEqual([]);

    let r = await call(
      "POST",
      "/channels/general/threads",
      { title: "Hi", body: "" },
      "aoife",
    );
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.details).sort()).toEqual(["body", "title"]);

    // A real tag, of another channel.
    r = await call(
      "POST",
      "/channels/general/threads",
      { title: "Tagged wrongly", body: "Hello", tagIds: [wings.tags[0].id] },
      "aoife",
    );
    expect(r.status).toBe(400);
    expect(r.body.details).toEqual({ tagIds: wings.tags[0].id });

    r = await call(
      "POST",
      "/channels/wings/threads",
      {
        title: "Too many tags",
        body: "Hello",
        tagIds: wings.tags.slice(0, LIMITS.tagsPerThread + 1).map((t) => t.id),
      },
      "aoife",
    );
    expect(r.status).toBe(400);

    r = await call(
      "POST",
      "/channels/nowhere/threads",
      { title: "Hello there", body: "Hi" },
      "aoife",
    );
    expect(r.status).toBe(404);
  });
});

describe("community API: messages", () => {
  it("replies in seq order and quotes the message replied to", async () => {
    const { call, startThread, reply } = harness();
    const thread = await startThread("aoife");
    const first = await reply(
      thread.id,
      "It floods on springs.\nPark by the bridge.",
      "brian",
    );
    expect(first).toMatchObject({ seq: 1, threadId: thread.id, replyTo: null });
    const second = await reply(thread.id, "Thanks!", "aoife", {
      replyToId: first.id,
    });
    expect(second.seq).toBe(2);
    expect(second.replyTo).toMatchObject({
      id: first.id,
      seq: 1,
      author: { id: "dev_brian" },
      excerpt: "It floods on springs.",
      removed: false,
    });

    const head = (await call("GET", `/threads/${thread.id}`)).body
      .thread as Thread;
    expect(head).toMatchObject({
      lastSeq: 2,
      replyCount: 2,
      participantCount: 2,
    });
  });

  it("refuses a reply to a message of another thread", async () => {
    const { call, startThread, reply } = harness();
    const thread = await startThread("aoife");
    const other = await startThread("aoife", { title: "Another thread" });
    const elsewhere = await reply(other.id, "Over here.");
    const r = await call(
      "POST",
      `/threads/${thread.id}/messages`,
      { body: "Replying across threads", replyToId: elsewhere.id },
      "aoife",
    );
    expect(r.status).toBe(400);
    expect(r.body.details).toEqual({ replyToId: elsewhere.id });
  });

  it("answers 409 locked in a locked thread", async () => {
    const { call, repo, startThread } = harness();
    const thread = await startThread("aoife");
    await repo.setThreadStatus(
      thread.id,
      "locked",
      "Settled, see the pinned thread.",
    );
    const r = await call(
      "POST",
      `/threads/${thread.id}/messages`,
      { body: "One more" },
      "brian",
    );
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("locked");
    expect(r.body.message).toContain("Settled, see the pinned thread.");

    // Still readable, and open again once unlocked.
    expect((await call("GET", `/threads/${thread.id}`)).status).toBe(200);
    await repo.setThreadStatus(thread.id, "open", null);
    expect(
      (
        await call(
          "POST",
          `/threads/${thread.id}/messages`,
          { body: "One more" },
          "brian",
        )
      ).status,
    ).toBe(201);
  });

  it("answers 409 locked when the lock lands between the check and the insert", async () => {
    const { call, repo, startThread } = harness();
    const thread = await startThread("aoife");
    const createMessage = repo.createMessage.bind(repo);
    vi.spyOn(repo, "createMessage").mockImplementation(async (input) => {
      await repo.setThreadStatus(thread.id, "locked", null);
      return createMessage(input);
    });
    const r = await call(
      "POST",
      `/threads/${thread.id}/messages`,
      { body: "One more" },
      "brian",
    );
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({
      error: "locked",
      message: expect.any(String),
    });
  });

  it("takes no reply in a removed thread, from staff either", async () => {
    const { call, makeStaff, startThread } = harness();
    await makeStaff("site");
    const thread = await startThread("aoife");
    const view = (await call("GET", `/threads/${thread.id}`))
      .body as ThreadView;
    await call("DELETE", `/messages/${view.opening.id}`, undefined, "aoife");

    // Staff still see it; nobody else does.
    expect(
      (await call("GET", `/threads/${thread.id}`, undefined, "site")).status,
    ).toBe(200);
    for (const user of ["site", "brian"]) {
      const r = await call(
        "POST",
        `/threads/${thread.id}/messages`,
        { body: "One more" },
        user,
      );
      expect([user, r.status]).toEqual([user, 404]);
      expect(r.body.error).toBe("not_found");
    }
  });

  it("lets the author edit inside the window and nobody else", async () => {
    const { call, startThread, reply, wait } = harness();
    const thread = await startThread("aoife");
    const message = await reply(thread.id, "Hight tide is at 3.", "brian");

    let r = await call(
      "PUT",
      `/messages/${message.id}`,
      { body: "Mine now" },
      "aoife",
    );
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("forbidden");

    wait((LIMITS.editWindowMin - 1) * 60 * 1000);
    r = await call(
      "PUT",
      `/messages/${message.id}`,
      { body: "High tide is at 3." },
      "brian",
    );
    expect(r.status).toBe(200);
    expect(r.body.body).toBe("High tide is at 3.");
    expect(r.body.editedAt).toEqual(expect.any(String));
    expect(r.body.seq).toBe(1);

    r = await call("PUT", `/messages/${message.id}`, { body: "" }, "brian");
    expect(r.status).toBe(400);

    wait(2 * 60 * 1000);
    r = await call(
      "PUT",
      `/messages/${message.id}`,
      { body: "Too late" },
      "brian",
    );
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("edit_window");
    const page = (await call("GET", `/threads/${thread.id}/messages`))
      .body as MessagePage;
    expect(page.items[1].body).toBe("High tide is at 3.");
  });

  it("lets the author delete at any time, softly", async () => {
    const { call, startThread, reply, wait } = harness();
    const thread = await startThread("aoife");
    const message = await reply(thread.id, "Ignore me.", "brian");
    await reply(thread.id, "Noted.", "aoife", { replyToId: message.id });

    let r = await call("DELETE", `/messages/${message.id}`, undefined, "aoife");
    expect(r.status).toBe(403);

    wait(24 * 60 * 60 * 1000);
    r = await call("DELETE", `/messages/${message.id}`, undefined, "brian");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id: message.id,
      status: "removed",
      body: "",
    });

    // It keeps its place in the stream and gives up its words.
    const page = (await call("GET", `/threads/${thread.id}/messages`))
      .body as MessagePage;
    expect(page.items.map((m) => [m.seq, m.status])).toEqual([
      [0, "visible"],
      [1, "removed"],
      [2, "visible"],
    ]);
    expect(page.items[1].body).toBe("");
    expect(page.items[2].replyTo).toMatchObject({ removed: true, excerpt: "" });

    r = await call(
      "PUT",
      `/messages/${message.id}`,
      { body: "Back again" },
      "brian",
    );
    expect(r.status).toBe(404);
    r = await call("PUT", react(message.id, "👍"), { on: true }, "aoife");
    expect(r.status).toBe(404);
  });

  it("removes the thread when its opening post is deleted", async () => {
    const { call, startThread, reply } = harness();
    const thread = await startThread("aoife");
    const answer = await reply(thread.id, "Yes.", "brian");
    const opening = (
      (await call("GET", `/threads/${thread.id}`)).body as ThreadView
    ).opening;

    let r = await call("DELETE", `/messages/${opening.id}`, undefined, "brian");
    expect(r.status).toBe(403);
    r = await call("DELETE", `/messages/${opening.id}`, undefined, "aoife");
    expect(r.status).toBe(200);

    expect((await call("GET", `/threads/${thread.id}`)).status).toBe(404);
    expect((await call("GET", `/threads/${thread.id}/messages`)).status).toBe(
      404,
    );
    expect((await call("GET", "/feed")).body.items).toEqual([]);
    expect((await call("GET", "/search?q=dollymount")).body.items).toEqual([]);
    r = await call(
      "POST",
      `/threads/${thread.id}/messages`,
      { body: "Hello?" },
      "brian",
    );
    expect(r.status).toBe(404);
    r = await call("PUT", `/messages/${answer.id}`, { body: "Yes!" }, "brian");
    expect(r.status).toBe(404);
  });
});

describe("community API: reactions", () => {
  it("turns a reaction on and off and keeps the counts in step", async () => {
    const { call, startThread, reply } = harness();
    const thread = await startThread("aoife");
    const message = await reply(thread.id, "Booked the ferry.", "brian");

    let r = await call("PUT", react(message.id, "🤙"), { on: true }, "aoife");
    expect(r.status).toBe(200);
    expect(r.body.reactions).toEqual({ "🤙": 1 });
    expect(r.body.myReactions).toEqual(["🤙"]);

    // Twice is once.
    r = await call("PUT", react(message.id, "🤙"), { on: true }, "aoife");
    expect(r.body.reactions).toEqual({ "🤙": 1 });
    r = await call("PUT", react(message.id, "🤙"), { on: true }, "ciara");
    expect(r.body.reactions).toEqual({ "🤙": 2 });
    r = await call("PUT", react(message.id, "❤️"), { on: true }, "ciara");
    expect(r.body.reactions).toEqual({ "🤙": 2, "❤️": 1 });
    expect(r.body.myReactions.sort()).toEqual(["❤️", "🤙"].sort());

    r = await call("PUT", react(message.id, "🤙"), { on: false }, "aoife");
    expect(r.body.reactions).toEqual({ "🤙": 1, "❤️": 1 });
    expect(r.body.myReactions).toEqual([]);

    // What a fresh read of the stream says is what the writes said.
    const page = (
      await call("GET", `/threads/${thread.id}/messages`, undefined, "aoife")
    ).body as MessagePage;
    expect(page.items[1].reactions).toEqual({ "🤙": 1, "❤️": 1 });
    expect(page.items[1].myReactions).toEqual([]);

    r = await call("PUT", react(message.id, "❤️"), { on: false }, "ciara");
    r = await call("PUT", react(message.id, "🤙"), { on: false }, "ciara");
    expect(r.body.reactions).toEqual({});
  });

  it("refuses an emoji outside the list, and a body that is not { on }", async () => {
    const { call, startThread, users } = harness();
    const thread = await startThread("aoife");
    const opening = (
      (await call("GET", `/threads/${thread.id}`)).body as ThreadView
    ).opening;

    for (const emoji of ["🍕", "thumbsup", "👍👍"]) {
      const r = await call(
        "PUT",
        react(opening.id, emoji),
        { on: true },
        "brian",
      );
      expect([emoji, r.status]).toEqual([emoji, 400]);
      expect(r.body).toMatchObject({ error: "invalid", details: { emoji } });
    }
    // Refused before the member's row was needed.
    expect(await users.getUser("dev_brian")).toBeNull();

    const r = await call(
      "PUT",
      react(opening.id, "👍"),
      { on: "yes" },
      "brian",
    );
    expect(r.status).toBe(400);
    expect(r.body.details).toHaveProperty("on");
  });

  it("makes the member's row on a first reaction", async () => {
    const { call, startThread, users } = harness();
    const thread = await startThread("aoife");
    const opening = (
      (await call("GET", `/threads/${thread.id}`)).body as ThreadView
    ).opening;
    expect(await users.getUser("dev_dara")).toBeNull();
    const r = await call("PUT", react(opening.id, "🌊"), { on: true }, "dara");
    expect(r.status).toBe(200);
    expect(await users.getUser("dev_dara")).toMatchObject({ handle: "dara" });
  });
});

describe("community API: photos", () => {
  const presign = async (
    call: ReturnType<typeof harness>["call"],
    user: string,
  ) => {
    const r = await call(
      "POST",
      "/uploads",
      { contentType: "image/jpeg", byteLength: 2048 },
      user,
    );
    expect(r.status).toBe(200);
    return r.body as { key: string; uploadUrl: string; publicUrl: string };
  };

  it("issues keys under the community prefix and attaches them in order", async () => {
    const { call, startThread, reply } = harness();
    const a = await presign(call, "aoife");
    const b = await presign(call, "aoife");
    const d = await presign(call, "aoife");
    expect(a.key).toMatch(/^community\/dev_aoife\/[0-9a-z]{16}\.jpg$/);
    expect(a.uploadUrl).toContain(a.key);

    const thread = await startThread("aoife", { photoKeys: [a.key] });
    expect(thread.thumbnail).toMatchObject({ url: a.publicUrl });
    const message = await reply(
      thread.id,
      "And from the other side.",
      "aoife",
      {
        photoKeys: [d.key, b.key],
      },
    );
    expect(message.photos.map((p) => p.url)).toEqual([
      d.publicUrl,
      b.publicUrl,
    ]);
    for (const p of message.photos) expect(p.id).toMatch(ID_PATTERN);

    const r = await call(
      "POST",
      "/uploads",
      { contentType: "image/gif" },
      "aoife",
    );
    expect(r.status).toBe(400);
  });

  it("takes the bytes and serves them back with the local driver", async () => {
    const dir = await mkdtemp(join(tmpdir(), "community-uploads-"));
    try {
      const { app, call, startThread } = harness(
        localStorage(
          {
            mode: "local",
            prefix: "market",
            s3: {
              bucket: null,
              region: "auto",
              endpoint: null,
              publicBaseUrl: null,
              forcePathStyle: false,
            },
            local: { dir, secret: "test-secret" },
          },
          "http://api.test",
        ),
      );
      const signed = await presign(call, "aoife");
      expect(signed.key).toMatch(/^community\/dev_aoife\/[0-9a-z]{16}\.jpg$/);

      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      const path = (url: string) => url.replace("http://api.test", "");
      const put = await app.request(path(signed.uploadUrl), {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: bytes,
      });
      expect(put.status).toBe(204);
      // The signature covers the key, so it opens no other.
      const moved = await app.request(
        path(signed.uploadUrl).replace("dev_aoife", "dev_brian"),
        { method: "PUT", body: bytes },
      );
      expect(moved.status).toBe(403);

      const thread = await startThread("aoife", { photoKeys: [signed.key] });
      expect(thread.thumbnail?.url).toBe(signed.publicUrl);
      const got = await app.request(path(signed.publicUrl));
      expect(got.status).toBe(200);
      expect(got.headers.get("content-type")).toBe("image/jpeg");
      expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects keys that were not issued to the caller", async () => {
    const { call, app, startThread } = harness();
    const thread = await startThread("aoife");
    const theirs = await presign(call, "brian");
    const market = await app.request("/api/market/uploads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer dev:aoife",
      },
      body: JSON.stringify({ contentType: "image/jpeg", byteLength: 2048 }),
    });
    const marketKey = ((await market.json()) as { key: string }).key;
    expect(marketKey).toMatch(/^market\/dev_aoife\//);
    const mine = await presign(call, "aoife");

    for (const key of [
      theirs.key,
      marketKey,
      "community/dev_aoife/../dev_brian/aaaaaaaaaaaaaaa1.jpg",
      "https://elsewhere.test/a.jpg",
    ]) {
      const r = await call(
        "POST",
        `/threads/${thread.id}/messages`,
        { body: "Look at this", photoKeys: [key] },
        "aoife",
      );
      expect([key, r.status]).toEqual([key, 400]);
      expect(r.body.details).toEqual({ photoKeys: key });
    }

    let r = await call(
      "POST",
      "/channels/general/threads",
      {
        title: "With a borrowed photo",
        body: "Hello",
        photoKeys: [theirs.key],
      },
      "aoife",
    );
    expect(r.status).toBe(400);

    r = await call(
      "POST",
      `/threads/${thread.id}/messages`,
      { body: "Twice", photoKeys: [mine.key, mine.key] },
      "aoife",
    );
    expect(r.status).toBe(400);

    const many = [];
    for (let i = 0; i <= LIMITS.photosPerMessage; i++)
      many.push((await presign(call, "aoife")).key);
    r = await call(
      "POST",
      `/threads/${thread.id}/messages`,
      { body: "Too many", photoKeys: many },
      "aoife",
    );
    expect(r.status).toBe(400);
    expect(r.body.details).toHaveProperty("photoKeys");

    // Nothing above was stored.
    const page = (await call("GET", `/threads/${thread.id}/messages`))
      .body as MessagePage;
    expect(page.items).toHaveLength(1);
  });

  it("attaches a key once, and refuses it on a second message or thread", async () => {
    const { call, startThread } = harness();
    const used = await presign(call, "aoife");
    const thread = await startThread("aoife", { photoKeys: [used.key] });

    let r = await call(
      "POST",
      `/threads/${thread.id}/messages`,
      { body: "The same photo again", photoKeys: [used.key] },
      "aoife",
    );
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({
      error: "invalid",
      details: { photoKeys: used.key },
    });

    r = await call(
      "POST",
      "/channels/general/threads",
      { title: "And once more", body: "Hello", photoKeys: [used.key] },
      "aoife",
    );
    expect(r.status).toBe(400);
    expect(r.body.details).toEqual({ photoKeys: used.key });

    // Neither refusal left anything behind.
    expect((await call("GET", "/feed")).body.items).toHaveLength(1);
    const head = (await call("GET", `/threads/${thread.id}`))
      .body as ThreadView;
    expect(head.thread.lastSeq).toBe(0);
  });
});

describe("community API: bodies and mentions", () => {
  it("stores a body as typed", async () => {
    const { call, startThread, reply } = harness();
    const thread = await startThread("aoife");
    const typed =
      '<b>Bold?</b> **yes** & <script>alert("no")</script>\n\n> quoted';
    const message = await reply(thread.id, `  ${typed}  `, "aoife");
    expect(message.body).toBe(typed);
    const page = (await call("GET", `/threads/${thread.id}/messages`))
      .body as MessagePage;
    expect(page.items[1].body).toBe(typed);
  });

  it("resolves mention tokens to members at write", async () => {
    const { call, startThread, reply, settle } = harness();
    await settle("aoife");
    const thread = await startThread("aoife");
    await reply(thread.id, "Here.", "brian");

    const body = "Ask <@dev_brian>, and <@dev_brian> again, or <@dev_aoife>.";
    const message = await reply(thread.id, body, "aoife");
    expect(message.body).toBe(body);
    expect(message.mentions.map((m) => m.id).sort()).toEqual([
      "dev_aoife",
      "dev_brian",
    ]);
    expect(message.mentions.find((m) => m.id === "dev_brian")).toMatchObject({
      handle: "brian",
      displayName: "brian",
    });

    // An edit re-resolves them.
    const r = await call(
      "PUT",
      `/messages/${message.id}`,
      { body: "Ask <@dev_aoife>." },
      "aoife",
    );
    expect(r.body.mentions.map((m: { id: string }) => m.id)).toEqual([
      "dev_aoife",
    ]);
  });

  it("refuses a mention of nobody, and more than five", async () => {
    const { call, startThread, reply, settle } = harness();
    await settle("aoife");
    const thread = await startThread("aoife");
    const names = ["brian", "ciara", "dara", "eoin", "fiona", "grace"];
    for (const name of names) await reply(thread.id, "Here.", name);

    let r = await call(
      "POST",
      `/threads/${thread.id}/messages`,
      { body: "Over to <@dev_nobody> and <@dev_brian>." },
      "aoife",
    );
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({
      error: "invalid",
      details: { body: "dev_nobody" },
    });

    const tokens = names.map((n) => `<@dev_${n}>`);
    r = await call(
      "POST",
      `/threads/${thread.id}/messages`,
      { body: tokens.join(" ") },
      "aoife",
    );
    expect(r.status).toBe(400);
    expect(r.body.details).toHaveProperty("body");

    r = await call(
      "POST",
      "/channels/general/threads",
      { title: "Calling everyone", body: tokens.join(" ") },
      "aoife",
    );
    expect(r.status).toBe(400);

    const five = await reply(
      thread.id,
      tokens.slice(0, LIMITS.mentionsPerMessage).join(" "),
    );
    expect(five.mentions).toHaveLength(LIMITS.mentionsPerMessage);

    r = await call(
      "PUT",
      `/messages/${five.id}`,
      { body: "Sorry, I meant <@dev_nobody>." },
      "aoife",
    );
    expect(r.status).toBe(400);
  });
});

describe("community API: following", () => {
  it("follows a thread on starting it and on replying, and keeps a manual choice", async () => {
    const { call, startThread, reply } = harness();
    const thread = await startThread("aoife");
    expect(thread.following).toBe("all");
    await reply(thread.id, "Me too", "brian");
    const asBrian = async () =>
      (await call("GET", `/threads/${thread.id}`, undefined, "brian")).body
        .thread as Thread;
    expect((await asBrian()).following).toBe("all");

    for (const level of ["mentions", "none", "all", "none"] as const) {
      const r = await call(
        "PUT",
        `/threads/${thread.id}/follow`,
        { level },
        "brian",
      );
      expect([level, r.status]).toEqual([level, 200]);
      expect(r.body).toMatchObject({ id: thread.id, following: level });
      expect((await asBrian()).following).toBe(level);
    }
    await reply(thread.id, "Still here", "brian");
    expect((await asBrian()).following).toBe("none");
  });

  it("validates a follow, needs a session, and makes the member's row", async () => {
    const { call, startThread, users } = harness();
    const thread = await startThread("aoife");
    for (const body of [{}, { level: "loud" }, { level: null }, "{not json"]) {
      const r = await call(
        "PUT",
        `/threads/${thread.id}/follow`,
        body,
        "ciara",
      );
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("invalid");
    }
    expect(await users.getUser("dev_ciara")).toBeNull();
    const paths: [string, unknown][] = [
      [`/threads/${thread.id}/follow`, { level: "all" }],
      [`/threads/${thread.id}/read`, { seq: 0 }],
      ["/channels/general/follow", { on: true }],
    ];
    for (const [path, body] of paths) {
      expect([path, (await call("PUT", path, body)).status]).toEqual([
        path,
        401,
      ]);
      const elsewhere = path.replace(thread.id, UNKNOWN_ID);
      if (elsewhere !== path)
        expect([
          path,
          (await call("PUT", elsewhere, body, "ciara")).status,
        ]).toEqual([path, 404]);
    }
    expect(
      (await call("PUT", "/channels/no-such/follow", { on: true }, "ciara"))
        .status,
    ).toBe(404);
    // Reading needs no row; a follow names its member, so it makes one.
    await call("PUT", `/threads/${thread.id}/read`, { seq: 0 }, "ciara");
    expect(await users.getUser("dev_ciara")).toBeNull();
    const r = await call(
      "PUT",
      `/threads/${thread.id}/follow`,
      { level: "all" },
      "ciara",
    );
    expect(r.status).toBe(200);
    expect(await users.getUser("dev_ciara")).not.toBeNull();
  });

  it("follows and unfollows a channel, and counts its followers", async () => {
    const { call } = harness();
    let r = await call("PUT", "/channels/wings/follow", { on: true }, "aoife");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      slug: "wings",
      following: true,
      followerCount: 1,
    });
    await call("PUT", "/channels/wings/follow", { on: true }, "aoife");
    await call("PUT", "/channels/wings/follow", { on: true }, "brian");
    const listed = (await call("GET", "/channels", undefined, "aoife")).body
      .channels as {
      slug: string;
      following: boolean;
      followerCount: number;
    }[];
    expect(listed.filter((c) => c.following).map((c) => c.slug)).toEqual([
      "wings",
    ]);
    expect(listed.find((c) => c.slug === "wings")!.followerCount).toBe(2);

    r = await call("PUT", "/channels/wings/follow", { on: false }, "aoife");
    expect(r.body).toMatchObject({ following: false, followerCount: 1 });
    r = await call("PUT", "/channels/wings/follow", { on: "yes" }, "aoife");
    expect(r.status).toBe(400);
  });

  it("writes no follow for a member who switched autoFollow off on /api/me", async () => {
    const { app, call, startThread, reply } = harness();
    const me = (method: string, body?: unknown) =>
      app.request("/api/me", {
        method,
        headers: {
          Authorization: "Bearer dev:brian",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    expect(await (await me("GET")).json()).toMatchObject({ autoFollow: true });
    expect(
      await (
        await me("PUT", { displayName: "Brian", autoFollow: false })
      ).json(),
    ).toMatchObject({ autoFollow: false });
    // The marketplace's form never sends it, and does not switch it back on.
    expect(
      await (await me("PUT", { displayName: "Brian B" })).json(),
    ).toMatchObject({ displayName: "Brian B", autoFollow: false });
    expect(
      (await me("PUT", { displayName: "Brian", autoFollow: "no" })).status,
    ).toBe(400);

    const theirs = await startThread("aoife");
    await reply(theirs.id, "Passing through", "brian");
    const mine = await startThread("brian");
    expect(mine.following).toBeNull();
    await reply(theirs.id, "Hello brian", "aoife");
    await reply(mine.id, "Hello brian", "aoife");
    expect(
      (await call("GET", "/notifications/count", undefined, "brian")).body,
    ).toEqual({ count: 0 });
    expect(
      (await call("GET", "/feed?tab=following", undefined, "brian")).body.items,
    ).toEqual([]);

    // The button still works, and switching back on follows the next reply.
    await call("PUT", `/threads/${mine.id}/follow`, { level: "all" }, "brian");
    await reply(mine.id, "And again", "aoife");
    expect(
      (await call("GET", "/notifications/count", undefined, "brian")).body,
    ).toEqual({ count: 1 });
    await me("PUT", { displayName: "Brian", autoFollow: true });
    await reply(theirs.id, "Back", "brian");
    expect(
      (await call("GET", `/threads/${theirs.id}`, undefined, "brian")).body
        .thread.following,
    ).toBe("all");
  });
});

describe("community API: notifications", () => {
  type Call = ReturnType<typeof harness>["call"];
  const bell = async (call: Call, user: string) =>
    (await call("GET", "/notifications", undefined, user))
      .body as NotificationPage;
  const count = async (call: Call, user: string) =>
    (await call("GET", "/notifications/count", undefined, user)).body.count;

  it("needs a session on all three routes", async () => {
    const { call } = harness();
    expect((await call("GET", "/notifications/count")).status).toBe(401);
    expect((await call("GET", "/notifications")).status).toBe(401);
    expect(
      (await call("PUT", "/notifications/read", { all: true })).status,
    ).toBe(401);
    // A reader with no row yet has an empty bell, not an error.
    expect(await count(call, "ciara")).toBe(0);
    expect(await bell(call, "ciara")).toEqual({ items: [], nextCursor: null });
  });

  it("4 replies by 2 people make one unread row, count 4, two actors; a mention its own; opening the thread clears them", async () => {
    const { call, startThread, reply, settle } = harness();
    await settle("brian");
    const thread = await startThread("aoife");
    await reply(thread.id, "One", "brian");
    await reply(thread.id, "Two", "ciara");
    await reply(thread.id, "Three", "brian");
    const fourth = await reply(thread.id, "Four", "ciara");
    const named = await reply(
      thread.id,
      "Tide is wrong for that.\nAsk <@dev_aoife>, she was there.",
      "brian",
    );

    expect(await count(call, "aoife")).toBe(2);
    const page = await bell(call, "aoife");
    expect(page.nextCursor).toBeNull();
    expect(page.items).toHaveLength(2);
    const [mention, replies] = page.items;
    expect(replies).toMatchObject({
      kind: "reply",
      count: 4,
      actorCount: 2,
      messageId: fourth.id,
      seq: 4,
      readAt: null,
      thread: {
        id: thread.id,
        slug: thread.slug,
        title: thread.title,
        channel: { slug: "general" },
      },
    });
    expect(replies.actors.map((a) => a.handle)).toEqual(["ciara", "brian"]);
    expect(mention).toMatchObject({
      kind: "mention",
      count: 1,
      messageId: named.id,
      seq: 5,
      excerpt: "Ask @aoife, she was there.",
      readAt: null,
    });
    expect(mention.actors.map((a) => a.handle)).toEqual(["brian"]);
    expect(mention.id).toMatch(ID_PATTERN);

    // Opening the thread: the client reports how far it has read.
    const r = await call(
      "PUT",
      `/threads/${thread.id}/read`,
      { seq: 5 },
      "aoife",
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: thread.id, lastReadSeq: 5, unread: 0 });
    expect(await count(call, "aoife")).toBe(0);
    expect(
      (await bell(call, "aoife")).items.every((n) => n.readAt !== null),
    ).toBe(true);
    // Everyone else's rows are untouched.
    expect(await count(call, "ciara")).toBe(1);
  });

  it("writes no rows for level none, and only mentions for level mentions", async () => {
    const { call, startThread, reply, settle } = harness();
    await settle("brian");
    const thread = await startThread("aoife");
    await reply(thread.id, "Here", "ciara");
    const follow = (level: string, user: string) =>
      call("PUT", `/threads/${thread.id}/follow`, { level }, user);
    await follow("none", "aoife");
    await follow("mentions", "ciara");
    await call("PUT", "/notifications/read", { all: true }, "aoife");

    await reply(thread.id, "A plain reply", "brian");
    const named = await reply(
      thread.id,
      "<@dev_aoife> and <@dev_ciara>, look",
      "brian",
    );
    const mine = await reply(thread.id, "Muted, and still talking", "aoife");
    await call("PUT", react(mine.id, "👍"), { on: true }, "ciara");

    expect(await count(call, "aoife")).toBe(0);
    expect(
      (await bell(call, "aoife")).items.filter((n) => n.readAt === null),
    ).toEqual([]);
    expect(
      (await bell(call, "ciara")).items.map((n) => [n.kind, n.messageId]),
    ).toEqual([["mention", named.id]]);
  });

  it("keeps reactions in the list and out of the count", async () => {
    const { call, startThread } = harness();
    const thread = await startThread("aoife");
    const opening = (await call("GET", `/threads/${thread.id}`)).body
      .opening as Message;
    await call("PUT", react(opening.id, "🤙"), { on: true }, "brian");
    await call("PUT", react(opening.id, "🔥"), { on: true }, "ciara");
    await call("PUT", react(opening.id, "🔥"), { on: true }, "aoife");

    expect(await count(call, "aoife")).toBe(0);
    const { items } = await bell(call, "aoife");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "reaction",
      count: 2,
      emoji: "🔥",
      messageId: opening.id,
      seq: 0,
    });
    expect(items[0].actors.map((a) => a.handle)).toEqual(["ciara", "brian"]);
  });

  it("marks read by ids, by thread or all, exactly one of them", async () => {
    const { call, startThread, reply } = harness();
    const a = await startThread("aoife");
    const b = await startThread("aoife", { title: "A second thread" });
    const c = await startThread("aoife", { title: "A third thread" });
    for (const t of [a, b, c]) await reply(t.id, "Hello", "brian");
    expect(await count(call, "aoife")).toBe(3);

    const bad: unknown[] = [
      {},
      { all: false },
      { ids: [] },
      { ids: ["nope"] },
      { threadId: "nope" },
      { all: true, threadId: a.id },
      { ids: Array.from({ length: 101 }, () => UNKNOWN_ID) },
    ];
    for (const body of bad) {
      const r = await call("PUT", "/notifications/read", body, "aoife");
      expect([body, r.status]).toEqual([body, 400]);
    }
    expect(await count(call, "aoife")).toBe(3);

    const rows = (await bell(call, "aoife")).items;
    const rowA = rows.find((n) => n.thread!.id === a.id)!;
    const read = (body: unknown, user: string) =>
      call("PUT", "/notifications/read", body, user);
    // Someone else's id changes nothing.
    expect((await read({ ids: [rowA.id] }, "brian")).body).toEqual({
      count: 0,
    });
    expect(await count(call, "aoife")).toBe(3);
    expect((await read({ ids: [rowA.id] }, "aoife")).body).toEqual({
      count: 2,
    });
    expect((await read({ threadId: b.id }, "aoife")).body).toEqual({
      count: 1,
    });
    expect((await read({ all: true }, "aoife")).body).toEqual({ count: 0 });
  });

  it("pages the list by cursor and refuses one it did not make", async () => {
    const { call, startThread, reply } = harness();
    const ids: string[] = [];
    for (let i = 0; i < LIMITS.pageSize + 2; i++) {
      const t = await startThread("aoife", { title: `Thread number ${i}` });
      await reply(t.id, "Hello", "brian");
      ids.push(t.id);
    }
    const first = await bell(call, "aoife");
    expect(first.items).toHaveLength(LIMITS.pageSize);
    const second = (
      await call(
        "GET",
        `/notifications?cursor=${first.nextCursor}`,
        undefined,
        "aoife",
      )
    ).body as NotificationPage;
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((n) => n.thread!.id)).toEqual(
      [...ids].reverse(),
    );
    const r = await call(
      "GET",
      "/notifications?cursor=nope",
      undefined,
      "aoife",
    );
    expect(r.status).toBe(400);
  });

  it("tells a channel's followers about a new thread", async () => {
    const { call, startThread, reply } = harness();
    await call("PUT", "/channels/wings/follow", { on: true }, "brian");
    const thread = await startThread("aoife", {}, "wings");
    await startThread("aoife", {}, "foils");
    await reply(thread.id, "A reply", "ciara");

    const { items } = await bell(call, "brian");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "thread",
      seq: 0,
      thread: { id: thread.id, channel: { slug: "wings" } },
    });
    expect(items[0].actors.map((a) => a.handle)).toEqual(["aoife"]);
    expect(await count(call, "brian")).toBe(1);
  });
});

describe("community API: reading position and the rail", () => {
  it("moves the read position forward only, and validates the seq", async () => {
    const { call, startThread, reply } = harness();
    const thread = await startThread("aoife");
    for (let i = 0; i < 5; i++) await reply(thread.id, `Reply ${i}`, "brian");
    const read = (seq: unknown) =>
      call("PUT", `/threads/${thread.id}/read`, { seq }, "ciara");

    expect((await read(3)).body).toMatchObject({ lastReadSeq: 3, unread: 2 });
    expect((await read(1)).body).toMatchObject({ lastReadSeq: 3, unread: 2 });
    expect((await read(999)).body).toMatchObject({ lastReadSeq: 5, unread: 0 });
    for (const seq of [-1, 1.5, "3", null])
      expect([seq, (await read(seq)).status]).toEqual([seq, 400]);
  });

  it("counts a channel's unread threads since the viewer last opened it", async () => {
    const { call, startThread, reply } = harness();
    const unread = async (user: string) =>
      (
        (await call("GET", "/channels", undefined, user)).body.channels as {
          slug: string;
          unread: number;
        }[]
      ).find((c) => c.slug === "wings")!.unread;
    // Unread counts from when they joined, so brian needs a row first.
    await call("PUT", "/channels/general/follow", { on: true }, "brian");
    const one = await startThread("aoife", {}, "wings");
    await startThread("aoife", { title: "A second thread" }, "wings");
    expect(await unread("brian")).toBe(2);

    // A signed-out look changes nothing; a member opening the first page resets it.
    await call("GET", "/channels/wings/threads");
    expect(await unread("brian")).toBe(2);
    await call("GET", "/channels/wings/threads", undefined, "brian");
    expect(await unread("brian")).toBe(0);
    await reply(one.id, "Bump", "aoife");
    expect(await unread("brian")).toBe(1);
    // Their own activity is not news to them.
    await reply(one.id, "Bump back", "brian");
    expect(await unread("brian")).toBe(0);
  });

  it("caps a channel's unread at 99", async () => {
    const { call, startThread } = harness();
    await call("PUT", "/channels/general/follow", { on: true }, "brian");
    for (let i = 0; i < 101; i++)
      await startThread("aoife", { title: `Thread number ${i}` }, "wings");
    const channels = (await call("GET", "/channels", undefined, "brian")).body
      .channels as { slug: string; unread: number }[];
    expect(channels.find((c) => c.slug === "wings")!.unread).toBe(99);
  });
});

describe("community API: the Following and Mentions feeds", () => {
  it("needs a session for both, and leaves Latest public", async () => {
    const { call } = harness();
    for (const tab of ["following", "mentions"]) {
      const r = await call("GET", `/feed?tab=${tab}`);
      expect([tab, r.status, r.body.error]).toEqual([
        tab,
        401,
        "unauthenticated",
      ]);
    }
    expect((await call("GET", "/feed?tab=latest")).status).toBe(200);
  });

  it("lists followed threads and new threads in followed channels, each with why", async () => {
    const { call, startThread, reply } = harness();
    const follow = (threadId: string, level: string) =>
      call("PUT", `/threads/${threadId}/follow`, { level }, "aoife");
    const started = await startThread("aoife", { title: "Aoife started this" });
    const replied = await startThread("brian", { title: "Aoife replied here" });
    const pressed = await startThread("brian", {
      title: "Aoife pressed Follow",
    });
    const muted = await startThread("brian", { title: "Aoife muted this" });
    await startThread("brian", { title: "Before the follow" }, "foils");
    await reply(replied.id, "Me too", "aoife");
    await follow(pressed.id, "all");
    await reply(muted.id, "Enough", "aoife");
    await follow(muted.id, "none");
    await call("PUT", "/channels/foils/follow", { on: true }, "aoife");
    await startThread("brian", { title: "After the follow" }, "foils");
    await startThread("brian", { title: "Nothing to do with Aoife" });
    await reply(started.id, "Bump", "brian");

    const r = await call("GET", "/feed?tab=following", undefined, "aoife");
    expect(r.status).toBe(200);
    const page = r.body as ThreadPage;
    expect(page.items.map((t) => [t.title, t.why])).toEqual([
      ["Aoife started this", "started"],
      ["After the follow", "channel"],
      ["Aoife replied here", "replied"],
      ["Aoife pressed Follow", "followed"],
    ]);
    expect(page.items[0]).toMatchObject({ unread: 1, following: "all" });
    expect(page.nextCursor).toBeNull();
    // Latest carries no why.
    const latest = (await call("GET", "/feed", undefined, "aoife"))
      .body as ThreadPage;
    for (const t of latest.items) expect(t).not.toHaveProperty("why");
  });

  it("lists the messages that mention the viewer, newest first, by cursor", async () => {
    const { call, startThread, reply, settle } = harness();
    await settle("brian");
    const thread = await startThread("aoife");
    const ids: string[] = [];
    for (let i = 0; i < LIMITS.pageSize + 1; i++)
      ids.push((await reply(thread.id, `Hey <@dev_aoife> ${i}`, "brian")).id);
    await reply(thread.id, "Nobody named", "brian");

    const first = (await call("GET", "/feed?tab=mentions", undefined, "aoife"))
      .body as MentionPage;
    expect(first.items).toHaveLength(LIMITS.pageSize);
    expect(first.items[0]).toMatchObject({
      message: {
        id: ids[ids.length - 1],
        body: `Hey <@dev_aoife> ${LIMITS.pageSize}`,
        author: { handle: "brian" },
        mentions: [{ id: "dev_aoife" }],
        myReactions: [],
      },
      thread: {
        id: thread.id,
        title: thread.title,
        channel: { slug: "general" },
      },
    });
    const second = (
      await call(
        "GET",
        `/feed?tab=mentions&cursor=${first.nextCursor}`,
        undefined,
        "aoife",
      )
    ).body as MentionPage;
    expect(second.items.map((x) => x.message.id)).toEqual([ids[0]]);
    expect(second.nextCursor).toBeNull();
    expect(
      (await call("GET", "/feed?tab=mentions", undefined, "brian")).body.items,
    ).toEqual([]);
  });
});

describe("community API: new members and mentions", () => {
  it("refuses a mention until the account is a day old and three messages stand", async () => {
    const { call, startThread, reply, wait, makeStaff } = harness();
    const thread = await startThread("aoife");
    const mention = (user: string, path = `/threads/${thread.id}/messages`) =>
      call(
        "POST",
        path,
        { title: "Calling someone", body: "Hi <@dev_aoife>" },
        user,
      );

    // No row at all: nothing written, so new.
    let r = await mention("brian");
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({
      error: "mentions_not_yet",
      message: expect.any(String),
    });
    expect((await mention("brian", "/channels/general/threads")).status).toBe(
      400,
    );

    // Three messages and still under a day.
    const mine: Message[] = [];
    for (let i = 0; i < LIMITS.newMemberMessages; i++)
      mine.push(await reply(thread.id, `Reply ${i}`, "brian"));
    expect((await mention("brian")).body.error).toBe("mentions_not_yet");
    // Editing one in is the same thing.
    r = await call(
      "PUT",
      `/messages/${mine[2].id}`,
      { body: "Hi <@dev_aoife>" },
      "brian",
    );
    expect(r.body.error).toBe("mentions_not_yet");

    // A day on, with one of the three removed: two stand.
    wait(LIMITS.newMemberHours * 60 * 60 * 1000);
    await call("DELETE", `/messages/${mine[0].id}`, undefined, "brian");
    expect((await mention("brian")).body.error).toBe("mentions_not_yet");
    await reply(thread.id, "A third that stands", "brian");
    expect((await mention("brian")).status).toBe(201);
    expect((await mention("brian", "/channels/general/threads")).status).toBe(
      201,
    );
    // Nothing reached aoife from the refused ones: two mentions, and the replies in one row.
    const kinds = (
      (await call("GET", "/notifications", undefined, "aoife"))
        .body as NotificationPage
    ).items.map((n) => n.kind);
    expect(kinds.sort()).toEqual(["mention", "mention", "reply"]);

    // An old account that has written nothing is still new; staff never are.
    await call("PUT", "/channels/general/follow", { on: true }, "ciara");
    wait(2 * LIMITS.newMemberHours * 60 * 60 * 1000);
    expect((await mention("ciara")).body.error).toBe("mentions_not_yet");
    await makeStaff("sorcha");
    expect((await mention("sorcha")).status).toBe(201);
  });
});
