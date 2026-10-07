import { describe, expect, it } from "vitest";
import type {
  Member,
  Message,
  MessagePage,
  Thread,
  ThreadView,
} from "../shared/types";
import {
  ago,
  applyMention,
  arrivedSince,
  canDelete,
  canEdit,
  dayLabel,
  decodeMentions,
  encodeMentions,
  entryOf,
  findBySeq,
  firstLine,
  headMeta,
  mentionMatches,
  mentionQuery,
  keepRanges,
  messageTime,
  newestSeq,
  owesRead,
  peopleOf,
  sendsOnEnter,
  startStream,
  streamRows,
  withMessages,
  withPage,
} from "./thread";
import { headAfter } from "./useThread";

/**
 * The thread page's arithmetic. Times are built from local parts, so what is
 * asserted does not depend on the zone the suite runs in.
 */

const member = (name: string, role: Member["role"] = "member"): Member => ({
  id: `dev_${name.toLowerCase().replace(/\s+/g, "-")}`,
  handle: name.toLowerCase().replace(/\s+/g, "-"),
  displayName: name,
  avatarUrl: null,
  role,
});

const aoife = member("Aoife K");
const cian = member("Cian M");
const niamh = member("Niamh R");

/** Thursday 17 September 2026, 19:42, wherever the suite runs. */
const at = (day: number, hour = 12, minute = 0) =>
  new Date(2026, 8, day, hour, minute).toISOString();
const NOW = new Date(2026, 8, 19, 9, 44);

const message = (seq: number, extra: Partial<Message> = {}): Message => ({
  id: `m${String(seq).padStart(15, "0")}`,
  threadId: "t000000000000001",
  seq,
  author: seq === 0 ? aoife : cian,
  body: `message ${seq}`,
  replyTo: null,
  reactions: {},
  status: "visible",
  editedAt: null,
  createdAt: at(17, 19, 42 + Math.min(seq, 17)),
  photos: [],
  mentions: [],
  ...extra,
});

const run = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => message(from + i));

const page = (
  from: number,
  to: number,
  flags: Partial<MessagePage> = {},
): MessagePage => ({
  items: run(from, to),
  hasOlder: from > 0,
  hasNewer: false,
  ...flags,
});

const thread = (extra: Partial<Thread> = {}): Thread => ({
  id: "t000000000000001",
  channel: { id: "c1", slug: "wings", name: "Wings" },
  author: aoife,
  title: "5m or 6m as a one-wing quiver?",
  slug: "5m-or-6m",
  spotId: null,
  status: "open",
  pinned: false,
  lockedReason: null,
  tags: [],
  lastSeq: 24,
  replyCount: 24,
  participantCount: 9,
  lastMessageAt: at(19, 9, 40),
  lastMessageBy: cian,
  createdAt: at(17, 19, 42),
  preview: null,
  participants: [cian, niamh],
  thumbnail: null,
  ...extra,
});

const view = (
  messages: MessagePage,
  extra: Partial<Thread> = {},
): ThreadView => ({
  thread: thread(extra),
  opening: message(0),
  messages,
});

const seqs = (messages: readonly Message[]) => messages.map((m) => m.seq);

describe("S2, S3: the run of messages", () => {
  it("starts with the opening post apart from the replies", () => {
    const stream = startStream(view(page(0, 12, { hasNewer: true })));
    expect(stream.opening.seq).toBe(0);
    expect(seqs(stream.replies)).toEqual(run(1, 12).map((m) => m.seq));
    // Only the opening post is older, and it is always on the page.
    expect(stream.hasOlder).toBe(false);
    expect(stream.hasNewer).toBe(true);
  });

  it("around a last read, there is more either side", () => {
    const stream = startStream(view(page(40, 69, { hasNewer: true })));
    expect(stream.hasOlder).toBe(true);
    expect(stream.hasNewer).toBe(true);
  });

  it("a thread with no replies has nothing either side", () => {
    const stream = startStream(view(page(0, 0)));
    expect(stream.replies).toEqual([]);
    expect(stream.hasOlder).toBe(false);
    expect(stream.hasNewer).toBe(false);
  });

  it("an older page joins the top, a newer one the bottom, by cursor", () => {
    let stream = startStream(view(page(40, 69, { hasNewer: true })));
    stream = withPage(stream, page(10, 39), "older");
    expect(seqs(stream.replies)[0]).toBe(10);
    expect(stream.hasOlder).toBe(true);
    expect(stream.hasNewer).toBe(true);
    stream = withPage(stream, page(0, 9), "older");
    expect(seqs(stream.replies)[0]).toBe(1);
    expect(stream.hasOlder).toBe(false);
    stream = withPage(stream, page(70, 80), "newer");
    expect(seqs(stream.replies).at(-1)).toBe(80);
    expect(stream.hasNewer).toBe(false);
    // One unbroken run, each message once.
    expect(seqs(stream.replies)).toEqual(run(1, 80).map((m) => m.seq));
  });

  it("a page that overlaps the run adds nothing twice", () => {
    let stream = startStream(view(page(40, 69)));
    stream = withPage(stream, page(30, 45), "older");
    expect(seqs(stream.replies)).toEqual(run(30, 69).map((m) => m.seq));
  });

  it("a jump puts a page in place of the run", () => {
    let stream = startStream(view(page(40, 69)));
    stream = withPage(stream, page(1, 30, { hasNewer: true }), "replace");
    expect(seqs(stream.replies)).toEqual(run(1, 30).map((m) => m.seq));
    expect(stream.hasOlder).toBe(false);
    expect(stream.hasNewer).toBe(true);
    expect(findBySeq(stream, 12)?.seq).toBe(12);
    expect(findBySeq(stream, 0)).toBe(stream.opening);
    expect(findBySeq(stream, 31)).toBeNull();
  });
});

describe("S10: live messages", () => {
  it("a new message joins the end of a run that reaches the end", () => {
    let stream = startStream(view(page(0, 24)));
    stream = withMessages(stream, [message(25), message(26)]);
    expect(seqs(stream.replies).slice(-2)).toEqual([25, 26]);
    expect(stream.beyond).toEqual([]);
  });

  it("the same message twice is one message, as it last was", () => {
    let stream = startStream(view(page(0, 24)));
    stream = withMessages(stream, [message(25)]);
    stream = withMessages(stream, [message(25, { body: "edited" })]);
    expect(seqs(stream.replies).filter((s) => s === 25)).toEqual([25]);
    expect(findBySeq(stream, 25)?.body).toBe("edited");
  });

  it("past pages not loaded it waits, and joins when the run reaches the end", () => {
    let stream = startStream(
      view(page(0, 29, { hasNewer: true }), { lastSeq: 45 }),
    );
    stream = withMessages(stream, [message(46)]);
    expect(seqs(stream.replies).at(-1)).toBe(29);
    expect(seqs(stream.beyond)).toEqual([46]);
    expect(newestSeq(stream, thread({ lastSeq: 45 }))).toBe(46);
    // The page fetched before 46 was written, so it ends at 45.
    stream = withPage(stream, page(30, 45), "newer");
    expect(seqs(stream.replies)).toEqual(run(1, 46).map((m) => m.seq));
    expect(stream.beyond).toEqual([]);
  });

  it("a page that already holds what waited does not add it twice", () => {
    let stream = startStream(view(page(0, 29, { hasNewer: true })));
    stream = withMessages(stream, [message(46)]);
    stream = withPage(stream, page(30, 46), "newer");
    expect(seqs(stream.replies)).toEqual(run(1, 46).map((m) => m.seq));
  });

  it("a change heard in pages a jump to the end passes over leaves no hole", () => {
    let stream = startStream(
      view(page(0, 29, { hasNewer: true }), { lastSeq: 80 }),
    );
    // An edit to 40, which is on no page yet, then a new message.
    stream = withMessages(stream, [message(40, { body: "edited" })]);
    stream = withMessages(stream, [message(81)]);
    expect(seqs(stream.beyond)).toEqual([40, 81]);
    stream = withPage(stream, page(51, 80), "replace");
    expect(seqs(stream.replies)).toEqual(run(51, 81).map((m) => m.seq));
    expect(stream.hasOlder).toBe(true);
    expect(stream.beyond).toEqual([]);
  });

  it("fills a hole the viewer's own reply left behind it", () => {
    let stream = startStream(view(page(0, 24)));
    // Their reply came back as 26: someone else's 25 had not been heard yet.
    stream = withMessages(stream, [message(26, { author: aoife })]);
    stream = withMessages(stream, [
      message(25),
      message(26, { author: aoife }),
    ]);
    expect(seqs(stream.replies).slice(-3)).toEqual([24, 25, 26]);
  });

  it("an edit to the opening post replaces the card", () => {
    let stream = startStream(view(page(0, 5)));
    stream = withMessages(stream, [message(0, { body: "edited" })]);
    expect(stream.opening.body).toBe("edited");
    expect(seqs(stream.replies)).toEqual([1, 2, 3, 4, 5]);
  });

  it("a change to a message older than the run is left for its page", () => {
    let stream = startStream(view(page(40, 69)));
    stream = withMessages(stream, [message(3, { body: "edited" })]);
    expect(seqs(stream.replies)).toEqual(run(40, 69).map((m) => m.seq));
  });

  it("S5: a removal shows in place, and in the quoted line of a reply to it", () => {
    const target = message(3);
    const reply = message(4, {
      replyTo: {
        id: target.id,
        seq: 3,
        author: cian,
        excerpt: "message 3",
        removed: false,
      },
    });
    let stream = startStream(
      view({
        items: [message(0), message(1), message(2), target, reply],
        hasOlder: false,
        hasNewer: false,
      }),
    );
    stream = withMessages(stream, [{ ...target, status: "removed", body: "" }]);
    expect(findBySeq(stream, 3)?.status).toBe("removed");
    expect(findBySeq(stream, 4)?.replyTo).toMatchObject({
      removed: true,
      excerpt: "",
    });
  });

  it("the head counts what arrived, once", () => {
    const head = thread({ lastSeq: 24, replyCount: 24 });
    const after = headAfter(head, [message(25), message(26)]);
    expect(after).toMatchObject({ lastSeq: 26, replyCount: 26 });
    // Heard again on the live stream after the viewer's own write put it there.
    expect(headAfter(after, [message(26)])).toBe(after);
    // An edit is not an arrival.
    expect(headAfter(after, [message(3, { body: "edited" })])).toBe(after);
  });

  it("the pill counts what came in past the newest the reader has seen", () => {
    expect(arrivedSince(27, 24, false)).toBe(3);
    // At the end of a run that reaches the end a message appends: no pill.
    expect(arrivedSince(27, 24, true)).toBe(0);
    expect(arrivedSince(24, 24, false)).toBe(0);
  });

  it("S3: a read is owed once per new seq, to a member with the newest in view", () => {
    expect(owesRead(true, true, 25, 24)).toBe(true);
    // A first visit has sent nothing, not even the opening post.
    expect(owesRead(true, true, 0, -1)).toBe(true);
    expect(owesRead(true, true, 25, 25)).toBe(false);
    expect(owesRead(true, false, 25, 24)).toBe(false);
    expect(owesRead(false, true, 25, 24)).toBe(false);
  });
});

describe("S2, S3: rows", () => {
  const replies = [
    message(1, { createdAt: at(17, 20, 5) }),
    message(2, { createdAt: at(17, 21, 30) }),
    message(3, { createdAt: at(19, 9, 12) }),
    message(4, { createdAt: at(19, 9, 40) }),
  ];
  const stream = { opening: message(0), replies };

  it("groups under day dividers, none for the opening post's own day", () => {
    const rows = streamRows(stream, { lastReadSeq: null, unread: 0 }, NOW);
    expect(rows.map((r) => (r.t === "message" ? r.message.seq : r.t))).toEqual([
      1,
      2,
      "day",
      3,
      4,
    ]);
    expect(rows[2]).toMatchObject({ t: "day", label: "Today" });
  });

  it("draws the new line above the first message the viewer had not read", () => {
    const rows = streamRows(stream, { lastReadSeq: 3, unread: 1 }, NOW);
    expect(rows.map((r) => (r.t === "message" ? r.message.seq : r.t))).toEqual([
      1,
      2,
      "day",
      3,
      "new",
      4,
    ]);
    expect(rows[4]).toMatchObject({ t: "new", count: 1 });
  });

  it("after a day divider when the two fall together", () => {
    const rows = streamRows(stream, { lastReadSeq: 2, unread: 2 }, NOW);
    expect(rows.map((r) => r.t)).toEqual([
      "message",
      "message",
      "day",
      "new",
      "message",
      "message",
    ]);
  });

  it("draws no line for a first visit, a signed-out reader, or nothing new", () => {
    for (const entry of [
      { lastReadSeq: null, unread: 4 },
      { lastReadSeq: 4, unread: 0 },
    ])
      expect(streamRows(stream, entry, NOW).some((r) => r.t === "new")).toBe(
        false,
      );
    expect(entryOf(thread())).toEqual({ lastReadSeq: null, unread: 0 });
    expect(entryOf(thread({ lastReadSeq: 20, unread: 4 }))).toEqual({
      lastReadSeq: 20,
      unread: 4,
    });
  });

  it("a run that starts mid-thread says its day at the top", () => {
    const rows = streamRows(
      { opening: message(0), replies: replies.slice(1) },
      { lastReadSeq: null, unread: 0 },
      NOW,
    );
    expect(rows[0]).toMatchObject({ t: "day", label: "Thursday" });
  });
});

describe("titles", () => {
  it("holds a range of figures together, and leaves other dashes alone", () => {
    const J = "\u2060";
    expect(keepRanges("Which wing size for 15–20 knots at 70 kg?")).toBe(
      `Which wing size for 15${J}–${J}20 knots at 70 kg?`,
    );
    expect(keepRanges("4.2-5 m")).toBe(`4.2${J}-${J}5 m`);
    expect(keepRanges("12 – 18 kn")).toBe("12\u00a0–\u00a018 kn");
    expect(keepRanges("One-wing quiver – any advice?")).toBe(
      "One-wing quiver – any advice?",
    );
  });
});

describe("time", () => {
  it("a message's time, long and short", () => {
    // Within the hour, as the lists say it, at both widths.
    expect(messageTime(at(19, 9, 44), NOW)).toEqual({
      long: "just now",
      short: "just now",
    });
    expect(messageTime(at(19, 9, 40), NOW)).toEqual({
      long: "4 min ago",
      short: "4 min ago",
    });
    expect(messageTime(at(19, 9, 43), NOW).long).toBe("1 min ago");
    expect(messageTime(at(19, 7, 5), NOW)).toEqual({
      long: "07:05",
      short: "07:05",
    });
    expect(messageTime(at(18, 23, 50), NOW).long).toBe("Yesterday at 23:50");
    expect(messageTime(at(17, 19, 42), NOW)).toEqual({
      long: "Thursday at 19:42",
      short: "Thu 19:42",
    });
    expect(messageTime(at(2, 8, 0), NOW)).toEqual({
      long: "2 September at 08:00",
      short: "2 Sep",
    });
    expect(
      messageTime(new Date(2025, 11, 24, 8, 0).toISOString(), NOW).long,
    ).toBe("24 December 2025 at 08:00");
  });

  it("a day divider", () => {
    expect(dayLabel(at(19, 0, 1), NOW)).toBe("Today");
    expect(dayLabel(at(18, 23, 59), NOW)).toBe("Yesterday");
    expect(dayLabel(at(17), NOW)).toBe("Thursday");
    expect(dayLabel(at(12), NOW)).toBe("12 September");
    expect(dayLabel(new Date(2025, 11, 24).toISOString(), NOW)).toBe(
      "24 December 2025",
    );
  });

  it("how long ago, in the largest unit that fits", () => {
    expect(ago(at(19, 9, 44), NOW)).toBe("just now");
    expect(ago(at(19, 9, 40), NOW)).toBe("4 min ago");
    expect(ago(at(19, 8, 40), NOW)).toBe("1 h ago");
    expect(ago(at(17, 9, 0), NOW)).toBe("2 days ago");
    expect(ago(at(1), NOW)).toBe("2 weeks ago");
    expect(ago(new Date(2026, 5, 1).toISOString(), NOW)).toBe("3 months ago");
    expect(ago(new Date(2024, 5, 1).toISOString(), NOW)).toBe("2 years ago");
  });

  it("S1: the head's line", () => {
    expect(headMeta(thread({ createdAt: at(17, 9, 0) }), NOW)).toEqual({
      counts: "24 replies · 9 riders",
      started: "started 2 days ago",
    });
    expect(
      headMeta(thread({ replyCount: 1, participantCount: 1 }), NOW).counts,
    ).toBe("1 reply · 1 rider");
    expect(headMeta(thread({ replyCount: 0 }), NOW).counts).toBe(
      "No replies yet · 9 riders",
    );
  });
});

describe("S5: what a viewer may do", () => {
  const written = message(3, { author: aoife, createdAt: at(19, 9, 20) });
  const me = { id: aoife.id, staff: false };

  it("edits their own message for thirty minutes", () => {
    expect(canEdit(written, me, NOW)).toBe(true);
    expect(canEdit(written, me, new Date(2026, 8, 19, 9, 50))).toBe(true);
    expect(canEdit(written, me, new Date(2026, 8, 19, 9, 51))).toBe(false);
  });

  it("not someone else's, not a removed one, and not signed out", () => {
    expect(canEdit(written, { id: cian.id, staff: false }, NOW)).toBe(false);
    expect(canEdit(written, { id: cian.id, staff: true }, NOW)).toBe(false);
    expect(canEdit({ ...written, status: "removed" }, me, NOW)).toBe(false);
    expect(canEdit(written, { id: null, staff: false }, NOW)).toBe(false);
  });

  it("deletes their own at any age; staff delete anyone's", () => {
    const old = { ...written, createdAt: at(1) };
    expect(canDelete(old, me)).toBe(true);
    expect(canDelete(old, { id: cian.id, staff: false })).toBe(false);
    expect(canDelete(old, { id: cian.id, staff: true })).toBe(true);
    expect(canDelete({ ...old, status: "removed" }, me)).toBe(false);
    expect(canDelete(old, { id: null, staff: false })).toBe(false);
  });
});

describe("S8: mentions in the composer", () => {
  const tomas = member("Tomás B");
  const people = [aoife, cian, niamh];

  it("offers the thread's people: its author, then whoever wrote last, never the viewer", () => {
    const stream = {
      opening: message(0),
      replies: [
        message(1, { author: tomas }),
        message(2, { author: niamh, mentions: [member("Orla D")] }),
      ],
    };
    expect(
      peopleOf(thread({ participants: [cian] }), stream, niamh.id).map(
        (p) => p.displayName,
      ),
    ).toEqual(["Aoife K", "Cian M", "Tomás B", "Orla D"]);
  });

  it("finds the @word the caret is at the end of", () => {
    expect(mentionQuery("Not cowardly, @ao", 17)).toEqual({
      start: 14,
      query: "ao",
    });
    expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQuery("(@Ci", 4)).toEqual({ start: 1, query: "ci" });
    // An address is not a mention, and neither is a word the caret has left.
    expect(mentionQuery("mail a@b", 8)).toBeNull();
    expect(mentionQuery("@aoife hello", 12)).toBeNull();
    expect(mentionQuery("@aoife hello", 6)).toEqual({
      start: 0,
      query: "aoife",
    });
  });

  it("matches a handle or any word of a name, from its start", () => {
    expect(mentionMatches("", people)).toEqual(people);
    expect(mentionMatches("ci", people)).toEqual([cian]);
    expect(mentionMatches("r", people)).toEqual([niamh]);
    expect(mentionMatches("oife", people)).toEqual([]);
  });

  it("finishes the word as the handle and puts the caret after it", () => {
    expect(applyMention("Thanks @ci for that", 10, 7, "cian-m")).toEqual({
      text: "Thanks @cian-m for that",
      caret: 15,
    });
  });

  it("sends each known @handle as <@user_id>, and leaves the rest as typed", () => {
    expect(
      encodeMentions("@aoife-k and @cian-m, not @nobody or a@aoife-k.", people),
    ).toBe("<@dev_aoife-k> and <@dev_cian-m>, not @nobody or a@aoife-k.");
    expect(encodeMentions("thanks @aoife-k-", people)).toBe(
      "thanks <@dev_aoife-k>-",
    );
  });

  it("shows a stored body as it was typed, for an edit, and sends it back the same", () => {
    const body = "Not cowardly at all, <@dev_aoife-k>. Ask <@dev_gone>.";
    const shown = decodeMentions(body, [aoife]);
    expect(shown).toBe("Not cowardly at all, @aoife-k. Ask <@dev_gone>.");
    expect(encodeMentions(shown, [aoife])).toBe(body);
  });

  it("S8: the Replying to strip quotes the first line, as words", () => {
    expect(
      firstLine({
        body: "\n**Counterpoint**, <@dev_aoife-k>: weekends\nsecond line",
        mentions: [aoife],
      }),
    ).toBe("Counterpoint, @Aoife K: weekends");
  });
});

describe("S8: Enter sends on a desktop only", () => {
  const enter = { key: "Enter", shiftKey: false };
  it("Enter sends, Shift+Enter breaks", () => {
    expect(sendsOnEnter(enter, true)).toBe(true);
    expect(sendsOnEnter({ ...enter, shiftKey: true }, true)).toBe(false);
    expect(sendsOnEnter({ key: "a", shiftKey: false }, true)).toBe(false);
  });
  it("on a phone Enter is a line break", () => {
    expect(sendsOnEnter(enter, false)).toBe(false);
  });
  it("never while a character is still being composed", () => {
    expect(sendsOnEnter({ ...enter, isComposing: true }, true)).toBe(false);
  });
});
