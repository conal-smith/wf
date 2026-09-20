/**
 * What a member chooses to hear about, and where they have read to. Starting
 * a thread or replying follows it without any of this; these routes are the
 * Follow button, its three levels, and a channel's bell.
 */
import {
  jsonBody,
  lookups,
  readJson,
  type CommunityDeps,
  type Router,
} from "./context.js";
import {
  channelFollowSchema,
  readInputSchema,
  threadFollowSchema,
} from "../../shared/validate.js";
import { requireAuth } from "../../../market/api/src/auth.js";
import { ensureUser } from "../../../site/api/users.js";

export function followRoutes(r: Router, deps: CommunityDeps) {
  const { repo, people } = deps;
  const find = lookups(repo);

  // `none` is a choice too: it is kept, so replying again does not follow again.
  r.put("/threads/:id/follow", requireAuth, jsonBody, async (c) => {
    const userId = c.var.userId!;
    const thread = await find.thread(c.req.param("id"), userId);
    const { level } = threadFollowSchema.parse(await readJson(c));
    // The follow's row names its member, so they need a row by now.
    await ensureUser(people, userId);
    await repo.setFollow(userId, "thread", thread.id, level, "manual");
    return c.json({ ...thread, following: level });
  });

  // A channel is followed or it is not: new threads, never every reply.
  r.put("/channels/:slug/follow", requireAuth, jsonBody, async (c) => {
    const userId = c.var.userId!;
    const channel = await find.channel(c.req.param("slug"), userId);
    const { on } = channelFollowSchema.parse(await readJson(c));
    if (on) {
      await ensureUser(people, userId);
      await repo.setFollow(userId, "channel", channel.id, "all", "manual");
    } else {
      await repo.clearFollow(userId, "channel", channel.id);
    }
    // Read again for the follower count.
    return c.json(await find.channel(channel.slug, userId));
  });

  // Reading needs no row in users. Opening a thread also clears its rows in the bell.
  r.put("/threads/:id/read", requireAuth, jsonBody, async (c) => {
    const userId = c.var.userId!;
    const thread = await find.thread(c.req.param("id"), userId);
    const { seq } = readInputSchema.parse(await readJson(c));
    await repo.markRead(userId, thread.id, seq);
    return c.json(await find.thread(thread.id, userId));
  });
}
