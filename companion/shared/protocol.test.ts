import { describe, expect, it } from "vitest";
import {
  createSseParser,
  encodeSse,
  riderSummary,
  toServerEvent,
  type ServerEvent,
} from "./protocol";

const EVENTS: ServerEvent[] = [
  { event: "text", data: { delta: "Grand day\nfor it: **go**" } },
  {
    event: "tool",
    data: {
      id: "t1",
      name: "find_sessions",
      status: "running",
      label: "Comparing every spot",
    },
  },
  { event: "action", data: { type: "select_spot", id: "brandon" } },
  { event: "error", data: { code: "busy", message: "Try again." } },
  { event: "done", data: {} },
];

describe("server-sent events", () => {
  it("round-trips every event through the encoder and the parser", () => {
    const parse = createSseParser();
    const wire = EVENTS.map(encodeSse).join("");
    const out = parse(wire).map(toServerEvent);
    expect(out).toEqual(EVENTS);
  });

  it("reassembles events split across arbitrary chunks", () => {
    const wire = EVENTS.map(encodeSse).join("");
    for (const size of [1, 3, 7, 64]) {
      const parse = createSseParser();
      const got: ServerEvent[] = [];
      for (let i = 0; i < wire.length; i += size)
        for (const m of parse(wire.slice(i, i + size)))
          got.push(toServerEvent(m)!);
      expect(got).toEqual(EVENTS);
    }
  });

  it("reads CRLF, comments and multi-line data, and holds back a partial event", () => {
    const parse = createSseParser();
    expect(
      parse(
        ': keep-alive\r\n\r\nevent: text\r\ndata: {"delta":\r\ndata: "hi"}\r\n\r\nevent: done\ndata: {}',
      ),
    ).toEqual([{ event: "text", data: '{"delta":\n"hi"}' }]);
    expect(parse("\n\n")).toEqual([{ event: "done", data: "{}" }]);
  });

  it("ignores events and payloads that are not Gust's", () => {
    expect(toServerEvent({ event: "message", data: "{}" })).toBeNull();
    expect(toServerEvent({ event: "text", data: "not json" })).toBeNull();
    expect(toServerEvent({ event: "text", data: "42" })).toBeNull();
  });
});

describe("riderSummary", () => {
  it("says what a proposal card says", () => {
    expect(
      riderSummary({ weightKg: 85, skill: "intermediate", wings: [4, 5, 6] }),
    ).toBe("85 kg · Riding · 4/5/6 m");
    expect(riderSummary({ weightKg: null, skill: "beginner", wings: [] })).toBe(
      "80 kg (assumed) · Learning",
    );
  });
});
