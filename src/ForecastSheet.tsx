import { useEffect, useRef, useState } from "react";
import { ArrowDown, MapPin, Wind as WindIcon, X } from "lucide-react";
import {
  compass,
  convert,
  dayLabel,
  direction,
  loadFrame,
  sample,
  speed,
  timeLabel,
  type Frame,
  type Manifest,
  type Point,
  type Units,
  type Wind,
} from "../force5/src/weather";

interface Props {
  manifest: Manifest;
  frame: Frame | null;
  point: Point;
  units: Units;
  index: number;
  onSelect: (index: number) => void;
  onClose: () => void;
}

export default function ForecastSheet({
  manifest,
  frame,
  point,
  units,
  index,
  onSelect,
  onClose,
}: Props) {
  const [samples, setSamples] = useState<{
    key: string;
    values: (Wind | null)[];
    failures: number;
    pending: boolean;
  }>({ key: "", values: [], failures: 0, pending: false });
  const [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const key = `${manifest.model}/${manifest.run}/${point.lon}/${point.lat}`;
  const named = point.id ? manifest.spotForecasts[point.id] : undefined;
  const wind = frame ? sample(frame, point.lon, point.lat) : null;
  const degrees = wind ? direction(wind.u, wind.v) : 0;
  const values = named || (samples.key === key ? samples.values : []);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
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

  useEffect(() => {
    const container = scroll.current;
    const active = container?.querySelector<HTMLElement>(
      '[aria-pressed="true"]',
    );
    if (!container || !active) return;
    const left = active.offsetLeft;
    if (
      left < container.scrollLeft + 120 ||
      left + active.offsetWidth > container.scrollLeft + container.clientWidth
    )
      container.scrollLeft = Math.max(0, left - 120);
  }, [index, key]);

  const reading = (w: Wind | null | undefined, gust = false) =>
    w ? Math.round(convert(gust ? w.gust : speed(w), units)) : "—";
  return (
    <section className="forecast-sheet glass" aria-label="Spot forecast">
      <div className="sheet-heading">
        <div className="sheet-place">
          <span className="eyebrow">
            <MapPin size={12} />{" "}
            {point.county
              ? `CO. ${point.county.toUpperCase()}`
              : "MAP LOCATION"}
          </span>
          <h2 ref={heading} tabIndex={-1}>
            {point.name}
          </h2>
          <span className="sheet-coordinates">
            {point.lat.toFixed(3)}° N · {Math.abs(point.lon).toFixed(3)}° W · 10
            m wind
          </span>
        </div>
        <div className="sheet-current" aria-label="Selected spot conditions">
          <div className="wind-number">
            {reading(wind)}
            <span>{units === "kn" ? "knots" : "m/s"}</span>
          </div>
          <div className="sheet-current-meta">
            <span>
              <WindIcon size={14} /> Gusts{" "}
              <strong>
                {frame?.hour === 0 ? "—" : reading(wind, true)} {units}
              </strong>
            </span>
            <span>
              {wind && speed(wind) > 0.1 ? (
                <>
                  <ArrowDown
                    size={14}
                    style={{ transform: `rotate(${degrees}deg)` }}
                  />{" "}
                  From {compass(degrees)} · {Math.round(degrees)}°
                </>
              ) : wind ? (
                "Calm"
              ) : (
                "Outside forecast coverage"
              )}
            </span>
          </div>
        </div>
        <div className="sheet-source">
          <span>{manifest.modelName}</span>
          <small>{manifest.resolutionKm} km · Irish time</small>
        </div>
        <button
          className="sheet-close"
          onClick={onClose}
          aria-label="Close forecast panel"
        >
          <X size={20} />
        </button>
      </div>
      <div
        ref={scroll}
        className="forecast-scroll"
        tabIndex={0}
        aria-label="Hourly wind forecast; scroll horizontally for more times"
      >
        <table className="forecast-table">
          <caption className="sr-only">
            {point.name}: {manifest.stepHours}-hour wind forecast, in {units}.
            Times are local to Ireland.
          </caption>
          <thead>
            <tr>
              <th scope="col">
                FORECAST<small>Irish time</small>
              </th>
              {manifest.frames.map((f, i) => (
                <th
                  key={f.hour}
                  scope="col"
                  className={index === i ? "selected-hour" : ""}
                >
                  <button
                    aria-label={`Show forecast ${dayLabel(f.validTime)} ${timeLabel(f.validTime)}`}
                    aria-pressed={index === i}
                    onClick={() => onSelect(i)}
                  >
                    <small>
                      {i === 0 ||
                      dayLabel(f.validTime) !==
                        dayLabel(manifest.frames[i - 1].validTime)
                        ? dayLabel(f.validTime)
                        : "\u00a0"}
                    </small>
                    {timeLabel(f.validTime)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">
                <WindIcon size={13} /> Wind <small>{units}</small>
              </th>
              {manifest.frames.map((f, i) => (
                <td
                  key={f.hour}
                  className={`wind-cell ${index === i ? "selected-hour" : ""}`}
                  style={
                    {
                      "--wind-fill": `${Math.min(100, values[i] ? ((speed(values[i]!) * 1.94384449) / 40) * 100 : 0)}%`,
                    } as React.CSSProperties
                  }
                >
                  {reading(values[i])}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">
                Gusts <small>{units}</small>
              </th>
              {manifest.frames.map((f, i) => (
                <td key={f.hour} className={index === i ? "selected-hour" : ""}>
                  {f.hour === 0 ? "—" : reading(values[i], true)}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">
                Direction <small>from</small>
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
