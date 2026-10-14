/**
 * Screenshots on a simulator, without hands: with EXPO_PUBLIC_VERIFY_HARNESS=1
 * in a development build, the app asks a local file
 * (scripts/verify-route.mjs serves it) which route to show, every second, and
 * goes there when it changes. `npm run verify -- /spot/inch` drives it.
 * An answer may also be JSON, {"route": "/", "storage": {"key": "value"}}:
 * the values are written to localStorage and the app reloads, so a chart
 * layer or a rider can be set before the screenshot.
 *
 * Off in every other build: the condition is constant, so the bundler drops
 * the body from staging and production.
 */
import { router } from "expo-router";
import { useEffect } from "react";
import { DevSettings } from "react-native";

const ON = __DEV__ && process.env.EXPO_PUBLIC_VERIFY_HARNESS === "1";
const SOURCE = "http://127.0.0.1:8099/route";

export function useVerifyHarness(): void {
  useEffect(() => {
    if (!ON) return;
    let last = "";
    const timer = setInterval(() => {
      fetch(SOURCE)
        .then((r) => (r.ok ? r.text() : ""))
        .then((body) => {
          const next = body.trim();
          if (!next || next === last) return;
          last = next;
          if (!next.startsWith("{")) return router.replace(next as never);
          const { route, storage } = JSON.parse(next) as {
            route?: string;
            storage?: Record<string, string>;
          };
          const changed = Object.entries(storage ?? {}).filter(
            ([key, value]) => globalThis.localStorage.getItem(key) !== value,
          );
          changed.forEach(([key, value]) => globalThis.localStorage.setItem(key, value));
          if (changed.length) return DevSettings.reload();
          if (route) router.replace(route as never);
        })
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, []);
}
