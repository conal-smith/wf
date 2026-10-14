/**
 * The rider's display preferences and who the stars are rated for: the site's
 * Prefs (force5/src/prefs.ts), stored under the site's key in the device's
 * localStorage (storage.ts). One provider, so every screen reads one value.
 */
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";
import { loadPrefs, savePrefs, type Prefs } from "../../../force5/src/prefs";

interface PrefsValue {
  prefs: Prefs;
  update: (change: (prefs: Prefs) => Prefs) => void;
}

const PrefsContext = createContext<PrefsValue | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState(() => loadPrefs());
  const update = useCallback((change: (prefs: Prefs) => Prefs) => {
    setPrefs((current) => {
      const next = change(current);
      savePrefs(next);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ prefs, update }), [prefs, update]);
  return <PrefsContext value={value}>{children}</PrefsContext>;
}

export function usePrefs(): PrefsValue {
  const value = use(PrefsContext);
  if (!value) throw new Error("usePrefs outside PrefsProvider");
  return value;
}
