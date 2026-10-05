/**
 * The week across one ruled strip, a column a day: its name, its best stars
 * and the hours of its best window. The day being read is set on the second
 * sheet with an ink rule under it; choosing one takes the page down to it.
 */
import { StarGlyphs } from "../../ui";
import { RING, tv } from "../../ui/tv";
import { dayNames, windowHours, type DayWindow } from "./spot";

const styles = tv({
  slots: {
    base: "m-0 grid list-none grid-cols-7 border-0 border-t-2 border-b border-ink p-0",
    item: "min-w-0 border-0 border-l border-line first:border-l-0",
    card: [
      "flex h-full w-full min-w-0 cursor-pointer flex-col items-start gap-1 border-0 bg-transparent px-2 pt-1.5 pb-2 text-left text-ink max-sm:px-1",
      "not-disabled:hover:bg-chart-magenta/5",
      "data-current:border-b-3 data-current:border-ink data-current:bg-sunken",
      RING,
    ],
    name: "flex items-baseline gap-1 font-display text-prose font-semibold",
    date: "font-mono text-eyebrow font-normal text-ink-muted max-sm:hidden",
    hours: "font-mono text-caption font-semibold text-ink tabular-nums",
    none: "font-mono text-caption text-ink-muted",
  },
});

export interface WeekDay {
  date: string;
  window: DayWindow | null;
  stars: number;
  potential: number;
}

export function WeekStrip({
  days,
  current,
  now,
  onSelect,
}: {
  days: readonly WeekDay[];
  current: string;
  now: number;
  onSelect: (date: string) => void;
}) {
  const s = styles();
  return (
    <ul className={s.base()} aria-label="The week">
      {days.map((day) => {
        const names = dayNames(day.date, now);
        const on = day.date === current;
        return (
          <li key={day.date} className={s.item()}>
            <button
              type="button"
              className={s.card()}
              aria-current={on}
              data-current={on ? "" : undefined}
              aria-label={`${names.full}: ${
                day.window
                  ? `${day.window.stars} of 5 stars, ${windowHours(day.window)}`
                  : "no stars"
              }`}
              data-day-card={day.date}
              onClick={() => onSelect(day.date)}
            >
              <span className={s.name()}>
                {names.short}
                <span className={s.date()}>{names.date.split(" ")[0]}</span>
              </span>
              <StarGlyphs
                stars={day.window ? day.window.stars : 0}
                potential={day.window ? day.window.potential : day.potential}
                size={8}
                label=""
              />
              {day.window ? (
                <span className={s.hours()}>{windowHours(day.window)}</span>
              ) : (
                <span className={s.none()}>–</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
