/**
 * The rider's display preferences and who the stars are rated for: the site's
 * Prefs (force5/src/prefs.ts), stored under the site's key in the device's
 * localStorage (storage.ts). One provider, so every screen reads one value.
 *
 * The rider changes the site's two ways: weight, level and wings through
 * `saveRider`, which keeps the stored star rating; the rider's own star
 * rating only through `withCustomStars`, which stamps when it changed.
 */
import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { loadPrefs, saveRider, savePrefs, withCustomStars, type Prefs } from "../../../force5/src/prefs";
import type { CustomRating, Rider } from "../../../force5/src/stars";

interface PrefsValue {
  prefs: Prefs;
  update: (change: (prefs: Prefs) => Prefs) => void;
  /** A new weight, level or wings; the rider's own star rating stays as stored. */
  changeRider: (change: (rider: Rider) => Rider) => void;
  /** The rider's own star rating set, or reset to the level's with null. */
  setCustomStars: (custom: CustomRating | null) => void;
}

const PrefsContext = createContext<PrefsValue | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState(() => loadPrefs());
  // What was last saved, read at once: two changes in one frame build on each
  // other, and storage is never behind what the screens are shown.
  const current = useRef(prefs);
  const take = useCallback((next: Prefs) => {
    current.current = next;
    setPrefs(next);
  }, []);
  const update = useCallback(
    (change: (prefs: Prefs) => Prefs) => {
      const next = change(current.current);
      savePrefs(next);
      take(next);
    },
    [take],
  );
  const changeRider = useCallback(
    (change: (rider: Rider) => Rider) => take(saveRider(change(current.current.rider))),
    [take],
  );
  const setCustomStars = useCallback(
    (custom: CustomRating | null) => update((p) => withCustomStars(p, custom)),
    [update],
  );
  const value = useMemo(
    () => ({ prefs, update, changeRider, setCustomStars }),
    [prefs, update, changeRider, setCustomStars],
  );
  return <PrefsContext value={value}>{children}</PrefsContext>;
}

export function usePrefs(): PrefsValue {
  const value = use(PrefsContext);
  if (!value) throw new Error("usePrefs outside PrefsProvider");
  return value;
}
