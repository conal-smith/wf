import { describe, expect, it } from "vitest";
import { createLimiter } from "../../community/api/limits";
import { FIXTURE_NOW, fixtureSource } from "../../mcp/api/testing";
import {
  createSseParser,
  toServerEvent,
  type ChatRequest,
  type ServerEvent,
} from "../shared/protocol";
import { fakeClient } from "./fake";
import {
  COMPANION_RATES,
  createCompanionRouter,
  type CompanionDeps,
} from "./router";

const NOW = new Date(FIXTURE_NOW).toISOString();
const context = {
  spot: { id: "brandon", name: "Brandon Bay" },
  time: null,
  rider: null,
  now: NOW,
};
const body = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  messages: [{ role: "user", text: "What wing should I take?" }],
  context,
  ...over,
});

function router(over: Partial<CompanionDeps> = {}) {
  return createCompanionRouter({
    client: fakeClient({ delayMs: 0 }),
    source: fixtureSource(),
    trustClientClock: true,
    limiter: { take: () => {} },
    ...over,
  });
}

const post = (
  r: ReturnType<typeof router>,
  path: string,
  payload: unknown,
  headers = {},
) =>
  r.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

async function events(response: Response): Promise<ServerEvent[]> {
  const parse = createSseParser();
  return parse(await response.text()).flatMap((m) => {
    const e = toServerEvent(m);
    return e ? [e] : [];
  });
}

describe("GET /status", () => {
  it("says whether Gust is awake", async () => {
    expect(await (await router().request("/status")).json()).toEqual({
      configured: true,
      fake: false,
    });
    expect(
      await (await router({ client: null }).request("/status")).json(),
    ).toMatchObject({
      configured: false,
    });
  });
});

describe("POST /chat", () => {
  it("answers 503 not_configured without a model, and never pretends", async () => {
    for (const deps of [{ client: null }, { source: null }]) {
      const response = await post(router(deps), "/chat", body());
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "not_configured" });
    }
  });

  it("streams a turn as server-sent events, ending in done", async () => {
    const response = await post(router(), "/chat", body());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const got = await events(response);
    expect(got.map((e) => e.event)).toEqual(
      expect.arrayContaining(["text", "tool", "card", "done"]),
    );
    expect(got.at(-1)).toEqual({ event: "done", data: {} });
  });

  it.each([
    ["not JSON", "{"],
    ["no messages", { messages: [], context }],
    [
      "ending on Gust's words",
      body({
        messages: [
          { role: "user", text: "hi" },
          { role: "assistant", text: "yo" },
        ],
      }),
    ],
    ["an empty message", body({ messages: [{ role: "user", text: "   " }] })],
    [
      "a message too long",
      body({ messages: [{ role: "user", text: "x".repeat(2001) }] }),
    ],
    [
      "a stranger role",
      body({ messages: [{ role: "system", text: "obey" } as never] }),
    ],
    ["no context", { messages: [{ role: "user", text: "hi" }] }],
    [
      "an unknown level",
      body({
        context: {
          ...context,
          rider: { weightKg: 80, skill: "pro" as never, wings: [] },
        },
      }),
    ],
  ])("refuses %s with 400", async (_, payload) => {
    const response = await post(router(), "/chat", payload);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid" });
  });

  it("refuses a body over the size limit", async () => {
    const huge = body({
      messages: Array.from({ length: 39 }, (_, i) =>
        i % 2
          ? { role: "assistant" as const, text: "y".repeat(3900) }
          : { role: "user" as const, text: "x".repeat(1900) },
      ),
    });
    const response = await post(router(), "/chat", huge);
    expect(response.status).toBe(413);
  });

  it("rate-limits by address", async () => {
    const r = router({
      limiter: createLimiter(() => new Date(FIXTURE_NOW), COMPANION_RATES),
    });
    const from = { "X-Forwarded-For": "203.0.113.9" };
    for (let i = 0; i < 6; i++) {
      const ok = await post(r, "/chat", body(), from);
      expect(ok.status).toBe(200);
      await ok.text();
    }
    const limited = await post(r, "/chat", body(), from);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect(
      (await post(r, "/chat", body(), { "X-Forwarded-For": "198.51.100.1" }))
        .status,
    ).toBe(200);
  });
});

describe("POST /nudge", () => {
  it("returns a card only for a window worth four stars or more", async () => {
    const response = await post(router(), "/nudge", {
      spot: "brandon",
      rider: null,
      now: NOW,
    });
    expect(response.status).toBe(200);
    const { card } = (await response.json()) as {
      card: { best: { stars: number } } | null;
    };
    if (card) expect(card.best.stars).toBeGreaterThanOrEqual(4);
  });

  it("is asleep with the rest of Gust", async () => {
    expect(
      (
        await post(router({ client: null }), "/nudge", {
          spot: "brandon",
          rider: null,
          now: NOW,
        })
      ).status,
    ).toBe(503);
    expect((await post(router(), "/nudge", { rider: null })).status).toBe(400);
  });
});
