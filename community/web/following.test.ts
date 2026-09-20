import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { User } from "../../site/shared/types";
import { isReservedHandle } from "../../site/shared/validate";
import { SEED_CATEGORIES, SEED_CHANNELS } from "../api/seed";
import {
  FOLLOW_REASONS,
  type Member,
  type MemberProfile,
  type MentionItem,
  type Message,
  type Notification,
  type Thread,
} from "../shared/types";
import { ApiRequestError, CommunityApi } from "./api";
import {
  BESIDE_THE_RAIL,
  bellStyles,
  focusAfterClose,
  opensPopover,
  POPOVER_ROWS,
  watchPopover,
  type ClosedBy,
  type PopoverEvent,
  type PopoverEvents,
  type Press,
} from "./components/Bell";
import {
  isUnread,
  kindLabel,
  lineParts,
  NotificationRow,
  NotificationRows,
  NotificationTools,
  rowTarget,
  whoParts,
} from "./components/NotificationRow";
import { ThreadRow, WHY } from "./components/ThreadRow";
import {
  appendItems,
  feedKey,
  loadFeed,
  markRows,
  railGroups,
  readRows,
  type ChannelsState,
  type FeedState,
  type MemberState,
  type PagedState,
} from "./hooks";
import { followedChannels } from "./pages/Following";
import { MentionRow, mentionText } from "./pages/Mentions";
import {
  checkProfile,
  draftOf,
  FollowSwitch,
  memberLine,
  profileInput,
  saveErrors,
} from "./pages/Profile";
import { ME, SETTINGS_ID, matchRoute, messageSeq, paths } from "./router";

/**
 * Following, Mentions, the bell and a member's profile. As in feed.test.ts
 * there is no DOM here: what is asked is what a reader is handed, and what the
 * plain functions under the hooks, the popover and the form decide.
 */

const html = (element: ReactElement) => renderToStaticMarkup(element);
const NOW = new Date("2026-09-20T12:00:00Z");
const minutesAgo = (n: number) =>
  new Date(NOW.getTime() - n * 60_000).toISOString();

const member = (name: string): Member => ({
  id: `user_${name.toLowerCase().replace(/\W+/g, "_")}`,
  handle: name.toLowerCase().replace(/\W+/g, "-"),
  displayName: name,
  avatarUrl: null,
  role: "member",
});

const aoife = member("Aoife K");
const cian = member("Cian M");
const niamh = member("Niamh R");
const tomas = member("Tomás B");

const thread = (id: string, extra: Partial<Thread> = {}): Thread => ({
  id,
  channel: { id: "ch_wings", slug: "wings", name: "Wings" },
  author: aoife,
  title: `Thread ${id}`,
  slug: `thread-${id}`,
  spotId: null,
  status: "open",
  pinned: false,
  lockedReason: null,
  tags: [],
  lastSeq: 0,
  replyCount: 0,
  participantCount: 1,
  lastMessageAt: minutesAgo(4),
  lastMessageBy: aoife,
  createdAt: minutesAgo(90),
  preview: { author: aoife, text: "I’m buying my first wing." },
  participants: [aoife],
  thumbnail: null,
  ...extra,
});

const QUIVER = {
  id: "t1",
  slug: "5m-or-6m",
  title: "5m or 6m as a one-wing quiver…",
  channel: { id: "ch_wings", slug: "wings", name: "Wings" },
};

const note = (id: string, extra: Partial<Notification> = {}): Notification => ({
  id,
  kind: "reply",
  thread: QUIVER,
  messageId: `m_${id}`,
  seq: 7,
  actors: [tomas],
  actorCount: 1,
  count: 1,
  emoji: null,
  excerpt: null,
  readAt: null,
  createdAt: minutesAgo(30),
  updatedAt: minutesAgo(12),
  ...extra,
});

const message = (extra: Partial<Message> = {}): Message => ({
  id: "m_7",
  threadId: QUIVER.id,
  seq: 7,
  author: cian,
  body: `Not cowardly at all, <@${aoife.id}>.\n\nThe 5.5 is the most-ridden size.`,
  replyTo: null,
  reactions: {},
  status: "visible",
  editedAt: null,
  createdAt: minutesAgo(4),
  photos: [],
  mentions: [aoife],
  ...extra,
});

function answering(body: unknown, status = 200) {
  const fetched = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.doUnmock("./hooks");
});

const channelsReady: ChannelsState = {
  status: "ready",
  groups: railGroups(
    SEED_CATEGORIES,
    SEED_CHANNELS.map((channel) => ({
      ...channel,
      following: channel.slug === "wings" || channel.slug === "meetups",
    })),
  ),
  memberCount: 1284,
};

const readyFeed = (items: Thread[]): FeedState => ({
  status: "ready",
  items,
  nextCursor: null,
  more: { status: "idle" },
});

const readyRows = <T>(items: T[]): PagedState<T> => ({
  status: "ready",
  items,
  nextCursor: null,
  more: { status: "idle" },
});

/**
 * A page under the session a build would give it. No effect runs in static
 * markup, so a list is loading unless `hooks` says what it came to.
 */
async function pageAs(
  devUser: string | null,
  page: "Following" | "Mentions" | "Notifications" | "Profile",
  props: Record<string, unknown>,
  hooks: Record<string, unknown> = {},
) {
  vi.resetModules();
  vi.doMock("./hooks", async (original) => ({
    ...(await original<typeof import("./hooks")>()),
    ...hooks,
  }));
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
  vi.stubEnv("VITE_MARKET_DEV_USER", devUser ?? "");
  const { SiteAuthProvider } = await import("../../shared/web/auth");
  const pages = {
    Following: async () => (await import("./pages/Following")).Following,
    Mentions: async () => (await import("./pages/Mentions")).Mentions,
    Notifications: async () =>
      (await import("./pages/Notifications")).Notifications,
    Profile: async () => (await import("./pages/Profile")).Profile,
  };
  return html(
    createElement(SiteAuthProvider, {
      home: "/community",
      children: createElement((await pages[page]()) as never, props),
    }),
  );
}

const paged = (state: unknown) => () => ({
  state,
  reload: () => {},
  loadMore: () => {},
  change: () => {},
});

const bellOf =
  (state: unknown, failure: string | null = null) =>
  () => ({
    ...paged(state)(),
    failure,
    open: () => {},
    markAll: () => {},
  });

const filled = (out: string) =>
  [...out.matchAll(/<(a|button)\b[^>]*class="[^"]*bg-accent[^"]*"[^>]*>/g)].map(
    (m) => m[0],
  );

describe("S1: Following", () => {
  it("reads the following feed, by cursor", async () => {
    const fetched = answering({ items: [], nextCursor: null });
    const api = new CommunityApi(async () => "dev:aoife");
    await loadFeed(api, { kind: "following" }, null);
    await loadFeed(api, { kind: "following" }, "c2");
    expect(fetched.mock.calls.map((call) => call[0])).toEqual([
      "/api/community/feed?tab=following",
      "/api/community/feed?tab=following&cursor=c2",
    ]);
    expect(feedKey({ kind: "following" })).not.toBe(
      feedKey({ kind: "latest" }),
    );
  });

  it("says why each thread is there, in words for every reason the API has", () => {
    expect(Object.keys(WHY).sort()).toEqual([...FOLLOW_REASONS].sort());
    expect(WHY.started).toBe("You started this");
    expect(WHY.replied).toBe("You replied");
    expect(WHY.channel).toBe("You follow this channel");
    const row = (t: Thread) =>
      html(
        createElement(ThreadRow, { thread: t, showChannel: true, now: NOW }),
      );
    expect(row(thread("a", { why: "replied" }))).toMatch(
      /<svg [^>]*lucide-bell[^>]*>.*?<\/svg>You replied/,
    );
    const plain = row(thread("b"));
    for (const words of Object.values(WHY)) expect(plain).not.toContain(words);
  });

  it("lists the followed channels in the rail's order", () => {
    expect(followedChannels(channelsReady).map((c) => c.slug)).toEqual([
      "wings",
      "meetups",
    ]);
    expect(followedChannels({ status: "loading" })).toEqual([]);
  });

  it("is a title, the followed channels as pills with Manage, then the threads with their why", async () => {
    const out = await pageAs(
      "aoife",
      "Following",
      { channels: channelsReady, onFollowed: () => {} },
      {
        useThreadFeed: paged(
          readyFeed([
            thread("a", { why: "started" }),
            thread("b", { why: "channel" }),
          ]),
        ),
      },
    );
    expect(out).toMatch(/<h1 [^>]*>Following<\/h1>/);
    const pills = [
      ...out.matchAll(/<a href="(\/community\/c\/[^"]+)"[^>]*rounded-full/g),
    ].map((m) => m[1]);
    expect(pills.sort()).toEqual([
      "/community/c/meetups",
      "/community/c/wings",
    ]);
    expect(out).toMatch(/<button [^>]*>Manage<\/button>/);
    expect(out.indexOf("Manage")).toBeLessThan(out.indexOf("Thread a"));
    expect(out).toContain("You started this");
    expect(out).toContain("You follow this channel");
    // Quiet: the view's one filled action is the header's New thread.
    expect(filled(out)).toEqual([]);
  });

  it("with nothing followed, explains how following works", async () => {
    const none: ChannelsState = {
      status: "ready",
      groups: railGroups(SEED_CATEGORIES, SEED_CHANNELS),
      memberCount: 3,
    };
    const out = await pageAs(
      "aoife",
      "Following",
      { channels: none, onFollowed: () => {} },
      { useThreadFeed: paged(readyFeed([])) },
    );
    expect(out).toContain("Nothing followed yet");
    expect(out).toContain(
      "You follow a thread by starting it or replying to it, and a channel by choosing to.",
    );
    expect(out).toContain("None yet.");
    expect(out).not.toContain(">Manage<");
    expect(filled(out)).toEqual([]);
  });

  it("signed out, asks nothing of the API and offers sign-in", async () => {
    const asked = vi.fn(paged({ status: "loading" }));
    const out = await pageAs(
      null,
      "Following",
      { channels: channelsReady, onFollowed: () => {} },
      { useThreadFeed: asked },
    );
    expect(out).toMatch(/<h1 [^>]*>Following<\/h1>/);
    expect(out).toContain("Sign in to see what you follow");
    expect(asked).not.toHaveBeenCalled();
  });
});

describe("S2: Mentions", () => {
  it("reads the mentions feed, by cursor", async () => {
    const fetched = answering({ items: [], nextCursor: null });
    const api = new CommunityApi(async () => "dev:aoife");
    await api.mentions();
    await api.mentions("c2");
    expect(fetched.mock.calls.map((call) => call[0])).toEqual([
      "/api/community/feed?tab=mentions",
      "/api/community/feed?tab=mentions&cursor=c2",
    ]);
  });

  it("writes a message's words on one line, and never shows a raw token", () => {
    expect(mentionText(message())).toBe(
      "Not cowardly at all, @Aoife K. The 5.5 is the most-ridden size.",
    );
    expect(mentionText(message({ mentions: [] }))).toContain("@member.");
  });

  it("a row is one link to the message, inside its thread", () => {
    const item: MentionItem = { message: message(), thread: QUIVER };
    const out = html(createElement(MentionRow, { item, now: NOW }));
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).toMatch(/^<a href="\/community\/t\/t1\/5m-or-6m#m-7"/);
    expect(out).toContain("Cian M");
    expect(out).toContain(" mentioned you in ");
    expect(out).toContain(QUIVER.title);
    expect(out).toContain("4 min ago");
    expect(out).not.toContain("&lt;@");
  });

  it("lists them in the order the API sent: newest first", async () => {
    const items: MentionItem[] = [
      { message: message({ id: "m_new", seq: 9 }), thread: QUIVER },
      {
        message: message({ id: "m_old", seq: 2, createdAt: minutesAgo(900) }),
        thread: QUIVER,
      },
    ];
    const out = await pageAs(
      "aoife",
      "Mentions",
      {},
      { useMentions: paged(readyRows(items)) },
    );
    expect(out).toMatch(/<h1 [^>]*>Mentions<\/h1>/);
    expect(out.indexOf("#m-9")).toBeGreaterThan(-1);
    expect(out.indexOf("#m-9")).toBeLessThan(out.indexOf("#m-2"));
    expect(filled(out)).toEqual([]);
  });

  it("says so when there are none, and asks for sign-in when there is nobody", async () => {
    const none = await pageAs(
      "aoife",
      "Mentions",
      {},
      { useMentions: paged(readyRows([])) },
    );
    expect(none).toContain("No mentions yet");
    const out = await pageAs(null, "Mentions", {});
    expect(out).toContain("Sign in to see your mentions");
  });

  it("a message's URL names its seq, and the thread page reads it back", () => {
    expect(paths.message("t1", "slug", 7)).toBe("/community/t/t1/slug#m-7");
    expect(paths.message("t1", null, 0)).toBe("/community/t/t1#m-0");
    expect(paths.message("t1", "slug", null)).toBe("/community/t/t1/slug");
    expect(messageSeq("#m-7")).toBe(7);
    expect(messageSeq("#m-0")).toBe(0);
    expect(messageSeq("")).toBeNull();
    expect(messageSeq("#following-settings")).toBeNull();
    expect(messageSeq("#m-7x")).toBeNull();
  });
});

async function bellAs(unread: number, pathname = "/community") {
  vi.resetModules();
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
  vi.stubEnv("VITE_MARKET_DEV_USER", "aoife");
  const { SiteAuthProvider } = await import("../../shared/web/auth");
  const { Bell } = await import("./components/Bell");
  return html(
    createElement(SiteAuthProvider, {
      home: "/community",
      children: createElement(Bell, { unread, onUnread: () => {}, pathname }),
    }),
  );
}

const PLAIN: Press = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};

describe("S3: the bell", () => {
  it("carries the count as a badge and in its name, and neither at nought", async () => {
    const some = await bellAs(3);
    expect(some).toContain('aria-label="Notifications, 3 unread"');
    expect(some).toMatch(/>3<\/span>/);
    const none = await bellAs(0);
    expect(none).toContain('aria-label="Notifications"');
    expect(none).not.toMatch(/>0<\/span>/);
  });

  it("is a link to the notifications page: what a phone, or no script, gets", async () => {
    const out = await bellAs(3);
    expect(out).toMatch(/<a href="\/community\/notifications"/);
    // Closed until pressed, and on the server nothing says it opens anything.
    expect(out).not.toContain('role="dialog"');
    expect(matchRoute("/community/notifications")).toEqual({
      page: "notifications",
    });
  });

  it("says it is the current page on the notifications page", async () => {
    const out = await bellAs(0, "/community/notifications");
    expect(out).toContain('aria-current="page"');
  });

  it("opens the popover only beside the rail, off its own page, on a plain press", () => {
    expect(opensPopover(PLAIN, true, false)).toBe(true);
    // Below 900: the page.
    expect(opensPopover(PLAIN, false, false)).toBe(false);
    expect(opensPopover(PLAIN, true, true)).toBe(false);
    for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const)
      expect(opensPopover({ ...PLAIN, [key]: true }, true, false)).toBe(false);
    expect(opensPopover({ ...PLAIN, button: 1 }, true, false)).toBe(false);
  });

  it("asks the width the theme's rail breakpoint names: 900px", () => {
    const theme = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../ui/theme.css"),
      "utf8",
    );
    const rail = /--breakpoint-rail:\s*([^;]+);/.exec(theme)?.[1];
    expect(BESIDE_THE_RAIL).toBe(`(min-width: ${rail})`);
    expect(parseFloat(rail!) * 16).toBe(900);
    // And where it cannot be asked, the panel is not drawn below it either.
    expect(bellStyles().panel()).toContain("max-rail:hidden");
    expect(bellStyles().panel()).toContain("absolute");
    expect(bellStyles().panel()).toContain("right-0");
  });

  it("shows the newest few rows, and the way to the rest", () => {
    const rows = Array.from({ length: POPOVER_ROWS + 3 }, (_, i) =>
      note(`n${i}`),
    );
    const out = html(
      createElement(NotificationRows, {
        state: readyRows(rows),
        limit: POPOVER_ROWS,
        onOpen: () => {},
        onRetry: () => {},
        now: NOW,
      }),
    );
    expect(out.match(/<li>/g)).toHaveLength(POPOVER_ROWS);
  });
});

/** A `document` that holds its listeners, and says what is listening. */
function fakeEvents() {
  const listeners = new Map<string, Set<(event: PopoverEvent) => void>>();
  const events: PopoverEvents = {
    addEventListener: (type, listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
  };
  return {
    events,
    send: (type: "keydown" | "pointerdown", event: PopoverEvent) =>
      listeners.get(type)?.forEach((listener) => listener(event)),
    listening: () =>
      [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
}

describe("ACCEPT: the popover", () => {
  const bell = { contains: (node: never) => node === ("bell" as never) };
  const panel = { contains: (node: never) => node === ("row" as never) };

  it("Escape closes it, and the focus goes back to the bell", () => {
    const { events, send } = fakeEvents();
    const closed: ClosedBy[] = [];
    watchPopover(
      () => [bell, panel],
      (by) => closed.push(by),
      events,
    );
    send("keydown", { key: "a", target: "row" });
    expect(closed).toEqual([]);
    send("keydown", { key: "Escape", target: "row" });
    expect(closed).toEqual(["escape"]);

    const focus = vi.fn();
    focusAfterClose("escape", { isConnected: true, focus });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("a press outside closes it, and leaves the focus where the press put it", () => {
    const { events, send } = fakeEvents();
    const closed: ClosedBy[] = [];
    watchPopover(
      () => [bell, panel],
      (by) => closed.push(by),
      events,
    );
    // Inside the panel, and on the bell, whose own press is the toggle.
    send("pointerdown", { target: "row" });
    send("pointerdown", { target: "bell" });
    expect(closed).toEqual([]);
    send("pointerdown", { target: "the page" });
    expect(closed).toEqual(["outside"]);

    const focus = vi.fn();
    focusAfterClose("outside", { isConnected: true, focus });
    expect(focus).not.toHaveBeenCalled();
  });

  it("gives no focus to a bell that has left the page, and stops listening when told", () => {
    const focus = vi.fn();
    focusAfterClose("escape", { isConnected: false, focus });
    focusAfterClose("escape", null);
    expect(focus).not.toHaveBeenCalled();

    const { events, send, listening } = fakeEvents();
    const close = vi.fn();
    const stop = watchPopover(() => [bell, null], close, events);
    expect(listening()).toBe(2);
    stop();
    expect(listening()).toBe(0);
    send("keydown", { key: "Escape", target: "row" });
    expect(close).not.toHaveBeenCalled();
  });
});

describe("S4: a row of the bell", () => {
  const text = (row: Notification) =>
    lineParts(row)
      .map((part) => part.text)
      .join("");
  const drawn = (row: Notification) =>
    html(createElement(NotificationRow, { row, onOpen: () => {}, now: NOW }));

  it("names up to two people, and counts the rest", () => {
    const say = (actors: Member[], actorCount: number) =>
      whoParts({ actors, actorCount })
        .map((part) => part.text)
        .join("");
    expect(say([tomas], 1)).toBe("Tomás B");
    expect(say([tomas, niamh], 2)).toBe("Tomás B and Niamh R");
    expect(say([tomas, niamh, cian], 3)).toBe("Tomás B, Niamh R and 1 other");
    expect(say([tomas, niamh, cian], 5)).toBe("Tomás B, Niamh R and 3 others");
    expect(say([], 0)).toBe("Someone");
  });

  it("a reply row is grouped: two names, two faces, and N new replies", () => {
    const row = note("r", {
      actors: [tomas, niamh],
      actorCount: 2,
      count: 4,
    });
    expect(text(row)).toBe(
      "Tomás B and Niamh R replied in 5m or 6m as a one-wing quiver…",
    );
    expect(kindLabel(row)).toBe("4 new replies");
    expect(kindLabel({ ...row, count: 1 })).toBe("1 new reply");
    expect(kindLabel({ ...row, readAt: minutesAgo(1) })).toBe("4 replies");
    const out = drawn(row);
    expect(out).toMatch(/4 new replies · (<!-- -->)?<time [^>]*>12 min ago/);
    expect(out.match(/ring-card/g)).toHaveLength(2);
  });

  it("a mention stands alone, with the line that names the reader", () => {
    const row = note("m", {
      kind: "mention",
      actors: [cian],
      excerpt:
        "Not cowardly at all, @Aoife K. The 5.5 is the most-ridden size…",
    });
    expect(text(row)).toBe(
      "Cian M mentioned you in 5m or 6m as a one-wing quiver…",
    );
    const out = drawn(row);
    expect(out).toContain("Not cowardly at all, @Aoife K.");
    expect(out).toMatch(/class="[^"]*truncate[^"]*"/);
    expect(out).toContain("Mention · ");
    expect(out).toContain("lucide-at-sign");
  });

  it("a new thread in a followed channel names the channel", () => {
    const row = note("t", { kind: "thread", seq: 0 });
    expect(text(row)).toBe("Tomás B started 5m or 6m as a one-wing quiver…");
    expect(kindLabel(row)).toBe("Wings");
    expect(drawn(row)).toContain("lucide-hash");
  });

  it("a reaction is quiet: listed, never unread, no dot", () => {
    const row = note("e", { kind: "reaction", emoji: "🤙", readAt: null });
    expect(text(row)).toBe(
      "Tomás B reacted 🤙 to your message in 5m or 6m as a one-wing quiver…",
    );
    expect(isUnread(row)).toBe(false);
    expect(kindLabel(row)).toBeNull();
    const out = drawn(row);
    expect(out).not.toContain("Unread");
    expect(out).not.toContain("bg-accent");
    expect(out).not.toContain("bg-ground");
  });

  it("a report is a row like the rest: the API sends one to staff alone", () => {
    const row = note("f", { kind: "report" });
    expect(text(row)).toBe(
      "Tomás B reported a message in 5m or 6m as a one-wing quiver…",
    );
    expect(kindLabel(row)).toBe("Report");
    expect(drawn(row)).toContain("lucide-flag");
  });

  it("unread is a dot, a tint and a word: never colour alone", () => {
    const unread = drawn(note("u"));
    expect(unread).toMatch(/^<a [^>]*class="[^"]*bg-ground/);
    expect(unread).toMatch(
      /<span class="[^"]*rounded-full bg-accent[^"]*"><span class="sr-only">Unread<\/span><\/span>/,
    );
    const read = drawn(note("u", { readAt: minutesAgo(1) }));
    expect(read).not.toMatch(/^<a [^>]*class="[^"]*bg-ground/);
    expect(read).not.toContain("Unread");
    expect(read).not.toContain("bg-accent");
  });

  it("stands in for the rows: loading, failed, and nothing new", () => {
    const rows = (state: PagedState<Notification>) =>
      html(
        createElement(NotificationRows, {
          state,
          onOpen: () => {},
          onRetry: () => {},
        }),
      );
    expect(rows({ status: "loading" })).toContain('aria-busy="true"');
    const failed = rows({ status: "error", message: "No luck." });
    expect(failed).toContain("No luck.");
    expect(failed).toMatch(/<button [^>]*>Try again<\/button>/);
    expect(rows(readyRows([]))).toContain("Nothing new.");
  });
});

describe("S5: opening, marking read, and the settings", () => {
  it("a row is one link to the message it is about", () => {
    expect(rowTarget(note("a", { seq: 12 }))).toBe(
      "/community/t/t1/5m-or-6m#m-12",
    );
    // A row with no message lands on the thread; with no thread, stays put.
    expect(rowTarget(note("a", { seq: null }))).toBe(
      "/community/t/t1/5m-or-6m",
    );
    expect(rowTarget(note("a", { thread: null }))).toBe(
      "/community/notifications",
    );
    const out = html(
      createElement(NotificationRow, {
        row: note("a", { seq: 12 }),
        onOpen: () => {},
        now: NOW,
      }),
    );
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).toMatch(/^<a href="\/community\/t\/t1\/5m-or-6m#m-12"/);
  });

  it("marks the rows it is told to read, or with none named all of them", () => {
    const at = NOW.toISOString();
    const already = minutesAgo(50);
    const rows = [note("a"), note("b"), note("c", { readAt: already })];
    expect(readRows(rows, at, ["a"]).map((row) => row.readAt)).toEqual([
      at,
      null,
      already,
    ]);
    expect(readRows(rows, at).map((row) => row.readAt)).toEqual([
      at,
      at,
      already,
    ]);
    // The rows in hand are not written over: a refusal puts them back.
    expect(rows[0].readAt).toBeNull();
  });

  it("pressing a row is what opens it: the row is handed on, read or not", () => {
    const onOpen = vi.fn();
    const row = note("a", { seq: 12 });
    const link = NotificationRow({ row, onOpen, now: NOW });
    // A press that asks for a new tab: handed on all the same, and not followed here.
    link.props.onClick({ button: 0, metaKey: true, defaultPrevented: false });
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(row);
  });

  it("marks in hand first, then on the API, and the badge takes the answer", async () => {
    const at = NOW.toISOString();
    const steps: string[] = [];
    let rows = [note("a"), note("b")];
    const hands = {
      change: (rewrite: (was: Notification[]) => Notification[]) => {
        steps.push("in hand");
        rows = rewrite(rows);
      },
      onCount: vi.fn(),
      onRefused: vi.fn(),
    };
    const api = {
      markNotificationsRead: vi.fn(async () => {
        steps.push("api");
        return { count: 1 };
      }),
    };
    await markRows(api, ["a"], hands, at);
    expect(steps).toEqual(["in hand", "api"]);
    expect(rows.map((row) => row.readAt)).toEqual([at, null]);
    expect(api.markNotificationsRead).toHaveBeenCalledWith({ ids: ["a"] });
    expect(hands.onCount).toHaveBeenCalledExactlyOnceWith(1);

    await markRows(api, undefined, hands, at);
    expect(api.markNotificationsRead).toHaveBeenLastCalledWith({ all: true });
    expect(rows.map((row) => row.readAt)).toEqual([at, at]);
    expect(hands.onRefused).not.toHaveBeenCalled();
  });

  it("hands a refusal on, and leaves the badge alone", async () => {
    const refused = new Error("No luck.");
    const hands = { change: vi.fn(), onCount: vi.fn(), onRefused: vi.fn() };
    await markRows(
      { markNotificationsRead: async () => Promise.reject(refused) },
      ["a"],
      hands,
    );
    expect(hands.onRefused).toHaveBeenCalledExactlyOnceWith(refused);
    expect(hands.onCount).not.toHaveBeenCalled();
  });

  it("tells the API which, and takes the count it answers with", async () => {
    const fetched = answering({ count: 2 });
    const api = new CommunityApi(async () => "dev:aoife");
    expect(await api.markNotificationsRead({ ids: ["a"] })).toEqual({
      count: 2,
    });
    await api.markNotificationsRead({ all: true });
    const sent = fetched.mock.calls.map(([url, init]) => [
      url,
      init?.method,
      JSON.parse(String(init?.body)),
    ]);
    expect(sent).toEqual([
      ["/api/community/notifications/read", "PUT", { ids: ["a"] }],
      ["/api/community/notifications/read", "PUT", { all: true }],
    ]);
  });

  it("reads the bell's rows, by cursor", async () => {
    const fetched = answering({ items: [], nextCursor: null });
    const api = new CommunityApi(async () => "dev:aoife");
    await api.notifications();
    await api.notifications("c2");
    expect(fetched.mock.calls.map((call) => call[0])).toEqual([
      "/api/community/notifications",
      "/api/community/notifications?cursor=c2",
    ]);
  });

  it("a row the bell moved is not listed twice", () => {
    const first = appendItems<Notification>(
      { status: "loading" },
      { items: [note("a"), note("b")], nextCursor: "c2" },
      (row) => row.id,
    );
    const next = appendItems(
      first,
      { items: [note("b"), note("c")], nextCursor: null },
      (row) => row.id,
    );
    expect(next.status === "ready" && next.items.map((row) => row.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("offers Mark all read while something is unread, and the way to the setting", () => {
    const tools = (allRead: boolean) =>
      html(createElement(NotificationTools, { allRead, onMarkAll: () => {} }));
    expect(tools(false)).toMatch(
      /<button type="button" class="[^"]*">Mark all read/,
    );
    expect(tools(true)).toMatch(/<button [^>]*disabled=""[^>]*>Mark all read/);
    expect(tools(false)).toMatch(
      /<a href="\/community\/u\/me#following-settings"[^>]*aria-label="Notification settings"/,
    );
    expect(paths.settings()).toBe(`/community/u/${ME}#${SETTINGS_ID}`);
    expect(filled(tools(false))).toEqual([]);
  });

  it("the page is the same rows under a title, with the same tools", async () => {
    const out = await pageAs(
      "aoife",
      "Notifications",
      { unread: 1, onUnread: () => {} },
      {
        useBell: bellOf(readyRows([note("a"), note("b", { kind: "mention" })])),
      },
    );
    expect(out).toMatch(/<h1 [^>]*>Notifications<\/h1>/);
    expect(out).toContain("Mark all read");
    expect(out).toContain('aria-label="Notification settings"');
    expect(out.match(/<li>/g)).toHaveLength(2);
    expect(filled(out)).toEqual([]);
  });

  it("the page says when marking all read failed, and asks for sign-in when there is nobody", async () => {
    const failed = await pageAs(
      "aoife",
      "Notifications",
      { unread: 1, onUnread: () => {} },
      {
        useBell: bellOf(
          readyRows([note("a")]),
          "That did not work. Try again.",
        ),
      },
    );
    expect(failed).toContain("That did not work. Try again.");
    const out = await pageAs(null, "Notifications", {
      unread: 0,
      onUnread: () => {},
    });
    expect(out).toMatch(/<h1 [^>]*>Notifications<\/h1>/);
    expect(out).toContain("Sign in to see your notifications");
  });
});

const profile: MemberProfile = {
  ...aoife,
  id: "dev_aoife",
  handle: "aoife-k",
  county: "Dublin",
  bio: "Dollymount most evenings.\n82 kg, 95 L.",
  joinedAt: "2026-09-02T09:00:00Z",
};

const user: User = {
  id: "dev_aoife",
  handle: "aoife-k",
  displayName: "Aoife K",
  avatarUrl: null,
  county: "Dublin",
  bio: "Dollymount most evenings.",
  role: "member",
  suspendedUntil: null,
  contactEmail: "aoife@example.com",
  contactPhone: "+353871234567",
  contactWhatsapp: true,
  autoFollow: true,
  createdAt: "2026-09-02T09:00:00Z",
  updatedAt: "2026-09-02T09:00:00Z",
};

const memberReady = (threads: Thread[]): MemberState => ({
  status: "ready",
  member: profile,
  threads: readyFeed(threads),
});

const memberOf = (state: MemberState) => () => ({
  state,
  reload: () => {},
  loadMore: () => {},
});

describe("S6: a member's profile", () => {
  it("reads a member by handle, and their threads by cursor", async () => {
    const fetched = answering({});
    const api = new CommunityApi(async () => "dev:aoife");
    await api.member("aoife-k");
    await api.member("aoife-k", "c2");
    expect(fetched.mock.calls.map((call) => call[0])).toEqual([
      "/api/community/members/aoife-k",
      "/api/community/members/aoife-k?cursor=c2",
    ]);
  });

  it("says the handle, the county and when they joined", () => {
    expect(memberLine(profile)).toBe(
      "@aoife-k · Dublin · Joined September 2026",
    );
    expect(memberLine({ ...profile, county: null })).toBe(
      "@aoife-k · Joined September 2026",
    );
  });

  it("is the face, name, handle, county, bio and the threads they started", async () => {
    const out = await pageAs(
      "cian",
      "Profile",
      { handle: "aoife-k" },
      { useMember: memberOf(memberReady([thread("a"), thread("b")])) },
    );
    expect(out).toMatch(/<h1 [^>]*>Aoife K<\/h1>/);
    expect(out).toContain("@aoife-k · Dublin · Joined September 2026");
    expect(out).toContain("Dollymount most evenings.");
    expect(out).toMatch(/<h2 [^>]*>Threads Aoife K started<\/h2>/);
    expect(out).toContain("Thread a");
    expect(out).toContain("Thread b");
    // Somebody else's: nothing of the owner's.
    expect(out).not.toContain("your settings");
    expect(out).not.toContain("Edit profile");
    expect(filled(out)).toEqual([]);
  });

  it("on your own, holds the place of the edit form and the switch", async () => {
    const own = await pageAs(
      "aoife",
      "Profile",
      { handle: "aoife-k" },
      { useMember: memberOf(memberReady([])) },
    );
    expect(own).toContain("Loading your settings…");
    expect(own).toMatch(/<h2 [^>]*>Threads you started<\/h2>/);
    expect(own).toContain("The threads you start are listed here.");
    const signedOut = await pageAs(
      null,
      "Profile",
      { handle: "aoife-k" },
      { useMember: memberOf(memberReady([])) },
    );
    expect(signedOut).not.toContain("your settings");
  });

  it("says when nobody has the handle, and when the profile could not be read", async () => {
    const missing = await pageAs(
      null,
      "Profile",
      { handle: "nobody" },
      { useMember: memberOf({ status: "missing" }) },
    );
    expect(missing).toContain("That member does not exist");
    const failed = await pageAs(
      null,
      "Profile",
      { handle: "aoife-k" },
      { useMember: memberOf({ status: "error", message: "No luck." }) },
    );
    expect(failed).toContain("No luck.");
    expect(failed).toMatch(/<button [^>]*>Try again<\/button>/);
  });

  it("`me` is whoever is asking, and nobody's handle", async () => {
    expect(matchRoute(`/community/u/${ME}`)).toEqual({
      page: "member",
      handle: ME,
    });
    // Too short to be one as well, and refused by name before that is asked.
    expect(isReservedHandle(ME)).toBe(true);
    expect(
      checkProfile(profileInput(user, { handle: ME })).handle,
    ).toBeTruthy();
    const asked = vi.fn(memberOf({ status: "loading" }));
    const signedOut = await pageAs(
      null,
      "Profile",
      { handle: ME },
      { useMember: asked },
    );
    expect(signedOut).toContain("Sign in to see your profile");
    const mine = await pageAs(
      "aoife",
      "Profile",
      { handle: ME },
      {
        useMember: asked,
      },
    );
    expect(mine).toContain("Loading your profile…");
    // Nobody is looked up under that name.
    expect(asked).not.toHaveBeenCalled();
  });

  it("the switch is a switch: a role, a state in words, and where the bell's link lands", () => {
    const on = html(
      createElement(FollowSwitch, { on: true, onChange: () => {} }),
    );
    expect(on).toMatch(
      new RegExp(
        `<button type="button" role="switch" id="${SETTINGS_ID}" aria-checked="true"`,
      ),
    );
    expect(on).toContain("Follow threads I start or reply to");
    expect(on).toMatch(/>On<span/);
    const off = html(
      createElement(FollowSwitch, { on: false, onChange: () => {} }),
    );
    expect(off).toContain('aria-checked="false"');
    expect(off).toMatch(/>Off<span/);
    // The thumb moves as well as the track filling: never colour alone.
    expect(on).toContain("translate-x-5");
    expect(off).not.toContain("translate-x-5");
  });

  it("sends the whole row back, so a change here resets nothing of the marketplace's", () => {
    expect(profileInput(user, { autoFollow: false })).toEqual({
      displayName: "Aoife K",
      handle: "aoife-k",
      county: "Dublin",
      bio: "Dollymount most evenings.",
      contactEmail: "aoife@example.com",
      contactPhone: "+353871234567",
      contactWhatsapp: true,
      autoFollow: false,
    });
    const edited = profileInput(user, {
      ...draftOf(user),
      displayName: "Aoife Kelly",
      county: null,
    });
    expect(edited.displayName).toBe("Aoife Kelly");
    expect(edited.county).toBeNull();
    expect(edited.contactPhone).toBe("+353871234567");
    expect(edited.autoFollow).toBe(true);
    expect(checkProfile(edited)).toEqual({});
  });

  it("saves through the site's PUT /api/me", async () => {
    const fetched = answering(user);
    const api = new CommunityApi(async () => "dev:aoife");
    await api.updateMe(profileInput(user, { autoFollow: false }));
    const [url, init] = fetched.mock.calls[0];
    expect(url).toBe("/api/me");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body)).autoFollow).toBe(false);
  });

  it("checks what the API will check, and puts a refusal under the field it names", () => {
    expect(checkProfile(profileInput(user, { displayName: "A" }))).toEqual({
      displayName: "Use a name of at least 2 characters",
    });
    expect(
      checkProfile(profileInput(user, { handle: "No Spaces" })).handle,
    ).toBeTruthy();
    const taken = new ApiRequestError(409, "conflict", "Handle taken", {
      handle: "That handle is taken",
    });
    expect(saveErrors(taken)).toEqual({
      fields: { handle: "That handle is taken" },
      top: null,
    });
    expect(saveErrors(new Error("The network is down."))).toEqual({
      fields: {},
      top: "The network is down.",
    });
    expect(saveErrors("?").top).toBe("That did not work. Try again.");
  });
});
