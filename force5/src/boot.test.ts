import { afterEach, describe, expect, it, vi } from "vitest";
import { mapFirstRequests, startEarly, takeEarly } from "./boot";

afterEach(() => vi.unstubAllGlobals());

describe("startEarly", () => {
  it("starts each request revalidated, and keeps it for the map", () => {
    const asked: [string, RequestInit][] = [];
    const window: { __f5early?: Record<string, Promise<Response>> } = {};
    vi.stubGlobal("window", window);
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      asked.push([url, init]);
      return Promise.resolve(new Response("{}"));
    });
    startEarly(mapFirstRequests());
    expect(asked).toEqual([
      ["/weather/harmonie.json", { cache: "no-cache" }],
      ["/spots.json", { cache: "no-cache" }],
    ]);
    expect(Object.keys(window.__f5early!)).toEqual([
      "/weather/harmonie.json",
      "/spots.json",
    ]);
  });

  it("does not report a request nobody came for as unhandled", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const window: { __f5early?: Record<string, Promise<Response>> } = {};
    vi.stubGlobal("window", window);
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
    startEarly(["/spots.json"]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    // The caller that does come still sees the failure.
    await expect(window.__f5early!["/spots.json"]).rejects.toThrow("offline");
  });
});

describe("takeEarly", () => {
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
