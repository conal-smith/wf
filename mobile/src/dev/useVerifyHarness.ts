/**
 * Screenshots on a simulator, without hands: with EXPO_PUBLIC_VERIFY_HARNESS=1
 * in a development build, the app asks a local file
 * (scripts/verify-route.mjs serves it) which route to show, every second, and
 * goes there when it changes. `npm run verify -- /spot/inch` drives it.
 *
 * Off in every other build: the condition is constant, so the bundler drops
 * the body from staging and production.
 */
import { router } from "expo-router";
import { useEffect } from "react";

const ON = __DEV__ && process.env.EXPO_PUBLIC_VERIFY_HARNESS === "1";
const SOURCE = "http://127.0.0.1:8099/route";

export function useVerifyHarness(): void {
  useEffect(() => {
    if (!ON) return;
    let last = "";
    const timer = setInterval(() => {
      fetch(SOURCE)
        .then((r) => (r.ok ? r.text() : ""))
        .then((route) => {
          const next = route.trim();
          if (!next || next === last) return;
          last = next;
          router.replace(next as never);
        })
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, []);
}
