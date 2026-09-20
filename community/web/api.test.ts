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
