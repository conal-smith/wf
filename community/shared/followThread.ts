/**
 * The browser's half of a live thread. It listens to the thread's event
 * stream and, told that something changed, fetches messages?after= the last
 * seq it has. Every reconnect makes the same request, so a dropped stream
 * loses nothing; when the stream will not stay up it makes that request every
 * ten seconds instead. Nothing here touches the DOM, so it is tested as it is.
 */
import { LIVE, parseLiveEvent } from "./live.js";
import type { Message, MessagePage } from "./types.js";

/** As much of a browser's EventSource as this needs. */
export interface EventSourceLike {
  /** 2 once the browser has given up, which it does on a refusal. */
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

const CLOSED = 2;

export interface FollowOptions {
  /** `new EventSource(<the thread's events URL>)`, in a browser. */
  open(): EventSourceLike;
  /** GET /threads/:id/messages + afterQuery(seq). */
  fetchAfter(seq: number): Promise<MessagePage>;
  /** The newest seq already on the page. */
  lastSeq: number;
  /** New messages and changed ones, oldest first, to be put in place by id. */
  onMessages(messages: Message[]): void;
}

/**
 * The query fetchAfter sends. Before the opening post there is no seq to
 * name: the API refuses after=-1, and with no cursor it starts at seq 0.
 */
export function afterQuery(seq: number): string {
  return seq < 0 ? "" : `?after=${seq}`;
}

/** Follows until the returned function is called. */
export function followThread(options: FollowOptions): () => void {
  const { fetchAfter, onMessages } = options;
  let lastSeq = options.lastSeq;
  let stopped = false;
  let errors = 0;
  let poll: ReturnType<typeof setInterval> | null = null;
  /** One fetch at a time, in order, so a page never arrives before an older one. */
  let queue: Promise<void> = Promise.resolve();
  let catchingUp = false;

  /** A failed fetch is not the end: the next event, reconnect or poll asks again from the same seq. */
  function enqueue(task: () => Promise<void>): void {
    queue = queue.then(() => (stopped ? undefined : task())).catch(() => {});
  }

  /** Everything after the last seq, a page at a time. */
  async function pull(): Promise<void> {
    let more = true;
    while (more && !stopped) {
      const page = await fetchAfter(lastSeq);
      if (stopped) return;
      const fresh = page.items.filter((m) => m.seq > lastSeq);
      if (fresh.length) {
        lastSeq = fresh[fresh.length - 1].seq;
        onMessages(fresh);
      }
      more = page.hasNewer && fresh.length > 0;
    }
  }

  function catchUp(): void {
    // Whatever is asked for while one is waiting, that one will fetch.
    if (catchingUp) return;
    catchingUp = true;
    enqueue(() => {
      catchingUp = false;
      return pull();
    });
  }

  /** An edit, a removal or a reaction: the one message again, as it now is. */
  function refresh(id: string, seq: number): void {
    enqueue(async () => {
      // Settled at its turn, not when told: a fetch that was under way may
      // have put the message on the page as it was before it changed.
      if (seq > lastSeq) return pull();
      const page = await fetchAfter(seq - 1);
      if (stopped) return;
      const changed = page.items.filter((m) => m.id === id);
      if (changed.length) onMessages(changed);
    });
  }

  const source = options.open();
  source.onopen = () => {
    errors = 0;
    // The first connection and every one after it: whatever was missed.
    catchUp();
  };
  source.onmessage = ({ data }) => {
    const event = parseLiveEvent(data);
    if (!event) return;
    if (event.t !== "msg") refresh(event.id, event.seq);
    // A message not yet on the page arrives whole, as it now is, with the rest.
    else if (event.seq > lastSeq) catchUp();
  };
  source.onerror = () => {
    errors += 1;
    if (errors < LIVE.errorsBeforePolling && source.readyState !== CLOSED)
      return;
    source.close();
    if (poll || stopped) return;
    catchUp();
    poll = setInterval(catchUp, LIVE.pollMs);
  };

  return () => {
    stopped = true;
    source.close();
    if (poll) clearInterval(poll);
  };
}
