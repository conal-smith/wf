/**
 * The week at a glance: one card per Irish day with its best stars, the wind
 * range, where it comes from, and the best window with its wing. Choosing a day
 * takes the page to its hours.
 */
import { StarGlyphs } from "../../src/StarsRows";
import { starsText } from "../../force5/src/stars";
import type { Units } from "../../force5/src/units";
import { RING, tv } from "../../ui/tv";
import { FromArrow, WindBar } from "./parts";
import { clock, compass, dayNames, windIn, type SpotDay } from "./spot";

const styles = tv({
  slots: {
    list: "m-0 flex list-none gap-2 overflow-x-auto p-0 pb-2 scrollbar-none snap-x",
    item: "flex shrink-0 snap-start",
    card: [
      "flex w-38 flex-col items-start justify-start gap-2 rounded-surface border border-line bg-card p-3 text-left font-body text-ink shadow-control",
      "cursor-pointer transition-colors duration-fast not-disabled:hover:border-line-strong not-disabled:hover:bg-card motion-reduce:transition-none",
      // The chosen day: a second, inner line in ink, not a colour alone.
      "data-current:border-inverse data-current:inset-ring-1 data-current:inset-ring-inverse",
      RING,
    ],
    day: "flex w-full items-baseline justify-between gap-1",
    weekday: "text-prose font-semibold",
    date: "text-caption text-ink-muted",
    stars: "flex min-h-4 items-center text-ink",
    none: "text-caption text-ink-muted",
    wind: "flex w-full flex-col gap-1",
    windText: "flex items-baseline gap-1 text-body text-ink tabular-nums",
    windUnit: "text-caption text-ink-muted",
    dir: "flex items-center gap-1 text-caption text-ink-2",
    best: "text-caption text-ink-muted tabular-nums",
  },
});

export function DayStrip({
  days,
  selected,
  now,
  units,
  unitText,
  onSelect,
}: {
  days: readonly SpotDay[];
  selected: string | null;
  now: number;
  units: Units;
  unitText: string;
  onSelect: (date: string) => void;
}) {
  const s = styles();
  return (
    <ul className={s.list()} aria-label="Days">
      {days.map((day) => {
        const names = dayNames(day.date, now);
        const rated = day.potential > 0;
        return (
          <li key={day.date} className={s.item()}>
            <button
              type="button"
              className={s.card()}
              data-day-card={day.date}
              aria-current={selected === day.date ? "true" : undefined}
              data-current={selected === day.date ? "" : undefined}
              aria-label={`${names.relative} ${names.date}: ${
                rated
                  ? starsText({ stars: day.stars, potential: day.potential })
                  : "no stars"
              }${
                day.windMin !== null
                  ? `, ${windIn(day.windMin, units)} to ${windIn(day.windMax!, units)} ${unitText}`
                  : ""
              }${day.direction !== null ? ` from ${compass(day.direction)}` : ""}${
                day.best
                  ? `, best ${clock(day.best.from)} to ${clock(day.best.to)} on a ${day.best.wing} square metre wing`
                  : ""
              }. Show its hours.`}
              onClick={() => onSelect(day.date)}
            >
              <span className={s.day()} aria-hidden="true">
                <span className={s.weekday()}>
                  {names.relative === "Today" || names.relative === "Tomorrow"
                    ? names.relative
                    : names.short}
                </span>
                <span className={s.date()}>{names.date}</span>
              </span>
              <span className={s.stars()} aria-hidden="true">
                {rated ? (
                  <StarGlyphs
                    stars={day.stars}
                    potential={day.potential}
                    size={14}
                  />
                ) : (
                  <span className={s.none()}>
                    {day.hasWind ? "No stars" : "No forecast"}
                  </span>
                )}
              </span>
              {day.windMin !== null && (
                <span className={s.wind()} aria-hidden="true">
                  <span className={s.windText()}>
                    {windIn(day.windMin, units)}–{windIn(day.windMax!, units)}
                    <span className={s.windUnit()}>
                      {unitText}
                      {day.gustMax !== null &&
                        ` · g${windIn(day.gustMax, units)}`}
                    </span>
                  </span>
                  <WindBar knots={day.windMax!} gust={day.gustMax} />
                </span>
              )}
              {day.direction !== null && (
                <span className={s.dir()} aria-hidden="true">
                  <FromArrow from={day.direction} size={12} />
                  {compass(day.direction)}
                </span>
              )}
              <span className={s.best()} aria-hidden="true">
                {day.best
                  ? `${clock(day.best.from)}–${clock(day.best.to)} · ${day.best.wing} m²`
                  : " "}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
