/**
 * Whether this binary should send the rider to the App Store or Google Play.
 *
 * The site publishes app/latest.json at each production release
 * (scripts/release/mobile.mjs latest-json, docs/MOBILE.md): the newest store
 * binary per platform, the runtime production's over-the-air update needs, and
 * the oldest version still supported. It is read at launch and on coming back
 * to the app, at most every six hours, by the production app only.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { siteUrl, variant } from "../../config/env";
import { platform, runningApp } from "./appUpdates";
import {
  parseLatest,
  shouldReadLatest,
  storeDecision,
  storeDismissKey,
  type Latest,
  type StoreDecision,
} from "./updatesLogic";

const DISMISSED_KEY = "wingfoil:app-store-dismissed";

let latest: Latest | null = null;
let lastReadAt: number | null = null;
const listeners = new Set<() => void>();

function readLatest() {
  const t = Date.now();
  if (variant !== "production" || !shouldReadLatest(lastReadAt, t)) return;
  lastReadAt = t;
  fetch(siteUrl("app/latest.json"), { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : null))
    .then((json) => {
      latest = parseLatest(json);
      listeners.forEach((listener) => listener());
    })
    .catch(() => {
      // Offline, or no release yet: try again next time, not in six hours.
      lastReadAt = null;
    });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getLatest = () => latest;

function readDismissed(): string | null {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) ?? null;
  } catch {
    return null;
  }
}

export function useStoreUpdate(): StoreDecision & { dismiss: () => void } {
  const current = useSyncExternalStore(subscribe, getLatest, getLatest);
  const [dismissedVersion, setDismissedVersion] = useState(readDismissed);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    readLatest();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      setNow(Date.now());
      readLatest();
    });
    return () => subscription.remove();
  }, []);

  const app = runningApp();
  const decision: StoreDecision = platform
    ? storeDecision({
        latest: current,
        platform,
        variant: app.variant,
        installed: { version: app.version, build: app.build, runtimeVersion: app.runtimeVersion },
        applicationId: app.applicationId,
        now,
        dismissedVersion,
      })
    : { kind: "none" };

  const store = platform ? current?.[platform]?.store : null;
  const dismiss = () => {
    if (!store) return;
    const key = storeDismissKey(store);
    try {
      globalThis.localStorage?.setItem(DISMISSED_KEY, key);
    } catch {
      // Not remembered: it asks again next launch, which is no harm.
    }
    setDismissedVersion(key);
  };

  return { ...decision, dismiss };
}
