import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, CommunityApi } from "./api";

/**
 * The client stands on the site's fetch core, so what is checked here is what
 * is the community's own: where its requests go, whose token they carry, and
 * how a failure names the section to the reader.
 */

function answering(status: number, body: string, type = "application/json") {
  const fetched = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(body, { status, headers: { "Content-Type": type } }),
  );
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

afterEach(() => vi.unstubAllGlobals());

describe("CommunityApi", () => {
  it("reads /meta, /channels and the bell's count under /api/community", async () => {
    const api = new CommunityApi(async () => null);
    const fetched = answering(200, JSON.stringify({ channels: [] }));
    await api.meta();
    await expect(api.listChannels()).resolves.toEqual({ channels: [] });
    await api.notificationsCount();
    expect(fetched.mock.calls.map(([url]) => url)).toEqual([
      "/api/community/meta",
      "/api/community/channels",
      "/api/community/notifications/count",
    ]);
    for (const [, init] of fetched.mock.calls) expect(init?.method).toBe("GET");
  });

  it("carries the member's token, so /channels comes back with unread counts", async () => {
    const api = new CommunityApi(async () => "dev:aoife");
    const fetched = answering(200, JSON.stringify({ channels: [] }));
    await api.listChannels();
    expect(fetched.mock.calls[0][1]?.headers).toEqual({
      Authorization: "Bearer dev:aoife",
    });
  });

  it("sends no Authorization header for a signed-out reader", async () => {
    const api = new CommunityApi(async () => null);
    const fetched = answering(200, JSON.stringify({ channels: [] }));
    await api.listChannels();
    expect(fetched.mock.calls[0][1]?.headers).toEqual({});
  });

  it("the thread page's reads: the view, a page by seq either way, the stream's address", async () => {
    const api = new CommunityApi(async () => null);
    const fetched = answering(200, "{}");
    const id = "t000000000000001";
    await api.getThread(id);
    await api.listMessages(id, { after: 12 });
    // Before the opening post there is no seq to name.
    await api.listMessages(id, { after: -1 });
    await api.listMessages(id, { before: 40 });
    await api.listMessages(id, { around: 25 });
    expect(fetched.mock.calls.map(([url]) => url)).toEqual([
      `/api/community/threads/${id}`,
      `/api/community/threads/${id}/messages?after=12`,
      `/api/community/threads/${id}/messages`,
      `/api/community/threads/${id}/messages?before=40`,
      `/api/community/threads/${id}/messages?around=25`,
    ]);
    expect(api.eventsUrl(id)).toBe(`/api/community/threads/${id}/events`);
  });

  it("the thread page's writes, each to its route with its body", async () => {
    const api = new CommunityApi(async () => "dev:aoife");
    const fetched = answering(200, "{}");
    const t = "t000000000000001";
    const m = "m000000000000001";
    await api.postMessage(t, { body: "hi", replyToId: m, photoKeys: ["k"] });
    await api.editMessage(m, "hello");
    await api.deleteMessage(m);
    await api.setReaction(m, "🤙", true);
    await api.setThreadFollow(t, "mentions");
    await api.markRead(t, 24);
    await api.report(m, "spam", "  selling wings  ");
    await api.report(m, "other", " ");
    await api.moderateThread(t, "lock", "Settled.");
    await api.moderateThread(t, "pin");
    const sent = fetched.mock.calls.map(([url, init]) => [
      init?.method,
      url,
      init?.body ? JSON.parse(String(init.body)) : undefined,
    ]);
    expect(sent).toEqual([
      [
        "POST",
        `/api/community/threads/${t}/messages`,
        { body: "hi", replyToId: m, photoKeys: ["k"] },
      ],
      ["PUT", `/api/community/messages/${m}`, { body: "hello" }],
      ["DELETE", `/api/community/messages/${m}`, undefined],
      [
        "PUT",
        `/api/community/messages/${m}/reactions/${encodeURIComponent("🤙")}`,
        { on: true },
      ],
      ["PUT", `/api/community/threads/${t}/follow`, { level: "mentions" }],
      ["PUT", `/api/community/threads/${t}/read`, { seq: 24 }],
      [
        "POST",
        `/api/community/messages/${m}/report`,
        { reason: "spam", note: "selling wings" },
      ],
      ["POST", `/api/community/messages/${m}/report`, { reason: "other" }],
      ["POST", `/api/community/threads/${t}/lock`, { reason: "Settled." }],
      ["POST", `/api/community/threads/${t}/pin`, {}],
    ]);
  });

  it("reads the viewer's own row from the site, not from the community", async () => {
    const api = new CommunityApi(async () => "dev:aoife");
    const fetched = answering(200, JSON.stringify({ role: "staff" }));
    await expect(api.me()).resolves.toEqual({ role: "staff" });
    expect(fetched.mock.calls[0][0]).toBe("/api/me");
    expect(fetched.mock.calls[0][1]?.headers).toEqual({
      Authorization: "Bearer dev:aoife",
    });
  });

  it("names the community when the API has nothing of its own to say", async () => {
    const api = new CommunityApi(async () => null);
    answering(502, "<html>Bad gateway</html>", "text/html");
    const error = await api.meta().catch((e) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(502);
    expect(error.message).toBe(
      "The community is not responding right now. Try again in a moment.",
    );
  });

  it("carries the API's own error through", async () => {
    const api = new CommunityApi(async () => null);
    answering(
      401,
      JSON.stringify({ error: "unauthorized", message: "Sign in first." }),
    );
    const error = await api.notificationsCount().catch((e) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.code).toBe("unauthorized");
    expect(error.message).toBe("Sign in first.");
  });
});
