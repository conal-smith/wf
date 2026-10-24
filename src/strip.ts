/**
 * The dock's fortnight: the forecast's own columns for the next fifteen Irish
 * days, round the clock, as one strip of hours under a fixed cursor. The night
 * is in it: its hours are hatched and carry no stars (nobody is rated for a
 * session they cannot see, force5/src/stars.ts), but the wind still blows
 * through them, and a strip that cut them out put Monday 20:00 beside Tuesday
 * 07:00 and had nowhere to stand when the time was in between.
 *
 * The columns keep their model's cadence: hourly where the fine runs reach,
 * three- and six-hourly further out. Everything here is pure; times are UTC
 * milliseconds and every label is Irish local time.
 */
import {
  hoursBetween,
  rainIntervals,
  stepCovering,
  stepsWithin,
} from "../force5/src/rain";
import type { DockColumn } from "../force5/src/timeline";

export const TIME_ZONE = "Europe/Dublin";
/** The old dock's range: as far as the longest run reaches. */
export const STRIP_DAYS = 15;

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const hourFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const weekday = new Intl.DateTimeFormat("en-IE", {
  timeZone: TIME_ZONE,
  weekday: "short",
});
const weekdayLong = new Intl.DateTimeFormat("en-IE", {
  timeZone: TIME_ZONE,
  weekday: "long",
});
const dayMonth = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
});

/** "2026-10-05": the Irish calendar day an instant falls on. */
export const irishDate = (time: number) => dateFormat.format(new Date(time));
/** "13:25", Irish time. */
export const clock = (time: number) => hourFormat.format(new Date(time));
/** The Irish hour of the day, 0–23. */
export const irishHour = (time: number) =>
  Number(hourFormat.format(new Date(time)).slice(0, 2));
/** "Mon". */
export const dayShort = (time: number) => weekday.format(new Date(time));
/** "Monday". */
export const dayLong = (time: number) => weekdayLong.format(new Date(time));
/** "Tue 20 Oct, 14:00", Irish time: an hour as a screen reader says it. */
export const timeSpoken = (time: number) =>
  `${dayShort(time)} ${dayMonth.format(new Date(time))}, ${clock(time)}`;
/** "13". */
export const hourLabel = (time: number) => clock(time).slice(0, 2);

export interface StripColumn extends DockColumn {
  time: number;
  /** Irish calendar day. */
  date: string;
  /** Irish hour, 0–23. */
  hour: number;
  /** Which of the strip's days it falls in. */
  day: number;
}

export interface StripDay {
  date: string;
  /** Noon of the day, for its labels. */
  noon: number;
  /** First column, and how many. */
  start: number;
  count: number;
}

/**
 * The dock's columns that fall in the next `days` Irish days, every one of
 * them: day and night, at whatever cadence their run publishes.
 */
export function stripColumns(
  columns: readonly DockColumn[],
  now: number,
  days = STRIP_DAYS,
): StripColumn[] {
  const dates: string[] = [];
  for (let d = 0; dates.length < days && d < days + 2; d++) {
    const date = irishDate(now + d * 86400000);
    if (!dates.includes(date)) dates.push(date);
  }
  const out: StripColumn[] = [];
  for (const column of columns) {
    const time = Date.parse(column.validTime);
    const date = irishDate(time);
    const day = dates.indexOf(date);
    if (day < 0) continue;
    out.push({ ...column, time, date, hour: irishHour(time), day });
  }
  return out;
}

/** The strip's days, each with its run of columns. */
export function stripDays(columns: readonly StripColumn[]): StripDay[] {
  const out: StripDay[] = [];
  columns.forEach((column, at) => {
    const last = out[out.length - 1];
    if (last && last.date === column.date) last.count++;
    else
      out.push({
        date: column.date,
        noon: Date.parse(`${column.date}T12:00:00Z`),
        start: at,
        count: 1,
      });
  });
  return out;
}

/** The column for a time: the nearest one, in either direction. */
export function nearestColumn(
  columns: readonly { time: number }[],
  time: number,
): number {
  let best = 0;
  let gap = Infinity;
  columns.forEach((column, at) => {
    const g = Math.abs(column.time - time);
    if (g < gap) {
      gap = g;
      best = at;
    }
  });
  return best;
}

/**
 * The column a page opens on: the hour now, night or day, if the strip has a
 * column within its cadence of it; else the next one it has (a strip whose
 * first run has not started yet), else the last.
 */
export function openingColumn(
  columns: readonly { time: number }[],
  now: number,
): number {
  if (!columns.length) return 0;
  const at = nearestColumn(columns, now);
  if (Math.abs(columns[at].time - now) <= 90 * 60000) return at;
  const next = columns.findIndex((column) => column.time >= now);
  return next < 0 ? columns.length - 1 : next;
}

/**
 * Page Up and Page Down: the same hour of the day after (`step` 1) or before
 * (-1), or the nearest hour to it that day has, since a day of hourly columns
 * and a day of three-hourly ones do not line up column for column. At either
 * end of the strip the time stays in the first or the last day.
 */
export function dayStep(
  columns: readonly { hour: number }[],
  days: readonly StripDay[],
  selected: number,
  step: number,
): number {
  const from = days.findIndex(
    (d) => selected >= d.start && selected < d.start + d.count,
  );
  if (from < 0 || !columns[selected]) return selected;
  const to = days[Math.max(0, Math.min(days.length - 1, from + step))];
  const hour = columns[selected].hour;
  let best = to.start;
  for (let i = to.start; i < to.start + to.count; i++)
    if (Math.abs(columns[i].hour - hour) < Math.abs(columns[best].hour - hour))
      best = i;
  return best;
}

/** Where each column sits along the strip, and how wide it is. */
export interface StripGeometry {
  x: number[];
  w: number[];
  total: number;
}

/**
 * Hourly columns at the full width; the three- and six-hourly ones further
 * out a little narrower, so a fortnight is not a swipe too far and a day of
 * five steps does not read as long as a day of fourteen.
 */
export function stripGeometry(
  columns: readonly { time: number; date: string }[],
  cw: number,
  coarse = Math.round(cw * 0.8),
): StripGeometry {
  const x: number[] = [];
  const w: number[] = [];
  let total = 0;
  columns.forEach((column, at) => {
    const gaps = [columns[at - 1], columns[at + 1]]
      .filter((n) => n && n.date === column.date)
      .map((n) => Math.abs(n!.time - column.time));
    const step = gaps.length ? Math.min(...gaps) : 3600000;
    const width = step >= 3 * 3600000 ? coarse : cw;
    x.push(total);
    w.push(width);
    total += width;
  });
  return { x, w, total };
}

/** The column whose centre is nearest a position along the strip. */
export function columnAtX(g: StripGeometry, position: number): number {
  let lo = 0,
    hi = g.x.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (g.x[mid] + g.w[mid] / 2 < position) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) {
    const a = g.x[lo - 1] + g.w[lo - 1] / 2;
    const b = g.x[lo] + g.w[lo] / 2;
    if (Math.abs(position - a) < Math.abs(position - b)) return lo - 1;
  }
  return lo;
}

/**
 * The strip's scroll against its cursor. Through the middle of the week the
 * cursor stands still in the middle of the strip and the hours slide under
 * it, as the mockup draws it. At either end it cannot: centring the first
 * hour would leave half a strip of blank paper before it, which is what the
 * dock used to do. So the table starts flush against the row labels, and
 * over the first half-width of scroll the cursor walks from the first
 * column's centre out to the middle (and back out to the last at the far
 * end). The time still follows the scroll the whole way, one-to-one and
 * without a jump: in those end zones a pixel of scroll moves the cursor a
 * pixel as well as the table, so the time runs at twice the pace there.
 *
 * `scrollFor` and `timeAt` are each other's inverse, in strip pixels: the
 * scroll that puts column `i` under the cursor, and the position along the
 * strip under the cursor at a scroll. The cursor stands at `timeAt(s) - s`
 * within the strip's window, `width` wide.
 */
export interface StripTrack {
  scrollFor(column: number): number;
  timeAt(scroll: number): number;
  cursorAt(scroll: number): number;
}

export function stripTrack(g: StripGeometry, width: number): StripTrack {
  const n = g.x.length;
  const centre = (i: number) => g.x[i] + g.w[i] / 2;
  const c0 = n ? centre(0) : 0;
  const cN = n ? centre(n - 1) : 0;
  const max = Math.max(0, g.total - width);
  const mid = width / 2;
  // How far the cursor walks at each end: from the first centre to the
  // middle, and from the middle to the last centre at full scroll.
  const head = Math.max(0, mid - c0);
  const tail = Math.max(0, cN - max - mid);
  let timeAt: (s: number) => number;
  let scrollFor: (c: number) => number;
  if (!n || max <= 0) {
    // Everything fits: nothing scrolls, the cursor goes to the hour.
    timeAt = () => c0;
    scrollFor = () => 0;
  } else if (head + tail > max) {
    // Too short a strip for a still middle: the cursor walks the whole way.
    timeAt = (s) => c0 + ((cN - c0) * s) / max;
    scrollFor = (c) => ((c - c0) * max) / (cN - c0 || 1);
  } else {
    timeAt = (s) =>
      s < head ? c0 + 2 * s : s > max - tail ? 2 * s + mid - max + tail : s + mid;
    scrollFor = (c) =>
      c < c0 + 2 * head
        ? (c - c0) / 2
        : c > cN - 2 * tail
          ? (c - mid + max - tail) / 2
          : c - mid;
  }
  const clamp = (s: number) => Math.max(0, Math.min(max, s));
  return {
    scrollFor: (column) =>
      n ? clamp(scrollFor(centre(Math.max(0, Math.min(n - 1, column))))) : 0,
    timeAt: (scroll) => timeAt(clamp(scroll)),
    cursorAt: (scroll) => timeAt(clamp(scroll)) - clamp(scroll),
  };
}

/**
 * Which weather steps' rain each column shows. A step's rain is the amount in
 * the interval that ends at it, so it belongs to that interval and to no other
 * hour. A column reads the steps whose intervals lie inside its own hours
 * (from the column before it to its own time): one for an hourly column over
 * hourly steps, three for a three-hourly column over them, and prints their
 * amount per hour. A column inside a longer interval (an hourly column in a
 * three-hour step) is marked as inside it, and the latest column in it prints
 * it, since three hourly columns each reading a three-hour total would say
 * three times the rain. A column no interval covers has none to show. The
 * steps need not fall on the columns' hours: a run on the hour in UTC lands an
 * hour off Irish summer time's three-hourly columns.
 */
export interface RainColumn {
  /** The steps whose rain the column adds up, in order. */
  steps: number[];
  /** The last of them, which names the model in the cell's title. */
  step: number;
  /** Whether this column prints the rain. */
  own: boolean;
  /** The end of the hours it covers, and how many hours they are. */
  end: number;
  hours: number;
}

export function rainColumns(
  times: readonly number[],
  steps: readonly {
    validTime: string;
    precipIntervalHours?: readonly [number, number] | null;
  }[],
): (RainColumn | null)[] {
  const intervals = rainIntervals(steps);
  const out: (RainColumn | null)[] = times.map((t, i) => {
    // The column's own hours: from the column before, or for the first, as
    // long as the gap to the next.
    const from =
      i > 0 ? times[i - 1] : t - (times.length > 1 ? times[1] - t : 3600000);
    const inside = stepsWithin(intervals, from, t);
    if (inside.length) {
      const last = inside[inside.length - 1];
      return {
        steps: inside,
        step: last,
        own: true,
        end: intervals[last].end,
        hours: hoursBetween(intervals[inside[0]].start, intervals[last].end),
      };
    }
    const k = stepCovering(intervals, t);
    if (k === null) return null;
    const { start, end } = intervals[k];
    return { steps: [k], step: k, own: false, end, hours: hoursBetween(start, end) };
  });
  // The latest column inside a longer interval prints it.
  const printed = new Set<number>();
  for (let i = out.length - 1; i >= 0; i--) {
    const c = out[i];
    if (!c || c.own || printed.has(c.step)) continue;
    c.own = true;
    printed.add(c.step);
  }
  return out;
}
