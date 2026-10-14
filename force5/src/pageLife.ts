/**
 * Whether the page is in front of the reader, and a way to hear it come back:
 * what the forecast hooks revalidate on (src/useBlend.ts, src/useSpotBlend.ts).
 *
 * The mobile app resolves every import of this file to its own
 * (mobile/src/config/pageLife.ts, by mobile/metro.config.js), which answers
 * from React Native's AppState instead of the document.
 */
export const pageVisible = (): boolean =>
  typeof document === "undefined" || document.visibilityState === "visible";

/** Calls `listener` when the page is shown again or regains focus. */
export function onPageReturn(listener: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", listener);
  window.addEventListener("focus", listener);
  return () => {
    document.removeEventListener("visibilitychange", listener);
    window.removeEventListener("focus", listener);
  };
}
