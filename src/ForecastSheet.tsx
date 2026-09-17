import {
  ArrowDown,
  Navigation,
  Wind as WindIcon,
  WindArrowDown,
} from "lucide-react";
import {
  compass,
  convert,
  dayLabel,
  direction,
  speed,
  timeLabel,
  windColor,
  type Units,
} from "../force5/src/weather";
import type { ColumnCell } from "./ForecastDock";

interface Props {
  /** One cell per dock column: its value and the run it was read from. */
  cells: readonly ColumnCell[];
  units: Units;
  /** The selected forecast column. */
  selected: number;
}

/** Where this cell's value came from, when that is not simply "a published step". */
const provenance = (cell: ColumnCell): string | null =>
  cell.interpolated
    ? `Between ${cell.manifest.modelName}'s ${cell.stepHours}-hourly steps.`
    : null;

/**
 * The table view's rows: wind, gust and direction, one cell per forecast
 * column. The scroller, the time header and the Now line belong to
 * `ForecastDock`, which every view shares.
 *
 * A column is read from the run that answers for it, so every tooltip here asks
 * that run — not the map's — what its gust means, and a value that sits between
 * two of its published steps says so rather than passing for a forecast the
 * model published.
 */
export default function ForecastSheet({ cells, units, selected }: Props) {
  const reading = (cell: ColumnCell, gust = false) =>
    cell.wind && (!gust || cell.wind.gust !== null)
      ? Math.round(convert(gust ? cell.wind.gust! : speed(cell.wind), units))
      : "—";
  const windowLabel = (runTime: string, hours: [number, number]) => {
    const at = (hour: number) =>
      new Date(Date.parse(runTime) + hour * 3600000).toISOString();
    const span = hours[1] - hours[0];
    return `Maximum gust over ${span} hour${span === 1 ? "" : "s"}: ${dayLabel(
      at(hours[0]),
    )} ${timeLabel(at(hours[0]))} to ${dayLabel(at(hours[1]))} ${timeLabel(
      at(hours[1]),
    )} (Irish time)`;
  };
  /** What the gust in this cell is, in that run's own terms. */
  const gustTitle = (cell: ColumnCell, hidden: boolean) => {
    if (hidden) return "No preceding forecast gust period at initialization";
    const between = provenance(cell);
    // Nothing covers this column at all; there is no gust to explain.
    if (cell.wind === null) return undefined;
    if (cell.wind.gust === null)
      return cell.manifest.gustAvailable === false
        ? `Gusts unavailable for this ${cell.manifest.modelName} run`
        : `${cell.manifest.modelName} publishes no gust for this hour`;
    if (between) return `${between} Gust interpolated with the wind.`;
    if (cell.manifest.gustKind === "instantaneous")
      return `Instantaneous gust at ${dayLabel(cell.validTime)} ${timeLabel(
        cell.validTime,
      )} (Irish time)`;
    return cell.frame?.gustIntervalHours
      ? windowLabel(cell.manifest.runTime, cell.frame.gustIntervalHours)
      : `Maximum gust published by ${cell.manifest.modelName} for this hour`;
  };
  /** The shared attributes every cell in a column carries. */
  const cellProps = (cell: ColumnCell, column: number, extra = "") => ({
    key: cell.validTime,
    className:
      [extra, selected === column ? "selected-hour" : ""]
        .filter(Boolean)
        .join(" ") || undefined,
    "data-interpolated": cell.interpolated ? "" : undefined,
  });
  return (
    <tbody>
      <tr>
        <th
          scope="row"
          aria-label={`Wind speed (${units})`}
          title={`Wind speed (${units})`}
        >
          <WindIcon size={18} aria-hidden="true" /> <small>{units}</small>
        </th>
        {cells.map((cell, column) => (
          <td
            {...cellProps(cell, column, "wind-cell")}
            title={provenance(cell) ?? undefined}
            style={
              {
                "--wind-colour": cell.wind
                  ? `rgba(${windColor(convert(speed(cell.wind), "kn")).join(",")}, 0.65)`
                  : "transparent",
              } as React.CSSProperties
            }
          >
            {reading(cell)}
          </td>
        ))}
      </tr>
      <tr>
        <th
          scope="row"
          aria-label={`Wind gusts (${units})`}
          title={`Wind gusts (${units})`}
        >
          <WindArrowDown size={18} aria-hidden="true" />
          <small>{units}</small>
        </th>
        {cells.map((cell, column) => {
          // An instantaneous gust is a point value: it exists at initialization
          // too, so hour zero shows a reading where an interval source has none.
          // Only a cell that really is that run's hour zero is hidden — an
          // interpolated one belongs to no run hour at all.
          const hidden =
            cell.frame?.hour === 0 &&
            cell.manifest.gustKind !== "instantaneous";
          return (
            <td
              {...cellProps(cell, column, "gust-cell")}
              title={gustTitle(cell, hidden)}
              style={
                {
                  "--wind-colour":
                    !hidden && cell.wind?.gust != null
                      ? `rgba(${windColor(convert(cell.wind.gust, "kn")).join(",")}, 0.65)`
                      : "transparent",
                } as React.CSSProperties
              }
            >
              {hidden ? "—" : reading(cell, true)}
            </td>
          );
        })}
      </tr>
      <tr>
        <th
          scope="row"
          aria-label="Wind direction (from)"
          title="Wind direction — where the wind comes from"
        >
          <Navigation size={18} aria-hidden="true" />
        </th>
        {cells.map((cell, column) => {
          const w = cell.wind;
          const d = w ? direction(w.u, w.v) : 0;
          return (
            <td
              {...cellProps(cell, column)}
              title={provenance(cell) ?? undefined}
            >
              {w && speed(w) > 0.1 ? (
                <span className="direction-cell">
                  <ArrowDown
                    size={16}
                    style={{ transform: `rotate(${d}deg)` }}
                    aria-hidden="true"
                  />
                  {compass(d)}
                </span>
              ) : w ? (
                "Calm"
              ) : (
                "—"
              )}
            </td>
          );
        })}
      </tr>
    </tbody>
  );
}
