import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, request, sendBytes, type ApiSettings } from "./http";

/**
 * The fetch core on its own, as a section that is not the marketplace would
 * use it: its own prefix, its own name in the copy, the same token and errors.
 */

const settings = (token: string | null): ApiSettings => ({
  prefix: "/api/community",
  subject: "The community",
  getToken: async () => token,
});

const reply = (
  status: number,
  body: string | null,
  type = "application/json",
) => {
  const spy = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(body, { status, headers: { "Content-Type": type } }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
};

/** The error a call failed with; a call that did not fail is the failure. */
const failed = (call: Promise<unknown>): Promise<ApiRequestError> =>
  call.then(
    () => {
      throw new Error("expected the request to fail");
    },
    (e: unknown) => e as ApiRequestError,
  );

afterEach(() => vi.unstubAllGlobals());

describe("what is sent", () => {
  it("goes to the section's prefix with the bearer token and a JSON body", async () => {
    const spy = reply(200, JSON.stringify({ id: "t1" }));
    await expect(
      request(settings("dev:ann"), "POST", "/threads", { title: "Hello" }),
    ).resolves.toEqual({ id: "t1" });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/community/threads");
    expect(init).toEqual({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer dev:ann",
      },
      body: JSON.stringify({ title: "Hello" }),
    });
  });

  it("sends neither a token nor a content type it does not have", async () => {
    const spy = reply(200, "[]");
    await request(settings(null), "GET", "/channels");
    expect(spy.mock.calls[0][1]).toEqual({
      method: "GET",
      headers: {},
      body: undefined,
    });
  });
});

describe("what comes back", () => {
  it("is nothing at all for a 204", async () => {
    reply(204, null);
    await expect(
      request(settings(null), "DELETE", "/follows/t1"),
    ).resolves.toBeUndefined();
  });

  it("carries the API's { error, message, details } on the error", async () => {
    reply(
      422,
      JSON.stringify({
        error: "invalid",
        message: "Say something first",
        details: { body: "required" },
      }),
    );
    const error = await failed(request(settings(null), "POST", "/threads", {}));
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(422);
    expect(error.code).toBe("invalid");
    expect(error.message).toBe("Say something first");
    expect(error.details).toEqual({ body: "required" });
  });

  it("names the section when the API has nothing of its own to say", async () => {
    reply(503, "{}");
    const down = await failed(request(settings(null), "GET", "/feed"));
    expect(down.code).toBe("error");
    expect(down.message).toBe(
      "The community is not responding right now. Try again in a moment.",
    );

    reply(200, "<!doctype html>", "text/html");
    const html = await failed(request(settings(null), "GET", "/feed"));
    expect(html.code).toBe("bad-response");
    expect(html.message).toMatch(/^The community sent a reply/);
  });

  it("is offline, with status 0, when the request never landed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const error = await failed(request(settings(null), "GET", "/feed"));
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(0);
    expect(error.code).toBe("offline");
    expect(error.message).toBe(
      "The community could not be reached. Check your connection.",
    );
  });
});

describe("bytes to an upload slot", () => {
  const slot = {
    uploadUrl: "https://uploads.example/key",
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
  };
  const bytes = new Blob(["x"], { type: "image/jpeg" });

  it("go with the slot's own headers and no bearer token", async () => {
    const spy = reply(200, "");
    await sendBytes(slot, bytes, "The photo upload failed. Try again.");
    expect(spy.mock.calls[0]).toEqual([
      slot.uploadUrl,
      { method: "PUT", headers: slot.headers, body: bytes },
    ]);
  });

  it("fail as an upload error with the caller's words", async () => {
    reply(403, "<Error/>", "application/xml");
    const error = await failed(
      sendBytes(slot, bytes, "The photo upload failed. Try again."),
    );
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(403);
    expect(error.code).toBe("upload");
    expect(error.message).toBe("The photo upload failed. Try again.");
  });
});
