/**
 * The wind as measured at the weather stations and buoys: the `wind-obs`
 * job's file (force5/src/windObs.ts), read once something wants it and again
 * every five minutes while the tab is in view, as the warnings are. Null
 * until it has been read, and whenever it cannot be: the Live wind layer and
 * the timelines then show no readings, and the forecast as before.
 */
import { useEffect, useState } from "react";
import { REVALIDATE_MS } from "../../force5/src/revalidate";
import { forecastUrl } from "../../force5/src/urls";
import { WIND_OBS_URL, readWindObs, type WindObs } from "../../force5/src/windObs";

export async function loadWindObs(
  signal?: AbortSignal,
): Promise<WindObs | null> {
  try {
    const response = await fetch(forecastUrl(WIND_OBS_URL), {
      cache: "no-cache",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    });
    return response.ok ? readWindObs(await response.json()) : null;
  } catch {
    return null;
  }
}

/** The readings, read only while `wanted`; kept once read. */
export function useWindObs(wanted = true): WindObs | null {
  const [obs, setObs] = useState<WindObs | null>(null);
  useEffect(() => {
    if (!wanted) return;
    const abort = new AbortController();
    const read = () => {
      if (document.visibilityState === "hidden") return;
      loadWindObs(abort.signal).then((next) => {
        if (abort.signal.aborted || !next) return;
        // The same file again keeps the same object, so nothing draws again.
        setObs((was) =>
          was && was.generatedAt === next.generatedAt ? was : next,
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
  }, [wanted]);
  return obs;
}
