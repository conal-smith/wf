/**
 * The hub by itself, then the routes around it: what a write publishes, and
 * what GET /threads/:id/events does with it. On the memory hub always, over a
 * real socket once, and through LISTEN/NOTIFY when DATABASE_URL is set
 * (npm run market:db):
 *
 *   DATABASE_URL=postgres://market:market@127.0.0.1:55432/market npm test
 */
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import postgres from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryHub, pgHub, type Hub } from "./hub";
import { memoryRepo } from "./repo-memory";
import {
  afterQuery,
  followThread,
  type EventSourceLike,
} from "../shared/followThread";
import { LIVE, type LiveEvent } from "../shared/live";
import type { Message, MessagePage, Thread, ThreadView } from "../shared/types";
import { createApp } from "../../market/api/src/app";
import { devVerifier } from "../../market/api/src/auth";
import { newId } from "../../market/api/src/ids";
import { memoryRepo as memoryMarketRepo } from "../../market/api/src/repo-memory";
import type { Storage } from "../../market/api/src/storage";
import { devIdentity } from "../../site/api/identity";
import { memoryUsersRepo } from "../../site/api/repo-memory";

const event = (over: Partial<LiveEvent> = {}): LiveEvent => ({
  t: "msg",
  thread: "0000000000000001",
  id: "000000000000000a",
  seq: 1,
  ...over,
});

/** Resolves once `check` holds, or fails the test after a second. */
async function eventually(check: () => boolean): Promise<void> {
  const until = Date.now() + 1000;
  while (!check()) {
    if (Date.now() > until) throw new Error("It never happened.");
    await new Promise((r) => setTimeout(r, 5));
  }
}

function hubContract(name: string, make: () => Promise<Hub>) {
  describe(name, () => {
    it("tells a thread's subscribers once each, and nobody else", async () => {
      const hub = await make();
      const mine: LiveEvent[] = [];
      const alsoMine: LiveEvent[] = [];
      const other: LiveEvent[] = [];
      hub.subscribe(event().thread, (e) => mine.push(e));
      hub.subscribe(event().thread, (e) => alsoMine.push(e));
      hub.subscribe("0000000000000002", (e) => other.push(e));
      await hub.publish(event());
      await eventually(() => mine.length > 0 && alsoMine.length > 0);
      // Long enough for a second copy to have arrived, had there been one.
      await new Promise((r) => setTimeout(r, 50));
      expect(mine).toEqual([event()]);
      expect(alsoMine).toEqual([event()]);
      expect(other).toEqual([]);
      await hub.close();
    });

    it("stops telling whoever unsubscribed, and counts who is left", async () => {
      const hub = await make();
      const left: LiveEvent[] = [];
      const stayed: LiveEvent[] = [];
      const unsubscribe = hub.subscribe(event().thread, (e) => left.push(e));
      hub.subscribe(event().thread, (e) => stayed.push(e));
      expect(hub.count(event().thread)).toBe(2);
      unsubscribe();
      unsubscribe();
      expect(hub.count(event().thread)).toBe(1);
      await hub.publish(event());
      await eventually(() => stayed.length > 0);
      expect(left).toEqual([]);
      await hub.close();
    });

    it("keeps telling the rest when one listener throws", async () => {
      const hub = await make();
      const heard: LiveEvent[] = [];
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      hub.subscribe(event().thread, () => {
        throw new Error("a closed stream");
      });
      hub.subscribe(event().thread, (e) => heard.push(e));
      await hub.publish(event());
      await eventually(() => heard.length > 0);
      expect(quiet).toHaveBeenCalled();
      quiet.mockRestore();
      await hub.close();
    });
  });
}

hubContract("memory hub", async () => memoryHub());

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("Postgres", () => {
  const client = () => postgres(url!, { max: 2, onnotice: () => {} });
  /** Its own channel each time, so two checkouts testing at once never hear each other. */
  const make = async () => {
    const pool = client();
    const hub = await pgHub(client(), pool, `community_test_${newId()}`);
    return {
      ...hub,
      async close() {
        await hub.close();
        await pool.end({ timeout: 5 });
      },
    };
  };

  hubContract("Postgres hub", make);

  it("hears what another process notified, and ignores what is not an event", async () => {
    const channel = `community_test_${newId()}`;
    const pool = client();
    const elsewhere = client();
    const hub = await pgHub(client(), pool, channel);
    const heard: LiveEvent[] = [];
    hub.subscribe(event().thread, (e) => heard.push(e));
    await elsewhere.notify(channel, "not json");
    await elsewhere.notify(channel, JSON.stringify({ t: "msg", thread: 7 }));
    await elsewhere.notify(
      channel,
      JSON.stringify({ ...event(), body: "never sent, never passed on" }),
    );
    await eventually(() => heard.length > 0);
    expect(heard).toEqual([event()]);
    await hub.close();
    await Promise.all([pool.end(), elsewhere.end()]);
  });

  it("listens on a connection of its own and ends it on close, leaving the pool open", async () => {
    const channel = `community_test_${newId()}`;
    const pool = client();
    const listening = () => pool<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where query ilike ${`listen "${channel}"`}`;
    const hub = await pgHub(client(), pool, channel);
    expect((await listening())[0].n).toBe(1);
    await hub.close();
    expect((await listening())[0].n).toBe(0);
    // The pool is the caller's, and still answers.
    expect((await pool`select 1 as one`)[0].one).toBe(1);
    await pool.end({ timeout: 5 });
  });
});

// ---- the routes -------------------------------------------------------------

/** No test here attaches a photo. */
const noStorage: Storage = {
  keyFor: () => "",
  publicUrl: (key) => key,
  presign: async () => {
    throw new Error("No uploads here.");
  },
  async delete() {},
};

function harness(hub: Hub = memoryHub()) {
  let at = Date.parse("2026-01-01T00:00:00.000Z");
  const tick = () => new Date((at += 1000));
  const users = memoryUsersRepo(tick);
  const published: LiveEvent[] = [];
  const spied: Hub = {
    ...hub,
    async publish(e) {
      published.push(e);
      await hub.publish(e);
    },
  };
  const app = createApp({
    repo: memoryMarketRepo(users),
    community: memoryRepo(users, tick),
    people: { users, identity: devIdentity() },
    storage: noStorage,
    verify: devVerifier(),
    storagePrefix: "market",
    corsOrigins: "*",
    authMode: "dev",
    now: () => new Date(at),
    hub: spied,
    // Replies come a second apart here, and the rate limits are not what this file is about.
    limiter: { take() {} },
  });
  const call = async <T>(
    method: string,
    path: string,
    body?: unknown,
    user = "aoife",
  ): Promise<T> => {
    const res = await app.request(`/api/community${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer dev:${user}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect(res.status).toBeLessThan(300);
    return (await res.json()) as T;
  };
  const startThread = () =>
    call<Thread>("POST", "/channels/general/threads", {
      title: "First time at Dollymount",
      body: "Is the car park open at low tide?",
    });
  const reply = (threadId: string, body = "It is, until the spring tides.") =>
    call<Message>("POST", `/threads/${threadId}/messages`, { body }, "brian");
  const events = (threadId: string, headers: Record<string, string> = {}) =>
    app.request(`/api/community/threads/${threadId}/events`, { headers });
  return { app, hub, published, users, call, startThread, reply, events };
}

/** Reads a stream as text, a wait at a time. */
function reading(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  return {
    /** Everything read so far, once it contains `wanted`. */
    async until(wanted: string): Promise<string> {
      while (!text.includes(wanted)) {
        const { done, value } = await reader.read();
        if (done) throw new Error(`The stream ended before "${wanted}".`);
        text += decoder.decode(value, { stream: true });
      }
      return text;
    },
    cancel: () => reader.cancel(),
  };
}

describe("what a write publishes", () => {
  it("a reply, an edit, a reaction and a removal, each after it is saved, as ids and a seq", async () => {
    const { published, call, startThread, reply } = harness();
    const thread = await startThread();
    // Nobody has a thread open before it exists.
    expect(published).toEqual([]);
    const message = await reply(thread.id);
    const at = { thread: thread.id, id: message.id, seq: 1 };
    await call("PUT", `/messages/${message.id}`, { body: "Edited." }, "brian");
    await call("PUT", `/messages/${message.id}/reactions/🤙`, { on: true });
    await call("DELETE", `/messages/${message.id}`, undefined, "brian");
    expect(published).toEqual([
      { t: "msg", ...at },
      { t: "edit", ...at },
      { t: "react", ...at },
      { t: "remove", ...at },
    ]);
  });

  it("a thread staff removed, as the removal of its opening post", async () => {
    const { published, users, call, startThread } = harness();
    const thread = await startThread();
    await users.insertUser({
      id: "dev_sorcha",
      handle: "sorcha",
      displayName: "Sorcha",
      avatarUrl: null,
    });
    users.peek("dev_sorcha")!.role = "staff";
    const { opening } = await call<ThreadView>("GET", `/threads/${thread.id}`);
    await call(
      "POST",
      `/threads/${thread.id}/lock`,
      { reason: "A pause" },
      "sorcha",
    );
    expect(published).toEqual([]);
    await call("POST", `/threads/${thread.id}/remove`, {}, "sorcha");
    expect(published).toEqual([
      { t: "remove", thread: thread.id, id: opening.id, seq: 0 },
    ]);
  });

  it("nothing for a write that was refused", async () => {
    const { app, published, startThread } = harness();
    const thread = await startThread();
    const res = await app.request(
      `/api/community/threads/${thread.id}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dev:brian",
        },
        body: JSON.stringify({ body: "" }),
      },
    );
    expect(res.status).toBe(400);
    expect(published).toEqual([]);
  });

  it("the write stands when the hub cannot be reached", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { call, startThread, reply } = harness({
      ...memoryHub(),
      publish: async () => {
        throw new Error("connection refused");
      },
    });
    const thread = await startThread();
    const message = await reply(thread.id);
    const page = await call<MessagePage>(
      "GET",
      `/threads/${thread.id}/messages?after=0`,
    );
    expect(page.items.map((m) => m.id)).toEqual([message.id]);
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});

describe("GET /threads/:id/events", () => {
  afterEach(() => vi.useRealTimers());

  it("is an event stream anyone may open, and a 404 for a thread that is not there", async () => {
    const { startThread, events } = harness();
    const thread = await startThread();
    const res = await events(thread.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    await reading(res).cancel();
    expect((await events("0000000000000000")).status).toBe(404);
    expect((await events("not-an-id")).status).toBe(404);
  });

  it("sends a reply once, as ids, to the thread it was made in", async () => {
    const { startThread, reply, events } = harness();
    const [thread, other] = [await startThread(), await startThread()];
    const stream = reading(await events(thread.id));
    const elsewhere = reading(await events(other.id));
    await reply(other.id, "Not for the first stream.");
    const message = await reply(thread.id);
    const second = await reply(thread.id, "And the café is open.");
    const text = await stream.until(second.id);
    const data = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    expect(data).toEqual([
      { t: "msg", thread: thread.id, id: message.id, seq: 1 },
      { t: "msg", thread: thread.id, id: second.id, seq: 2 },
    ]);
    expect(text).not.toContain("spring tides");
    await Promise.all([stream.cancel(), elsewhere.cancel()]);
  });

  it("writes a comment line every 25 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { startThread, events } = harness();
    const thread = await startThread();
    const stream = reading(await events(thread.id));
    expect(await stream.until(": open\n\n")).not.toContain("keepalive");
    vi.advanceTimersByTime(LIVE.heartbeatMs - 1);
    vi.advanceTimersByTime(1);
    expect(await stream.until(": keepalive\n\n")).not.toContain("data:");
    vi.advanceTimersByTime(LIVE.heartbeatMs);
    await stream.until(": keepalive\n\n: keepalive\n\n");
    expect(LIVE.heartbeatMs).toBe(25_000);
    await stream.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unsubscribes when the reader goes away", async () => {
    const { hub, startThread, events } = harness();
    const thread = await startThread();
    const stream = reading(await events(thread.id));
    await stream.until(": open");
    expect(hub.count(thread.id)).toBe(1);
    await stream.cancel();
    await eventually(() => hub.count(thread.id) === 0);
  });

  it("refuses an eleventh stream from one address, until one of the ten closes", async () => {
    const { startThread, events } = harness();
    const thread = await startThread();
    const from = { "X-Forwarded-For": "203.0.113.9, 198.51.100.7" };
    const open = [];
    for (let i = 0; i < LIVE.perIp; i++)
      open.push(reading(await events(thread.id, from)));
    const refused = await events(thread.id, from);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: "busy" });
    // The last hop is the address: the first is whatever the caller typed.
    const neighbour = await events(thread.id, {
      "X-Forwarded-For": "203.0.113.9, 198.51.100.8",
    });
    expect(neighbour.status).toBe(200);
    await open[0].cancel();
    let again = await events(thread.id, from);
    // The seat is given back as the stream closes, a moment after the cancel.
    for (let i = 0; again.status === 429 && i < 50; i++) {
      await new Promise((r) => setTimeout(r, 5));
      again = await events(thread.id, from);
    }
    expect(again.status).toBe(200);
    await Promise.all(
      [...open.slice(1), reading(neighbour), reading(again)].map((s) =>
        s.cancel(),
      ),
    );
  });

  it("refuses a stream on a thread that already has 200", async () => {
    const { hub, startThread, events } = harness();
    const thread = await startThread();
    const leave = Array.from({ length: LIVE.perThread }, () =>
      hub.subscribe(thread.id, () => {}),
    );
    expect((await events(thread.id)).status).toBe(429);
    leave[0]();
    const res = await events(thread.id);
    expect(res.status).toBe(200);
    await reading(res).cancel();
  });
});

describe("the browser's follower, on these routes", () => {
  it("is handed a reply, and the opening post when it is edited", async () => {
    const { call, startThread, reply, events } = harness();
    const thread = await startThread();
    const stream = reading(await events(thread.id));
    const source: EventSourceLike = {
      readyState: 1,
      onopen: null,
      onmessage: null,
      onerror: null,
      close: () => void stream.cancel(),
    };
    const got: Message[] = [];
    const stop = followThread({
      open: () => source,
      fetchAfter: (seq) =>
        call<MessagePage>(
          "GET",
          `/threads/${thread.id}/messages${afterQuery(seq)}`,
        ),
      lastSeq: 0,
      onMessages: (messages) => got.push(...messages),
    });
    /** Hands the follower the stream's next data line containing `wanted`. */
    const hear = async (wanted: string) => {
      const lines = (await stream.until(wanted)).split("\n");
      const line = lines.filter((l) => l.startsWith("data: ")).at(-1)!;
      source.onmessage!({ data: line.slice(6) });
    };

    const message = await reply(thread.id);
    await hear(message.id);
    await eventually(() => got.length === 1);
    expect(got[0]).toMatchObject({ id: message.id, seq: 1 });

    // The opening post is seq 0, and the API refuses after=-1.
    const first = await call<MessagePage>(
      "GET",
      `/threads/${thread.id}/messages`,
    );
    await call("PUT", `/messages/${first.items[0].id}`, {
      body: "Is it open at high tide?",
    });
    await hear('"edit"');
    await eventually(() => got.length === 2);
    expect(got[1]).toMatchObject({ seq: 0, body: "Is it open at high tide?" });
    stop();
  });
});

describe("over a socket", () => {
  it("a reply reaches an open stream well inside two seconds, and an abort frees the seat", async () => {
    const { app, hub, startThread, reply } = harness();
    const thread = await startThread();
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise((r) => server.once("listening", r));
    const { port } = server.address() as AddressInfo;
    const reader = new AbortController();
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/community/threads/${thread.id}/events`,
        { signal: reader.signal },
      );
      const stream = reading(res);
      await stream.until(": open");
      const sent = Date.now();
      const message = await reply(thread.id);
      await stream.until(message.id);
      expect(Date.now() - sent).toBeLessThan(2000);
      expect(hub.count(thread.id)).toBe(1);
      reader.abort();
      await eventually(() => hub.count(thread.id) === 0);
    } finally {
      reader.abort();
      await new Promise((r) => server.close(r));
    }
  });
});
