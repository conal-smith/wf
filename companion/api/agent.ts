/**
 * One turn of Gust: a manual streaming tool-use loop over the Claude API.
 *
 * Each call streams Claude's words to the browser as they arrive, then reads
 * the final message to decide what happens next: tools run here on the server
 * and their results go back to Claude, until it answers without asking for
 * more or the turn has made `maxCalls` model calls. A tool's cards, map
 * actions and proposals go straight to the browser as their own events, so
 * the rider sees the forecast's numbers rather than Claude's retelling of them.
 *
 * Request shape, per the Claude API guidance for claude-opus-5-5:
 * - thinking is adaptive and always on for this model, so `thinking` is
 *   omitted; `output_config.effort` (COMPANION_EFFORT, default low) is the
 *   latency control, and max_tokens leaves room for the thinking;
 * - tool_choice stays auto (forced tool use is a 400 here); the tools are
 *   strict and stream their inputs eagerly, so every input is validated here
 *   before it runs (tools.ts);
 * - refusals are retried server-side on Anthropic's recommended fallback
 *   model (`fallbacks: "default"`, beta server-side-fallback-2026-07-01), and
 *   a refusal that still comes back ends the turn without its partial words;
 * - caching: an explicit breakpoint on the frozen system prompt (which, after
 *   the sorted tools, is the shared prefix) plus top-level automatic caching
 *   for the conversation tail the loop grows;
 * - the volatile context rides in a mid-conversation system message after the
 *   rider's words (prompt.ts), not in the system prompt.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ForecastSource } from "../../mcp/api/source.js";
import {
  MAX_HISTORY,
  type ChatRequest,
  type ServerEvent,
  type ToolActivity,
} from "../shared/protocol.js";
import { SYSTEM, renderContext } from "./prompt.js";
import {
  TOOL_DEFINITIONS,
  riderFrom,
  toolNamed,
  type ToolContext,
  type ToolOutcome,
} from "./tools.js";

export const COMPANION_MODEL = "claude-opus-5-5";
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** A streamed model call: its raw events, then the whole message. */
export interface ModelStream extends AsyncIterable<BetaRawMessageStreamEvent> {
  finalMessage(): Promise<BetaMessage>;
}

/** The one seam between Gust and a model: the Claude API, or a scripted fake. */
export interface ModelClient {
  stream(
    params: BetaMessageStreamParams,
    options: { signal?: AbortSignal },
  ): ModelStream;
}

export function anthropicClient(apiKey: string): ModelClient {
  const sdk = new Anthropic({ apiKey });
  return {
    stream: (params, options) => sdk.beta.messages.stream(params, options),
  };
}

export interface AgentOptions {
  client: ModelClient;
  source: ForecastSource;
  model?: string;
  effort?: Effort;
  /** Model calls one turn may make, tool loops included. */
  maxCalls?: number;
  maxTokens?: number;
  now: number;
  newId: () => string;
}

type Emit = (event: ServerEvent) => void;
type ContextChannel = "system" | "user";

/**
 * The conversation as Claude reads it. Each user message is followed by the
 * app's context as it was when that message was sent, so replaying an old
 * turn renders the same bytes. A context message may only sit before an
 * assistant turn or at the very end; anywhere else it is left out.
 */
export function buildMessages(
  request: ChatRequest,
  serverNow: number,
  channel: ContextChannel = "system",
): BetaMessageParam[] {
  const turns = request.messages.slice(-MAX_HISTORY);
  while (turns[0]?.role === "assistant") turns.shift();
  const out: BetaMessageParam[] = [];
  turns.forEach((turn, i) => {
    if (turn.role === "assistant") {
      out.push({ role: "assistant", content: turn.text });
      return;
    }
    const last = i === turns.length - 1;
    const context = last ? request.context : turn.context;
    if (!context || !(last || turns[i + 1]?.role === "assistant")) {
      out.push({ role: "user", content: turn.text });
      return;
    }
    const rendered = renderContext(context, serverNow);
    if (channel === "system")
      out.push(
        { role: "user", content: turn.text },
        { role: "system", content: rendered },
      );
    else
      out.push({
        role: "user",
        content: [
          { type: "text", text: turn.text },
          { type: "text", text: rendered },
        ],
      });
  });
  return out;
}

export function requestParams(
  messages: BetaMessageParam[],
  options: Pick<AgentOptions, "model" | "effort" | "maxTokens">,
): BetaMessageStreamParams {
  return {
    model: options.model ?? COMPANION_MODEL,
    max_tokens: options.maxTokens ?? 8000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: options.effort ?? "low" },
    cache_control: { type: "ephemeral" },
    system: [
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    tools: TOOL_DEFINITIONS,
    messages,
  };
}

/**
 * The assistant content to send back. After a refusal fallback, the blocks the
 * declined model produced before the last `fallback` marker are dropped,
 * except its text: the fallback model cannot read the rest.
 */
export function echoable(content: readonly BetaContentBlock[]) {
  const cut = content.map((b) => b.type).lastIndexOf("fallback");
  return content.filter(
    (b, i) => i >= cut || b.type === "text",
  ) as unknown as BetaContentBlockParam[];
}

/** The tool calls to run: the ones the serving model made, after any fallback. */
function toolUses(content: readonly BetaContentBlock[]): BetaToolUseBlock[] {
  const cut = content.map((b) => b.type).lastIndexOf("fallback");
  return content.filter(
    (b, i): b is BetaToolUseBlock => i > cut && b.type === "tool_use",
  );
}

export function friendlyError(error: unknown): {
  code: string;
  message: string;
} {
  if (
    error instanceof Anthropic.RateLimitError ||
    error instanceof Anthropic.InternalServerError
  )
    return {
      code: "busy",
      message:
        "Gust is a bit swamped right now. Give it a minute and try again.",
    };
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  )
    return {
      code: "upstream",
      message: "Gust can't reach the AI service from this server just now.",
    };
  return {
    code: "upstream",
    message: "Something went wrong reaching the AI service. Try again.",
  };
}

async function runTool(
  use: BetaToolUseBlock,
  ctx: ToolContext,
  emit: Emit,
): Promise<BetaToolResultBlockParam> {
  const tool = toolNamed(use.name);
  const activity: ToolActivity = {
    id: use.id,
    name: use.name,
    status: "running",
    label: tool ? tool.label(use.input, ctx) : "Looking something up",
  };
  emit({ event: "tool", data: activity });
  let outcome: ToolOutcome;
  try {
    outcome = tool
      ? await tool.run(use.input, ctx)
      : {
          result: { error: `There is no tool called ${use.name}.` },
          isError: true,
          summary: "Unknown tool",
        };
  } catch (error) {
    console.error("companion: tool failed", use.name, error);
    outcome = {
      result: { error: "The forecast could not be read just now." },
      isError: true,
      summary: "Couldn't read the forecast",
    };
  }
  emit({
    event: "tool",
    data: {
      ...activity,
      status: outcome.isError ? "error" : "done",
      summary: outcome.summary,
    },
  });
  for (const card of outcome.cards ?? []) emit({ event: "card", data: card });
  for (const action of outcome.actions ?? [])
    emit({ event: "action", data: action });
  if (outcome.proposal) emit({ event: "proposal", data: outcome.proposal });
  return {
    type: "tool_result",
    tool_use_id: use.id,
    content: JSON.stringify(outcome.result),
    ...(outcome.isError ? { is_error: true } : {}),
  };
}

/** Runs one turn, emitting events as it goes. The caller sends `done`. */
export async function runTurn(
  request: ChatRequest,
  options: AgentOptions,
  emit: Emit,
  signal?: AbortSignal,
): Promise<void> {
  const ctx: ToolContext = {
    source: options.source,
    now: options.now,
    rider: riderFrom(request.context.rider),
    context: request.context,
    newId: options.newId,
  };
  const maxCalls = options.maxCalls ?? 6;
  let channel: ContextChannel = "system";
  let messages = buildMessages(request, options.now, channel);
  let calls = 0;
  let wrote = false;
  let unparseable = 0;

  for (;;) {
    if (calls >= maxCalls) {
      emit({
        event: "error",
        data: {
          code: "too_many_steps",
          message:
            "That took more looking up than Gust can do in one go. Try a narrower question.",
        },
      });
      return;
    }
    calls++;
    let message: BetaMessage;
    try {
      const stream = options.client.stream(requestParams(messages, options), {
        signal,
      });
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta" &&
          event.delta.text
        ) {
          wrote = true;
          emit({ event: "text", data: { delta: event.delta.text } });
        }
      }
      message = await stream.finalMessage();
      unparseable = 0;
    } catch (error) {
      if (signal?.aborted) return;
      // A model that does not take mid-conversation system messages answers
      // 400 before any output: carry the context in the user turn instead.
      if (
        error instanceof Anthropic.BadRequestError &&
        channel === "system" &&
        calls === 1 &&
        !wrote
      ) {
        console.warn("companion: retrying with the context in the user turn");
        channel = "user";
        messages = buildMessages(request, options.now, channel);
        calls = 0;
        continue;
      }
      if (error instanceof Anthropic.APIError) {
        console.error(
          "companion: model call failed",
          error.status,
          error.message,
        );
        emit({ event: "error", data: friendlyError(error) });
        return;
      }
      // A tool input streamed eagerly can fail to parse at all; re-issue the
      // turn a couple of times, as the SDK guidance says, then give up.
      if (unparseable++ < 2) {
        calls--;
        continue;
      }
      throw error;
    }

    const content = echoable(message.content);
    const uses = toolUses(message.content);
    switch (message.stop_reason) {
      case "refusal":
        emit({
          event: "error",
          data: {
            code: "refusal",
            message:
              "Gust can't help with that one. Ask about the wind, the spots or your next session.",
          },
        });
        return;
      case "pause_turn":
        messages = [...messages, { role: "assistant", content }];
        continue;
      case "max_tokens":
        emit({
          event: "error",
          data: uses.length
            ? {
                code: "truncated",
                message: "Gust ran out of room mid-lookup. Try asking again.",
              }
            : { code: "cut_short", message: "Gust's answer was cut short." },
        });
        return;
      case "tool_use":
        break;
      default:
        return;
    }
    if (!uses.length) return;
    const results: BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      if (signal?.aborted) return;
      results.push(await runTool(use, ctx, emit));
    }
    messages = [
      ...messages,
      { role: "assistant", content },
      { role: "user", content: results },
    ];
  }
}
