/**
 * The over-the-air update, wired to the app's life (t3code's app-updates.ts,
 * apps/mobile/src/features/updates there):
 *
 *  - at launch, once expo-updates' own start-up check has finished, look for
 *    an update and download it;
 *  - back in the app after 15 minutes away, look again;
 *  - leaving the app with an update downloaded: restart into it there and
 *    then, so the rider comes back to the new version without having seen a
 *    thing;
 *  - still in the app half an hour after one was ready: offer it (the banner in
 *    UpdateNotice), unless a gesture is holding updates (hold.ts);
 *  - a roll back is applied at once, as soon as no gesture holds it.
 */
import * as Updates from "expo-updates";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { checkQuietly, lastUpdateCheckAt, restartIntoUpdate, updatesEnabled } from "./appUpdates";
import { useUpdatesHeld } from "./hold";
import {
  offerAt,
  shouldApplyOnBackground,
  shouldApplyRollbackNow,
  shouldCheckOnForeground,
  shouldOfferRestart,
  type PendingUpdate,
} from "./updatesLogic";

/** When each downloaded update was first seen, this session: the same answer every render. */
const seen = new Map<string, number>();
function firstSeen(key: string): number {
  if (!seen.has(key)) seen.set(key, Date.now());
  return seen.get(key) as number;
}

export function useAppUpdates() {
  const {
    isUpdatePending,
    downloadedUpdate,
    isRestarting,
    isStartupProcedureRunning,
  } = Updates.useUpdates();
  const held = useUpdatesHeld();

  const pendingId = downloadedUpdate?.updateId;
  const pendingRollback = downloadedUpdate?.type === Updates.UpdateInfoType.ROLLBACK;
  const pending = useMemo<PendingUpdate | null>(
    () => (isUpdatePending ? { updateId: pendingId, isRollback: pendingRollback } : null),
    [isUpdatePending, pendingId, pendingRollback],
  );

  // When this update was first seen ready, and when the rider last came back.
  const readyAt = pending ? firstSeen(pending.updateId ?? "rollback") : null;
  const [activeSince, setActiveSince] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [dismissedUpdateId, setDismissedUpdateId] = useState<string | null>(null);

  // Read by the AppState listener, which is set up once.
  const latest = useRef({ pending, isRestarting });
  useEffect(() => {
    latest.current = { pending, isRestarting };
  }, [pending, isRestarting]);

  // Launch: after expo-updates' own start-up check, so the two never race.
  useEffect(() => {
    if (!updatesEnabled || isStartupProcedureRunning || lastUpdateCheckAt() !== null) return;
    checkQuietly();
  }, [isStartupProcedureRunning]);

  useEffect(() => {
    if (!updatesEnabled) return;
    let backgroundedAt: number | null = null;
    const subscription = AppState.addEventListener("change", (state) => {
      const t = Date.now();
      // "inactive" is iOS's Control Centre or a call banner: not leaving.
      if (state === "background") {
        backgroundedAt = t;
        if (shouldApplyOnBackground({ pending: latest.current.pending, restarting: latest.current.isRestarting }))
          void restartIntoUpdate();
      } else if (state === "active") {
        if (shouldCheckOnForeground({ backgroundedAt, now: t, lastCheckAt: lastUpdateCheckAt() })) checkQuietly();
        if (backgroundedAt !== null) setActiveSince(t);
        backgroundedAt = null;
      }
    });
    return () => subscription.remove();
  }, []);

  // A roll back: now, unless a finger is on the chart or the dock.
  useEffect(() => {
    if (shouldApplyRollbackNow({ pending, held, active: AppState.currentState === "active", restarting: isRestarting }))
      void restartIntoUpdate();
  }, [pending, held, isRestarting]);

  // Wake when the banner is due.
  const due = offerAt({ pending, readyAt, activeSince });
  useEffect(() => {
    if (due === null) return;
    const id = setTimeout(() => setNow(Date.now()), Math.max(0, due - Date.now()) + 250);
    return () => clearTimeout(id);
  }, [due]);

  const offer =
    updatesEnabled &&
    shouldOfferRestart({
      pending,
      readyAt,
      activeSince,
      now,
      held,
      dismissedUpdateId,
    });

  const later = () => setDismissedUpdateId(pending?.updateId ?? null);

  return { offer, restart: restartIntoUpdate, later, restarting: isRestarting };
}
