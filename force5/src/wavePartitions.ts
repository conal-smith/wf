// The swell and wind-sea partitions the wave models publish, by the
// variables each names them with. Plain data with no imports, so the forecast
// server (mcp/api, compiled on its own) reads the same names as the wave
// blend (force5/src/waveBlend.ts) and the spot page.

/**
 * The partitions the lead model's step is read for, by the variables each
 * model names them with. `swell` is a model's whole swell as one height
 * (Irish Shelf SWAN's `hswe`), not a partition of it; `swell1` to `swell3` are
 * the swell partitions in the models' own order, most energetic first. The
 * wind sea's period is GFS-Wave's mean (`mpww`) or the Met Office's peak
 * (`ppww`), as `waveFields` in force5/src/waves.ts reads it.
 */
export const WAVE_PARTITIONS = {
  windsea: { height: ["shww"], period: ["mpww", "ppww"], direction: ["mdww"] },
  swell: { height: ["hswe"], period: [], direction: [] },
  swell1: {
    height: ["swell1_h"],
    period: ["swell1_p"],
    direction: ["swell1_d"],
  },
  swell2: {
    height: ["swell2_h"],
    period: ["swell2_p"],
    direction: ["swell2_d"],
  },
  swell3: {
    height: ["swell3_h"],
    period: ["swell3_p"],
    direction: ["swell3_d"],
  },
} as const satisfies Record<
  string,
  {
    height: readonly string[];
    period: readonly string[];
    direction: readonly string[];
  }
>;
export type PartitionKey = keyof typeof WAVE_PARTITIONS;
export const PARTITION_KEYS = Object.keys(WAVE_PARTITIONS) as PartitionKey[];
