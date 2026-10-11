import { useEffect, useRef, useState } from "react";
import { readForecastJson } from "../force5/src/manifests";
import { shouldRevalidate } from "../force5/src/revalidate";
import { forecastUrl } from "../force5/src/urls";
import {
  loadBlendSquares,
  parseSpotBlend,
  SPOT_BLEND_PATH,
  type LoadedBlend,
  type SpotBlend,
} from "./spotBlend";

/** The blend's pointer's URL. */
export const spotBlendUrl = () => forecastUrl(SPOT_BLEND_PATH);

/**
 * The published blend's pointer (src/spotBlend.ts), revalidated on the
 * five-minute cadence the manifests use. It carries the times and the models
 * but no places: those are in its squares (`useBlendSquares`). `resolved` turns
 * true once the first answer is in, a file or a failure: a missing or malformed
 * blend is a normal state (a fresh checkout has none until `npm run blend` is
 * run) and only means the map works the blend out from the manifests itself,
 * as it always did.
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
        // shown: a new object would read its squares and rate every place again
        // for nothing.
        setBlend((shown) =>
          shown &&
          shown.generatedAt === parsed.generatedAt &&
          shown.run === parsed.run &&
          shown.base === parsed.base
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

/**
 * The places of the blend's `squares` (the squares in view and the reader's
 * own spots', src/App.tsx), read through the one spot loader. Squares already
 * read are kept by that loader, so looking back at somewhere costs nothing.
 *
 * While a new set of squares, or a new blend, is on its way the last one read
 * stays shown: every place in it is still right for the run it came from, and
 * a light that went blank at every pan would be worse than one that waits a
 * moment. A place outside the squares read is in no row, and its light stays
 * pending rather than reading as calm.
 *
 * `failed` is true when every square asked for could not be read: then the
 * blend is as good as missing, and the caller works it out itself, as it does
 * when there is no blend at all.
 */
export function useBlendSquares(
  blend: SpotBlend | null,
  squares: readonly string[] | null,
): { blend: LoadedBlend | null; failed: boolean } {
  const key = squares === null ? null : [...squares].sort().join(",");
  const [state, setState] = useState<{
    pointer: SpotBlend;
    key: string;
    loaded: LoadedBlend;
  } | null>(null);
  useEffect(() => {
    if (!blend || key === null) return;
    let current = true;
    void loadBlendSquares(
      readForecastJson,
      blend,
      key ? key.split(",") : [],
    ).then((loaded) => {
      if (current) setState({ pointer: blend, key, loaded });
    });
    return () => {
      current = false;
    };
  }, [blend, key]);
  if (!blend || !state) return { blend: null, failed: false };
  const settled = state.pointer === blend && state.key === key;
  return {
    blend: state.loaded,
    failed:
      settled && !state.loaded.loaded.length && state.loaded.failed.length > 0,
  };
}
