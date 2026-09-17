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
  type Wind,
} from "../force5/src/weather";
import type { ColumnCell } from "./ForecastDock";

interface Props {
  /** One cell per dock column: its value and the run it was read from. */
  cells: readonly ColumnCell[];
  units: Units;
  /** The selected forecast column. */
  selected: number;
}

/**
 * The table view's rows: wind, gust and direction, one cell per forecast
 * column. The scroller, the time header and the Now line belong to
 * `ForecastDock`, which every view shares.
 *
 * A column past the map model's range is read from the run that owns it, so
 * every tooltip here asks that run — not the map's — what its gust means.
 */
export default function ForecastSheet({ cells, units, selected }: Props) {
  const reading = (w: Wind | null | undefined, gust = false) =>
    w && (!gust || w.gust !== null)
      ? Math.round(convert(gust ? w.gust! : speed(w), units))
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
        {cells.map((cell, i) => (
          <td
            key={cell.validTime}
            className={`wind-cell ${selected === i ? "selected-hour" : ""}`}
            style={
              {
                "--wind-colour": cell.wind
                  ? `rgba(${windColor(convert(speed(cell.wind), "kn")).join(",")}, 0.65)`
                  : "transparent",
              } as React.CSSProperties
            }
          >
            {reading(cell.wind)}
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
        {cells.map((cell, i) => {
          // An instantaneous gust is a point value: it exists at initialization
          // too, so hour zero shows a reading where an interval source has none.
          const instantaneous = cell.manifest.gustKind === "instantaneous";
          const hidden = cell.frame?.hour === 0 && !instantaneous;
          return (
            <td
              key={cell.validTime}
              className={`gust-cell ${selected === i ? "selected-hour" : ""}`}
              title={
                hidden
                  ? "No preceding forecast gust period at initialization"
                  : instantaneous
                    ? `Instantaneous gust at ${dayLabel(cell.validTime)} ${timeLabel(cell.validTime)} (Irish time)`
                    : cell.frame?.gustIntervalHours
                      ? windowLabel(
                          cell.manifest.runTime,
                          cell.frame.gustIntervalHours,
                        )
                      : `Gusts unavailable for this ${cell.manifest.modelName} run`
              }
              style={
                {
                  "--wind-colour":
                    !hidden && cell.wind?.gust != null
                      ? `rgba(${windColor(convert(cell.wind.gust, "kn")).join(",")}, 0.65)`
                      : "transparent",
                } as React.CSSProperties
              }
            >
              {hidden ? "—" : reading(cell.wind, true)}
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
        {cells.map((cell, i) => {
          const w = cell.wind;
          const d = w ? direction(w.u, w.v) : 0;
          return (
            <td
              key={cell.validTime}
              className={selected === i ? "selected-hour" : ""}
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
