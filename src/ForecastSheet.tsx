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
  type Manifest,
  type Units,
  type Wind,
} from "../force5/src/weather";

interface Props {
  manifest: Manifest;
  units: Units;
  /** The selected forecast column. */
  index: number;
  values: (Wind | null | undefined)[];
}

/**
 * The table view's rows: wind, gust and direction, one cell per forecast
 * column. The scroller, the time header and the Now line belong to
 * `ForecastDock`, which every view shares.
 */
export default function ForecastSheet({
  manifest,
  units,
  index,
  values,
}: Props) {
  const reading = (w: Wind | null | undefined, gust = false) =>
    w && (!gust || w.gust !== null)
      ? Math.round(convert(gust ? w.gust! : speed(w), units))
      : "—";
  // An instantaneous gust is a point value: it exists at initialization too,
  // so hour zero shows a reading instead of the interval source's em dash.
  const instantaneous = manifest.gustKind === "instantaneous";
  const runTime = Date.parse(manifest.runTime);
  const windowLabel = (hours: [number, number]) => {
    const at = (hour: number) =>
      new Date(runTime + hour * 3600000).toISOString();
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
        {manifest.frames.map((f, i) => (
          <td
            key={f.hour}
            className={`wind-cell ${index === i ? "selected-hour" : ""}`}
            style={
              {
                "--wind-colour": values[i]
                  ? `rgba(${windColor(convert(speed(values[i]!), "kn")).join(",")}, 0.65)`
                  : "transparent",
              } as React.CSSProperties
            }
          >
            {reading(values[i])}
          </td>
        ))}
      </tr>
      <tr>
        <th
          scope="row"
          aria-label={`Wind gusts (${units})`}
          title={
            manifest.gustAvailable === false
              ? `Wind gusts (${units}) — unavailable for this ${manifest.modelName} integration`
              : instantaneous
                ? `Instantaneous gust (${units})`
                : `Wind gusts (${units})`
          }
        >
          <WindArrowDown size={18} aria-hidden="true" />
          <small>{units}</small>
        </th>
        {manifest.frames.map((f, i) => {
          const hidden = f.hour === 0 && !instantaneous;
          return (
            <td
              key={f.hour}
              className={`gust-cell ${index === i ? "selected-hour" : ""}`}
              title={
                hidden
                  ? "No preceding forecast gust period at initialization"
                  : instantaneous
                    ? `Instantaneous gust at ${dayLabel(f.validTime)} ${timeLabel(f.validTime)} (Irish time)`
                    : f.gustIntervalHours
                      ? windowLabel(f.gustIntervalHours)
                      : `Gusts unavailable for ${manifest.modelName}`
              }
              style={
                {
                  "--wind-colour":
                    !hidden && values[i]?.gust != null
                      ? `rgba(${windColor(convert(values[i]!.gust!, "kn")).join(",")}, 0.65)`
                      : "transparent",
                } as React.CSSProperties
              }
            >
              {hidden ? "—" : reading(values[i], true)}
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
        {manifest.frames.map((f, i) => {
          const w = values[i];
          const d = w ? direction(w.u, w.v) : 0;
          return (
            <td key={f.hour} className={index === i ? "selected-hour" : ""}>
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
