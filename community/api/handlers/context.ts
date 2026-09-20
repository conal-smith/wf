/**
 * What the handler files share: the router's dependencies, the body limit,
 * and the lookups that turn a path parameter into a row or a 404.
 */
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Repo } from "../repo.js";
import type { Channel, Message, Thread } from "../../shared/types.js";
import type { AuthVariables } from "../../../market/api/src/auth.js";
import { fail } from "../../../market/api/src/errors.js";
import { ID_PATTERN } from "../../../market/api/src/ids.js";
import type { Storage } from "../../../market/api/src/storage.js";
import type { People } from "../../../site/api/users.js";

export interface CommunityDeps {
  repo: Repo;
  /** The site's `users` table and where a new row's name comes from. */
  people: People;
  storage: Storage;
  authMode: "clerk" | "dev";
  /** The clock the edit window is measured on. Tests move it. */
  now?: () => Date;
}

export type Env = { Variables: AuthVariables };
export type Router = Hono<Env>;

/** Photo keys are issued under this prefix, apart from the marketplace's. */
export const UPLOAD_PREFIX = "community";

const JSON_LIMIT = 64 * 1024;

/** On every route that reads a body. The refusal keeps the API's error shape. */
export const jsonBody = bodyLimit({
  maxSize: JSON_LIMIT,
  onError: (c) =>
    c.json(
      { error: "too_large", message: "That is too much to send at once." },
      413,
    ),
});

/** The request's JSON, or a 400 when it is not JSON at all. */
export async function readJson(c: Context<Env>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    fail(400, "invalid", "The request body must be JSON.");
  }
}

const SLUG_PATTERN = /^[a-z0-9-]{1,60}$/;

/** Each checks the parameter's shape before any query, and answers 404 for what the viewer may not see. */
export function lookups(repo: Repo) {
  return {
    async channel(slug: string, viewerId: string | null): Promise<Channel> {
      const channel = SLUG_PATTERN.test(slug)
        ? await repo.getChannel(slug, viewerId)
        : null;
      if (!channel) fail(404, "not_found", "There is no such channel.");
      return channel;
    },

    async thread(id: string, viewerId: string | null): Promise<Thread> {
      const thread = ID_PATTERN.test(id)
        ? await repo.getThread(id, viewerId)
        : null;
      if (!thread)
        fail(
          404,
          "not_found",
          "That thread does not exist or has been removed.",
        );
      return thread;
    },

    async message(id: string, viewerId: string | null): Promise<Message> {
      const message = ID_PATTERN.test(id)
        ? await repo.getMessage(id, viewerId)
        : null;
      if (!message)
        fail(
          404,
          "not_found",
          "That message does not exist or has been removed.",
        );
      return message;
    },
  };
}
