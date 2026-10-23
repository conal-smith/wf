/**
 * The rider's display preferences and who the stars are rated for: the site's
 * Prefs (force5/src/prefs.ts), stored under the site's key in the device's
 * localStorage (storage.ts). One provider, so every screen reads one value.
 *
 * The rider changes the site's ways: weight and wings through `saveRider`,
 * which keeps the stored star rating; the level pill through `withStarsOn`,
 * which keeps the rider's own rating as they go on or off it; and that rating
 * itself only through `withCustomStars`. The last two stamp when what the
 * account keeps has changed. The rider's one model (the chart's, the dock's
 * and the stars'), through `withRiderModel` (`setModel`).
 */
import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  loadPrefs,
  saveRider,
  savePrefs,
  withCustomStars,
  withRiderModel,
  withStarsOn,
  type Prefs,
} from "../../../force5/src/prefs";
import type { CustomRating, Rider, StarsOn } from "../../../force5/src/stars";

interface PrefsValue {
  prefs: Prefs;
  update: (change: (prefs: Prefs) => Prefs) => void;
  /** A new weight or wings; the rider's own star rating stays as stored. */
  changeRider: (change: (rider: Rider) => Rider) => void;
  /** The level pill: a level, or the rider's own rating, which is kept either way. */
  setStarsOn: (on: StarsOn) => void;
  /** The rider's own star rating saved and rating, or deleted with null. */
  setCustomStars: (custom: CustomRating | null) => void;
  /** The rider's model: the one the chart draws, the dock gives and the stars rate. */
  setModel: (model: string) => void;
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
  const setStarsOn = useCallback((on: StarsOn) => update((p) => withStarsOn(p, on)), [update]);
  const setCustomStars = useCallback(
    (custom: CustomRating | null) => update((p) => withCustomStars(p, custom)),
    [update],
  );
  const setModel = useCallback(
    (model: string) => update((p) => ({ ...p, rider: withRiderModel(p.rider, model) })),
    [update],
  );
  const value = useMemo(
    () => ({ prefs, update, changeRider, setStarsOn, setCustomStars, setModel }),
    [prefs, update, changeRider, setStarsOn, setCustomStars, setModel],
  );
  return <PrefsContext value={value}>{children}</PrefsContext>;
}

export function usePrefs(): PrefsValue {
  const value = use(PrefsContext);
  if (!value) throw new Error("usePrefs outside PrefsProvider");
  return value;
}
