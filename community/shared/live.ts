/**
 * What travels when a thread changes while someone has it open: the API
 * publishes one of these after a write commits, and the browser hears it on
 * GET /threads/:id/events. It carries ids and a seq, never words: whoever
 * hears it fetches what they are allowed to see, the ordinary way.
 */
import { z } from "zod";
import { ID_SHAPE } from "./validate.js";

export const LIVE = {
  /** A comment line this often, so no proxy decides the stream has gone quiet. */
  heartbeatMs: 25_000,
  /** Open streams on one thread, and from one address across all threads. */
  perThread: 200,
  perIp: 10,
  /** After this many stream errors in a row the browser polls instead. */
  errorsBeforePolling: 3,
  pollMs: 10_000,
} as const;

const id = z.string().regex(ID_SHAPE);

const liveEventSchema = z.object({
  /** A new message, an edit, a removal, or a reaction put on or taken off. */
  t: z.enum(["msg", "edit", "remove", "react"]),
  thread: id,
  /** The message. */
  id,
  /** The message's seq: for `msg`, the newest there is. */
  seq: z.number().int().min(0),
});

export type LiveEvent = z.infer<typeof liveEventSchema>;

/** The event in a payload or a `data:` line, or null for anything else. */
export function parseLiveEvent(text: string): LiveEvent | null {
  try {
    const parsed = liveEventSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
