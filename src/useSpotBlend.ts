import { useEffect, useRef, useState } from "react";
import { shouldRevalidate } from "../force5/src/revalidate";
import { forecastUrl } from "../force5/src/urls";
import { parseSpotBlend, SPOT_BLEND_PATH, type SpotBlend } from "./spotBlend";

/** The blend's URL. */
export const spotBlendUrl = () => forecastUrl(SPOT_BLEND_PATH);

/**
 * The published blend (src/spotBlend.ts), revalidated on the five-minute
 * cadence the manifests use. `resolved` turns true once the first answer is in,
 * a file or a failure: a missing or malformed blend is a normal state (a fresh
 * checkout has none until `npm run blend` is run) and only means the map works
 * the blend out from the manifests itself, as it always did.
 */
export function useSpotBlend(busy = false): {
  blend: SpotBlend | null;
  resolved: boolean;
} {
  const [blend, setBlend] = useState<SpotBlend | null>(null);
  const [resolved, setResolved] = useState(false);
  const tag = useRef<string | null>(null);
  const lastCheck = useRef(Date.now());
  const busyNow = useRef(busy);
  busyNow.current = busy;
  useEffect(() => {
    const controller = new AbortController();
    const url = spotBlendUrl();
    const load = async (first: boolean) => {
      // Asked for when the map mounts, not by the entry (force5/src/boot.ts).
      try {
        const response = await fetch(url, {
          cache: "no-cache",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const etag =
          response.headers.get("etag") ?? response.headers.get("last-modified");
        if (etag && etag === tag.current) {
          void response.body?.cancel().catch(() => {});
          return;
        }
        const parsed = parseSpotBlend(await response.json());
        if (controller.signal.aborted) return;
        tag.current = etag;
        // The same blend again (a server that sends no ETag, say) keeps the one
        // shown: a new object would rate every place again for nothing.
        setBlend((shown) =>
          shown &&
          shown.generatedAt === parsed.generatedAt &&
          shown.run === parsed.run
            ? shown
            : parsed,
        );
      } catch {
        // A later check that fails keeps the blend already shown.
        if (controller.signal.aborted) return;
        if (first) setBlend(null);
      } finally {
        if (!controller.signal.aborted) setResolved(true);
      }
    };
    void load(true);
    const tick = () => {
      if (
        !shouldRevalidate(
          lastCheck.current,
          Date.now(),
          document.visibilityState === "visible",
          busyNow.current,
        )
      )
        return;
      lastCheck.current = Date.now();
      void load(false);
    };
    const timer = window.setInterval(tick, 60000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return { blend, resolved };
}
