import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaMessageStreamParams,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import { FIXTURE_NOW, fixtureSource } from "../../mcp/api/testing";
import type { ChatRequest, ServerEvent } from "../shared/protocol";
import {
  FALLBACK_BETA,
  buildMessages,
  echoable,
  requestParams,
  runTurn,
  type ModelClient,
} from "./agent";
import { fakeClient, fakeStream, type FakeBlock } from "./fake";
import { SYSTEM } from "./prompt";

const NOW = new Date(FIXTURE_NOW).toISOString();
const request = (
  text: string,
  extra: Partial<ChatRequest> = {},
): ChatRequest => ({
  messages: [{ role: "user", text }],
  context: {
    spot: { id: "brandon", name: "Brandon Bay" },
    time: "2026-09-17T12:00:00Z",
    rider: null,
    now: NOW,
  },
  ...extra,
});

/** A client that answers each call from a script and remembers what it was sent. */
function scripted(turns: { blocks: FakeBlock[]; stop: string }[]) {
  const calls: BetaMessageStreamParams[] = [];
  const client: ModelClient = {
    stream(params) {
      calls.push(structuredClone(params));
      const turn = turns[calls.length - 1];
      if (!turn) throw new Error("the script ran out");
      return fakeStream(turn.blocks, turn.stop);
    },
  };
  return { client, calls };
}

async function turn(
  client: ModelClient,
  req = request("Is Brandon on?"),
  maxCalls?: number,
) {
  const events: ServerEvent[] = [];
  await runTurn(
    req,
    {
      client,
      source: fixtureSource(),
      now: FIXTURE_NOW,
      newId: () => "p1",
      maxCalls,
    },
    (e) => events.push(e),
  );
  return events;
}

const forecastCall: FakeBlock = {
  type: "tool_use",
  id: "toolu_1",
  name: "get_spot_forecast",
  input: { spot: "brandon", date: null, days: null },
};

describe("the request", () => {
  it("is shaped for claude-haiku-5-5 by default: effort, caching, no fallbacks, no thinking switch", () => {
    const params = requestParams([{ role: "user", content: "hi" }], {
      effort: "medium",
    });
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.output_config).toEqual({ effort: "medium" });
    // Haiku has no server-side refusal fallback.
    expect(params).not.toHaveProperty("betas");
    expect(params).not.toHaveProperty("fallbacks");
    expect(params).not.toHaveProperty("thinking");
    expect(params).not.toHaveProperty("tool_choice");
    expect(params.cache_control).toEqual({ type: "ephemeral" });
    expect(params.system).toEqual([
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
    ]);
    expect(requestParams([], {}).output_config).toEqual({ effort: "low" });
  });

  it("asks a larger model for refusal fallbacks", () => {
    const params = requestParams([], { model: "claude-opus-5-5" });
    expect(params.betas).toEqual([FALLBACK_BETA]);
    expect(FALLBACK_BETA).toBe("server-side-fallback-2026-07-01");
    expect(params.fallbacks).toBe("default");
  });

  it("keeps the system prompt frozen: no dates or names in it", () => {
    expect(SYSTEM).not.toMatch(/20\d\d-\d\d-\d\d|app_context|\$\{/);
  });

  it("puts each message's context after it, as a system message, only where one may go", () => {
    const req: ChatRequest = {
      messages: [
        { role: "assistant", text: "a stray greeting" },
        {
          role: "user",
          text: "first",
          context: { spot: null, time: null, rider: null, now: NOW },
        },
        { role: "assistant", text: "answer" },
        {
          role: "user",
          text: "orphan",
          context: { spot: null, time: null, rider: null, now: NOW },
        },
        { role: "user", text: "latest" },
      ],
      context: request("x").context,
    };
    const messages = buildMessages(req, FIXTURE_NOW);
    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "system",
      "assistant",
      "user",
      "user",
      "system",
    ]);
    const last = messages.at(-1)!.content as string;
    expect(last).toMatch(
      /Selected spot on the map: Brandon Bay \(id brandon\)/,
    );
    expect(last).toMatch(/Wednesday 16 September 2026 \(2026-09-16\)/);
    expect(last).toMatch(/weight not set \(ratings assume 80 kg\)/);
    expect(last).toMatch(/timeline is at Thu, 17 Sept, 13:00 \(tomorrow\)/);
    // Replaying the same history renders the same bytes: the prefix caches.
    expect(buildMessages(req, FIXTURE_NOW + 60000)).toEqual(messages);
  });

  it("can carry the context inside the user turn instead", () => {
    const messages = buildMessages(request("hi"), FIXTURE_NOW, "user");
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toEqual([
      { type: "text", text: "hi" },
      { type: "text", text: expect.stringContaining("<app_context>") },
    ]);
  });

  it("echoes only what the serving model can read after a fallback", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "s" },
      { type: "text", text: "Let me look." },
      { type: "tool_use", id: "x", name: "list_spots", input: {} },
      { type: "fallback", from: { model: "a" }, to: { model: "b" } },
      { type: "text", text: "Here." },
    ] as unknown as BetaContentBlock[];
    expect(echoable(content).map((b) => b.type)).toEqual([
      "text",
      "fallback",
      "text",
    ]);
  });
});

describe("a turn", () => {
  it("runs tool_use → tool_result → end_turn, streaming text, chips and the card", async () => {
    const { client, calls } = scripted([
      {
        blocks: [{ type: "text", text: "Checking. " }, forecastCall],
        stop: "tool_use",
      },
      { blocks: [{ type: "text", text: "Looks grand." }], stop: "end_turn" },
    ]);
    const events = await turn(client);
    const kinds = events.map((e) => e.event);
    expect(kinds[0]).toBe("text");
    expect(kinds.indexOf("tool")).toBeLessThan(kinds.indexOf("card"));
    expect(kinds.at(-1)).toBe("text");
    expect(events.filter((e) => e.event === "tool").map((e) => e.data)).toEqual(
      [
        expect.objectContaining({
          id: "toolu_1",
          status: "running",
          label: "Checking Brandon Bay",
        }),
        expect.objectContaining({ id: "toolu_1", status: "done" }),
      ],
    );
    expect(events.find((e) => e.event === "card")!.data).toMatchObject({
      kind: "spot",
      id: "brandon",
    });
    expect(
      events
        .filter((e) => e.event === "text")
        .map((e) => (e.data as { delta: string }).delta)
        .join(""),
    ).toBe("Checking. Looks grand.");

    // The second call carries the assistant turn and the tool's result back.
    expect(calls).toHaveLength(2);
    const sent = calls[1].messages;
    expect(sent.at(-2)!.role).toBe("assistant");
    const results = sent.at(-1)!.content as {
      type: string;
      tool_use_id: string;
      content: string;
    }[];
    expect(results[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "toolu_1",
    });
    expect(JSON.parse(results[0].content).spot.id).toBe("brandon");
    // Same tools and system on every call: the cached prefix holds.
    expect(calls[1].tools).toEqual(calls[0].tools);
    expect(calls[1].system).toEqual(calls[0].system);
  });

  it("sends map actions and proposals as their own events", async () => {
    const { client } = scripted([
      {
        blocks: [
          {
            type: "tool_use",
            id: "a",
            name: "show_on_map",
            input: { spot_id: "keel", time: null, highlight_ids: null },
          },
          {
            type: "tool_use",
            id: "b",
            name: "propose_rider_profile",
            input: { weight_kg: 70, level: "beginner", wings_m2: [5] },
          },
        ],
        stop: "tool_use",
      },
      { blocks: [{ type: "text", text: "Done." }], stop: "end_turn" },
    ]);
    const events = await turn(client);
    expect(events.find((e) => e.event === "action")!.data).toEqual({
      type: "select_spot",
      id: "keel",
    });
    expect(events.find((e) => e.event === "proposal")!.data).toMatchObject({
      id: "p1",
      rider: { weightKg: 70, skill: "beginner", wings: [5] },
    });
  });

  it("answers an unknown tool with an error result rather than failing", async () => {
    const { client, calls } = scripted([
      {
        blocks: [
          { type: "tool_use", id: "z", name: "launch_rockets", input: {} },
        ],
        stop: "tool_use",
      },
      { blocks: [{ type: "text", text: "Sorry." }], stop: "end_turn" },
    ]);
    const events = await turn(client);
    expect(
      events.find((e) => e.event === "tool" && e.data.status === "error"),
    ).toBeTruthy();
    const results = calls[1].messages.at(-1)!.content as {
      is_error?: boolean;
    }[];
    expect(results[0].is_error).toBe(true);
  });

  it("ends on a refusal without running that turn's tools", async () => {
    const { client, calls } = scripted([
      {
        blocks: [{ type: "text", text: "Partial" }, forecastCall],
        stop: "refusal",
      },
    ]);
    const events = await turn(client);
    expect(calls).toHaveLength(1);
    expect(events.some((e) => e.event === "tool")).toBe(false);
    expect(events.at(-1)).toMatchObject({
      event: "error",
      data: { code: "refusal" },
    });
  });

  it("says when an answer was cut short, and never runs a truncated tool call", async () => {
    const cut = await turn(
      scripted([{ blocks: [{ type: "text", text: "So" }], stop: "max_tokens" }])
        .client,
    );
    expect(cut.at(-1)).toMatchObject({
      event: "error",
      data: { code: "cut_short" },
    });
    const truncated = await turn(
      scripted([{ blocks: [forecastCall], stop: "max_tokens" }]).client,
    );
    expect(truncated.some((e) => e.event === "tool")).toBe(false);
    expect(truncated.at(-1)).toMatchObject({
      event: "error",
      data: { code: "truncated" },
    });
  });

  it("stops after the most model calls a turn may make", async () => {
    const loop = { blocks: [forecastCall], stop: "tool_use" };
    const { client, calls } = scripted([loop, loop, loop, loop]);
    const events = await turn(client, undefined, 3);
    expect(calls).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({
      event: "error",
      data: { code: "too_many_steps" },
    });
  });

  it("turns an API failure into words fit to show", async () => {
    const client: ModelClient = {
      stream() {
        throw new Anthropic.RateLimitError(
          429,
          undefined,
          "slow down",
          new Headers(),
        );
      },
    };
    const events = await turn(client);
    expect(events).toEqual([
      { event: "error", data: expect.objectContaining({ code: "busy" }) },
    ]);
  });

  it("retries with the context in the user turn when system messages are refused", async () => {
    const calls: BetaMessageStreamParams[] = [];
    const client: ModelClient = {
      stream(params) {
        calls.push(params);
        if (calls.length === 1)
          throw new Anthropic.BadRequestError(
            400,
            undefined,
            "role 'system' is not supported",
            new Headers(),
          );
        return fakeStream([{ type: "text", text: "Hi." }], "end_turn");
      },
    };
    const events = await turn(client);
    expect(calls).toHaveLength(2);
    expect(calls[1].messages.every((m) => m.role !== "system")).toBe(true);
    expect(events).toEqual([{ event: "text", data: { delta: "Hi." } }]);
  });
});

describe("the scripted fake", () => {
  it("looks something up and reads the real result back", async () => {
    const events = await turn(
      fakeClient({ delayMs: 0 }),
      request("Where's best tomorrow?"),
    );
    expect(events.filter((e) => e.event === "tool")[0].data).toMatchObject({
      name: "find_sessions",
    });
    expect(events.some((e) => e.event === "card")).toBe(true);
    const words = events
      .filter((e) => e.event === "text")
      .map((e) => (e.data as { delta: string }).delta)
      .join("");
    expect(words).toMatch(/your best bet|Nothing's looking rideable/);
  });

  it("proposes a profile from what the rider said", async () => {
    const events = await turn(
      fakeClient({ delayMs: 0 }),
      request("I'm 92 kg with a 4 and 6 m"),
    );
    expect(events.find((e) => e.event === "proposal")!.data).toMatchObject({
      rider: { weightKg: 92, wings: [4, 6] },
    });
  });
});
