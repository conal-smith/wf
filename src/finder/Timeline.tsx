/**
 * The week under the finder's head: each day's daylight hours as a bar in the
 * wind's colours, near the rider, and one hour chosen, marked by the pen with
 * its time over it. Press anywhere for that day and hour, and drag along it,
 * across the days; a finger taps an hour, and swipes the bar sideways for the
 * days past the screen's edge. It is a slider for the keys and a screen
 * reader: the arrows go along the light, Page Up and Page Down a day.
 *
 * The hour is the chart's selected time (src/App.tsx), so the chart opens on
 * the hour chosen here.
 */
import { forwardRef, useEffect, useRef } from "react";
import { clock, timeSpoken, type StripColumn, type StripDay } from "../strip";
import { RING, tv } from "../../ui/tv";
import {
  hourAt,
  markAt,
  stepHour,
  timelineHours,
  type TimelineDay,
} from "./finder";

const styles = tv({
  slots: {
    root: [
      "relative z-popover border-b border-line bg-ground px-4.5 pt-5 pb-2.5",
      "max-wide:overflow-x-auto max-wide:px-3 max-wide:pt-5 max-wide:pb-2 max-wide:scrollbar-none",
    ],
    track: [
      "grid cursor-pointer touch-pan-x grid-cols-7 gap-1 select-none rounded-control",
      "max-wide:flex max-wide:w-max",
      RING,
    ],
    day: "min-w-0 max-wide:w-23 max-wide:shrink-0",
    bar: [
      "relative flex h-5.5 rounded-control inset-ring inset-ring-line opacity-55",
      "transition-opacity duration-fast motion-reduce:transition-none",
    ],
    hour: "block h-full first-of-type:rounded-l-control last-of-type:rounded-r-control",
    label:
      "flex justify-between px-0.5 pt-1 font-mono text-eyebrow font-semibold tracking-wide text-ink-2 uppercase",
    mark: "pointer-events-none absolute -top-1 -bottom-1 w-0.75 -translate-x-1/2 rounded-full bg-pen ring-1 ring-card",
    time: "absolute bottom-full left-1/2 mb-1 -translate-x-1/2 bg-ground px-1 font-mono text-eyebrow font-semibold whitespace-nowrap text-pen-ink",
  },
  variants: {
    chosen: {
      true: {
        bar: "opacity-100 inset-ring-ink",
        label: "text-ink",
      },
    },
  },
});

/** A finger that moves this far is a swipe along the bar, not a tap on it. */
const SLOP = 8;

export const Timeline = forwardRef<
  HTMLDivElement,
  {
    days: readonly TimelineDay[];
    strip: readonly StripColumn[];
    stripDays: readonly StripDay[];
    selected: number;
    onSelect: (at: number) => void;
    /** An hour's colour near the rider, or null with no wind for it yet. */
    colourAt: (at: number) => string | null;
  }
>(function Timeline(
  { days, strip, stripDays, selected, onSelect, colourAt },
  ref,
) {
  const bars = useRef<(HTMLDivElement | null)[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const mark = markAt(days, strip, selected);
  const all = timelineHours(days);
  const index = all.findIndex((h) => h.at === selected);
  const column = strip[selected];

  /** The hour under a point along the bars, across the days and past their ends. */
  const pick = (x: number) => {
    const rects = bars.current.map((b) => b?.getBoundingClientRect() ?? null);
    let day = rects.findIndex((r) => r && x >= r.left && x <= r.right);
    if (day < 0) {
      // In a gap between days, or past either end: the nearer edge's day.
      let gap = Infinity;
      rects.forEach((r, i) => {
        if (!r) return;
        const d = Math.min(Math.abs(x - r.left), Math.abs(x - r.right));
        if (d < gap) {
          gap = d;
          day = i;
        }
      });
    }
    const r = rects[day];
    if (!r) return;
    const at = hourAt(days, day, (x - r.left) / r.width);
    if (at !== null && at !== selected) onSelect(at);
  };
  const latest = useRef(pick);
  latest.current = pick;

  // The chosen day in view, on a screen too narrow for the week.
  const chosenDay = mark?.day ?? 0;
  useEffect(() => {
    const box = scroller.current;
    const bar = bars.current[chosenDay];
    if (!box || !bar || box.scrollWidth <= box.clientWidth) return;
    const b = bar.getBoundingClientRect();
    const o = box.getBoundingClientRect();
    if (b.left < o.left || b.right > o.right)
      box.scrollLeft += b.left - o.left - (o.width - b.width) / 2;
  }, [chosenDay]);

  const s = styles();
  return (
    <div className={s.root()} ref={scroller}>
      <div
        ref={ref}
        className={s.track()}
        role="slider"
        tabIndex={0}
        aria-label="Hour"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, all.length - 1)}
        aria-valuenow={Math.max(0, index)}
        aria-valuetext={column ? timeSpoken(column.time) : undefined}
        data-timeline
        onKeyDown={(event) => {
          const to = stepHour(days, strip, stripDays, selected, event.key);
          if (to === null) return;
          event.preventDefault();
          if (to !== selected) onSelect(to);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const target = event.currentTarget;
          if (event.pointerType === "touch") {
            // A finger scrolls the bar: an hour is chosen on a tap only.
            const x0 = event.clientX;
            const y0 = event.clientY;
            const up = (e: PointerEvent) => {
              target.removeEventListener("pointerup", up);
              target.removeEventListener("pointercancel", cancel);
              if (Math.hypot(e.clientX - x0, e.clientY - y0) < SLOP)
                latest.current(e.clientX);
            };
            const cancel = () => {
              target.removeEventListener("pointerup", up);
              target.removeEventListener("pointercancel", cancel);
            };
            target.addEventListener("pointerup", up);
            target.addEventListener("pointercancel", cancel);
            return;
          }
          event.preventDefault();
          target.focus({ preventScroll: true });
          target.setPointerCapture?.(event.pointerId);
          latest.current(event.clientX);
          const move = (e: PointerEvent) => latest.current(e.clientX);
          const up = () => {
            target.removeEventListener("pointermove", move);
            target.removeEventListener("pointerup", up);
            target.removeEventListener("pointercancel", up);
          };
          target.addEventListener("pointermove", move);
          target.addEventListener("pointerup", up);
          target.addEventListener("pointercancel", up);
        }}
      >
        {days.map((day, d) => {
          const chosen = mark?.day === d;
          return (
            <div
              key={day.date}
              className={s.day()}
              data-timeline-day={day.date}
            >
              <div
                ref={(el) => {
                  bars.current[d] = el;
                }}
                className={s.bar({ chosen })}
              >
                {day.hours.map((h) => (
                  <i
                    key={h.at}
                    className={s.hour()}
                    style={{
                      flexGrow: h.span,
                      background: colourAt(h.at) ?? undefined,
                    }}
                  />
                ))}
                {chosen && mark && column && (
                  <span
                    className={s.mark()}
                    style={{ left: `${mark.fraction * 100}%` }}
                    data-timeline-mark
                  >
                    <b className={s.time()}>{clock(column.time)}</b>
                  </span>
                )}
              </div>
              <div className={s.label({ chosen })} aria-hidden="true">
                {day.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
