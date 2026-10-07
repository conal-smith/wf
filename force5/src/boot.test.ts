import { afterEach, describe, expect, it, vi } from "vitest";
import { earlyFetches, takeEarly } from "./boot";

describe("earlyFetches", () => {
  it("starts each request revalidated, and keeps it for the page", () => {
    const window: { __f5early?: Record<string, Promise<Response>> } = {};
    const asked: [string, RequestInit][] = [];
    const fetch = (url: string, init: RequestInit) => {
      asked.push([url, init]);
      return Promise.resolve(new Response("{}"));
    };
    new Function(
      "window",
      "fetch",
      earlyFetches(["/weather/harmonie.json", "/spots.json"]),
    )(window, fetch);
    expect(asked).toEqual([
      ["/weather/harmonie.json", { cache: "no-cache" }],
      ["/spots.json", { cache: "no-cache" }],
    ]);
    expect(Object.keys(window.__f5early!)).toEqual([
      "/weather/harmonie.json",
      "/spots.json",
    ]);
  });

  it("does nothing where there is no fetch", () => {
    const window: { __f5early?: unknown } = {};
    new Function("window", "fetch", earlyFetches(["/spots.json"]))(
      window,
      undefined,
    );
    expect(window.__f5early).toBeUndefined();
  });

  it("does not report a request nobody came for as unhandled", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const window: { __f5early?: Record<string, Promise<Response>> } = {};
    new Function("window", "fetch", earlyFetches(["/spots.json"]))(window, () =>
      Promise.reject(new TypeError("offline")),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    // The caller that does come still sees the failure.
    await expect(window.__f5early!["/spots.json"]).rejects.toThrow("offline");
  });
});

describe("takeEarly", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hands an early response over once, and only once", () => {
    const response = Promise.resolve(new Response("{}"));
    vi.stubGlobal("window", { __f5early: { "/spots.json": response } });
    expect(takeEarly("/weather/harmonie.json")).toBeUndefined();
    expect(takeEarly("/spots.json")).toBe(response);
    expect(takeEarly("/spots.json")).toBeUndefined();
  });

  it("is a no-op where nothing was started", () => {
    vi.stubGlobal("window", {});
    expect(takeEarly("/spots.json")).toBeUndefined();
  });
});
