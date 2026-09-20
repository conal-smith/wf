/**
 * Reporting a message. The report is saved and lands in the bell of everyone
 * on the site's team, where it links to the message like any other row.
 * There is no queue and no email: staff act from the thread.
 */
import {
  jsonBody,
  lookups,
  readJson,
  type LiveDeps,
  type Router,
} from "./context.js";
import { dayStart, rateLimited, untilTomorrowMs } from "../limits.js";
import { LIMITS } from "../../shared/types.js";
import { reportInputSchema } from "../../shared/validate.js";
import { requireAuth } from "../../../market/api/src/auth.js";
import { fail } from "../../../market/api/src/errors.js";
import { newId } from "../../../market/api/src/ids.js";
import { ensureUser } from "../../../site/api/users.js";

export function reportRoutes(r: Router, deps: LiveDeps) {
  const { repo, people, limiter } = deps;
  const now = deps.now ?? (() => new Date());
  const find = lookups(repo);

  r.post("/messages/:id/report", requireAuth, jsonBody, async (c) => {
    const userId = c.var.userId!;
    const message = await find.message(c.req.param("id"), userId);
    if (message.status === "removed")
      fail(404, "not_found", "That message has been removed.");
    const input = reportInputSchema.parse(await readJson(c));
    // The bucket forgets on a restart; the table does not. See dayStart.
    if (
      (await repo.countReportsBy(userId, dayStart(now()))) >=
      LIMITS.reportsPerDay
    )
      rateLimited(
        untilTomorrowMs(now()),
        `That is ${LIMITS.reportsPerDay} reports today, which is the most anyone can send. You can report again tomorrow.`,
      );
    limiter.take(userId, "report");
    // The report's row names its reporter, so they need a row by now.
    await ensureUser(people, userId);
    const id = newId();
    await repo.addReport({
      id,
      reporterId: userId,
      messageId: message.id,
      reason: input.reason,
      note: input.note ?? null,
    });
    return c.json({ id }, 201);
  });
}
