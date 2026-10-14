/**
 * The dock's arithmetic, apart from React Native so it is tested in Node: the
 * rows and their heights, the scrub (the site's `stripTrack`, restated as
 * worklets so the cursor follows the finger on the UI thread), what each hour
 * says to a screen reader, the wind's ink, the night's hatch, the tide's
 * curve per day and the pen's loop. The forecast itself is the site's
 * (src/strip.ts, src/ratings.ts, force5/src/stars.ts): read here, never
 * restated.
 */
import type { ForecastView, Prefs, RowKey } from "../../../../force5/src/prefs";
import { rowOn } from "../../../../force5/src/prefs";
import {
  SESSION_LABEL,
  SHORE_LABEL,
  type HourRating,
} from "../../../../force5/src/stars";
import { seaTemperatureText } from "../../../../force5/src/seaTemperature";
import { presentWeather, type PresentWeather } from "../../../../force5/src/surface";
import { eventsBetween, tideAt, type TideCurve } from "../../../../force5/src/tides";
import { KNOTS, convert, type Units } from "../../../../force5/src/units";
import { variableValue } from "../../../../force5/src/variables";
import { compass } from "../../../../force5/src/weather";
import type { PlaceHour } from "../../../../src/ratings";
import {
  clock,
  dayBest,
  dayLong,
  dayShort,
  irishDate,
  rainColumns,
  type DayBest,
  type StripColumn,
  type StripDay,
  type StripGeometry,
} from "../../../../src/strip";
import type { SeaTemperatureState, SpotWaves, SpotWeather } from "../../../../src/useBlend";
import { windScale } from "../../theme/tokens";

/* ------------------------------------------------------------------ view */

export type DockView = "table" | "blend";

/**
 * The view the dock opens in, from the stored preference. The site's dock
 * opens on the table; the stored default ("blend") predates the dock having a
 * choice, so the app keeps the table until a rider picks the chart, which it
 * stores as "candles" (the blend chart, with its candles of wind).
 */
export const viewFromPrefs = (view: ForecastView): DockView =>
  view === "candles" ? "blend" : "table";
export const prefsView = (view: DockView): ForecastView =>
  view === "blend" ? "candles" : "table";

/* ------------------------------------------------------------------ rows */

/** The rows a rider can switch (More › Dock rows), as the site's prefs name them. */
export type DockRow =
  | "stars"
  | "wind"
  | "from"
  | "wing"
  | "tide"
  | "waves"
  | "sky"
  | "air"
  | "rain"
  | "sea";

export interface DockRowInfo {
  row: DockRow;
  /** The preference that switches it; the wind is the forecast and stays. */
  key: RowKey | null;
  label: string;
  /** Under the fold, opened by "More rows". */
  more: boolean;
}

export const DOCK_ROWS: readonly DockRowInfo[] = [
  { row: "stars", key: "stars", label: "Stars", more: false },
  { row: "wind", key: null, label: "Wind and gust", more: false },
  { row: "from", key: "dir", label: "Direction", more: false },
  { row: "wing", key: "wing", label: "Wing size", more: false },
  { row: "tide", key: "tide", label: "Tide", more: false },
  { row: "waves", key: "waves", label: "Waves", more: true },
  { row: "sky", key: "weather", label: "Sky", more: true },
  { row: "air", key: "air", label: "Air temperature", more: true },
  { row: "rain", key: "rain", label: "Rain", more: true },
  { row: "sea", key: "sea", label: "Sea temperature", more: true },
];

/**
 * Whether a row is on. The site's dock always drew its rows, so an untouched
 * row is on (the sea row only where there is a temperature to show); once the
 * rider has switched it, their choice stands (`rowOn`).
 */
export function dockRowOn(prefs: Prefs, row: DockRow, seaAvailable = true): boolean {
  const info = DOCK_ROWS.find((r) => r.row === row);
  if (!info?.key) return true;
  return rowOn(prefs, info.key, row === "sea" ? seaAvailable : true);
}

/** Heights at the base type size; scaled with Dynamic Type (`rowLayout`). */
export const ROW_HEIGHT: Record<DockRow | "day" | "hour" | "blend", number> = {
  day: 24,
  hour: 22,
  stars: 22,
  wind: 30,
  from: 22,
  wing: 20,
  blend: 104,
  tide: 46,
  waves: 24,
  sky: 24,
  air: 22,
  rain: 22,
  sea: 22,
};

export interface RowSlot {
  row: DockRow | "day" | "hour" | "blend";
  y: number;
  h: number;
}

export interface RowLayout {
  slots: RowSlot[];
  height: number;
  at: Partial<Record<RowSlot["row"], RowSlot>>;
}

/**
 * The dock's rows top to bottom. Peek shows the hours, the stars and the wind;
 * open shows the week as the site's dock does, the table's rows or the blend
 * chart, the tide, and the fold. No spot: the days and the hours alone.
 */
export function rowLayout(options: {
  detent: "peek" | "open";
  view: DockView;
  spot: boolean;
  more: boolean;
  on: (row: DockRow) => boolean;
  scale?: number;
}): RowLayout {
  const { detent, view, spot, more, on } = options;
  const scale = Math.max(1, Math.min(1.35, options.scale ?? 1));
  const rows: RowSlot["row"][] = ["day", "hour"];
  if (spot) {
    if (detent === "peek") {
      if (on("stars")) rows.push("stars");
      rows.push("wind");
    } else {
      if (view === "blend") rows.push("blend");
      else {
        for (const row of ["stars", "wind", "from", "wing"] as const)
          if (on(row)) rows.push(row);
      }
      if (on("tide")) rows.push("tide");
      if (more)
        for (const row of ["waves", "sky", "air", "rain", "sea"] as const)
          if (on(row)) rows.push(row);
    }
  }
  const slots: RowSlot[] = [];
  let y = 0;
  for (const row of rows) {
    const h = Math.round(ROW_HEIGHT[row] * (row === "blend" || row === "tide" ? 1 : scale));
    slots.push({ row, y, h });
    y += h;
  }
  const at: RowLayout["at"] = {};
  for (const slot of slots) at[slot.row] = slot;
  return { slots, height: y, at };
}

/** A column's width: the site's phone width, wider with Dynamic Type. */
export function columnWidths(scale = 1): { cw: number; coarse: number; label: number } {
  const s = Math.max(1, Math.min(1.35, scale));
  const cw = Math.round(52 * s);
  return { cw, coarse: cw - 4, label: Math.round(30 * s) };
}

/**
 * Pixels per star in an hour's cell, as the site's dock sizes them: the row's
 * size where the column is wide enough, else as large as five fit.
 */
export const starSize = (width: number) => Math.max(4, Math.min(9.5, (width - 6) / 5.4));

/* ------------------------------------------------------------------ scrub */

/**
 * The site's `stripTrack` (src/strip.ts) as plain numbers, so the UI thread
 * can place the cursor and find the hour under it without crossing to
 * JavaScript. Through the week the cursor stands in the middle and the hours
 * slide under it; at either end it walks out to the first or last hour.
 */
export interface TrackParams {
  mode: 0 | 1 | 2; // 0: everything fits; 1: the cursor walks all the way; 2: still middle
  c0: number;
  cN: number;
  max: number;
  mid: number;
  head: number;
  tail: number;
}

export function trackParams(g: StripGeometry, width: number): TrackParams {
  const n = g.x.length;
  const centre = (i: number) => g.x[i] + g.w[i] / 2;
  const c0 = n ? centre(0) : 0;
  const cN = n ? centre(n - 1) : 0;
  const max = Math.max(0, g.total - width);
  const mid = width / 2;
  const head = Math.max(0, mid - c0);
  const tail = Math.max(0, cN - max - mid);
  const mode = !n || max <= 0 ? 0 : head + tail > max ? 1 : 2;
  return { mode, c0, cN, max, mid, head, tail };
}

/** The position along the strip under the cursor at a scroll (`stripTrack.timeAt`). */
export function trackTimeAt(p: TrackParams, scroll: number): number {
  "worklet";
  const s = Math.max(0, Math.min(p.max, scroll));
  if (p.mode === 0) return p.c0;
  if (p.mode === 1) return p.c0 + ((p.cN - p.c0) * s) / p.max;
  if (s < p.head) return p.c0 + 2 * s;
  if (s > p.max - p.tail) return 2 * s + p.mid - p.max + p.tail;
  return s + p.mid;
}

/** Where the cursor stands in the strip's window at a scroll (`stripTrack.cursorAt`). */
export function trackCursorAt(p: TrackParams, scroll: number): number {
  "worklet";
  const s = Math.max(0, Math.min(p.max, scroll));
  return trackTimeAt(p, s) - s;
}

/** The column whose centre is nearest a position (`columnAtX`), on the UI thread. */
export function nearestCentre(centres: readonly number[], position: number): number {
  "worklet";
  let lo = 0;
  let hi = centres.length - 1;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (centres[mid] < position) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(position - centres[lo - 1]) < Math.abs(position - centres[lo]))
    return lo - 1;
  return lo;
}

/**
 * The hour a scrub commits to the forecast, at most this often while the
 * finger is still moving: every screen that reads the forecast redraws on a
 * commit, so it is held back to a few a second and made at once on settle.
 */
export const COMMIT_MS = 280;

/** Whether a commit is due: the hour moved and the last commit is old enough. */
export const commitDue = (now: number, last: number, interval = COMMIT_MS) =>
  now - last >= interval;

/* ------------------------------------------------------------------ words */

const COMPASS_WORDS: Record<string, string> = {
  N: "north",
  NNE: "north-north-east",
  NE: "north-east",
  ENE: "east-north-east",
  E: "east",
  ESE: "east-south-east",
  SE: "south-east",
  SSE: "south-south-east",
  S: "south",
  SSW: "south-south-west",
  SW: "south-west",
  WSW: "west-south-west",
  W: "west",
  WNW: "west-north-west",
  NW: "north-west",
  NNW: "north-north-west",
};

/** "west-south-west": a bearing, spoken. */
export const compassWords = (degrees: number) => COMPASS_WORDS[compass(degrees)] ?? compass(degrees);

const UNIT_WORDS: Record<Units, string> = {
  kn: "knots",
  "m/s": "metres per second",
  "km/h": "kilometres per hour",
  mph: "miles per hour",
};

/** A speed in knots, in the reader's units, rounded as the dock rounds it. */
export const speedIn = (kn: number, units: Units) => Math.round(convert(kn / KNOTS, units));

/**
 * One hour read aloud: "Saturday 14:00, 4 stars, west-south-west 18 knots
 * gusting 24". The dark and an hour not yet read say so; never "calm" for
 * what is unknown.
 */
export function hourReading(
  column: Pick<StripColumn, "time">,
  hour: PlaceHour | null | undefined,
  units: Units,
): string {
  const when = `${dayLong(column.time)} ${clock(column.time)}`;
  if (!hour) return `${when}, not read yet`;
  const parts = [when];
  const rating = hour.rating;
  if (rating)
    parts.push(
      rating.potential
        ? `${rating.stars} star${rating.stars === 1 ? "" : "s"}${
            rating.potential > rating.stars ? `, ${rating.potential} possible` : ""
          }`
        : `no stars, ${SESSION_LABEL[rating.session].toLowerCase()}`,
    );
  else if (!hour.daylight) parts.push("dark, not rated");
  if (hour.windKn === null) parts.push("no wind reading");
  else {
    const from = hour.from === null ? "" : `${compassWords(hour.from)} `;
    const gust =
      hour.gustKn === null ? "" : ` gusting ${speedIn(hour.gustKn, units)}`;
    parts.push(`${from}${speedIn(hour.windKn, units)} ${UNIT_WORDS[units]}${gust}`);
  }
  if (rating?.shore === "offshore" || rating?.shore === "cross-off")
    parts.push(SHORE_LABEL[rating.shore]);
  return parts.join(", ");
}

/** "14 g22 · WSW": the hour's wind as the readout prints it. */
export function windFigures(hour: PlaceHour | null | undefined, units: Units): string {
  if (!hour || hour.windKn === null) return "–";
  const gust = hour.gustKn === null ? "" : ` g${speedIn(hour.gustKn, units)}`;
  const from = hour.from === null ? "" : ` · ${compass(hour.from)}`;
  return `${speedIn(hour.windKn, units)}${gust}${from}`;
}

/** The wing an hour's stars assume, or null where the wind gives no stars. */
export const wingFor = (rating: HourRating | null | undefined) =>
  rating?.potential ? (rating.wing.own ?? rating.wing.recommended) : null;

/* ------------------------------------------------------------------ ink */

/** The wind scale's ink for a speed in knots: wind speed and nothing else. */
export function windInk(kn: number): string {
  let ink = windScale[0][1];
  for (const [from, colour] of windScale) if (kn >= from) ink = colour;
  return ink;
}

/**
 * The night's fine diagonal hatch (ui/theme.css `hatch`) over a box, as one
 * path of strokes `gap` apart, falling left to right as the site's does.
 */
export function hatchPath(x: number, width: number, height: number, gap = 4): string {
  let d = "";
  for (let k = -height; k < width; k += gap) {
    const x0 = Math.max(0, k);
    const y0 = x0 - k;
    const x1 = Math.min(width, k + height);
    const y1 = x1 - k;
    if (x1 <= x0) continue;
    d += `M${(x + x0).toFixed(1)} ${y0.toFixed(1)}L${(x + x1).toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d;
}

/** Runs of dark columns, edge to edge, in a day's own coordinates. */
export function darkRuns(
  daylight: readonly boolean[],
  g: StripGeometry,
  day: Pick<StripDay, "start" | "count">,
): { x: number; w: number }[] {
  const out: { x: number; w: number }[] = [];
  const origin = g.x[day.start] ?? 0;
  for (let i = day.start; i < day.start + day.count; i++) {
    if (daylight[i] !== false) continue;
    const x = g.x[i] - origin;
    const last = out[out.length - 1];
    if (last && Math.abs(last.x + last.w - x) < 0.5) last.w += g.w[i];
    else out.push({ x, w: g.w[i] });
  }
  return out;
}

/* ------------------------------------------------------------------ days */

/** "Sat 18". */
export const dayHead = (day: Pick<StripDay, "noon" | "date">) =>
  `${dayShort(day.noon)} ${Number(day.date.slice(8))}`;

export interface BestLine {
  /** "Best today", "Best Sat". */
  label: string;
  /** "13–16", "13:00". */
  when: string;
  stars: number;
  potential: number;
  wing: number | null;
  /** The first column of the stretch: a tap goes there. */
  from: number;
}

/**
 * The selected day's best stretch still ahead, as the pen's note on the site
 * says it ("Sat ★★★★ 13–16, 5 m²"); null for a day with nothing rated.
 */
export function bestLine(
  hours: readonly PlaceHour[] | null | undefined,
  strip: readonly StripColumn[],
  day: StripDay | undefined,
  now: number,
): BestLine | null {
  if (!hours || !day) return null;
  const best: DayBest | null = dayBest(
    hours.map((h) => h.rating),
    day,
    now,
    strip.map((c) => c.time),
  );
  if (!best) return null;
  const rating = hours[best.from]?.rating ?? null;
  const today = irishDate(now) === day.date;
  return {
    label: today ? "Best today" : `Best ${dayShort(day.noon)}`,
    when:
      best.from === best.to
        ? clock(strip[best.from].time)
        : `${clock(strip[best.from].time).slice(0, 2)}–${clock(strip[best.to].time).slice(0, 2)}`,
    stars: best.stars,
    potential: rating?.potential ?? best.stars,
    wing: wingFor(rating),
    from: best.from,
  };
}

/** The day a column falls in. */
export const dayOf = (days: readonly StripDay[], column: number) =>
  days.find((d) => column >= d.start && column < d.start + d.count);

/**
 * Whether the chart can draw the selected hour: past the map model's run the
 * dock offers the run that reaches it (src/App.tsx `reachable`).
 */
export const beyondMapModel = (column: Pick<StripColumn, "model"> | undefined, mapModel = "harmonie") =>
  !!column && column.model !== mapModel;

/* ------------------------------------------------------------------ tide */

/** Where a time falls along a day, between its columns' centres (the site's `xOf`), day-local. */
export function xInDay(
  columns: readonly Pick<StripColumn, "time">[],
  day: Pick<StripDay, "start" | "count">,
  g: StripGeometry,
  t: number,
): number {
  const a = day.start;
  const b = day.start + day.count - 1;
  const origin = g.x[a];
  const centre = (i: number) => g.x[i] + g.w[i] / 2 - origin;
  const step = (i: number, j: number) => columns[j].time - columns[i].time;
  if (t <= columns[a].time) {
    const span = day.count > 1 ? step(a, a + 1) : 3600000;
    return centre(a) - ((columns[a].time - t) / span) * g.w[a];
  }
  if (t >= columns[b].time) {
    const span = day.count > 1 ? step(b - 1, b) : 3600000;
    return centre(b) + ((t - columns[b].time) / span) * g.w[b];
  }
  for (let i = a; i < b; i++)
    if (t <= columns[i + 1].time)
      return centre(i) + ((t - columns[i].time) / step(i, i + 1)) * (centre(i + 1) - centre(i));
  return centre(b);
}

export interface TideTurnMark {
  key: string;
  x: number;
  y: number;
  high: boolean;
  text: string;
  /** "High tide 17:35 · 3.9 m". */
  full: string;
  /** Where its label goes, if anywhere. */
  label: { x: number; anchor: "start" | "end" } | null;
}

export interface DayTidePaths {
  fill: string;
  line: string;
  turns: TideTurnMark[];
}

/** The mono face's advance at the tide labels' size, for laying them out. */
const TIDE_CHAR = 5.9;

/** The tide's vertical scale in a row `height` tall, across the whole curve. */
export function tideScale(curve: TideCurve, height: number) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of curve.curve) {
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  return (h: number) => height - 6 - ((h - lo) / (hi - lo || 1)) * (height - 16);
}

/**
 * One day of the tide row: the curve with its fill, and each high and low
 * water with a short label in its band (highs along the top, lows along the
 * foot), placed after its dot, else before it, else left out, as the site's
 * dock lays them out.
 */
export function dayTide(
  curve: TideCurve,
  columns: readonly Pick<StripColumn, "time">[],
  day: Pick<StripDay, "start" | "count">,
  g: StripGeometry,
  height: number,
): DayTidePaths | null {
  const y = tideScale(curve, height);
  const first = columns[day.start];
  const last = columns[day.start + day.count - 1];
  if (!first || !last) return null;
  const half = day.count > 1 ? (columns[day.start + 1].time - first.time) / 2 : 1800000;
  const halfEnd =
    day.count > 1 ? (last.time - columns[day.start + day.count - 2].time) / 2 : 1800000;
  const a = first.time - half;
  const b = last.time + halfEnd;
  let d = "";
  for (let t = a; t <= b; t += 600000) {
    const h = tideAt(curve, t);
    if (h === null) continue;
    d += `${d ? "L" : "M"}${xInDay(columns, day, g, t).toFixed(1)} ${y(h).toFixed(1)}`;
  }
  if (!d) return null;
  const x0 = xInDay(columns, day, g, a);
  const x1 = xInDay(columns, day, g, b);
  const width = x1 - x0;
  const turns: TideTurnMark[] = eventsBetween(curve, a, b).map((event) => {
    const t = Date.parse(event.time);
    const high = event.kind === "high";
    return {
      key: event.time,
      x: xInDay(columns, day, g, t),
      y: y(event.height),
      high,
      text: clock(t),
      full: `${high ? "High" : "Low"} tide ${clock(t)} · ${event.height.toFixed(1)} m`,
      label: null,
    };
  });
  for (const high of [true, false]) {
    let edge = -Infinity;
    for (const turn of turns.filter((t) => t.high === high).sort((p, q) => p.x - q.x)) {
      const w = turn.text.length * TIDE_CHAR;
      const after = turn.x + 5;
      const before = turn.x - 5 - w;
      const clear = (from: number) =>
        !turns.some(
          (o) =>
            o !== turn &&
            o.x > from - 4 &&
            o.x < from + w + 4 &&
            (high ? o.y < 16 : o.y > height - 14),
        );
      if (after >= edge + 8 && after + w <= x0 + width && clear(after)) {
        turn.label = { x: after, anchor: "start" };
        edge = after + w;
      } else if (before >= Math.max(x0, edge + 8) && clear(before)) {
        turn.label = { x: turn.x - 5, anchor: "end" };
        edge = turn.x - 5;
      }
    }
  }
  return {
    line: d,
    fill: `${d}L${x1.toFixed(1)} ${height}L${x0.toFixed(1)} ${height}Z`,
    turns,
  };
}

/* ------------------------------------------------------------------ pen */

/** A seeded hand in [0, 1): the same day, the same ring. */
function hand(seed: number): () => number {
  let s = Math.abs(Math.floor(seed)) * 9301 + 49297;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

/**
 * The pen's loop round a stretch: an ellipse drawn in one stroke that runs a
 * little past its start, with a small wobble, as a hand rings an hour.
 */
export function penLoop(cx: number, cy: number, rx: number, ry: number, seed: number): string {
  const rnd = hand(seed);
  const start = rnd() * Math.PI * 2;
  const turns = 1.08 + rnd() * 0.08;
  const steps = 64;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = start + (i / steps) * turns * Math.PI * 2;
    const wob = 0.8 * Math.sin(t * 3 + seed) + 0.4 * Math.sin(t * 7 + seed * 2);
    const grow = 1.6 * (i / steps);
    const x = cx + Math.cos(t) * (rx + wob + grow);
    const y = cy + Math.sin(t) * (ry + wob * 0.5 + grow * 0.5);
    d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

/** The fewest stars the pen will loop (the site's LOOP_MIN_STARS). */
export const LOOP_MIN_STARS = 2;

/* ------------------------------------------------------------------ more rows */

/** Rain, in millimetres over one step, that saturates a cell's tint. */
export const RAIN_FULL_MM = 4;

export interface WaveCell {
  height: number;
  period: number | null;
  from: number | null;
  /** "1.4 m at 9 s from WSW". */
  words: string;
}
export interface SkyCell {
  icon: PresentWeather["icon"];
  words: string;
}
export interface RainCell {
  /** Printed by the interval's last column; the others carry a dot. */
  text: string;
  own: boolean;
  /** 0–1, how far it fills the cell's tint. */
  tint: number;
  words: string;
}

/** A row's cells, or a note across it where there is nothing to put in them. */
export type MoreRow<C> = { cells: (C | null)[]; note: null } | { cells: null; note: string };

export interface MoreCells {
  waves: MoreRow<WaveCell>;
  sky: MoreRow<SkyCell>;
  air: MoreRow<number>;
  rain: MoreRow<RainCell>;
  /** The sea: a measurement is one value across the row, a model's skin a cell each. */
  sea: MoreRow<number> & { measured: boolean };
  /** Whether there is a sea temperature to show at all (the row's default). */
  seaAvailable: boolean;
}

/**
 * The rows under the fold, as the site's dock fills them: one native step per
 * column (a code or an amount does not survive being interpolated), the rain
 * printed once per interval, and the sea's measurement where a station is in
 * range, else the model's skin temperature, marked approximate.
 */
export function moreCells(
  columns: readonly Pick<StripColumn, "time">[],
  waves: SpotWaves,
  weather: SpotWeather,
  sea: SeaTemperatureState,
): MoreCells {
  const n = columns.length;
  const set = waves.source?.fields.total ?? null;
  const wavesRow: MoreRow<WaveCell> =
    waves.source && set
      ? {
          note: null,
          cells: Array.from({ length: n }, (_, c) => {
            const step = waves.columns[c];
            const height = step ? step.values[set.height] : null;
            if (typeof height !== "number") return null;
            const p = set.period ? step!.values[set.period] : null;
            const d = set.direction ? step!.values[set.direction] : null;
            const period = typeof p === "number" ? p : null;
            const from = typeof d === "number" ? d : null;
            return {
              height,
              period,
              from,
              words: `${height.toFixed(1)} m${period !== null ? ` at ${Math.round(period)} s` : ""}${
                from !== null ? ` from ${compass(from)}` : ""
              }`,
            };
          }),
        }
      : {
          cells: null,
          note: waves.published ? "No wave model reaches this spot" : "Waves: reading…",
        };
  const fields = weather.source?.fields;
  const at = (c: number, name: string | null | undefined) => variableValue(weather.columns[c], name);
  const none = (note: string) => ({ cells: null, note }) as const;
  const skyRow: MoreRow<SkyCell> = fields
    ? {
        note: null,
        cells: Array.from({ length: n }, (_, c) => {
          const reading = presentWeather(at(c, fields.present));
          return reading ? { icon: reading.icon, words: reading.description } : null;
        }),
      }
    : none(weather.published ? "No weather model reaches this spot" : "Weather: reading…");
  const airRow: MoreRow<number> = fields
    ? {
        note: null,
        cells: Array.from({ length: n }, (_, c) => {
          const v = at(c, fields.air);
          return v === null ? null : Math.round(v);
        }),
      }
    : none("");
  const series = weather.source?.series ?? [];
  const rain = fields?.rain ? rainColumns(columns.map((c) => c.time), series) : [];
  const rainRow: MoreRow<RainCell> = fields?.rain
    ? {
        note: null,
        cells: Array.from({ length: n }, (_, c) => {
          const covered = rain[c];
          const value = covered ? variableValue(series[covered.step], fields.rain) : null;
          if (!covered || value === null) return null;
          const amount = value < 0.05 ? "0" : value.toFixed(1);
          return {
            text: covered.own ? amount : "·",
            own: covered.own,
            tint: Math.min(1, value / RAIN_FULL_MM),
            words: `${amount} millimetres in the ${covered.hours} hours to ${clock(covered.end)}`,
          };
        }),
      }
    : none("");
  let seaRow: MoreCells["sea"];
  if (sea.observed) {
    const text = seaTemperatureText(sea.observed);
    seaRow = { cells: null, note: `${text.value} measured · ${text.detail}`, measured: true };
  } else if (fields?.skin) {
    seaRow = {
      note: null,
      measured: false,
      cells: Array.from({ length: n }, (_, c) => {
        const v = at(c, fields.skin);
        return v === null ? null : Math.round(v);
      }),
    };
  } else seaRow = { cells: null, note: sea.loading ? "" : "No sea temperature here", measured: false };
  return {
    waves: wavesRow,
    sky: skyRow,
    air: airRow,
    rain: rainRow,
    sea: seaRow,
    seaAvailable: !!sea.observed || !!fields?.skin,
  };
}
