/**
 * The chart in the other theme without building the map again. MapLibre takes
 * its colours once, as the style is made (chartStyle.ts reads them off the
 * theme), so when the rider switches between light and dark
 * (shared/web/theme.ts) every paint property is walked and each of the old
 * theme's chart colours is swapped for the new theme's. The wind, the lights
 * and the other layers the map adds of its own keep what they draw.
 */
import type { ChartColours } from "./chartStyle";

type Paintable = {
  getStyle(): { layers?: { id: string; paint?: Record<string, unknown> }[] };
  setPaintProperty(layer: string, name: string, value: unknown): unknown;
};

/** Old colour (lower case) to new, for every chart colour that changed. */
export function colourSwaps(
  from: ChartColours,
  to: ChartColours,
): Map<string, string> {
  const swaps = new Map<string, string>();
  const pair = (a: string, b: string) => {
    if (a && b && a.toLowerCase() !== b.toLowerCase())
      swaps.set(a.toLowerCase(), b);
  };
  for (const key of Object.keys(from) as (keyof ChartColours)[]) {
    const a = from[key];
    const b = to[key];
    if (Array.isArray(a) && Array.isArray(b))
      a.forEach((c, i) => pair(c, b[i]));
    else if (typeof a === "string" && typeof b === "string") pair(a, b);
  }
  return swaps;
}

/** A paint value with its colours swapped: strings, and inside expressions. */
export function swapColours(
  value: unknown,
  swaps: Map<string, string>,
): unknown {
  if (typeof value === "string") return swaps.get(value.toLowerCase()) ?? value;
  if (Array.isArray(value)) return value.map((v) => swapColours(v, swaps));
  return value;
}

/** Walk the style and set every paint property whose colours change. */
export function rethemeMap(map: Paintable, swaps: Map<string, string>) {
  if (!swaps.size) return 0;
  let changed = 0;
  for (const layer of map.getStyle().layers ?? []) {
    for (const [name, value] of Object.entries(layer.paint ?? {})) {
      const next = swapColours(value, swaps);
      if (JSON.stringify(next) === JSON.stringify(value)) continue;
      map.setPaintProperty(layer.id, name, next);
      changed += 1;
    }
  }
  return changed;
}
