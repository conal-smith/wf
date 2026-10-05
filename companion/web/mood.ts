/** Gust's expression, from what is going on. Pure. */

export type GustMood =
  "idle" | "listening" | "thinking" | "success" | "error" | "stoked" | "asleep";

export const GUST_MOODS: readonly GustMood[] = [
  "idle",
  "listening",
  "thinking",
  "success",
  "error",
  "stoked",
  "asleep",
];

export function gustMood(input: {
  /** False when the server has no companion; null while that is unknown. */
  configured: boolean | null;
  open: boolean;
  typing: boolean;
  busy: boolean;
  /** How the last turn ended, until it settles. */
  outcome: "success" | "stoked" | "error" | null;
  /** A selected spot has a four-star window coming. */
  nudge: boolean;
}): GustMood {
  const { configured, open, typing, busy, outcome, nudge } = input;
  if (configured === false) return "asleep";
  if (busy) return "thinking";
  if (outcome) return outcome;
  if (open && typing) return "listening";
  if (!open && nudge) return "stoked";
  return "idle";
}

/** For a screen reader: what the face is saying. */
export const MOOD_LABEL: Record<GustMood, string> = {
  idle: "ready",
  listening: "listening",
  thinking: "thinking",
  success: "happy",
  error: "concerned",
  stoked: "stoked about a good window",
  asleep: "asleep",
};
