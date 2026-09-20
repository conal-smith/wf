/**
 * Everything a reader can ask for. None of it needs a session; with one, the
 * repo adds what is the viewer's own (unread, following, myReactions) to the
 * same answer, and without one those fields are simply not there.
 */
import { lookups, type CommunityDeps, type Router } from "./context.js";
import {
  LIMITS,
  REACTIONS,
  type MessageWindow,
  type MetaPayload,
  type ThreadCursor,
  type ThreadView,
} from "../../shared/types.js";
import { decodeCursor } from "../../shared/validate.js";
import { fail } from "../../../market/api/src/errors.js";
import { ID_PATTERN } from "../../../market/api/src/ids.js";

const SEARCH_MAX = 100;

function cursorOf(params: URLSearchParams): ThreadCursor | null {
  const text = params.get("cursor");
  if (!text) return null;
  const cursor = decodeCursor(text);
  if (!cursor)
    fail(400, "invalid", "That cursor is not one this API made.", {
      cursor: text,
    });
  return cursor;
}

/** after, before or around, as a seq. With none of them the stream starts at the opening post. */
function windowOf(params: URLSearchParams): MessageWindow {
  const given = (["after", "before", "around"] as const).filter((name) =>
    params.has(name),
  );
  if (!given.length) return { after: -1 };
  if (given.length > 1)
    fail(400, "invalid", "Send one of after, before or around.");
  const [name] = given;
  const text = params.get(name)!;
  if (!/^\d{1,9}$/.test(text))
    fail(400, "invalid", `${name} must be a message's seq.`, { [name]: text });
  const seq = Number(text);
  return name === "after"
    ? { after: seq }
    : name === "before"
      ? { before: seq }
      : { around: seq };
}

export function readRoutes(r: Router, deps: CommunityDeps) {
  const { repo } = deps;
  const find = lookups(repo);

  r.get("/meta", async (c) => {
    const payload: MetaPayload = {
      ...(await repo.getMeta()),
      reactions: REACTIONS,
      limits: LIMITS,
      auth: deps.authMode,
    };
    return c.json(payload);
  });

  r.get("/channels", async (c) =>
    c.json({ channels: await repo.listChannels(c.var.userId) }),
  );

  // Following and Mentions are this query with a filter, and arrive with follows.
  r.get("/feed", async (c) => {
    const params = new URL(c.req.url).searchParams;
    const tab = params.get("tab") ?? "latest";
    if (tab !== "latest")
      fail(400, "invalid", "There is no such tab.", { tab });
    return c.json(
      await repo.listThreads({ cursor: cursorOf(params) }, c.var.userId),
    );
  });

  r.get("/channels/:slug/threads", async (c) => {
    const params = new URL(c.req.url).searchParams;
    const channel = await find.channel(c.req.param("slug"), c.var.userId);
    const tag = params.get("tag");
    if (tag && !ID_PATTERN.test(tag))
      fail(400, "invalid", "That is not a tag.", { tag });
    return c.json(
      await repo.listThreads(
        {
          channelId: channel.id,
          tagId: tag ?? undefined,
          cursor: cursorOf(params),
        },
        c.var.userId,
      ),
    );
  });

  r.get("/threads/:id", async (c) => {
    const viewerId = c.var.userId;
    const thread = await find.thread(c.req.param("id"), viewerId);
    // Someone who has been here before lands where they stopped reading.
    const window: MessageWindow =
      thread.lastReadSeq == null
        ? { after: -1 }
        : { around: thread.lastReadSeq };
    const [first, messages] = await Promise.all([
      repo.listMessages(thread.id, { after: -1, limit: 1 }, viewerId),
      repo.listMessages(thread.id, window, viewerId),
    ]);
    const opening = first?.items[0];
    // Removed between the two reads.
    if (!opening || !messages)
      fail(404, "not_found", "That thread does not exist or has been removed.");
    const view: ThreadView = { thread, opening, messages };
    return c.json(view);
  });

  r.get("/threads/:id/messages", async (c) => {
    const thread = await find.thread(c.req.param("id"), c.var.userId);
    const page = await repo.listMessages(
      thread.id,
      windowOf(new URL(c.req.url).searchParams),
      c.var.userId,
    );
    if (!page)
      fail(404, "not_found", "That thread does not exist or has been removed.");
    return c.json(page);
  });

  r.get("/search", async (c) => {
    const params = new URL(c.req.url).searchParams;
    const q = (params.get("q") ?? "").trim();
    if (!q || q.length > SEARCH_MAX)
      fail(
        400,
        "invalid",
        `Search for something, in ${SEARCH_MAX} characters or fewer.`,
        { q },
      );
    return c.json(
      await repo.listThreads({ q, cursor: cursorOf(params) }, c.var.userId),
    );
  });
}
