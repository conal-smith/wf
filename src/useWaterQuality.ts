/**
 * The EPA's bathing water notices for the map: the `water-quality` job's file
 * (force5/src/waterQuality.ts), read when the map opens and again every five
 * minutes while the tab is in view, as Met Éireann's warnings are
 * (src/useWarnings.ts). Null until it has been read, and whenever it cannot
 * be: the map then shows no notices.
 */
import { useEffect, useState } from "react";
import { REVALIDATE_MS } from "../force5/src/revalidate";
import { forecastUrl } from "../force5/src/urls";
import {
  WATER_QUALITY_URL,
  readWaterQualityManifest,
  type WaterQualityManifest,
} from "../force5/src/waterQuality";

export async function loadWaterQuality(
  signal?: AbortSignal,
): Promise<WaterQualityManifest | null> {
  try {
    const response = await fetch(forecastUrl(WATER_QUALITY_URL), {
      cache: "no-cache",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    });
    return response.ok
      ? readWaterQualityManifest(await response.json())
      : null;
  } catch {
    return null;
  }
}

export function useWaterQuality(): WaterQualityManifest | null {
  const [manifest, setManifest] = useState<WaterQualityManifest | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const read = () => {
      if (document.visibilityState === "hidden") return;
      loadWaterQuality(abort.signal).then((next) => {
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
