/**
 * Whether this phone may show Wingfoil's notifications, read again whenever
 * the app comes back to the front (the rider may have been to Settings). The
 * system prompt is asked only by `ask`, after the screen has said why.
 */
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking } from "react-native";
import type { PushSupport } from "./alertsLogic";
import { thisPushSupport } from "./device";
import { requestSync } from "./sync";

export type PushPermission =
  /** Not asked yet: explain, then ask. */
  | "undetermined"
  | "granted"
  /** Refused, and the system will not ask again: only Settings can change it. */
  | "blocked"
  /** Refused, but asking again would show the prompt (Android before the second no). */
  | "denied"
  | "unknown";

const readPermission = (p: Notifications.NotificationPermissionsStatus): PushPermission =>
  p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
    ? "granted"
    : String(p.status) === "undetermined"
      ? "undetermined"
      : p.canAskAgain
        ? "denied"
        : "blocked";

export function usePushPermission(): {
  permission: PushPermission;
  support: PushSupport;
  ask: () => Promise<PushPermission>;
  openSettings: () => void;
} {
  const [permission, setPermission] = useState<PushPermission>("unknown");
  const support = thisPushSupport();

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      Notifications.getPermissionsAsync()
        .then((p) => alive && setPermission(readPermission(p)))
        .catch(() => alive && setPermission("unknown"));
    void refresh();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const ask = useCallback(async () => {
    const answer = readPermission(
      await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      }),
    );
    setPermission(answer);
    if (answer === "granted") void requestSync();
    return answer;
  }, []);

  const openSettings = useCallback(() => void Linking.openSettings().catch(() => undefined), []);

  return { permission, support, ask, openSettings };
}
