import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDown,
  Navigation,
  Wind as WindIcon,
  WindArrowDown,
} from "lucide-react";
import { framePosition } from "../force5/src/timeline";
import {
  compass,
  convert,
  dayLabel,
  direction,
  loadFrame,
  nearestFrame,
  sample,
  speed,
  timeLabel,
  windColor,
  type Manifest,
  type Point,
  type Units,
  type Wind,
} from "../force5/src/weather";

export interface ForecastSeries {
  key: string;
  values: (Wind | null | undefined)[];
}
const EMPTY_VALUES: (Wind | null | undefined)[] = [];

// Interpolate between actual timestamp centres, including mixed 3/6-hour columns.
function timeX(
  content: HTMLElement,
  manifest: Manifest,
  time: number,
): number | null {
  const position = framePosition(manifest.frames, time);
  if (position === null) return null;
  const centre = (index: number) => {
    const cell = content
      .querySelector(`[data-forecast-index="${index}"]`)
      ?.closest("th");
    if (!cell) return null;
    const rect = cell.getBoundingClientRect();
    return rect.left + rect.width / 2 - content.getBoundingClientRect().left;
  };
  const left = centre(Math.floor(position)),
    right = centre(Math.ceil(position));
  return left === null || right === null
    ? null
    : left + (right - left) * (position % 1);
}

interface Props {
  manifest: Manifest;
  point: Point;
  units: Units;
  index: number;
  onSelect: (index: number) => void;
  scrollIndex: number;
  onSeriesChange: (series: ForecastSeries) => void;
}

export default function ForecastSheet({
  manifest,
  point,
  units,
  index,
  onSelect,
  scrollIndex,
  onSeriesChange,
}: Props) {
  const [samples, setSamples] = useState<{
    key: string;
    values: (Wind | null)[];
    failures: number;
    pending: boolean;
  }>({ key: "", values: [], failures: 0, pending: false });
  const [retry, setRetry] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const initialScroll = useRef(true);
  const [now, setNow] = useState(Date.now);
  const [nowX, setNowX] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 30000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, []);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const update = () => setNowX(timeX(element, manifest, now));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [manifest, now]);
  const key = `${manifest.model}/${manifest.run}/${point.lon}/${point.lat}`;
  const named = point.id ? manifest.spotForecasts[point.id] : undefined;
  const values = named || (samples.key === key ? samples.values : EMPTY_VALUES);
  useEffect(() => {
    onSeriesChange({ key, values });
  }, [key, values, onSeriesChange]);
  const days = manifest.frames.reduce<{ label: string; count: number }[]>(
    (groups, frame) => {
      const label = dayLabel(frame.validTime);
      if (groups.at(-1)?.label === label) groups[groups.length - 1].count++;
      else groups.push({ label, count: 1 });
      return groups;
    },
    [],
  );

  useEffect(() => {
    if (named) return;
    let cancelled = false;
    let next = 0;
    const result: (Wind | null)[] = manifest.frames.map(() => null);
    let failures = 0;
    setSamples({ key, values: result, failures: 0, pending: true });
    const worker = async () => {
      while (!cancelled && next < manifest.frames.length) {
        const i = next++;
        try {
          result[i] = sample(
            await loadFrame(manifest, i),
            point.lon,
            point.lat,
          );
        } catch {
          failures++;
        }
        if (!cancelled)
          setSamples({ key, values: [...result], failures, pending: true });
      }
    };
    // Bound downloads, stop queueing on selection changes, and never reuse old point readings.
    void Promise.all([worker(), worker()]).then(() => {
      if (!cancelled)
        setSamples({ key, values: [...result], failures, pending: false });
    });
    return () => {
      cancelled = true;
    };
  }, [manifest, named, key, point.lon, point.lat, retry]);

  useLayoutEffect(() => {
    const container = scroll.current;
    if (!container) return;
    const centreNow =
      initialScroll.current && scrollIndex === nearestFrame(manifest.frames);
    initialScroll.current = false;
    const followTime = () => {
      const cell = container
        .querySelector<HTMLElement>(`[data-forecast-index="${scrollIndex}"]`)
        ?.closest("th");
      const labels = container.querySelector("thead th");
      if (!cell || !labels) return;
      // offsetLeft on the button is relative to its table cell, often zero.
      // Compare viewport rectangles instead, allowing for sticky row labels.
      const viewport = container.getBoundingClientRect();
      const target = cell.getBoundingClientRect();
      const labelWidth = labels.getBoundingClientRect().width;
      const available = container.clientWidth - labelWidth;
      const currentX =
        centreNow && content.current
          ? timeX(content.current, manifest, Date.now())
          : null;
      const targetCentre =
        currentX !== null && content.current
          ? content.current.getBoundingClientRect().left + currentX
          : target.left + target.width / 2;
      const left =
        container.scrollLeft +
        targetCentre -
        viewport.left -
        labelWidth -
        available / 2;
      container.scrollLeft = Math.max(
        0,
        Math.min(left, container.scrollWidth - container.clientWidth),
      );
    };
    followTime();
    const observer = new ResizeObserver(followTime);
    observer.observe(container);
    const table = container.querySelector("table");
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [scrollIndex, key]);

  const reading = (w: Wind | null | undefined, gust = false) =>
    w && (!gust || w.gust !== null)
      ? Math.round(convert(gust ? w.gust! : speed(w), units))
      : "—";
  const columnWidth = (index: number) => {
    const frames = manifest.frames;
    const interval = frames[index + 1]
      ? frames[index + 1].hour - frames[index].hour
      : frames[index].hour -
        (frames[index - 1]?.hour ?? frames[index].hour - manifest.stepHours);
    // Shared sizing for every model; six-hour intervals retain twice the space.
    return `calc(var(--forecast-column-width) * ${Math.max(1, interval / 3)})`;
  };
  return (
    <section className="forecast-sheet glass" aria-label="Spot forecast">
      <div
        ref={scroll}
        className="forecast-scroll"
        tabIndex={0}
        aria-label="Hourly wind forecast; scroll horizontally for more times"
      >
        <div className="forecast-content" ref={content}>
          <table className="forecast-table">
            <caption className="sr-only">
              {point.name}: {manifest.stepRanges ? "3/6" : manifest.stepHours}
              -hour wind forecast, in {units}. Times are local to Ireland.
              {manifest.gustAvailable === false &&
                ` Gust speed unavailable for this ${manifest.modelName} integration.`}
            </caption>
            <thead>
              <tr className="forecast-day-groups">
                <th scope="col" aria-label="Forecast days" />
                {days.map((day) => (
                  <th key={day.label} scope="colgroup" colSpan={day.count}>
                    <span>{day.label}</span>
                  </th>
                ))}
              </tr>
              <tr>
                <th scope="col">Hours</th>
                {manifest.frames.map((f, i) => (
                  <th
                    key={f.hour}
                    scope="col"
                    className={index === i ? "selected-hour" : ""}
                    style={{ minWidth: columnWidth(i) }}
                  >
                    <button
                      data-forecast-index={i}
                      aria-label={`Show forecast ${dayLabel(f.validTime)} ${timeLabel(f.validTime)}`}
                      aria-pressed={index === i}
                      onClick={() => onSelect(i)}
                    >
                      {timeLabel(f.validTime)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th
                  scope="row"
                  aria-label={`Wind speed (${units})`}
                  title={`Wind speed (${units})`}
                >
                  <WindIcon size={18} aria-hidden="true" />{" "}
                  <small>{units}</small>
                </th>
                {manifest.frames.map((f, i) => (
                  <td
                    key={f.hour}
                    className={`wind-cell ${index === i ? "selected-hour" : ""}`}
                    style={
                      {
                        "--wind-colour": values[i]
                          ? `rgba(${windColor(speed(values[i]!) * 1.94384449).join(",")}, 0.42)`
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
                      : `Wind gusts (${units})`
                  }
                >
                  <WindArrowDown size={18} aria-hidden="true" />
                  <small>{units}</small>
                </th>
                {manifest.frames.map((f, i) => (
                  <td
                    key={f.hour}
                    className={`gust-cell ${index === i ? "selected-hour" : ""}`}
                    title={
                      f.hour === 0
                        ? "No preceding forecast gust period at initialization"
                        : f.gustIntervalHours
                          ? `Maximum gust over ${f.gustIntervalHours[1] - f.gustIntervalHours[0]} hour${f.gustIntervalHours[1] - f.gustIntervalHours[0] === 1 ? "" : "s"}: ${dayLabel(new Date(Date.parse(manifest.runTime) + f.gustIntervalHours[0] * 3600000).toISOString())} ${timeLabel(new Date(Date.parse(manifest.runTime) + f.gustIntervalHours[0] * 3600000).toISOString())} to ${dayLabel(f.validTime)} ${timeLabel(f.validTime)} (Irish time)`
                          : `Gusts unavailable for ${manifest.modelName}`
                    }
                    style={
                      {
                        "--wind-colour":
                          f.hour !== 0 && values[i]?.gust != null
                            ? `rgba(${windColor(values[i]!.gust! * 1.94384449).join(",")}, 0.42)`
                            : "transparent",
                      } as React.CSSProperties
                    }
                  >
                    {f.hour === 0 ? "—" : reading(values[i], true)}
                  </td>
                ))}
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
                    <td
                      key={f.hour}
                      className={index === i ? "selected-hour" : ""}
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
          </table>
          {nowX !== null && (
            <div
              className="forecast-now"
              style={{ left: nowX }}
              role="img"
              aria-label={`Now: ${dayLabel(new Date(now).toISOString())} ${timeLabel(new Date(now).toISOString())}, Irish time`}
              data-time={new Date(now).toISOString()}
            >
              <span>Now</span>
            </div>
          )}
        </div>
      </div>
      {!named &&
        samples.key === key &&
        (samples.pending || samples.failures > 0) && (
          <div className="sheet-loading" role="status">
            {samples.pending
              ? "Loading forecast hours…"
              : "Some hours could not be loaded."}
            {!samples.pending && (
              <button onClick={() => setRetry((v) => v + 1)}>
                Retry missing hours
              </button>
            )}
          </div>
        )}
    </section>
  );
}
