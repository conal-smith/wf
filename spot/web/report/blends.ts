/**
 * The week graph's two blends, as figures: the wind's, from each model the
 * rider blends (Settings), and the waves', from the published wave blend
 * (src/waveBlend.ts) or, where it is missing, from the leading wave model
 * alone. The graph draws them; nothing here touches the stars, which stay
 * the one model's own (force5/src/lead.ts).
 */
import { leadHours, modelWeight } from "../../../force5/src/weights";
import {
  WAVE_MATCH_HOURS,
  WAVE_SOURCE_PREFERENCE,
  type PartitionKey,
} from "../../../force5/src/waves";
import type { WaveBlendHour, WavePartHour } from "../../../force5/src/waveBlend";
import type { ForecastHour } from "../../../mcp/api/forecast";
import type { ModelSeries } from "./detail";

const HOUR = 3600000;

/** A row of the week: its start, how many hours it stands for, its hour. */
export type WeekRow = { time: number; step: number; hour: ForecastHour };

/** The wind blend at one row: the models' weighted mean, and their range. */
export interface WindBlendAt {
  kn: number;
  low: number;
  high: number;
  /** How many models fed it. */
  count: number;
}

/**
 * The wind blend at every row any of `models` reaches: each model's own wind
 * weighted as the chart's blend weights it (`modelWeight`, by how far into
 * its run the hour is), and the lowest and highest of them. `runs` gives each
 * model's run time; a model with none counts as on its first day.
 */
export function windBlend(
  models: readonly ModelSeries[],
  runs: readonly { id: string; run_time: string }[],
): Map<number, WindBlendAt> {
  const runOf = new Map(runs.map((run) => [run.id, Date.parse(run.run_time)]));
  const at = new Map<number, { kn: number; weight: number }[]>();
  for (const m of models)
    for (const p of m.points) {
      const run = runOf.get(m.id);
      const weight = modelWeight(
        m.id,
        run === undefined || !Number.isFinite(run) ? 0 : leadHours(run, p.time),
      );
      const list = at.get(p.time) ?? [];
      list.push({ kn: p.kn, weight });
      at.set(p.time, list);
    }
  const out = new Map<number, WindBlendAt>();
  for (const [time, list] of at) {
    const total = list.reduce((sum, v) => sum + v.weight, 0);
    const kn =
      total > 0
        ? list.reduce((sum, v) => sum + v.kn * v.weight, 0) / total
        : list.reduce((sum, v) => sum + v.kn, 0) / list.length;
    out.set(time, {
      kn,
      low: Math.min(...list.map((v) => v.kn)),
      high: Math.max(...list.map((v) => v.kn)),
      count: list.length,
    });
  }
  return out;
}

/**
 * The sea at one row of the week. The headline (height, period, direction
 * and the partitions) is one model's own, the first in the rider's order
 * (`waveLeadOrder`) that reaches the hour; the blend, where it is published,
 * stands beside it, as the wind's blend stands beside the wind's headline.
 */
export interface WaveRow {
  heightM: number | null;
  periodS: number | null;
  from: number | null;
  /** The model the headline and its partitions are, or null. */
  lead: string | null;
  parts: Partial<Record<PartitionKey, WavePartHour>>;
  /** The lowest and highest of the models: the spread band. */
  lowM: number | null;
  highM: number | null;
  /** How many wave models reach the hour. */
  count: number;
  /** The published wave blend's median height and period, or null without one. */
  blendM: number | null;
  blendPeriodS: number | null;
}

/** One wave model's own line: a point at each row one of its steps falls in. */
export interface WaveLine {
  id: string;
  points: { time: number; step: number; m: number }[];
  /** Its first and last step, as instants. */
  first: number;
  last: number;
}

export interface WaveWeek {
  /** One per row, or null where no wave model reaches it. */
  rows: (WaveRow | null)[];
  /** Every wave model that reaches the place, in the handover order. */
  lines: WaveLine[];
  /** Whether any row has the published blend. */
  blended: boolean;
}

/** Wave model ids in the handover order, any it does not know after, by name. */
export function waveOrder(
  ids: Iterable<string>,
  preference: readonly string[] = WAVE_SOURCE_PREFERENCE,
): string[] {
  const rank = (id: string) => {
    const i = preference.indexOf(id);
    return i === -1 ? preference.length : i;
  };
  return [...new Set(ids)].sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  );
}

/**
 * The week's sea, row by row. The headline at each row is the first model
 * of `order` (`waveLeadOrder`: the rider's choice handed on past its run, or
 * the finest model at each hour) that has a step within `WAVE_MATCH_HOURS`,
 * its own height, period, direction and partitions, never averaged with
 * another's. Beside it, where the published wave blend has the place
 * (`blend`, its hours from `waveBlendHours`), the blend's time nearest the
 * row: its median and the models' range. Without it the range is the
 * models' own at the row, and there is no blend to say. Every wave model's
 * own line is drawn through its own steps, never between them.
 */
export function waveWeek(
  rows: readonly WeekRow[],
  blend: readonly WaveBlendHour[] | null,
  order: readonly string[] = WAVE_SOURCE_PREFERENCE,
): WaveWeek {
  const times = (blend ?? []).map((h) => Date.parse(h.time));
  const nearest = (time: number): WaveBlendHour | null => {
    let best = -1;
    times.forEach((t, i) => {
      if (best < 0 || Math.abs(t - time) < Math.abs(times[best] - time))
        best = i;
    });
    return best >= 0 &&
      Math.abs(times[best] - time) <= WAVE_MATCH_HOURS * HOUR &&
      blend![best].heightM !== null
      ? blend![best]
      : null;
  };
  const ids = waveOrder(
    rows.flatMap((r) => Object.keys(r.hour.waves?.by_model ?? {})),
    WAVE_SOURCE_PREFERENCE,
  );
  // The rider's order first, then any model it does not name.
  const leads = [...order, ...ids.filter((id) => !order.includes(id))];
  let blended = false;
  const out = rows.map((row): WaveRow | null => {
    const waves = row.hour.waves;
    const by = waves?.by_model ?? {};
    const b = nearest(row.time);
    if (b) blended = true;
    const lead = leads.find((id) => by[id]) ?? null;
    const own = lead ? by[lead] : null;
    const heights = Object.values(by).map((m) => m.height_m);
    const parts: WaveRow["parts"] = {};
    for (const [key, part] of Object.entries(own?.parts ?? {}))
      parts[key as PartitionKey] = {
        heightM: part.height_m,
        periodS: part.period_s,
        from: part.direction_deg,
      };
    // A forecast without each model's own (an older server) has the one.
    const heightM = own ? own.height_m : (waves?.height_m ?? null);
    if (heightM === null && !b) return null;
    return {
      heightM,
      periodS: own ? own.period_s : (waves?.period_s ?? null),
      from: own ? own.direction_deg : (waves?.direction_deg ?? null),
      lead,
      parts,
      lowM: b?.lowM ?? (heights.length ? Math.min(...heights) : null),
      highM: b?.highM ?? (heights.length ? Math.max(...heights) : null),
      count: b?.count ?? heights.length,
      blendM: b?.heightM ?? null,
      blendPeriodS: b?.periodS ?? null,
    };
  });
  const lines = ids.flatMap((id): WaveLine[] => {
    const seen = new Set<string>();
    const points: WaveLine["points"] = [];
    const steps: number[] = [];
    for (const row of rows) {
      const own = row.hour.waves?.by_model?.[id];
      if (!own || seen.has(own.time)) continue;
      const at = Date.parse(own.time);
      steps.push(at);
      // Drawn at the row its own step falls in: nothing read between steps.
      if (at < row.time || at >= row.time + row.step * HOUR) continue;
      seen.add(own.time);
      points.push({ time: row.time, step: row.step, m: own.height_m });
    }
    return steps.length
      ? [
          {
            id,
            points,
            first: Math.min(...steps),
            last: Math.max(...steps),
          },
        ]
      : [];
  });
  return { rows: out, lines, blended };
}

/** Where the headline's model changes, and to which: "GFS-Wave from here". */
export function waveHandovers(
  rows: readonly { time: number }[],
  week: WaveWeek,
): { time: number; to: string }[] {
  const out: { time: number; to: string }[] = [];
  let last: string | null = null;
  week.rows.forEach((row, i) => {
    const lead = row?.lead ?? null;
    if (lead && last && lead !== last) out.push({ time: rows[i].time, to: lead });
    if (lead) last = lead;
  });
  return out;
}

/** One sea state's partition rows, as the graph names them. */
export const PART_ROWS = [
  ["swell1", "Swell 1"],
  ["swell2", "Swell 2"],
  ["swell3", "Swell 3"],
  ["windsea", "Wind sea"],
] as const;
export type PartRow = (typeof PART_ROWS)[number][0];

/**
 * A row's partition as the graph shows it: Swell 1 is the lead model's first
 * swell partition, or where it publishes its swell as one height (Irish Shelf
 * SWAN's), that.
 */
export function partOf(
  row: WaveRow | null,
  key: PartRow,
): WavePartHour | null {
  if (!row) return null;
  const part =
    key === "swell1" && row.parts.swell1?.heightM == null
      ? row.parts.swell
      : row.parts[key];
  return part && part.heightM !== null ? part : null;
}
