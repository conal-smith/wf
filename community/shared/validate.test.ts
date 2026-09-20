import { describe, expect, it } from "vitest";
import { LIMITS, REACTIONS } from "./types";
import {
  ID_SHAPE,
  decodeCursor,
  encodeCursor,
  isReaction,
  mentionIds,
  messageEditSchema,
  messageInputSchema,
  slugifyTitle,
  threadInputSchema,
} from "./validate";
import { ID_PATTERN, newId } from "../../market/api/src/ids";

const TAG = "0123456789abcdef";

describe("constants", () => {
  it("carries the limits the plan fixed", () => {
    expect(LIMITS).toEqual({
      titleMax: 120,
      bodyMax: 5000,
      photosPerMessage: 4,
      tagsPerThread: 3,
      mentionsPerMessage: 5,
      editWindowMin: 30,
      pageSize: 30,
    });
  });

  it("offers twelve distinct reactions and nothing else", () => {
    expect(REACTIONS).toHaveLength(12);
    expect(new Set(REACTIONS).size).toBe(12);
    expect(isReaction("🤙")).toBe(true);
    expect(isReaction("🦄")).toBe(false);
    expect(isReaction("")).toBe(false);
  });

  it("agrees with the API on what an id looks like", () => {
    expect(ID_SHAPE.source).toBe(ID_PATTERN.source);
    expect(ID_SHAPE.test(newId())).toBe(true);
  });
});

describe("cursor", () => {
  const cursor = { lastMessageAt: "2026-09-20T10:00:00.123Z", id: newId() };

  it("round-trips, with and without the pinned flag", () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    for (const pinned of [true, false])
      expect(decodeCursor(encodeCursor({ ...cursor, pinned }))).toEqual({
        ...cursor,
        pinned,
      });
  });

  it("is safe to put in a query string", () => {
    expect(encodeCursor(cursor)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("answers null for anything it did not make", () => {
    const b64 = (v: unknown) => btoa(JSON.stringify(v));
    for (const text of [
      "",
      "not a cursor",
      "%%%",
      b64({}),
      b64({ t: "yesterday", i: cursor.id }),
      b64({ t: cursor.lastMessageAt, i: "'; drop table users; --" }),
      b64({ t: cursor.lastMessageAt, i: cursor.id, p: 2 }),
      b64([1, 2, 3]),
    ])
      expect(decodeCursor(text)).toBeNull();
  });
});

describe("mentions", () => {
  it("finds each mentioned id once, in order of appearance", () => {
    expect(
      mentionIds("Hi <@user_2abc> and <@dev_cian>, and <@user_2abc> again"),
    ).toEqual(["user_2abc", "dev_cian"]);
    expect(mentionIds("no one here, not even <@> or <@ spaced>")).toEqual([]);
  });
});

describe("thread input", () => {
  const valid = {
    title: "5m or 6m for Dublin Bay?",
    body: "82 kg, 95 L board.",
  };

  it("fills in what a plain thread leaves out", () => {
    expect(threadInputSchema.parse(valid)).toEqual({
      ...valid,
      tagIds: [],
      photoKeys: [],
    });
  });

  it("trims, and refuses a title or body that is empty once trimmed", () => {
    expect(
      threadInputSchema.parse({ ...valid, title: "  Wing size  " }).title,
    ).toBe("Wing size");
    expect(
      threadInputSchema.safeParse({ ...valid, title: "   " }).success,
    ).toBe(false);
    expect(
      threadInputSchema.safeParse({ ...valid, body: " \n " }).success,
    ).toBe(false);
  });

  it("holds the title, body, tag, photo and mention limits", () => {
    const ok = (extra: object) =>
      threadInputSchema.safeParse({ ...valid, ...extra }).success;
    expect(ok({ title: "t".repeat(LIMITS.titleMax) })).toBe(true);
    expect(ok({ title: "t".repeat(LIMITS.titleMax + 1) })).toBe(false);
    expect(ok({ body: "b".repeat(LIMITS.bodyMax) })).toBe(true);
    expect(ok({ body: "b".repeat(LIMITS.bodyMax + 1) })).toBe(false);

    const tags = [newId(), newId(), newId(), newId()];
    expect(ok({ tagIds: tags.slice(0, LIMITS.tagsPerThread) })).toBe(true);
    expect(ok({ tagIds: tags })).toBe(false);
    expect(ok({ tagIds: [TAG, TAG] })).toBe(false);
    expect(ok({ tagIds: ["nope"] })).toBe(false);

    const keys = ["a", "b", "c", "d", "e"].map((k) => `community/u/${k}.jpg`);
    expect(ok({ photoKeys: keys.slice(0, LIMITS.photosPerMessage) })).toBe(
      true,
    );
    expect(ok({ photoKeys: keys })).toBe(false);

    const mention = (n: number) =>
      Array.from({ length: n }, (_, i) => `<@user_${i}>`).join(" ");
    expect(ok({ body: mention(LIMITS.mentionsPerMessage) })).toBe(true);
    expect(ok({ body: mention(LIMITS.mentionsPerMessage + 1) })).toBe(false);
  });
});

describe("message input", () => {
  it("takes a body, an optional reply target and photos", () => {
    expect(messageInputSchema.parse({ body: " Agreed. " })).toEqual({
      body: "Agreed.",
      photoKeys: [],
    });
    const replyToId = newId();
    expect(messageInputSchema.parse({ body: "Yes", replyToId }).replyToId).toBe(
      replyToId,
    );
    expect(
      messageInputSchema.safeParse({ body: "Yes", replyToId: "1" }).success,
    ).toBe(false);
    expect(messageInputSchema.safeParse({ body: "" }).success).toBe(false);
  });

  it("an edit is the body alone", () => {
    expect(
      messageEditSchema.parse({ body: "Better", photoKeys: ["x"] }),
    ).toEqual({
      body: "Better",
    });
  });
});

describe("slugifyTitle", () => {
  it("makes the decoration for a thread's URL", () => {
    expect(slugifyTitle("5m or 6m as a one-wing quiver?")).toBe(
      "5m-or-6m-as-a-one-wing-quiver",
    );
    expect(slugifyTitle("Seán's first gybes — Trá Mhór")).toBe(
      "sean-s-first-gybes-tra-mhor",
    );
    expect(slugifyTitle("???")).toBe("thread");
    expect(slugifyTitle("word ".repeat(40)).length).toBeLessThanOrEqual(60);
    expect(slugifyTitle("word ".repeat(40))).not.toMatch(/-$/);
  });
});
