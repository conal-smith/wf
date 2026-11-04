import { useEffect, useRef, useState } from "react";
import { readForecastJson } from "../force5/src/manifests";
import { onPageReturn, pageVisible } from "../force5/src/pageLife";
import { shouldRevalidate } from "../force5/src/revalidate";
import type { ReadJson } from "../force5/src/spotData";
import {
  loadWaveBlendSquares,
  parseWaveBlend,
  staleWaveBlend,
  WAVE_BLEND_PATH,
  type LoadedWaveBlend,
  type WaveBlend,
} from "./waveBlend";

/**
 * The published wave blend's pointer and the places of `squares`, or null:
 * when there is none (a fresh checkout until `npm run wave-blend` is run, or
 * a site whose job has not published yet), when it will not parse, or when it
 * is older than `WAVE_BLEND_MAX_AGE_HOURS`. Never throws: a reader without the
 * wave blend shows each wave model's own rows, as it always did.
 *
 * `previous` is the blend already in hand: when the pointer names the same run
 * directory it is kept, squares and all, rather than read again.
 */
export async function loadWaveBlend(
  read: ReadJson,
  squares: readonly string[],
  previous: LoadedWaveBlend | null = null,
  now = Date.now(),
): Promise<LoadedWaveBlend | null> {
  let pointer: WaveBlend;
  try {
    pointer = parseWaveBlend(await read(WAVE_BLEND_PATH));
  } catch {
    return null;
  }
  if (staleWaveBlend(pointer, now)) return null;
  const wanted = [...new Set(squares)].sort();
  if (
    previous &&
    previous.base === pointer.base &&
    previous.generatedAt === pointer.generatedAt &&
    wanted.every((square) => previous.loaded.includes(square))
  )
    return previous;
  try {
    return await loadWaveBlendSquares(read, pointer, wanted);
  } catch {
    // A place in two squares: a run that does not hold together is none.
    return null;
  }
}

/**
 * The wave blend for the places of `squares` (a spot page's own square, say),
 * revalidated on the five-minute cadence the manifests use. `resolved` turns
 * true once the first answer is in, a blend or none. A later check that fails
 * keeps the blend already shown.
 */
export function useWaveBlend(squares: readonly string[] | null): {
  blend: LoadedWaveBlend | null;
  resolved: boolean;
} {
  const key = squares === null ? null : [...new Set(squares)].sort().join(",");
  const [state, setState] = useState<{
    key: string;
    blend: LoadedWaveBlend | null;
  } | null>(null);
  const shown = useRef<LoadedWaveBlend | null>(null);
  const lastCheck = useRef(Date.now());
  useEffect(() => {
    if (key === null) return;
    let current = true;
    const wanted = key ? key.split(",") : [];
    const load = async (first: boolean) => {
      const blend = await loadWaveBlend(
        readForecastJson,
        wanted,
        shown.current,
      );
      if (!current) return;
      if (!blend && !first) return;
      shown.current = blend;
      setState((before) =>
        before && before.key === key && before.blend === blend
          ? before
          : { key, blend },
      );
    };
    void load(true);
    const tick = () => {
      if (
        !shouldRevalidate(lastCheck.current, Date.now(), pageVisible(), false)
      )
        return;
      lastCheck.current = Date.now();
      void load(false);
    };
    const timer = window.setInterval(tick, 60000);
    const stopListening = onPageReturn(tick);
    return () => {
      current = false;
      clearInterval(timer);
      stopListening();
    };
  }, [key]);
  const settled = state !== null && state.key === key;
  return { blend: settled ? state.blend : null, resolved: settled };
}
