/**
 * The day the spot finder shows, and the way to the others: ‹ Today ›, a
 * day a press, from today to the fifth day after it (finder.ts
 * `cardDates`). Each end's arrow is off where there is no day past it. The
 * day is said plainly: Today, Tomorrow, then the weekday ("Thursday"), its
 * date beside it in grey. The arrow keys step it too while either button
 * holds the focus, and the focus stays in the control when an end turns its
 * button off.
 *
 * Every card's bars, the list's order and the chart's lights beside it
 * follow the day stepped to (src/finder/SpotFinder.tsx).
 */
import { useRef, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../../ui/Button";
import { tv } from "../../ui/tv";
import { dayLong, dayShort, irishDate, irishTomorrow } from "../strip";

const styles = tv({
  slots: {
    // Under the list's head, its width: an arrow at either end, the day
    // between them.
    base: "flex items-center gap-2 px-0.5 pb-3",
    day: "m-0 flex min-w-0 flex-1 items-baseline justify-center gap-2 truncate text-center font-body",
    name: "text-prose font-semibold text-ink",
    date: "text-body text-ink-muted",
  },
});

const dayMonth = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Dublin",
  day: "numeric",
  month: "short",
});

/** A day of the finder's in words: its name ("Today", "Tomorrow", "Thursday") and its date. */
export function dayWords(
  date: string,
  now: number,
): { name: string; date: string } {
  const noon = Date.parse(`${date}T12:00:00Z`);
  const name =
    date === irishDate(now)
      ? "Today"
      : date === irishTomorrow(now)
        ? "Tomorrow"
        : dayLong(noon);
  const day = dayMonth.format(new Date(noon));
  return {
    name,
    // The weekday is the name after tomorrow; before it, it goes with the date.
    date: name === dayLong(noon) ? day : `${dayShort(noon)} ${day}`,
  };
}

export function DaySteps({
  dates,
  day,
  now,
  onDay,
}: {
  /** The days to step through, today first. */
  dates: readonly string[];
  /** The day shown. */
  day: string;
  now: number;
  onDay: (date: string) => void;
}) {
  const s = styles();
  const at = Math.max(0, dates.indexOf(day));
  const back = useRef<HTMLButtonElement>(null);
  const on = useRef<HTMLButtonElement>(null);
  const step = (by: -1 | 1) => {
    const next = at + by;
    if (next < 0 || next >= dates.length) return;
    onDay(dates[next]);
    // An arrow turned off at an end would drop the focus to the page.
    if (next === 0) on.current?.focus();
    if (next === dates.length - 1) back.current?.focus();
  };
  const keys = (event: KeyboardEvent) => {
    const by =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!by) return;
    event.preventDefault();
    event.stopPropagation();
    step(by);
  };
  const words = dayWords(day, now);
  return (
    <div
      className={s.base()}
      role="group"
      aria-label="Day"
      onKeyDown={keys}
      data-finder-days
    >
      <Button
        ref={back}
        icon
        size="sm"
        aria-label="Previous day"
        disabled={at <= 0}
        onClick={() => step(-1)}
        data-day-step="back"
      >
        <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      </Button>
      <p className={s.day()} aria-live="polite" data-finder-day={day}>
        <span className={s.name()}>{words.name}</span>
        <span className={s.date()}>{words.date}</span>
      </p>
      <Button
        ref={on}
        icon
        size="sm"
        aria-label="Next day"
        disabled={at >= dates.length - 1}
        onClick={() => step(1)}
        data-day-step="on"
      >
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
      </Button>
    </div>
  );
}
