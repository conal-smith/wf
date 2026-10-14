/**
 * The app's side of EAS Update: what the binary is running, and the three
 * things the app does with an update (look for one, download it, restart into
 * it). The decisions are updatesLogic.ts's; this file only talks to Expo.
 *
 * Off in a development build, in a build without an EAS project (app.config.ts
 * sets `updates.enabled: false` until EAS_PROJECT_ID exists) and in Expo Go:
 * every function here is then a quiet no-op, never a rejected promise.
 */
import * as Application from "expo-application";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import { variant } from "../../config/env";
import { colors } from "../../theme/tokens";
import type { Platform as UpdatePlatform } from "./updatesLogic";

export const updatesEnabled = Updates.isEnabled && !__DEV__;

/** Only the two platforms the stores serve. */
export const platform: UpdatePlatform | null =
  Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : null;

/** Who this binary is and what it runs, for About and the store check. */
export function runningApp() {
  return {
    variant,
    applicationId: Application.applicationId ?? "",
    version: Application.nativeApplicationVersion ?? "",
    build: Application.nativeBuildVersion ?? null,
    channel: Updates.channel ?? null,
    runtimeVersion: Updates.runtimeVersion ?? null,
    updateId: Updates.updateId ?? null,
    createdAt: Updates.createdAt ?? null,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    isEmergencyLaunch: Updates.isEmergencyLaunch,
    emergencyLaunchReason: Updates.emergencyLaunchReason ?? null,
  };
}

let lastCheckAt: number | null = null;
let inFlight: Promise<CheckOutcome> | null = null;

export type CheckOutcome = "none" | "downloaded" | "rollback" | "off";

/** When the app last asked EAS for an update, this session. */
export const lastUpdateCheckAt = () => lastCheckAt;

/**
 * Ask EAS for an update and download it if there is one. One at a time: a
 * second call while one runs gets the same answer. Rejects on a network or
 * server error; callers that do not show the answer catch it.
 */
export function checkAndFetch(): Promise<CheckOutcome> {
  if (!updatesEnabled) return Promise.resolve("off");
  if (inFlight) return inFlight;
  lastCheckAt = Date.now();
  inFlight = (async (): Promise<CheckOutcome> => {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable && !check.isRollBackToEmbedded) return "none";
    const fetched = await Updates.fetchUpdateAsync();
    if (fetched.isRollBackToEmbedded) return "rollback";
    return fetched.isNew ? "downloaded" : "none";
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** The same, for callers that only want it to happen. */
export function checkQuietly() {
  checkAndFetch().catch(() => undefined);
}

let restarting = false;

/**
 * Restart into the downloaded update. The rider's settings, spots and alerts
 * are already on disk (src/data/storage.ts writes through), so nothing is lost;
 * the reload screen is the page's paper rather than a white flash.
 */
export async function restartIntoUpdate(): Promise<void> {
  if (!updatesEnabled || restarting) return;
  restarting = true;
  try {
    await Updates.reloadAsync({ reloadScreenOptions: { backgroundColor: colors.paper } });
  } catch {
    restarting = false;
  }
}
