/**
 * The bell. It is the only way anything reaches a member: no email, no push.
 * The count is polled (on load, on focus, once a minute), the list is fetched
 * when the bell opens, and the rows themselves are written by the repo in the
 * transaction of whatever they are about.
 */
import {
  cursorOf,
  jsonBody,
  readJson,
  type CommunityDeps,
  type Router,
} from "./context.js";
import { notificationsReadSchema } from "../../shared/validate.js";
import { requireAuth } from "../../../market/api/src/auth.js";

export function notificationRoutes(r: Router, deps: CommunityDeps) {
  const { repo } = deps;

  // Reactions are in the list and never in this number.
  r.get("/notifications/count", requireAuth, async (c) =>
    c.json({ count: await repo.countNotifications(c.var.userId!) }),
  );

  r.get("/notifications", requireAuth, async (c) =>
    c.json(
      await repo.listNotifications(
        c.var.userId!,
        cursorOf(new URL(c.req.url).searchParams),
      ),
    ),
  );

  // Some rows by id, one thread's, or all of them. Answers with the new count.
  r.put("/notifications/read", requireAuth, jsonBody, async (c) => {
    const userId = c.var.userId!;
    const which = notificationsReadSchema.parse(await readJson(c));
    await repo.markNotificationsRead(userId, which);
    return c.json({ count: await repo.countNotifications(userId) });
  });
}
