/**
 * This phone to the alerts API (alerts/README.md): its install id and the
 * secret the API gave it, kept in the keychain / keystore (expo-secure-store),
 * the calls, and the Expo push token. No account: the secret is the phone's
 * only key, and "Remove this phone" forgets both ends.
 */
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  ALERTS_API,
  DEVICE_SCHEME,
  type AlertRule,
  type DeviceRegistration,
  type DeviceUpdate,
  type PreviewPayload,
  type Registered,
} from "../../../../alerts/shared/protocol";
import { apiUrl, variant } from "../../config/env";
import { pushSupport, type PushSupport } from "./alertsLogic";

const CREDENTIALS_KEY = "wingfoil.alerts.device";

export interface Credentials {
  installationId: string;
  deviceId: string | null;
  secret: string | null;
}

const randomId = () =>
  Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

export async function loadCredentials(): Promise<Credentials> {
  try {
    const text = await SecureStore.getItemAsync(CREDENTIALS_KEY);
    const saved = text ? (JSON.parse(text) as Partial<Credentials>) : null;
    if (saved?.installationId)
      return { installationId: saved.installationId, deviceId: saved.deviceId ?? null, secret: saved.secret ?? null };
  } catch {
    // Unreadable (a restored backup on another phone, say): start again.
  }
  const fresh = { installationId: randomId(), deviceId: null, secret: null };
  await saveCredentials(fresh);
  return fresh;
}

export const saveCredentials = (c: Credentials) =>
  SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(c)).catch(() => undefined);

/** The API refused or could not be reached; `status` 0 is no network. */
export class AlertsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, c?: Credentials): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(`${ALERTS_API}/${path}`), {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(c?.deviceId && c.secret ? { Authorization: `${DEVICE_SCHEME} ${c.deviceId}.${c.secret}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AlertsApiError(0, "No connection.");
  }
  if (response.status === 204) return undefined as T;
  const json = (await response.json().catch(() => null)) as { message?: string } | null;
  if (!response.ok) throw new AlertsApiError(response.status, json?.message ?? `HTTP ${response.status}`);
  return json as T;
}

export const alertsApi = {
  register: (registration: DeviceRegistration) => call<Registered>("POST", "devices", registration),
  update: (c: Credentials, update: DeviceUpdate) => call<unknown>("PUT", "devices/me", update, c),
  putRules: (c: Credentials, rules: AlertRule[]) => call<unknown>("PUT", "devices/me/rules", { rules }, c),
  preview: (c: Credentials) => call<PreviewPayload>("GET", "devices/me/preview", undefined, c),
  remove: (c: Credentials) => call<void>("DELETE", "devices/me", undefined, c),
};

/** The EAS project push tokens are issued for; absent on a build made without one. */
export const easProjectId = (): string | null =>
  (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ?? Constants.easConfig?.projectId ?? null;

export const thisPushSupport = (): PushSupport => pushSupport(easProjectId(), Device.isDevice);

/** The Expo push token, when notifications are allowed and this build can have one. */
export async function expoPushToken(): Promise<string | null> {
  const projectId = easProjectId();
  if (thisPushSupport() !== "ok" || !projectId) return null;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return null;
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;
  }
}

/** What the API is told about this phone, beside its rules. */
export const deviceFields = () => ({
  platform: (Platform.OS === "android" ? "android" : "ios") as "ios" | "android",
  appVariant: variant,
  appVersion: Application.nativeApplicationVersion ?? "0.0.0",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Dublin",
});
