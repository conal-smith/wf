/**
 * The conversation with Gust, as the browser keeps it (pure): settled
 * messages, the reply streaming in, and what the server is sent back as
 * history. The transcript lives in sessionStorage, so it survives a reload of
 * the tab and is gone when the tab is.
 */
import {
  MAX_ECHO_CHARS,
  MAX_HISTORY,
  riderSummary,
  type Card,
  type ChatContext,
  type ChatTurn,
  type MapAction,
  type ProfileProposal,
  type ServerEvent,
  type ToolActivity,
  type TurnError,
} from "../shared/protocol";

export type ProposalStatus = "pending" | "saved" | "dismissed";

export type Part =
  | { kind: "text"; text: string }
  | { kind: "card"; card: Card }
  | { kind: "proposal"; proposal: ProfileProposal; status: ProposalStatus };

export interface UserMessage {
  id: string;
  role: "user";
  text: string;
  context: ChatContext;
}

export interface AssistantMessage {
  id: string;
  role: "assistant";
  parts: Part[];
  tools: ToolActivity[];
  /** The map moves Gust made in this answer, for the record. */
  actions: MapAction[];
  error: TurnError | null;
  /** Still streaming. */
  live: boolean;
  /** Text after a lookup starts a new paragraph. */
  breakText?: boolean;
}

export type Message = UserMessage | AssistantMessage;

export type ChatStatus = "idle" | "sending" | "streaming";

export interface ChatState {
  messages: Message[];
  status: ChatStatus;
  /** A turn refused before it started (not configured, rate limited…). */
  requestError: TurnError | null;
  /** How the last turn ended, until it settles: drives Gust's face. */
  outcome: "success" | "stoked" | "error" | null;
}

export const initialChat: ChatState = {
  messages: [],
  status: "idle",
  requestError: null,
  outcome: null,
};

export type ChatAction =
  | {
      type: "send";
      id: string;
      replyId: string;
      text: string;
      context: ChatContext;
    }
  | { type: "event"; event: ServerEvent }
  | { type: "failed"; error: TurnError }
  | { type: "proposal"; id: string; status: ProposalStatus }
  | { type: "settle" }
  | { type: "reset" }
  | { type: "load"; messages: Message[] };

const upsert = (tools: ToolActivity[], tool: ToolActivity) =>
  tools.some((t) => t.id === tool.id)
    ? tools.map((t) => (t.id === tool.id ? tool : t))
    : [...tools, tool];

function withReply(
  state: ChatState,
  change: (reply: AssistantMessage) => AssistantMessage,
): ChatState {
  const last = state.messages.at(-1);
  if (!last || last.role !== "assistant" || !last.live) return state;
  return { ...state, messages: [...state.messages.slice(0, -1), change(last)] };
}

function applyEvent(state: ChatState, event: ServerEvent): ChatState {
  switch (event.event) {
    case "text":
      return withReply({ ...state, status: "streaming" }, (reply) => {
        const parts = [...reply.parts];
        const last = parts.at(-1);
        if (last?.kind === "text" && !reply.breakText)
          parts[parts.length - 1] = {
            kind: "text",
            text: last.text + event.data.delta,
          };
        else parts.push({ kind: "text", text: event.data.delta.trimStart() });
        return { ...reply, parts, breakText: false };
      });
    case "tool":
      return withReply({ ...state, status: "streaming" }, (reply) => ({
        ...reply,
        tools: upsert(reply.tools, event.data),
        breakText: true,
      }));
    case "card":
      return withReply(state, (reply) => ({
        ...reply,
        parts: [...reply.parts, { kind: "card", card: event.data }],
        breakText: true,
      }));
    case "proposal":
      return withReply(state, (reply) => ({
        ...reply,
        parts: [
          ...reply.parts,
          { kind: "proposal", proposal: event.data, status: "pending" },
        ],
        breakText: true,
      }));
    case "action":
      return withReply(state, (reply) => ({
        ...reply,
        actions: [...reply.actions, event.data],
      }));
    case "error":
      return withReply(state, (reply) => ({
        ...reply,
        // A refusal can arrive part-way through an answer: what was said
        // before it is withdrawn, not left standing as if complete.
        parts:
          event.data.code === "refusal"
            ? reply.parts.filter((p) => p.kind !== "text")
            : reply.parts,
        error: event.data,
      }));
    case "done": {
      const reply = state.messages.at(-1);
      const failed = reply?.role === "assistant" && reply.error !== null;
      const stoked =
        reply?.role === "assistant" &&
        reply.parts.some(
          (p) => p.kind === "card" && (p.card.best?.stars ?? 0) >= 4,
        );
      const settled = withReply(state, (r) => ({
        ...r,
        live: false,
        breakText: false,
      }));
      return {
        ...settled,
        status: "idle",
        outcome: failed ? "error" : stoked ? "stoked" : "success",
      };
    }
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send":
      return {
        ...state,
        status: "sending",
        requestError: null,
        outcome: null,
        messages: [
          ...state.messages,
          {
            id: action.id,
            role: "user",
            text: action.text,
            context: action.context,
          },
          {
            id: action.replyId,
            role: "assistant",
            parts: [],
            tools: [],
            actions: [],
            error: null,
            live: true,
          },
        ],
      };
    case "event":
      return applyEvent(state, action.event);
    case "failed": {
      // Refused before it began: the words go back to the composer, not the log.
      const last = state.messages.at(-1);
      const drop = last?.role === "assistant" && last.live ? 2 : 0;
      return {
        ...state,
        messages: state.messages.slice(0, state.messages.length - drop),
        status: "idle",
        requestError: action.error,
        outcome: "error",
      };
    }
    case "proposal":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.role === "assistant" &&
          m.parts.some(
            (p) => p.kind === "proposal" && p.proposal.id === action.id,
          )
            ? {
                ...m,
                parts: m.parts.map((p) =>
                  p.kind === "proposal" && p.proposal.id === action.id
                    ? { ...p, status: action.status }
                    : p,
                ),
              }
            : m,
        ),
      };
    case "settle":
      return { ...state, outcome: null };
    case "reset":
      return initialChat;
    case "load":
      return { ...initialChat, messages: action.messages };
  }
}

/** A card, in the few words Gust needs to remember he showed it. */
function cardNote(card: Card): string {
  const best = card.best;
  if (!best) return `[Showed a card: ${card.name}, no rated window]`;
  return `[Showed a card: ${card.name} (id ${card.id}), ${best.stars}★ ${best.local}, ${best.wind_kn} kn ${best.direction}${best.shore ? `, ${best.shore}` : ""}, ${best.wing_m2} m² wing]`;
}

const PROPOSAL_STATUS: Record<ProposalStatus, string> = {
  pending: "not answered yet",
  saved: "the rider confirmed and it is saved",
  dismissed: "the rider said not now",
};

/** One past answer as plain text for the model: words, then what was shown. */
export function replyText(message: AssistantMessage): string {
  const lines = message.parts.map((p) =>
    p.kind === "text"
      ? p.text.trim()
      : p.kind === "card"
        ? cardNote(p.card)
        : `[Proposed profile ${riderSummary(p.proposal.rider)}: ${PROPOSAL_STATUS[p.status]}]`,
  );
  if (message.error)
    lines.push(`[The answer stopped: ${message.error.message}]`);
  const text = lines.filter(Boolean).join("\n\n");
  return (text || "[No answer]").slice(0, MAX_ECHO_CHARS);
}

/** The history the server is sent: the last MAX_HISTORY settled messages. */
export function historyFor(messages: readonly Message[]): ChatTurn[] {
  const turns: ChatTurn[] = messages
    .filter((m) => m.role === "user" || !m.live)
    .map((m) =>
      m.role === "user"
        ? { role: "user", text: m.text, context: m.context }
        : { role: "assistant", text: replyText(m) },
    );
  const recent = turns.slice(-MAX_HISTORY);
  while (recent[0]?.role === "assistant") recent.shift();
  return recent;
}

// ---- persistence --------------------------------------------------------------------------

export const STORAGE_KEY = "wingfoil.gust.v1";

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function session(): Store | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function loadMessages(store: Store | null = session()): Message[] {
  try {
    const raw = store?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is Message =>
          typeof m === "object" &&
          m !== null &&
          (m.role === "user"
            ? typeof m.text === "string"
            : m.role === "assistant" && Array.isArray(m.parts)),
      )
      .map((m) =>
        // A reply that was streaming when the tab went away is over.
        m.role === "assistant" && m.live
          ? {
              ...m,
              live: false,
              error: m.error ?? {
                code: "interrupted",
                message: "This answer was interrupted.",
              },
            }
          : m,
      );
  } catch {
    return [];
  }
}

export function saveMessages(
  messages: readonly Message[],
  store: Store | null = session(),
) {
  try {
    if (!messages.length) store?.removeItem(STORAGE_KEY);
    else store?.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-60)));
  } catch {
    // Storage is a convenience: a full or blocked store never breaks the chat.
  }
}
