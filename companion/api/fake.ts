/**
 * A scripted stand-in for Claude, for development and the e2e suite only
 * (COMPANION_FAKE=1, refused in production). It speaks the same streaming
 * events the SDK yields, so the whole loop — text, tool calls, tool results,
 * cards, map actions, proposals — runs exactly as it does against the API,
 * with answers built from the real tool results rather than invented.
 *
 * It is not clever: it picks a tool from a few words in the rider's message,
 * then reads that tool's result back in a sentence or two.
 */
import type {
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ModelClient, ModelStream } from "./agent.js";

export type FakeBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    };

const textOf = (message: BetaMessageParam | undefined): string => {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n");
};

/** The rider's last words and the app's context after them. */
function lastAsk(messages: BetaMessageParam[]) {
  let i = messages.length - 1;
  let context = "";
  if (messages[i]?.role === "system") context = textOf(messages[i--]);
  const text = textOf(messages[i]);
  const spot = /\(id ([^)]+)\)/.exec(context + "\n" + text)?.[1] ?? null;
  return { text, spot };
}

function pickTool(text: string, spot: string | null): FakeBlock {
  const ask = text.toLowerCase();
  const id = `toolu_fake_${Math.random().toString(36).slice(2, 10)}`;
  if (/profile|\bkg\b|weigh/.test(ask)) {
    const kg = /(\d{2,3})\s*kg/.exec(ask)?.[1];
    const wings = [...ask.matchAll(/(\d(?:\.5)?)\s*(?:m|m²|,|\/|and)/g)]
      .map((m) => Number(m[1]))
      .filter((n) => n >= 1.5 && n <= 10);
    return {
      type: "tool_use",
      id,
      name: "propose_rider_profile",
      input: {
        weight_kg: kg ? Number(kg) : 85,
        wings_m2: wings.length ? wings : [4, 5, 6],
      },
    };
  }
  if (/show|on the map|take me/.test(ask))
    return {
      type: "tool_use",
      id,
      name: "show_on_map",
      input: { spot_id: spot ?? "brandon", time: null, highlight_ids: null },
    };
  if (/wing|weekend|\bon\b/.test(ask))
    return {
      type: "tool_use",
      id,
      name: "get_spot_forecast",
      input: { spot: spot ?? "brandon", date: null, days: null },
    };
  return {
    type: "tool_use",
    id,
    name: "find_sessions",
    input: { date: null, days: null, county: null, min_stars: null },
  };
}

interface Best {
  local: string;
  stars: number;
  wind_kn: number;
  gust_kn: number | null;
  direction: string;
  wing_m2: number;
  own_wing_m2: number | null;
  shore: string | null;
}

const stars = (n: number) => `${n} star${n === 1 ? "" : "s"}`;

function describe(name: string, best: Best, assumed: boolean): string {
  const wing = best.own_wing_m2 ?? best.wing_m2;
  const gust = best.gust_kn === null ? "" : ` gusting ${best.gust_kn}`;
  let text = `**${name}** is your best bet: ${stars(best.stars)} for ${best.local}, ${best.wind_kn} kn${gust} from the ${best.direction}. Take the ${wing} m² wing.`;
  if (best.shore?.includes("offshore"))
    text += ` Heads up: that's ${best.shore}, so it blows you away from the beach. Ride with a buddy or pick another spot.`;
  if (assumed)
    text += " These stars assume 80 kg; want to set up your rider profile?";
  return text;
}

/** Gust's words once a tool has answered, from that tool's own result. */
function reply(name: string, raw: string): string {
  let result: Record<string, any>;
  try {
    result = JSON.parse(raw);
  } catch {
    result = {};
  }
  if (result.error) return `Sorry, I couldn't get that: ${result.error}`;
  const assumed = Boolean(result.rider?.weight_assumed);
  switch (name) {
    case "find_sessions": {
      const top = result.spots?.[0];
      if (!top?.best_window)
        return "Nothing's looking rideable in that stretch, I'm afraid. Want me to look further ahead?";
      return describe(top.name, top.best_window, assumed);
    }
    case "get_spot_forecast":
      return result.best_window
        ? describe(result.spot.name, result.best_window, assumed)
        : `${result.spot?.name ?? "That spot"} has no rideable window in that stretch.`;
    case "propose_rider_profile":
      return "I've put that on a card for you: tap **Confirm** to save it, and I'll rate everything for you from then on.";
    case "show_on_map":
      return "There you go, it's on the map.";
    default:
      return "Done.";
  }
}

function events(
  blocks: FakeBlock[],
  stop: string,
): BetaRawMessageStreamEvent[] {
  const out: unknown[] = [
    {
      type: "message_start",
      message: {
        id: "msg_fake",
        type: "message",
        role: "assistant",
        content: [],
      },
    },
  ];
  blocks.forEach((block, index) => {
    if (block.type === "text") {
      out.push({
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      });
      for (const piece of block.text.match(/\S+\s*/g) ?? [])
        out.push({
          type: "content_block_delta",
          index,
          delta: { type: "text_delta", text: piece },
        });
    } else {
      out.push({
        type: "content_block_start",
        index,
        content_block: { ...block, input: {} },
      });
      out.push({
        type: "content_block_delta",
        index,
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify(block.input),
        },
      });
    }
    out.push({ type: "content_block_stop", index });
  });
  out.push({
    type: "message_delta",
    delta: { stop_reason: stop },
    usage: { output_tokens: 1 },
  });
  out.push({ type: "message_stop" });
  return out as BetaRawMessageStreamEvent[];
}

/** A streamed model call that yields `blocks` and stops for `stop`. */
export function fakeStream(
  blocks: FakeBlock[],
  stop: string,
  delayMs = 0,
): ModelStream {
  const message = {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "fake",
    content: blocks,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as BetaMessage;
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events(blocks, stop)) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        yield event;
      }
    },
    finalMessage: async () => message,
  };
}

export function fakeClient(options: { delayMs?: number } = {}): ModelClient {
  const delayMs = options.delayMs ?? 30;
  return {
    stream(params: BetaMessageStreamParams) {
      const messages = params.messages;
      const last = messages.at(-1);
      // After tools: read the last result back.
      if (last?.role === "user" && Array.isArray(last.content)) {
        const result = last.content.find((b) => b.type === "tool_result");
        if (result && result.type === "tool_result") {
          const call = messages.at(-2)?.content;
          const use = Array.isArray(call)
            ? call.find(
                (b) => b.type === "tool_use" && b.id === result.tool_use_id,
              )
            : undefined;
          const name = use && use.type === "tool_use" ? use.name : "";
          const raw =
            typeof result.content === "string"
              ? result.content
              : (result.content ?? [])
                  .map((b) => (b.type === "text" ? b.text : ""))
                  .join("");
          return fakeStream(
            [{ type: "text", text: reply(name, raw) }],
            "end_turn",
            delayMs,
          );
        }
      }
      const { text, spot } = lastAsk(messages);
      return fakeStream(
        [{ type: "text", text: "Let me have a look. " }, pickTool(text, spot)],
        "tool_use",
        delayMs,
      );
    },
  };
}
