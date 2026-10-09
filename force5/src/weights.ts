// How much each model counts in the wind consensus. Dependency-free, so the
// forecast server (mcp/api, compiled on its own) reads the same weights as the
// site's stars and the dock's blend (force5/src/blend.ts re-exports them).

/** Grid spacings, in km, at which a model's line starts to count for more. */
export const FINE_GRID_KM = 3;
export const REGIONAL_GRID_KM = 8;

/**
 * How much one model counts in the consensus, by the grid it is published on.
 * A fine grid sees the headlands, bays and sea breezes a 25 km global grid
 * averages away, so at the coast it is the better witness: 3 km or finer counts
 * three times, up to 8 km twice, anything coarser or unstated once. The fine
 * grids all stop within about three days, so past them the global models are
 * left counting equally, with nothing to outweigh them.
 */
export function blendWeight(resolutionKm: number | null | undefined): number {
  if (typeof resolutionKm !== "number" || !Number.isFinite(resolutionKm))
    return 1;
  if (resolutionKm <= FINE_GRID_KM) return 3;
  if (resolutionKm <= REGIONAL_GRID_KM) return 2;
  return 1;
}

/**
 * The value at half the total weight. A point that lands exactly between two
 * values takes their midpoint, so equal weights give the ordinary median.
 */
export function weightedMedian(
  values: readonly number[],
  weights: readonly number[],
): number {
  const order = values
    .map((value, i) => ({ value, weight: weights[i] ?? 1 }))
    .sort((a, b) => a.value - b.value);
  const half = order.reduce((sum, o) => sum + o.weight, 0) / 2;
  let below = 0;
  for (let i = 0; i < order.length; i++) {
    below += order[i].weight;
    if (Math.abs(below - half) < 1e-9 && i + 1 < order.length)
      return (order[i].value + order[i + 1].value) / 2;
    if (below > half) return order[i].value;
  }
  return order[order.length - 1].value;
}
