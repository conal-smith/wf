/**
 * What the site's team can do, in place, from a thread: pin it, lock it with
 * a reason people see, remove it, and suspend a member until a date. Staff
 * are made by hand in the database; nothing here or anywhere grants the role.
 * Removing someone else's message is the DELETE in write.ts, which asks the
 * same question. Every action that lands writes a row to community_mod_log.
 */
import type { Context, MiddlewareHandler } from "hono";
import {
  announce,
  isStaff,
  jsonBody,
  lookups,
  readJson,
  type Env,
  type LiveDeps,
  type Router,
} from "./context.js";
import type { ModLogEntry } from "../repo.js";
import type { Thread } from "../../shared/types.js";
import {
  lockInputSchema,
  removeInputSchema,
  suspendInputSchema,
} from "../../shared/validate.js";
import { requireAuth } from "../../../market/api/src/auth.js";
import { fail } from "../../../market/api/src/errors.js";
import { newId } from "../../../market/api/src/ids.js";

/** A user id as the identity provider or a dev token makes it: what a mention token holds. */
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function moderationRoutes(r: Router, deps: LiveDeps) {
  const { repo, people, hub } = deps;
  const now = deps.now ?? (() => new Date());
  const find = lookups(repo);

  /** After requireAuth. A member is refused before anything is read or written. */
  const staffOnly: MiddlewareHandler<Env> = async (c, next) => {
    if (!(await isStaff(deps, c.var.userId!)))
      fail(403, "forbidden", "Only the site's team can do that.");
    await next();
  };

  const log = (
    actorId: string,
    action: string,
    targetType: ModLogEntry["targetType"],
    targetId: string,
    reason: string | null = null,
  ) =>
    repo.addModLog({
      id: newId(),
      actorId,
      action,
      targetType,
      targetId,
      reason,
    });

  /** The thread to act on. Staff can still open a removed one, and nothing more is done to it. */
  async function standing(c: Context<Env>): Promise<Thread> {
    const thread = await find.thread(c.req.param("id")!, c.var.userId!);
    if (thread.status === "removed")
      fail(404, "not_found", "That thread has been removed.");
    return thread;
  }

  /** The thread as the caller now sees it, which is what every thread action answers with. */
  const answer = async (c: Context<Env>, id: string) =>
    c.json(await find.thread(id, c.var.userId!));

  /** A body is optional here: no body at all reads as an empty one. */
  async function readJsonIfAny(c: Context<Env>): Promise<unknown> {
    return (await c.req.text()).trim() ? readJson(c) : {};
  }

  // ---- threads ------------------------------------------------------------

  for (const [action, pinned] of [
    ["pin", true],
    ["unpin", false],
  ] as const)
    r.post(`/threads/:id/${action}`, requireAuth, staffOnly, async (c) => {
      const thread = await standing(c);
      await repo.setThreadPinned(thread.id, pinned);
      await log(c.var.userId!, action, "thread", thread.id);
      return answer(c, thread.id);
    });

  r.post("/threads/:id/lock", requireAuth, staffOnly, jsonBody, async (c) => {
    const thread = await standing(c);
    const { reason } = lockInputSchema.parse(await readJson(c));
    await repo.setThreadStatus(thread.id, "locked", reason);
    await log(c.var.userId!, "lock", "thread", thread.id, reason);
    return answer(c, thread.id);
  });

  r.post("/threads/:id/unlock", requireAuth, staffOnly, async (c) => {
    const thread = await standing(c);
    await repo.setThreadStatus(thread.id, "open", null);
    await log(c.var.userId!, "unlock", "thread", thread.id);
    return answer(c, thread.id);
  });

  // Soft, as a message's removal is: the rows stay, and only staff still see them.
  r.post("/threads/:id/remove", requireAuth, staffOnly, jsonBody, async (c) => {
    const thread = await standing(c);
    const { reason } = removeInputSchema.parse(await readJsonIfAny(c));
    await repo.setThreadStatus(thread.id, "removed", null);
    await log(c.var.userId!, "remove", "thread", thread.id, reason ?? null);
    // Whoever has it open hears that its opening post went, as when an author removes their own.
    const opening = await repo.listMessages(
      thread.id,
      { before: 1, limit: 1 },
      c.var.userId!,
    );
    if (opening?.items[0]) await announce(hub, "remove", opening.items[0]);
    return answer(c, thread.id);
  });

  // ---- members ------------------------------------------------------------

  r.put("/users/:id/suspend", requireAuth, staffOnly, jsonBody, async (c) => {
    const id = c.req.param("id");
    const { until } = suspendInputSchema.parse(await readJson(c));
    if (until && Date.parse(until) <= now().getTime())
      fail(400, "invalid", "Suspend until a moment that is still to come.", {
        until,
      });
    const target = USER_ID_PATTERN.test(id)
      ? await people.users.getUser(id)
      : null;
    if (!target) fail(404, "not_found", "There is no such member.");
    // A suspended account can write nothing, this route included, so staff could never lift their own.
    if (target.role === "staff")
      fail(403, "forbidden", "Someone on the site's team cannot be suspended.");
    const user = await people.users.setSuspendedUntil(
      target.id,
      until ? new Date(until) : null,
    );
    if (!user) fail(404, "not_found", "There is no such member.");
    await log(
      c.var.userId!,
      until ? "suspend" : "unsuspend",
      "user",
      user.id,
      until ? `Until ${user.suspendedUntil}` : null,
    );
    // Not the whole row: it holds contact details, which are nobody else's to read.
    return c.json({ id: user.id, suspendedUntil: user.suspendedUntil });
  });
}
