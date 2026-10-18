/**
 * Keeps a signed-in rider's own star rating in step with their account
 * (./riderSync.ts): once when the page knows who is signed in, which is also
 * the moment they sign in, and again whenever this device changes the
 * rating. Draws nothing. Every section with a sign-in mounts it inside its
 * auth provider; the map and the spot pages mount it through AccountRider,
 * only on a device that has signed in before.
 */
import { useEffect, useMemo, useRef } from "react";
import { useSiteAuth } from "./auth";
import {
  PREFS_EVENT,
  riderApi,
  setSignedInHint,
  syncRider,
  type PrefsChange,
} from "./riderSync";

export function RiderSync() {
  const { loaded, signedIn, userId, getToken } = useSiteAuth();
  const token = useRef(getToken);
  token.current = getToken;
  const api = useMemo(() => riderApi(() => token.current()), []);

  useEffect(() => {
    if (!loaded) return;
    setSignedInHint(signedIn);
    if (!signedIn || !userId) return;
    let running = false;
    let again = false;
    // One round at a time; a change made during one is sent by the next.
    const sync = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          await syncRider(api, userId);
        } while (again);
      } catch {
        // Offline, or the account's API is down: the device's copy stands,
        // and the next change or visit tries again.
      } finally {
        running = false;
      }
    };
    void sync();
    const onChange = (event: Event) => {
      if ((event as CustomEvent<PrefsChange>).detail === "device") void sync();
    };
    window.addEventListener(PREFS_EVENT, onChange);
    return () => window.removeEventListener(PREFS_EVENT, onChange);
  }, [loaded, signedIn, userId, api]);

  return null;
}
