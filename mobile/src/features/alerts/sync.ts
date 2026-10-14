/**
 * Keeps the API in step with the phone: registers the phone the first time it
 * has an alert or a push token, then sends its token, rider, preferences and
 * rules whenever they change, a moment after the last change. Runs while the
 * app is open (mounted by useNotificationRouting), again when it comes to the
 * front, and when the push service rolls the token.
 *
 * Nothing is sent for a rider who has never made an alert nor allowed
 * notifications for app updates: no device row exists until there is a
 * reason for one.
 */
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { DEFAULT_RIDER, type Rider } from "../../../../force5/src/stars";
import { usePrefs } from "../../data/prefs";
import { deviceFingerprint } from "./alertsLogic";
import {
  alertsApi,
  AlertsApiError,
  deviceFields,
  expoPushToken,
  loadCredentials,
  saveCredentials,
  type Credentials,
} from "./device";
import { alertsStore } from "./store";

const SETTLE_MS = 1500;

let running: Promise<void> | null = null;
let again = false;
let riderNow: Rider | null = null;

async function syncOnce(): Promise<void> {
  const start = alertsStore.get();
  const token = await expoPushToken();
  if (!start.rules.length && !(token && start.appUpdates) && start.sentDevice === null) {
    alertsStore.note({ status: "idle" });
    return;
  }
  alertsStore.note({ status: "syncing" });
  let creds: Credentials = await loadCredentials();
  const fields = {
    ...deviceFields(),
    expoPushToken: token,
    rider: riderNow ?? DEFAULT_RIDER,
    quietHours: start.quietHours,
    appUpdates: start.appUpdates,
  };
  const fingerprint = deviceFingerprint(fields);
  const register = async () => {
    const { device, secret } = await alertsApi.register({ installationId: creds.installationId, ...fields });
    creds = { ...creds, deviceId: device.id, secret };
    await saveCredentials(creds);
    // A new device has no rules yet, whatever was synced before.
    alertsStore.note({ sentDevice: fingerprint, syncedRev: -1 });
  };
  const withDevice = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      // The API no longer knows this phone (removed, or a fresh database): register again.
      if (error instanceof AlertsApiError && error.status === 401) {
        await register();
        return work();
      }
      throw error;
    }
  };
  try {
    if (!creds.deviceId || !creds.secret) await register();
    else if (fingerprint !== alertsStore.get().sentDevice) {
      const { platform: _platform, ...update } = fields;
      await withDevice(() => alertsApi.update(creds, update));
      alertsStore.note({ sentDevice: fingerprint });
    }
    const now = alertsStore.get();
    if (now.rev !== now.syncedRev) {
      const rev = now.rev;
      await withDevice(() => alertsApi.putRules(creds, now.rules));
      alertsStore.note({ syncedRev: rev });
    }
    alertsStore.note({ status: "idle", syncedAt: Date.now() });
  } catch (error) {
    alertsStore.note({ status: error instanceof AlertsApiError && error.status === 0 ? "offline" : "error" });
  }
}

/** Sync now, or straight after the one under way. */
export function requestSync(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await syncOnce();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

/** The phone forgotten at both ends: its server row and secret, its rules, its app-update notes. */
export async function removeThisPhone(): Promise<void> {
  const creds = await loadCredentials();
  if (creds.deviceId && creds.secret) {
    try {
      await alertsApi.remove(creds);
    } catch (error) {
      if (!(error instanceof AlertsApiError && error.status === 401)) throw error;
    }
  }
  await saveCredentials({ installationId: creds.installationId, deviceId: null, secret: null });
  alertsStore.note({
    rules: [],
    appUpdates: false,
    sentDevice: null,
    syncedAt: null,
    syncedRev: alertsStore.get().rev,
    status: "idle",
  });
}

/** The previews the API worked out for this phone's saved rules, or null. */
export async function serverPreview() {
  const creds = await loadCredentials();
  if (!creds.deviceId || !creds.secret) return null;
  try {
    return await alertsApi.preview(creds);
  } catch {
    return null;
  }
}

/** Mounted once, in the root layout (through useNotificationRouting). */
export function useAlertsSync(): void {
  const { prefs } = usePrefs();
  const rider = prefs.rider;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // First, so the sync the next effect starts has the rider.
  useEffect(() => {
    riderNow = rider;
  }, [rider]);

  useEffect(() => {
    const later = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void requestSync(), SETTLE_MS);
    };
    let rev = alertsStore.get().rev;
    const unsubscribe = alertsStore.subscribe(() => {
      const next = alertsStore.get().rev;
      if (next !== rev) {
        rev = next;
        later();
      }
    });
    const front = AppState.addEventListener("change", (s) => {
      if (s === "active") void requestSync();
    });
    // The push service can roll the token while the app runs.
    const token = Notifications.addPushTokenListener(() => later());
    void requestSync();
    return () => {
      unsubscribe();
      front.remove();
      token.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // A new weight, level or quiver: the stars change, so the API is told.
  const riderKey = JSON.stringify(rider);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => void requestSync(), SETTLE_MS * 2);
    return () => clearTimeout(t);
  }, [riderKey]);
}
