// The wind blend at one hour: every model's own wind, gust and direction,
// each weighted as the chart's blend weights it (force5/src/weights.ts
// `modelWeight`, by the model and how far into its run the hour is). It is
// what the Wind blend row draws, and what a rider who picks the blend
// (force5/src/lead.ts `BLEND_MODEL`) has the hours and the stars rated from.
//
// Dependency-free but for the weights, so the forecast server (mcp/api,
// compiled on its own), the map's ratings and the spot page all blend alike;
// force5/ingest/consensus.py replicates it for the verification.
import { modelWeight } from "./weights.js";

/** One model's own reading at the hour. */
export interface BlendMember {
  model: string;
  /** Mean wind and gust, in any one unit; the gust null where it gives none. */
  speed: number;
  gust: number | null;
  /** The wind's vector, in the same unit. */
  u: number;
  v: number;
  /** Hours from the model's run to the hour (`leadHours`). */
  leadHours: number;
  /** Its grid, for a model the backtest has not judged (`blendWeight`). */
  resolutionKm?: number | null;
}

/** The blend: the weighted means, and how many models fed it. */
export interface BlendAt {
  speed: number;
  /** The weighted mean of the gusts the models give, null where none gives one. */
  gust: number | null;
  /** The weighted mean vector: its direction is the blend's. */
  u: number;
  v: number;
  count: number;
}

/**
 * The blend of `members`, or null with none. The speed is the weighted mean
 * of the models' speeds (not the mean vector's length, which a disagreement
 * on direction would shrink); the direction is the weighted mean vector's. A
 * model's weight of zero or less counts nothing; all at zero count alike.
 */
export function blendHour(members: readonly BlendMember[]): BlendAt | null {
  if (!members.length) return null;
  const weights = members.map((m) =>
    Math.max(0, modelWeight(m.model, m.leadHours, m.resolutionKm)),
  );
  const total = weights.reduce((sum, w) => sum + w, 0);
  const weightOf = (i: number) => (total > 0 ? weights[i] : 1);
  const sum = (pick: (m: BlendMember) => number, only = members.map(() => true)) => {
    let value = 0;
    let weight = 0;
    members.forEach((m, i) => {
      if (!only[i]) return;
      value += pick(m) * weightOf(i);
      weight += weightOf(i);
    });
    return weight > 0 ? value / weight : null;
  };
  const gusty = members.map((m) => m.gust !== null && Number.isFinite(m.gust));
  return {
    speed: sum((m) => m.speed)!,
    gust: gusty.some(Boolean) ? sum((m) => m.gust!, gusty) : null,
    u: sum((m) => m.u)!,
    v: sum((m) => m.v)!,
    count: members.length,
  };
}
