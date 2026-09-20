/**
 * The one live thing: the open thread's events, as a server-sent stream. It
 * is public, like the thread, so a browser's EventSource needs no token. The
 * stream says which message changed and nothing of what it says; the reader
 * fetches messages?after= as they would after any reconnect.
 */
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { lookups, type Env, type LiveDeps, type Router } from "./context.js";
import { LIVE } from "../../shared/live.js";

/**
 * The address a stream is counted against. Behind a proxy that is the last
 * hop of X-Forwarded-For, the one the proxy wrote itself: anything before it
 * is the caller's to invent. With no proxy it is the socket's.
 */
function addressOf(c: Context<Env>): string {
  const hops = (c.req.header("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  const env = c.env as
    { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return hops.at(-1) ?? env?.incoming?.socket?.remoteAddress ?? "unknown";
}

export function eventRoutes(r: Router, deps: LiveDeps) {
  const { repo, hub } = deps;
  const find = lookups(repo);
  /** Open streams by address, across every thread. */
  const open = new Map<string, number>();

  r.get("/threads/:id/events", async (c) => {
    const thread = await find.thread(c.req.param("id"), c.var.userId);
    const address = addressOf(c);
    const mine = open.get(address) ?? 0;
    // The reader loses nothing: their client falls back to asking every ten seconds.
    if (hub.count(thread.id) >= LIVE.perThread || mine >= LIVE.perIp)
      return c.json(
        {
          error: "busy",
          message: "Too many live connections. This thread will update itself.",
        },
        429,
      );
    open.set(address, mine + 1);

    // Asks a buffering proxy to pass each line on as it is written.
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      const unsubscribe = hub.subscribe(
        thread.id,
        (event) => void stream.writeSSE({ data: JSON.stringify(event) }),
      );
      const beat = setInterval(
        () => void stream.write(": keepalive\n\n"),
        LIVE.heartbeatMs,
      );
      try {
        // Asked for before the first write, which a reader can already abort.
        const gone = new Promise<void>((resolve) => stream.onAbort(resolve));
        // Something to send at once, so the browser knows the stream is open.
        void stream.write(": open\n\n");
        // Until the reader goes away; the helper closes the stream after this.
        await gone;
      } finally {
        clearInterval(beat);
        unsubscribe();
        const left = (open.get(address) ?? 1) - 1;
        if (left > 0) open.set(address, left);
        else open.delete(address);
      }
    });
  });
}
