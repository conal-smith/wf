/**
 * Whether the rider shows the hours after dark (Settings, Hours: "Day and
 * night" or "Daylight only"), for a page that does not hold the preferences itself: the
 * spot pages. One source of truth, the stored preferences (`nightHours`,
 * force5.prefs.v1), read as the page is first drawn, so it never draws the
 * night and then takes it away, and read again when they change under it, in
 * this tab or another (shared/web/riderSync.ts `onPrefsChange`).
 */
import { useEffect, useState } from "react";
import { loadPrefs, type NightHours } from "../../force5/src/prefs";
import { onPrefsChange } from "./riderSync";

export function useNightHours(): NightHours {
  const [hours, setHours] = useState<NightHours>(() => loadPrefs().nightHours);
  useEffect(() => onPrefsChange(() => setHours(loadPrefs().nightHours)), []);
  return hours;
}
