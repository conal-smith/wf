import { Sunrise, Sunset } from "lucide-react";
import { formatLocal, sunTimes } from "../force5/src/sun";
import { dayLabel, timeLabel, type Point } from "../force5/src/weather";
import type { DockColumn } from "../force5/src/timeline";
import type { DayGroup } from "./chart";

/** One stretch of the axis and the run that answers for it. */
export interface ModelBand {
  model: string;
  label: string;
  /** The run behind it was initialised more than eighteen hours ago. */
  older: boolean;
  start: number;
  count: number;
}

interface Props {
  /** The dock's time axis. Every view hangs off these columns. */
  columns: readonly DockColumn[];
  /** Relative column widths, measured once by the dock and shared here. */
  weights: readonly number[];
  point: Point;
  days: readonly DayGroup[];
  /** Which run answers for each stretch of columns; empty hides the band. */
  bands: readonly ModelBand[];
  /** The selected forecast column. */
  selected: number;
  onSelect: (validTime: string) => void;
  /** Sunrise and sunset in the day row; off when there is no room for them. */
  showSun: boolean;
  /** The day's highest air temperature, by date, where a weather run reaches it. */
  dayMax?: Record<string, number>;
}

/**
 * The time header every dock view shares: one day group per Irish calendar day
 * with its sun times, then one cell per forecast column. The table and the
 * charts both hang off these columns, which is what keeps the Now line, the
 * auto-scroll and the chart geometry from drifting apart.
 */
export default function ForecastHeader({
  columns,
  weights,
  point,
  days,
  bands,
  selected,
  onSelect,
  showSun,
  dayMax,
}: Props) {
  // Shared sizing for every model; six-hour intervals retain twice the space.
  const columnWidth = (column: number) =>
    `calc(var(--forecast-column-width) * ${weights[column] ?? 1})`;
  /** This column's own cadence, in hours, from the columns either side of it. */
  const stepHours = (at: number) => {
    const gap = (from: number, to: number) =>
      (Date.parse(columns[to].validTime) -
        Date.parse(columns[from].validTime)) /
      3600000;
    return columns[at + 1]
      ? gap(at, at + 1)
      : columns[at - 1]
        ? gap(at - 1, at)
        : 3;
  };
  // Hourly sources would label every column; three-hourly ticks stay readable.
  // A three-hourly run labels them all, wherever its initialization falls.
  const labelled = (at: number) =>
    stepHours(at) >= 3 ||
    new Date(columns[at].validTime).getUTCHours() % 3 === 0;
  // A day group's label is pinned and would otherwise set the group's width.
  // Capping it at the group's own width keeps the columns even and keeps one
  // day's label out of the next day's, while a label that fits stays as narrow
  // as its text so it slides out of view later. The group cell carries a
  // hairline divider, and separated table borders sit outside the cell's width.
  const spanWidth = (start: number, count: number) =>
    `calc(var(--forecast-column-width) * ${weights
      .slice(start, start + count)
      .reduce((sum, weight) => sum + weight, 0)} - 1px)`;
  const groupWidth = (day: DayGroup) => spanWidth(day.start, day.count);
  // A day group is as wide as its own content, so sun times on a one-column
  // group at the edge of a run would stretch that column. A partial day shows
  // its label only.
  const SUN_MIN_COLUMNS = 4;
  // The day maximum is the third thing in a row that already holds two times, so
  // it only appears on a group wide enough to have spare room for it. A day that
  // cannot fit it skips it: a truncated temperature would be a wrong one.
  const MAX_TEMP_MIN_COLUMNS = 6;
  return (
    <thead>
      <tr className="forecast-day-groups">
        <th scope="col" aria-label="Forecast days" />
        {days.map((day) => {
          const sun = sunTimes(point.lat, point.lon, day.noon);
          const rise = sun.sunrise && formatLocal(sun.sunrise);
          const set = sun.sunset && formatLocal(sun.sunset);
          const high = dayMax?.[day.date];
          return (
            <th key={day.date} scope="colgroup" colSpan={day.count}>
              <span style={{ maxWidth: groupWidth(day) }}>
                <b>{day.label}</b>
                {showSun && day.count >= SUN_MIN_COLUMNS && rise && set && (
                  <span
                    className="day-sun"
                    role="img"
                    aria-label={`Sunrise ${rise}, sunset ${set}, Irish time`}
                  >
                    <Sunrise size={11} aria-hidden="true" />
                    <i aria-hidden="true">{rise}</i>
                    <Sunset size={11} aria-hidden="true" />
                    <i aria-hidden="true">{set}</i>
                  </span>
                )}
                {showSun &&
                  day.count >= MAX_TEMP_MIN_COLUMNS &&
                  high !== undefined && (
                    <span
                      className="day-max"
                      role="img"
                      aria-label={`Highest air temperature ${Math.round(high)} degrees Celsius`}
                    >
                      <i aria-hidden="true">{Math.round(high)}°</i>
                    </span>
                  )}
              </span>
            </th>
          );
        })}
      </tr>
      {/* Which run each stretch of the axis comes from. The dock's columns
          outlive any one model, and the seam between two of them can show a
          jump: the band makes it visible rather than hiding it. */}
      {bands.length > 0 && (
        <tr className="forecast-model-band">
          <th scope="col" aria-label="Forecast model" />
          {bands.map((band) => (
            <th
              key={`${band.model}-${band.start}`}
              scope="colgroup"
              colSpan={band.count}
              data-band-model={band.model}
            >
              <span style={{ maxWidth: spanWidth(band.start, band.count) }}>
                {band.label}
                {band.older && <i> · older run</i>}
              </span>
            </th>
          ))}
        </tr>
      )}
      <tr className="forecast-hours">
        <th scope="col">Hours</th>
        {columns.map((column, at) => (
          <th
            key={column.validTime}
            scope="col"
            className={selected === at ? "selected-hour" : ""}
            style={{ minWidth: columnWidth(at) }}
          >
            <button
              data-forecast-index={at}
              aria-label={`Show forecast ${dayLabel(column.validTime)} ${timeLabel(column.validTime)}`}
              aria-pressed={selected === at}
              onClick={() => onSelect(column.validTime)}
            >
              {labelled(at) ? timeLabel(column.validTime) : ""}
            </button>
          </th>
        ))}
      </tr>
    </thead>
  );
}
