/**
 * The browser's follower against a stream it is handed and a thread kept in
 * an array: what it fetches when told, what a reconnect costs (nothing), and
 * when it gives up on the stream and polls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterQuery, followThread, type EventSourceLike } from "./followThread";
import { LIVE, parseLiveEvent, type LiveEvent } from "./live";
import type { Message, MessagePage } from "./types";

const THREAD = "0000000000000001";
const idOf = (seq: number) => String(seq).padStart(16, "0");

function message(seq: number, body = `Message ${seq}`): Message {
  return {
    id: idOf(seq),
    threadId: THREAD,
    seq,
    author: {
      id: "dev_aoife",
      handle: "aoife",
      displayName: "Aoife",
      avatarUrl: null,
      role: "member",
    },
    body,
    replyTo: null,
    reactions: {},
    status: "visible",
    editedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    photos: [],
    mentions: [],
  };
}

const live = (t: LiveEvent["t"], seq: number): string =>
  JSON.stringify({ t, thread: THREAD, id: idOf(seq), seq });

function setup(lastSeq: number, pageSize = 30) {
  /** The thread as the API has it. */
  const thread: Message[] = [];
  for (let seq = 0; seq <= lastSeq; seq++) thread.push(message(seq));
  const asked: number[] = [];
  let failing = false;
  /** While set, an answer already read from the thread has not yet arrived. */
  let held: Promise<void> | null = null;
  const fetchAfter = async (seq: number): Promise<MessagePage> => {
    asked.push(seq);
    if (failing) throw new Error("offline");
    const newer = thread.filter((m) => m.seq > seq);
    const page = {
      items: newer.slice(0, pageSize),
      hasOlder: seq >= 0,
      hasNewer: newer.length > pageSize,
    };
    await held;
    return page;
  };
  const sources: (EventSourceLike & { closed: boolean })[] = [];
  const open = () => {
    const source = {
      readyState: 0,
      onopen: null,
      onmessage: null,
      onerror: null,
      closed: false,
      close() {
        this.closed = true;
      },
    };
    sources.push(source);
    return source;
  };
  const got: Message[][] = [];
  const stop = followThread({
    open,
    fetchAfter,
    lastSeq,
    onMessages: (messages) => got.push(messages),
  });
  /** Lets the queued fetches finish. */
  const settle = () => vi.advanceTimersByTimeAsync(0);
  return {
    thread,
    asked,
    got,
    stop,
    settle,
    source: sources[0],
    sources,
    fail: (on: boolean) => (failing = on),
    /** Holds every answer back until the returned function is called. */
    hold() {
      let release = () => {};
      held = new Promise((resolve) => (release = resolve));
      return () => {
        held = null;
        release();
      };
    },
  };
}

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe("parseLiveEvent", () => {
  it("reads an event and drops any field it does not know", () => {
    expect(
      parseLiveEvent(
        JSON.stringify({ ...JSON.parse(live("edit", 3)), body: "words" }),
      ),
    ).toEqual({ t: "edit", thread: THREAD, id: idOf(3), seq: 3 });
  });

  it("is null for anything else", () => {
    for (const text of [
      "",
      "not json",
      "null",
      JSON.stringify({ t: "typing", thread: THREAD, id: idOf(1), seq: 1 }),
      JSON.stringify({ t: "msg", thread: "short", id: idOf(1), seq: 1 }),
      JSON.stringify({ t: "msg", thread: THREAD, id: idOf(1), seq: -1 }),
      JSON.stringify({ t: "msg", thread: THREAD, id: idOf(1), seq: 1.5 }),
    ])
      expect(parseLiveEvent(text)).toBeNull();
  });
});

describe("followThread", () => {
  it("told of a reply, fetches what is after the last seq it has", async () => {
    const { thread, asked, got, source, settle } = setup(2);
    thread.push(message(3));
    source.onmessage!({ data: live("msg", 3) });
    await settle();
    expect(asked).toEqual([2]);
    expect(got).toEqual([[message(3)]]);
    thread.push(message(4));
    source.onmessage!({ data: live("msg", 4) });
    await settle();
    expect(asked).toEqual([2, 3]);
    expect(got[1]).toEqual([message(4)]);
  });

  it("asks for nothing when told of a message it already has, or of nonsense", async () => {
    const { asked, source, settle } = setup(2);
    source.onmessage!({ data: live("msg", 2) });
    source.onmessage!({ data: "not an event" });
    await settle();
    expect(asked).toEqual([]);
  });

  it("makes the same request on every connection, so a dropped stream loses nothing", async () => {
    const { thread, asked, got, source, settle } = setup(2);
    source.onopen!();
    await settle();
    expect(asked).toEqual([2]);
    expect(got).toEqual([]);
    // The stream drops, two replies are made, and the browser reconnects.
    source.onerror!();
    thread.push(message(3), message(4));
    source.onopen!();
    await settle();
    expect(asked).toEqual([2, 2]);
    expect(got).toEqual([[message(3), message(4)]]);
  });

  it("keeps fetching while there are newer pages", async () => {
    const { thread, asked, got, source, settle } = setup(0, 2);
    for (let seq = 1; seq <= 5; seq++) thread.push(message(seq));
    source.onopen!();
    await settle();
    expect(asked).toEqual([0, 2, 4]);
    expect(got.flat().map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("makes one request for a burst of events, and delivers each message once", async () => {
    const { thread, asked, got, source, settle } = setup(0);
    thread.push(message(1), message(2), message(3));
    source.onmessage!({ data: live("msg", 1) });
    source.onmessage!({ data: live("msg", 2) });
    source.onmessage!({ data: live("msg", 3) });
    await settle();
    expect(asked).toEqual([0]);
    expect(got.flat().map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it("fetches the one message again when it is edited, removed or reacted to", async () => {
    const { thread, asked, got, source, settle } = setup(3);
    for (const t of ["edit", "react", "remove"] as const) {
      thread[2] = message(2, `After ${t}`);
      source.onmessage!({ data: live(t, 2) });
      await settle();
    }
    expect(asked).toEqual([1, 1, 1]);
    expect(got).toEqual([
      [message(2, "After edit")],
      [message(2, "After react")],
      [message(2, "After remove")],
    ]);
  });

  it("fetches the opening post again from before seq 0, which the API spells as no cursor", async () => {
    const { thread, asked, got, source, settle } = setup(1);
    thread[0] = message(0, "Edited.");
    source.onmessage!({ data: live("edit", 0) });
    await settle();
    expect(asked).toEqual([-1]);
    expect(got).toEqual([[message(0, "Edited.")]]);
    expect(afterQuery(-1)).toBe("");
    expect(afterQuery(0)).toBe("?after=0");
    expect(afterQuery(25)).toBe("?after=25");
  });

  it("does not lose a change to a message that a fetch under way had already read", async () => {
    const { thread, asked, got, source, settle, hold } = setup(1);
    thread.push(message(2));
    const release = hold();
    source.onmessage!({ data: live("msg", 2) });
    await settle();
    // The answer is on its way with message 2 as it was; then it is reacted to.
    thread[2] = message(2, "After react");
    source.onmessage!({ data: live("react", 2) });
    release();
    await settle();
    expect(asked).toEqual([1, 1]);
    expect(got).toEqual([[message(2)], [message(2, "After react")]]);
  });

  it("told of a change to a message it has not reached, fetches up to it", async () => {
    const { thread, asked, got, source, settle } = setup(1);
    thread.push(message(2, "After edit"));
    source.onmessage!({ data: live("edit", 2) });
    await settle();
    expect(asked).toEqual([1]);
    expect(got).toEqual([[message(2, "After edit")]]);
  });

  it("asks again from the same seq after a fetch fails", async () => {
    const { thread, asked, got, source, settle, fail } = setup(1);
    thread.push(message(2));
    fail(true);
    source.onmessage!({ data: live("msg", 2) });
    await settle();
    expect(got).toEqual([]);
    fail(false);
    thread.push(message(3));
    source.onmessage!({ data: live("msg", 3) });
    await settle();
    expect(asked).toEqual([1, 1]);
    expect(got).toEqual([[message(2), message(3)]]);
  });

  it("polls every ten seconds once the stream has failed three times running", async () => {
    const { thread, asked, got, source } = setup(0);
    source.onerror!();
    source.onerror!();
    await vi.advanceTimersByTimeAsync(LIVE.pollMs * 2);
    expect(asked).toEqual([]);
    expect(source.closed).toBe(false);
    source.onerror!();
    await vi.advanceTimersByTimeAsync(0);
    expect(source.closed).toBe(true);
    expect(asked).toEqual([0]);
    thread.push(message(1));
    await vi.advanceTimersByTimeAsync(LIVE.pollMs - 1);
    expect(asked).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(asked).toEqual([0, 0]);
    expect(got).toEqual([[message(1)]]);
    await vi.advanceTimersByTimeAsync(LIVE.pollMs);
    expect(asked).toEqual([0, 0, 1]);
    expect(LIVE.pollMs).toBe(10_000);
    expect(LIVE.errorsBeforePolling).toBe(3);
  });

  it("does not count errors across a connection that opened", async () => {
    const { asked, source } = setup(0);
    source.onerror!();
    source.onerror!();
    source.onopen!();
    source.onerror!();
    source.onerror!();
    await vi.advanceTimersByTimeAsync(LIVE.pollMs);
    expect(source.closed).toBe(false);
    expect(asked).toEqual([0]);
  });

  it("polls at once when the browser has given up on the stream", async () => {
    const { asked, source } = setup(0);
    // What a refusal (the cap's 429) leaves behind: closed, and no retry.
    (source as { readyState: number }).readyState = 2;
    source.onerror!();
    await vi.advanceTimersByTimeAsync(LIVE.pollMs);
    expect(asked).toEqual([0, 0]);
  });

  it("stops: the stream is closed, the poll ends, and a fetch still waiting is never made", async () => {
    const { thread, asked, got, source, stop, settle } = setup(0);
    thread.push(message(1));
    source.onmessage!({ data: live("msg", 1) });
    stop();
    await settle();
    expect(asked).toEqual([]);
    expect(got).toEqual([]);
    expect(source.closed).toBe(true);

    const polling = setup(0);
    for (let i = 0; i < LIVE.errorsBeforePolling; i++)
      polling.source.onerror!();
    await vi.advanceTimersByTimeAsync(0);
    polling.stop();
    await vi.advanceTimersByTimeAsync(LIVE.pollMs * 3);
    expect(polling.asked).toEqual([0]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
