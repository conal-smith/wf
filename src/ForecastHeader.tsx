import { Sunrise, Sunset } from "lucide-react";
import { formatLocal, sunTimes } from "../force5/src/sun";
import {
  dayLabel,
  timeLabel,
  type Manifest,
  type Point,
} from "../force5/src/weather";
import { columnWeights, type DayGroup } from "./chart";

interface Props {
  manifest: Manifest;
  point: Point;
  days: readonly DayGroup[];
  /** The selected forecast column. */
  index: number;
  onSelect: (index: number) => void;
  /** Sunrise and sunset in the day row; off when there is no room for them. */
  showSun: boolean;
}

/**
 * The time header every dock view shares: one day group per Irish calendar day
 * with its sun times, then one cell per forecast column. The table and the
 * charts both hang off these columns, which is what keeps the Now line, the
 * auto-scroll and the chart geometry from drifting apart.
 */
export default function ForecastHeader({
  manifest,
  point,
  days,
  index,
  onSelect,
  showSun,
}: Props) {
  const columnWidth = (column: number) => {
    const frames = manifest.frames;
    const interval = frames[column + 1]
      ? frames[column + 1].hour - frames[column].hour
      : frames[column].hour -
        (frames[column - 1]?.hour ?? frames[column].hour - manifest.stepHours);
    // Shared sizing for every model; six-hour intervals retain twice the space.
    return `calc(var(--forecast-column-width) * ${Math.max(1, interval / 3)})`;
  };
  // Hourly sources would label every column; three-hourly ticks stay readable.
  const labelled = (hour: number) => manifest.stepHours >= 3 || hour % 3 === 0;
  // A day group's label is pinned and would otherwise set the group's width.
  // Capping it at the group's own width keeps the columns even and keeps one
  // day's label out of the next day's, while a label that fits stays as narrow
  // as its text so it slides out of view later. The group cell carries a
  // hairline divider, and separated table borders sit outside the cell's width.
  const weights = columnWeights(manifest.frames, manifest.stepHours);
  const groupWidth = (day: DayGroup) =>
    `calc(var(--forecast-column-width) * ${weights
      .slice(day.start, day.start + day.count)
      .reduce((sum, weight) => sum + weight, 0)} - 1px)`;
  // A day group is as wide as its own content, so sun times on a one-column
  // group at the edge of a run would stretch that column. A partial day shows
  // its label only.
  const SUN_MIN_COLUMNS = 4;
  return (
    <thead>
      <tr className="forecast-day-groups">
        <th scope="col" aria-label="Forecast days" />
        {days.map((day) => {
          const sun = sunTimes(point.lat, point.lon, day.noon);
          const rise = sun.sunrise && formatLocal(sun.sunrise);
          const set = sun.sunset && formatLocal(sun.sunset);
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
              </span>
            </th>
          );
        })}
      </tr>
      <tr>
        <th scope="col">Hours</th>
        {manifest.frames.map((frame, column) => (
          <th
            key={frame.hour}
            scope="col"
            className={index === column ? "selected-hour" : ""}
            style={{ minWidth: columnWidth(column) }}
          >
            <button
              data-forecast-index={column}
              aria-label={`Show forecast ${dayLabel(frame.validTime)} ${timeLabel(frame.validTime)}`}
              aria-pressed={index === column}
              onClick={() => onSelect(column)}
            >
              {labelled(frame.hour) ? timeLabel(frame.validTime) : ""}
            </button>
          </th>
        ))}
      </tr>
    </thead>
  );
}
