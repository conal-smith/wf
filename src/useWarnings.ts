/**
 * Met Éireann's warnings for the map: the `warnings` job's file
 * (force5/src/warnings.ts), read when the map opens and again every five
 * minutes while the tab is in view, as the forecast pointers are. Null until
 * it has been read, and whenever it cannot be: the map then shows no
 * warnings, and its link to Met Éireann's page, as before.
 */
import { useEffect, useState } from "react";
import { REVALIDATE_MS } from "../force5/src/revalidate";
import { forecastUrl } from "../force5/src/urls";
import {
  WARNINGS_URL,
  readWarningsManifest,
  type WarningsManifest,
} from "../force5/src/warnings";

export async function loadWarnings(
  signal?: AbortSignal,
): Promise<WarningsManifest | null> {
  try {
    const response = await fetch(forecastUrl(WARNINGS_URL), {
      cache: "no-cache",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    });
    return response.ok ? readWarningsManifest(await response.json()) : null;
  } catch {
    return null;
  }
}

export function useWarnings(): WarningsManifest | null {
  const [manifest, setManifest] = useState<WarningsManifest | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const read = () => {
      if (document.visibilityState === "hidden") return;
      loadWarnings(abort.signal).then((next) => {
        if (abort.signal.aborted) return;
        // The same file again keeps the same object, so nothing re-rates.
        setManifest((was) =>
          next && was && was.generatedAt === next.generatedAt ? was : next,
        );
      });
    };
    read();
    const timer = window.setInterval(read, REVALIDATE_MS);
    document.addEventListener("visibilitychange", read);
    return () => {
      abort.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, []);
  return manifest;
}
