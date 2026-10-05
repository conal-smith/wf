import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  type ChatContext,
  type MapAction,
  type RiderContext,
  type SpotCardData,
} from "../shared/protocol";
import {
  CompanionError,
  companionNudge,
  companionStatus,
  streamChat,
} from "./api";
import {
  chatReducer,
  historyFor,
  initialChat,
  loadMessages,
  saveMessages,
  type ChatState,
} from "./chat";
import { gustMood } from "./mood";

export type CompanionContext = Omit<ChatContext, "now">;

export interface CompanionHandlers {
  /** Gust (or a card's button) moving the map. */
  onAction: (action: MapAction) => void;
  /** The rider tapped Save on a profile proposal. */
  onRiderSaved: (rider: RiderContext) => void;
}

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `m-${Date.now()}-${Math.random()}`;

/** Everything Gust's launcher and panel need, in one place. */
export function useCompanion(
  context: CompanionContext,
  handlers: CompanionHandlers,
) {
  const [chat, dispatch] = useReducer(
    chatReducer,
    initialChat,
    (init): ChatState => ({
      ...init,
      messages: loadMessages(),
    }),
  );
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [nudge, setNudge] = useState<SpotCardData | null>(null);
  const [seenNudge, setSeenNudge] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const latest = useRef({ context, handlers, chat });
  latest.current = { context, handlers, chat };

  // Saved as it changes: a reload mid-answer keeps what had arrived, and
  // loadMessages marks that answer as interrupted.
  useEffect(() => {
    saveMessages(chat.messages);
  }, [chat.messages]);

  useEffect(() => {
    const controller = new AbortController();
    companionStatus(controller.signal)
      .then(setConfigured)
      .catch(() => {
        if (!controller.signal.aborted) setConfigured(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!chat.outcome) return;
    const timer = window.setTimeout(() => dispatch({ type: "settle" }), 2600);
    return () => clearTimeout(timer);
  }, [chat.outcome]);

  // A four-star window coming at the spot on screen: Gust nudges.
  const spotId = context.spot?.id ?? null;
  const riderKey = JSON.stringify(context.rider);
  useEffect(() => {
    setNudge(null);
    if (!configured || !spotId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      companionNudge(
        spotId,
        latest.current.context.rider ?? defaultRider(),
        controller.signal,
      )
        .then((card) => {
          if (!controller.signal.aborted) setNudge(card);
        })
        .catch(() => {});
    }, 700);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [configured, spotId, riderKey]);
  const nudgeKey = nudge?.best ? `${nudge.id}@${nudge.best.from}` : null;
  const nudging = nudgeKey !== null && nudgeKey !== seenNudge;

  const toggle = useCallback((next?: boolean) => {
    setOpen((was) => {
      const now = next ?? !was;
      if (now) setSeenNudge((seen) => latestNudgeKey.current ?? seen);
      return now;
    });
  }, []);
  const latestNudgeKey = useRef(nudgeKey);
  latestNudgeKey.current = nudgeKey;

  const send = useCallback(async (text: string) => {
    const { context, chat } = latest.current;
    if (chat.status !== "idle") return;
    const ctx: ChatContext = { ...context, now: new Date().toISOString() };
    const history = historyFor(chat.messages);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    dispatch({
      type: "send",
      id: newId(),
      replyId: newId(),
      text,
      context: ctx,
    });
    setDraft("");
    let done = false;
    try {
      for await (const event of streamChat(
        {
          messages: [...history, { role: "user", text, context: ctx }],
          context: ctx,
        },
        controller.signal,
      )) {
        dispatch({ type: "event", event });
        if (event.event === "action")
          latest.current.handlers.onAction(event.data);
        if (event.event === "done") done = true;
      }
      if (!done)
        dispatch({
          type: "event",
          event: {
            event: "error",
            data: {
              code: "interrupted",
              message: "The answer was cut off. Try again.",
            },
          },
        });
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure =
        error instanceof CompanionError
          ? error
          : new CompanionError(
              "interrupted",
              "The answer was cut off. Try again.",
            );
      if (failure.code === "not_configured") setConfigured(false);
      // Mid-stream, the reply keeps what came and says it stopped; refused
      // outright, the words go back into the box.
      if (latest.current.chat.status === "streaming")
        dispatch({ type: "event", event: { event: "error", data: failure } });
      else {
        dispatch({
          type: "failed",
          error: { code: failure.code, message: failure.message },
        });
        setDraft(text);
        return;
      }
    }
    if (!done && !controller.signal.aborted)
      dispatch({ type: "event", event: { event: "done", data: {} } });
  }, []);

  const newChat = useCallback(() => {
    request.current?.abort();
    request.current = null;
    dispatch({ type: "reset" });
    setDraft("");
  }, []);

  useEffect(() => () => request.current?.abort(), []);

  const answerProposal = useCallback(
    (id: string, rider: RiderContext | null) => {
      if (rider) latest.current.handlers.onRiderSaved(rider);
      dispatch({ type: "proposal", id, status: rider ? "saved" : "dismissed" });
    },
    [],
  );

  const busy = chat.status !== "idle";
  const mood = gustMood({
    configured,
    open,
    typing: draft.length > 0,
    busy,
    outcome: chat.outcome,
    nudge: nudging,
  });

  return {
    chat,
    open,
    toggle,
    configured,
    draft,
    setDraft,
    send,
    newChat,
    busy,
    mood,
    nudge,
    nudging,
    answerProposal,
  };
}

export type Companion = ReturnType<typeof useCompanion>;

function defaultRider(): RiderContext {
  return { weightKg: null, skill: "intermediate", wings: [] };
}
