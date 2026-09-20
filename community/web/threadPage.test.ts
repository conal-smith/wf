import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  REACTIONS,
  type Member,
  type Message as MessageData,
  type Thread,
} from "../shared/types";
import { Composer, LockedNotice, SignInToReply } from "./components/Composer";
import { FOLLOW_CHOICES, followLabel } from "./components/FollowMenu";
import { Message, type MessageProps } from "./components/Message";
import { MessageStream } from "./components/MessageStream";
import {
  ReactionFaces,
  Reactions,
  reactionChips,
} from "./components/Reactions";
import { ThreadHead, ThreadPage } from "./pages/Thread";
import type { StreamRow, Viewer } from "./thread";

/**
 * The thread page's pieces, rendered to markup: there is no DOM under these
 * tests, so what is asked is what a reader is handed. What scrolls where, and
 * what a second browser sees, is a browser's question.
 */

const html = (element: ReactElement) => renderToStaticMarkup(element);
const count = (markup: string, needle: string) =>
  markup.split(needle).length - 1;

const member = (name: string, role: Member["role"] = "member"): Member => ({
  id: `dev_${name.toLowerCase().replace(/\s+/g, "-")}`,
  handle: name.toLowerCase().replace(/\s+/g, "-"),
  displayName: name,
  avatarUrl: null,
  role,
});
const aoife = member("Aoife K");
const cian = member("Cian M");

const NOW = new Date(2026, 8, 19, 9, 44);
const at = (day: number, hour: number, minute: number) =>
  new Date(2026, 8, day, hour, minute).toISOString();

const message = (extra: Partial<MessageData> = {}): MessageData => ({
  id: "m000000000000003",
  threadId: "t000000000000001",
  seq: 3,
  author: cian,
  body: "Fix the light days with a bigger foil, not a bigger wing.",
  replyTo: null,
  reactions: {},
  status: "visible",
  editedAt: null,
  createdAt: at(19, 9, 30),
  photos: [],
  mentions: [],
  ...extra,
});

const thread = (extra: Partial<Thread> = {}): Thread => ({
  id: "t000000000000001",
  channel: { id: "c1", slug: "wings", name: "Wings" },
  author: aoife,
  title: "5m or 6m as a one-wing quiver for Dublin Bay?",
  slug: "5m-or-6m",
  spotId: null,
  status: "open",
  pinned: false,
  lockedReason: null,
  tags: [
    { id: "tag1", label: "Question" },
    { id: "tag2", label: "Sizing" },
  ],
  lastSeq: 24,
  replyCount: 24,
  participantCount: 9,
  lastMessageAt: at(19, 9, 40),
  lastMessageBy: cian,
  createdAt: at(17, 9, 0),
  preview: null,
  participants: [cian],
  thumbnail: null,
  ...extra,
});

const nobody: Viewer = { id: null, staff: false };
const asAoife: Viewer = { id: aoife.id, staff: false };
const asStaff: Viewer = { id: "dev_staff", staff: true };

const noop = () => {};

const drawn = (props: Partial<MessageProps>) =>
  html(
    createElement(Message, {
      message: message(),
      startedBy: aoife.id,
      viewer: asAoife,
      now: NOW,
      onReply: noop,
      onReact: noop,
      onReport: noop,
      onEdit: async () => {},
      onDelete: noop,
      onJump: noop,
      ...props,
    }),
  );

const head = (extra: Partial<Thread>, viewer: Viewer, signedIn: boolean) =>
  html(
    createElement(ThreadHead, {
      thread: thread(extra),
      now: NOW,
      viewer,
      signedIn,
      working: false,
      onFollow: noop,
      onReport: noop,
      onPin: noop,
      onLock: noop,
      onRemove: noop,
    }),
  );

describe("S1: the head", () => {
  it("is the title, the tags and how busy the thread is", () => {
    const markup = head({}, asAoife, true);
    expect(markup).toMatch(
      /<h1[^>]*>5m or 6m as a one-wing quiver for Dublin Bay\?<\/h1>/,
    );
    expect(markup).toContain(">Question</span>");
    expect(markup).toContain(">Sizing</span>");
    expect(markup).toContain("24 replies · 9 riders");
    expect(markup).toContain("started 2 days ago");
  });

  it("the Following button says the level, and is pressed while following", () => {
    expect(followLabel("all")).toBe("Following · every reply");
    expect(followLabel("mentions")).toBe("Following · mentions only");
    expect(followLabel("none")).toBe("Not following");
    expect(followLabel(null)).toBe("Follow");
    expect(FOLLOW_CHOICES.map((c) => c.label)).toEqual([
      "Every reply",
      "Mentions only",
      "Nothing",
    ]);
    const following = head({ following: "all" }, asAoife, true);
    const button =
      /<button[^>]*>(?=(?:(?!<\/button>).)*Following · every reply)/s.exec(
        following,
      )?.[0];
    expect(button).toContain('aria-pressed="true"');
    expect(button).toContain('aria-expanded="false"');
    expect(head({ following: null }, asAoife, true)).not.toContain(
      'aria-pressed="true"',
    );
  });

  it("copies its link, and keeps More for someone with something to do", () => {
    // Their own thread, and not staff: nothing to report, nothing to moderate.
    const own = head({}, asAoife, true);
    expect(own).toContain('aria-label="Copy link"');
    expect(own).not.toContain('aria-label="More"');
    expect(head({}, { id: cian.id, staff: false }, true)).toContain(
      'aria-label="More"',
    );
    expect(head({}, asStaff, true)).toContain('aria-label="More"');
  });

  it("signed out there is nothing to follow with, and the link still copies", () => {
    const markup = head({}, nobody, false);
    expect(markup).not.toContain("Follow");
    expect(markup).not.toContain('aria-label="More"');
    expect(markup).toContain('aria-label="Copy link"');
  });

  it("says pinned and locked in words, with an icon, not in colour", () => {
    const markup = head({ pinned: true, status: "locked" }, asAoife, true);
    expect(markup).toContain("Pinned");
    expect(markup).toContain("Locked");
  });

  it("holds the column while the thread loads", () => {
    const markup = html(createElement(ThreadPage, { id: "t000000000000001" }));
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Loading the thread…");
  });
});

describe("S2: the opening post is the one card", () => {
  it("the opening post is a pane, a reply is not", () => {
    const opening = drawn({ message: message({ seq: 0 }), opening: true });
    const card = /<article[^>]*>/.exec(opening)?.[0];
    for (const name of ["bg-card", "border-line", "rounded-surface"])
      expect(card).toContain(name);
    expect(opening).toContain('id="m-0"');
    const reply = drawn({});
    expect(/<article[^>]*>/.exec(reply)?.[0]).not.toContain("border-line");
    expect(reply).toContain('id="m-3"');
  });

  it("the author's replies say they started the thread", () => {
    expect(drawn({ message: message({ author: aoife }) })).toContain(
      "Started the thread",
    );
    expect(drawn({})).not.toContain("Started the thread");
  });
});

describe("S4: reply-to", () => {
  const replyTo = {
    id: "m000000000000001",
    seq: 1,
    author: aoife,
    excerpt: "Do I get a 6m and accept being overpowered?",
    removed: false,
  };

  it("is a quoted line above the message: the author, then the first line", () => {
    const markup = drawn({ message: message({ replyTo }) });
    expect(markup).toMatch(
      /<a[^>]*href="#m-1"[^>]*>.*Aoife K.*Do I get a 6m and accept being overpowered\?.*<\/a>/s,
    );
    // Above: before the message's own words.
    expect(markup.indexOf('href="#m-1"')).toBeLessThan(
      markup.indexOf("Fix the light days"),
    );
  });

  it("a removed target is said, not quoted", () => {
    const markup = drawn({
      message: message({ replyTo: { ...replyTo, removed: true, excerpt: "" } }),
    });
    expect(markup).toContain("Removed message");
  });
});

describe("S5: message actions", () => {
  it("someone else's message: react, reply, report", () => {
    const markup = drawn({});
    expect(markup).toContain('role="toolbar"');
    for (const label of ["Add a reaction", "Reply to this message", "Report"])
      expect(markup).toContain(`aria-label="${label}"`);
    expect(markup).not.toContain('aria-label="Edit"');
    expect(markup).not.toContain('aria-label="Delete"');
  });

  it("their own: edit inside the window and delete, and nothing to report", () => {
    const own = message({ author: aoife, createdAt: at(19, 9, 20) });
    const markup = drawn({ message: own });
    expect(markup).toContain('aria-label="Edit"');
    expect(markup).toContain('aria-label="Delete"');
    expect(markup).not.toContain('aria-label="Report"');
    const old = drawn({ message: { ...own, createdAt: at(19, 9, 0) } });
    expect(old).not.toContain('aria-label="Edit"');
    expect(old).toContain('aria-label="Delete"');
  });

  it("staff delete anyone's", () => {
    expect(drawn({ viewer: asStaff })).toContain('aria-label="Delete"');
  });

  it("a locked thread takes no replies from a message either", () => {
    expect(drawn({ onReply: undefined })).not.toContain(
      "Reply to this message",
    );
  });

  it("an edited message says so", () => {
    expect(drawn({ message: message({ editedAt: at(19, 9, 35) }) })).toContain(
      "(edited)",
    );
    expect(drawn({})).not.toContain("(edited)");
  });

  it("a removed message renders as removed: no words, no actions", () => {
    const removed = message({
      status: "removed",
      body: "",
      reactions: { "👍": 2 },
    });
    const markup = drawn({ message: removed });
    expect(markup).toContain("This message was removed.");
    expect(markup).toContain("Cian M");
    expect(markup).not.toContain('role="toolbar"');
    expect(markup).not.toContain("👍");
  });

  it("staff are shown what it said, under the same label", () => {
    const markup = drawn({
      viewer: asStaff,
      message: message({ status: "removed", body: "what it said" }),
    });
    expect(markup).toContain("This message was removed.");
    expect(markup).toContain("what it said");
  });
});

describe("S6: reactions", () => {
  const reacted = message({
    reactions: { "🤙": 12, "👀": 3 },
    myReactions: ["🤙"],
  });

  it("chips with counts, in the list's order, only for what has any", () => {
    expect(reactionChips(reacted)).toEqual([
      { emoji: "🤙", count: 12, mine: true },
      { emoji: "👀", count: 3, mine: false },
    ]);
    expect(reactionChips(message())).toEqual([]);
  });

  it("yours is outlined and raised as well as filled, and pressed", () => {
    const markup = html(
      createElement(Reactions, { message: reacted, onReact: noop }),
    );
    const [mine, theirs] = [...markup.matchAll(/<button[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(mine).toContain('aria-pressed="true"');
    for (const name of ["border-accent", "bg-card", "shadow-control"])
      expect(mine).toContain(name);
    expect(theirs).toContain('aria-pressed="false"');
    expect(theirs).toContain("bg-sunken");
    expect(theirs).not.toContain("shadow-control");
    expect(markup).toContain("12");
  });

  it("draws nothing for a message nobody has reacted to", () => {
    expect(
      html(createElement(Reactions, { message: message(), onReact: noop })),
    ).toBe("");
  });

  it("the picker offers the twelve and nothing else", () => {
    const markup = html(
      createElement(ReactionFaces, { mine: ["🔥"], onReact: noop }),
    );
    const labels = [...markup.matchAll(/aria-label="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(labels).toEqual([...REACTIONS]);
    expect(count(markup, 'aria-pressed="true"')).toBe(1);
  });
});

describe("S2, S3: the stream", () => {
  const rows: StreamRow[] = [
    { t: "day", key: "day:1", label: "Today" },
    { t: "new", key: "new", count: 2 },
    { t: "message", key: "m1", message: message() },
  ];
  const stream = (hasOlder: boolean, hasNewer: boolean) =>
    html(
      createElement(MessageStream, {
        rows,
        hasOlder,
        hasNewer,
        loading: false,
        onOlder: noop,
        onNewer: noop,
        onEnd: noop,
        children: (m: MessageData) => createElement("p", { key: m.id }, m.body),
      }),
    );

  it("day dividers, the new line in words, then the messages", () => {
    const markup = stream(false, false);
    expect(markup).toContain("Today");
    expect(markup).toContain("2 new since you were last here");
    expect(markup.indexOf("2 new since")).toBeLessThan(
      markup.indexOf("Fix the light days"),
    );
    expect(markup).not.toContain("Show earlier replies");
    expect(markup).not.toContain("Show later replies");
  });

  it("offers the page either side, when there is one", () => {
    const markup = stream(true, true);
    expect(markup).toContain("Show earlier replies");
    expect(markup).toContain("Show later replies");
  });
});

describe("S8, S9, S11: the reply slot", () => {
  const composer = (replyingTo: MessageData | null) =>
    html(
      createElement(Composer, {
        people: [cian],
        replyingTo,
        onCancelReply: noop,
        onSend: async () => {},
        upload: async () => ({ key: "k", previewUrl: "blob:x" }),
      }),
    );

  it("Reply is the one filled action, beside photos and mentions", () => {
    const markup = composer(null);
    expect(markup).toMatch(/<textarea[^>]*placeholder="Reply to the thread…"/);
    expect(count(markup, "bg-accent ")).toBe(1);
    expect(markup).toMatch(
      /<button[^>]*type="submit"[^>]*bg-accent[^>]*>.*Reply/s,
    );
    expect(markup).toContain('aria-label="Add photos"');
    expect(markup).toContain('aria-label="Mention someone"');
    // Nothing to send yet.
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("says who is being replied to, with a way out of it", () => {
    const markup = composer(message());
    expect(markup).toContain("Replying to");
    expect(markup).toContain("Cian M");
    expect(markup).toContain("Fix the light days with a bigger foil");
    expect(markup).toContain('aria-label="Cancel replying to this message"');
  });

  it("signed out the slot is Sign in to reply", () => {
    const markup = html(createElement(SignInToReply));
    expect(markup).toContain("Sign in to reply");
    expect(markup).toContain("Reading is open to everyone.");
    expect(markup).not.toContain("<textarea");
    expect(count(markup, "bg-accent ")).toBe(1);
  });

  it("a locked thread shows the reason where the composer was", () => {
    const markup = html(
      createElement(LockedNotice, { reason: "Settled: see the pinned guide." }),
    );
    expect(markup).toContain("This thread is locked");
    expect(markup).toContain("Settled: see the pinned guide.");
    expect(markup).not.toContain("<textarea");
    expect(markup).not.toContain("bg-accent");
  });
});
