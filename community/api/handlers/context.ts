/**
 * What the handler files share: the router's dependencies, the body limit,
 * and the lookups that turn a path parameter into a row or a 404.
 */
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Repo } from "../repo.js";
import {
  LIMITS,
  type Channel,
  type Message,
  type Thread,
  type ThreadCursor,
} from "../../shared/types.js";
import { decodeCursor } from "../../shared/validate.js";
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
  /** The clock the edit window and a member's newness are measured on. Tests move it. */
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

/** The `cursor` of a list's query, or null on its first page. One this API did not make is a 400, not an empty page. */
export function cursorOf(params: URLSearchParams): ThreadCursor | null {
  const text = params.get("cursor");
  if (!text) return null;
  const cursor = decodeCursor(text);
  if (!cursor)
    fail(400, "invalid", "That cursor is not one this API made.", {
      cursor: text,
    });
  return cursor;
}

/**
 * New is an account under a day old, or with fewer than three messages
 * standing. Someone with no row yet has written nothing, so they are new.
 * Staff are made by hand and never are.
 */
export async function isNewMember(
  deps: Pick<CommunityDeps, "repo" | "people">,
  userId: string,
  now: Date,
): Promise<boolean> {
  const user = await deps.people.users.getUser(userId);
  if (!user) return true;
  if (user.role === "staff") return false;
  const ageMs = now.getTime() - Date.parse(user.createdAt);
  if (ageMs < LIMITS.newMemberHours * 60 * 60 * 1000) return true;
  return (await deps.repo.countMessagesBy(userId)) < LIMITS.newMemberMessages;
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
