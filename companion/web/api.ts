/**
 * Gust's three calls to the server. The chat answer is read as server-sent
 * events over the fetch response (EventSource cannot POST), parsed with the
 * same protocol module the server writes it with.
 */
import { API_ROOT } from "../../shared/web/http";
import {
  createSseParser,
  toServerEvent,
  type ChatRequest,
  type RiderContext,
  type ServerEvent,
  type SpotCardData,
  type TurnError,
} from "../shared/protocol";

const PREFIX = `${API_ROOT}/api/companion`;

export class CompanionError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function refusal(response: Response): Promise<CompanionError> {
  const body = (await response.json().catch(() => null)) as
    (Partial<TurnError> & { error?: string; retryAfter?: number }) | null;
  if (response.status === 429)
    return new CompanionError(
      "rate_limited",
      "Easy there! Give Gust a moment before the next question.",
    );
  return new CompanionError(
    body?.code ?? body?.error ?? `http_${response.status}`,
    body?.message ??
      (response.status >= 500
        ? "Gust isn't answering right now. Try again in a moment."
        : "Gust couldn't read that. Try again."),
  );
}

export async function companionStatus(signal?: AbortSignal): Promise<boolean> {
  const response = await fetch(`${PREFIX}/status`, { signal });
  if (!response.ok) return false;
  const body = (await response.json().catch(() => null)) as {
    configured?: boolean;
  } | null;
  return body?.configured === true;
}

export async function companionNudge(
  spot: string,
  rider: RiderContext,
  signal?: AbortSignal,
): Promise<SpotCardData | null> {
  const response = await fetch(`${PREFIX}/nudge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spot, rider, now: new Date().toISOString() }),
    signal,
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    card?: SpotCardData | null;
  } | null;
  return body?.card ?? null;
}

/** One turn: yields each event as it arrives. Throws CompanionError when refused. */
export async function* streamChat(
  request: ChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<ServerEvent> {
  let response: Response;
  try {
    response = await fetch(`${PREFIX}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new CompanionError(
      "offline",
      "Gust can't be reached. Check your connection and try again.",
    );
  }
  if (!response.ok) throw await refusal(response);
  if (!response.body) return;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const parse = createSseParser();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const message of parse(value)) {
        const event = toServerEvent(message);
        if (event) yield event;
      }
    }
  } finally {
    // Stops the download too when the reader stops early (a new chat, say).
    await reader.cancel().catch(() => undefined);
  }
}
