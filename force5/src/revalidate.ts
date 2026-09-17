// When an open tab should look for a newer run. A forecast run is replaced every
// few hours, so a tab left open all morning is showing an old one; and a tab
// nobody is looking at should not be fetching anything at all. The decision is a
// pure function of four facts so it can be tested without a browser.

/** How long a displayed run is trusted before the tab looks for a newer one. */
export const REVALIDATE_MS = 5 * 60 * 1000;
/** How long to wait when a check was due but the reader was mid-gesture. */
export const REVALIDATE_RETRY_MS = 60 * 1000;

/**
 * - `go` — check now.
 * - `wait` — nothing is due; a hidden tab waits for its visibility to come back.
 * - `defer` — due, but the reader is scrubbing, playing or switching model, and
 *   a run swap under their hand would move the forecast they are reading. Try
 *   again in `REVALIDATE_RETRY_MS`.
 */
export type RevalidateDecision = "go" | "wait" | "defer";

export function revalidateDecision(
  lastCheck: number,
  now: number,
  visible: boolean,
  busy: boolean,
): RevalidateDecision {
  if (!visible) return "wait";
  // A clock that jumped backwards must not lock the tab out for good, so an
  // impossible gap counts as due rather than as "checked in the future".
  const elapsed = now - lastCheck;
  if (elapsed >= 0 && elapsed < REVALIDATE_MS) return "wait";
  return busy ? "defer" : "go";
}

/** Whether a check should happen right now. */
export const shouldRevalidate = (
  lastCheck: number,
  now: number,
  visible: boolean,
  busy: boolean,
): boolean => revalidateDecision(lastCheck, now, visible, busy) === "go";

/**
 * A run's hour as the notice names it: runs are published on UTC hours and every
 * forecast source labels them that way, so the notice does too rather than
 * translating a run label into Irish local time.
 */
export function runLabel(runTime: string): string {
  const at = Date.parse(runTime);
  if (!Number.isFinite(at)) return "newest";
  const time = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(time.getUTCHours())}:${pad(time.getUTCMinutes())} UTC`;
}
