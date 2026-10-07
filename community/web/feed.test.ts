import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEED_CATEGORIES, SEED_CHANNELS } from "../api/seed";
import {
  LIMITS,
  type Channel,
  type Member,
  type Thread,
  type ThreadInput,
  type ThreadPage,
} from "../shared/types";
import { CommunityApi } from "./api";
import { accentNewThread } from "./CommunityApp";
import {
  checkThread,
  fieldErrors,
  newThreadStep,
  newThreadStyles,
  postable,
  spotLabel,
  spotOptions,
  toggleTag,
} from "./components/NewThreadDialog";
import { currentTag, TagPills, tagPillsStyles } from "./components/TagPills";
import { ThreadList, watchNear } from "./components/ThreadList";
import {
  ago,
  freshOf,
  newCount,
  previewLine,
  ThreadRow,
  threadRowStyles,
} from "./components/ThreadRow";
import {
  appendPage,
  feedKey,
  findChannel,
  loadFeed,
  railGroups,
  type ChannelsState,
  type FeedState,
} from "./hooks";
import { canStartThread, countsLine } from "./pages/Channel";
import { MEMBERS_SHOWN_FROM, membersLine, newOnPage } from "./pages/Home";
import { matchRoute, paths, withoutNewThread } from "./router";

/**
 * The feed, the channel page and the new-thread dialog. As in shell.test.ts
 * there is no DOM here: what is asked is what a reader is handed, and what the
 * plain functions under the hooks and the form decide.
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

const wings = SEED_CHANNELS.find((c) => c.slug === "wings")!;
const announcements = SEED_CHANNELS.find((c) => c.slug === "announcements")!;

const ready = (
  items: Thread[],
  nextCursor: string | null = null,
): FeedState => ({
  status: "ready",
  items,
  nextCursor,
  more: { status: "idle" },
});

const list = (state: FeedState, extra: { pinnedLines?: boolean } = {}) =>
  html(
    createElement(ThreadList, {
      state,
      subject: "the latest threads",
      showChannel: true,
      onRetry: () => {},
      onMore: () => {},
      empty: createElement("p", null, "No threads yet"),
      now: NOW,
      ...extra,
    }),
  );

const row = (t: Thread, showChannel = true, pinnedLine = false) =>
  html(
    createElement(ThreadRow, { thread: t, showChannel, pinnedLine, now: NOW }),
  );

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
  vi.doUnmock("../../shared/web/images");
  vi.doUnmock("./hooks");
});

describe("S1: home", () => {
  it("shows the member count from 50 members, and not before", () => {
    expect(MEMBERS_SHOWN_FROM).toBe(50);
    expect(membersLine(null)).toBeNull();
    expect(membersLine(0)).toBeNull();
    expect(membersLine(49)).toBeNull();
    expect(membersLine(50)).toBe("50 members");
    expect(membersLine(1284)).toBe("1,284 members");
  });

  it("names the channel on each row, in its dateline", () => {
    const out = row(thread("a"));
    expect(out).toMatch(/<p class="[^"]*uppercase[^"]*">.*?>Wings<\/span>/);
    expect(row(thread("a"), false)).not.toContain(">Wings</span>");
  });

  it("reads the latest feed, a search and a channel's list, each by cursor", async () => {
    const api = new CommunityApi(async () => null);
    const fetched = answering({ items: [], nextCursor: null });
    await loadFeed(api, { kind: "latest" }, null);
    await loadFeed(api, { kind: "latest" }, "abc");
    await loadFeed(api, { kind: "search", q: "dublin bay" }, "abc");
    await loadFeed(api, { kind: "channel", slug: "wings", tagId: null }, null);
    await loadFeed(api, { kind: "channel", slug: "wings", tagId: "t1" }, "abc");
    expect(fetched.mock.calls.map(([url]) => url)).toEqual([
      "/api/community/feed?tab=latest",
      "/api/community/feed?tab=latest&cursor=abc",
      "/api/community/search?q=dublin+bay&cursor=abc",
      "/api/community/channels/wings/threads",
      "/api/community/channels/wings/threads?tag=t1&cursor=abc",
    ]);
  });

  it("starts a list again when what it lists changes, and only then", () => {
    const keys = [
      feedKey({ kind: "latest" }),
      feedKey({ kind: "search", q: "gybes" }),
      feedKey({ kind: "channel", slug: "wings", tagId: null }),
      feedKey({ kind: "channel", slug: "wings", tagId: "t1" }),
      feedKey({ kind: "channel", slug: "foils", tagId: null }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(feedKey({ kind: "channel", slug: "wings", tagId: "t1" })).toBe(
      keys[3],
    );
  });

  it("adds a page under the list, and never shows a thread twice", () => {
    const first = appendPage(
      { status: "loading" },
      { items: [thread("a"), thread("b")], nextCursor: "c1" },
    );
    expect(first).toMatchObject({ status: "ready", nextCursor: "c1" });
    // A reply moved "b" down into the next page while the reader was paging.
    const page: ThreadPage = {
      items: [thread("b"), thread("c")],
      nextCursor: null,
    };
    const second = appendPage(first, page);
    expect(second.status === "ready" && second.items.map((t) => t.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(second).toMatchObject({
      nextCursor: null,
      more: { status: "idle" },
    });
  });

  it("offers Load more while a cursor is left, and nothing after the last page", () => {
    expect(list(ready([thread("a")], "c1"))).toMatch(
      /<button type="button"[^>]*>Load more<\/button>/,
    );
    expect(list(ready([thread("a")]))).not.toContain("Load more");
    const loading = list({
      ...ready([thread("a")], "c1"),
      more: { status: "loading" },
    } as FeedState);
    expect(loading).toMatch(/<button type="button" disabled=""[^>]*>Loading…/);
    const failed = list({
      ...ready([thread("a")], "c1"),
      more: { status: "error", message: "More threads could not be loaded." },
    } as FeedState);
    expect(failed).toContain("More threads could not be loaded.");
    expect(failed).toMatch(/<button type="button"[^>]*>Try again<\/button>/);
  });

  it("asks for the next page as the end of the list nears, where a browser can watch", () => {
    const seen: { callback: IntersectionObserverCallback; margin?: string }[] =
      [];
    const observed: unknown[] = [];
    let disconnected = 0;
    class Watcher {
      constructor(
        callback: IntersectionObserverCallback,
        init?: IntersectionObserverInit,
      ) {
        seen.push({ callback, margin: init?.rootMargin });
      }
      observe(element: unknown) {
        observed.push(element);
      }
      disconnect() {
        disconnected++;
      }
    }
    const element = {} as Element;
    const onNear = vi.fn();
    const stop = watchNear(
      element,
      onNear,
      Watcher as unknown as typeof IntersectionObserver,
    )!;
    expect(observed).toEqual([element]);
    expect(seen[0].margin).toBe("0px 0px 600px 0px");
    const fire = (isIntersecting: boolean) =>
      seen[0].callback(
        [{ isIntersecting } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    fire(false);
    expect(onNear).not.toHaveBeenCalled();
    fire(true);
    expect(onNear).toHaveBeenCalledTimes(1);
    stop();
    expect(disconnected).toBe(1);
    // Without one the button is the way, and there is nothing to stop.
    expect(
      watchNear(
        element,
        onNear,
        null as unknown as typeof IntersectionObserver,
      ),
    ).toBeNull();
  });
});

describe("S2: a channel", () => {
  it("says its two counts", () => {
    expect(countsLine({ threadCount: 412, followerCount: 640 })).toBe(
      "412 threads · 640 followers",
    );
    expect(countsLine({ threadCount: 1, followerCount: 0 })).toBe(
      "1 thread · 0 followers",
    );
    expect(countsLine({ threadCount: 1, followerCount: 1 })).toBe(
      "1 thread · 1 follower",
    );
    expect(countsLine({ threadCount: 1200, followerCount: 3400 })).toBe(
      "1,200 threads · 3,400 followers",
    );
  });

  it("finds the open channel in what the rail loaded", () => {
    const state: ChannelsState = {
      status: "ready",
      groups: railGroups(SEED_CATEGORIES, SEED_CHANNELS),
      memberCount: null,
    };
    expect(findChannel(state, "wings")?.id).toBe(wings.id);
    expect(findChannel(state, "nowhere")).toBeNull();
    expect(findChannel({ status: "loading" }, "wings")).toBeNull();
  });

  it("filters by All plus the channel's tags, as links that keep the tag in the URL", () => {
    expect(wings.tags.length).toBeGreaterThan(1);
    const picked = wings.tags[1];
    const out = html(
      createElement(TagPills, {
        slug: "wings",
        tags: wings.tags,
        current: picked.id,
      }),
    );
    expect(out).toMatch(/^<nav aria-label="Filter by tag"[ >]/);
    const pills = [
      ...out.matchAll(/<a([^>]*)href="([^"]*)"([^>]*)>([^<]*)<\/a>/g),
    ].map(([, before, href, after, label]) => ({
      href,
      label,
      attributes: before + after,
    }));
    expect(pills.map((p) => p.label)).toEqual([
      "All",
      ...wings.tags.map((t) => t.label),
    ]);
    expect(pills[0].href).toBe("/community/c/wings");
    expect(pills[2].href).toBe(`/community/c/wings?tag=${picked.id}`);
    // The one that is on is said, and raised and filled: never colour alone.
    const on = pills.filter((p) => p.attributes.includes("aria-current"));
    expect(on.map((p) => p.label)).toEqual([picked.label]);
    expect(on[0].attributes).toContain("bg-inverse");
    expect(on[0].attributes).toContain("font-semibold");
  });

  it("draws no filter for a channel with no tags, and reads a stray tag as All", () => {
    expect(
      html(createElement(TagPills, { slug: "x", tags: [], current: null })),
    ).toBe("");
    expect(currentTag(wings.tags, "not-a-tag")).toBeNull();
    expect(currentTag(wings.tags, null)).toBeNull();
    expect(currentTag(wings.tags, wings.tags[0].id)).toBe(wings.tags[0]);
    expect(paths.channel("wings", null)).toBe("/community/c/wings");
  });

  it("draws a pinned thread as one quiet line at the head of its channel, and as a row elsewhere", () => {
    const pinned = thread("p", { pinned: true, title: "Read first" });
    const line = row(pinned, false, true);
    expect(line).toContain("lucide-pin");
    expect(line).toContain(">Pinned</span>");
    expect(line).not.toContain("<h2");
    expect(row(pinned, true, false)).toContain("<h2");
    // The order is the API's, pinned first: the list keeps it.
    const out = list(ready([pinned, thread("a")]), { pinnedLines: true });
    expect(out.indexOf("Read first")).toBeLessThan(out.indexOf("Thread a"));
  });

  it("follows and unfollows with a PUT that answers with the channel", async () => {
    const api = new CommunityApi(async () => "dev:aoife");
    const fetched = answering({ ...wings, following: true, followerCount: 1 });
    const reply = await api.followChannel("wings", true);
    expect(reply.followerCount).toBe(1);
    const [url, init] = fetched.mock.calls[0];
    expect(url).toBe("/api/community/channels/wings/follow");
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(JSON.stringify({ on: true }));
  });
});

describe("S3: a thread row", () => {
  const busy = thread("q", {
    title: "5m or 6m as a one-wing quiver?",
    tags: [
      { id: "t1", label: "Question" },
      { id: "t2", label: "Sizing" },
    ],
    replyCount: 24,
    lastSeq: 24,
    preview: { author: cian, text: "Not cowardly at all." },
    participants: [cian, niamh, tomas, aoife],
    unread: 2,
    thumbnail: { id: "ph1", url: "/uploads/a.jpg", width: 1600, height: 1200 },
  });

  it("is one link to the thread, a letter: the title as a heading, in the display face, and its author", () => {
    const out = row(busy);
    expect(out).toMatch(/^<a href="\/community\/t\/q\/thread-q"/);
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).toMatch(
      /<h2 class="[^"]*font-display[^"]*">.*5m or 6m as a one-wing quiver\?.*<\/h2>/,
    );
    expect(out).toMatch(/<span class="[^"]*font-display[^"]*">Aoife K<\/span>/);
    // A list of letters, not of faces: the byline names them.
    expect(out).not.toContain(">AK</span>");
  });

  it("says unread in weight, a dot and a count, and none of them when read", () => {
    const unread = row(busy);
    expect(unread).toMatch(/<h2 class="[^"]*font-semibold[^"]*"/);
    expect(unread).toMatch(/<span class="[^"]*bg-accent[^"]*" aria-hidden/);
    expect(unread).toContain("2 new");
    const read = row({ ...busy, unread: 0 });
    expect(read).toMatch(/<h2 class="[^"]*font-normal[^"]*"/);
    expect(read).not.toMatch(/<h2 class="[^"]*font-semibold/);
    expect(read).not.toContain("bg-accent");
    expect(read).not.toContain(" new<");
    // Signed out there is no unread to say.
    expect(row({ ...busy, unread: undefined })).not.toContain(" new<");
    expect(newCount(250)).toBe("99+ new");
  });

  it("counts what is new in the row's own units: a thread never opened is New", () => {
    // Never opened: the API's unread takes in the opening post, so "1 reply"
    // over "2 new" would say two things at once. It is a new thread.
    const unopened = thread("u", {
      replyCount: 1,
      lastSeq: 1,
      unread: 2,
      lastReadSeq: null,
    });
    expect(freshOf(unopened)).toEqual({ kind: "thread" });
    const out = row(unopened);
    expect(out).not.toContain("2 new");
    expect(out).toContain('New<span class="sr-only"> thread</span>');
    // Opened before: so many new replies.
    expect(freshOf({ unread: 2, lastReadSeq: 3 })).toEqual({
      kind: "replies",
      count: 2,
    });
    expect(freshOf({ unread: 0, lastReadSeq: 3 })).toBeNull();
    expect(freshOf({ unread: undefined, lastReadSeq: undefined })).toBeNull();
    // The page head sums the same two units, and nothing when nothing is new.
    expect(
      newOnPage(
        ready([
          unopened,
          thread("w", { unread: 1, lastReadSeq: null }),
          thread("r", { replyCount: 5, lastSeq: 5, unread: 3, lastReadSeq: 2 }),
          thread("s", { unread: 0, lastReadSeq: 4 }),
        ]),
      ),
    ).toBe("2 new threads · 3 new replies");
    expect(
      newOnPage(ready([thread("s", { unread: 0, lastReadSeq: 4 })])),
    ).toBeNull();
    expect(newOnPage({ status: "loading" })).toBeNull();
  });

  it("keeps the pill at one height in the column, replies or none", () => {
    // No replies: a blank of the figure's height stands where it would be.
    const quiet = row(thread("n", { unread: 1, lastReadSeq: null }));
    expect(quiet).toMatch(/<span class="invisible[^"]*" aria-hidden="true">/);
    expect(quiet).not.toMatch(/repl(y|ies)/);
    // Nothing new and no replies: the column holds nothing at all.
    expect(row(thread("a"))).not.toContain("invisible");
  });

  it("previews the last message on one line, led by who said it", () => {
    expect(row(busy)).toMatch(
      /<p class="[^"]*truncate[^"]*">Cian M: Not cowardly at all\.<\/p>/,
    );
    // The opening post is the author's own, who is named under it.
    expect(previewLine(thread("a"))).toBe("I’m buying my first wing.");
    expect(previewLine(thread("a", { preview: null }))).toBeNull();
    expect(row(thread("a", { preview: null }))).not.toContain("truncate");
  });

  it("names a mentioned member it knows, and never shows a raw token", () => {
    const line = previewLine(
      thread("m", {
        replyCount: 1,
        participants: [cian, aoife],
        preview: {
          author: cian,
          text: `<@${aoife.id}> and <@user_stranger> should see this`,
        },
      }),
    );
    expect(line).toBe("Cian M: @aoife-k and @member should see this");
  });

  it("shows tags, the author, and a reply count only when there are replies", () => {
    const out = row(busy);
    expect(out).toContain(">Question</span>");
    expect(out).toContain(">Sizing</span>");
    expect(out).toContain("Aoife K");
    // The count is a figure, named for a screen reader.
    expect(out).toMatch(
      /role="img" aria-label="24 replies"><span class="[^"]*text-figure[^"]*">24<\/span>/,
    );
    expect(out).toContain("24 replies");
    const quiet = row(thread("a"));
    expect(quiet).not.toContain("tabular-nums text-ink");
    expect(quiet).not.toMatch(/repl(y|ies)/);
    expect(row(thread("b", { replyCount: 1 }))).toContain("1 reply");
  });

  it("dates the row, and shows a 76 by 57 thumbnail when there is a photo", () => {
    const out = row(busy);
    expect(out).toMatch(
      /<time class="[^"]*" dateTime="[^"]+">4 min ago<\/time>/,
    );
    expect(out).toMatch(
      /<img class="[^"]*h-14\.25 w-19[^"]*" src="\/uploads\/a\.jpg" alt=""/,
    );
    // One step is 4px: 19 of them by 14.25.
    expect([19 * 4, 14.25 * 4]).toEqual([76, 57]);
    expect(row(thread("a"))).not.toContain("<img");
  });

  it("tells the time as a reader would", () => {
    expect(ago(minutesAgo(0), NOW)).toBe("Just now");
    expect(ago(minutesAgo(4), NOW)).toBe("4 min ago");
    expect(ago(minutesAgo(60), NOW)).toBe("1 h ago");
    expect(ago(minutesAgo(23 * 60), NOW)).toBe("23 h ago");
    expect(ago(minutesAgo(30 * 60), NOW)).toBe("Yesterday");
    expect(ago(minutesAgo(3 * 24 * 60), NOW)).toBe("3 days ago");
    expect(ago("2026-08-04T12:00:00Z", NOW)).toBe("4 Aug");
    expect(ago("2025-08-04T12:00:00Z", NOW)).toBe("4 Aug 2025");
  });
});

describe("S4: on a phone", () => {
  it("the row is compact: no thumbnail or column, the numbers in the line instead", () => {
    const styles = threadRowStyles();
    expect(styles.thumb()).toContain("max-rail:hidden");
    expect(styles.stats()).toContain("max-rail:hidden");
    expect(styles.inline()).toBe("rail:hidden");
    expect(styles.row()).toContain("max-rail:py-3");
    // Both tellings are in the markup; a width shows one of them.
    const out = row(thread("q", { replyCount: 3, unread: 2 }));
    expect(out.match(/2 new/g)).toHaveLength(2);
    expect(out).toMatch(
      /<span class="rail:hidden">·[^<]*(<!-- -->)?3 replies<\/span>/,
    );
  });

  it("the tag pills are one line that scrolls", () => {
    const base = tagPillsStyles().base();
    expect(base).toContain("max-rail:flex-nowrap");
    expect(base).toContain("max-rail:overflow-x-auto");
    expect(tagPillsStyles().item()).toContain("shrink-0");
  });

  it("New thread floats, filled, only where the header does not carry it", () => {
    const fab = newThreadStyles().fab();
    expect(fab).toContain("fixed");
    expect(fab).toContain("rail:hidden");
    expect(fab).toContain("shadow-marker");
  });
});

describe("S5: the new-thread dialog", () => {
  const input = (extra: Partial<ThreadInput> = {}): ThreadInput => ({
    title: "5m or 6m for Dublin Bay?",
    body: "I’m buying my first wing.",
    tagIds: [],
    photoKeys: [],
    spotId: null,
    ...extra,
  });

  it("picks up to three tags: a fourth waits for room", () => {
    expect(LIMITS.tagsPerThread).toBe(3);
    expect(toggleTag([], "a")).toEqual(["a"]);
    expect(toggleTag(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleTag(["a", "b", "c"], "d")).toEqual(["a", "b", "c"]);
    expect(toggleTag(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("checks what the API will check, before anything is sent", () => {
    expect(checkThread(input())).toEqual({});
    expect(LIMITS.titleMax).toBe(120);
    const found = checkThread(
      input({ title: "Hi", body: "  ", photoKeys: ["a", "b", "c", "d", "e"] }),
    );
    expect(found.title).toMatch(/at least 4/);
    expect(found.body).toBe("Write something first");
    expect(found.photoKeys).toBe("Attach 4 photos or fewer");
    expect(checkThread(input({ title: "x".repeat(121) })).title).toBeTruthy();
  });

  it("puts the API's details under the fields they name", () => {
    expect(
      fieldErrors(
        {
          message: "Some fields need attention.",
          details: {
            title: "Give the thread a title",
            body: "Write something first",
          },
        },
        input(),
      ),
    ).toEqual({
      fields: {
        title: "Give the thread a title",
        body: "Write something first",
      },
      top: null,
    });
  });

  it("uses the reply's own words where a detail only echoes what was refused", () => {
    const sent = input({ tagIds: ["tag_a", "tag_b"], photoKeys: ["k1"] });
    expect(
      fieldErrors(
        {
          message: "A tag you picked is not one of this channel's.",
          details: { tagIds: "tag_b" },
        },
        sent,
      ),
    ).toEqual({
      fields: { tagIds: "A tag you picked is not one of this channel's." },
      top: null,
    });
    const mention = fieldErrors(
      {
        message: "You mentioned someone who is not a member.",
        details: { body: "user_x, user_y" },
      },
      input({ body: "hello <@user_x> and <@user_y>" }),
    );
    expect(mention.fields.body).toBe(
      "You mentioned someone who is not a member.",
    );
  });

  it("says at the top what no field can take", () => {
    expect(
      fieldErrors({ message: "This channel is archived." }, input()),
    ).toEqual({ fields: {}, top: "This channel is archived." });
    expect(
      fieldErrors(
        { message: "Slow down.", details: { retryAfter: "60" } },
        input(),
      ),
    ).toEqual({ fields: {}, top: "Slow down." });
  });

  it("offers the spots by name, as the map's file holds them", () => {
    const spots = spotOptions([
      { id: "keel", name: "Keel Beach", county: "Mayo" },
      { id: "dollymount", name: "Dollymount", county: "Dublin" },
    ]);
    expect(spots.map(spotLabel)).toEqual([
      "Dollymount, Co. Dublin",
      "Keel Beach, Co. Mayo",
    ]);
  });

  it("over home, offers the channels a member can post in", () => {
    const archived: Channel = { ...wings, id: "x", status: "archived" };
    const open = postable([...SEED_CHANNELS, archived]);
    expect(open).not.toContain(announcements);
    expect(open).not.toContain(archived);
    expect(open).toHaveLength(SEED_CHANNELS.length - 1);
  });

  it("posts the thread to its channel", async () => {
    const api = new CommunityApi(async () => "dev:aoife");
    const fetched = answering(thread("new"), 201);
    const sent = input({ tagIds: ["t1"], spotId: "dollymount" });
    await expect(api.createThread("wings", sent)).resolves.toMatchObject({
      id: "new",
    });
    const [url, init] = fetched.mock.calls[0];
    expect(url).toBe("/api/community/channels/wings/threads");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(sent);
  });

  it("resizes a photo with the site's one resizer, then uploads it for its key", async () => {
    vi.resetModules();
    const blob = new Blob(["jpeg"], { type: "image/jpeg" });
    const resizeImage = vi.fn(async () => ({
      blob,
      width: 1600,
      height: 1200,
    }));
    vi.doMock("../../shared/web/images", () => ({ resizeImage }));
    const { CommunityApi: Api } = await import("./api");
    const fetched = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith("/uploads")
        ? Response.json({
            key: "community/u/1.jpg",
            uploadUrl: "https://storage.test/slot",
            method: "PUT",
            headers: { "Content-Type": "image/jpeg" },
            publicUrl: "https://cdn.test/1.jpg",
          })
        : new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetched);
    const file = new File(["raw"], "wing.heic");
    const key = await new Api(async () => "dev:aoife").uploadPhoto(file);
    expect(key).toBe("community/u/1.jpg");
    expect(resizeImage).toHaveBeenCalledWith(file);
    expect(fetched.mock.calls.map(([url]) => url)).toEqual([
      "/api/community/uploads",
      "https://storage.test/slot",
    ]);
    expect(JSON.parse(String(fetched.mock.calls[0][1]?.body))).toEqual({
      contentType: "image/jpeg",
      byteLength: blob.size,
    });
    // The slot is another origin's: the bytes go with no bearer token.
    expect(fetched.mock.calls[1][1]?.headers).toEqual({
      "Content-Type": "image/jpeg",
    });
  });
});

describe("S6: signed out", () => {
  it("New thread opens sign-in, and the dialog once there is a member", () => {
    const clerk = { provider: "clerk" as const, loaded: true };
    expect(newThreadStep(true, { ...clerk, signedIn: false })).toBe("sign-in");
    expect(newThreadStep(true, { ...clerk, signedIn: true })).toBe("dialog");
    // Not before the provider knows: a member is never sent to sign in.
    expect(
      newThreadStep(true, { ...clerk, loaded: false, signedIn: false }),
    ).toBe("wait");
    expect(newThreadStep(false, { ...clerk, signedIn: true })).toBe("closed");
    expect(
      newThreadStep(true, { provider: "none", loaded: true, signedIn: false }),
    ).toBe("closed");
  });

  it("the URL that asks is the one sign-in returns to, and closing stops asking", () => {
    expect(paths.newThread("wings")).toBe("/community/c/wings?new=1");
    expect(
      withoutNewThread(
        "/community/c/wings",
        new URLSearchParams("tag=t1&new=1"),
      ),
    ).toBe("/community/c/wings?tag=t1");
    expect(withoutNewThread("/community", new URLSearchParams("new=1"))).toBe(
      "/community",
    );
  });
});

describe("S7: instead of a list", () => {
  it("is whatever the page says when there are no threads", () => {
    expect(list(ready([]))).toBe("<p>No threads yet</p>");
  });

  it("names what failed and offers to try again", () => {
    const out = list({
      status: "error",
      message: "The community could not be reached. Check your connection.",
    });
    expect(out).toContain("We could not load the latest threads");
    expect(out).toMatch(
      /<p role="alert">The community could not be reached\. Check your connection\.<\/p>/,
    );
    expect(out).toMatch(/<button type="button"[^>]*>Try again<\/button>/);
    expect(out).not.toContain("bg-accent");
  });

  it("says it is loading", () => {
    const out = list({ status: "loading" });
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("Loading the latest threads…");
  });
});

/**
 * A page under the session a build would give it, as shell.test.ts does. No
 * effect runs in static markup, so a list is loading unless `feed` says what
 * it came to.
 */
async function pageAs(
  devUser: string | null,
  page: "home" | "channel",
  props: Record<string, unknown>,
  feed?: FeedState,
) {
  vi.resetModules();
  if (feed)
    vi.doMock("./hooks", async (original) => ({
      ...(await original<typeof import("./hooks")>()),
      useThreadFeed: () => ({
        state: feed,
        reload: () => {},
        loadMore: () => {},
      }),
    }));
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
  vi.stubEnv("VITE_MARKET_DEV_USER", devUser ?? "");
  const { SiteAuthProvider } = await import("../../shared/web/auth");
  const Page =
    page === "home"
      ? (await import("./pages/Home")).Home
      : (await import("./pages/Channel")).Channel;
  return html(
    createElement(SiteAuthProvider, {
      home: "/community",
      children: createElement(Page as never, props),
    }),
  );
}

const channelsReady: ChannelsState = {
  status: "ready",
  groups: railGroups(SEED_CATEGORIES, SEED_CHANNELS),
  memberCount: 1284,
};

const filled = (out: string) =>
  [...out.matchAll(/<(a|button)\b[^>]*class="[^"]*bg-accent[^"]*"[^>]*>/g)].map(
    (m) => m[0],
  );

describe("S7: a page with nothing to list", () => {
  const quiet = (out: string, label: string) =>
    out.match(new RegExp(`<a [^>]*>${label}</a>`))?.[0] ?? "";

  it("home says No threads yet and offers Start the first one, quietly", async () => {
    const out = await pageAs(
      "aoife",
      "home",
      {
        channels: channelsReady,
        pathname: "/community",
        search: new URLSearchParams(),
      },
      ready([]),
    );
    expect(out).toContain("No threads yet");
    const start = quiet(out, "Start the first one");
    expect(start).toContain('href="/community?new=1"');
    expect(start).not.toContain("bg-accent");
    // The floating New thread is still the one filled control.
    expect(filled(out)).toHaveLength(1);
  });

  it("a channel says so too, and its Start the first one opens the dialog over it", async () => {
    const props = {
      slug: "wings",
      channels: channelsReady,
      role: null,
      pathname: "/community/c/wings",
      search: new URLSearchParams(),
    };
    const out = await pageAs("aoife", "channel", props, ready([]));
    expect(out).toContain("No threads yet");
    const start = quiet(out, "Start the first one");
    expect(start).toContain('href="/community/c/wings?new=1"');
    expect(start).not.toContain("bg-accent");
    expect(filled(out)).toHaveLength(1);
  });

  it("a staff-only channel with nothing in it offers a member no way to start one", async () => {
    const out = await pageAs(
      "aoife",
      "channel",
      {
        slug: "announcements",
        channels: channelsReady,
        role: "member",
        pathname: "/community/c/announcements",
        search: new URLSearchParams(),
      },
      ready([]),
    );
    expect(out).toContain("No threads yet");
    expect(out).not.toContain("Start the first one");
    expect(filled(out)).toEqual([]);
  });

  it("a tag with nothing under it says which, and offers every thread", async () => {
    const tag = wings.tags[0];
    const out = await pageAs(
      "aoife",
      "channel",
      {
        slug: "wings",
        channels: channelsReady,
        role: null,
        pathname: "/community/c/wings",
        search: new URLSearchParams(`tag=${tag.id}`),
      },
      ready([]),
    );
    expect(out).toContain(`No threads tagged ${tag.label}`);
    expect(quiet(out, "Show every thread")).toContain(
      'href="/community/c/wings"',
    );
    expect(out).not.toContain("No threads yet");
  });

  it("a search that finds nothing says so, and a failed list names what failed", async () => {
    const props = {
      channels: channelsReady,
      pathname: "/community",
      search: new URLSearchParams("q=gybes"),
    };
    const none = await pageAs(null, "home", props, ready([]));
    expect(none).toContain("Nothing found for “gybes”");
    expect(none).not.toContain("No threads yet");
    const failed = await pageAs(
      "aoife",
      "channel",
      {
        slug: "wings",
        channels: channelsReady,
        role: null,
        pathname: "/community/c/wings",
        search: new URLSearchParams(),
      },
      { status: "error", message: "The community could not be reached." },
    );
    expect(failed).toContain("We could not load the threads in Wings");
    expect(failed).toMatch(/<button type="button"[^>]*>Try again<\/button>/);
  });
});

describe("S8 and the pages", () => {
  it("home is a dateline, a title and the count: figures, not a line about the place", async () => {
    const out = await pageAs("aoife", "home", {
      channels: channelsReady,
      pathname: "/community",
      search: new URLSearchParams(),
    });
    expect(out).toMatch(/<h1[^>]*>Latest<\/h1>/);
    expect(out).toMatch(
      /<p class="[^"]*uppercase[^"]*"><span>\w{3} \d{1,2} \w{3} \d{4}<\/span>/,
    );
    expect(out).not.toContain("from wingfoilers around Ireland.");
    expect(out).toContain("1,284 members");
    const few = await pageAs("aoife", "home", {
      channels: { ...channelsReady, memberCount: 12 },
      pathname: "/community",
      search: new URLSearchParams(),
    });
    expect(few).not.toContain("members");
  });

  it("home with ?q= is the search, under its own name", async () => {
    const out = await pageAs(null, "home", {
      channels: channelsReady,
      pathname: "/community",
      search: new URLSearchParams("q=gybes"),
    });
    expect(out).toMatch(/<h1[^>]*><span[^>]*>“gybes”<\/span><\/h1>/);
    expect(out).toContain("<span>Search</span>");
    expect(out).toContain("Loading the search results…");
  });

  it("a channel is its name, description, counts, Follow channel, tags and the one order", async () => {
    const out = await pageAs("aoife", "channel", {
      slug: "wings",
      channels: channelsReady,
      role: null,
      pathname: "/community/c/wings",
      search: new URLSearchParams(),
    });
    expect(out).toMatch(/<h1[^>]*>Wings<\/h1>/);
    expect(out).toContain(">Gear</span>");
    expect(out).toContain(wings.description);
    expect(out).toContain("0 threads · 0 followers");
    expect(out).toMatch(
      /<button type="button"[^>]*aria-pressed="false"[^>]*>.*?Follow<span class="max-rail:sr-only"> channel/,
    );
    expect(out).toContain('aria-label="Filter by tag"');
    // The one order needs no saying: the newest activity is at the top.
    expect(out).not.toContain("Most recent activity first");
    expect(out).toContain('href="/community/c/wings?new=1"');
  });

  it("says Follow channel is on by pressing it, not by changing its words", async () => {
    const following: ChannelsState = {
      ...channelsReady,
      groups: railGroups(
        SEED_CATEGORIES,
        SEED_CHANNELS.map((c) =>
          c.slug === "wings" ? { ...c, following: true } : c,
        ),
      ),
    };
    const out = await pageAs("aoife", "channel", {
      slug: "wings",
      channels: following,
      role: null,
      pathname: "/community/c/wings",
      search: new URLSearchParams(),
    });
    expect(out).toMatch(
      /<button type="button"[^>]*aria-pressed="true"[^>]*>.*?Follow<span class="max-rail:sr-only"> channel/,
    );
  });

  it("a staff-only channel offers a member no New thread, and staff one", async () => {
    expect(canStartThread(announcements, null)).toBe(false);
    expect(canStartThread(announcements, "member")).toBe(false);
    expect(canStartThread(announcements, "staff")).toBe(true);
    expect(canStartThread(wings, null)).toBe(true);
    expect(canStartThread({ ...wings, status: "archived" }, "staff")).toBe(
      false,
    );
    const props = {
      slug: "announcements",
      channels: channelsReady,
      pathname: "/community/c/announcements",
      search: new URLSearchParams("new=1"),
    };
    const member = await pageAs("aoife", "channel", {
      ...props,
      role: "member",
    });
    expect(member).not.toContain("New thread");
    expect(member).not.toContain("?new=1");
    // Not even by its URL.
    expect(member).not.toContain("<dialog");
    const staff = await pageAs("aoife", "channel", { ...props, role: "staff" });
    expect(staff).toContain("<dialog");
    expect(staff).toContain("Post thread");
  });

  it("the header offers no New thread where the shell hands it none", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_MARKET_DEV_USER", "aoife");
    const { SiteAuthProvider } = await import("../../shared/web/auth");
    const { Header } = await import("./Header");
    const header = (newThread: string | null) =>
      html(
        createElement(SiteAuthProvider, {
          home: "/community",
          children: createElement(Header, {
            accentNew: true,
            newThread,
            unread: 0,
            onUnread: () => {},
            pathname: "/community",
          }),
        }),
      );
    expect(header("/community/c/wings?new=1")).toContain("New thread");
    const none = header(null);
    expect(none).not.toContain("New thread");
    expect(filled(none)).toEqual([]);
    // The bell and the member are still there.
    expect(none).toContain("Notifications");
  });

  it("a channel that is not there says so, quietly", async () => {
    const out = await pageAs("aoife", "channel", {
      slug: "nowhere",
      channels: channelsReady,
      role: null,
      pathname: "/community/c/nowhere",
      search: new URLSearchParams(),
    });
    expect(out).toContain("That channel does not exist");
    expect(filled(out)).toEqual([]);
  });
});

describe("ACCEPT: one filled action per view", () => {
  it("the header's New thread stands down while the dialog is up", () => {
    expect(accentNewThread(matchRoute("/community"))).toBe(true);
    expect(accentNewThread(matchRoute("/community"), true)).toBe(false);
    expect(accentNewThread(matchRoute("/community/c/wings"), true)).toBe(false);
  });

  it.each([
    ["home", { pathname: "/community" }],
    ["channel", { slug: "wings", role: null, pathname: "/community/c/wings" }],
  ] as const)(
    "%s: the page's one filled control is the floating New thread, below the rail breakpoint only",
    async (page, props) => {
      const out = await pageAs("aoife", page, {
        ...props,
        channels: channelsReady,
        search: new URLSearchParams(),
      });
      // The header's is the other one, and carries max-rail:hidden
      // (shell.test.ts): at any width exactly one of the two is drawn.
      const found = filled(out);
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("rail:hidden");
      expect(found[0]).not.toContain("max-rail:hidden");
    },
  );

  it.each([
    ["home", { pathname: "/community" }],
    ["channel", { slug: "wings", role: null, pathname: "/community/c/wings" }],
  ] as const)(
    "%s with the dialog up: Post thread is the only filled control",
    async (page, props) => {
      const out = await pageAs("aoife", page, {
        ...props,
        channels: channelsReady,
        search: new URLSearchParams("new=1"),
      });
      const found = filled(out);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/^<button type="submit"/);
      expect(out).toContain(">Post thread</button>");
      expect(out).toMatch(/<button type="button"[^>]*>Cancel<\/button>/);
    },
  );

  it("the dialog holds a title with its counter, tags, the body, photos and its channel", async () => {
    const out = await pageAs("aoife", "channel", {
      slug: "wings",
      role: null,
      pathname: "/community/c/wings",
      channels: channelsReady,
      search: new URLSearchParams("new=1"),
    });
    expect(out).toMatch(/<h2[^>]*>Start a thread<\/h2>/);
    expect(out).toMatch(/lucide-hash.*?<\/svg>Wings<\/span>/);
    expect(out).toContain("posting as aoife");
    expect(out).toContain("0 / 120");
    expect(out).toMatch(/<input[^>]*maxLength="120"/);
    expect(out).toContain('role="group" aria-label="Tags"');
    expect(out).toContain("Up to 3");
    expect(out).toContain("What’s on your mind?");
    expect(out).toContain('aria-label="Add photos"');
    expect(out).toContain("Optional, up to 4");
    // Over a channel there is no channel to pick.
    expect(out).not.toContain("Pick a channel");
    const home = await pageAs("aoife", "home", {
      pathname: "/community",
      channels: channelsReady,
      search: new URLSearchParams("new=1"),
    });
    expect(home).toContain("Pick a channel");
    expect(home).not.toContain(">Announcements</option>");
  });

  it("signed out on a build with no sign-in, nothing offers New thread", async () => {
    const out = await pageAs(null, "channel", {
      slug: "wings",
      role: null,
      pathname: "/community/c/wings",
      channels: channelsReady,
      search: new URLSearchParams("new=1"),
    });
    expect(out).not.toContain("New thread");
    expect(out).not.toContain("<dialog");
    expect(out).not.toContain("Follow channel");
  });
});
