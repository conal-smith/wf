import { afterEach, describe, expect, it, vi } from "vitest";
import { mapFirstRequests, startEarly, storedMapModel, takeEarly } from "./boot";
import { PREFS_KEY } from "./prefs";

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
    startEarly(mapFirstRequests("harmonie"));
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

describe("storedMapModel", () => {
  const stored = (value: unknown) => ({
    getItem: (key: string) =>
      key === PREFS_KEY ? JSON.stringify(value) : null,
  });
  it("opens on the model the rider picked, HARMONIE otherwise", () => {
    expect(storedMapModel(null)).toBe("harmonie");
    expect(storedMapModel(stored({}))).toBe("harmonie");
    expect(
      storedMapModel(stored({ rider: { starsFrom: { model: "gfs", then: "harmonie" } } })),
    ).toBe("gfs");
    expect(storedMapModel(stored({ rider: { starsFrom: { model: "ukv" } } }))).toBe(
      "harmonie",
    );
    expect(storedMapModel({ getItem: () => "not json" })).toBe("harmonie");
    expect(mapFirstRequests("icon-eu")[0]).toBe("/weather/latest.json");
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
