import { describe, expect, it } from "vitest";
import type {
  ChatContext,
  ServerEvent,
  SpotCardData,
} from "../shared/protocol";
import {
  STORAGE_KEY,
  chatReducer,
  historyFor,
  initialChat,
  loadMessages,
  replyText,
  saveMessages,
  type AssistantMessage,
  type ChatState,
} from "./chat";
import { gustMood } from "./mood";

const context: ChatContext = {
  spot: null,
  time: null,
  rider: null,
  now: "2026-09-16T18:00:00Z",
};
const card = (stars: number): SpotCardData => ({
  kind: "spot",
  id: "brandon",
  name: "Brandon Bay",
  county: "Kerry",
  best: {
    from: "2026-09-17T12:00:00Z",
    to: "2026-09-17T15:00:00Z",
    local: "Thu, 17 Sept, 13:00–16:00",
    stars,
    potential: 5,
    wind_kn: 18,
    gust_kn: 24,
    direction: "WSW",
    direction_deg: 248,
    wing_m2: 5,
    own_wing_m2: null,
    shore: "cross-onshore",
    agreement: "high",
  },
  windows: [],
  rider: { weightKg: 80, assumed: true, own: false },
  note: null,
});

function play(...events: ServerEvent[]): ChatState {
  let state = chatReducer(initialChat, {
    type: "send",
    id: "u1",
    replyId: "r1",
    text: "Where?",
    context,
  });
  for (const event of events)
    state = chatReducer(state, { type: "event", event });
  return state;
}
const reply = (state: ChatState) => state.messages.at(-1) as AssistantMessage;
const text = (delta: string): ServerEvent => ({
  event: "text",
  data: { delta },
});
const tool = (status: "running" | "done"): ServerEvent => ({
  event: "tool",
  data: {
    id: "t1",
    name: "find_sessions",
    status,
    label: "Comparing every spot",
  },
});

describe("the chat reducer", () => {
  it("streams words into one paragraph, and starts another after a lookup", () => {
    const state = play(
      text("Let me "),
      text("look."),
      tool("running"),
      tool("done"),
      { event: "card", data: card(4) },
      text(" It's on."),
    );
    expect(state.status).toBe("streaming");
    expect(reply(state).tools).toEqual([
      expect.objectContaining({ status: "done" }),
    ]);
    expect(reply(state).parts).toEqual([
      { kind: "text", text: "Let me look." },
      { kind: "card", card: card(4) },
      { kind: "text", text: "It's on." },
    ]);
  });

  it("settles on done, stoked when a card is worth four stars", () => {
    const stoked = play(
      text("hi"),
      { event: "card", data: card(4) },
      { event: "done", data: {} },
    );
    expect(stoked.status).toBe("idle");
    expect(reply(stoked).live).toBe(false);
    expect(stoked.outcome).toBe("stoked");
    expect(play(text("hi"), { event: "done", data: {} }).outcome).toBe(
      "success",
    );
    expect(chatReducer(stoked, { type: "settle" }).outcome).toBeNull();
  });

  it("withdraws what was said before a refusal", () => {
    const state = play(
      text("Partial"),
      { event: "card", data: card(2) },
      { event: "error", data: { code: "refusal", message: "No." } },
      { event: "done", data: {} },
    );
    expect(reply(state).parts.map((p) => p.kind)).toEqual(["card"]);
    expect(reply(state).error?.code).toBe("refusal");
    expect(state.outcome).toBe("error");
  });

  it("drops a turn refused before it began", () => {
    const state = chatReducer(play(), {
      type: "failed",
      error: { code: "not_configured", message: "asleep" },
    });
    expect(state.messages).toEqual([]);
    expect(state.requestError?.code).toBe("not_configured");
  });

  it("records a proposal's answer", () => {
    const proposal = {
      id: "p1",
      rider: { weightKg: 85, wings: [5] },
      summary: "Save?",
    };
    let state = play(
      { event: "proposal", data: proposal },
      { event: "done", data: {} },
    );
    state = chatReducer(state, { type: "proposal", id: "p1", status: "saved" });
    expect(reply(state).parts[0]).toEqual({
      kind: "proposal",
      proposal,
      status: "saved",
    });
  });
});

describe("history for the server", () => {
  it("echoes words and what was shown, never the live reply", () => {
    const done = play(
      text("Brandon's on."),
      { event: "card", data: card(4) },
      { event: "done", data: {} },
    );
    expect(historyFor(done.messages)).toEqual([
      { role: "user", text: "Where?", context },
      {
        role: "assistant",
        text: "Brandon's on.\n\n[Showed a card: Brandon Bay (id brandon), 4★ Thu, 17 Sept, 13:00–16:00, 18 kn WSW, cross-onshore, 5 m² wing]",
      },
    ]);
    expect(historyFor(play(text("still going")).messages)).toEqual([
      { role: "user", text: "Where?", context },
    ]);
  });

  it("keeps the last twenty, starting with the rider", () => {
    let state = initialChat;
    for (let i = 0; i < 15; i++) {
      state = chatReducer(state, {
        type: "send",
        id: `u${i}`,
        replyId: `r${i}`,
        text: `q${i}`,
        context,
      });
      state = chatReducer(state, { type: "event", event: text(`a${i}`) });
      state = chatReducer(state, {
        type: "event",
        event: { event: "done", data: {} },
      });
    }
    const history = historyFor(state.messages);
    expect(history).toHaveLength(20);
    expect(history[0]).toMatchObject({ role: "user", text: "q5" });
  });

  it("says when a reply had nothing in it", () => {
    expect(
      replyText({
        id: "r",
        role: "assistant",
        parts: [],
        tools: [],
        actions: [],
        error: null,
        live: false,
      }),
    ).toBe("[No answer]");
  });
});

describe("persistence", () => {
  const store = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      map,
    };
  };

  it("round-trips the transcript and ends a reply that was streaming", () => {
    const s = store();
    const live = play(text("half"));
    saveMessages(live.messages, s);
    const back = loadMessages(s);
    expect(back[0]).toMatchObject({ role: "user", text: "Where?" });
    expect(back[1]).toMatchObject({
      live: false,
      error: { code: "interrupted" },
    });
    saveMessages([], s);
    expect(s.map.has(STORAGE_KEY)).toBe(false);
  });

  it("survives garbage and a store that throws", () => {
    const s = store();
    s.setItem(STORAGE_KEY, "{not json");
    expect(loadMessages(s)).toEqual([]);
    s.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { role: "hacker" },
        { role: "user", text: "ok", id: "1", context },
      ]),
    );
    expect(loadMessages(s)).toHaveLength(1);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {},
    };
    expect(loadMessages(broken)).toEqual([]);
    expect(() => saveMessages(play().messages, broken)).not.toThrow();
  });
});

describe("Gust's mood", () => {
  const base = {
    configured: true,
    open: false,
    typing: false,
    busy: false,
    outcome: null,
    nudge: false,
  } as const;
  it("follows what is going on", () => {
    expect(gustMood(base)).toBe("idle");
    expect(gustMood({ ...base, configured: false, busy: true })).toBe("asleep");
    expect(gustMood({ ...base, busy: true, nudge: true })).toBe("thinking");
    expect(gustMood({ ...base, outcome: "error" })).toBe("error");
    expect(gustMood({ ...base, open: true, typing: true })).toBe("listening");
    expect(gustMood({ ...base, nudge: true })).toBe("stoked");
    expect(gustMood({ ...base, nudge: true, open: true })).toBe("idle");
  });
});
