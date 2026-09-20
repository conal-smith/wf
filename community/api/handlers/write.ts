/**
 * Everything a member can change: start a thread, reply, edit and remove
 * their own words, react. Each needs a session, and each makes the member's
 * `users` row the first time, so nobody fills in a form to join.
 */
import {
  jsonBody,
  lookups,
  readJson,
  UPLOAD_PREFIX,
  type LiveDeps,
  type Router,
} from "./context.js";
import {
  PhotoKeyTakenError,
  ReplyTargetError,
  ThreadClosedError,
  type PhotoRow,
} from "../repo.js";
import type { LiveEvent } from "../../shared/live.js";
import { LIMITS, type Message, type Thread } from "../../shared/types.js";
import {
  isReaction,
  mentionIds,
  messageEditSchema,
  messageInputSchema,
  reactionInputSchema,
  slugifyTitle,
  threadInputSchema,
} from "../../shared/validate.js";
import { requireAuth } from "../../../market/api/src/auth.js";
import { fail } from "../../../market/api/src/errors.js";
import { newId } from "../../../market/api/src/ids.js";
import { keyBelongsTo } from "../../../market/api/src/storage.js";
import { ensureUser } from "../../../site/api/users.js";

export function writeRoutes(r: Router, deps: LiveDeps) {
  const { repo, people, storage, hub } = deps;
  const now = deps.now ?? (() => new Date());
  const find = lookups(repo);

  /**
   * The people a body's <@user_id> tokens name. The body is stored as typed,
   * so a token that names nobody is refused here, not dropped later. The
   * schema has already capped how many there are.
   */
  async function resolveMentions(body: string): Promise<string[]> {
    const ids = mentionIds(body);
    const found = await Promise.all(ids.map((id) => people.users.getUser(id)));
    const unknown = ids.filter((_, i) => !found[i]);
    if (unknown.length)
      fail(400, "invalid", "You mentioned someone who is not a member.", {
        body: unknown.join(", "),
      });
    return ids;
  }

  /** New photos must be keys this API issued to this member, each used once. */
  function resolvePhotos(keys: string[], userId: string): PhotoRow[] {
    const seen = new Set<string>();
    return keys.map((key, position) => {
      if (!keyBelongsTo(key, UPLOAD_PREFIX, userId))
        fail(400, "invalid", "A photo upload key was not issued to you.", {
          photoKeys: key,
        });
      if (seen.has(key))
        fail(400, "invalid", "The same photo was attached twice.");
      seen.add(key);
      return {
        id: newId(),
        storageKey: key,
        url: storage.publicUrl(key),
        width: null,
        height: null,
        position,
      };
    });
  }

  /** A key is attached once, ever. Only the repo knows what is already on a message. */
  function refuseTakenKey(err: unknown): void {
    if (err instanceof PhotoKeyTakenError)
      fail(400, "invalid", "That photo is already attached to a message.", {
        photoKeys: err.storageKey,
      });
  }

  function refuseClosed(thread: Pick<Thread, "lockedReason">): never {
    fail(
      409,
      "locked",
      thread.lockedReason
        ? `This thread is locked: ${thread.lockedReason}`
        : "This thread is locked.",
    );
  }

  /**
   * Tells the thread's open streams, once the repo has committed. It is never
   * the write's failure: a reader who misses this catches up on their next fetch.
   */
  async function announce(t: LiveEvent["t"], message: Message): Promise<void> {
    try {
      await hub.publish({
        t,
        thread: message.threadId,
        id: message.id,
        seq: message.seq,
      });
    } catch (err) {
      console.error("community: a live event was not published", err);
    }
  }

  // ---- threads ------------------------------------------------------------

  r.post("/channels/:slug/threads", requireAuth, jsonBody, async (c) => {
    const userId = c.var.userId!;
    const channel = await find.channel(c.req.param("slug"), userId);
    if (channel.status !== "active")
      fail(
        409,
        "archived",
        "This channel is archived and takes no new threads.",
      );
    // Staff are made by hand, so a caller with no row yet is not one.
    if (
      channel.postPolicy === "staff" &&
      (await people.users.getUser(userId))?.role !== "staff"
    )
      fail(
        403,
        "forbidden",
        "Only the site's team can start a thread in this channel.",
      );
    const input = threadInputSchema.parse(await readJson(c));
    const stray = input.tagIds.find(
      (id) => !channel.tags.some((tag) => tag.id === id),
    );
    if (stray)
      fail(400, "invalid", "A tag you picked is not one of this channel's.", {
        tagIds: stray,
      });
    const photos = resolvePhotos(input.photoKeys, userId);
    // Before the mentions: a member's first words may name themselves.
    await ensureUser(people, userId);
    const mentions = await resolveMentions(input.body);
    try {
      const thread = await repo.createThread({
        id: newId(),
        messageId: newId(),
        channelId: channel.id,
        authorId: userId,
        title: input.title,
        slug: slugifyTitle(input.title),
        spotId: input.spotId ?? null,
        tagIds: input.tagIds,
        body: input.body,
        mentionIds: mentions,
        photos,
      });
      return c.json(thread, 201);
    } catch (err) {
      refuseTakenKey(err);
      throw err;
    }
  });

  // ---- messages -----------------------------------------------------------

  r.post("/threads/:id/messages", requireAuth, jsonBody, async (c) => {
    const userId = c.var.userId!;
    const thread = await find.thread(c.req.param("id"), userId);
    // Only staff get this far into a removed thread, and it takes no replies either.
    if (thread.status === "removed")
      fail(404, "not_found", "That thread has been removed.");
    if (thread.status === "locked") refuseClosed(thread);
    const input = messageInputSchema.parse(await readJson(c));
    const photos = resolvePhotos(input.photoKeys, userId);
    await ensureUser(people, userId);
    const mentions = await resolveMentions(input.body);
    try {
      const message = await repo.createMessage({
        id: newId(),
        threadId: thread.id,
        authorId: userId,
        body: input.body,
        replyToId: input.replyToId ?? null,
        mentionIds: mentions,
        photos,
      });
      await announce("msg", message);
      return c.json(message, 201);
    } catch (err) {
      refuseTakenKey(err);
      if (err instanceof ReplyTargetError)
        fail(
          400,
          "invalid",
          "You can only reply to a message in this thread.",
          {
            replyToId: err.replyToId,
          },
        );
      // Locked between the check above and the insert.
      if (err instanceof ThreadClosedError)
        refuseClosed({ lockedReason: null });
      throw err;
    }
  });

  r.put("/messages/:id", requireAuth, jsonBody, async (c) => {
    const userId = c.var.userId!;
    const current = await find.message(c.req.param("id"), userId);
    if (current.author.id !== userId)
      fail(403, "forbidden", "Only its author can edit this message.");
    if (current.status === "removed")
      fail(404, "not_found", "That message has been removed.");
    const ageMs = now().getTime() - Date.parse(current.createdAt);
    if (ageMs > LIMITS.editWindowMin * 60 * 1000)
      fail(
        409,
        "edit_window",
        `A message can be edited for ${LIMITS.editWindowMin} minutes after it is posted.`,
      );
    const { body } = messageEditSchema.parse(await readJson(c));
    const message = await repo.editMessage(
      current.id,
      body,
      await resolveMentions(body),
    );
    if (!message) fail(404, "not_found", "That message has been removed.");
    await announce("edit", message);
    return c.json(message);
  });

  // Soft, and with no window. Removing the opening post removes the thread.
  r.delete("/messages/:id", requireAuth, async (c) => {
    const userId = c.var.userId!;
    const current = await find.message(c.req.param("id"), userId);
    if (current.author.id !== userId)
      fail(403, "forbidden", "Only its author can delete this message.");
    const message = await repo.removeMessage(current.id, userId);
    if (!message) fail(404, "not_found", "That message does not exist.");
    await announce("remove", message);
    return c.json(message);
  });

  // ---- reactions ----------------------------------------------------------

  r.put("/messages/:id/reactions/:emoji", requireAuth, jsonBody, async (c) => {
    const userId = c.var.userId!;
    const emoji = c.req.param("emoji");
    const current = await find.message(c.req.param("id"), userId);
    if (!isReaction(emoji))
      fail(400, "invalid", "That is not one of the reactions.", { emoji });
    const { on } = reactionInputSchema.parse(await readJson(c));
    // The reaction's row names its member, so they need a row by now.
    await ensureUser(people, userId);
    const message = await repo.setReaction(current.id, userId, emoji, on);
    if (!message) fail(404, "not_found", "That message has been removed.");
    await announce("react", message);
    return c.json(message);
  });
}
