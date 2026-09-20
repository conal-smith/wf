/**
 * Who is listening to which thread, in this process. A write publishes after
 * it commits; every open stream on that thread hears it once. On Postgres the
 * event goes out as NOTIFY and comes back on one listening connection, so a
 * second API instance would hear it too. On the memory repo it never leaves
 * the process.
 */
import type { Db } from "../../market/api/src/db.js";
import { parseLiveEvent, type LiveEvent } from "../shared/live.js";

export type Listener = (event: LiveEvent) => void;

export interface Hub {
  /** After the commit. Resolves once the event is on its way, not once it is heard. */
  publish(event: LiveEvent): Promise<void>;
  /** Hears the thread's events until the returned function is called. */
  subscribe(threadId: string, listener: Listener): () => void;
  /** Open subscriptions on one thread, for the cap. */
  count(threadId: string): number;
  close(): Promise<void>;
}

/** The channel every community event is notified on. */
export const CHANNEL = "community";

/** The fan-out both hubs share. One listener throwing does not starve the rest. */
function subscribers() {
  const byThread = new Map<string, Set<Listener>>();
  return {
    add(threadId: string, listener: Listener): () => void {
      const set = byThread.get(threadId) ?? new Set();
      byThread.set(threadId, set);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (!set.size && byThread.get(threadId) === set)
          byThread.delete(threadId);
      };
    },
    deliver(event: LiveEvent): void {
      // A copy: a listener may unsubscribe while it is being told.
      for (const listener of [...(byThread.get(event.thread) ?? [])]) {
        try {
          listener(event);
        } catch (err) {
          console.error("community: a live listener failed", err);
        }
      }
    },
    count: (threadId: string) => byThread.get(threadId)?.size ?? 0,
    clear: () => byThread.clear(),
  };
}

/** For the memory repo and the tests: the same interface, delivered in-process. */
export function memoryHub(): Hub {
  const subs = subscribers();
  let closed = false;
  return {
    async publish(event) {
      if (!closed) subs.deliver(event);
    },
    subscribe: subs.add,
    count: subs.count,
    async close() {
      closed = true;
      subs.clear();
    },
  };
}

/**
 * `listener` is a client of its own, never the pool the queries run on: a
 * LISTEN holds its connection for the life of the process, and the pool has
 * five. It belongs to the hub, which ends it on close. `publisher` is the
 * pool, and stays the caller's. Resolves once the LISTEN is in place;
 * postgres.js listens again by itself after a dropped connection.
 */
export async function pgHub(
  listener: Db,
  publisher: Db,
  channel = CHANNEL,
): Promise<Hub> {
  const subs = subscribers();
  await listener.listen(channel, (payload) => {
    const event = parseLiveEvent(payload);
    if (event) subs.deliver(event);
  });
  return {
    async publish(event) {
      await publisher.notify(channel, JSON.stringify(event));
    },
    subscribe: subs.add,
    count: subs.count,
    async close() {
      subs.clear();
      await listener.end({ timeout: 5 });
    },
  };
}
