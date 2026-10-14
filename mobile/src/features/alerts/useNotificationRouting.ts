/**
 * Notifications, from the root layout: how they show while the app is open,
 * the Android channels they arrive on, and where a tap takes the rider — the
 * chart at the spot and hour of an alert, About for an app update — whether
 * the tap opened the app from cold or found it running. It also keeps the
 * alerts API in step with the phone (sync.ts), since this is the one hook
 * mounted for the app's whole life.
 */
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { Platform } from "react-native";
import { CHANNELS } from "../../../../alerts/shared/protocol";
import { colors } from "../../theme/tokens";
import { notificationRoute } from "./alertsLogic";
import { useAlertsSync } from "./sync";

// While the app is open an alert still shows as a banner: it is news either way.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let channelsMade = false;
function makeChannels() {
  if (Platform.OS !== "android" || channelsMade) return;
  channelsMade = true;
  void Notifications.setNotificationChannelAsync(CHANNELS.alerts, {
    name: "Star alerts",
    description: "When a window you asked for is forecast, moves or is called off.",
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: colors.magenta,
    vibrationPattern: [0, 180, 120, 180],
  }).catch(() => undefined);
  void Notifications.setNotificationChannelAsync(CHANNELS.updates, {
    name: "App updates",
    description: "When a new version of Wingfoil is out.",
    importance: Notifications.AndroidImportance.DEFAULT,
  }).catch(() => undefined);
}

/** Taps already acted on, so the cold-start response and the listener never both route. */
const handled = new Set<string>();

function open(response: Notifications.NotificationResponse | null) {
  if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
  const id = response.notification.request.identifier;
  if (handled.has(id)) return;
  handled.add(id);
  const route = notificationRoute(response.notification.request.content.data);
  if (route) router.push(route);
  Notifications.clearLastNotificationResponse();
}

export function useNotificationRouting(): void {
  useAlertsSync();
  useEffect(() => {
    makeChannels();
    // The tap that opened the app, if one did.
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
}
