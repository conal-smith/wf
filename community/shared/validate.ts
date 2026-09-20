/**
 * Validation shared by the community API (authoritative) and the forms (for
 * immediate feedback), the same way the marketplace shares its listing schema.
 * The cursor codec lives here too, so both sides agree on what one looks like.
 */
import { z } from "zod";
import {
  FOLLOW_LEVELS,
  LIMITS,
  REACTIONS,
  type Reaction,
  type ThreadCursor,
} from "./types.js";
import { trimmed } from "../../site/shared/validate.js";

/** The shape of newId() in market/api/src/ids.ts, which cannot be imported into a browser. */
export const ID_SHAPE = /^[0-9a-hjkmnp-tv-z]{16}$/;

const id = z.string().regex(ID_SHAPE, "That is not an id");

/** A mention as stored in a body: <@user_id>, so a renamed member stays mentioned. */
export const MENTION_PATTERN = /<@([A-Za-z0-9_-]{1,64})>/g;

/** The distinct user ids a body mentions, in the order they first appear. */
export function mentionIds(body: string): string[] {
  const ids = new Set<string>();
  for (const match of body.matchAll(MENTION_PATTERN)) ids.add(match[1]);
  return [...ids];
}

export function isReaction(emoji: string): emoji is Reaction {
  return (REACTIONS as readonly string[]).includes(emoji);
}

const body = trimmed(LIMITS.bodyMax)
  .min(1, "Write something first")
  .refine((b) => mentionIds(b).length <= LIMITS.mentionsPerMessage, {
    message: `Mention ${LIMITS.mentionsPerMessage} people or fewer in one message`,
  });

const photoKeys = z
  .array(z.string().min(1).max(200))
  .max(
    LIMITS.photosPerMessage,
    `Attach ${LIMITS.photosPerMessage} photos or fewer`,
  )
  .default([]);

const distinct = (ids: string[]) => new Set(ids).size === ids.length;

export const threadInputSchema = z.object({
  title: trimmed(LIMITS.titleMax).min(
    4,
    "Give the thread a title of at least 4 characters",
  ),
  body,
  tagIds: z
    .array(id)
    .max(LIMITS.tagsPerThread, `Pick ${LIMITS.tagsPerThread} tags or fewer`)
    .refine(distinct, "Pick each tag once")
    .default([]),
  photoKeys,
  spotId: z.string().trim().min(1).max(80).nullable().optional(),
});

export type ThreadInputParsed = z.infer<typeof threadInputSchema>;

export const messageInputSchema = z.object({
  body,
  replyToId: id.nullable().optional(),
  photoKeys,
});

export type MessageInputParsed = z.infer<typeof messageInputSchema>;

/** PUT /messages/:id changes the words and nothing else. */
export const messageEditSchema = z.object({ body });

export type MessageEditParsed = z.infer<typeof messageEditSchema>;

export const reactionInputSchema = z.object({ on: z.boolean() });

/** PUT /threads/:id/follow. `none` mutes the thread; it does not forget it. */
export const threadFollowSchema = z.object({ level: z.enum(FOLLOW_LEVELS) });

export const channelFollowSchema = z.object({ on: z.boolean() });

/** PUT /threads/:id/read: the highest seq the reader has seen. */
export const readInputSchema = z.object({
  seq: z.number().int().min(0).max(999_999_999),
});

/** PUT /notifications/read: some rows by id, one thread's, or all of them. */
export const notificationsReadSchema = z.union([
  z.strictObject({ ids: z.array(id).min(1).max(100) }),
  z.strictObject({ threadId: id }),
  z.strictObject({ all: z.literal(true) }),
]);

/** A title as the decoration in a thread's URL: lowercase words joined by hyphens. */
export function slugifyTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "thread";
}

const cursorSchema = z.object({
  p: z.union([z.literal(0), z.literal(1)]).optional(),
  t: z.iso.datetime(),
  i: id,
});

/**
 * A cursor is the sort key of the last row a page showed, as base64url JSON.
 * Clients hand it back untouched; only the API reads inside it.
 */
export function encodeCursor(cursor: ThreadCursor): string {
  const json = JSON.stringify({
    ...(cursor.pinned === undefined ? {} : { p: cursor.pinned ? 1 : 0 }),
    t: cursor.lastMessageAt,
    i: cursor.id,
  });
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Null for anything that is not a cursor this API made. */
export function decodeCursor(text: string): ThreadCursor | null {
  try {
    const json = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = cursorSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return null;
    const { p, t, i } = parsed.data;
    return {
      ...(p === undefined ? {} : { pinned: p === 1 }),
      lastMessageAt: t,
      id: i,
    };
  } catch {
    return null;
  }
}
