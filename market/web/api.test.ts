import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, MarketApi } from "./api";

/**
 * What the client does with a reply that did not come from the API.
 *
 * The site is one `index.html` behind an SPA fallback, and an origin that
 * rewrites too much — or a proxy, a captive portal, a login wall — answers a
 * request for `/api/market/...` with HTML. The page must say "the request
 * failed" and offer a retry, not raise a SyntaxError out of a parser the
 * caller has never heard of.
 */

const api = new MarketApi(async () => null);

const reply = (status: number, body: string, type = "text/html") =>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(body, { status, headers: { "Content-Type": type } }),
    ),
  );

afterEach(() => vi.unstubAllGlobals());

describe("a reply that is not JSON", () => {
  it("is an ApiRequestError, not a SyntaxError, when the status says OK", async () => {
    reply(200, "<!doctype html><title>wingfoil.ie</title>");
    const error = await api.listListings({}).catch((e) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).not.toBeInstanceOf(SyntaxError);
    expect(error.code).toBe("bad-response");
    expect(error.status).toBe(200);
    expect(error.message).toMatch(/could not read/);
  });

  it("keeps the status when the request failed as well", async () => {
    reply(502, "<html>Bad gateway</html>");
    const error = await api.getListing("abc").catch((e) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(502);
    expect(error.code).toBe("bad-response");
    // The status rides on the error for whoever needs it; the reader is told
    // what happened and what to do, not handed a number.
    expect(error.message).toMatch(/not responding right now/);
  });
});

describe("a reply that is JSON", () => {
  it("is returned as it always was", async () => {
    reply(200, JSON.stringify({ items: [], total: 0 }), "application/json");
    await expect(api.listListings({})).resolves.toEqual({
      items: [],
      total: 0,
    });
  });

  it("still carries the API's own error shape through", async () => {
    reply(
      400,
      JSON.stringify({
        error: "invalid",
        message: "Title is required",
        details: { title: "required" },
      }),
      "application/json",
    );
    const error = await api.getListing("abc").catch((e) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(400);
    expect(error.code).toBe("invalid");
    expect(error.message).toBe("Title is required");
    expect(error.details).toEqual({ title: "required" });
  });

  it("treats an empty body as no payload rather than a parse failure", async () => {
    reply(200, "", "application/json");
    await expect(api.getListing("abc")).resolves.toBeNull();
  });
});

/**
 * The fetch core moved to `shared/web/http.ts`. What the marketplace sends,
 * where it sends it and what it tells a reader did not move with it.
 */
describe("the marketplace on the shared fetch core", () => {
  it("still asks /api/market, with the signed-in user's bearer token", async () => {
    const spy = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: "abc", saved: true }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", spy);
    await new MarketApi(async () => "dev:ann").setSaved("abc", true);
    expect(spy.mock.calls[0]).toEqual([
      "/api/market/listings/abc/saved",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dev:ann",
        },
        body: JSON.stringify({ saved: true }),
      },
    ]);
  });

  it("still says the marketplace could not be reached when offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const error = await api.me().catch((e) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.code).toBe("offline");
    expect(error.message).toBe(
      "The marketplace could not be reached. Check your connection.",
    );
  });

  it("throws the one error class the shared core throws", async () => {
    const http = await import("../../shared/web/http");
    expect(ApiRequestError).toBe(http.ApiRequestError);
  });
});
