/**
 * The app's force5/src/pageLife.ts (metro.config.js resolves the site's file
 * here): the forecast hooks revalidate when the app comes back to the front,
 * as the site's do when its tab does.
 */
import { AppState } from "react-native";

export const pageVisible = (): boolean => AppState.currentState === "active";

/** Calls `listener` when the app returns to the foreground. */
export function onPageReturn(listener: () => void): () => void {
  let last = AppState.currentState;
  const subscription = AppState.addEventListener("change", (next) => {
    if (next === "active" && last !== "active") listener();
    last = next;
  });
  return () => subscription.remove();
}
