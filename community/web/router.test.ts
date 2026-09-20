import { afterEach, describe, expect, it, vi } from "vitest";
import { BASE, matchRoute, navigate, paths, routed } from "./router";

describe("matchRoute", () => {
  it.each([
    ["/community", { page: "home" }],
    ["/community/", { page: "home" }],
    ["/community/following", { page: "following" }],
    ["/community/mentions", { page: "mentions" }],
    ["/community/notifications", { page: "notifications" }],
    ["/community/c/wings", { page: "channel", slug: "wings" }],
    ["/community/t/abc123", { page: "thread", id: "abc123", slug: null }],
    [
      "/community/t/abc123/5m-or-6m",
      { page: "thread", id: "abc123", slug: "5m-or-6m" },
    ],
    [
      "/community/t/abc123/5m-or-6m/",
      { page: "thread", id: "abc123", slug: "5m-or-6m" },
    ],
    ["/community/u/aoife", { page: "member", handle: "aoife" }],
  ])("%s", (pathname, route) => {
    expect(matchRoute(pathname)).toEqual(route);
  });

  it.each([
    "/community/nowhere",
    "/community/following/more",
    "/community/c",
    "/community/c/wings/more",
    "/community/t",
    "/community/t/abc123/slug/more",
    "/community/u",
    "/community/u/aoife/threads",
  ])("%s is not found", (pathname) => {
    expect(matchRoute(pathname)).toEqual({ page: "not-found" });
  });
});

describe("paths", () => {
  it("writes every URL the router reads back", () => {
    expect(matchRoute(paths.home())).toEqual({ page: "home" });
    expect(matchRoute(paths.following())).toEqual({ page: "following" });
    expect(matchRoute(paths.mentions())).toEqual({ page: "mentions" });
    expect(matchRoute(paths.notifications())).toEqual({
      page: "notifications",
    });
    expect(matchRoute(paths.channel("wings"))).toEqual({
      page: "channel",
      slug: "wings",
    });
    expect(matchRoute(paths.thread("abc123", "5m-or-6m"))).toEqual({
      page: "thread",
      id: "abc123",
      slug: "5m-or-6m",
    });
    expect(matchRoute(paths.thread("abc123"))).toEqual({
      page: "thread",
      id: "abc123",
      slug: null,
    });
    expect(matchRoute(paths.member("aoife"))).toEqual({
      page: "member",
      handle: "aoife",
    });
  });

  it("keeps everything under the section's base", () => {
    expect(BASE).toBe("/community");
    expect(paths.home()).toBe("/community");
    expect(paths.home(new URLSearchParams({ q: "gybe" }))).toBe(
      "/community?q=gybe",
    );
  });

  it("asks for the new-thread dialog over a channel, or over home", () => {
    expect(paths.newThread()).toBe("/community?new=1");
    expect(paths.newThread("wings")).toBe("/community/c/wings?new=1");
  });
});

/** A click as the handler sees one: the button, the modifiers, and whether it was stopped. */
function click(init: { button?: number; metaKey?: boolean }) {
  const event = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    ...init,
  };
  return event as unknown as Parameters<
    ReturnType<typeof routed>["onClick"]
  >[0];
}

describe("routed", () => {
  const pushed: string[] = [];
  const events: string[] = [];

  function browser() {
    pushed.length = 0;
    events.length = 0;
    vi.stubGlobal("history", {
      pushState: (_: unknown, __: string, to: string) => pushed.push(to),
      replaceState: (_: unknown, __: string, to: string) =>
        pushed.push(`replace:${to}`),
    });
    vi.stubGlobal("window", {
      dispatchEvent: (event: Event) => events.push(event.type),
    });
  }

  afterEach(() => vi.unstubAllGlobals());

  it("is a real href, and a plain click pushes instead of loading", () => {
    browser();
    const link = routed("/community/c/wings");
    expect(link.href).toBe("/community/c/wings");
    const event = click({});
    link.onClick(event);
    expect(event.defaultPrevented).toBe(true);
    expect(pushed).toEqual(["/community/c/wings"]);
    expect(events).toEqual(["community:navigate"]);
  });

  it("leaves a new-tab click, and a link with a target, to the browser", () => {
    browser();
    const modified = click({ metaKey: true });
    routed("/community").onClick(modified);
    const middle = click({ button: 1 });
    routed("/community").onClick(middle);
    const blank = click({});
    routed("/community", { target: "_blank" }).onClick(blank);
    expect(pushed).toEqual([]);
    expect(modified.defaultPrevented).toBe(false);
    expect(middle.defaultPrevented).toBe(false);
    expect(blank.defaultPrevented).toBe(false);
  });

  it("runs the caller's handler first, and stands down if it took the click", () => {
    browser();
    const event = click({});
    routed("/community", { onClick: (e) => e.preventDefault() }).onClick(event);
    expect(pushed).toEqual([]);
  });

  it("navigate can replace the entry rather than add one", () => {
    browser();
    navigate("/community/following", { replace: true });
    expect(pushed).toEqual(["replace:/community/following"]);
    expect(events).toEqual(["community:navigate"]);
  });
});
