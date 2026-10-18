/**
 * Gust over HTTP, mounted at /api/companion by createApp.
 *
 *   GET  /status  whether Gust can answer here: awake, asleep (no API key),
 *                 resting (this month's budget is spent) or off (FEATURE_GUST)
 *   POST /nudge   a selected spot's best window in the next 48 h when it is
 *                 worth four stars or more: no model call, just the forecast
 *   POST /chat    one turn, answered as server-sent events (protocol.ts)
 *
 * Stateless: the browser sends the conversation (bounded) and its context with
 * every turn and keeps the transcript itself. Without ANTHROPIC_API_KEY (and
 * without COMPANION_FAKE in development) chat answers 503 not_configured and
 * nothing pretends to be Gust. Once the month's budget is spent it answers 503
 * budget_exhausted until the 1st, pointing the rider at their own assistant.
 */
import { randomUUID } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { createLimiter, type Limiter } from "../../community/api/limits.js";
import type { ForecastSource } from "../../mcp/api/source.js";
import {
  type Availability,
  MAX_ECHO_CHARS,
  MAX_HISTORY,
  MAX_MESSAGE_CHARS,
  encodeSse,
  type ChatRequest,
  type ServerEvent,
} from "../shared/protocol.js";
import { runTurn, type Effort, type ModelClient } from "./agent.js";
import type { Budget } from "./budget.js";
import { customRatingSchema } from "../../site/shared/validate.js";
import { riderFrom, toolNamed, type ToolContext } from "./tools.js";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export interface CompanionDeps {
  /** Null when Gust is not configured: chat answers 503. */
  client: ModelClient | null;
  /** Where the forecast is read. Null leaves Gust asleep too. */
  source: ForecastSource | null;
  model?: string;
  effort?: Effort;
  /** True for the scripted fake (dev and e2e only). */
  fake?: boolean;
  /**
   * Read "now" from the browser's context rather than the server clock. Only
   * the fake does: the e2e suite runs on a calendar frozen in September 2026.
   */
  trustClientClock?: boolean;
  now?: () => number;
  /** Per-IP rate limits. Left out, the defaults below. */
  limiter?: Limiter;
  /** False switches Gust off (FEATURE_GUST): the site hides him. Left out, on. */
  enabled?: boolean;
  /** The monthly spend cap. Left out, no cap. */
  budget?: Budget | null;
}

/** A chat turn is several model calls: a burst of a few, a steady trickle after. */
export const COMPANION_RATES = {
  message: [
    { max: 6, perMs: MINUTE },
    { max: 60, perMs: HOUR },
  ],
  thread: [],
  reaction: [],
  report: [],
};

const riderSchema = z.object({
  weightKg: z.number().min(0).max(500).nullable(),
  skill: z.enum(["beginner", "intermediate", "advanced"]),
  wings: z.array(z.number().min(0).max(50)).max(12),
  custom: customRatingSchema.nullable().optional(),
});

const contextSchema = z.object({
  spot: z
    .object({ id: z.string().min(1).max(80), name: z.string().min(1).max(120) })
    .nullable(),
  time: z.string().max(40).nullable(),
  rider: riderSchema.nullable(),
  now: z.string().max(40),
});

const turnSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("user"),
    text: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
    context: contextSchema.optional(),
  }),
  z.object({
    role: z.literal("assistant"),
    text: z.string().trim().min(1).max(MAX_ECHO_CHARS),
  }),
]);

export const chatRequestSchema = z
  .object({
    messages: z
      .array(turnSchema)
      .min(1)
      .max(MAX_HISTORY * 2),
    context: contextSchema,
  })
  .refine((r) => r.messages.at(-1)?.role === "user", {
    message: "The last message must be the rider's.",
    path: ["messages"],
  });

const nudgeSchema = z.object({
  spot: z.string().min(1).max(80),
  rider: riderSchema.nullable(),
  now: z.string().max(40),
});

const notConfigured = {
  code: "not_configured",
  message: "Gust is asleep: the companion is not configured on this server.",
};

const switchedOff = {
  code: "off",
  message: "Gust is switched off on this site.",
};

/** "1 November", for the day the allowance comes back. */
const dayOf = (iso: string) =>
  new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(iso));

const budgetSpent = (resumes: string) => ({
  code: "budget_exhausted",
  message: `Gust has answered all he can this month and is back on ${dayOf(resumes)}. Until then, ask your own AI assistant: wingfoil.ie works in Claude, ChatGPT and more.`,
  resumes,
});

function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function createCompanionRouter(deps: CompanionDeps) {
  const r = new Hono();
  const limiter =
    deps.limiter ?? createLimiter(() => new Date(), COMPANION_RATES);
  const serverNow = deps.now ?? Date.now;
  const awake = Boolean(deps.client && deps.source);
  const enabled = deps.enabled ?? true;
  /** Where Gust stands right now, and when a spent budget comes back. */
  const availability = async (): Promise<{
    state: Availability;
    resumes: string | null;
  }> => {
    if (!enabled) return { state: "off", resumes: null };
    if (!awake) return { state: "asleep", resumes: null };
    if (!deps.budget) return { state: "awake", resumes: null };
    const budget = await deps.budget.state();
    return budget.spent
      ? { state: "resting", resumes: budget.resumes }
      : { state: "awake", resumes: null };
  };
  /** The refusal for a Gust who cannot answer, or null when he can. */
  const unavailable = async (c: Context) => {
    const { state, resumes } = await availability();
    if (state === "off") return c.json(switchedOff, 503);
    if (state === "asleep") return c.json(notConfigured, 503);
    if (state === "resting") return c.json(budgetSpent(resumes!), 503);
    return null;
  };
  /** The clock a request is answered on (see trustClientClock). */
  const nowFor = (sent: string) => {
    const at = Date.parse(sent);
    return deps.trustClientClock && Number.isFinite(at) ? at : serverNow();
  };

  r.get("/status", async (c) => {
    const { state, resumes } = await availability();
    return c.json({
      state,
      // What a browser from before `state` reads.
      configured: state === "awake",
      fake: Boolean(deps.fake),
      resumes,
    });
  });

  r.post("/nudge", bodyLimit({ maxSize: 4 * 1024 }), async (c) => {
    const refused = await unavailable(c);
    if (refused) return refused;
    const parsed = nudgeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { code: "invalid", message: "That is not a nudge request." },
        400,
      );
    const { spot, rider, now } = parsed.data;
    const ctx: ToolContext = {
      source: deps.source!,
      now: nowFor(now),
      rider: riderFrom(rider),
      context: { spot: null, time: null, rider, now },
      newId: randomUUID,
    };
    const outcome = await toolNamed("get_spot_forecast")!.run(
      { spot, date: null, days: null },
      ctx,
    );
    const card = outcome.cards?.[0];
    return c.json({
      card:
        card && card.id === spot && (card.best?.stars ?? 0) >= 4 ? card : null,
    });
  });

  r.post(
    "/chat",
    bodyLimit({
      maxSize: 96 * 1024,
      onError: (c) =>
        c.json(
          {
            code: "too_large",
            message: "That conversation is too long. Start a new chat.",
          },
          413,
        ),
    }),
    async (c) => {
      const refused = await unavailable(c);
      if (refused) return refused;
      const parsed = chatRequestSchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success)
        return c.json(
          {
            code: "invalid",
            message: "Gust could not read that message.",
            details: parsed.error.issues.slice(0, 5).map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          },
          400,
        );
      limiter.take(`companion:${clientIp(c)}`, "message");
      const request = parsed.data as ChatRequest;
      const signal = c.req.raw.signal;
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: ServerEvent) => {
            try {
              controller.enqueue(encoder.encode(encodeSse(event)));
            } catch {
              // The browser has gone; the turn stops at its next await.
            }
          };
          try {
            await runTurn(
              request,
              {
                client: deps.client!,
                source: deps.source!,
                model: deps.model,
                effort: deps.effort,
                now: nowFor(request.context.now),
                newId: randomUUID,
                onUsage: deps.budget
                  ? (model, usage) => deps.budget!.record(model, usage)
                  : undefined,
              },
              send,
              signal,
            );
          } catch (error) {
            console.error("companion: turn failed", error);
            send({
              event: "error",
              data: {
                code: "internal",
                message: "Something went wrong on our side.",
              },
            });
          }
          send({ event: "done", data: {} });
          try {
            controller.close();
          } catch {
            // Already closed by a cancelled reader.
          }
        },
      });
      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    },
  );

  return r;
}
