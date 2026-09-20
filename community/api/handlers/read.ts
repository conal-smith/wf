/**
 * Everything a reader can ask for. None of it needs a session; with one, the
 * repo adds what is the viewer's own (unread, following, myReactions) to the
 * same answer, and without one those fields are simply not there.
 */
import {
  cursorOf,
  lookups,
  type CommunityDeps,
  type Router,
} from "./context.js";
import {
  LIMITS,
  REACTIONS,
  type MemberProfile,
  type MemberView,
  type MessageWindow,
  type MetaPayload,
  type ThreadView,
} from "../../shared/types.js";
import { fail } from "../../../market/api/src/errors.js";
import { ID_PATTERN } from "../../../market/api/src/ids.js";
import { USER_LIMITS, type User } from "../../../site/shared/types.js";
import { HANDLE_PATTERN } from "../../../site/shared/validate.js";

const SEARCH_MAX = 100;

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

/** Named field by field: contact details and the rest of the row stay where they are. */
const profileOf = (user: User): MemberProfile => ({
  id: user.id,
  handle: user.handle,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl,
  role: user.role,
  county: user.county,
  bio: user.bio,
  joinedAt: user.createdAt,
});

export function readRoutes(r: Router, deps: CommunityDeps) {
  const { repo, people } = deps;
  const find = lookups(repo);

  r.get("/meta", async (c) => {
    const [meta, memberCount] = await Promise.all([
      repo.getMeta(),
      people.users.countUsers(),
    ]);
    const payload: MetaPayload = {
      ...meta,
      reactions: REACTIONS,
      limits: LIMITS,
      auth: deps.authMode,
      memberCount,
    };
    return c.json(payload);
  });

  r.get("/channels", async (c) =>
    c.json({ channels: await repo.listChannels(c.var.userId) }),
  );

  // Latest is everyone's. Following and Mentions are a member's own, so they need a session.
  r.get("/feed", async (c) => {
    const params = new URL(c.req.url).searchParams;
    const tab = params.get("tab") ?? "latest";
    if (tab !== "latest" && tab !== "following" && tab !== "mentions")
      fail(400, "invalid", "There is no such tab.", { tab });
    const cursor = cursorOf(params);
    if (tab === "latest")
      return c.json(await repo.listThreads({ cursor }, c.var.userId));
    // requireAuth's answer: it cannot sit on the route, which Latest shares.
    const userId = c.var.userId;
    if (!userId)
      return c.json(
        { error: "unauthenticated", message: "Sign in to do that." },
        401,
      );
    return c.json(
      tab === "following"
        ? await repo.listThreads({ following: true, cursor }, userId)
        : await repo.listMentions(userId, cursor),
    );
  });

  r.get("/channels/:slug/threads", async (c) => {
    const params = new URL(c.req.url).searchParams;
    const channel = await find.channel(c.req.param("slug"), c.var.userId);
    const tag = params.get("tag");
    if (tag && !ID_PATTERN.test(tag))
      fail(400, "invalid", "That is not a tag.", { tag });
    const cursor = cursorOf(params);
    const page = await repo.listThreads(
      { channelId: channel.id, tagId: tag ?? undefined, cursor },
      c.var.userId,
    );
    // Looking at a channel's first page is what resets its unread count in the rail.
    if (c.var.userId && !cursor)
      await repo.markChannelSeen(c.var.userId, channel.id);
    return c.json(page);
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

  // A profile is public, like the threads under it. Reading one makes nobody a row.
  r.get("/members/:handle", async (c) => {
    const handle = c.req.param("handle").toLowerCase();
    const user =
      handle.length <= USER_LIMITS.handleMax && HANDLE_PATTERN.test(handle)
        ? await people.users.getUserByHandle(handle)
        : null;
    if (!user) fail(404, "not_found", "There is no such member.");
    const view: MemberView = {
      member: profileOf(user),
      threads: await repo.listThreads(
        {
          authorId: user.id,
          cursor: cursorOf(new URL(c.req.url).searchParams),
        },
        c.var.userId,
      ),
    };
    return c.json(view);
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
